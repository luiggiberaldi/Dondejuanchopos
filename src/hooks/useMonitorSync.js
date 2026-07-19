import { useEffect, useState, useRef } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { runWithoutEco } from '../utils/syncFlags';
import localforage from 'localforage';

// Configurar localforage a nivel de módulo
localforage.config({ name: 'BodegaApp', storeName: 'bodega_app_data' });

let monitorSubscription = null;

export function useMonitorSync(pairedDeviceId) {
    const [isConnected, setIsConnected] = useState(false);
    const [lastSync, setLastSync] = useState(() => {
        const stored = localStorage.getItem('monitor_last_sync');
        return stored ? new Date(stored) : null;
    });
    const [loading, setLoading] = useState(true);
    const isInitialized = useRef(false);

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

    const initMonitor = async () => {
        try {
            setLoading(true);

            // 1. Pull inicial de todos los datos desde sync_documents del equipo vinculado
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
                monitorSubscription = supabaseCloud
                    .channel(`monitor:${pairedDeviceId}`)
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
                        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                            setIsConnected(false);
                        }
                    });
            }
        } catch (err) {
            setIsConnected(false);
        } finally {
            setLoading(false);
        }
    };

    const triggerRefresh = async () => {
        await initMonitor();
    };

    useEffect(() => {
        if (!supabaseCloud || !pairedDeviceId) {
            setLoading(false);
            return;
        }

        if (isInitialized.current) return;
        isInitialized.current = true;

        initMonitor();

        // Escuchar estado de conexión de red del navegador
        const handleOnline = () => setIsConnected(true);
        const handleOffline = () => setIsConnected(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            if (monitorSubscription) {
                supabaseCloud.removeChannel(monitorSubscription).catch(() => {});
                monitorSubscription = null;
            }
            isInitialized.current = false;
        };
    }, [pairedDeviceId]);

    return { isConnected, lastSync, loading, triggerRefresh };
}
