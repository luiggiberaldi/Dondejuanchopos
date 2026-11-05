/**
 * deviceInfo.js — sistema operativo y modelo del dispositivo.
 *
 * Chrome reduce el user agent ("Android 10; K"), así que el modelo real sólo se
 * obtiene con `navigator.userAgentData.getHighEntropyValues` (Chromium). En iPhone
 * y Firefox no existe: se usa lo que diga el user agent.
 */

/** Plataforma y versión a partir de un user agent. */
export function parseUserAgent(userAgent = '') {
    const ua = String(userAgent || '');
    let match;
    if ((match = ua.match(/Android\s([\d.]+)?;\s*([^;)]+)?/i))) {
        const model = (match[2] || '').replace(/\sBuild\/.*/i, '').trim();
        return {
            platform: 'Android',
            version: match[1] || '',
            // "K" es el modelo genérico del user agent reducido: no aporta nada.
            model: model && model !== 'K' ? model : '',
        };
    }
    if (/iPad/i.test(ua)) return { platform: 'iPadOS', version: (ua.match(/OS (\d+)[_\d]*/i) || [])[1] || '', model: 'iPad' };
    if (/iPhone/i.test(ua)) return { platform: 'iOS', version: (ua.match(/OS (\d+)[_\d]*/i) || [])[1] || '', model: 'iPhone' };
    if (/Windows NT/i.test(ua)) return { platform: 'Windows', version: '', model: '' };
    if (/Mac OS X|Macintosh/i.test(ua)) return { platform: 'macOS', version: '', model: '' };
    if (/CrOS/i.test(ua)) return { platform: 'ChromeOS', version: '', model: '' };
    if (/Linux/i.test(ua)) return { platform: 'Linux', version: '', model: '' };
    return { platform: '', version: '', model: '' };
}

/** Detecta sistema y modelo del dispositivo actual (para reportarlo a la nube). */
export async function detectDeviceInfo(nav = typeof navigator !== 'undefined' ? navigator : undefined) {
    const userAgent = String(nav?.userAgent || '').slice(0, 200);
    const parsed = parseUserAgent(userAgent);
    let { platform, version, model } = parsed;

    const uaData = nav?.userAgentData;
    if (uaData?.getHighEntropyValues) {
        try {
            const hints = await uaData.getHighEntropyValues(['model', 'platformVersion']);
            if (hints.model) model = hints.model;
            if (hints.platform) platform = hints.platform === 'macOS' ? 'macOS' : hints.platform;
            if (platform === 'Windows' && hints.platformVersion) {
                // platformVersion >= 13 → Windows 11; 1–10 → Windows 10.
                const major = Number(String(hints.platformVersion).split('.')[0]);
                version = major >= 13 ? '11' : major > 0 ? '10' : '';
            } else if (platform === 'Android' && hints.platformVersion) {
                version = String(hints.platformVersion).split('.')[0];
            }
        } catch {
            /* sin client hints: queda lo del user agent */
        }
    }

    return {
        platform: [platform, version].filter(Boolean).join(' '),
        model,
        userAgent,
    };
}

/** Tipo de icono a mostrar. */
export function platformKind(platformText = '') {
    const p = String(platformText).toLowerCase();
    if (p.startsWith('android')) return 'android';
    if (p.startsWith('ios') || p.startsWith('ipados')) return 'ios';
    if (p.startsWith('windows')) return 'windows';
    if (p.startsWith('macos')) return 'mac';
    if (p.startsWith('linux') || p.startsWith('chromeos')) return 'desktop';
    return 'other';
}

/**
 * Datos para mostrar de un dispositivo de `list_monitors`. Usa las columnas
 * reportadas (`device_platform`, `device_model`) y, si faltan —equipos que aún no
 * abrieron la versión nueva—, lo que se pueda deducir del `user_agent` guardado.
 */
export function describeDevice(device = {}) {
    const fallback = parseUserAgent(device.user_agent);
    const platform = device.device_platform || [fallback.platform, fallback.version].filter(Boolean).join(' ');
    const model = device.device_model || fallback.model;
    return {
        platform,
        model,
        kind: platformKind(platform),
        summary: [platform, model].filter(Boolean).join(' · '),
    };
}

export const DEFAULT_MONITOR_LABEL = 'Supervisor Remoto';
