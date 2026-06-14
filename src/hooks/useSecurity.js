import { useState, useEffect, useCallback, useRef } from 'react';
import { storageService } from '../utils/storageService';
import { supabase } from '../core/supabaseClient';
import { encodeToken, decodeToken, verifyLicenseToken } from '../security/tokenCrypto';
import { generateFingerprint } from '../security/deviceFingerprint';
import { useLicenseMonitoring } from './useLicenseMonitoring';
import { useDemoCountdown } from './useDemoCountdown';

const APP_VERSION = '1.0.0';
const PRODUCT_ID = 'bodega';

const DEMO_DURATION_MS = 72 * 60 * 60 * 1000; // 72 horas (3 dias)

export function useSecurity() {
    const [deviceId, setDeviceId] = useState('');
    const [isPremium, setIsPremium] = useState(false);
    const [loading, setLoading] = useState(true);
    const [isDemo, setIsDemo] = useState(false);
    const [demoExpires, setDemoExpires] = useState(null);
    // FIX 3: demoUsed como estado, leido desde IndexedDB
    const [demoUsed, setDemoUsed] = useState(false);
    const [integrityWarning, setIntegrityWarning] = useState(false);
    const lastIntegrityCheckRef = useRef(0);

    // Demo countdown hook
    const {
        demoTimeLeft,
        demoExpiredMsg,
        setDemoExpiredMsg,
        dismissExpiredMsg,
    } = useDemoCountdown({
        isDemo,
        demoExpiresAt: demoExpires,
        onExpired: () => {
            setIsPremium(false);
            setIsDemo(false);
        },
    });

    // License monitoring hook
    useLicenseMonitoring({
        deviceId,
        isPremium,
        isDemo,
        onRevoked: (msg) => {
            setIsPremium(false);
            setIsDemo(false);
            setDemoExpiredMsg(msg);
            setLoading(false);
        },
        onPermanentActivated: () => {
            setIsPremium(true);
            setIsDemo(false);
            setDemoExpires(null);
        },
        onDemoActivated: (expiresAt) => {
            setIsPremium(true);
            setIsDemo(true);
            setDemoExpires(expiresAt);
        },
    });

    useEffect(() => {
        const initDeviceId = async () => {
            let storedId = localStorage.getItem('pda_device_id');
            if (!storedId) {
                storedId = await generateFingerprint();
                localStorage.setItem('pda_device_id', storedId);
            }
            setDeviceId(storedId);

            // Auto-registro: registrar dispositivo si no existe (sin importar licencia)
            try {
                if (import.meta.env.VITE_SUPABASE_URL) {
                    const clientName = localStorage.getItem('business_name') || localStorage.getItem('restaurant_name') || '';
                    await supabase.rpc('auto_register_device', { p_device_id: storedId, p_product_id: PRODUCT_ID, p_client_name: clientName });
                }
            } catch (e) { /* silencioso */ }

            checkLicense(storedId);
        };

        initDeviceId();

        // FIX 3: Leer demo flag desde IndexedDB
        storageService.getItem('pda_demo_flag_v1', null).then(r => {
            if (r?.used) setDemoUsed(true);
        });
    }, []);

    // FIX 4: Integrity check periodico cada 30 minutos
    useEffect(() => {
        if (!deviceId) return;
        const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown between checks

        const interval = setInterval(async () => {
            // Cooldown: skip if less than 5 minutes since last check
            const now = Date.now();
            if (now - lastIntegrityCheckRef.current < COOLDOWN_MS) return;
            lastIntegrityCheckRef.current = now;

            const raw = localStorage.getItem('pda_premium_token');

            // Si localStorage fue borrado, intentar restaurar desde servidor
            if (!raw) {
                try {
                    const { data: remoteLicense } = await supabase
                        .from('licenses')
                        .select('type, active, expires_at')
                        .eq('device_id', deviceId)
                        .eq('product_id', PRODUCT_ID)
                        .maybeSingle();

                    if (remoteLicense?.active === true) {
                        // Restaurar desde servidor — re-run license check instead of reload
                        console.warn('[Security] Token missing but license active on server. Re-checking license.');
                        setIntegrityWarning(true);
                        checkLicense(deviceId);
                        return;
                    }
                } catch { }
                // Si no hay licencia activa en servidor y estaba premium -> revocar
                if (isPremium) {
                    console.warn('[Security] Token missing and no active server license. Revoking premium.');
                    setIsPremium(false);
                    setIsDemo(false);
                    setIntegrityWarning(true);
                }
                return;
            }

            // Verificar integridad del token almacenado
            if (raw) {
                try {
                    let obj = null;
                    if (raw.includes('.')) {
                        const { valid, payload } = await verifyLicenseToken(raw);
                        if (valid) obj = payload;
                    } else {
                        const token = decodeToken(raw);
                        obj = JSON.parse(token);
                    }

                    if (obj) {
                        // Si es demo y ya expiro
                        if ((obj.type === 'demo7' || obj.type === 'demo3') && obj.expires && Date.now() >= obj.expires) {
                            localStorage.removeItem('pda_premium_token');
                            setIsPremium(false);
                            setIsDemo(false);
                            setDemoExpiredMsg("Tu licencia temporal ha finalizado. Esperamos que hayas disfrutado la experiencia completa.");
                            console.warn('[Security] Demo token expired during integrity check.');
                        }
                    } else {
                        throw new Error('Invalid token structure');
                    }
                } catch {
                    // Token corrupto -> verificar contra servidor
                    if (isPremium) {
                        localStorage.removeItem('pda_premium_token');
                        setIsPremium(false);
                        setIsDemo(false);
                        setIntegrityWarning(true);
                        console.warn('[Security] Corrupt token detected. Revoking premium state.');
                    }
                }
            }
        }, 30 * 60 * 1000); // 30 minutos

        return () => clearInterval(interval);
    }, [deviceId, isPremium]);

        const checkLicense = async (currentDeviceId) => {
        const rawStored = localStorage.getItem('pda_premium_token');
        let tokenObj = null;

        if (rawStored) {
            if (rawStored.includes('.')) {
                // Formato criptográfico firmado
                const { valid, payload } = await verifyLicenseToken(rawStored);
                if (valid) tokenObj = payload;
            } else {
                // Formato legacy
                const storedToken = decodeToken(rawStored);
                try {
                    tokenObj = JSON.parse(storedToken);
                } catch { }
            }
        }

        if (!tokenObj) {
            // Fallback: verificar si existe licencia activa en Supabase (ej: reactivada remotamente)
            try {
                const { data: remoteLicense, error } = await supabase
                    .from('licenses')
                    .select('type, active, expires_at, code')
                    .eq('device_id', currentDeviceId)
                    .eq('product_id', PRODUCT_ID)
                    .maybeSingle();

                if (remoteLicense && remoteLicense.active === true) {
                    const isTimeLimited = (remoteLicense.type === 'demo7' || remoteLicense.type === 'demo3');
                    const expiresAt = remoteLicense.expires_at ? new Date(remoteLicense.expires_at).getTime() : null;

                    if (isTimeLimited && expiresAt) {
                        if (Date.now() < expiresAt) {
                            const token = { deviceId: currentDeviceId, type: remoteLicense.type, expires: expiresAt, isDemo: true };
                            localStorage.setItem('pda_premium_token', encodeToken(JSON.stringify(token)));
                            setIsPremium(true);
                            setIsDemo(true);
                            setDemoExpires(expiresAt);
                        }
                    } else if (remoteLicense.type === 'permanent') {
                        // Permanente — restaurar token con datos del servidor
                        const token = { deviceId: currentDeviceId, type: 'permanent', code: remoteLicense.code };
                        localStorage.setItem('pda_premium_token', encodeToken(JSON.stringify(token)));
                        setIsPremium(true);
                        setIsDemo(false);
                    }
                    setLoading(false);
                    return;
                }
            } catch (e) {
                // Sin red — no se puede restaurar
            }

            setIsPremium(false);
            setLoading(false);
            return;
        }

        let isPremiumConfirmed = false;
        let confirmedDemo = false;
        let confirmedExpires = null;

        try {
            if (tokenObj && tokenObj.deviceId === currentDeviceId) {
                // Token belongs to this device
                const isTimeLimited = tokenObj.type === 'demo7' || tokenObj.type === 'demo3' || tokenObj.isDemo; // retrocompatibilidad
                // Verificar estado remoto antes de confiar en el token local
                let revokedRemotely = false;
                try {
                    const { data: remoteLicense } = await supabase
                        .from('licenses')
                        .select('active, expires_at')
                        .eq('device_id', currentDeviceId)
                        .eq('product_id', PRODUCT_ID)
                        .maybeSingle();

                    if (remoteLicense && remoteLicense.active === false) {
                        revokedRemotely = true;
                    }
                } catch (e) { /* Sin red -> confiar en token local */ }

                if (revokedRemotely) {
                    localStorage.removeItem('pda_premium_token');
                    setIsPremium(false);
                    setIsDemo(false);
                    setDemoExpiredMsg("Tu licencia ha sido desactivada por el administrador.");
                    setLoading(false);
                    return;
                }

                if (isTimeLimited) {
                    if (Date.now() < tokenObj.expires) {
                        setIsPremium(true);
                        setIsDemo(true);
                        setDemoExpires(tokenObj.expires);
                        isPremiumConfirmed = true;
                        confirmedDemo = true;
                        confirmedExpires = tokenObj.expires;
                    } else {
                        console.warn("Demo Expirada");
                        localStorage.removeItem('pda_premium_token');
                        setIsPremium(false);
                        setIsDemo(false);
                        setDemoExpiredMsg("Tu licencia temporal ha finalizado. Esperamos que hayas disfrutado la experiencia completa.");
                    }
                } else {
                    // Permanente
                    setIsPremium(true);
                    setIsDemo(false);
                    isPremiumConfirmed = true;
                }
            } else {
                setIsPremium(false);
            }
        } catch (e) {
            // Unparseable token or old string format (Lifetime License legacy)
            setIsPremium(false);
        }

        // FIX 5: Guardar backup en sessionStorage si licencia valida
        if (isPremiumConfirmed) {
            try {
                sessionStorage.setItem(
                    '_pda_s',
                    encodeToken('VALID_SESSION:' + currentDeviceId)
                );
            } catch { }
        }

        // Migracion silenciosa: asegurar registro en Supabase via RPC seguro
        if (isPremiumConfirmed) {
            const migrateToSupabase = async () => {
                try {
                    // Registrar dispositivo si no existe (RPC seguro, no INSERT directo)
                    const clientName = localStorage.getItem('business_name') || localStorage.getItem('restaurant_name') || '';
                    await supabase.rpc('auto_register_device', {
                        p_device_id: currentDeviceId,
                        p_product_id: PRODUCT_ID,
                        p_client_name: clientName
                    });
                    // Enviar heartbeat para actualizar last_seen
                    await supabase.rpc('heartbeat_device', {
                        p_device_id: currentDeviceId,
                        p_product_id: PRODUCT_ID,
                        p_client_name: clientName
                    });
                } catch (e) {
                    // Silencioso — nunca afecta la app
                }
            }

            migrateToSupabase()  // llamar sin await para no bloquear
        }

        setLoading(false);
    };

    /**
     * Activa la demo de 7 dias sin necesidad de codigo.
     * Solo puede usarse UNA VEZ por dispositivo.
     */
    const activateDemo = async () => {
        // FIX 3: Verificar demo en IndexedDB (local)
        const demoRecord = await storageService.getItem('pda_demo_flag_v1', null);
        if (demoRecord?.used) {
            return { success: false, status: 'DEMO_USED' };
        }

        const currentDeviceId = deviceId || localStorage.getItem('pda_device_id');

        // Verificar en servidor (por si borraron IndexedDB)
        try {
            const { data: existingDemo } = await supabase
                .from('licenses')
                .select('id, type')
                .eq('device_id', currentDeviceId)
                .eq('product_id', PRODUCT_ID)
                .neq('type', 'registered')
                .maybeSingle();

            if (existingDemo) {
                await storageService.setItem('pda_demo_flag_v1', {
                    used: true,
                    ts: Date.now(),
                    deviceId: currentDeviceId,
                });
                return { success: false, status: 'DEMO_USED' };
            }
        } catch (e) {
            // Sin red -> solo validar local
        }

        const expires = Date.now() + DEMO_DURATION_MS;
        const demoToken = {
            deviceId: currentDeviceId,
            type: 'demo3',
            expires: expires,
        };

        // FIX 2: Guardar token ofuscado
        localStorage.setItem('pda_premium_token', encodeToken(JSON.stringify(demoToken)));

        // FIX 3: Guardar flag en IndexedDB
        await storageService.setItem('pda_demo_flag_v1', {
            used: true,
            ts: Date.now(),
            deviceId: currentDeviceId,
        });

        setIsPremium(true);
        setIsDemo(true);
        setDemoExpires(expires);
        setDemoUsed(true);

        // Reportar demo a Supabase via RPC seguro (silencioso)
        try {
            await supabase.rpc('activate_demo_secure', {
                p_device_id: currentDeviceId,
                p_product_id: PRODUCT_ID
            });
        } catch (e) {
            // Nunca bloquear si falla la red
        }

        return { success: true, status: 'DEMO_ACTIVATED' };
    };

    /**
     * Desbloquea con codigo de activacion.
     * Consulta Supabase para determinar si es permanente o temporal (7/30 dias).
     */
    const unlockApp = async (inputCode) => {
        try {
            const cleanCode = (inputCode || "").trim().toUpperCase().replace(/O/g, '0');
            // FIX: Validar el codigo directamente contra la base de datos para ignorar fallos de Edge Functions
            const { data: license, error } = await supabase
                .from('licenses')
                .select('type, active, expires_at, code')
                .eq('device_id', deviceId)
                .eq('product_id', PRODUCT_ID)
                .maybeSingle();

            if (error || !license || license.code !== cleanCode) {
                return { success: false, status: 'INVALID_CODE' };
            }

            const { type, active, expires_at } = license;

            if (!active) {
                return { success: false, status: 'LICENSE_REVOKED' };
            }

            const isTimeLimited = (type === 'demo7' || type === 'demo3');
            let expiresAt = expires_at ? new Date(expires_at).getTime() : null;

            if (isTimeLimited) {
                if (!expiresAt) {
                    expiresAt = Date.now() + 72 * 60 * 60 * 1000;
                    try {
                        supabase.from('licenses').update({ expires_at: new Date(expiresAt).toISOString() })
                            .eq('device_id', deviceId).eq('product_id', PRODUCT_ID).then();
                    } catch (e) { }
                }

                const token = { deviceId, code: inputCode, type, expires: expiresAt };
                localStorage.setItem('pda_premium_token', encodeToken(JSON.stringify(token)));
                setIsPremium(true);
                setIsDemo(true);
                setDemoExpires(expiresAt);
                return { success: true, status: 'PREMIUM_ACTIVATED' };
            }

            // Permanente
            const token = { deviceId, code: inputCode, type: 'permanent' };
            localStorage.setItem('pda_premium_token', encodeToken(JSON.stringify(token)));
            setIsPremium(true);
            setIsDemo(false);
            return { success: true, status: 'PREMIUM_ACTIVATED' };

        } catch (err) {
            console.error('Error validating license:', err);
            return { success: false, status: 'SERVER_ERROR' };
        }
    };

    const generateCodeForClient = async () => null;

    /**
     * Fuerza un heartbeat manual para sincronizar cambios como el nombre del negocio de inmediato.
     */
    const forceHeartbeat = async () => {
        const clientName = localStorage.getItem('business_name') || localStorage.getItem('restaurant_name') || '';
        try {
            await supabase.rpc('heartbeat_device', {
                p_device_id: deviceId || localStorage.getItem('pda_device_id'),
                p_product_id: PRODUCT_ID,
                p_client_name: clientName
            });
        } catch(e) {
            console.error('Error forcing heartbeat:', e);
        }
    };

    return {
        deviceId,
        isPremium,
        loading,
        unlockApp,
        activateDemo,
        generateCodeForClient,
        isDemo,
        demoExpires,
        demoTimeLeft,
        demoExpiredMsg,
        dismissExpiredMsg: () => setDemoExpiredMsg(''),
        // FIX 3: demoUsed desde estado (IndexedDB)
        demoUsed,
        forceHeartbeat,
        integrityWarning,
        dismissIntegrityWarning: () => setIntegrityWarning(false),
    };
}
