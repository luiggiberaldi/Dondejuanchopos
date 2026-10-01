import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ db: new Map(), write: vi.fn(), push: vi.fn() }));
vi.mock('localforage', () => ({ default: {
    config: vi.fn(),
    getItem: async key => structuredClone(m.db.get(key) ?? null),
    setItem: (key, value) => m.write(key, value),
    removeItem: async key => m.db.delete(key),
    clear: async () => m.db.clear(),
} }));
vi.mock('../src/hooks/useCloudSync', () => ({ queueCloudSync: m.push }));
import { storageService } from '../src/utils/storageService';
const key = 'durability_fixture';
const quota = () => Object.assign(new Error('almacén lleno'), { name: 'QuotaExceededError' });
beforeEach(async () => {
    vi.restoreAllMocks(); m.db.clear(); localStorage.clear(); m.push.mockReset();
    m.write.mockReset().mockImplementation(async (k, v) => { m.db.set(k, structuredClone(v)); return v; });
    await storageService.flushRetries(); m.db.clear(); m.write.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('H02a: fallo explícito sin replay oculto', () => {
    it.each(['quota', 'generic'])('rechaza cuando ninguno de los almacenes guarda (%s)', async kind => {
        const idbError = kind === 'quota' ? quota() : new Error('IndexedDB bloqueada');
        m.write.mockRejectedValue(idbError);
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw quota(); });
        const events = [];
        const handler = event => events.push(event.detail);
        window.addEventListener('app_storage_update', handler);
        try {
            await expect(storageService.setItem(key, { value: 1 })).rejects.toMatchObject({ name: 'StorageWriteError', code: 'STORAGE_WRITE_FAILED', key });
            expect(events).toEqual([]);
            expect(storageService.getPendingRetries()).toEqual([]);
            expect(m.push).not.toHaveBeenCalled();
            expect(m.db.has(key)).toBe(false);
        } finally { window.removeEventListener('app_storage_update', handler); }
    });
    it('no aplica después una escritura cuya promesa fue rechazada', async () => {
        m.write.mockRejectedValue(quota());
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw quota(); });
        await expect(storageService.setItem(key, { value: 'rejected' })).rejects.toMatchObject({ code: 'STORAGE_WRITE_FAILED' });
        spy.mockRestore();
        m.write.mockImplementation(async (k, v) => { m.db.set(k, v); });
        expect(await storageService.flushRetries()).toBe(0);
        expect(m.db.has(key)).toBe(false);
    });
    it('mantiene el fallback que sí se guardó y puede migrarlo al recuperarse IDB', async () => {
        m.write.mockRejectedValue(quota());
        await storageService.setItem(key, { value: 'persisted' });
        expect(JSON.parse(localStorage.getItem(`bodega_storage_fallback_v1:${key}`))).toMatchObject({
            version: 1, key, kind: 'value', value: { value: 'persisted' },
        });
        expect(await storageService.getItem(key)).toEqual({ value: 'persisted' });
        expect(storageService.getPendingRetries()).toEqual([{ key, attempts: 0 }]);
        m.write.mockImplementation(async (k, v) => { m.db.set(k, structuredClone(v)); });
        expect(await storageService.flushRetries()).toBe(1);
        expect(m.db.get(key)).toEqual({ value: 'persisted' });
    });
    it('un guardado nuevo exitoso invalida el reintento de un snapshot anterior', async () => {
        m.write.mockRejectedValue(quota());
        await storageService.setItem(key, { revision: 1 });
        m.write.mockImplementation(async (k, v) => { m.db.set(k, structuredClone(v)); });
        await storageService.setItem(key, { revision: 2 });
        expect(await storageService.flushRetries()).toBe(0);
        expect(m.db.get(key)).toEqual({ revision: 2 });
    });
    it('coalesce fallbacks confirmados de la misma clave sin reponer el más antiguo', async () => {
        m.write.mockRejectedValue(quota());
        await storageService.setItem(key, { revision: 1 });
        await storageService.setItem(key, { revision: 2 });
        expect(storageService.getPendingRetries()).toHaveLength(1);
        m.write.mockImplementation(async (k, v) => { m.db.set(k, structuredClone(v)); });
        expect(await storageService.flushRetries()).toBe(1);
        expect(m.db.get(key)).toEqual({ revision: 2 });
    });
    it('una falla de limpieza LS no convierte un guardado IDB en fallo ni repite escritura', async () => {
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('LS no accesible'); });
        const writeLs = vi.spyOn(Storage.prototype, 'setItem');
        await expect(storageService.setItem(key, { value: 1 })).resolves.toBeUndefined();
        expect(m.write).toHaveBeenCalledTimes(1);
        expect(writeLs).not.toHaveBeenCalled();
        expect(m.db.get(key)).toEqual({ value: 1 });
    });
    it('una falla de queueCloudSync no se trata como escritura fallida', async () => {
        m.push.mockImplementation(() => { throw new Error('cola no disponible'); });
        const writeLs = vi.spyOn(Storage.prototype, 'setItem');
        await expect(storageService.setItem(key, { value: 1 })).resolves.toBeUndefined();
        expect(m.write).toHaveBeenCalledTimes(1);
        expect(writeLs).not.toHaveBeenCalled();
        expect(m.db.get(key)).toEqual({ value: 1 });
    });
    it('removeItem exitoso elimina también el reintento antiguo de esa clave', async () => {
        m.write.mockRejectedValue(quota());
        await storageService.setItem(key, { value: 1 });
        await storageService.removeItem(key);
        m.write.mockImplementation(async (k, v) => { m.db.set(k, v); });
        expect(await storageService.flushRetries()).toBe(0);
        expect(m.db.has(key)).toBe(false);
    });
    it('clearAllData no restaura una escritura vieja encolada', async () => {
        m.write.mockRejectedValue(quota());
        await storageService.setItem(key, { value: 1 });
        m.write.mockImplementation(async (k, v) => { m.db.set(k, v); });
        await storageService.clearAllData();
        expect(await storageService.flushRetries()).toBe(0);
        expect(m.db.has(key)).toBe(false);
        expect(localStorage.getItem(key)).toBeNull();
        expect(await storageService.getItem(key, null)).toBeNull();
    });
    it('conserva una copia del fallback aunque el caller modifique luego el objeto', async () => {
        m.write.mockRejectedValue(quota());
        const value = { revision: 1 };
        await storageService.setItem(key, value);
        value.revision = 99;
        m.write.mockImplementation(async (k, v) => { m.db.set(k, v); });
        expect(await storageService.flushRetries()).toBe(1);
        expect(m.db.get(key)).toEqual({ revision: 1 });
    });
    it('serializa dos flush concurrentes sin aplicar el mismo fallback dos veces', async () => {
        m.write.mockRejectedValue(quota());
        await storageService.setItem(key, { revision: 1 });
        m.write.mockReset().mockImplementation(async (k, v) => { m.db.set(k, v); });
        const counts = await Promise.all([storageService.flushRetries(), storageService.flushRetries()]);
        expect(counts[0] + counts[1]).toBe(1);
        expect(m.write).toHaveBeenCalledTimes(1);
    });
    it('una migración en vuelo no pisa una escritura más nueva encolada después', async () => {
        m.write.mockRejectedValue(quota());
        await storageService.setItem(key, { revision: 1 });
        let release;
        const held = new Promise(resolve => { release = resolve; });
        let started;
        const entered = new Promise(resolve => { started = resolve; });
        m.write.mockReset().mockImplementation(async (k, v) => {
            if (v.revision === 1) { started(); await held; }
            m.db.set(k, v);
        });
        const flush = storageService.flushRetries();
        await entered;
        const save = storageService.setItem(key, { revision: 2 });
        release();
        await Promise.all([flush, save]);
        expect(m.db.get(key)).toEqual({ revision: 2 });
        expect(storageService.getPendingRetries()).toEqual([]);
    });
    it('no confirma un fallback cuyo setItem no escribió nada', async () => {
        m.write.mockRejectedValue(quota());
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
        await expect(storageService.setItem(key, { value: 1 })).rejects.toMatchObject({ code: 'STORAGE_WRITE_FAILED' });
        expect(storageService.getPendingRetries()).toEqual([]);
    });
});
