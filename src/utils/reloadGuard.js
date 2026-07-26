// src/utils/reloadGuard.js
// Guardián anti-bucles de recarga automática para proteger el consumo de Egress en Supabase.

const RELOAD_GUARD_KEY = 'dj_reload_guard';
const RELOAD_WINDOW_MS = 10000;   // Ventana de 10 segundos
const MAX_RELOADS = 3;             // Máximo 3 recargas permitidas en la ventana

/**
 * Lee los timestamps recientes (dentro de la ventana) sin modificar el storage.
 * @returns {number[]} Lista de timestamps en la ventana actual.
 */
function _getRecentReloads() {
    try {
        const now = Date.now();
        const raw = localStorage.getItem(RELOAD_GUARD_KEY);
        const stored = raw ? JSON.parse(raw) : [];
        return Array.isArray(stored)
            ? stored.filter(ts => typeof ts === 'number' && (now - ts) < RELOAD_WINDOW_MS)
            : [];
    } catch {
        return [];
    }
}

/**
 * Registra la recarga actual en localStorage.
 * Debe llamarse UNA SOLA VEZ al inicio de la página (en main.jsx, nivel módulo).
 */
export function recordReload() {
    try {
        const recent = _getRecentReloads();
        recent.push(Date.now());
        localStorage.setItem(RELOAD_GUARD_KEY, JSON.stringify(recent));
    } catch {}
}

/**
 * Verifica (sin modificar el storage) si se ha superado el umbral de recargas rápidas.
 * @returns {boolean} true si se detecta un bucle descontrolado de recargas.
 */
export function isLoopDetected() {
    const recent = _getRecentReloads();
    const loop = recent.length > MAX_RELOADS;
    if (loop) {
        console.warn('[ReloadGuard] ⚠️ Bucle de recargas rápido detectado (', recent.length, 'recargas en 10s).');
    }
    return loop;
}

/**
 * Limpia la marca del guardián de recargas para permitir el funcionamiento normal.
 */
export function clearReloadGuard() {
    try {
        localStorage.removeItem(RELOAD_GUARD_KEY);
    } catch {}
}
