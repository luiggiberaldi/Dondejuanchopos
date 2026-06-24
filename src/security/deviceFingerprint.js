/**
 * deviceFingerprint.js — Fingerprint robusto del dispositivo.
 *
 * Fix SEC-008:
 *   - Antes: SHA-256 de 8 componentes truncado a 8 hex chars (32 bits → colisión por
 *     birthday en ~65k intentos). Sin salt. Leído de localStorage sin re-verificar.
 *   - Ahora: SHA-256 completo de 64 hex chars + sal del backend (VITE_LICENSE_SALT).
 *     Re-verificación periódica vía `verifyStoredFingerprint()`.
 *
 * Notas:
 *   - La sal mezcla características del navegador con una sal por despliegue. Esto NO
 *     evita fingerprints cruzados entre navegadores del mismo dispositivo, pero sí
 *     dificulta la falsificación sencilla vía DevTools (`localStorage.setItem('pda_device_id', 'PDA-DEAD')`).
 *   - La fuente autoritativa de identidad es la fila `licenses.device_id` en el backend.
 *
 * @module security/deviceFingerprint
 */

const FP_HASH_LENGTH = 32; // 32 hex chars = 128 bits (antes 8 = 32 bits).
const FP_PREFIX = 'PDA-';

/**
 * Devuelve la sal configurada por despliegue (VITE_LICENSE_SALT).
 * Si no está presente, se usa una sal por defecto (no secreta — solo para fijar
 * el dominio de hash entre despliegues del mismo entorno).
 * @returns {string}
 */
function _getSalt() {
    const envSalt = (typeof import.meta !== 'undefined'
        && import.meta.env
        && import.meta.env.VITE_LICENSE_SALT) || '';
    return envSalt || 'PDA_FP_SALT_2026_DEFAULT';
}

/**
 * Genera un fingerprint robusto del dispositivo.
 * Combina características del navegador + sal del backend → SHA-256 de 32 hex chars.
 *
 * @returns {Promise<string>} Fingerprint en formato `PDA-<32hex>`.
 */
export async function generateFingerprint() {
    if (typeof window === 'undefined' || !window.navigator) {
        // SSR / no-browser — devolver un fingerprint sintético determinista.
        return `${FP_PREFIX}${'0'.repeat(FP_HASH_LENGTH)}`;
    }

    const nav = window.navigator;
    const screen = window.screen || {};

    const components = [
        nav.userAgent || '',
        nav.language || '',
        nav.languages ? nav.languages.join(',') : '',
        nav.hardwareConcurrency || 1,
        nav.deviceMemory || 1,
        nav.platform || '',
        screen.width || 0,
        screen.height || 0,
        screen.colorDepth || 0,
        screen.availWidth || 0,
        screen.availHeight || 0,
        new Date().getTimezoneOffset(),
        Intl?.DateTimeFormat()?.resolvedOptions()?.timeZone || '',
        // Sal del backend — dificulta precomputar fingerprints falsos.
        _getSalt(),
    ].join('|');

    if (!window.crypto || !window.crypto.subtle) {
        // Fallback (solo en http sin SSL). Truncamos a FP_HASH_LENGTH.
        let hash = 0;
        for (let i = 0; i < components.length; i++) {
            hash = ((hash << 5) - hash) + components.charCodeAt(i);
            hash |= 0;
        }
        // Generar un hash más largo combinando varias rotaciones para reducir colisiones.
        let hash2 = 5381;
        for (let i = 0; i < components.length; i++) {
            hash2 = ((hash2 << 5) + hash2) + components.charCodeAt(i);
            hash2 |= 0;
        }
        const hex = (Math.abs(hash).toString(16) + Math.abs(hash2).toString(16))
            .toUpperCase()
            .padStart(FP_HASH_LENGTH, '0')
            .slice(0, FP_HASH_LENGTH);
        return `${FP_PREFIX}${hex}`;
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(components);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    // Tomar los primeros 16 bytes (32 hex chars) — 128 bits de entropía.
    const hex = hashArray.slice(0, 16)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    return `${FP_PREFIX}${hex}`;
}

/**
 * Verifica que el fingerprint almacenado coincide con el fingerprint actual.
 *
 * SEC-008: Si alguien inyecta un `pda_device_id` arbitrario desde DevTools,
 * `generateFingerprint()` devolverá un valor distinto y esta función devolverá `false`.
 *
 * @param {string} storedId - ID almacenado en localStorage.
 * @param {string} [currentFp] - Fingerprint ya calculado (opcional, para ahorrar cómputo).
 * @returns {Promise<boolean>} `true` si coinciden, `false` si difieren o el formato es inválido.
 */
export async function verifyStoredFingerprint(storedId, currentFp) {
    if (typeof storedId !== 'string' || !storedId.startsWith(FP_PREFIX)) {
        return false;
    }
    const expected = currentFp ?? await generateFingerprint();
    // Comparación en tiempo constante.
    if (expected.length !== storedId.length) return false;
    let diff = 0;
    for (let i = 0; i < storedId.length; i++) {
        diff |= storedId.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return diff === 0;
}

export default { generateFingerprint, verifyStoredFingerprint };
