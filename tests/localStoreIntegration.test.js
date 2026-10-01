import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ db: new Map(), read: vi.fn(), write: vi.fn(), clear: vi.fn(), remove: vi.fn(), push: vi.fn(), oldRead: vi.fn() }));
vi.mock('localforage', () => ({ default: {
    config: vi.fn(), getItem: key => m.read(key), setItem: (k, v) => m.write(k, v),
    clear: () => m.clear(), removeItem: key => m.remove(key), createInstance: () => ({ getItem: m.oldRead }),
} }));
vi.mock('../src/hooks/useCloudSync', () => ({ queueCloudSync: m.push }));
let localStore, storageService;
const key = 'fixture_shared_store';
const quota = () => Object.assign(new Error('fixture quota'), { name: 'QuotaExceededError' });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; }
beforeEach(async () => {
    vi.restoreAllMocks(); vi.resetModules(); localStorage.clear(); m.db.clear(); m.push.mockReset();
    m.read.mockReset().mockImplementation(async k => structuredClone(m.db.get(k) ?? null));
    m.write.mockReset().mockImplementation(async (k, v) => { m.db.set(k, structuredClone(v)); });
    m.remove.mockReset().mockImplementation(async k => { m.db.delete(k); });
    m.clear.mockReset().mockImplementation(async () => { m.db.clear(); });
    m.oldRead.mockReset().mockResolvedValue(null);
    ({ localStore } = await import('../src/utils/localStore'));
    ({ storageService } = await import('../src/utils/storageService'));
});
afterEach(() => vi.restoreAllMocks());

describe('H02c núcleo físico compartido', () => {
    it('núcleo y fachada leen LS/namespace viejo sin promover ni notificar', async () => {
        localStorage.setItem(key, JSON.stringify([{ id: 'legacy' }]));
        const events = vi.spyOn(window, 'dispatchEvent');
        expect(await localStore.getItem(key)).toEqual(await storageService.getItem(key));
        m.oldRead.mockResolvedValue([{ id: 'old' }]);
        expect(await localStore.getItem('bodega_customers_v1')).toEqual([{ id: 'old' }]);
        expect(m.write).not.toHaveBeenCalled(); expect(events).not.toHaveBeenCalled(); expect(m.push).not.toHaveBeenCalled();
    });
    it('snapshot sin eco no dispara evento ni cola cloud', async () => {
        const events = vi.spyOn(window, 'dispatchEvent');
        await localStore.setItem(key, [{ id: 'canonical' }]);
        expect(m.db.get(key)).toEqual([{ id: 'canonical' }]);
        expect(events).not.toHaveBeenCalled(); expect(m.push).not.toHaveBeenCalled();
    });
    it('solo la fachada aplica guardia comercial; snapshot explícito puede reemplazar', async () => {
        const k = 'bodega_customers_v1';
        m.db.set(k, Array.from({ length: 20 }, (_, id) => ({ id })));
        await expect(storageService.setItem(k, [{ id: 1 }])).rejects.toThrow('[CircuitBreaker]');
        await localStore.setItem(k, [{ id: 1 }]);
        expect(m.db.get(k)).toEqual([{ id: 1 }]); expect(m.push).not.toHaveBeenCalled();
    });
    it('guardia ve clientes existentes solo en LS y no evade rechazo mediante fallback', async () => {
        const k = 'bodega_customers_v1';
        localStorage.setItem(k, JSON.stringify(Array.from({ length: 20 }, (_, id) => ({ id }))));
        await expect(storageService.setItem(k, [{ id: 1 }])).rejects.toThrow('[CircuitBreaker]');
        expect(JSON.parse(localStorage.getItem(k))).toHaveLength(20);
        expect(m.db.has(k)).toBe(false);
    });
    it('escritura silenciosa invalida retry antiguo de la fachada', async () => {
        m.write.mockRejectedValueOnce(quota());
        await storageService.setItem(key, { revision: 1 });
        expect(localStore.getPendingRetries()).toHaveLength(1);
        await localStore.setItem(key, { revision: 2 });
        expect(await storageService.flushRetries()).toBe(0);
        expect(await storageService.getItem(key)).toEqual({ revision: 2 });
        expect(m.push).not.toHaveBeenCalled();
    });
    it('writer silencioso no hace fallback si IDB rechaza ni anuncia éxito', async () => {
        m.db.set(key, { revision: 1 }); m.write.mockRejectedValue(quota());
        await expect(localStore.setItem(key, { revision: 2 })).rejects.toMatchObject({ code: 'STORAGE_WRITE_FAILED' });
        expect(m.db.get(key)).toEqual({ revision: 1 });
        expect(localStorage.getItem(key)).toBeNull(); expect(localStore.getPendingRetries()).toEqual([]);
    });
    it('lector estricto aborta si no se sabe el estado; fachada conserva compatibilidad UI', async () => {
        m.read.mockRejectedValue(new Error('IDB denied'));
        await expect(localStore.getItem(key)).rejects.toMatchObject({ code: 'STORAGE_READ_FAILED' });
        expect(await storageService.getItem(key, [])).toEqual([]);
        expect(m.write).not.toHaveBeenCalled();
    });
    it('lector estricto todavía puede usar LS confirmado si IDB no está disponible', async () => {
        m.read.mockRejectedValue(new Error('IDB denied')); localStorage.setItem(key, 'false');
        expect(await localStore.getItem(key)).toBe(false);
    });
    it('lectura silenciosa espera al guardado de fachada pendiente', async () => {
        const entered = deferred(), held = deferred(); m.db.set(key, { revision: 0 });
        m.write.mockImplementationOnce(async (k, v) => { entered.resolve(); await held.promise; m.db.set(k, v); });
        const save = storageService.setItem(key, { revision: 1 }); await entered.promise;
        const read = localStore.getItem(key); held.resolve(); await save;
        expect(await read).toEqual({ revision: 1 });
    });
    it('flush en vuelo termina antes del nuevo snapshot silencioso', async () => {
        m.write.mockRejectedValueOnce(quota()); await storageService.setItem(key, { revision: 1 });
        const entered = deferred(), held = deferred();
        m.write.mockImplementationOnce(async (k, v) => { entered.resolve(); await held.promise; m.db.set(k, v); });
        const flush = storageService.flushRetries(); await entered.promise;
        const replace = localStore.setItem(key, { revision: 2 }); held.resolve(); await Promise.all([flush, replace]);
        expect(m.db.get(key)).toEqual({ revision: 2 }); expect(localStore.getPendingRetries()).toEqual([]);
    });
    it('clear espera writes anteriores y mantiene detrás los posteriores', async () => {
        const entered = deferred(), held = deferred();
        m.write.mockImplementationOnce(async (k, v) => { entered.resolve(); await held.promise; m.db.set(k, v); });
        const first = storageService.setItem(key, { revision: 1 }); await entered.promise;
        const clear = localStore.clear(); const next = localStore.setItem(key, { revision: 2 });
        held.resolve(); await Promise.all([first, clear, next]);
        expect(m.db.get(key)).toEqual({ revision: 2 }); expect(m.clear).toHaveBeenCalledTimes(1);
    });
    it('clear impide que un flush retenido repueble después datos anteriores', async () => {
        m.write.mockRejectedValueOnce(quota()); await storageService.setItem(key, { revision: 1 });
        const entered = deferred(), held = deferred();
        m.write.mockImplementationOnce(async (k, v) => { entered.resolve(); await held.promise; m.db.set(k, v); });
        const flush = storageService.flushRetries(); await entered.promise;
        const clear = localStore.clear(); held.resolve(); await Promise.all([flush, clear]);
        expect(m.db.has(key)).toBe(false); expect(await storageService.flushRetries()).toBe(0);
    });
    it('clear limpia fallbacks de claves canónicas tras recrear módulo y preserva sesión', async () => {
        localStorage.setItem('bodega_sales_v1', '[{"id":"legacy"}]');
        localStorage.setItem('sb-test-auth-token', 'fixture'); localStorage.setItem('business_name', 'Fixture');
        await localStore.clear();
        expect(localStorage.getItem('bodega_sales_v1')).toBeNull();
        expect(localStorage.getItem('sb-test-auth-token')).toBe('fixture');
        expect(localStorage.getItem('business_name')).toBe('Fixture');
    });
    it('un clear fallido rechaza y no bloquea escrituras siguientes', async () => {
        m.clear.mockRejectedValueOnce(new Error('clear denied'));
        await expect(localStore.clear()).rejects.toThrow('clear denied');
        await localStore.setItem(key, { revision: 1 }); expect(m.db.get(key)).toEqual({ revision: 1 });
    });
    it('runWithoutEco conserva origen silencioso después de salir y hacer flush', async () => {
        const { runWithoutEco } = await import('../src/utils/syncFlags');
        m.write.mockRejectedValueOnce(quota());
        await runWithoutEco(() => storageService.setItem(key, { revision: 1 }));
        expect(await storageService.flushRetries()).toBe(1);
        expect(m.push).not.toHaveBeenCalled();
    });
    it('la validación de vigencia cancela antes del commit una escritura encolada', async () => {
        const entered = deferred(), held = deferred(); let current = true;
        m.write.mockImplementationOnce(async (k, v) => { entered.resolve(); await held.promise; m.db.set(k, v); });
        const first = localStore.setItem(key, { revision: 1 }); await entered.promise;
        const late = localStore.setItem(key, { revision: 2 }, { assertCurrent: () => { if (!current) throw new Error('stale'); } }).catch(e => e);
        current = false; held.resolve(); await first;
        expect((await late).message).toBe('stale'); expect(m.db.get(key)).toEqual({ revision: 1 });
    });
    it('remove silencioso elimina fallback/retry y propaga error de borrado', async () => {
        m.write.mockRejectedValueOnce(quota()); await storageService.setItem(key, { revision: 1 });
        await localStore.removeItem(key);
        expect(await storageService.flushRetries()).toBe(0); expect(localStorage.getItem(key)).toBeNull();
        m.remove.mockRejectedValueOnce(new Error('delete denied'));
        await expect(storageService.removeItem(key)).rejects.toThrow('delete denied');
    });
});
