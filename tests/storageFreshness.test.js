import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

const m = vi.hoisted(() => ({ db: new Map(), write: vi.fn(), read: vi.fn(), push: vi.fn(), oldRead: vi.fn() }));
vi.mock('localforage', () => ({ default: {
    config: vi.fn(),
    getItem: key => m.read(key),
    setItem: (key, value) => m.write(key, value),
    removeItem: async key => m.db.delete(key),
    clear: async () => m.db.clear(),
    createInstance: () => ({ getItem: m.oldRead }),
} }));
vi.mock('../src/hooks/useCloudSync', () => ({ queueCloudSync: m.push }));
const key = 'freshness_fixture';
let storage;
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
beforeEach(async () => {
    vi.restoreAllMocks(); m.db.clear(); localStorage.clear();
    m.push.mockReset();
    m.write.mockReset().mockImplementation(async (k, v) => { m.db.set(k, structuredClone(v)); });
    m.read.mockReset().mockImplementation(async k => structuredClone(m.db.get(k) ?? null));
    m.oldRead.mockReset().mockResolvedValue(null);
    vi.resetModules();
    storage = (await import('../src/utils/storageService')).storageService;
});
afterEach(() => vi.restoreAllMocks());

describe('H02b: non-destructive storage reads', () => {
    it('reads current-key LS without migrating, deleting or notifying', async () => {
        localStorage.setItem(key, JSON.stringify({ legacy: true }));
        const remove = vi.spyOn(Storage.prototype, 'removeItem');
        const event = vi.spyOn(window, 'dispatchEvent');
        expect(await storage.getItem(key)).toEqual({ legacy: true });
        expect(m.write).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
        expect(m.push).not.toHaveBeenCalled();
        expect(event).not.toHaveBeenCalled();
        expect(localStorage.getItem(key)).not.toBeNull();
    });
    it.each([
        ['bodega_products_v1', 'my_products_v1'],
        ['bodega_customers_v1', 'my_customers_v1'],
        ['bodega_accounts_v2', 'my_accounts_v2'],
    ])('reads old namespace for %s without copying it to primary', async (k, oldKey) => {
        m.oldRead.mockResolvedValue([{ id: 'legacy' }]);
        expect(await storage.getItem(k)).toEqual([{ id: 'legacy' }]);
        expect(m.oldRead).toHaveBeenCalledWith(oldKey);
        expect(m.write).not.toHaveBeenCalled();
        expect(m.db.has(k)).toBe(false);
    });
    it('prefers current-key LS over an older database namespace when primary is absent', async () => {
        const k = 'bodega_customers_v1';
        localStorage.setItem(k, JSON.stringify([{ id: 'current' }]));
        m.oldRead.mockResolvedValue([{ id: 'old' }]);
        expect(await storage.getItem(k)).toEqual([{ id: 'current' }]);
        expect(m.oldRead).not.toHaveBeenCalled();
        expect(m.write).not.toHaveBeenCalled();
    });
    it('keeps existing primary authority when legacy LS has no version metadata', async () => {
        m.db.set(key, { primary: true });
        localStorage.setItem(key, JSON.stringify({ legacy: true }));
        expect(await storage.getItem(key)).toEqual({ primary: true });
        expect(localStorage.getItem(key)).not.toBeNull();
    });
    it.each([
        ['false', false], ['0', 0], ['null', null], ['', ''], ['raw text', 'raw text'],
    ])('preserves legacy parsing semantics for %j', async (raw, expected) => {
        localStorage.setItem(key, raw);
        expect(await storage.getItem(key, 'missing')).toEqual(expected);
        expect(m.write).not.toHaveBeenCalled();
    });
    it('rechaza lectura sin autoridad LS disponible en vez de inventar ausencia', async () => {
        m.read.mockRejectedValue(new Error('primary unavailable'));
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('LS unavailable'); });
        await expect(storage.getItem(key, 'missing')).rejects.toMatchObject({ code: 'STORAGE_READ_FAILED' });
    });
    it('returns empty-string LS fallback when primary throws', async () => {
        localStorage.setItem(key, '');
        m.read.mockRejectedValue(new Error('primary unavailable'));
        expect(await storage.getItem(key, 'missing')).toBe('');
    });
    it('no declara vigente el primario si no puede consultar sobres durables', async () => {
        m.db.set(key, { primary: true });
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('LS unavailable'); });
        await expect(storage.getItem(key)).rejects.toMatchObject({ code: 'STORAGE_READ_FAILED' });
    });
    it('returns caller default when every source is missing', async () => {
        expect(await storage.getItem('bodega_products_v1', [])).toEqual([]);
        expect(m.write).not.toHaveBeenCalled();
    });
    it('a delayed old-namespace read cannot overwrite a newer primary write', async () => {
        const k = 'bodega_customers_v1';
        const entered = deferred(), held = deferred();
        m.oldRead.mockImplementationOnce(async () => { entered.resolve(); return held.promise; });
        const reading = storage.getItem(k); await entered.promise;
        await storage.setItem(k, [{ id: 'new' }]);
        held.resolve([{ id: 'old' }]); await reading;
        expect(m.db.get(k)).toEqual([{ id: 'new' }]);
        expect(m.write).toHaveBeenCalledTimes(1);
    });
    it('a delayed legacy read cannot restore data after a clear', async () => {
        const k = 'bodega_customers_v1';
        const entered = deferred(), held = deferred();
        m.oldRead.mockImplementationOnce(async () => { entered.resolve(); return held.promise; });
        const reading = storage.getItem(k); await entered.promise;
        await storage.clearAllData();
        held.resolve([{ id: 'old' }]); await reading;
        expect(m.db.has(k)).toBe(false);
        expect(m.write).not.toHaveBeenCalled();
    });
    it('a read issued after a pending successful write waits for that write', async () => {
        m.db.set(key, { revision: 1 });
        const entered = deferred(), held = deferred();
        m.write.mockImplementation(async (k, v) => {
            entered.resolve(); await held.promise; m.db.set(k, structuredClone(v));
        });
        const write = storage.setItem(key, { revision: 2 }); await entered.promise;
        const read = storage.getItem(key); held.resolve(); await write;
        expect(await read).toEqual({ revision: 2 });
    });
    it('waiting for a failed write does not hide the last stored value or deadlock', async () => {
        m.db.set(key, { revision: 1 });
        const entered = deferred(), held = deferred();
        m.write.mockImplementation(async () => { entered.resolve(); await held.promise; throw new Error('primary denied'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('LS denied'); });
        const write = storage.setItem(key, { revision: 2 }).catch(error => error);
        await entered.promise;
        const read = storage.getItem(key); held.resolve();
        expect(await write).toMatchObject({ code: 'STORAGE_WRITE_FAILED' });
        expect(await read).toEqual({ revision: 1 });
    });
    it('explicit flush still migrates a confirmed fallback; ordinary read does not', async () => {
        m.write.mockRejectedValueOnce(new Error('primary denied'));
        await storage.setItem(key, { value: 'fallback' });
        m.write.mockClear();
        expect(await storage.getItem(key)).toEqual({ value: 'fallback' });
        expect(m.write).not.toHaveBeenCalled();
        expect(await storage.flushRetries()).toBe(1);
        expect(m.db.get(key)).toEqual({ value: 'fallback' });
        expect(localStorage.getItem(key)).toBeNull();
    });
});
