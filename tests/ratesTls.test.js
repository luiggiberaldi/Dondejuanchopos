import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let handler;
function response() {
    return {
        headers: {}, statusCode: 0, body: null,
        setHeader(key, value) { this.headers[key] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; }, end() { return this; },
    };
}
function validFallback(url) {
    if (url.includes('bcv.org.ve')) {
        const error = new Error('unable to verify the first certificate');
        error.cause = { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' };
        return Promise.reject(error);
    }
    if (url.endsWith('/dolares')) return Promise.resolve({ ok: true, json: async () => [{ fuente: 'oficial', promedio: 100 }] });
    if (url.endsWith('/euros')) return Promise.resolve({ ok: true, json: async () => [{ fuente: 'oficial', promedio: 110 }] });
    return Promise.resolve({ ok: true, json: async () => ({ ask: 120, bid: 118 }) });
}
beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    ({ default: handler } = await import('../api/rates.js'));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Tasas: TLS verificado y degradación controlada', () => {
    it('configuración y API no desactivan certificados globalmente', () => {
        for (const path of ['vite.config.js', 'api/rates.js']) {
            const source = readFileSync(path, 'utf8');
            expect(source).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]0['"]/);
            expect(source).not.toMatch(/rejectUnauthorized\s*:\s*false/);
        }
    });
    it('un error de certificado directo usa la fuente de respaldo sin relajar TLS', async () => {
        const fetchMock = vi.fn(validFallback); vi.stubGlobal('fetch', fetchMock);
        const envBefore = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        const res = response(); await handler({ method: 'GET' }, res);
        expect(res.statusCode).toBe(200);
        expect(res.body.bcv).toMatchObject({ price: 100, source: 'BCV DolarApi' });
        expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe(envBefore);
        for (const [, options] of fetchMock.mock.calls) {
            expect(options).not.toHaveProperty('rejectUnauthorized', false);
            expect(options).not.toHaveProperty('dispatcher');
        }
    });
    it('sin fuente válida ni caché responde 503 sin fabricar una tasa fresca', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('certificate rejected')));
        const res = response(); await handler({ method: 'GET' }, res);
        expect(res.statusCode).toBe(503); expect(res.body).not.toHaveProperty('bcv');
    });
    it('si fallan las fuentes, conserva el sello temporal y marca la caché antigua', async () => {
        const fetchMock = vi.fn(validFallback); vi.stubGlobal('fetch', fetchMock);
        const first = response(); await handler({ method: 'GET' }, first);
        await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
        fetchMock.mockRejectedValue(new Error('certificate rejected'));
        const next = response(); await handler({ method: 'GET' }, next);
        expect(next.headers['X-Cache']).toBe('STALE'); expect(next.body.stale).toBe(true);
        expect(next.body.lastUpdate).toBe(first.body.lastUpdate);
        expect(next.body.bcv.price).toBe(first.body.bcv.price);
    });
    it('la espera de la fuente directa no consume el timeout del respaldo', async () => {
        let finishDirect;
        const fetchMock = vi.fn(url => url.includes('bcv.org.ve')
            ? new Promise(resolve => { finishDirect = resolve; }) : validFallback(url));
        vi.stubGlobal('fetch', fetchMock);
        const res = response(); const running = handler({ method: 'GET' }, res);
        await vi.advanceTimersByTimeAsync(6500);
        finishDirect({ ok: false }); await running;
        const fallbackOptions = fetchMock.mock.calls.find(([url]) => url.endsWith('/dolares'))[1];
        expect(fallbackOptions.signal.aborted).toBe(false);
        expect(res.statusCode).toBe(200);
    });
});
