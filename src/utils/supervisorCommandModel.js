const FALLBACK_UUID_TEMPLATE = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';

export const SUPERVISOR_RATE_PENDING_KEY = 'dj_supervisor_rate_pending_v1';

export function createSupervisorCommandId() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return FALLBACK_UUID_TEMPLATE.replace(/[xy]/g, char => {
        const random = Math.random() * 16 | 0;
        const value = char === 'x' ? random : (random & 0x3 | 0x8);
        return value.toString(16);
    });
}

export function ensureSupervisorChangeId(change) {
    if (!change || typeof change !== 'object') return change;
    if (change.commandId) return change;
    return {
        ...change,
        commandId: createSupervisorCommandId(),
    };
}

export function normalizeSupervisorChanges(changes) {
    return (Array.isArray(changes) ? changes : []).map(ensureSupervisorChangeId);
}

export function getSupervisorChangeKey(change) {
    return String(
        change?.commandId
        || `${change?.action || ''}:${change?.productId || change?.data?.id || ''}:${change?.queuedAt || ''}`
    );
}

export function isTerminalSupervisorCommandStatus(status) {
    return status === 'applied'
        || status === 'applied_with_warnings'
        || status === 'failed'
        || status === 'cancelled';
}

export function isSuccessfulSupervisorCommandStatus(status) {
    return status === 'applied' || status === 'applied_with_warnings';
}

export function findSupervisorCommandForChange(change, commands = []) {
    const commandId = change?.commandId;
    if (!commandId || !Array.isArray(commands)) return null;
    return commands.find(command => (
        command?.id === commandId || command?.payload?.commandId === commandId
    )) || null;
}

export function getSupervisorChangeResolution(change, commands = []) {
    const command = findSupervisorCommandForChange(change, commands);
    if (!command) return { status: 'pending', command: null };
    if (command.status === 'failed' || command.status === 'cancelled') {
        return { status: 'rejected', command };
    }
    if (isSuccessfulSupervisorCommandStatus(command.status)) {
        return { status: 'applied', command };
    }
    return { status: 'pending', command };
}

export function restoreLocalRateState(previous = {}) {
    if (typeof localStorage === 'undefined') return;

    const restore = (key, value) => {
        if (value === undefined || value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, String(value));
    };

    restore('bodega_rate_mode', previous.rateMode);
    restore('bodega_use_auto_rate', previous.useAutoRate);
    restore('bodega_custom_rate', previous.customRate);

    if (typeof window !== 'undefined') {
        for (const key of ['bodega_rate_mode', 'bodega_use_auto_rate', 'bodega_custom_rate']) {
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key } }));
        }
    }
}
