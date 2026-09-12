import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
    rpc: vi.fn(), heartbeat: vi.fn(), session: vi.fn(), signals: [], store: new Map(), commands: vi.fn(),
}));
vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: {
    auth: { getSession: m.session },
    rpc: m.rpc,
    removeChannel: vi.fn(async () => undefined),
} }));
vi.mock('localforage', () => ({ default: {
    createInstance: () => ({ getItem: async key => m.store.get(key) ?? null }),
} }));
vi.mock('../src/hooks/useSupervisorCommands', () => ({ useSupervisorCommands: m.commands }));
vi.mock('../src/hooks/store/useAuthStore', () => ({ useAuthStore: { getState: () => ({}) } }));
vi.mock('../src/config/backupKeys', () => ({ IDB_KEYS: ['bodega_sales_v1'], LS_KEYS: [] }));
vi.mock('../src/utils/syncFlags', () => ({ registerCloudSyncSetter: vi.fn() }));
vi.mock('../src/utils/salesPushMerge', () => ({ prepareSalesPushPayload: vi.fn(), fetchCloudSalesReference: vi.fn() }));
vi.mock('../src/utils/customerSyncGuard', () => ({ validateCustomerSyncPayload: vi.fn(), mergeCloudCustomers: vi.fn() }));
import { useCloudSync, pushCloudSync } from '../src/hooks/useCloudSync';

let root, host, statuses;
const device = 'pos-local-test';
function Harness({ id = device }) { useCloudSync(id); return null; }
const success = () => ({ data: { success: true, registered: true }, error: null, status: 200 });
function request(promise) {
    return {
        then(resolve, reject) { return promise.then(resolve, reject); },
        abortSignal(signal) {
            m.signals.push(signal);
            return new Promise((resolve, reject) => {
                const abort = () => reject(new DOMException('Aborted', 'AbortError'));
                if (signal.aborted) { abort(); return; }
                signal.addEventListener('abort', abort, { once: true });
                promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
                    error => { signal.removeEventListener('abort', abort); reject(error); });
            });
        },
    };
}
async function mount(strict = false, id = device) {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    const element = createElement(Harness, { id });
    await act(async () => root.render(strict ? createElement(StrictMode, null, element) : element));
}
async function tick(ms) { await act(async () => vi.advanceTimersByTimeAsync(ms)); }
async function event(name) { await act(async () => window.dispatchEvent(new Event(name))); }
const heartbeatCalls = () => m.rpc.mock.calls.filter(([name]) => name === 'touch_pos_heartbeat');
const registrations = () => m.rpc.mock.calls.filter(([name]) => name === 'register_pos_device');
const statusListener = event => statuses.push(event.detail);
beforeEach(() => {
    vi.useFakeTimers(); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear(); localStorage.setItem('dj_device_id', device);
    localStorage.setItem('dj_egress_hash_purge_v2', '1');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    m.store.clear(); m.signals.length = 0; m.commands.mockClear();
    m.session.mockReset().mockResolvedValue({ data: { session: null }, error: null });
    m.heartbeat.mockReset().mockResolvedValue(success());
    m.rpc.mockReset().mockImplementation((name, args) => request(Promise.resolve().then(() => (
        name === 'touch_pos_heartbeat' ? m.heartbeat(args) : { data: { success: true }, error: null, status: 200 }
    ))));
    statuses = []; window.addEventListener('cloud_pos_presence', statusListener);
});
afterEach(async () => {
    if (root) await act(async () => root.unmount());
    root = null; host?.remove(); window.removeEventListener('cloud_pos_presence', statusListener);
    vi.restoreAllMocks(); vi.useRealTimers(); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe('Presencia POS: fallo de transporte independiente del cobro', () => {
    it('no inicia heartbeat POS ni registro si el modo explícito es monitor', async () => {
        localStorage.setItem('dj_pairing_mode', 'monitor'); await mount(); await tick(180000);
        expect(heartbeatCalls()).toHaveLength(0); expect(registrations()).toHaveLength(0);
    });
    it('un monitor sin emparejamiento no cae al heartbeat POS', async () => {
        localStorage.setItem('dj_pairing_mode', 'monitor'); localStorage.removeItem('dj_paired_device_id');
        await mount(); expect(heartbeatCalls()).toHaveLength(0);
    });
    it('no deduce el rol del prefijo del identificador', async () => {
        const formerMonitor = 'mon_fixture_local'; localStorage.setItem('dj_device_id', formerMonitor);
        await mount(false, formerMonitor);
        expect(heartbeatCalls()[0]?.[1]).toEqual({ p_device_id: formerMonitor });
    });
    it('respeta una petición en vuelo ante eventos online y de visibilidad', async () => {
        let finish; m.heartbeat.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        await mount(); await event('online'); await event('online');
        await act(async () => document.dispatchEvent(new Event('visibilitychange')));
        expect(heartbeatCalls()).toHaveLength(1);
        await act(async () => finish(success()));
    });
    it('reintenta 504 con espera creciente y no registra otra caja ni modifica ventas', async () => {
        const sale = [{ id: 'sale-local-test', totalUsd: 1.6 }]; m.store.set('bodega_sales_v1', sale);
        m.heartbeat.mockResolvedValue({ data: null, error: { message: 'Gateway Timeout', status: 504 }, status: 504 });
        await mount();
        expect(statuses.at(-1)).toMatchObject({ status: 'retrying', reason: 'gateway_timeout', retryInMs: 15000 });
        await tick(14999); expect(heartbeatCalls()).toHaveLength(1);
        await tick(1); expect(heartbeatCalls()).toHaveLength(2);
        expect(statuses.at(-1)?.retryInMs).toBe(30000);
        await tick(30000); expect(heartbeatCalls()).toHaveLength(3);
        expect(statuses.at(-1)?.retryInMs).toBe(60000);
        expect(registrations()).toHaveLength(0); expect(m.store.get('bodega_sales_v1')).toEqual(sale);
    });
    it('Failed to fetch no se presenta como rechazo del cobro o pérdida de emparejamiento', async () => {
        localStorage.setItem('dj_pairing_code', 'fixture-keep');
        m.heartbeat.mockRejectedValueOnce(new TypeError('Failed to fetch')); await mount();
        expect(statuses.at(-1)).toMatchObject({ status: 'retrying', reason: 'network_error' });
        expect(localStorage.getItem('dj_pairing_code')).toBe('fixture-keep');
        await expect(pushCloudSync('bodega_sales_v1', [{ id: 'sale' }], true)).resolves.toBe(true);
        expect(registrations()).toHaveLength(0);
    });
    it('recupera presencia tras 504 y vuelve a la cadencia normal sin ráfagas', async () => {
        m.heartbeat.mockResolvedValueOnce({ data: null, error: { status: 504, message: 'Gateway Timeout' }, status: 504 });
        await mount(); await tick(15000);
        expect(statuses.at(-1)).toMatchObject({ status: 'online', retryInMs: 60000 });
        await event('online'); await event('online'); await tick(44999);
        expect(heartbeatCalls()).toHaveLength(2);
    });
    it('limita el tiempo de una petición colgada y cancela en desmontaje', async () => {
        m.heartbeat.mockImplementation(() => new Promise(() => {}));
        await mount(); await tick(20000);
        expect(m.signals[0]?.aborted).toBe(true);
        expect(statuses.at(-1)).toMatchObject({ status: 'retrying', reason: 'timeout' });
        await tick(15000); expect(heartbeatCalls()).toHaveLength(2);
        await act(async () => root.unmount()); root = null;
        expect(m.signals.at(-1)?.aborted).toBe(true);
        await tick(180000); expect(heartbeatCalls()).toHaveLength(2);
    });
    it('no continúa al convertirse en monitor mientras espera el heartbeat', async () => {
        let finish; m.heartbeat.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        await mount(); localStorage.setItem('dj_pairing_mode', 'monitor');
        await act(async () => finish({ data: { success: false, registered: false }, error: null }));
        await tick(120000); expect(registrations()).toHaveLength(0); expect(heartbeatCalls()).toHaveLength(1);
    });
    it('offline detiene presencia y online permite recuperarla una sola vez', async () => {
        await mount(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        await event('offline'); await tick(120000); expect(heartbeatCalls()).toHaveLength(1);
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
        await event('online'); await event('online'); expect(heartbeatCalls()).toHaveLength(2);
    });
    it('la inicialización tardía no reabre la sincronización después de desmontarse', async () => {
        let finish; m.session.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        await mount(); await act(async () => root.unmount()); root = null;
        await act(async () => finish({ data: { session: null }, error: null }));
        await expect(pushCloudSync('bodega_sales_v1', [{ id: 'late-sale' }], true)).resolves.toBe(false);
        expect(m.rpc.mock.calls.filter(([name]) => name === 'write_paired_sync_document')).toHaveLength(0);
    });
    it('StrictMode conserva los timers y el estado de sincronización del montaje vigente', async () => {
        await mount(true); const before = heartbeatCalls().length; await tick(60000);
        expect(heartbeatCalls().length).toBeGreaterThan(before);
        await expect(pushCloudSync('bodega_sales_v1', [{ id: 'strict-sale' }], true)).resolves.toBe(true);
    });
    it('la presencia sigue funcionando aunque Auth no autorice los documentos', async () => {
        m.session.mockResolvedValue({ data: { session: { user: { id: 'another-user' } } }, error: null });
        await mount(); expect(heartbeatCalls()).toHaveLength(1);
        await expect(pushCloudSync('bodega_sales_v1', [{ id: 'not-pushed' }], true)).resolves.toBe(false);
        expect(registrations()).toHaveLength(0);
    });
});
