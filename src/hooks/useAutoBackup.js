import { useEffect, useRef } from 'react';
import { storageService } from '../utils/storageService';
import { supabaseCloud } from '../config/supabaseCloud';
import { IDB_KEYS, LS_KEYS } from '../config/backupKeys';
import { compressString, isCompressionSupported } from '../utils/compression';
import {
    clearCloudRetryFailure,
    getCloudRetryState,
    recordCloudRetryFailure,
} from '../utils/cloudRetry';


// ─── Configuración optimizada ───────────────────────────────────────────────
const BACKUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos
const BACKUP_KEY = 'bodega_autobackup_v1';
const LAST_UPLOAD_HASH_KEY = 'bodega_last_upload_hash';

/** Hash ligero para detectar cambios sin comparar objetos enteros */
function quickHash(obj) {
    const str = typeof obj === 'string' ? obj : (JSON.stringify(obj) ?? '');
    const len = str.length;
    if (len === 0) return '0_0';
    let h = 0;
    const step = Math.max(1, Math.floor(len / 5000));
    for (let i = 0; i < len; i += step) {
        h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return `${len}_${h >>> 0}`;
}

export function useAutoBackup(isPremium, isDemo, deviceId) {
    const intervalRef = useRef(null);
    const initialTimerRef = useRef(null);
    // Ref para que el handler de Realtime pueda llamar a performBackup
    const performBackupRef = useRef(null);
    const retryTimerRef = useRef(null);
    const backupInFlightRef = useRef(false);

    // HOOK-043: Separar la config (isPremium/isDemo/deviceId) en un ref para que
    // el `useEffect` del intervalo NO se re-cree en cada cambio de isPremium/isDemo
    // (lo que reseteaba el contador del intervalo y disparaba un backup inicial
    // nuevo cada vez, gastando cuota de Supabase). El intervalo vive una sola vez
    // por sesión de la app; los valores actualizados se leen vía ref.
    const configRef = useRef({ isPremium, isDemo, deviceId });
    useEffect(() => {
        configRef.current = { isPremium, isDemo, deviceId };
    }, [isPremium, isDemo, deviceId]);

    useEffect(() => {
        const performBackup = async (forceUpload = false) => {
            if (backupInFlightRef.current) return false;
            backupInFlightRef.current = true;
            const { isPremium: premium, isDemo: demo, deviceId: devId } = configRef.current;
            try {
                // ── Recolectar IndexedDB ────────────────────────────────
                const idbData = {};
                let hasData = false;
                for (const key of IDB_KEYS) {
                    const val = await storageService.getItem(key, null);
                    if (val !== null) { idbData[key] = val; hasData = true; }
                }

                if (!hasData) return false;

                // ── Recolectar localStorage ────────────────────────────
                const lsData = {};
                for (const key of LS_KEYS) {
                    const val = localStorage.getItem(key);
                    if (val !== null) lsData[key] = val;
                }

                // ── Backup completo (formato v2.0) ────────────────────
                const fullBackup = {
                    timestamp: new Date().toISOString(),
                    version: '2.0',
                    appName: 'Donde_Juancho_POS',
                    device: navigator.userAgent?.substring(0, 80),
                    data: { idb: idbData, ls: lsData }
                };

                // Guardar copia local
                await storageService.setItem(BACKUP_KEY, fullBackup);

                // Subir a la nube si hay sesión activa (para evitar 401 en consola)
                if (!devId || !supabaseCloud) return true;
                const retryOperation = `backup:${devId}`;
                const retryState = getCloudRetryState(retryOperation);
                if (retryState.coolingDown) {
                    console.info(`[AutoBackup] Upload en pausa por backoff (${Math.ceil(retryState.remainingMs / 1000)}s restantes).`);
                    if (!retryTimerRef.current) {
                        retryTimerRef.current = setTimeout(() => {
                            retryTimerRef.current = null;
                            performBackupRef.current?.(true);
                        }, retryState.remainingMs);
                    }
                    return false;
                }

                {
                    let hasAuth = false;
                    try {
                        const { data: { session } } = await supabaseCloud.auth.getSession();
                        hasAuth = !!(session && !(session.expires_at && session.expires_at * 1000 < Date.now()));
                    } catch (e) {
                        hasAuth = false;
                    }

                    if (!hasAuth) return false; // Omitir subida cloud si no está logueado

                    const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
                    const lastDailyBackup = localStorage.getItem('bodega_last_daily_backup_date');

                    // Si no es premium y ya respaldó hoy, omitir para evitar peticiones redundantes
                    if (!premium && lastDailyBackup === todayStr && !forceUpload) return true;

                    const currentHash = quickHash(idbData);
                    const lastHash = localStorage.getItem(LAST_UPLOAD_HASH_KEY);

                    // forceUpload=true omite la verificación de hash (solicitud manual)
                    if (!forceUpload && currentHash === lastHash) return true;

                    let payloadToUpload = fullBackup;
                    if (isCompressionSupported()) {
                        try {
                            const compressedData = await compressString(JSON.stringify(fullBackup));
                            payloadToUpload = {
                                compressed: true,
                                version: '2.0',
                                timestamp: fullBackup.timestamp,
                                appName: fullBackup.appName,
                                device: fullBackup.device,
                                data: compressedData
                            };
                        } catch (err) {
                            console.error('[AutoBackup] Error al comprimir backup, usando raw JSON:', err);
                        }
                    }

                    // Resumen calculado una sola vez aquí para que Estación Maestra pueda
                    // listar backups sin tener que descargar/descomprimir `backup_data`.
                    const productCount = Array.isArray(idbData.bodega_products_v1) ? idbData.bodega_products_v1.length : 0;
                    const salesCount = Array.isArray(idbData.bodega_sales_v1) ? idbData.bodega_sales_v1.length : 0;
                    const customerCount = Array.isArray(idbData.bodega_customers_v1) ? idbData.bodega_customers_v1.length : 0;
                    const sizeBytes = JSON.stringify(payloadToUpload).length;

                    try {
                        const { error } = await supabaseCloud.from('cloud_backups').upsert({
                            device_id: devId,
                            backup_data: payloadToUpload,
                            size_bytes: sizeBytes,
                            product_count: productCount,
                            sales_count: salesCount,
                            customer_count: customerCount,
                            updated_at: new Date().toISOString()
                        }, { onConflict: 'device_id' });
                        if (error) {
                            const failure = recordCloudRetryFailure(retryOperation, error);
                            console.warn(`[AutoBackup] Supabase rechazó el backup; reintento en ${Math.ceil(failure.delayMs / 1000)}s.`, error.message);
                            if (!retryTimerRef.current) {
                                retryTimerRef.current = setTimeout(() => {
                                    retryTimerRef.current = null;
                                    performBackupRef.current?.(true);
                                }, failure.delayMs);
                            }
                            return false;
                        }
                    } catch (error) {
                        const failure = recordCloudRetryFailure(retryOperation, error);
                        console.warn(`[AutoBackup] Error de red al subir; reintento en ${Math.ceil(failure.delayMs / 1000)}s.`);
                        if (!retryTimerRef.current) {
                            retryTimerRef.current = setTimeout(() => {
                                retryTimerRef.current = null;
                                performBackupRef.current?.(true);
                            }, failure.delayMs);
                        }
                        return false;
                    }

                    clearCloudRetryFailure(retryOperation);
                    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
                    retryTimerRef.current = null;
                    localStorage.setItem(LAST_UPLOAD_HASH_KEY, currentHash);
                    localStorage.setItem('bodega_last_daily_backup_date', todayStr);
                    return true;
                }

            } catch (e) {
                console.error('[AutoBackup] Error:', e);
                return false;
            } finally {
                backupInFlightRef.current = false;
            }
        };

        performBackupRef.current = performBackup;

        // Primer backup 30s después del arranque
        initialTimerRef.current = setTimeout(performBackup, 30000);

        // Backup cada 30 minutos — intervalo estable, no se re-crea por cambios de config.
        intervalRef.current = setInterval(performBackup, BACKUP_INTERVAL_MS);

        return () => {
            if (initialTimerRef.current) clearTimeout(initialTimerRef.current);
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            performBackupRef.current = null;
        };
        // HOOK-043: deps vacíos — el intervalo se monta una sola vez por app lifetime.
        // `configRef` mantiene los valores actuales sin re-crear el effect.
    }, []);

    // ── Suscripción a solicitudes de backup en tiempo real ─────────────────
    // Solo dispositivos con cuenta activa (permanent/monthly/demo) mantienen este
    // socket abierto — evita gastar cupo de conexiones Realtime en instalaciones
    // sin licencia (free/demo vencida) que nunca usarán el backup remoto forzado.
    useEffect(() => {
        if (!deviceId || !supabaseCloud || !isPremium) return;

        let channel = null;
        let requestInFlight = false;

        // Suscribirse al canal en tiempo real de forma anónima
        channel = supabaseCloud
            .channel(`backup_request_${deviceId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'backup_requests',
                filter: `device_id=eq.${deviceId}`
            }, async (payload) => {
                if (payload.new?.status === 'pending') {
                    if (requestInFlight) return;
                    requestInFlight = true;
                    console.log('[AutoBackup] Solicitud de backup recibida. Ejecutando...');
                    try {
                        const uploaded = await performBackupRef.current?.(true); // forzar subida
                        if (!uploaded) {
                            console.warn('[AutoBackup] Solicitud remota no se marca completada: el backup no se confirmó.');
                            const { error } = await supabaseCloud.from('backup_requests')
                                .update({ status: 'error' })
                                .eq('device_id', deviceId);
                            if (error) console.warn('[AutoBackup] No se pudo informar el fallo de backup:', error.message);
                            return;
                        }
                        const { error } = await supabaseCloud.from('backup_requests').update({
                            status: 'completed',
                            completed_at: new Date().toISOString()
                        }).eq('device_id', deviceId);
                        if (error) throw error;
                        console.log('[AutoBackup] Backup en tiempo real completado.');
                    } catch (error) {
                        console.error('[AutoBackup] Error resolviendo solicitud remota:', error);
                    } finally {
                        requestInFlight = false;
                    }
                }
            })
            .subscribe();

        return () => {
            if (channel) {
                supabaseCloud.removeChannel(channel).catch(() => {});
            }
        };
    }, [deviceId, isPremium]);
}

// Restaurar desde backup local (para emergencias)
export async function restoreFromBackup() {
    const backup = await storageService.getItem('bodega_autobackup_v1', null);
    if (!backup?.data) return null;

    if (backup.version === '2.0' && backup.data.idb) {
        for (const [key, val] of Object.entries(backup.data.idb)) {
            await storageService.setItem(key, val);
        }
        if (backup.data.ls) {
            for (const [key, val] of Object.entries(backup.data.ls)) {
                localStorage.setItem(key, val);
            }
        }
        return {
            restoredKeys: [...Object.keys(backup.data.idb), ...Object.keys(backup.data.ls)],
            backupTime: new Date(backup.timestamp).toLocaleString('es-VE'),
        };
    }

    // Fallback formato legacy
    for (const [key, val] of Object.entries(backup.data)) {
        await storageService.setItem(key, val);
    }
    return {
        restoredKeys: Object.keys(backup.data),
        backupTime: new Date(backup.timestamp).toLocaleString('es-VE'),
    };
}
