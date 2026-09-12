import { useEffect, useState, useRef, useCallback } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { runWithoutEco } from '../utils/syncFlags';
import localforage from 'localforage';
import { shouldApplySyncVersion } from '../utils/syncVersionGuard';
import { mergeCloudProductImages } from '../utils/productImageRecovery';
import { normalizeHistoricalSale } from '../utils/salesMerge';
import { fetchRemoteDocuments, REMOTE_MONITOR_DOC_IDS } from '../services/remoteAuditService';
import { SUPERVISOR_RATE_PENDING_KEY } from '../utils/supervisorCommandModel';

// Configurar localforage a nivel de módulo
localforage.config({ name: 'BodegaApp', storeName: 'bodega_app_data' });

// Documentos que el Monitor consume activamente para renderizar métricas, inventario, ventas y usuarios
const RATE_CONFIG_DOC_IDS = Object.freeze([
    'bodega_rate_mode',
    'bodega_use_auto_rate',
    'bodega_custom_rate',
]);

const MONITOR_DOC_IDS = [
    'bodega_products_v1',
    'bodega_sales_v1',
    'bodega_customers_v1',
    'bodega_suppliers_v1',
    'bodega_supplier_invoices_v1',
    'bodega_accounts_v2',
    'bodega_payment_methods_v1',
    'bodega_pending_cart_v1',
    'my_categories_v1',
    'bodega_rate_mode',
    'bodega_users_catalog_v1',
    'bodega_employee_payroll_projection_v1',
    'business_name',
    'business_rif',
    'bodega_custom_rate',
    'street_rate_bs',
    'monitor_rates_v12',
    'tasa_cop',
    'cop_enabled',
    'cop_primary',
    'auto_cop_enabled',
    'bodega_use_auto_rate'
];

// Timers and recovery cursors belong to a mounted monitor, never to the module.

export function useMonitorSync(pairedDeviceId) {
    const [isConnected, setIsConnected] = useState(false);
    const [lastSync, setLastSync] = useState(() => {
        const stored = localStorage.getItem('monitor_last_sync');
        return stored && Number.isFinite(Date.parse(stored)) ? new Date(stored) : null;
    });
    const [loading, setLoading] = useState(true);
    const [posLastSeen, setPosLastSeen] = useState(null);
    const [isPosOnline, setIsPosOnline] = useState(false);
    // R1: distingue "la caja está apagada" de "no pudimos averiguarlo".
    const [presenceError, setPresenceError] = useState(null);
    const isSyncingRef = useRef(false);
    const lastSyncRef = useRef(lastSync);
    const initMonitorRef = useRef(null);
    // E3: cuando la pestaña está oculta, el supervisor no está mirando. Los
    // relojes se ralentizan x6 en vez de mantener el ritmo de primer plano.
    const hiddenRef = useRef(false);
    const tickRef = useRef(0);
    // FX-DJ: monitorSubscription como useRef para que cada instancia del hook
    // gestione su propio canal. Con `let` de módulo, si el componente se desmonta
    // y remonta, la ref queda !null apuntando a un canal muerto y nunca se crea
    // una nueva suscripción.
    const monitorSubscriptionRef = useRef(null);
    const appliedVersionsRef = useRef(new Map());
    const applyDocQueueRef = useRef(new Map());
    // Only a fully applied RPC batch may advance this cursor. Realtime events
    // are partial and must never hide missed documents from the next catch-up.
    const pullCursorRef = useRef(null);
    const oversizePullTimerRef = useRef(null);
    const lifecycleRef = useRef(0);
    const fullPullRequestedRef = useRef(0);
    const fullPullCompletedRef = useRef(0);

    const getVersionKey = useCallback((docId) => {
        const deviceId = pairedDeviceId || localStorage.getItem('dj_paired_device_id') || 'unknown-device';
        return `${deviceId}:${docId}`;
    }, [pairedDeviceId]);

    const persistAppliedVersion = useCallback((versionKey, version) => {
        try {
            const raw = localStorage.getItem('dj_monitor_sync_versions_v1');
            const versions = raw ? JSON.parse(raw) : {};
            versions[versionKey] = version;
            localStorage.setItem('dj_monitor_sync_versions_v1', JSON.stringify(versions));
        } catch (error) {
            console.warn('[useMonitorSync] No se pudo persistir la versión de sync:', error);
        }
    }, []);

    useEffect(() => {
        appliedVersionsRef.current = new Map();
        pullCursorRef.current = null;
        try {
            const raw = localStorage.getItem('dj_monitor_sync_versions_v1');
            const versions = raw ? JSON.parse(raw) : {};
            const prefix = `${pairedDeviceId || localStorage.getItem('dj_paired_device_id') || 'unknown-device'}:`;
            Object.entries(versions || {}).forEach(([key, value]) => {
                if (key.startsWith(prefix)) appliedVersionsRef.current.set(key, value);
            });
        } catch (error) {
            console.warn('[useMonitorSync] No se pudieron cargar versiones de sync:', error);
        }
    }, [pairedDeviceId]);

    useEffect(() => {
        lastSyncRef.current = lastSync;
    }, [lastSync]);

    const checkPosPresence = useCallback(async () => {
        if (!supabaseCloud || !pairedDeviceId) return;
        try {
            // R1: antes se descartaba `error`, así que un fallo de red o de RLS se
            // pintaba como "Caja fuera de línea" — indistinguible de un corte real.
            const { data: pairing, error } = await supabaseCloud
                .from('device_pairings')
                .select('last_seen_at, paired_at')
                .eq('primary_device_id', pairedDeviceId)
                .maybeSingle();

            if (error) {
                console.warn('[useMonitorSync] No se pudo consultar la presencia de la caja:', error.message);
                // No es "la caja está apagada": es "no lo sabemos". Se conserva el
                // último estado conocido y se marca el motivo para la UI.
                setPresenceError(error.message || 'Error consultando presencia');
                return;
            }
            setPresenceError(null);

            if (!pairing) {
                // R1: el emparejamiento no existe. Es un fallo de configuración,
                // no una caja apagada, y la UI debe poder distinguirlo.
                setPresenceError('Este monitor no está vinculado a ninguna caja.');
                setIsPosOnline(false);
                return;
            }

            const stamp = pairing.last_seen_at || pairing.paired_at || null;

            if (stamp) {
                const lastDate = new Date(stamp);
                setPosLastSeen(lastDate);
                const diffMs = Date.now() - lastDate.getTime();
                // Considerar la caja En Línea si reportó actividad en los últimos 3 minutos (180,000 ms)
                setIsPosOnline(diffMs <= 180000);
            } else {
                setIsPosOnline(false);
            }
        } catch (e) {
            console.warn('[useMonitorSync] checkPosPresence lanzó:', e?.message ?? e);
            setPresenceError(e?.message || 'Error de red');
        }
    }, [pairedDeviceId]);

    const persistDocToLocal = async (docId, collection, payload, syncVersion = null, source = 'unknown') => {
        // `null` es un valor válido para bodega_custom_rate cuando se cambia
        // desde manual a BCV/USDT. Los demás documentos nulos siguen siendo
        // inválidos y no deben borrar datos locales.
        if (payload == null && !RATE_CONFIG_DOC_IDS.includes(docId)) return;

        let expectedRateValue = null;
        let pendingRateCommandId = null;
        const currentRateCommandId = () => {
            try { return JSON.parse(localStorage.getItem(SUPERVISOR_RATE_PENDING_KEY) || 'null')?.commandId || null; }
            catch { return null; }
        };
        // Un pull viejo de la tasa no debe pisar la proyección optimista del
        // Supervisor mientras la caja aún confirma el commandId. Sin este
        // guard, la vista cambiaba inmediatamente y volvía al valor anterior,
        // obligando a pulsar "Aplicar" dos veces.
        if (RATE_CONFIG_DOC_IDS.includes(docId)) {
            try {
                const rawPendingRate = localStorage.getItem(SUPERVISOR_RATE_PENDING_KEY);
                if (rawPendingRate) {
                    const pendingRate = JSON.parse(rawPendingRate);
                    pendingRateCommandId = pendingRate?.commandId || null;
                    const desired = pendingRate?.desired || {};
                    expectedRateValue = docId === 'bodega_rate_mode'
                        ? desired.rateMode
                        : docId === 'bodega_use_auto_rate'
                            ? desired.useAutoRate
                            : desired.customRate;
                    const normalize = value => value === null || value === undefined || value === ''
                        ? null
                        : String(value);
                    if (normalize(expectedRateValue) !== normalize(payload)) return false;
                }
            } catch {
                // Un registro corrupto no debe bloquear el pull; el monitor lo
                // limpiará al resolver el comando.
            }
        }
        // Bloqueo de seguridad: nunca guardar credenciales de autenticación del admin en el monitor
        if (docId === 'abasto-auth-storage') return;

        const versionKey = getVersionKey(docId);
        const currentVersion = appliedVersionsRef.current.get(versionKey) || null;
        if (!shouldApplySyncVersion(currentVersion, syncVersion)) {
            console.info('[useMonitorSync] Documento ignorado por versión anterior:', {
                source,
                currentVersion,
                syncVersion,
            });
            return false;
        }

        // Usamos runWithoutEco para estar seguros de que no se gatille ningún eco de sincronización
        let rateInterrupted = false;
        await runWithoutEco(async () => {
            if (collection === 'local' || docId === 'bodega_users_catalog_v1') {
                let stringPayload = typeof payload === 'string' ? payload : JSON.stringify(payload);
                if (docId === 'bodega_rate_mode' && payload != null) {
                    const { sanitizeRateMode } = await import('../context/ProductContext');
                    stringPayload = sanitizeRateMode(payload);
                }
                // La importación o el guard de sync pueden ceder el control.
                // Un eco de A no puede sobrescribir una solicitud B recién creada.
                if (RATE_CONFIG_DOC_IDS.includes(docId) && currentRateCommandId() !== pendingRateCommandId) {
                    rateInterrupted = true;
                    return;
                }
                if (payload == null) {
                    localStorage.removeItem(docId);
                    stringPayload = null;
                } else {
                    localStorage.setItem(docId, stringPayload);
                }
                window.dispatchEvent(new StorageEvent('storage', {
                    key: docId,
                    newValue: stringPayload,
                    storageArea: localStorage
                }));
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: docId } }));
                } else {
                    let payloadToApply = payload;
                    if (docId === 'bodega_products_v1' && Array.isArray(payload)) {
                        const localProducts = await localforage.getItem(docId);
                        payloadToApply = mergeCloudProductImages(payload, localProducts);
                    } else if (docId === 'bodega_sales_v1' && Array.isArray(payload)) {
                        // El monitor es un visor remoto: adopta fielmente el estado canónico de la caja
                        payloadToApply = payload.map(normalizeHistoricalSale);
                    }
                    await localforage.setItem(docId, payloadToApply);
                    window.dispatchEvent(new CustomEvent('app_storage_update', {
                        detail: {
                            key: docId,
                            source: 'monitor-sync',
                            syncVersion,
                            ...(docId === 'bodega_products_v1' ? { payload: payloadToApply } : {}),
                        }
                    }));
            }
        });

        if (rateInterrupted) return false;
        if (syncVersion) {
            appliedVersionsRef.current.set(versionKey, syncVersion);
            persistAppliedVersion(versionKey, syncVersion);
        }

        // El recibo de la tasa se conserva hasta observar todos los documentos
        // esperados. Esto evita que un UPDATE `applied` llegue antes que el push
        // de configuración y un pull viejo vuelva a pintar el valor anterior.
        if (RATE_CONFIG_DOC_IDS.includes(docId) && pendingRateCommandId) {
            try {
                const rawPendingRate = localStorage.getItem(SUPERVISOR_RATE_PENDING_KEY);
                if (rawPendingRate) {
                    const pendingRate = JSON.parse(rawPendingRate);
                    if (pendingRate.commandId !== pendingRateCommandId) return false;
                    const observed = {
                        ...(pendingRate.observed || {}),
                        [docId]: true,
                    };
                    const allObserved = RATE_CONFIG_DOC_IDS.every(key => observed[key]);
                    if (allObserved) {
                        localStorage.removeItem(SUPERVISOR_RATE_PENDING_KEY);
                    } else {
                        localStorage.setItem(SUPERVISOR_RATE_PENDING_KEY, JSON.stringify({ ...pendingRate, observed }));
                    }
                }
            } catch {
                // La barrera se resolverá en el siguiente pull válido.
            }
        }
        return true;
    };

    const applyDocToLocal = (docId, collection, payload, syncVersion = null, source = 'unknown') => {
        if (payload == null && !RATE_CONFIG_DOC_IDS.includes(docId)) return Promise.resolve();
        const versionKey = getVersionKey(docId);
        const previous = applyDocQueueRef.current.get(versionKey) || Promise.resolve();
        const current = previous
            .catch(() => undefined)
            .then(() => persistDocToLocal(docId, collection, payload, syncVersion, source));

        applyDocQueueRef.current.set(versionKey, current);
        current.then(
            () => {
                if (applyDocQueueRef.current.get(versionKey) === current) applyDocQueueRef.current.delete(versionKey);
            },
            () => {
                if (applyDocQueueRef.current.get(versionKey) === current) applyDocQueueRef.current.delete(versionKey);
            },
        );
        return current;
    };

    const initMonitor = useCallback(async (isSilent = false) => {
        const lifecycle = lifecycleRef.current;
        const isCurrent = () => lifecycle === lifecycleRef.current;
        let activeDeviceId = pairedDeviceId || localStorage.getItem('dj_paired_device_id');
        
        // R3: eliminado el "francotirador" global. Consultaba sync_documents SIN
        // filtro de tienda y se quedaba con la caja más activa del sistema, que
        // puede pertenecer a OTRO comercio; después persistía esa elección en
        // `dj_paired_device_id` y le enviaba comandos. La pertenencia solo puede
        // venir del emparejamiento, nunca de una heurística.
        if (!activeDeviceId) {
            console.warn('[useMonitorSync] Monitor sin caja vinculada. Se requiere emparejar con un código.');
            setLoading(false);
            return;
        }

        if (!supabaseCloud) {
            setLoading(false);
            return;
        }

        // Una petición completa no se pierde por existir un pull en vuelo.
        // El contador conserva también el reintento si falla esa recuperación.
        if (!isSilent) fullPullRequestedRef.current++;
        if (isSyncingRef.current) return;
        isSyncingRef.current = true;
        const fullPullRequest = fullPullRequestedRef.current;
        const needsFullPull = fullPullRequest > fullPullCompletedRef.current;

        if (!isSilent) setLoading(true);

        try {
            // Verificar presencia de la caja principal
            await checkPosPresence();

            // 1. Pull inicial o de recuperación incremental (catch-up)
            // Start every mounted session with a full snapshot. Persisted client
            // timestamps cannot prove that IndexedDB still contains that snapshot.
            const updatedAfter = needsFullPull ? null : pullCursorRef.current;
            let batchFailed = false;

            // El monitor no puede consultar sync_documents directamente: el rol
            // anon no tiene SELECT por RLS. La lectura pasa por el RPC que valida
            // el pairing exacto y aplica la whitelist de documentos.
            //
            // Use the protected RPC for both initial reads and incremental recovery.
            // Keep the original server timestamp, including sub-millisecond precision.

            const remoteResult = await fetchRemoteDocuments(
                activeDeviceId,
                REMOTE_MONITOR_DOC_IDS,
                supabaseCloud,
                { updatedAfter },
            );

            if (!isCurrent()) return;
            if (!remoteResult.success) {
                throw new Error(remoteResult.error?.message || 'No se pudieron leer los datos remotos del monitor.');
            }

            const docs = remoteResult.documents
                .map(document => ({
                    collection: document.collection,
                    doc_id: document.doc_id,
                    data: { payload: document.payload },
                    updated_at: document.updated_at,
                }));

            if (docs && docs.length > 0) {
                // D2: try/catch por documento — igual que HOOK-023 en la caja.
                // Un solo documento malformado no puede abortar los otros 20, y
                // menos aún de forma permanente (el pull trae siempre el mismo lote).
                let appliedCount = 0;
                let failedCount = 0;
                for (const doc of docs) {
                    if (!isCurrent()) return;
                    try {
                        if (!doc || doc.data == null) {
                            failedCount++;
                            console.warn(`[useMonitorSync] Documento sin data, omitido: ${doc?.doc_id}`);
                            continue;
                        }
                        const applied = await applyDocToLocal(doc.doc_id, doc.collection, doc.data.payload, doc.updated_at, 'pull');
                        // Deferred optimistic rate values must be retried too.
                        if (applied === false && RATE_CONFIG_DOC_IDS.includes(doc.doc_id)) failedCount++;
                        else appliedCount++;
                    } catch (e) {
                        failedCount++;
                        console.warn(`[useMonitorSync] Error aplicando doc ${doc?.doc_id}:`, e);
                    }
                }

                batchFailed = failedCount > 0;
                if (batchFailed) {
                    console.warn(`[useMonitorSync] Pull parcial: ${appliedCount} aplicados, ${failedCount} fallidos.`);
                }

                // D5/D6: el cursor se deriva del `updated_at` MÁXIMO realmente
                // recibido, no del reloj local. El `updated_at` lo escribe el
                // servidor (ver FX10), así que ambos lados comparten referencia
                // temporal y un desfase de reloj ya no descarta ventanas.
                const latestDoc = docs.reduce((latest, doc) => (
                    Number.isFinite(Date.parse(doc.updated_at))
                    && (!latest || Date.parse(doc.updated_at) > Date.parse(latest.updated_at))
                        ? doc : latest
                ), null);
                if (!batchFailed && latestDoc && fullPullRequestedRef.current === fullPullRequest) {
                    const previousCursor = pullCursorRef.current;
                    if (!previousCursor || Date.parse(latestDoc.updated_at) > Date.parse(previousCursor)) {
                        pullCursorRef.current = latestDoc.updated_at;
                    }
                    const now = new Date(latestDoc.updated_at);
                    setLastSync(previous => previous && previous > now ? previous : now);
                    localStorage.setItem('monitor_last_sync', now.toISOString());
                }

                // `applyDocToLocal` ya notifica cada documento con su versión y
                // payload. No emitir aquí un segundo evento de productos sin
                // versión: esa lectura adicional podía reintroducir un payload
                // viejo mientras el evento Realtime nuevo aún se procesaba.
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_sales_v1' } }));
            } else if (docs) {
                // D6: lote vacío = ya estamos al día. Marcar la sincronización como
                // exitosa evita que el health-check la interprete como "sin datos"
                // y dispare pulls completos repetidos.
                setLastSync(prev => prev || new Date());
            }

            if (!isCurrent()) return;
            if (needsFullPull && !batchFailed) {
                fullPullCompletedRef.current = Math.max(fullPullCompletedRef.current, fullPullRequest);
            }
            setIsConnected(true);

            // 2. Suscripción en Tiempo Real vía WebSocket
            if (!monitorSubscriptionRef.current) {
                const channelName = `monitor:${activeDeviceId}:${Date.now()}`;
                monitorSubscriptionRef.current = supabaseCloud
                    .channel(channelName)
                    .on('postgres_changes', {
                        event: '*',
                        schema: 'public',
                        table: 'sync_documents',
                        filter: `device_id=eq.${activeDeviceId}`
                    }, async (payload) => {
                        if (!isCurrent() || payload?.eventType === 'DELETE') return;

                        const doc = payload?.new;

                        if (!doc || !doc.doc_id || !doc.data) {
                            console.warn('[useMonitorSync] Evento de Realtime sin cuerpo (posible 413). Forzando pull completo.', payload?.errors);
                            if (!oversizePullTimerRef.current) {
                                oversizePullTimerRef.current = setTimeout(() => {
                                    oversizePullTimerRef.current = null;
                                    initMonitorRef.current?.(true);
                                }, 3000);
                            }
                            return;
                        }

                        if (!['store', 'local'].includes(doc.collection)) return;
                        if (!MONITOR_DOC_IDS.includes(doc.doc_id)) return;
                        try {
                            await applyDocToLocal(doc.doc_id, doc.collection, doc.data?.payload, doc.updated_at, 'realtime');
                        } catch (error) {
                            console.warn('[useMonitorSync] Realtime persistence failed; RPC recovery will retry:', error);
                            return;
                        }
                        if (!isCurrent()) return;
                        const now = doc.updated_at ? new Date(doc.updated_at) : new Date();
                        setLastSync(now);
                        setPosLastSeen(now);
                        setIsPosOnline(true);
                        setPresenceError(null); // R2: un evento Realtime prueba que la caja está viva — limpiar error de presencia obsoleto
                        localStorage.setItem('monitor_last_sync', now.toISOString());
                    })
                    .subscribe((status) => {
                        if (!isCurrent()) return;
                        if (status === 'SUBSCRIBED') {
                            setIsConnected(true);
                        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                            setIsConnected(false);
                            if (monitorSubscriptionRef.current) {
                                supabaseCloud.removeChannel(monitorSubscriptionRef.current).catch(() => {});
                                monitorSubscriptionRef.current = null;
                            }
                        }
                    });
            }
        } catch (err) {
            console.warn('[useMonitorSync] Error en sincronización o reconexión:', err);
            if (isCurrent()) setIsConnected(false);
        } finally {
            if (isCurrent()) {
                isSyncingRef.current = false;
                setLoading(false);
                // Solo una solicitud NUEVA dispara otra lectura inmediata; un
                // error conserva la recuperación para el siguiente tick sin bucle.
                if (fullPullRequestedRef.current > fullPullRequest) {
                    queueMicrotask(() => {
                        if (isCurrent()) initMonitorRef.current?.(true);
                    });
                }
            }
        }
    }, [pairedDeviceId, checkPosPresence]);

    useEffect(() => {
        initMonitorRef.current = initMonitor;
    }, [initMonitor]);

    const triggerRefresh = async () => {
        if (monitorSubscriptionRef.current) {
            await supabaseCloud.removeChannel(monitorSubscriptionRef.current).catch(() => {});
            monitorSubscriptionRef.current = null;
        }
        localStorage.removeItem('dj_monitor_last_full_pull_ts');
        pullCursorRef.current = null;
        lastSyncRef.current = null;
        setLastSync(null);
        await initMonitor(false);
    };

    // Heartbeat de presencia del monitor hacia la nube (cada 60s)
    const sendHeartbeat = useCallback(async () => {
        if (!supabaseCloud) return;
        const myDeviceId = localStorage.getItem('dj_device_id');
        if (!myDeviceId) return;

        try {
            const { data, error } = await supabaseCloud.rpc('touch_monitor_heartbeat', {
                p_monitor_device_id: myDeviceId
            });
            if (!error && data && data.is_revoked) {
                window.dispatchEvent(new CustomEvent('monitor_revoked'));
            }
        } catch {
            // Silencioso si falla la red o el RPC aún no existe en el servidor
        }
    }, []);

    const isConnectedRef = useRef(isConnected);
    useEffect(() => {
        isConnectedRef.current = isConnected;
    }, [isConnected]);

    useEffect(() => {
        if (!supabaseCloud || !pairedDeviceId) {
            setLoading(false);
            return;
        }

        // StrictMode and pairing changes invalidate outstanding requests before
        // a new subscription starts. A disposed pull must not recreate a channel.
        lifecycleRef.current++;
        isSyncingRef.current = false;
        // Inicializar sincronización y enviar heartbeat inicial
        initMonitor(false);
        sendHeartbeat();

        // 1. Escuchar reconexión de red del navegador (online / offline)
        const handleOnline = () => {
            console.log('[useMonitorSync] Conexión de red restablecida. Sincronizando al instante...');
            setIsConnected(true);
            sendHeartbeat();
            triggerRefresh();
        };

        const handleOffline = () => {
            console.warn('[useMonitorSync] Red desconectada. Operando en modo offline...');
            setIsConnected(false);
        };

        // 2. Escuchar cuando el usuario regresa a la app (desbloqueo de pantalla o cambio de pestaña)
        const handleVisibilityChange = () => {
            const wasHidden = hiddenRef.current;
            hiddenRef.current = document.visibilityState === 'hidden';
            if (wasHidden && !hiddenRef.current && navigator.onLine) {
                initMonitor(true);
                sendHeartbeat();
            } else if (document.visibilityState === 'visible' && navigator.onLine) {
                const now = Date.now();
                const lastSyncMs = lastSyncRef.current ? lastSyncRef.current.getTime() : 0;
                const isFresh = monitorSubscriptionRef.current && (now - lastSyncMs < 60000);
                if (!isFresh) {
                    initMonitor(true);
                }
            }
        };

        const handleSupervisorRecovery = () => {
            // Una confirmación necesita reobservar datos que no necesariamente
            // cambiaron de versión (p. ej. una tasa rechazada o un ajuste sin delta).
            pullCursorRef.current = null;
            initMonitorRef.current?.(false);
        };
        window.addEventListener('supervisor_sync_requested', handleSupervisorRecovery);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        const checkCounterRef = { current: 0 };
        // 3. Health-check en segundo plano: 30s con canal sano, 10s cuando está caído (FX9)
        const reconnectTimer = setInterval(() => {
            if (!navigator.onLine) return;
            tickRef.current++;
            // E3: en segundo plano, 1 de cada 6 ticks.
            if (hiddenRef.current && tickRef.current % 6 !== 0) return;

            const isHealthy = isConnectedRef.current && monitorSubscriptionRef.current;
            checkCounterRef.current += 1;

            if (!isHealthy || checkCounterRef.current % 3 === 0) {
                checkPosPresence();
            }

            // SUBSCRIBED does not guarantee row delivery (RLS or a lost event).
            // Recover through the protected RPC every 30s even with a live socket.
            if (!isHealthy || checkCounterRef.current % 3 === 0) {
                initMonitor(true);
            }
        }, 10000);

        // 4. Heartbeat de presencia hacia Supabase (cada 60s)
        const heartbeatTimer = setInterval(() => {
            if (hiddenRef.current) return;
            if (navigator.onLine) {
                sendHeartbeat();
            }
        }, 60000);

        return () => {
            lifecycleRef.current++;
            isSyncingRef.current = false;
            window.removeEventListener('supervisor_sync_requested', handleSupervisorRecovery);
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (reconnectTimer) clearInterval(reconnectTimer);
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            if (oversizePullTimerRef.current) {
                clearTimeout(oversizePullTimerRef.current);
                oversizePullTimerRef.current = null;
            }
            if (monitorSubscriptionRef.current) {
                supabaseCloud.removeChannel(monitorSubscriptionRef.current).catch(() => {});
                monitorSubscriptionRef.current = null;
            }
        };
    }, [pairedDeviceId, initMonitor, sendHeartbeat, checkPosPresence]);

    return { isConnected, lastSync, loading, triggerRefresh, posLastSeen, isPosOnline, presenceError };
}
