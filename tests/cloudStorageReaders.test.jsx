import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ db: new Map(), old: new Map(), read: vi.fn(), write: vi.fn(), rpc: vi.fn() }));
vi.mock('localforage', () => ({ default: {
    config: vi.fn(), getItem: key => m.read(key), setItem: m.write,
    createInstance: () => ({ getItem: async key => m.old.get(key) ?? null }),
} }));
vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: {
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    rpc: m.rpc, removeChannel: vi.fn(),
} }));
vi.mock('../src/hooks/useSupervisorCommands', () => ({ useSupervisorCommands: vi.fn() }));
vi.mock('../src/hooks/store/useAuthStore', () => ({ useAuthStore: { getState: () => ({}) } }));
vi.mock('../src/config/backupKeys', () => ({
    IDB_KEYS: ['bodega_customers_v1', 'bodega_products_v1', 'bodega_accounts_v2'], LS_KEYS: [], PROTECTED_KEYS: [],
}));
vi.mock('../src/utils/customerSyncGuard', () => ({ validateCustomerSyncPayload: value => ({ valid: true, sanitized: value }), mergeCloudCustomers: value => value }));
let forceSyncAllPOSData, useCloudSync, root, host;
const device = 'qa-local-only';
const writes = () => m.rpc.mock.calls.filter(([name]) => name === 'write_paired_sync_document');
async function mount() {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    function Harness() { useCloudSync(device); return null; }
    await act(async () => root.render(createElement(Harness)));
}
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(1); }); }
beforeEach(async () => {
    vi.resetModules(); localStorage.clear(); m.db.clear(); m.old.clear();
    localStorage.setItem('dj_device_id', device); localStorage.setItem('dj_egress_hash_purge_v3', '1');
    m.read.mockReset().mockImplementation(async k => m.db.get(k) ?? null); m.write.mockReset();
    m.rpc.mockReset().mockResolvedValue({ data: { success: true, registered: true }, error: null });
    ({ forceSyncAllPOSData, useCloudSync } = await import('../src/hooks/useCloudSync'));
    vi.useFakeTimers(); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(async () => {
    if (root) await act(async () => root.unmount()); root = null; host?.remove();
    vi.useRealTimers(); vi.restoreAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});
describe('Sync usa lecturas comunes sin migración (RPC simulado)', () => {
    it.each([
        ['bodega_customers_v1', 'my_customers_v1'],
        ['bodega_products_v1', 'my_products_v1'],
        ['bodega_accounts_v2', 'my_accounts_v2'],
    ])('full push ve %s desde LS y namespace histórico', async (key, oldKey) => {
        const value = [{ id: 'fixture', name: 'Fixture' }];
        localStorage.setItem(key, JSON.stringify(value));
        expect(await forceSyncAllPOSData(device)).toBe(true);
        expect(writes().some(([, args]) => args.p_doc_id === key && args.p_data.payload[0].id === 'fixture')).toBe(true);
        expect(m.write).not.toHaveBeenCalled(); expect(localStorage.getItem(key)).not.toBeNull();
        localStorage.removeItem(key); m.old.set(oldKey, [{ id: 'legacy', name: 'Legacy' }]); m.rpc.mockClear();
        expect(await forceSyncAllPOSData(device)).toBe(true);
        expect(writes().some(([, args]) => args.p_doc_id === key && args.p_data.payload[0].id === 'legacy')).toBe(true);
        expect(m.write).not.toHaveBeenCalled();
    });
    it('full push prefiere sobre durable nuevo aunque IDB contenga un snapshot viejo', async () => {
        const key = 'bodega_accounts_v2'; m.db.set(key, [{ id: 'old' }]);
        localStorage.setItem(`bodega_storage_fallback_v1:${key}`, JSON.stringify({
            version: 1, key, kind: 'value', value: [{ id: 'durable-new' }],
        }));
        expect(await forceSyncAllPOSData(device)).toBe(true);
        expect(writes().some(([, args]) => args.p_doc_id === key && args.p_data.payload[0].id === 'durable-new')).toBe(true);
        expect(m.write).not.toHaveBeenCalled(); expect(m.db.get(key)).toEqual([{ id: 'old' }]);
    });
    it('full push falla si lectura es incierta y no estampa hash ni RPC de datos', async () => {
        m.read.mockRejectedValue(new Error('IDB unavailable'));
        expect(await forceSyncAllPOSData(device)).toBe(false);
        expect(writes()).toHaveLength(0);
        expect(localStorage.getItem('bodega_last_periodic_push_hash_bodega_customers_v1')).toBeNull();
    });
    it('arranque, online y temporizador leen fallback cambiado y respetan hash', async () => {
        const key = 'bodega_accounts_v2';
        localStorage.setItem(key, '[{"id":"first"}]');
        await mount(); await settle();
        expect(writes().some(([, args]) => args.p_doc_id === key && args.p_data.payload[0].id === 'first')).toBe(true);
        localStorage.setItem(key, '[{"id":"online"}]'); m.rpc.mockClear();
        await act(async () => window.dispatchEvent(new Event('online'))); await settle();
        expect(writes().some(([, args]) => args.p_data.payload[0]?.id === 'online')).toBe(true);
        localStorage.setItem(key, '[{"id":"timer"}]'); m.rpc.mockClear();
        await act(async () => vi.advanceTimersByTimeAsync(60000));
        expect(writes().some(([, args]) => args.p_data.payload[0]?.id === 'timer')).toBe(true);
        m.rpc.mockClear(); await act(async () => vi.advanceTimersByTimeAsync(60000));
        expect(writes()).toHaveLength(0); expect(m.write).not.toHaveBeenCalled();
    });
    it('rama de importación ve dato histórico sin promoverlo', async () => {
        localStorage.setItem('dj_backup_imported_flag', 'true');
        m.old.set('my_accounts_v2', [{ id: 'imported' }]);
        await mount(); await settle();
        expect(writes().some(([, args]) => args.p_data.payload[0]?.id === 'imported')).toBe(true);
        expect(localStorage.getItem('dj_backup_imported_flag')).toBeNull();
        expect(m.write).not.toHaveBeenCalled();
    });
});
