import { useEffect } from 'react';
import { supabase } from '../core/supabaseClient';

const PRODUCT_ID = 'bodega';

/**
 * Hook that handles heartbeat sending, license status verification,
 * and real-time subscription for license changes.
 *
 * SEC-001/SEC-007: Ya NO minteamos tokens XOR legacy en localStorage.
 * La fuente de verdad es la fila `licenses` en el servidor. Solo actualizamos
 * el estado React (via callbacks) cuando el backend confirma el cambio.
 */
export function useLicenseMonitoring({
    deviceId,
    isPremium,
    isDemo,
    onRevoked,
    onPermanentActivated,
    onDemoActivated,
}) {
    useEffect(() => {
        if (!deviceId || !import.meta.env.VITE_SUPABASE_URL) return;

        const verifyStatus = async () => {
            try {
                const { data: license, error } = await supabase
                    .from('licenses')
                    .select('type, active, expires_at')
                    .eq('device_id', deviceId)
                    .eq('product_id', PRODUCT_ID)
                    .maybeSingle();

                if (license && (license.active === false || license.type === 'revoked') && isPremium) {
                    localStorage.removeItem('pda_premium_token');
                    onRevoked("Tu licencia ha sido desactivada. Contacta al administrador.");
                } else if (license && license.active === true) {
                    // Verificar si demo venció por fecha
                    if ((license.type === 'demo7' || license.type === 'demo3') && license.expires_at) {
                        const expiresAt = new Date(license.expires_at).getTime();
                        if (Date.now() >= expiresAt && isPremium) {
                            localStorage.removeItem('pda_premium_token');
                            onRevoked("Tu licencia temporal ha finalizado. Esperamos que hayas disfrutado la experiencia completa.");
                            return;
                        }
                    }

                    // Si el backend cambió el tipo de licencia, actualizar estado local.
                    // SEC-001: NO creamos tokens XOR; solo actualizamos estado React.
                    if (license.type === 'permanent' && (!isPremium || isDemo)) {
                        onPermanentActivated();
                    } else if ((license.type === 'demo7' || license.type === 'demo3') && (!isPremium || !isDemo) && license.expires_at) {
                        const expiresAt = new Date(license.expires_at).getTime();
                        if (Date.now() < expiresAt) {
                            onDemoActivated(expiresAt);
                        }
                    }
                }
            } catch (e) {
                if (import.meta.env?.DEV) {
                    console.warn('[LicenseMonitoring] verifyStatus falló:', e?.message ?? e);
                }
            }
        };

        const sendHeartbeat = async () => {
            verifyStatus();
            try {
                const clientName = localStorage.getItem('business_name') || localStorage.getItem('restaurant_name') || '';
                await supabase.rpc('heartbeat_device', { p_device_id: deviceId, p_product_id: PRODUCT_ID, p_client_name: clientName });
            } catch (e) {
                if (import.meta.env?.DEV) {
                    console.warn('[LicenseMonitoring] heartbeat falló:', e?.message ?? e);
                }
            }
        };

        sendHeartbeat();
        const heartbeatInterval = setInterval(sendHeartbeat, 4 * 60 * 60 * 1000);

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') verifyStatus();
        };
        document.addEventListener('visibilitychange', handleVisibility);

        let subscription = null;
        try {
            subscription = supabase
                .channel(`licenses_sync_${deviceId}`)
                .on('postgres_changes', {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'licenses',
                    filter: `device_id=eq.${deviceId}`,
                }, () => {
                    verifyStatus();
                })
                .subscribe();
        } catch (e) {
            if (import.meta.env?.DEV) {
                console.warn('[LicenseMonitoring] suscripción Realtime falló:', e?.message ?? e);
            }
        }

        return () => {
            clearInterval(heartbeatInterval);
            document.removeEventListener('visibilitychange', handleVisibility);
            if (subscription) subscription.unsubscribe();
        };
    }, [isPremium, isDemo, deviceId]);
}
