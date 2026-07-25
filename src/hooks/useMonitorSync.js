import { useEffect, useState, useRef, useCallback } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { runWithoutEco } from '../utils/syncFlags';
import localforage from 'localforage';

// Configurar localforage a nivel de módulo
localforage.config({ name: 'BodegaApp', storeName: 'bodega_app_data' });

let monitorSubscription = null;
let reconnectTimer = null;

export function useMonitorSync(pairedDeviceId) {
    const [isConnected, setIsConnected] = useState(false);
    const [lastSync, setLastSync] = useState(() => {
        const stored = localStorage.getItem('monitor_last_sync');
        return stored ? new Date(stored) : null;
    });
    const [loading, setLoading] = useState(true);
    const isSyncingRef = useRef(false);

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
            // 1. Pull inicial o de recuperación (catch-up) desde sync_documents del equipo vinculado
            const { data: docs, error } = await supabaseCloud
                .from('sync_documents')
                .select('collection, doc_id, data')
                .eq('device_id', pairedDeviceId)
                .in('collection', ['store', 'local']);

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
                        await applyDocToLocal(doc.doc_id, doc.collection, doc.data.payload);
                        const now = new Date();
                        setLastSync(now);
                        localStorage.setItem('monitor_last_sync', now.toISOString());
                    })
                    .subscribe((status) => {
                        if (status === 'SUBSCRIBED') {
                            setIsConnected(true);
                        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                            setIsConnected(false);
                            // Si el canal se cierra o falla por corte de red, desasociar canal para forzar reconexión limpia
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
    }, [pairedDeviceId]);

    const triggerRefresh = async () => {
        if (monitorSubscription) {
            await supabaseCloud.removeChannel(monitorSubscription).catch(() => {});
            monitorSubscription = null;
        }
        await initMonitor(false);
    };

    useEffect(() => {
        if (!supabaseCloud || !pairedDeviceId) {
            setLoading(false);
            return;
        }

        // Inicializar sincronización
        initMonitor(false);

        // 1. Escuchar reconexión de red del navegador (online / offline)
        const handleOnline = () => {
            console.log('[useMonitorSync] Conexión de red restablecida. Sincronizando al instante...');
            setIsConnected(true);
            triggerRefresh();
        };

        const handleOffline = () => {
            console.warn('[useMonitorSync] Red desconectada. Operando en modo offline...');
            setIsConnected(false);
        };

        // 2. Escuchar cuando el usuario regresa a la app (desbloqueo de pantalla o cambio de pestaña)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && navigator.onLine) {
                initMonitor(true);
            }
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // 3. Health-check en segundo plano (Re-intento automático cada 10 segundos)
        reconnectTimer = setInterval(() => {
            if (navigator.onLine && (!isConnected || !monitorSubscription)) {
                initMonitor(true);
            }
        }, 10000);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (reconnectTimer) clearInterval(reconnectTimer);

            if (monitorSubscription) {
                supabaseCloud.removeChannel(monitorSubscription).catch(() => {});
                monitorSubscription = null;
            }
        };
    }, [pairedDeviceId, initMonitor]);

    return { isConnected, lastSync, loading, triggerRefresh };
}
