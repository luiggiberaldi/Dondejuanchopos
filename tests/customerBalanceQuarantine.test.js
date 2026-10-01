import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn(), getItem: vi.fn() }));
vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: {
    auth: { getSession: mocks.getSession },
    rpc: mocks.rpc,
} }));
vi.mock('../src/utils/localStore', () => ({ localStore: { getItem: mocks.getItem } }));
vi.mock('../src/hooks/store/useAuthStore', () => ({ useAuthStore: { getState: () => ({}) } }));
vi.mock('../src/hooks/useSupervisorCommands', () => ({ useSupervisorCommands: vi.fn() }));
vi.mock('../src/config/backupKeys', () => ({ IDB_KEYS: ['bodega_customers_v1'], LS_KEYS: [] }));
vi.mock('../src/utils/syncFlags', () => ({ registerCloudSyncSetter: vi.fn() }));
vi.mock('../src/utils/salesPushMerge', () => ({ prepareSalesPushPayload: vi.fn(), fetchCloudSalesReference: vi.fn() }));

import { forceSyncAllPOSData, pushCloudSync } from '../src/hooks/useCloudSync';
import { mergeCloudCustomers } from '../src/utils/customerSyncGuard';

const key = 'bodega_customers_v1';
const hashKey = `bodega_last_periodic_push_hash_${key}`;
const deviceId = 'local-customer-quarantine-test';

beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('dj_device_id', deviceId);
    mocks.rpc.mockReset().mockResolvedValue({ error: null });
    mocks.getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null });
    mocks.getItem.mockReset().mockResolvedValue(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Enable the real push gate without mounting hooks, starting timers, or accessing real storage/cloud.
    await expect(forceSyncAllPOSData(deviceId)).resolves.toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalled();
});

afterEach(() => vi.restoreAllMocks());

const invalidPayloads = [
    ['unconfirmed favor', [{ id: 'high-favor', favor: 300.01, deuda: 20 }]],
    ['unconfirmed debt', [{ id: 'high-debt', favor: 20, deuda: 2500.01 }]],
    ['both high balances', [{ id: 'high-both', favor: 2022.97, deuda: 3000 }]],
    ['confirmed infinity', [{ id: 'infinity', favor: Infinity, deuda: 0, isExplicitHighAmount: true }]],
    ['confirmed NaN debt', [{ id: 'nan', favor: 0, deuda: NaN, isExplicitHighAmount: true }]],
    ['confirmed negative', [{ id: 'negative', favor: -1, deuda: 0, isExplicitHighAmount: true }]],
    ['truthy string confirmation', [{ id: 'truthy', favor: 1000, deuda: 0, isExplicitHighAmount: 'true' }]],
    ['malformed confirmed row', [{ favor: 1000, deuda: 0, isExplicitHighAmount: true }]],
    ['null row', [null]],
    ['non-array payload', { id: 'not-array', favor: 1000, deuda: 0 }],
    ['null payload', null],
    ['string payload', '[]'],
];

describe.each([false, true])('Customer push quarantine (forced=%s)', forceUnconditional => {
    it.each(invalidPayloads)('blocks %s before RPC or hash access', async (_label, payload) => {
        if (Array.isArray(payload)) {
            payload.forEach(customer => { if (customer) Object.freeze(customer); });
        }
        if (payload && typeof payload === 'object') Object.freeze(payload);
        localStorage.setItem(hashKey, 'previous-successful-hash');
        const getItem = vi.spyOn(Storage.prototype, 'getItem');
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        const stringify = vi.spyOn(JSON, 'stringify');

        await expect(pushCloudSync(key, payload, forceUnconditional)).resolves.toBe(false);

        expect(mocks.rpc).not.toHaveBeenCalled();
        expect(getItem).not.toHaveBeenCalledWith(hashKey);
        expect(setItem).not.toHaveBeenCalled();
        expect(stringify.mock.calls.some(([value]) => value === payload)).toBe(false);
        expect(localStorage.getItem(hashKey)).toBe('previous-successful-hash');
        if (Array.isArray(payload)) {
            payload.forEach(customer => {
                if (customer) expect(customer).not.toHaveProperty('_quarantinedAnomaly');
            });
        }
    });
});

describe('Customer push preserves authorized values', () => {
    it.each([
        ['threshold boundaries', { id: 'boundary', favor: 300, deuda: 2500 }],
        ['explicitly high values', { id: 'explicit', favor: 1000, deuda: 3000, isExplicitHighAmount: true }],
        ['numeric string amounts', { id: 'strings', favor: '0301.00', deuda: '02501.00', isExplicitHighAmount: true }],
    ])('uploads %s unchanged and records a hash only on success', async (_label, customer) => {
        const payload = Object.freeze([Object.freeze(customer)]);
        await expect(pushCloudSync(key, payload)).resolves.toBe(true);
        expect(mocks.rpc).toHaveBeenCalledTimes(1);
        expect(mocks.rpc).toHaveBeenCalledWith('write_paired_sync_document', {
            p_device_id: deviceId,
            p_collection: 'store',
            p_doc_id: key,
            p_data: { payload },
        });
        expect(mocks.rpc.mock.calls[0][1].p_data.payload).toBe(payload);
        expect(localStorage.getItem(hashKey)).not.toBeNull();
        await expect(pushCloudSync(key, payload)).resolves.toBe(true);
        expect(mocks.rpc).toHaveBeenCalledTimes(1);
    });

    it('leaves no successful hash after a rejected payload, then permits an explicit confirmation', async () => {
        const original = Object.freeze({ id: 'reviewed', favor: 2022.97, deuda: 3000 });
        await expect(pushCloudSync(key, [original])).resolves.toBe(false);
        expect(mocks.rpc).not.toHaveBeenCalled();
        expect(localStorage.getItem(hashKey)).toBeNull();

        const confirmed = { ...original, isExplicitHighAmount: true };
        await expect(pushCloudSync(key, [confirmed])).resolves.toBe(true);
        expect(mocks.rpc).toHaveBeenCalledTimes(1);
        expect(mocks.rpc.mock.calls[0][1].p_data.payload).toEqual([confirmed]);
        expect(original.favor).toBe(2022.97);
        expect(original).not.toHaveProperty('isExplicitHighAmount');
    });

    it('never publishes an unresolved high local balance after a cloud merge', async () => {
        const local = { id: 'same', favor: 2022.97, deuda: 100, updatedAt: '2026-09-10T12:00:00Z' };
        const cloud = { id: 'same', favor: 0, deuda: 0, updatedAt: '2026-09-11T12:00:00Z' };
        const merged = mergeCloudCustomers([cloud], [local]);
        expect(merged).toEqual([{ ...local, _quarantinedAnomaly: true }]);
        await expect(pushCloudSync(key, merged)).resolves.toBe(false);
        expect(mocks.rpc).not.toHaveBeenCalled();
        expect(localStorage.getItem(hashKey)).toBeNull();
    });

    it('keeps a newly created explicitly high local customer through merge and push', async () => {
        const local = { id: 'new-local', favor: 1000, deuda: 3000, isExplicitHighAmount: true };
        const merged = mergeCloudCustomers([], [local]);
        await expect(pushCloudSync(key, merged)).resolves.toBe(true);
        expect(mocks.rpc.mock.calls[0][1].p_data.payload).toEqual([local]);
    });
});
