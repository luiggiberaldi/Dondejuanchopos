/**
 * intercomIdentity.js — cómo se distingue visualmente a cada participante del chat.
 *
 * El color se calcula del `sender_device_id` (no del nombre), así que una persona
 * conserva el mismo color en todos los equipos aunque renombre su dispositivo.
 * Los colores se aplican con estilos en línea para que Tailwind no los purgue.
 */

// 8 tonos medios distinguibles entre sí y del índigo de los mensajes propios.
// Una sola paleta: la app invierte la escala slate según el tema, así que el fondo
// real de la burbuja no se deduce de la prop `dark`; estos tonos se leen sobre
// fondo claro y oscuro.
export const INTERCOM_PALETTE = [
    { key: 'blue', color: '#3b82f6' },
    { key: 'emerald', color: '#059669' },
    { key: 'amber', color: '#d97706' },
    { key: 'rose', color: '#e11d48' },
    { key: 'violet', color: '#8b5cf6' },
    { key: 'cyan', color: '#0891b2' },
    { key: 'orange', color: '#ea580c' },
    { key: 'fuchsia', color: '#c026d3' },
];

/** Hash FNV-1a de 32 bits: estable entre navegadores y sesiones. */
function hashString(value) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

/** Color del remitente (nombre, borde de la burbuja y fondo del avatar). */
export function senderColor(senderDeviceId) {
    const entry = INTERCOM_PALETTE[hashString(String(senderDeviceId || '')) % INTERCOM_PALETTE.length];
    return { key: entry.key, color: entry.color };
}

/** Iniciales para el avatar: "Luis Medina" → "LM", "Kelman" → "KE", vacío → "?". */
export function senderInitials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Ventana para agrupar mensajes seguidos de la misma persona. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * true si `message` continúa el grupo de `previous`: mismo dispositivo y enviado
 * dentro de los 5 minutos siguientes. En ese caso no se repiten nombre ni avatar.
 */
export function continuesGroup(previous, message) {
    if (!previous || !message) return false;
    if (previous.sender_device_id !== message.sender_device_id) return false;
    const gap = Date.parse(message.created_at) - Date.parse(previous.created_at);
    return Number.isFinite(gap) && gap >= 0 && gap <= GROUP_WINDOW_MS;
}
