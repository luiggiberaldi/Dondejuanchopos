import { useEffect, useState, useRef, useCallback } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { runWithoutEco } from '../utils/syncFlags';
import localforage from 'localforage';

// Configurar localforage a nivel de módulo
localforage.config({ name: 'BodegaApp', storeName: 'bodega_app_data' });

// Documentos que el Monitor consume activamente para renderizar métricas, inventario, ventas y usuarios
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

let monitorSubscription = null;
let reconnectTimer = null;
let oversizePullTimer = null;

export function useMonitorSync(pairedDeviceId) {
    const [isConnected, setIsConnected] = useState(false);
    const [lastSync, setLastSync] = useState(() => {
        const stored = localStorage.getItem('monitor_last_sync');
        return stored ? new Date(stored) : null;
    });
    const [loading, setLoading] = useState(true);
    const [posLastSeen, setPosLastSeen] = useState(null);
    const [isPosOnline, setIsPosOnline] = useState(false);
    const isSyncingRef = useRef(false);
    const lastSyncRef = useRef(lastSync);
    const initMonitorRef = useRef(null);

    useEffect(() => {
        lastSyncRef.current = lastSync;
    }, [lastSync]);

    const checkPosPresence = useCallback(async () => {
        if (!supabaseCloud || !pairedDeviceId) return;
        try {
            const { data: pairing } = await supabaseCloud
                .from('device_pairings')
                .select('last_seen_at, paired_at')
                .eq('primary_device_id', pairedDeviceId)
                .maybeSingle();

            const stamp = pairing?.last_seen_at || pairing?.paired_at || null;

            if (stamp) {
                const lastDate = new Date(stamp);
                setPosLastSeen(lastDate);
                const diffMs = Date.now() - lastDate.getTime();
                // Considerar la caja En Línea si reportó actividad en los últimos 3 minutos (180,000 ms)
                setIsPosOnline(diffMs <= 180000);
            } else {
                setIsPosOnline(false);
            }
        } catch {
            setIsPosOnline(false);
        }
    }, [pairedDeviceId]);

    const applyDocToLocal = async (docId, collection, payload) => {
        if (payload == null) return;
        // Bloqueo de seguridad: nunca guardar credenciales de autenticación del admin en el monitor
        if (docId === 'abasto-auth-storage') return;

        // Usamos runWithoutEco para estar seguros de que no se gatille ningún eco de sincronización
        await runWithoutEco(async () => {
            if (collection === 'local') {
                let stringPayload = typeof payload === 'string' ? payload : JSON.stringify(payload);
                if (docId === 'bodega_rate_mode') {
                    const { sanitizeRateMode } = await import('../context/ProductContext');
                    stringPayload = sanitizeRateMode(payload);
                }
                localStorage.setItem(docId, stringPayload);
                window.dispatchEvent(new StorageEvent('storage', {
                    key: docId,
                    newValue: stringPayload,
                    storageArea: localStorage
                }));
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: docId } }));
            } else {
                await localforage.setItem(docId, payload);
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: docId } }));
            }
        });
    };

    const initMonitor = useCallback(async (isSilent = false) => {
        let activeDeviceId = pairedDeviceId || localStorage.getItem('dj_paired_device_id');
        
        if (!activeDeviceId && supabaseCloud) {
            try {
                const { data } = await supabaseCloud
                    .from('sync_documents')
                    .select('device_id')
                    .eq('doc_id', 'bodega_sales_v1')
                    .order('updated_at', { ascending: false })
                    .limit(1);
                if (data?.[0]?.device_id) {
                    activeDeviceId = data[0].device_id;
                    localStorage.setItem('dj_paired_device_id', activeDeviceId);
                }
            } catch (e) {}
        }

        if (!supabaseCloud || !activeDeviceId) {
            setLoading(false);
            return;
        }

        if (isSyncingRef.current) return;
        isSyncingRef.current = true;

        if (!isSilent) setLoading(true);

        try {
            // Verificar presencia de la caja principal
            await checkPosPresence();

            // 1. Pull inicial o de recuperación incremental (catch-up)
            const lastSyncIso = (isSilent && lastSyncRef.current) ? lastSyncRef.current.toISOString() : null;
            const lastFullPullTs = parseInt(localStorage.getItem('dj_monitor_last_full_pull_ts') || '0', 10);
            const nowTs = Date.now();
            const MONITOR_FULL_PULL_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

            let query = supabaseCloud
                .from('sync_documents')
                .select('collection, doc_id, data, updated_at')
                .eq('device_id', activeDeviceId)
                .in('doc_id', MONITOR_DOC_IDS)
                .order('updated_at', { ascending: true });

            // D3: el rate limiter se marca DESPUÉS de un pull exitoso, nunca antes.
            // Antes se escribía aquí y un query fallido dejaba al monitor 5 minutos
            // bloqueado, sin datos y sin posibilidad de reintentar.
            let isFullPull = false;
            if (lastSyncIso) {
                query = query.gt('updated_at', lastSyncIso);
            } else if (nowTs - lastFullPullTs < MONITOR_FULL_PULL_MIN_INTERVAL_MS) {
                console.log('[useMonitorSync] Full-Pull del Monitor omitido por Rate Limiter (< 5 min). Usando datos locales.');
                query = query.gt('updated_at', new Date(lastFullPullTs).toISOString());
            } else {
                isFullPull = true;
            }

            const { data: docs, error } = await query;

            if (error) throw error;

            // D3: solo ahora sabemos que el pull completo se realizó de verdad.
            if (isFullPull) {
                localStorage.setItem('dj_monitor_last_full_pull_ts', String(nowTs));
            }

            if (docs && docs.length > 0) {
                // D2: try/catch por documento — igual que HOOK-023 en la caja.
                // Un solo documento malformado no puede abortar los otros 20, y
                // menos aún de forma permanente (el pull trae siempre el mismo lote).
                let appliedCount = 0;
                let failedCount = 0;
                for (const doc of docs) {
                    try {
                        if (!doc || doc.data == null) {
                            failedCount++;
                            console.warn(`[useMonitorSync] Documento sin data, omitido: ${doc?.doc_id}`);
                            continue;
                        }
                        await applyDocToLocal(doc.doc_id, doc.collection, doc.data.payload);
                        appliedCount++;
                    } catch (e) {
                        failedCount++;
                        console.warn(`[useMonitorSync] Error aplicando doc ${doc?.doc_id}:`, e);
                    }
                }

                if (failedCount > 0) {
                    console.warn(`[useMonitorSync] Pull parcial: ${appliedCount} aplicados, ${failedCount} fallidos.`);
                }

                // D5/D6: el cursor se deriva del `updated_at` MÁXIMO realmente
                // recibido, no del reloj local. El `updated_at` lo escribe el
                // servidor (ver FX10), así que ambos lados comparten referencia
                // temporal y un desfase de reloj ya no descarta ventanas.
                const maxUpdatedAt = docs.reduce((acc, d) => {
                    const t = d?.updated_at ? new Date(d.updated_at).getTime() : 0;
                    return t > acc ? t : acc;
                }, 0);
                const now = maxUpdatedAt > 0 ? new Date(maxUpdatedAt) : new Date();
                setLastSync(now);
                localStorage.setItem('monitor_last_sync', now.toISOString());

                // Notificar a los context (ProductContext, etc) para actualizar el estado React de inmediato
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_products_v1' } }));
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_sales_v1' } }));
            } else if (docs) {
                // D6: lote vacío = ya estamos al día. Marcar la sincronización como
                // exitosa evita que el health-check la interprete como "sin datos"
                // y dispare pulls completos repetidos.
                setLastSync(prev => prev || new Date());
            }

            setIsConnected(true);

            // 2. Suscripción en Tiempo Real vía WebSocket
            if (!monitorSubscription) {
                const channelName = `monitor:${activeDeviceId}:${Date.now()}`;
                monitorSubscription = supabaseCloud
                    .channel(channelName)
                    .on('postgres_changes', {
                        event: '*',
                        schema: 'public',
                        table: 'sync_documents',
                        filter: `device_id=eq.${activeDeviceId}`
                    }, async (payload) => {
                        if (payload?.eventType === 'DELETE') return;

                        const doc = payload?.new;

                        if (!doc || !doc.doc_id || !doc.data) {
                            console.warn('[useMonitorSync] Evento de Realtime sin cuerpo (posible 413). Forzando pull completo.', payload?.errors);
                            if (!oversizePullTimer) {
                                oversizePullTimer = setTimeout(() => {
                                    oversizePullTimer = null;
                                    initMonitorRef.current?.(true);
                                }, 3000);
                            }
                            return;
                        }

                        if (!['store', 'local'].includes(doc.collection)) return;
                        if (!MONITOR_DOC_IDS.includes(doc.doc_id)) return;
                        await applyDocToLocal(doc.doc_id, doc.collection, doc.data?.payload);
                        const now = new Date();
                        setLastSync(now);
                        setPosLastSeen(now);
                        setIsPosOnline(true);
                        localStorage.setItem('monitor_last_sync', now.toISOString());
                    })
                    .subscribe((status) => {
                        if (status === 'SUBSCRIBED') {
                            setIsConnected(true);
                        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                            setIsConnected(false);
                            if (monitorSubscription) {
                                supabaseCloud.removeChannel(monitorSubscription).catch(() => {});
                                monitorSubscription = null;
                            }
                        }
                    });
            }
        } catch (err) {
            console.warn('[useMonitorSync] Error en sincronización o reconexión:', err);
            setIsConnected(false);
        } finally {
            isSyncingRef.current = false;
            setLoading(false);
        }
    }, [pairedDeviceId, checkPosPresence]);

    useEffect(() => {
        initMonitorRef.current = initMonitor;
    }, [initMonitor]);

    const triggerRefresh = async () => {
        if (monitorSubscription) {
            await supabaseCloud.removeChannel(monitorSubscription).catch(() => {});
            monitorSubscription = null;
        }
        localStorage.removeItem('dj_monitor_last_full_pull_ts');
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
            if (document.visibilityState === 'visible' && navigator.onLine) {
                const now = Date.now();
                const lastSyncMs = lastSyncRef.current ? lastSyncRef.current.getTime() : 0;
                const isFresh = monitorSubscription && (now - lastSyncMs < 60000);
                if (!isFresh) {
                    initMonitor(true);
                }
            }
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        const checkCounterRef = { current: 0 };
        // 3. Health-check en segundo plano: 30s con canal sano, 10s cuando está caído (FX9)
        reconnectTimer = setInterval(() => {
            if (!navigator.onLine) return;

            const isHealthy = isConnectedRef.current && monitorSubscription;
            checkCounterRef.current += 1;

            if (!isHealthy || checkCounterRef.current % 3 === 0) {
                checkPosPresence();
            }

            if (!isHealthy) {
                initMonitor(true);
            }
        }, 10000);

        // 4. Heartbeat de presencia hacia Supabase (cada 60s)
        const heartbeatTimer = setInterval(() => {
            if (navigator.onLine) {
                sendHeartbeat();
            }
        }, 60000);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (reconnectTimer) clearInterval(reconnectTimer);
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            if (oversizePullTimer) { clearTimeout(oversizePullTimer); oversizePullTimer = null; }
            if (monitorSubscription) {
                supabaseCloud.removeChannel(monitorSubscription).catch(() => {});
                monitorSubscription = null;
            }
        };
    }, [pairedDeviceId, initMonitor, sendHeartbeat, checkPosPresence]);

    return { isConnected, lastSync, loading, triggerRefresh, posLastSeen, isPosOnline };
}
