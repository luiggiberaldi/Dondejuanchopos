import { useEffect, useState } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { detectDeviceInfo } from '../utils/deviceInfo';

/**
 * Nombre de ESTE dispositivo vinculado (device_monitors.device_label), que es el
 * que firma sus mensajes del intercomunicador. Al montar:
 *   1. reporta sistema/modelo a la nube (report_monitor_device_info), y
 *   2. lee su nombre actual con list_monitors (pudo cambiarlo otro supervisor).
 * Se cachea en localStorage para tenerlo disponible al instante en el próximo arranque.
 */
export const OWN_LABEL_KEY = 'dj_device_label';
const LABEL_EVENT = 'dj-device-label-changed';

function readCachedLabel() {
    try { return localStorage.getItem(OWN_LABEL_KEY) || ''; } catch { return ''; }
}

/** Guarda el nombre propio y avisa a los componentes montados. */
export function setOwnDeviceLabel(label) {
    try { localStorage.setItem(OWN_LABEL_KEY, label || ''); } catch { /* almacenamiento no disponible */ }
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LABEL_EVENT, { detail: label || '' }));
}

export function useOwnDeviceLabel(deviceId) {
    const [label, setLabel] = useState(readCachedLabel);

    useEffect(() => {
        const onChange = event => setLabel(event.detail || '');
        window.addEventListener(LABEL_EVENT, onChange);
        return () => window.removeEventListener(LABEL_EVENT, onChange);
    }, []);

    useEffect(() => {
        if (!supabaseCloud || !deviceId) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const info = await detectDeviceInfo();
                await supabaseCloud.rpc('report_monitor_device_info', {
                    p_monitor_device_id: deviceId,
                    p_platform: info.platform,
                    p_model: info.model,
                    p_user_agent: info.userAgent,
                });
            } catch { /* la RPC puede no existir aún: no bloquea nada */ }
            try {
                const { data } = await supabaseCloud.rpc('list_monitors', { p_requester_id: deviceId });
                const self = data?.success ? (data.devices || []).find(d => d.monitor_device_id === deviceId) : null;
                if (!cancelled && self?.device_label) setOwnDeviceLabel(self.device_label);
            } catch { /* sin red: queda el nombre en caché */ }
        })();
        return () => { cancelled = true; };
    }, [deviceId]);

    return label;
}
