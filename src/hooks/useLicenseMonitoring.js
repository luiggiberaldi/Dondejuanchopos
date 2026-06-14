import { useEffect } from 'react';
import { supabase } from '../core/supabaseClient';
import { encodeToken } from '../security/tokenCrypto';

const PRODUCT_ID = 'bodega';

/**
 * Hook that handles heartbeat sending, license status verification,
 * and real-time subscription for license changes.
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

        // Funcion de chequeo rapido de estado
        const verifyStatus = async () => {
            try {
                const { data: license, error } = await supabase
                    .from('licenses')
                    .select('type, active, expires_at')
                    .eq('device_id', deviceId)
                    .eq('product_id', PRODUCT_ID)
                    .maybeSingle();

                if (license && (license.active === false || license.type === 'revoked') && isPremium) {
                    // Revocado
                    localStorage.removeItem('pda_premium_token');
                    onRevoked("Tu licencia ha sido desactivada. Contacta al administrador.");
                } else if (license && license.active === true) {
                    // Verificar si demo vencio por fecha
                    if ((license.type === 'demo7' || license.type === 'demo3') && license.expires_at) {
                        const expiresAt = new Date(license.expires_at).getTime();
                        if (Date.now() >= expiresAt && isPremium) {
                            localStorage.removeItem('pda_premium_token');
                            onRevoked("Tu licencia temporal ha finalizado. Esperamos que hayas disfrutado la experiencia completa.");
                            return;
                        }
                    }

                    // Si el backend cambio el tipo de licencia, actualizar estado local sin recargar
                    if (license.type === 'permanent' && (!isPremium || isDemo)) {
                        // Demo (o Expirado) -> Permanente: actualizar token y estado
                        const token = { deviceId, type: 'permanent' };
                        localStorage.setItem('pda_premium_token', encodeToken(JSON.stringify(token)));
                        onPermanentActivated();
                    } else if ((license.type === 'demo7' || license.type === 'demo3') && (!isPremium || !isDemo) && license.expires_at) {
                        // Permanente (o Expirado) -> Demo: actualizar token y estado
                        const expiresAt = new Date(license.expires_at).getTime();
                        if (Date.now() < expiresAt) {
                            const token = { deviceId, type: license.type, expires: expiresAt, isDemo: true };
                            localStorage.setItem('pda_premium_token', encodeToken(JSON.stringify(token)));
                            onDemoActivated(expiresAt);
                        }
                    }
                }
            } catch (e) { }
        };

        const sendHeartbeat = async () => {
            verifyStatus();
            try {
                const clientName = localStorage.getItem('business_name') || localStorage.getItem('restaurant_name') || '';
                await supabase.rpc('heartbeat_device', { p_device_id: deviceId, p_product_id: PRODUCT_ID, p_client_name: clientName });
            } catch (e) { }
        };

        // 1. Ejecutar heartbeat al montar y cada 4 horas
        sendHeartbeat();
        const heartbeatInterval = setInterval(sendHeartbeat, 4 * 60 * 60 * 1000);

        // 2. Revisar apenas el usuario regrese a la app
        // (El polling de 60s fue eliminado — el Realtime cubre las revocaciones instantáneas)
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') verifyStatus();
        };
        document.addEventListener('visibilitychange', handleVisibility);

        // 3. Supabase Realtime para detección instantánea de revocaciones
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
        } catch (e) { }

        return () => {
            clearInterval(heartbeatInterval);
            document.removeEventListener('visibilitychange', handleVisibility);
            if (subscription) subscription.unsubscribe();
        };
    }, [isPremium, isDemo, deviceId]);
}
