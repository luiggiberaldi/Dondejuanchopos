import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    fetch: vi.fn(),
    setItem: vi.fn(),
    channels: [],
    store: new Map(),
}));
vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: {
        from: () => ({ select() { return this; }, eq() { return this; },
            maybeSingle: async () => ({ data: { last_seen_at: new Date().toISOString() }, error: null }) }),
        rpc: vi.fn(async () => ({ data: {}, error: null })),
        channel: () => {
            const channel = {
                on(_type, _filter, callback) { this.event = callback; return this; },
                subscribe(callback) { this.status = callback; return this; },
            };
            mocks.channels.push(channel);
            return channel;
        },
        removeChannel: vi.fn(async () => undefined),
    },
}));
vi.mock('../src/services/remoteAuditService', () => ({
    fetchRemoteDocuments: mocks.fetch,
    REMOTE_MONITOR_DOC_IDS: ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1'],
}));
vi.mock('localforage', () => ({ default: {
    config: vi.fn(),
    getItem: async key => mocks.store.get(key),
    setItem: mocks.setItem,
} }));
vi.mock('../src/utils/syncFlags', () => ({ runWithoutEco: async fn => fn() }));
import { useMonitorSync } from '../src/hooks/useMonitorSync';

const T1 = '2026-09-12T03:00:00.123456+00:00';
const T2 = '2026-09-12T03:01:00.123456+00:00';
const T3 = '2026-09-12T03:02:00.123456+00:00';
const doc = (doc_id, updated_at, payload = []) => ({ doc_id, updated_at, collection: 'store', payload });
const result = documents => ({ success: true, documents });
let root;
let host;
function Harness({ device = 'register-a' }) { useMonitorSync(device); return null; }
async function mount(device = 'register-a') {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(Harness, { device })));
}
async function tick(ms = 30000) { await act(async () => vi.advanceTimersByTimeAsync(ms)); }
async function emit(document) {
    await act(async () => mocks.channels.at(-1).event({ eventType: 'UPDATE', new: {
        ...document, data: { payload: document.payload },
    } }));
}
beforeEach(() => {
    vi.useFakeTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    localStorage.setItem('dj_device_id', 'monitor-a');
    localStorage.setItem('dj_paired_device_id', 'register-a');
    mocks.channels.length = 0;
    mocks.store.clear();
    mocks.fetch.mockReset().mockResolvedValue(result([]));
    mocks.setItem.mockReset().mockImplementation(async (key, value) => mocks.store.set(key, value));
});
afterEach(async () => {
    if (root) await act(async () => root.unmount());
    host?.remove();
    root = null;
    vi.useRealTimers();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe('Supervisor monitor catch-up recovery', () => {
    it('polls protected reads even when the websocket reports SUBSCRIBED but sends no rows', async () => {
        mocks.fetch.mockResolvedValueOnce(result([doc('bodega_sales_v1', T1)]));
        await mount();
        await act(async () => mocks.channels[0].status('SUBSCRIBED'));
        mocks.fetch.mockResolvedValue(result([doc('bodega_sales_v1', T2, [{ id: 'new-sale' }])]));
        await tick();
        expect(mocks.fetch.mock.calls.length).toBeGreaterThan(1);
        expect(mocks.store.get('bodega_sales_v1')[0].id).toBe('new-sale');
    });

    it('never advances the catch-up cursor from a single realtime document', async () => {
        mocks.fetch.mockResolvedValueOnce(result([doc('bodega_sales_v1', T1)]));
        await mount();
        await emit(doc('bodega_products_v1', T3));
        await act(async () => document.dispatchEvent(new Event('visibilitychange')));
        await tick();
        expect(mocks.fetch.mock.calls.at(-1)[3].updatedAfter).toBe(T1);
    });

    it('retries a failed document instead of advancing beyond its version', async () => {
        mocks.fetch.mockResolvedValueOnce(result([doc('bodega_sales_v1', T1)]));
        await mount();
        mocks.fetch.mockResolvedValue(result([
            doc('bodega_customers_v1', T2, [{ id: 'customer' }]), doc('bodega_products_v1', T3),
        ]));
        mocks.setItem.mockImplementationOnce(async () => { throw new Error('storage unavailable'); });
        await tick();
        await tick();
        expect(mocks.fetch.mock.calls[2][3].updatedAfter).toBe(T1);
        expect(mocks.store.get('bodega_customers_v1')).toEqual([{ id: 'customer' }]);
    });

    it('starts with a full pull despite stale persisted timestamps from a previous session', async () => {
        localStorage.setItem('dj_monitor_last_full_pull_ts', String(Date.now()));
        localStorage.setItem('monitor_last_sync', new Date().toISOString());
        await mount();
        expect(mocks.fetch.mock.calls[0][3].updatedAfter).toBeNull();
    });

    it('does not let an old pull overwrite a newer realtime sales snapshot', async () => {
        mocks.fetch.mockResolvedValueOnce(result([doc('bodega_sales_v1', T1)]));
        await mount();
        await emit(doc('bodega_sales_v1', T3, [{ id: 'fresh' }]));
        mocks.fetch.mockResolvedValue(result([doc('bodega_sales_v1', T2, [{ id: 'old' }])]));
        await tick();
        expect(mocks.store.get('bodega_sales_v1')[0].id).toBe('fresh');
    });

    it('ignores a pull that completes after unmount without reopening a channel', async () => {
        let resolvePull;
        mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { resolvePull = resolve; }));
        await mount();
        await act(async () => root.unmount());
        root = null;
        await act(async () => resolvePull(result([doc('bodega_sales_v1', T1, [{ id: 'late' }])])));
        expect(mocks.channels).toHaveLength(0);
        expect(mocks.store.has('bodega_sales_v1')).toBe(false);
    });

    it('ejecuta el pull completo solicitado mientras otro incremental está en vuelo', async () => {
        mocks.fetch.mockResolvedValueOnce(result([doc('bodega_sales_v1', T1)]));
        await mount();
        let resolvePull;
        mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { resolvePull = resolve; }));
        await tick();
        const previousCount = mocks.fetch.mock.calls.length;
        await act(async () => window.dispatchEvent(new CustomEvent('supervisor_sync_requested')));
        expect(mocks.fetch.mock.calls.length).toBe(previousCount);
        mocks.fetch.mockResolvedValue(result([doc('bodega_sales_v1', T2)]));
        await act(async () => {
            resolvePull(result([doc('bodega_sales_v1', T2)]));
            await Promise.resolve();
        });
        await tick(1);
        expect(mocks.fetch.mock.calls.length).toBe(previousCount + 1);
        expect(mocks.fetch.mock.calls.at(-1)[3].updatedAfter).toBeNull();
    });

    it('reintenta el pull completo fallido sin crear un bucle inmediato', async () => {
        mocks.fetch.mockResolvedValueOnce(result([doc('bodega_sales_v1', T1)]));
        await mount();
        mocks.fetch.mockResolvedValueOnce({ success: false, error: { message: 'red' } });
        await act(async () => window.dispatchEvent(new CustomEvent('supervisor_sync_requested')));
        expect(mocks.fetch.mock.calls).toHaveLength(2);
        await tick();
        expect(mocks.fetch.mock.calls[2][3].updatedAfter).toBeNull();
    });

    it('el eco de A no marca como observada ni elimina una tasa B creada por un listener', async () => {
        await mount();
        const pendingKey = 'dj_supervisor_rate_pending_v1';
        localStorage.setItem(pendingKey, JSON.stringify({ commandId: 'rate-a', desired: { customRate: '100' } }));
        const newer = { commandId: 'rate-b', desired: { customRate: '200' },
            observed: { bodega_rate_mode: true, bodega_use_auto_rate: true } };
        const onUpdate = event => {
            if (event.detail?.key === 'bodega_custom_rate') {
                localStorage.setItem(pendingKey, JSON.stringify(newer));
                localStorage.setItem('bodega_custom_rate', '200');
            }
        };
        window.addEventListener('app_storage_update', onUpdate);
        try {
            await emit({ ...doc('bodega_custom_rate', T2, '100'), collection: 'local' });
        } finally { window.removeEventListener('app_storage_update', onUpdate); }
        expect(JSON.parse(localStorage.getItem(pendingKey))).toEqual(newer);
        expect(localStorage.getItem('bodega_custom_rate')).toBe('200');
    });

    it('does not use the client clock as a cursor after an empty first pull', async () => {
        await mount();
        await tick();
        expect(mocks.fetch.mock.calls.at(-1)[3].updatedAfter).toBeNull();
    });
});
