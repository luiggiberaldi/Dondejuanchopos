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

    useEffect(() => {
        lastSyncRef.current = lastSync;
    }, [lastSync]);

    const checkPosPresence = useCallback(async () => {
        if (!supabaseCloud || !pairedDeviceId) return;
        try {
            const { data: docs } = await supabaseCloud
                .from('sync_documents')
                .select('updated_at')
                .eq('device_id', pairedDeviceId)
                .order('updated_at', { ascending: false })
                .limit(1);

            let maxLastSeenMs = 0;
            if (docs && docs.length > 0 && docs[0].updated_at) {
                maxLastSeenMs = new Date(docs[0].updated_at).getTime();
            }

            // Consultar también la última presencia registrada en device_pairings
            const { data: pairing } = await supabaseCloud
                .from('device_pairings')
                .select('paired_at')
                .eq('primary_device_id', pairedDeviceId)
                .maybeSingle();

            if (pairing && pairing.paired_at) {
                const pairingMs = new Date(pairing.paired_at).getTime();
                if (pairingMs > maxLastSeenMs) maxLastSeenMs = pairingMs;
            }

            // Consultar también la última presencia en device_monitors
            try {
                const { data: monitors } = await supabaseCloud
                    .from('device_monitors')
                    .select('last_seen_at')
                    .eq('primary_device_id', pairedDeviceId)
                    .order('last_seen_at', { ascending: false })
                    .limit(1);

                if (monitors && monitors.length > 0 && monitors[0].last_seen_at) {
                    const monMs = new Date(monitors[0].last_seen_at).getTime();
                    if (monMs > maxLastSeenMs) maxLastSeenMs = monMs;
                }
            } catch (e) {}

            if (maxLastSeenMs > 0) {
                const lastDate = new Date(maxLastSeenMs);
                setPosLastSeen(lastDate);
                const diffMs = Date.now() - maxLastSeenMs;
                // Considerar la caja En Línea si reportó actividad en los últimos 10 minutos (600,000 ms)
                setIsPosOnline(diffMs <= 600000);
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
                const stringPayload = typeof payload === 'string' ? payload : JSON.stringify(payload);
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
        if (!supabaseCloud || !pairedDeviceId) {
            setLoading(false);
            return;
        }

        if (isSyncingRef.current) return;
        isSyncingRef.current = true;

        if (!isSilent) setLoading(true);

        try {
            // Verificar presencia de la caja principal
            await checkPosPresence();

            // 1. Pull inicial o de recuperación (catch-up) usando filtro explícito doc_id para reducir egress
            const { data: docs, error } = await supabaseCloud
                .from('sync_documents')
                .select('collection, doc_id, data')
                .eq('device_id', pairedDeviceId)
                .in('doc_id', MONITOR_DOC_IDS);

            if (error) throw error;

            if (docs && docs.length > 0) {
                for (const doc of docs) {
                    await applyDocToLocal(doc.doc_id, doc.collection, doc.data.payload);
                }
                const now = new Date();
                setLastSync(now);
                localStorage.setItem('monitor_last_sync', now.toISOString());

                // Notificar a los context (ProductContext, etc) para actualizar el estado React de inmediato
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_products_v1' } }));
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_sales_v1' } }));
            }

            setIsConnected(true);

            // 2. Suscripción en Tiempo Real vía WebSocket
            if (!monitorSubscription) {
                const channelName = `monitor:${pairedDeviceId}:${Date.now()}`;
                monitorSubscription = supabaseCloud
                    .channel(channelName)
                    .on('postgres_changes', {
                        event: '*',
                        schema: 'public',
                        table: 'sync_documents',
                        filter: `device_id=eq.${pairedDeviceId}`
                    }, async (payload) => {
                        const doc = payload.new;
                        if (!doc || !['store', 'local'].includes(doc.collection)) return;
                        if (!MONITOR_DOC_IDS.includes(doc.doc_id)) return;
                        await applyDocToLocal(doc.doc_id, doc.collection, doc.data.payload);
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

    const triggerRefresh = async () => {
        if (monitorSubscription) {
            await supabaseCloud.removeChannel(monitorSubscription).catch(() => {});
            monitorSubscription = null;
        }
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
            clearInterval(heartbeatTimer);

            if (monitorSubscription) {
                supabaseCloud.removeChannel(monitorSubscription).catch(() => {});
                monitorSubscription = null;
            }
        };
    }, [pairedDeviceId, initMonitor, checkPosPresence, sendHeartbeat]);

    return { isConnected, lastSync, loading, triggerRefresh, posLastSeen, isPosOnline };
}
