export const INTERCOM_MESSAGE_LIMIT = 160;
export const INTERCOM_HISTORY_LIMIT = 30;

export function countCodePoints(value) {
    return Array.from(String(value ?? '')).length;
}

export function normalizeMessage(value) {
    return String(value ?? '').replace(/\r\n?/g, '\n').trim();
}

export function validateMessage(value) {
    const message = normalizeMessage(value);
    const length = countCodePoints(message);
    if (!message) return { valid: false, reason: 'Escribe un mensaje.' };
    if (length > INTERCOM_MESSAGE_LIMIT) {
        return { valid: false, reason: `Máximo ${INTERCOM_MESSAGE_LIMIT} caracteres.` };
    }
    return { valid: true, message, length };
}

export function compareMessages(a, b) {
    const byTime = String(a?.created_at || '').localeCompare(String(b?.created_at || ''));
    return byTime || String(a?.id || '').localeCompare(String(b?.id || ''));
}

export function mergeMessages(...groups) {
    const byId = new Map();
    for (const message of groups.flat()) {
        if (message?.id) byId.set(message.id, message);
    }
    return [...byId.values()].sort(compareMessages);
}

export function isAfterCursor(message, cursor) {
    if (!cursor?.created_at || !cursor?.id) return true;
    return compareMessages(message, cursor) > 0;
}

export function getUnreadCount(messages, readerDeviceId, cursor) {
    return messages.filter(message =>
        message.sender_device_id !== readerDeviceId && isAfterCursor(message, cursor)
    ).length;
}

export function getCursorFilter(cursor) {
    if (!cursor?.created_at || !cursor?.id) return null;
    return `created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`;
}

export function getMessageCursor(message) {
    if (!message?.id || !message?.created_at) return null;
    return { id: message.id, created_at: message.created_at };
}

export function getCatchupFilter(cursor) {
    return getCursorFilter(cursor);
}

export function getInitialCursor(messages) {
    return messages.reduce((latest, message) => {
        if (!latest || compareMessages(message, latest) > 0) return getMessageCursor(message);
        return latest;
    }, null);
}
