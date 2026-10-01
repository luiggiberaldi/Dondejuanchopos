import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ db: new Map(), read: vi.fn(), write: vi.fn(), remove: vi.fn(), clear: vi.fn(), oldRead: vi.fn(), push: vi.fn() }));
vi.mock('localforage', () => ({ default: {
    config: vi.fn(), getItem: k => m.read(k), setItem: (k, v) => m.write(k, v),
    removeItem: k => m.remove(k), clear: () => m.clear(), createInstance: () => ({ getItem: m.oldRead }),
} }));
vi.mock('../src/hooks/useCloudSync', () => ({ queueCloudSync: m.push }));
const key = 'durable_fixture';
const recordKey = k => `bodega_storage_fallback_v1:${k}`;
const quota = () => Object.assign(new Error('fixture quota'), { name: 'QuotaExceededError' });
const normalWrite = async (k, v) => { m.db.set(k, structuredClone(v)); };
let localStore, storageService;
async function reload() {
    vi.resetModules();
    ({ localStore } = await import('../src/utils/localStore'));
    ({ storageService } = await import('../src/utils/storageService'));
}
async function fallback(value, k = key) {
    m.write.mockRejectedValueOnce(quota());
    await storageService.setItem(k, value);
}
beforeEach(async () => {
    vi.restoreAllMocks(); localStorage.clear(); m.db.clear(); m.push.mockReset();
    m.read.mockReset().mockImplementation(async k => structuredClone(m.db.get(k) ?? null));
    m.write.mockReset().mockImplementation(normalWrite);
    m.remove.mockReset().mockImplementation(async k => { m.db.delete(k); });
    m.clear.mockReset().mockImplementation(async () => { m.db.clear(); });
    m.oldRead.mockReset().mockResolvedValue(null);
    await reload();
});
afterEach(() => vi.restoreAllMocks());

describe('H02d autoridad durable de fallbacks nuevos', () => {
    it('un fallback nuevo prevalece sobre IDB viejo antes y después de recrear el servicio', async () => {
        m.db.set(key, { revision: 1 }); await fallback({ revision: 2 });
        expect(await storageService.getItem(key)).toEqual({ revision: 2 });
        await reload();
        expect(await localStore.getItem(key)).toEqual({ revision: 2 });
        expect(m.db.get(key)).toEqual({ revision: 1 });
    });
    it('descubre y migra explícitamente el fallback después de reiniciar sin publicar por sorpresa', async () => {
        m.db.set(key, { revision: 1 }); await fallback({ revision: 2 }); await reload();
        expect(localStore.getPendingRetries()).toEqual([{ key, attempts: 0 }]);
        expect(await storageService.flushRetries()).toBe(1);
        expect(m.db.get(key)).toEqual({ revision: 2 });
        expect(localStorage.getItem(recordKey(key))).toBeNull();
        expect(m.push).not.toHaveBeenCalled();
    });
    it('conserva autoridad nueva si falla limpiar el sobre tras escribir IDB', async () => {
        await fallback({ revision: 1 });
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('cleanup denied'); });
        await storageService.setItem(key, { revision: 2 }); await reload();
        expect(await storageService.getItem(key)).toEqual({ revision: 2 });
        expect(m.db.get(key)).toEqual({ revision: 2 });
    });
    it('si no puede sustituir el sobre anterior rechaza antes de tocar IDB', async () => {
        m.db.set(key, { revision: 0 }); await fallback({ revision: 1 }); m.write.mockClear();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw quota(); });
        await expect(storageService.setItem(key, { revision: 2 })).rejects.toMatchObject({ code: 'STORAGE_WRITE_FAILED' });
        expect(m.write).not.toHaveBeenCalled(); expect(m.db.get(key)).toEqual({ revision: 0 });
        expect(await localStore.getItem(key)).toEqual({ revision: 1 });
    });
    it('writer estricto reconcilia anterior y reemplaza sin eco', async () => {
        await fallback({ revision: 1 }); await reload();
        await localStore.setItem(key, { revision: 2 });
        expect(await localStore.getItem(key)).toEqual({ revision: 2 });
        expect(await localStore.flushRetries()).toBe(0); expect(m.push).not.toHaveBeenCalled();
    });
    it('writer estricto no aplica incoming si la reconciliación del anterior falla', async () => {
        await fallback({ revision: 1 }); m.write.mockRejectedValue(quota());
        await expect(localStore.setItem(key, { revision: 2 })).rejects.toMatchObject({ code: 'STORAGE_WRITE_FAILED' });
        expect(await localStore.getItem(key)).toEqual({ revision: 1 });
        expect(m.write.mock.calls.some(([, value]) => value?.revision === 2)).toBe(false);
    });
    it('writer estricto no aplica incoming si no logra retirar autoridad anterior', async () => {
        await fallback({ revision: 1 });
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('cleanup denied'); });
        await expect(localStore.setItem(key, { revision: 2 })).rejects.toMatchObject({ code: 'STORAGE_WRITE_FAILED' });
        expect(await localStore.getItem(key)).toEqual({ revision: 1 });
        expect(m.db.get(key)).toEqual({ revision: 1 });
    });
    it.each(['123', 'null', '{"x":1}', '', false, 0])('preserva tipo JSON del fallback %j tras reinicio y flush', async value => {
        m.db.set(key, 'old'); await fallback(value); await reload();
        expect(await localStore.getItem(key)).toEqual(value);
        await localStore.flushRetries(); expect(await localStore.getItem(key)).toEqual(value);
    });
    it('null tiene semántica de ausencia consistente sin recuperar namespace viejo', async () => {
        m.oldRead.mockResolvedValue([{ id: 'old' }]);
        await storageService.setItem('bodega_customers_v1', null); await reload();
        expect(await localStore.getItem('bodega_customers_v1', [])).toEqual([]);
        await localStore.flushRetries();
        expect(await localStore.getItem('bodega_customers_v1', [])).toEqual([]);
    });
    it('rechazo doble no se redescubre como pendiente tras reinicio', async () => {
        m.write.mockRejectedValue(quota());
        const deny = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw quota(); });
        await expect(storageService.setItem(key, { rejected: true })).rejects.toMatchObject({ code: 'STORAGE_WRITE_FAILED' });
        deny.mockRestore(); await reload(); m.write.mockImplementation(normalWrite);
        expect(await localStore.flushRetries()).toBe(0); expect(m.db.has(key)).toBe(false);
    });
    it('sobre corrupto produce error incluso en fachada tolerante, sin resucitar IDB', async () => {
        m.db.set(key, { revision: 1 }); localStorage.setItem(recordKey(key), '{broken');
        await expect(storageService.getItem(key)).rejects.toMatchObject({ code: 'STORAGE_READ_FAILED' });
        await expect(localStore.setItem(key, { revision: 2 })).rejects.toMatchObject({ code: 'STORAGE_READ_FAILED' });
        expect(m.db.get(key)).toEqual({ revision: 1 }); expect(localStorage.getItem(recordKey(key))).toBe('{broken');
    });
    it.each([
        { version: 2, key, kind: 'value', value: 1 },
        { version: 1, key: 'wrong-key', kind: 'value', value: 1 },
        { version: 1, key, kind: 'value' },
        { version: 1, key, kind: 'value', value: null },
    ])('rechaza metadatos durables inválidos sin convertirlos en ausencia: %j', async record => {
        m.db.set(key, { old: true }); localStorage.setItem(recordKey(key), JSON.stringify(record));
        await expect(localStore.getItem(key)).rejects.toMatchObject({ code: 'STORAGE_READ_FAILED' });
        await expect(localStore.flushRetries()).rejects.toMatchObject({ code: 'STORAGE_READ_FAILED' });
        expect(m.db.get(key)).toEqual({ old: true });
    });
    it('sin acceso a la autoridad LS no confirma como vigente un IDB legible', async () => {
        m.db.set(key, { revision: 1 });
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('LS denied'); });
        await expect(storageService.getItem(key)).rejects.toMatchObject({ code: 'STORAGE_READ_FAILED' });
    });
    it('fallback confirmado tiene snapshot independiente de mutaciones del caller', async () => {
        const value = { revision: 1 }; await fallback(value); value.revision = 999; await reload();
        expect(await localStore.getItem(key)).toEqual({ revision: 1 });
    });
    it.each([undefined, NaN, Infinity, new Map([['x', 1]])])('no degrada silenciosamente tipos no representables %j', async value => {
        m.write.mockRejectedValue(quota());
        await expect(storageService.setItem(key, value)).rejects.toMatchObject({ code: 'STORAGE_WRITE_FAILED' });
        expect(localStorage.getItem(recordKey(key))).toBeNull();
    });
    it('guardia de clientes inspecciona el fallback más reciente tras reiniciar', async () => {
        const k = 'bodega_customers_v1'; m.db.set(k, [{ id: 'old' }]);
        await fallback(Array.from({ length: 20 }, (_, id) => ({ id })), k); await reload();
        await expect(storageService.setItem(k, [{ id: 1 }])).rejects.toThrow('[CircuitBreaker]');
        expect(await storageService.getItem(k)).toHaveLength(20);
    });
    it('remove deja tombstone durable si falla borrar IDB y no migra dato eliminado', async () => {
        m.db.set(key, { revision: 0 }); await fallback({ revision: 1 });
        m.remove.mockRejectedValueOnce(new Error('IDB remove denied'));
        await expect(localStore.removeItem(key)).rejects.toThrow(); await reload();
        expect(await localStore.getItem(key, 'missing')).toBe('missing');
        expect(await localStore.flushRetries()).toBe(0);
        expect(m.db.get(key)).toEqual({ revision: 0 });
    });
    it('remove puede descartar un sobre corrupto mediante eliminación explícita', async () => {
        localStorage.setItem(recordKey(key), '{broken'); await localStore.removeItem(key); await reload();
        expect(await localStore.getItem(key, 'missing')).toBe('missing');
    });
    it('clear descubre sobres tras reinicio y evita recuperar namespace antiguo', async () => {
        await fallback({ revision: 1 }); m.oldRead.mockResolvedValue([{ id: 'old' }]); await reload();
        localStorage.setItem('sb-fixture-auth', 'retain');
        await localStore.clear(); await reload();
        expect(await localStore.getItem(key)).toBeNull();
        expect(await localStore.getItem('bodega_customers_v1', [])).toEqual([]);
        expect(localStorage.getItem('sb-fixture-auth')).toBe('retain');
        expect(await localStore.flushRetries()).toBe(0);
    });
    it('clear no borra preferencias ni auth LS por un homónimo descubierto en IDB', async () => {
        for (const name of ['business_name', 'sb-fixture-auth', 'dj_device_id', 'abasto-auth-storage', 'bodega_autobackup_v1']) {
            localStorage.setItem(name, 'retain'); m.db.set(name, 'old-copy');
            await localStore.getItem(name);
        }
        await localStore.clear();
        for (const name of ['business_name', 'sb-fixture-auth', 'dj_device_id', 'abasto-auth-storage', 'bodega_autobackup_v1']) {
            expect(localStorage.getItem(name)).toBe('retain');
        }
    });
    it('un reemplazo estricto fallido tras eliminar no revive el namespace histórico', async () => {
        const k = 'bodega_customers_v1'; m.oldRead.mockResolvedValue([{ id: 'old' }]);
        await localStore.removeItem(k); m.write.mockRejectedValueOnce(quota());
        await expect(localStore.setItem(k, [{ id: 'new' }])).rejects.toMatchObject({ code: 'STORAGE_WRITE_FAILED' });
        await reload(); expect(await localStore.getItem(k, [])).toEqual([]);
    });
    it('no pierde propiedades extra de arrays al crear un fallback', async () => {
        const value = [1]; value.note = 'must-not-disappear';
        m.write.mockRejectedValueOnce(quota());
        await expect(storageService.setItem(key, value)).rejects.toMatchObject({ code: 'STORAGE_WRITE_FAILED' });
        expect(localStorage.getItem(recordKey(key))).toBeNull();
    });
    it('renueva origen sin eco aunque el mismo valor ya tenga retry de una operación previa', async () => {
        await fallback({ revision: 1 });
        const { runWithoutEco } = await import('../src/utils/syncFlags');
        m.write.mockRejectedValueOnce(quota());
        await runWithoutEco(() => storageService.setItem(key, { revision: 1 }));
        expect(await localStore.flushRetries()).toBe(1); expect(m.push).not.toHaveBeenCalled();
    });
    it('sigue sin adivinar precedencia entre IDB y LS raw preexistentes sin versión', async () => {
        m.db.set(key, 'primary'); localStorage.setItem(key, '"legacy"');
        expect(await localStore.getItem(key)).toBe('primary');
    });
    it('flush repetido no repone el fallback anterior a un writer silencioso', async () => {
        await fallback({ revision: 1 }); await reload();
        await localStore.setItem(key, { revision: 2 }); await localStore.flushRetries(); await reload();
        expect(await localStore.getItem(key)).toEqual({ revision: 2 });
    });
});
