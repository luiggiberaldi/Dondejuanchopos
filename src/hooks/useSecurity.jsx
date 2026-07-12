import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { storageService } from '../utils/storageService';
import { supabase } from '../core/supabaseClient';
import { verifyLicenseToken } from '../security/tokenCrypto';
import { generateFingerprint, verifyStoredFingerprint } from '../security/deviceFingerprint';
import { useLicenseMonitoring } from './useLicenseMonitoring';
import { useDemoCountdown } from './useDemoCountdown';
import { LICENSE_POLICY } from '../utils/securityConstants';

const APP_VERSION = '1.0.0';
const PRODUCT_ID = 'bodega';

const DEMO_DURATION_MS = 72 * 60 * 60 * 1000; // 72 horas (3 dias)

// Helper seguro para obtener el estado de la licencia respetando RLS o haciendo fallback
async function _fetchRemoteLicense(currentDeviceId) {
    try {
        const { data, error } = await supabase.rpc('get_license_status', { p_device_id: currentDeviceId });
        if (!error && data) {
            const record = Array.isArray(data) ? data[0] : data;
            if (record) {
                return { data: record, error: null };
            }
        }
    } catch (e) {
        // Silencioso
    }
    return supabase
        .from('licenses')
        .select('type, is_active, expires_at, created_at')
        .eq('device_id', currentDeviceId)
        .eq('product_id', PRODUCT_ID)
        .maybeSingle();
}

// SEC-022 / INFRA-011: Security headers (CSP, X-Frame-Options, X-Content-Type-Options,
// Referrer-Policy) deben configurarse en el servidor que sirve el build (Cloudflare
// Worker, Vercel o index.html <meta http-equiv>). No se pueden aplicar correctamente
// desde el bundle. Ver ISSUES.md SEC-022 / INFRA-011 — pendiente para Agente D.

// HOOK: useSecurity() lee de un Context compartido (SecurityProvider) en vez de
// correr su propio ciclo de estado por cada componente que lo consume.
function useSecurityState() {
    const [deviceId, setDeviceId] = useState('');

    useEffect(() => {
        const initDeviceId = async () => {
            let storedId = localStorage.getItem('dj_device_id');
            if (!storedId) {
                try {
                    const currentFp = await generateFingerprint();
                    storedId = currentFp;
                    localStorage.setItem('dj_device_id', storedId);
                } catch (e) {
                    storedId = 'dj-device-fallback-' + Math.random().toString(36).substring(2, 9);
                    localStorage.setItem('dj_device_id', storedId);
                }
            }
            setDeviceId(storedId);
        };
        initDeviceId();
    }, []);

    const unlockApp = async () => ({ success: true, status: 'PREMIUM_ACTIVATED' });
    const activateDemo = async () => ({ success: false, status: 'DEMO_USED' });
    const generateCodeForClient = async () => null;
    const forceHeartbeat = async () => {};

    return {
        deviceId,
        isPremium: true,
        loading: false,
        unlockApp,
        activateDemo,
        generateCodeForClient,
        isDemo: false,
        demoExpires: null,
        demoTimeLeft: '',
        demoExpiredMsg: '',
        dismissExpiredMsg: () => {},
        demoUsed: true,
        forceHeartbeat,
        integrityWarning: false,
        dismissIntegrityWarning: () => {},
        isMonthlyGracePeriod: false,
        monthlyGraceDaysLeft: 0,
    };
}

const SecurityContext = createContext(null);

export function SecurityProvider({ children }) {
    const value = useSecurityState();
    return <SecurityContext.Provider value={value}>{children}</SecurityContext.Provider>;
}

export function useSecurity() {
    const ctx = useContext(SecurityContext);
    if (!ctx) throw new Error('useSecurity debe usarse dentro de un SecurityProvider');
    return ctx;
}
