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

// JSONB puede reordenar claves; la comparación no depende de su orden.
export function sameSupervisorRequest(a, b) {
    const canonical = value => Array.isArray(value) ? value.map(canonical)
        : value && typeof value === 'object'
            ? Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]))
            : value;
    return Boolean(a && b && a.id === b.id && a.primary_device_id === b.primary_device_id
        && a.monitor_device_id === b.monitor_device_id && a.command_type === b.command_type
        && JSON.stringify(canonical(a.payload)) === JSON.stringify(canonical(b.payload)));
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

// Un cambio «en confirmación» solo es abandonable cuando su comando ya está
// TERMINAL en la nube (applied / applied_with_warnings / failed / cancelled):
// nada más llegará de la caja, así que su registro local puede soltarse aunque
// la evidencia de confirmación (recibo / igualdad de valores) nunca aparezca.
// Un comando aún 'pending' o desconocido conserva la posibilidad de aplicarse.
export function isChangeAbandonable(change, commands = []) {
    const command = findSupervisorCommandForChange(change, commands);
    return Boolean(command && isTerminalSupervisorCommandStatus(command.status));
}

// Campos que la caja recalcula al aplicar (auditoría, recibos de comando) o que
// se mueven con cada venta (traza de stock). No son intención de edición del
// supervisor: exigirlos en la confirmación de un `edit` la hacía casi imposible
// (CASO-SYNC 23-10-2026, sección 7.2).
export const EDIT_COMPARE_IGNORED_FIELDS = new Set([
    'baseUpdatedAt', 'updatedAt', 'createdAt', 'stock',
    'updatedBy', 'updatedByName', 'updatedByRole', 'updatedByDeviceId',
    'lastOperationId', 'lastStockOperationId', 'stockOperationIds',
    'stockUpdatedAt', 'stockUpdatedBy', 'stockUpdatedByName', 'stockUpdatedByRole',
]);

// Huella de las claves REALMENTE editadas: las que difieren entre el producto
// base y el payload del formulario (excluyendo derivados). `null` si no hay
// base: sin ella no se puede saber la intención y la confirmación cae en el
// fallback por igualdad de claves no derivadas.
export function diffSupervisorEditedKeys(base, data) {
    if (!base || !data || typeof data !== 'object') return null;
    const keys = [];
    for (const key of Object.keys(data)) {
        if (EDIT_COMPARE_IGNORED_FIELDS.has(key) || key.startsWith('_')) continue;
        const same = key === 'name'
            ? String(base[key] || '').trim() === String(data[key] || '').trim()
            : JSON.stringify(base[key] ?? null) === JSON.stringify(data[key] ?? null);
        if (!same) keys.push(key);
    }
    return keys;
}

// Confirmación de un `edit`: compara SOLO las claves realmente editadas
// (CASO-SYNC 23-10-2026, fix 7.6.4). El blob completo del producto nunca puede
// ser igual al eco de la caja (updatedAt/updatedBy*/lastOperationId los
// sobrescribe la caja y el stock se mueve con cada venta). Los cambios `edit`
// legacy sin `editedKeys` comparan todas las claves no derivadas.
export function supervisorEditMatches(change, product) {
    if (!product) return false;
    const data = change?.data || {};
    const keys = Array.isArray(change?.editedKeys)
        ? change.editedKeys
        : Object.keys(data).filter(key => !EDIT_COMPARE_IGNORED_FIELDS.has(key) && !key.startsWith('_'));
    return keys.every(key => key === 'name'
        ? String(product[key] || '').trim() === String(data[key] || '').trim()
        : JSON.stringify(product[key] ?? null) === JSON.stringify(data[key] ?? null));
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
