import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ db: new Map(), write: vi.fn(), remove: vi.fn(), clear: vi.fn(), requests: [] }));
vi.mock('localforage', () => ({ default: {
    config: vi.fn(), getItem: async k => structuredClone(m.db.get(k) ?? null),
    setItem: (k, v) => m.write(k, v), removeItem: k => m.remove(k), clear: () => m.clear(),
    keys: async () => [...m.db.keys()], createInstance: () => ({ getItem: async () => null }),
} }));
let originalLocks, originalSecure, a, b;
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; }
async function ticks() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function installLocks() {
    const tails = new Map();
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
        request: vi.fn((name, options, callback) => {
            m.requests.push({ name, options });
            const previous = tails.get(name) || Promise.resolve();
            const operation = previous.then(() => callback({ name, mode: options.mode }));
            tails.set(name, operation.catch(() => {}));
            return operation;
        }),
    } });
}
beforeEach(async () => {
    originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
    originalSecure = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    localStorage.clear(); m.db.clear(); m.requests.length = 0;
    m.write.mockReset().mockImplementation(async (k, v) => { m.db.set(k, structuredClone(v)); });
    m.remove.mockReset().mockImplementation(async k => { m.db.delete(k); });
    m.clear.mockReset().mockImplementation(async () => { m.db.clear(); });
    installLocks();
    vi.resetModules(); a = (await import('../src/utils/localStore')).localStore;
    vi.resetModules(); b = (await import('../src/utils/localStore')).localStore;
});
afterEach(() => {
    vi.useRealTimers(); vi.restoreAllMocks();
    if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks); else delete navigator.locks;
    if (originalSecure) Object.defineProperty(window, 'isSecureContext', originalSecure); else delete window.isSecureContext;
});
const recordKey = k => `bodega_storage_fallback_v1:${k}`;

describe('H02e exclusión entre instancias del mismo origen', () => {
    it('serializa prepare+commit de dos instancias sin perder incrementos', async () => {
        m.db.set('fixture', { count: 0 });
        const entered = deferred(), held = deferred();
        const first = a.setItem('fixture', null, { prepare: async (_, io) => {
            const value = await io.getItem('fixture'); entered.resolve(); await held.promise;
            return { count: value.count + 1 };
        } });
        await entered.promise;
        const second = b.setItem('fixture', null, { prepare: async (_, io) => ({ count: (await io.getItem('fixture')).count + 1 }) });
        await ticks(); held.resolve(); await Promise.all([first, second]);
        expect(m.db.get('fixture')).toEqual({ count: 2 });
        expect(m.requests.every(r => r.options.mode === 'exclusive')).toBe(true);
        expect(new Set(m.requests.map(r => r.name)).size).toBe(1);
    });
    it('el flush de A no pisa el nuevo snapshot estricto de B', async () => {
        localStorage.setItem(recordKey('fixture'), JSON.stringify({ version: 1, key: 'fixture', kind: 'value', value: { revision: 1 } }));
        const entered = deferred(), held = deferred();
        m.write.mockImplementationOnce(async (k, v) => { entered.resolve(); await held.promise; m.db.set(k, v); });
        const first = a.flushRetries(); await entered.promise;
        const second = b.setItem('fixture', { revision: 2 });
        await ticks(); held.resolve(); await Promise.all([first, second]);
        expect(m.db.get('fixture')).toEqual({ revision: 2 });
        expect(await a.getItem('fixture')).toEqual({ revision: 2 });
        expect(localStorage.getItem(recordKey('fixture'))).toBeNull();
    });
    it('clear de B espera un commit anterior de A', async () => {
        const entered = deferred(), held = deferred();
        m.write.mockImplementationOnce(async (k, v) => { entered.resolve(); await held.promise; m.db.set(k, v); });
        const first = a.setItem('fixture', { revision: 1 }); await entered.promise;
        const clear = b.clear(); await ticks(); held.resolve(); await Promise.all([first, clear]);
        expect(m.db.has('fixture')).toBe(false);
        expect(await a.getItem('fixture')).toBeNull();
    });
    it('nuevo guardado espera clear de otra instancia y queda después de limpiar', async () => {
        const entered = deferred(), held = deferred();
        m.clear.mockImplementationOnce(async () => { entered.resolve(); await held.promise; m.db.clear(); });
        const clear = a.clear(); await entered.promise;
        const save = b.setItem('fixture', { revision: 2 }); await ticks(); held.resolve();
        await Promise.all([clear, save]); expect(m.db.get('fixture')).toEqual({ revision: 2 });
    });
    it('remove de B no deja que el commit anterior reaparezca en IDB', async () => {
        const entered = deferred(), held = deferred();
        m.write.mockImplementationOnce(async (k, v) => { entered.resolve(); await held.promise; m.db.set(k, v); });
        const save = a.setItem('fixture', { revision: 1 }); await entered.promise;
        const remove = b.removeItem('fixture'); await ticks(); held.resolve(); await Promise.all([save, remove]);
        expect(m.db.has('fixture')).toBe(false); expect(await a.getItem('fixture')).toBeNull();
    });
    it('sin Web Locks no escribe, elimina, migra ni limpia por una vía insegura', async () => {
        Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
        localStorage.setItem(recordKey('fixture'), JSON.stringify({ version: 1, key: 'fixture', kind: 'value', value: { revision: 1 } }));
        for (const operation of [() => a.setItem('other', 1), () => a.removeItem('fixture'), () => a.clear(), () => a.flushRetries()]) {
            await expect(operation()).rejects.toMatchObject({ code: 'STORAGE_LOCK_UNAVAILABLE' });
        }
        expect(m.write).not.toHaveBeenCalled(); expect(m.remove).not.toHaveBeenCalled(); expect(m.clear).not.toHaveBeenCalled();
        expect(await a.getItem('fixture')).toEqual({ revision: 1 });
    });
    it('contexto inseguro rechaza escritura aun con un objeto locks', async () => {
        Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
        await expect(a.setItem('fixture', 1)).rejects.toMatchObject({ code: 'STORAGE_LOCK_UNAVAILABLE' });
        expect(m.write).not.toHaveBeenCalled();
    });
    it('fallo de adquisición no repite callback por mutex local', async () => {
        navigator.locks.request.mockRejectedValueOnce(new Error('acquisition denied'));
        const prepare = vi.fn(v => v);
        await expect(a.setItem('fixture', 1, { prepare })).rejects.toMatchObject({ code: 'STORAGE_LOCK_FAILED' });
        expect(prepare).not.toHaveBeenCalled(); expect(m.write).not.toHaveBeenCalled();
        await a.setItem('fixture', 2); expect(m.db.get('fixture')).toBe(2);
    });
    it('una adquisición colgada vence sin iniciar callbacks ni escribir', async () => {
        vi.useFakeTimers();
        navigator.locks.request.mockImplementationOnce((_name, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')), { once: true });
        }));
        const prepare = vi.fn(v => v);
        const result = a.setItem('fixture', 1, { prepare }).catch(error => error);
        await ticks(); await vi.advanceTimersByTimeAsync(15000);
        expect(await result).toMatchObject({ code: 'STORAGE_LOCK_FAILED' });
        expect(prepare).not.toHaveBeenCalled(); expect(m.write).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
    it('el plazo de adquisición no cancela un callback ya iniciado', async () => {
        vi.useFakeTimers(); const entered = deferred(), held = deferred();
        m.write.mockImplementationOnce(async (k, v) => { entered.resolve(); await held.promise; m.db.set(k, v); });
        const operation = a.setItem('fixture', 1); await entered.promise;
        await vi.advanceTimersByTimeAsync(20000);
        expect(m.requests[0].options.signal.aborted).toBe(false);
        held.resolve(); await operation;
        expect(m.db.get('fixture')).toBe(1); expect(m.write).toHaveBeenCalledTimes(1);
    });
    it('un error después de iniciar el commit no reejecuta efectos', async () => {
        m.write.mockRejectedValueOnce(new Error('write denied'));
        await expect(a.setItem('fixture', 1)).rejects.toMatchObject({ code: 'STORAGE_WRITE_FAILED' });
        expect(m.write).toHaveBeenCalledTimes(1);
        expect(navigator.locks.request).toHaveBeenCalledTimes(1);
        await b.setItem('fixture', 2); expect(m.db.get('fixture')).toBe(2);
    });
    it('no vuelve a adquirir el mismo bloqueo para snapshots internos de prepare', async () => {
        await a.setItem('fixture', 1, { prepare: async (v, io) => { await io.setPrimaryItem('fixture_shadow', 0); return v; } });
        expect(m.db.get('fixture_shadow')).toBe(0); expect(navigator.locks.request).toHaveBeenCalledTimes(1);
    });
    it('vigencia se comprueba después de esperar a la otra pestaña', async () => {
        const entered = deferred(), held = deferred(); let current = true;
        const first = a.setItem('fixture', 1, { prepare: async v => { entered.resolve(); await held.promise; return v; } });
        await entered.promise;
        const late = b.setItem('fixture', 2, { assertCurrent: () => { if (!current) throw new Error('stale'); } }).catch(e => e);
        await ticks(); current = false; held.resolve(); await first;
        expect((await late).message).toBe('stale'); expect(m.db.get('fixture')).toBe(1);
    });
});
