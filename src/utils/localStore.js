import localforage from 'localforage';
import { IDB_KEYS, LS_KEYS, PROTECTED_KEYS } from '../config/backupKeys';

localforage.config({ name: 'BodegaApp', storeName: 'bodega_app_data', description: 'Almacenamiento local optimizado para PWA de Bodega' });

// Formato primario IDB intacto. Solo fallbacks nuevos y marcas de eliminación
// usan sobres LS. No se adivina la edad de las copias raw LS preexistentes.
const RECORD_PREFIX = 'bodega_storage_fallback_v1:';
const TRANSACTION_KEY = 'bodega_storage_transaction_v1';
// Bloqueo físico único por origen: incluye todas las claves porque clear y los
// snapshots auxiliares cruzan claves. Orden: pos_write_lock -> este bloqueo.
// No adquirir pos_write_lock ni llamar métodos públicos desde prepare.
const WRITE_LOCK_NAME = 'bodega_storage_v1';
const LOCK_WAIT_MS = 15000;
const writes = new Map();
let clearBarrier = Promise.resolve();
const retries = new Map();
const touchedKeys = new Set();
const MAX_RETRIES = 3;
const OLD_KEYS = Object.freeze({
    bodega_products_v1: 'my_products_v1',
    bodega_customers_v1: 'my_customers_v1',
    bodega_accounts_v2: 'my_accounts_v2',
});
const SHADOW_KEYS = ['bodega_products_shadow_backup_v1', 'bodega_customers_shadow_backup_v1', 'bodega_sales_shadow_backup_v1'];

export class StorageWriteError extends Error {
    constructor(key, primaryError, fallbackError) {
        super('No se pudo confirmar el guardado local. Revisa el historial antes de repetir la operación.', { cause: fallbackError || primaryError });
        this.name = 'StorageWriteError'; this.code = 'STORAGE_WRITE_FAILED';
        this.key = key; this.primaryError = primaryError; this.fallbackError = fallbackError;
    }
}
export class StorageReadError extends Error {
    constructor(key, errors) {
        super(`No se pudo confirmar la lectura local de ${key}.`, { cause: errors[0] });
        this.name = 'StorageReadError'; this.code = 'STORAGE_READ_FAILED'; this.key = key;
    }
}

export class StorageLockError extends Error {
    constructor(code, cause) {
        super(code === 'STORAGE_LOCK_UNAVAILABLE'
            ? 'Este entorno no permite coordinar guardados seguros entre pestañas. No se aplicó la operación.'
            : 'No se pudo obtener el bloqueo de almacenamiento. No se inició la operación; revisa otras pestañas.', { cause });
        this.name = 'StorageLockError'; this.code = code;
    }
}

async function withStorageWriteLock(callback) {
    if (typeof navigator === 'undefined' || typeof navigator.locks?.request !== 'function'
        || (typeof window !== 'undefined' && window.isSecureContext === false)) {
        throw new StorageLockError('STORAGE_LOCK_UNAVAILABLE');
    }
    const controller = new AbortController();
    let started = false;
    const timer = setTimeout(() => controller.abort(), LOCK_WAIT_MS);
    try {
        // No usar withLock: su fallback de adquisición es local y aquí permitiría
        // que dos pestañas escriban sin exclusión. Un fallo NO autoriza bypass.
        return await navigator.locks.request(WRITE_LOCK_NAME, { mode: 'exclusive', signal: controller.signal }, async () => {
            started = true;
            clearTimeout(timer); // timeout solo de adquisición, nunca de commit
            return await callback();
        });
    } catch (error) {
        if (started) throw error; // no repetir efectos ni ocultar errores de negocio
        throw new StorageLockError('STORAGE_LOCK_FAILED', error);
    } finally { clearTimeout(timer); }
}

function serialize(key, callback) {
    const operation = Promise.all([clearBarrier, writes.get(key)]).then(() => withStorageWriteLock(async () => {
        await recoverTransaction();
        return callback();
    }));
    const tail = operation.then(() => undefined, () => undefined);
    writes.set(key, tail);
    return operation.finally(() => { if (writes.get(key) === tail) writes.delete(key); });
}
function assertKey(key) {
    if (typeof key !== 'string' || !key || key.startsWith(RECORD_PREFIX) || key === TRANSACTION_KEY) throw new TypeError('Clave local inválida o reservada');
}

// El journal es el commit lógico único. Mientras exista, TODOS los lectores
// del núcleo ven sus valores, aunque la materialización IDB esté incompleta.
async function readTransaction() {
    try {
        const raw = localStorage.getItem(TRANSACTION_KEY);
        if (raw === null) return null;
        const pointer = JSON.parse(raw);
        const record = pointer.storage === 'idb' ? await localforage.getItem(TRANSACTION_KEY) : pointer;
        // Puede haberse materializado o reemplazado mientras se leía IDB.
        if (localStorage.getItem(TRANSACTION_KEY) !== raw) return readTransaction();
        if (pointer.storage === 'idb' && record?.id !== pointer.id) throw new Error('Journal no corresponde al commit');
        if (record?.version !== 1 || typeof record.id !== 'string' || !Array.isArray(record.entries)) throw new Error('Journal inválido');
        const seen = new Set();
        for (const entry of record.entries) {
            assertKey(entry.key);
            if (seen.has(entry.key) || !['value', 'deleted'].includes(entry.kind)) throw new Error('Entrada transaccional inválida');
            seen.add(entry.key);
            if (entry.kind === 'value') {
                if (!Object.hasOwn(entry, 'value') || entry.value === null) throw new Error('Valor transaccional inválido');
                assertJsonValue(entry.value);
            }
        }
        return { ...record, raw };
    } catch (error) { throw new StorageReadError(TRANSACTION_KEY, [error]); }
}
async function transactionValue(key, defaultValue) {
    const record = await readTransaction();
    const entry = record?.entries.find(item => item.key === key);
    return entry ? { found: true, value: entry.kind === 'deleted' ? defaultValue : entry.value } : { found: false };
}
async function recoverTransaction() {
    const journal = await readTransaction();
    if (!journal) return;
    try {
        for (const entry of journal.entries) {
            if (entry.kind === 'deleted') {
                writeRecord(entry.key, null, 'deleted');
                await localforage.removeItem(entry.key);
            } else {
                await localforage.setItem(entry.key, entry.value);
                localStorage.removeItem(RECORD_PREFIX + entry.key);
                if (localStorage.getItem(RECORD_PREFIX + entry.key) !== null) throw new Error('Respaldo previo no retirado');
            }
            if (!isIndependentLocalKey(entry.key)) localStorage.removeItem(entry.key);
            retries.delete(entry.key);
        }
        if (localStorage.getItem(TRANSACTION_KEY) !== journal.raw) throw new Error('Journal cambió durante recovery');
        localStorage.removeItem(TRANSACTION_KEY);
        if (localStorage.getItem(TRANSACTION_KEY) !== null) throw new Error('Journal no retirado');
    } catch (error) {
        const pending = new StorageWriteError(TRANSACTION_KEY, error);
        pending.code = 'STORAGE_RECOVERY_REQUIRED';
        throw pending;
    }
}

function cloneTransactionValue(value, seen = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value;
    if (typeof value !== 'object' || seen.has(value)) throw new TypeError('Valor transaccional no representable');
    const isArray = Array.isArray(value);
    const proto = Object.getPrototypeOf(value);
    if (!isArray && proto !== null && proto?.constructor?.name !== 'Object') throw new TypeError('Tipo transaccional no admitido');
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError('Propiedad transaccional no JSON');
    seen.add(value);
    const clone = isArray ? [] : {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (isArray && key === 'length') continue;
        if (!descriptor.enumerable || descriptor.get || descriptor.set || (isArray && !/^(0|[1-9][0-9]*)$/.test(key))) throw new TypeError('Propiedad transaccional no admitida');
        // Única normalización: campos de objeto opcionales undefined se omiten.
        if (descriptor.value === undefined && !isArray) continue;
        Object.defineProperty(clone, key, { value: cloneTransactionValue(descriptor.value, seen), enumerable: true, writable: true, configurable: true });
    }
    if (isArray && (Object.keys(clone).length !== value.length || clone.length !== value.length)) throw new TypeError('Array transaccional disperso');
    seen.delete(value);
    return clone;
}
function readRecord(key) {
    // Si no se puede leer esta autoridad, NO devolver IDB posiblemente viejo,
    // ni siquiera desde la fachada tolerante (evita autoguardados de defaults).
    try {
        const serialized = localStorage.getItem(RECORD_PREFIX + key);
        if (serialized === null) return null;
        const record = JSON.parse(serialized);
        if (record?.version !== 1 || record.key !== key || !['value', 'deleted'].includes(record.kind)
            || (record.kind === 'value' && (!Object.hasOwn(record, 'value') || record.value === null))) throw new Error('Sobre durable inválido');
        if (record.kind === 'value') assertJsonValue(record.value);
        return { ...record, serialized };
    } catch (error) { throw new StorageReadError(key, [error]); }
}
function recordKeys() {
    const keys = [];
    try {
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (key?.startsWith(RECORD_PREFIX)) keys.push(key.slice(RECORD_PREFIX.length));
        }
    } catch (error) { throw new StorageReadError(RECORD_PREFIX, [error]); }
    return keys;
}
function assertJsonValue(value, seen = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return;
    if (typeof value !== 'object' || seen.has(value)) throw new TypeError('Fallback no representable como JSON sin pérdida');
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== null && proto?.constructor?.name !== 'Object') throw new TypeError('Tipo no compatible con fallback');
    if (Object.getOwnPropertySymbols(value).length || typeof value.toJSON === 'function') throw new TypeError('Fallback con propiedades no JSON');
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (Array.isArray(value) && name === 'length') continue;
        if (!descriptor.enumerable || descriptor.get || descriptor.set
            || (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(name))) {
            throw new TypeError('Propiedad no representable sin pérdida en fallback');
        }
    }
    seen.add(value);
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            if (!Object.hasOwn(value, i)) throw new TypeError('Array disperso no compatible');
            assertJsonValue(value[i], seen);
        }
    } else {
        for (const item of Object.values(value)) assertJsonValue(item, seen);
    }
    seen.delete(value);
}
function writeRecord(key, value, kind = 'value') {
    if (kind === 'value') assertJsonValue(value);
    const serialized = JSON.stringify(kind === 'deleted' ? { version: 1, key, kind } : { version: 1, key, kind, value });
    localStorage.setItem(RECORD_PREFIX + key, serialized);
    if (localStorage.getItem(RECORD_PREFIX + key) !== serialized) throw new Error('Sobre durable no verificable');
    return { ...JSON.parse(serialized), serialized };
}
function notify(callback, ...args) {
    try { callback?.(...args); } catch (error) { console.warn('[Storage] Efecto posterior al guardado falló:', error); }
}
function isIndependentLocalKey(key) {
    return key.startsWith('sb-') || key.startsWith('dj_') || key === 'abasto-auth-storage'
        || LS_KEYS.includes(key) || PROTECTED_KEYS.includes(key);
}
function cleanupLegacy(key) {
    if (isIndependentLocalKey(key)) return;
    try { localStorage.removeItem(key); } catch (error) {
        console.warn(`[Storage] Guardado confirmado; limpieza LS pendiente para ${key}:`, error);
    }
}
function retireRecord(key, record) {
    if (localStorage.getItem(RECORD_PREFIX + key) !== record.serialized) throw new Error('Autoridad local cambió durante la operación');
    // Limpiar raw primero: si esto falla el sobre vigente sigue siendo autoridad.
    if (!isIndependentLocalKey(key)) localStorage.removeItem(key);
    localStorage.removeItem(RECORD_PREFIX + key);
    if (localStorage.getItem(RECORD_PREFIX + key) !== null) throw new Error('No se pudo retirar el sobre durable');
}
function pendingRecord(key, record, onPersisted, replace = false) {
    const existing = retries.get(key);
    if (!replace && existing?.serialized === record.serialized) return existing;
    const op = { key, value: record.value, serialized: record.serialized, attempts: 0, onPersisted };
    retries.set(key, op);
    return op;
}
function discoverRetries() {
    const present = new Set();
    for (const key of recordKeys()) {
        const record = readRecord(key);
        if (record?.kind === 'value') {
            present.add(key); pendingRecord(key, record);
        }
    }
    for (const key of retries.keys()) if (!present.has(key)) retries.delete(key);
}

async function readValue(key, defaultValue = null, { tolerant = false } = {}) {
    assertKey(key); touchedKeys.add(key);
    const committed = await transactionValue(key, defaultValue);
    if (committed.found) return committed.value;
    const record = readRecord(key);
    if (record) return record.kind === 'deleted' || record.value === null ? defaultValue : record.value;
    const errors = [];
    let primaryMissing = false;
    try {
        const value = await localforage.getItem(key);
        const afterRead = await transactionValue(key, defaultValue);
        if (afterRead.found) return afterRead.value;
        // Otra instancia puede haber confirmado un fallback durante el await.
        const latest = readRecord(key);
        if (latest) return latest.kind === 'deleted' || latest.value === null ? defaultValue : latest.value;
        if (value !== null && value !== undefined) return value;
        primaryMissing = true;
    } catch (error) {
        if (error.code === 'STORAGE_READ_FAILED') throw error;
        errors.push(error);
    }
    try {
        const raw = localStorage.getItem(key);
        if (raw !== null) {
            try { return JSON.parse(raw); } catch { return raw; }
        }
    } catch (error) { errors.push(error); }
    if (primaryMissing && Object.hasOwn(OLD_KEYS, key)) {
        try {
            const old = localforage.createInstance({ name: 'TasasAlDiaApp', storeName: 'app_data' });
            const value = await old.getItem(OLD_KEYS[key]);
            const afterLegacyRead = await transactionValue(key, defaultValue);
            if (afterLegacyRead.found) return afterLegacyRead.value;
            const latest = readRecord(key);
            if (latest) return latest.kind === 'deleted' || latest.value === null ? defaultValue : latest.value;
            if (value !== null && value !== undefined) return value;
        } catch (error) {
            if (error.code === 'STORAGE_READ_FAILED') throw error;
            errors.push(error);
        }
    }
    if (errors.length && !tolerant) throw new StorageReadError(key, errors);
    if (errors.length) console.warn(`[Storage] Lectura incompleta de ${key}:`, errors);
    return defaultValue;
}

async function reconcileStrict(key, record) {
    try {
        if (record.kind === 'deleted') await localforage.removeItem(key);
        else await localforage.setItem(key, record.value);
        retireRecord(key, record);
        retries.delete(key);
    } catch (error) { throw new StorageWriteError(key, error); }
}
async function removeValue(key) {
    assertKey(key); touchedKeys.add(key);
    // Mantener tombstone para impedir recuperación desde namespace viejo o LS
    // residual tras reinicio. Si no cabe, no empezar la eliminación IDB.
    try { writeRecord(key, null, 'deleted'); } catch (error) { throw new StorageWriteError(key, error); }
    retries.delete(key);
    await localforage.removeItem(key);
    if (!isIndependentLocalKey(key)) localStorage.removeItem(key);
}
async function commitValue(key, value, { allowFallback = false, onPersisted, onFallback, assertCurrent } = {}) {
    if (value === null) {
        await removeValue(key);
        notify(onPersisted, key, null, true);
        return;
    }
    const previous = readRecord(key);
    if (previous?.kind === 'deleted' && !allowFallback) {
        // No retirar la marca antes de confirmar incoming: un fallo expondría
        // el namespace histórico que precisamente se eliminó.
        try {
            await localforage.setItem(key, value);
            retireRecord(key, previous);
            retries.delete(key);
        } catch (error) { throw new StorageWriteError(key, error); }
        notify(onPersisted, key, value, true);
        return;
    }
    if (previous && !allowFallback) {
        // El writer estricto nunca confirma incoming vía LS. Primero concilia
        // el valor anterior; si falla, incoming aún no se ha aplicado.
        await reconcileStrict(key, previous);
        assertCurrent?.();
    }
    let record = null;
    if (previous && allowFallback) {
        try { record = writeRecord(key, value); } catch (error) {
            notify(onFallback, key, error); throw new StorageWriteError(key, error);
        }
        pendingRecord(key, record, onPersisted, true);
    }
    try {
        await localforage.setItem(key, record ? record.value : value);
    } catch (primaryError) {
        if (!allowFallback) throw new StorageWriteError(key, primaryError);
        if (!record) {
            try { record = writeRecord(key, value); } catch (fallbackError) {
                notify(onFallback, key, fallbackError, primaryError);
                throw new StorageWriteError(key, primaryError, fallbackError);
            }
            pendingRecord(key, record, onPersisted, true);
        }
        notify(onFallback, key, primaryError);
        notify(onPersisted, key, record.value, false);
        return;
    }
    if (record) {
        try { retireRecord(key, record); retries.delete(key); } catch (error) {
            // IDB y el sobre contienen el MISMO valor nuevo. No fingir fallo de
            // negocio ni regresar al snapshot anterior por limpieza fallida.
            console.warn(`[Storage] Guardado confirmado; sobre pendiente para ${key}:`, error);
        }
    } else { retries.delete(key); cleanupLegacy(key); }
    notify(onPersisted, key, record ? record.value : value, true);
}

export const localStore = {
    async transaction(callback, { prepare, onCommitted } = {}) {
        const effects = [];
        const before = [...writes.values()];
        const operation = Promise.all([clearBarrier, ...before]).then(() => withStorageWriteLock(async () => {
            await recoverTransaction();
            const staged = new Map();
            let closed = false;
            let preparationError = null;
            const assertOpen = () => { if (closed) throw new Error('Transacción local cerrada'); };
            const io = {
                transactional: true,
                async getItem(key, defaultValue = null) {
                    try {
                        assertOpen(); assertKey(key);
                        if (staged.has(key)) return staged.get(key) === null ? defaultValue : cloneTransactionValue(staged.get(key));
                        return await readValue(key, defaultValue);
                    } catch (error) { preparationError = error; throw error; }
                },
                async setItem(key, value) {
                    try {
                        assertOpen(); assertKey(key);
                        if (prepare) value = await prepare(key, value, {
                            getItem: io.getItem,
                            afterCommit: io.afterCommit,
                            setPrimaryItem: async (k, v) => { assertOpen(); assertKey(k); staged.set(k, cloneTransactionValue(v)); },
                        });
                        staged.set(key, cloneTransactionValue(value));
                    } catch (error) { preparationError = error; throw error; }
                },
                async removeItem(key) {
                    try { assertOpen(); assertKey(key); staged.set(key, null); }
                    catch (error) { preparationError = error; throw error; }
                },
                afterCommit(fn) { assertOpen(); effects.push(fn); },
            };
            let result;
            try { result = await callback(io); } finally { closed = true; }
            // Errores de negocio deben abortar también cuando se devuelven en vez de lanzar.
            if (preparationError) throw preparationError;
            if (result === null || result === false || result?.success === false || result?.error) return { result, entries: [], committed: false };
            const entries = [...staged].map(([key, value]) => value === null ? { key, kind: 'deleted' } : { key, kind: 'value', value });
            if (!entries.length) return { result, entries, committed: true };
            const record = { version: 1, id: crypto.randomUUID(), entries };
            let raw;
            try {
                // Un snapshot de ventas/inventario puede exceder la cuota LS.
                // Prepararlo en IDB no aplica el negocio: solo el puntero LS
                // confirmado lo hace visible como commit. Sin puntero es huérfano.
                await localforage.setItem(TRANSACTION_KEY, record);
                raw = JSON.stringify({ version: 1, id: record.id, storage: 'idb' });
            } catch {
                raw = JSON.stringify(record); // contingencia atómica si cabe en LS
            }
            try {
                localStorage.setItem(TRANSACTION_KEY, raw);
                if (localStorage.getItem(TRANSACTION_KEY) !== raw) throw new Error('Commit transaccional no verificable');
            } catch (error) { throw new StorageWriteError(TRANSACTION_KEY, error); }
            // Desde aquí ya hay commit lógico durable: no se permite volver a
            // ejecutar el negocio por un fallo materializando claves individuales.
            try { await recoverTransaction(); } catch (error) { console.warn('[Storage] Commit durable pendiente de materialización:', error); }
            return { result, entries, committed: true };
        }));
        clearBarrier = operation.then(() => undefined, () => undefined);
        const completed = await operation;
        if (completed.committed) {
            for (const entry of completed.entries) notify(onCommitted, entry.key, entry.kind === 'deleted' ? null : entry.value, true);
            for (const effect of effects) {
                try { await effect(); } catch (error) { console.warn('[Storage] Efecto posterior a transacción falló:', error); }
            }
        }
        return completed.result;
    },
    recoverTransactions() { return withStorageWriteLock(recoverTransaction); },
    async getItem(key, defaultValue = null, options) {
        await Promise.all([clearBarrier, writes.get(key)]);
        return readValue(key, defaultValue, options);
    },
    setItem(key, value, options = {}) {
        assertKey(key); touchedKeys.add(key);
        return serialize(key, async () => {
            options.assertCurrent?.();
            // No permitir que una sobreescritura oculte un sobre corrupto.
            readRecord(key);
            if (options.prepare) value = await options.prepare(value, {
                getItem: readValue,
                // Snapshots auxiliares dentro de la operación ya serializada.
                setPrimaryItem: (snapshotKey, snapshot) => commitValue(snapshotKey, snapshot),
            });
            options.assertCurrent?.();
            await commitValue(key, value, options);
        });
    },
    removeItem(key) { return serialize(key, () => removeValue(key)); },
    clear({ localKeys = [] } = {}) {
        const before = [...writes.values()];
        const operation = Promise.all([clearBarrier, ...before]).then(() => withStorageWriteLock(async () => {
            await recoverTransaction();
            const primaryKeys = typeof localforage.keys === 'function' ? await localforage.keys() : [];
            const keys = new Set([...IDB_KEYS, ...SHADOW_KEYS, ...primaryKeys.filter(k => k !== TRANSACTION_KEY), ...touchedKeys, ...recordKeys()]);
            // Conserva tombstones de las claves de datos; preferencias locales
            // solo se borran si el caller las pasó explícitamente. No sb-*.
            for (const key of keys) {
                assertKey(key);
                try { writeRecord(key, null, 'deleted'); } catch (error) { throw new StorageWriteError(key, error); }
                retries.delete(key);
            }
            await localforage.clear();
            for (const key of keys) if (!isIndependentLocalKey(key)) localStorage.removeItem(key);
            for (const key of localKeys) localStorage.removeItem(key);
            retries.clear();
        }));
        clearBarrier = operation.then(() => undefined, () => undefined);
        return operation;
    },
    getPendingRetries() {
        discoverRetries();
        return [...retries.values()].map(({ key, attempts }) => ({ key, attempts }));
    },
    async flushRetries() {
        discoverRetries();
        let count = 0;
        for (const op of [...retries.values()]) {
            await serialize(op.key, async () => {
                const record = readRecord(op.key);
                if (record?.kind !== 'value' || record.serialized !== op.serialized) {
                    if (retries.get(op.key) === op) retries.delete(op.key);
                    return;
                }
                if (retries.get(op.key) !== op || op.attempts >= MAX_RETRIES) return;
                op.attempts++;
                try {
                    await localforage.setItem(op.key, record.value);
                    retireRecord(op.key, record);
                    retries.delete(op.key); count++;
                    // Tras reinicio no se resucitan callbacks/publicaciones.
                    notify(op.onPersisted, op.key, record.value, true);
                } catch (error) { console.warn(`[Storage] No se pudo migrar el fallback de ${op.key}:`, error); }
            });
        }
        return count;
    },
};
