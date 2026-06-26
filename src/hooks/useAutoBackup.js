import { useEffect, useRef } from 'react';
import { storageService } from '../utils/storageService';
import { supabaseCloud } from '../config/supabaseCloud';
import { IDB_KEYS, LS_KEYS } from '../config/backupKeys';

// ─── Configuración optimizada ───────────────────────────────────────────────
const BACKUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos
const BACKUP_KEY = 'bodega_autobackup_v1';
const LAST_UPLOAD_HASH_KEY = 'bodega_last_upload_hash';

/** Hash ligero para detectar cambios sin comparar objetos enteros */
function quickHash(obj) {
    const str = JSON.stringify(obj) ?? '';
    let h = 0;
    for (let i = 0; i < Math.min(str.length, 5000); i++) {
        h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return `${str.length}_${h >>> 0}`;
}

export function useAutoBackup(isPremium, isDemo, deviceId) {
    const intervalRef = useRef(null);
    const initialTimerRef = useRef(null);
    // Ref para que el handler de Realtime pueda llamar a performBackup
    const performBackupRef = useRef(null);

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
            const { isPremium: premium, isDemo: demo, deviceId: devId } = configRef.current;
            try {
                // ── Recolectar IndexedDB ────────────────────────────────
                const idbData = {};
                let hasData = false;
                for (const key of IDB_KEYS) {
                    const val = await storageService.getItem(key, null);
                    if (val !== null) { idbData[key] = val; hasData = true; }
                }

                if (!hasData) return;

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
                    appName: 'TasasAlDia_Bodegas',
                    device: navigator.userAgent?.substring(0, 80),
                    data: { idb: idbData, ls: lsData }
                };

                // Guardar copia local
                await storageService.setItem(BACKUP_KEY, fullBackup);

                // Subir a la nube (usar configRef, no props directas — HOOK-043)
                if (premium && !demo && devId && supabaseCloud) {
                    const currentHash = quickHash(idbData);
                    const lastHash = localStorage.getItem(LAST_UPLOAD_HASH_KEY);

                    // forceUpload=true omite la verificación de hash (solicitud manual)
                    if (!forceUpload && currentHash === lastHash) return;

                    const { data: { session } } = await supabaseCloud.auth.getSession().catch(() => ({ data: {} }));
                    if (!session) return; // Evitar peticiones si no hay sesión activa (401)
                    // Evitar peticiones con token ya expirado
                    if (session.expires_at && session.expires_at * 1000 < Date.now()) return;

                    await supabaseCloud.from('cloud_backups').upsert({
                        device_id: devId,
                        backup_data: fullBackup,
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'device_id' });

                    localStorage.setItem(LAST_UPLOAD_HASH_KEY, currentHash);
                }

            } catch (e) {
                console.error('[AutoBackup] Error:', e);
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
        };
        // HOOK-043: deps vacíos — el intervalo se monta una sola vez por app lifetime.
        // `configRef` mantiene los valores actuales sin re-crear el effect.
    }, []);

    // ── Suscripción a solicitudes de backup en tiempo real ─────────────────
    useEffect(() => {
        if (!deviceId || !supabaseCloud) return;

        let channel = null;

        supabaseCloud.auth.getSession().then(({ data: { session } }) => {
            if (!session) return;

            channel = supabaseCloud
                .channel(`backup_request_${deviceId}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'backup_requests',
                    filter: `device_id=eq.${deviceId}`
                }, async (payload) => {
                    if (payload.new?.status === 'pending') {
                        console.log('[AutoBackup] Solicitud de backup recibida. Ejecutando...');
                        await performBackupRef.current?.(true); // forzar subida
                        await supabaseCloud.from('backup_requests').update({
                            status: 'completed',
                            completed_at: new Date().toISOString()
                        }).eq('device_id', deviceId);
                        console.log('[AutoBackup] Backup en tiempo real completado.');
                    }
                })
                .subscribe();
        }).catch(() => {});

        return () => {
            if (channel) {
                supabaseCloud.removeChannel(channel).catch(() => {});
            }
        };
    }, [deviceId]);
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
