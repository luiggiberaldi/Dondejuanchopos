import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const idbMemory = new Map();
const mocks = vi.hoisted(() => ({
    rpc: vi.fn(),
    fetchCloudSalesReference: vi.fn(),
    prepareSalesPushPayload: vi.fn(),
}));

vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: {
        auth: { getSession: vi.fn(async () => ({ data: { session: null }, error: null })) },
        rpc: (...args) => mocks.rpc(...args),
        removeChannel: vi.fn(async () => undefined),
    },
}));

vi.mock('../src/utils/salesPushMerge', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        fetchCloudSalesReference: (...args) => mocks.fetchCloudSalesReference(...args),
        prepareSalesPushPayload: (...args) => mocks.prepareSalesPushPayload(...args),
    };
});

vi.mock('../src/hooks/useSupervisorCommands', () => ({
    useSupervisorCommands: vi.fn(),
}));

vi.mock('localforage', () => ({
    default: {
        config: vi.fn(),
        getItem: vi.fn(async (k) => (idbMemory.has(k) ? idbMemory.get(k) : null)),
        setItem: vi.fn(async (k, v) => { idbMemory.set(k, v); return v; }),
        removeItem: vi.fn(async (k) => { idbMemory.delete(k); }),
        createInstance: () => ({ getItem: vi.fn(async () => null) }),
    },
}));

import {
    useCloudSync,
    pushCloudSyncDetailed,
    pushCriticalCloudSync,
    resetSalesDeltaCacheForTests,
} from '../src/hooks/useCloudSync';
import {
    SALES_SYNC_FINGERPRINTS_KEY,
    buildSyncedFingerprintsMap,
} from '../src/utils/salesDeltaSync';

const PROD_DEVICE_ID = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';

function makeRpcResponse(result) {
    const promise = Promise.resolve(result);
    promise.abortSignal = vi.fn(() => promise);
    return promise;
}

const makeSale = (id, overrides = {}) => ({
    id,
    tipo: 'VENTA',
    saleNumber: 1900,
    timestamp: '2026-11-22T02:00:00.000Z',
    updatedAt: '2026-11-22T02:00:00.000Z',
    totalUsd: 5,
    totalBs: 5000,
    status: 'COMPLETADA',
    cajaCerrada: false,
    items: [{ id: 'p1', name: 'Polar', qty: 1, priceUsd: 5 }],
    payments: [{ methodId: 'pago_movil', amountBs: 5000, amountUsd: 5 }],
    ...overrides,
});

let root;
let host;

function SyncHarness({ deviceId = PROD_DEVICE_ID }) {
    useCloudSync(deviceId);
    return null;
}

async function mountPos(deviceId = PROD_DEVICE_ID) {
    localStorage.setItem('dj_device_id', deviceId);
    localStorage.setItem('dj_pairing_mode', 'pos');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
        root.render(createElement(SyncHarness, { deviceId }));
        await Promise.resolve();
        await Promise.resolve();
    });
}

beforeEach(() => {
    idbMemory.clear();
    resetSalesDeltaCacheForTests?.();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    localStorage.setItem('dj_egress_hash_purge_v3', '1');
    localStorage.setItem('dj_source_push_hash_purge_v2', '1');
    localStorage.setItem('dj_sales_push_merge_v1', 'true');
    mocks.rpc.mockReset();
    mocks.fetchCloudSalesReference.mockReset();
    mocks.prepareSalesPushPayload.mockReset();
});

afterEach(async () => {
    if (root) {
        await act(async () => root.unmount());
    }
    host?.remove();
    root = null;
    host = null;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe('Task 3 — Integración delta push de ventas/cierres en useCloudSync', () => {
    it('sube solo 1 venta nueva por upsert_paired_sales_delta sin descargar ni subir el Doc 60 completo', async () => {
        const history = Array.from({ length: 45 }, (_, i) => ({
            id: `cierre_${i + 1}`,
            tipo: 'REGISTRO_CIERRE',
            cierreId: i + 1,
            cierreNumber: i + 1,
            timestamp: '2026-10-01T03:00:00.000Z',
            cajaCerrada: true,
        }));
        idbMemory.set(SALES_SYNC_FINGERPRINTS_KEY, buildSyncedFingerprintsMap(history));

        const deltaCalls = [];
        const fullWriteCalls = [];
        mocks.rpc.mockImplementation((name, params) => {
            if (name === 'touch_pos_heartbeat') return makeRpcResponse({ data: { success: true }, error: null });
            if (name === 'upsert_paired_sales_delta') {
                deltaCalls.push(params);
                return makeRpcResponse({
                    data: { success: true, total_records: 46, upserted_count: 1, confirmed_cierre_ids: [] },
                    error: null,
                });
            }
            if (name === 'write_paired_sync_document') {
                fullWriteCalls.push(params);
                return makeRpcResponse({ data: { success: true }, error: null });
            }
            return makeRpcResponse({ data: { success: true }, error: null });
        });

        await mountPos();
        const newSale = makeSale('sale_1927', { saleNumber: 1927 });
        const res = await pushCloudSyncDetailed('bodega_sales_v1', [newSale, ...history]);

        expect(res.ok).toBe(true);
        expect(res.reason).toBe('ok');
        expect(deltaCalls).toHaveLength(1);
        expect(deltaCalls[0].p_records).toHaveLength(1);
        expect(deltaCalls[0].p_records[0].id).toBe('sale_1927');
        expect(fullWriteCalls).toHaveLength(0);
        expect(mocks.fetchCloudSalesReference).not.toHaveBeenCalled();

        // Las huellas quedaron actualizadas en IndexedDB con la venta nueva
        const savedMap = idbMemory.get(SALES_SYNC_FINGERPRINTS_KEY);
        expect(savedMap.sale_1927).toBeTruthy();
    });

    it('cierre crítico en arranque en frío (sin huellas previas) usa delta fast-path y confirma expectedCierreId desde servidor', async () => {
        const oldCierres = Array.from({ length: 45 }, (_, i) => ({
            id: `cierre_${i + 1}`,
            tipo: 'REGISTRO_CIERRE',
            cierreId: i + 1,
            cierreNumber: i + 1,
            timestamp: '2026-09-01T03:00:00.000Z',
            cajaCerrada: true,
        }));
        const cierreId = 1795320000000;
        const closedSale = makeSale('s_shift_1', {
            cajaCerrada: true,
            cierreId,
            timestamp: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        const cierreRec = {
            id: `cierre_${cierreId}`,
            tipo: 'REGISTRO_CIERRE',
            cierreId,
            cierreNumber: 100,
            timestamp: new Date().toISOString(),
            cajaCerrada: true,
            summary: { todayTotalUsd: 5, todayTotalBs: 5000 },
        };

        const deltaCalls = [];
        mocks.rpc.mockImplementation((name, params) => {
            if (name === 'touch_pos_heartbeat') return makeRpcResponse({ data: { success: true }, error: null });
            if (name === 'upsert_paired_sales_delta') {
                deltaCalls.push(params);
                return makeRpcResponse({
                    data: {
                        success: true,
                        total_records: 47,
                        upserted_count: params.p_records.length,
                        confirmed_cierre_ids: [String(cierreId)],
                    },
                    error: null,
                });
            }
            return makeRpcResponse({ data: { success: true }, error: null });
        });

        await mountPos();
        const res = await pushCriticalCloudSync('bodega_sales_v1', [cierreRec, closedSale, ...oldCierres], {
            expectedCierreId: cierreId,
        });

        expect(res).toEqual({ ok: true, reason: 'ok' });
        expect(deltaCalls).toHaveLength(1);
        expect(deltaCalls[0].p_records.map(r => r.id).sort()).toEqual([
            `cierre_${cierreId}`,
            's_shift_1',
        ]);
        expect(mocks.fetchCloudSalesReference).not.toHaveBeenCalled();
    });

    it('hace fallback transparente a write_paired_sync_document si upsert_paired_sales_delta responde PGRST202 o base_doc_missing y siembra huellas', async () => {
        const baseCierres = Array.from({ length: 40 }, (_, i) => ({
            id: `cierre_${i + 1}`,
            tipo: 'REGISTRO_CIERRE',
            cierreId: i + 1,
            cierreNumber: i + 1,
            timestamp: '2026-09-01T03:00:00.000Z',
            cajaCerrada: true,
        }));
        const cierreId = 1795320000111;
        const newCierre = {
            id: `cierre_${cierreId}`,
            tipo: 'REGISTRO_CIERRE',
            cierreId,
            cierreNumber: 101,
            timestamp: new Date().toISOString(),
            cajaCerrada: true,
        };
        const localSales = [newCierre, ...baseCierres];
        idbMemory.set(SALES_SYNC_FINGERPRINTS_KEY, buildSyncedFingerprintsMap(baseCierres));

        mocks.fetchCloudSalesReference.mockResolvedValue(baseCierres);
        mocks.prepareSalesPushPayload.mockReturnValue({
            payload: localSales,
            strategy: 'union-merge',
            vetoed: false,
        });

        let fullWrites = 0;
        mocks.rpc.mockImplementation((name) => {
            if (name === 'touch_pos_heartbeat') return makeRpcResponse({ data: { success: true }, error: null });
            if (name === 'upsert_paired_sales_delta') {
                return makeRpcResponse({ data: null, error: { code: 'PGRST202', status: 404, message: 'function not found' } });
            }
            if (name === 'write_paired_sync_document') {
                fullWrites += 1;
                return makeRpcResponse({ data: { success: true }, error: null });
            }
            return makeRpcResponse({ data: { success: true }, error: null });
        });

        await mountPos();
        const res = await pushCriticalCloudSync('bodega_sales_v1', localSales, { expectedCierreId: cierreId });

        expect(res).toEqual({ ok: true, reason: 'ok' });
        expect(fullWrites).toBe(1);
        expect(idbMemory.get(SALES_SYNC_FINGERPRINTS_KEY)[`cierre_${cierreId}`]).toBeTruthy();
    });

    it('guardrail: omite delta cuando confirm_sales_purge_flag=true o forceUnconditional=true', async () => {
        const sales = [makeSale('s1')];
        idbMemory.set(SALES_SYNC_FINGERPRINTS_KEY, buildSyncedFingerprintsMap(sales));

        let deltaCalls = 0;
        let fullWrites = 0;
        mocks.rpc.mockImplementation((name) => {
            if (name === 'touch_pos_heartbeat') return makeRpcResponse({ data: { success: true }, error: null });
            if (name === 'upsert_paired_sales_delta') {
                deltaCalls += 1;
                return makeRpcResponse({ data: { success: true, total_records: 1, confirmed_cierre_ids: [] }, error: null });
            }
            if (name === 'write_paired_sync_document') {
                fullWrites += 1;
                return makeRpcResponse({ data: { success: true }, error: null });
            }
            return makeRpcResponse({ data: { success: true }, error: null });
        });

        await mountPos();
        localStorage.setItem('confirm_sales_purge_flag', 'true');
        const res = await pushCloudSyncDetailed('bodega_sales_v1', [makeSale('s2')], true);

        expect(res.ok).toBe(true);
        expect(deltaCalls).toBe(0);
        expect(fullWrites).toBe(1);
    });

    it('guardrail: si el servidor confirma delta pero NO incluye expectedCierreId en confirmed_cierre_ids, devuelve merge_vetoed', async () => {
        const cierreId = 1795320000222;
        const cierreRec = {
            id: `cierre_${cierreId}`,
            tipo: 'REGISTRO_CIERRE',
            cierreId,
            cierreNumber: 102,
            timestamp: new Date().toISOString(),
            cajaCerrada: true,
        };
        mocks.rpc.mockImplementation((name) => {
            if (name === 'touch_pos_heartbeat') return makeRpcResponse({ data: { success: true }, error: null });
            if (name === 'upsert_paired_sales_delta') {
                return makeRpcResponse({
                    data: { success: true, total_records: 100, upserted_count: 1, confirmed_cierre_ids: [] },
                    error: null,
                });
            }
            return makeRpcResponse({ data: { success: true }, error: null });
        });

        await mountPos();
        const res = await pushCriticalCloudSync('bodega_sales_v1', [cierreRec], { expectedCierreId: cierreId });
        expect(res).toEqual({ ok: false, reason: 'merge_vetoed' });
    });

    it('guardrail: reintenta ante 57014 (statement_timeout) en delta y logra ok:true en el segundo intento', async () => {
        const cierreId = 1795320000333;
        const cierreRec = {
            id: `cierre_${cierreId}`,
            tipo: 'REGISTRO_CIERRE',
            cierreId,
            cierreNumber: 103,
            timestamp: new Date().toISOString(),
            cajaCerrada: true,
        };
        let attempts = 0;
        mocks.rpc.mockImplementation((name) => {
            if (name === 'touch_pos_heartbeat') return makeRpcResponse({ data: { success: true }, error: null });
            if (name === 'upsert_paired_sales_delta') {
                attempts += 1;
                if (attempts === 1) {
                    return makeRpcResponse({
                        data: null,
                        error: { code: '57014', status: 500, message: 'canceling statement due to statement timeout' },
                    });
                }
                return makeRpcResponse({
                    data: { success: true, total_records: 101, upserted_count: 1, confirmed_cierre_ids: [String(cierreId)] },
                    error: null,
                });
            }
            return makeRpcResponse({ data: { success: true }, error: null });
        });

        await mountPos();
        const res = await pushCriticalCloudSync('bodega_sales_v1', [cierreRec], {
            expectedCierreId: cierreId,
            retryDelaysMs: [10, 10],
        });
        expect(res).toEqual({ ok: true, reason: 'ok' });
        expect(attempts).toBe(2);
    });
});
