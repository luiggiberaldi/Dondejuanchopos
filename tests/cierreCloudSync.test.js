import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => undefined),
        createInstance: () => ({ getItem: vi.fn(async () => null) }),
    },
}));

import {
    useCloudSync,
    queueCloudSync,
    pushCloudSync,
    pushCloudSyncDetailed,
    pushCriticalCloudSync,
    hasCriticalCloudPushInFlight,
} from '../src/hooks/useCloudSync';
import {
    clearCloudRetryFailure,
    getCloudRetryState,
    readCloudRetrySnapshot,
    recordCloudRetryFailure,
    setCloudRetryCooldown,
} from '../src/utils/cloudRetry';
import CierreCajaSummaryModal from '../src/components/Dashboard/CierreCajaSummaryModal';

const DEVICE_ID = 'POS-TEST-CIERRE-1';
const PROD_DEVICE_ID = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';

function makeRpcResponse(resultOrPromise) {
    const promise = Promise.resolve(resultOrPromise);
    promise.abortSignal = vi.fn(() => promise);
    return promise;
}

function makeAbortableRpc(handler) {
    let signal = null;
    const p = new Promise((resolve, reject) => {
        queueMicrotask(() => handler({ resolve, reject, getSignal: () => signal }));
    });
    p.abortSignal = vi.fn((s) => {
        signal = s;
        return p;
    });
    return p;
}

let root;
let host;

function SyncHarness({ deviceId = DEVICE_ID }) {
    useCloudSync(deviceId);
    return null;
}

async function mountCloudSync(deviceId = DEVICE_ID) {
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
    vi.useFakeTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    localStorage.setItem('dj_egress_hash_purge_v3', '1');
    localStorage.setItem('dj_source_push_hash_purge_v2', '1');
    mocks.rpc.mockReset().mockImplementation((name) => {
        if (name === 'touch_pos_heartbeat') return makeRpcResponse({ data: { success: true }, error: null });
        return makeRpcResponse({ data: { success: true }, error: null });
    });
    mocks.fetchCloudSalesReference.mockReset();
    mocks.prepareSalesPushPayload.mockReset();
    delete window.electronAPI;
});

afterEach(async () => {
    if (root) {
        await act(async () => root.unmount());
    }
    host?.remove();
    root = null;
    host = null;
    vi.useRealTimers();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe('Fase 1 — pushCriticalCloudSync y blindajes de cierre', () => {
    it('cancela debounce pendiente, limpia cooldown transitorio y logra ok:true en 2 reintentos', async () => {
        await mountCloudSync();
        recordCloudRetryFailure(`sync:${DEVICE_ID}:bodega_sales_v1`, { status: 503, message: 'temporarily unavailable' });
        expect(getCloudRetryState(`sync:${DEVICE_ID}:bodega_sales_v1`).coolingDown).toBe(true);

        const sales = [{ id: 'cierre_101', tipo: 'REGISTRO_CIERRE', cierreId: 101, cierreNumber: 1 }];
        queueCloudSync('bodega_sales_v1', sales);

        let writeCalls = 0;
        mocks.rpc.mockImplementation((name) => {
            if (name === 'touch_pos_heartbeat') return makeRpcResponse({ data: { success: true }, error: null });
            if (name === 'write_paired_sync_document') {
                writeCalls += 1;
                if (writeCalls <= 2) {
                    return makeRpcResponse({ data: null, error: { status: 503, message: 'service unavailable' } });
                }
                return makeRpcResponse({ data: { success: true }, error: null });
            }
            return makeRpcResponse({ data: { success: true }, error: null });
        });

        const events = [];
        const onState = (e) => events.push(e.detail);
        window.addEventListener('cloud_critical_sync_state', onState);

        try {
            const pending = pushCriticalCloudSync('bodega_sales_v1', sales, {
                expectedCierreId: 101,
                retryDelaysMs: [2000, 5000],
            });
            expect(hasCriticalCloudPushInFlight()).toBe(true);

            await vi.advanceTimersByTimeAsync(2000);
            await vi.advanceTimersByTimeAsync(5000);
            const res = await pending;

            expect(res).toEqual({ ok: true, reason: 'ok' });
            expect(writeCalls).toBe(3);
            expect(hasCriticalCloudPushInFlight()).toBe(false);
            expect(events.map(e => e.status)).toEqual(['syncing', 'synced']);

            // Verificar que el debounce cancelado no disparó una 4ta subida
            await vi.advanceTimersByTimeAsync(1000);
            expect(writeCalls).toBe(3);
        } finally {
            window.removeEventListener('cloud_critical_sync_state', onState);
        }
    });

    it('no toca fallos permanentes (401/403/404) ni reintenta circuit_breaker, too_large o merge_reference_unavailable', async () => {
        await mountCloudSync();

        // 1. Fallo permanente previo en cooldown → no se limpia, falla sin reintentar
        recordCloudRetryFailure(`sync:${DEVICE_ID}:bodega_sales_v1`, { status: 403, message: 'forbidden' });
        let writeCalls = 0;
        mocks.rpc.mockImplementation((name) => {
            if (name === 'write_paired_sync_document') writeCalls += 1;
            return makeRpcResponse({ data: { success: true }, error: null });
        });
        const permRes = await pushCriticalCloudSync('bodega_sales_v1', [{ id: 'v1' }]);
        expect(permRes).toEqual({ ok: false, reason: 'cooldown' });
        expect(writeCalls).toBe(0);
        clearCloudRetryFailure(`sync:${DEVICE_ID}:bodega_sales_v1`);

        // 2. Circuit breaker (minAllowedCierres) → no reintenta
        localStorage.setItem('bodega_sales_max_cierres', '5');
        const cbRes = await pushCriticalCloudSync('bodega_sales_v1', [{ id: 'v1', tipo: 'VENTA' }]);
        expect(cbRes).toEqual({ ok: false, reason: 'circuit_breaker' });
        expect(writeCalls).toBe(0);
        localStorage.removeItem('bodega_sales_max_cierres');

        // 3. Error permanente 404 del RPC → no reintenta
        mocks.rpc.mockImplementation((name) => {
            if (name === 'write_paired_sync_document') {
                writeCalls += 1;
                return makeRpcResponse({ data: null, error: { status: 404, message: 'not found' } });
            }
            return makeRpcResponse({ data: { success: true }, error: null });
        });
        const rpc404 = await pushCriticalCloudSync('bodega_sales_v1', [{ id: 'v2' }]);
        expect(rpc404).toEqual({ ok: false, reason: 'rpc_error' });
        expect(writeCalls).toBe(1);
        expect(hasCriticalCloudPushInFlight()).toBe(false);
    });

    it('timeout de 90s aborta el RPC, libera la cola y NO crea cooldown global por aborto propio', async () => {
        await mountCloudSync();
        let capturedSignal = null;
        let callIndex = 0;

        mocks.rpc.mockImplementation((name) => {
            if (name !== 'write_paired_sync_document') {
                return makeRpcResponse({ data: { success: true }, error: null });
            }
            callIndex += 1;
            if (callIndex === 1) {
                return makeAbortableRpc(({ reject, getSignal }) => {
                    const sig = getSignal();
                    capturedSignal = sig;
                    sig?.addEventListener('abort', () => {
                        const err = new Error('aborted');
                        err.name = 'AbortError';
                        reject(err);
                    });
                });
            }
            return makeRpcResponse({ data: { success: true }, error: null });
        });

        const sales = [{ id: 'cierre_202', tipo: 'REGISTRO_CIERRE', cierreId: 202 }];
        const p = pushCriticalCloudSync('bodega_sales_v1', sales, { timeoutMs: 90000 });
        await vi.advanceTimersByTimeAsync(90000);
        const res = await p;

        expect(res).toEqual({ ok: false, reason: 'timeout' });
        expect(capturedSignal?.aborted).toBe(true);
        expect(hasCriticalCloudPushInFlight()).toBe(false);
        // Aborto propio NO debe haber registrado cooldown global
        expect(getCloudRetryState(`sync:${DEVICE_ID}`).coolingDown).toBe(false);

        // Reintento manual inmediato funciona (cola liberada)
        const retry = await pushCriticalCloudSync('bodega_sales_v1', sales, { expectedCierreId: 202 });
        expect(retry).toEqual({ ok: true, reason: 'ok' });
    });

    it('tras 3 fallos conserva el nextRetryAt mayor entre el cooldown global previo y el nuevo', async () => {
        await mountCloudSync();
        const now = Date.now();
        // Cooldown global previo de 10 minutos
        setCloudRetryCooldown(`sync:${DEVICE_ID}`, 10 * 60 * 1000, { now });
        const prevSnapshot = readCloudRetrySnapshot(`sync:${DEVICE_ID}`);

        mocks.rpc.mockImplementation((name) => {
            if (name === 'write_paired_sync_document') {
                return makeRpcResponse({ data: null, error: { status: 503, message: 'down' } });
            }
            return makeRpcResponse({ data: { success: true }, error: null });
        });

        const p = pushCriticalCloudSync('bodega_sales_v1', [{ id: 'v3' }], { retryDelaysMs: [100, 100] });
        await vi.advanceTimersByTimeAsync(300);
        const res = await p;
        expect(res.ok).toBe(false);
        const after = readCloudRetrySnapshot(`sync:${DEVICE_ID}`);
        expect(after.nextRetryAt).toBe(prevSnapshot.nextRetryAt);
    });

    it('[v8] si el merge se veta y el payload subido no contiene expectedCierreId, devuelve merge_vetoed; unchanged extrae ids de value', async () => {
        await mountCloudSync(PROD_DEVICE_ID);
        localStorage.setItem('dj_sales_push_merge_v1', 'true');

        // Crear 39 cierres previos para pasar circuit breaker de producción
        const baseCierres = Array.from({ length: 39 }, (_, i) => ({
            id: `cierre_${i + 1}`,
            tipo: 'REGISTRO_CIERRE',
            cierreId: i + 1,
        }));
        const newCierre = { id: 'cierre_999', tipo: 'REGISTRO_CIERRE', cierreId: 999 };
        const localSales = [...baseCierres, newCierre];

        mocks.fetchCloudSalesReference.mockResolvedValue(baseCierres);
        mocks.prepareSalesPushPayload.mockReturnValue({
            payload: baseCierres, // Merge vetado: devuelve referencia cloud sin cierre 999
            strategy: 'union-merge',
            vetoed: true,
            reason: 'shrink_veto',
        });

        const res = await pushCriticalCloudSync('bodega_sales_v1', localSales, { expectedCierreId: 999 });
        expect(res).toEqual({ ok: false, reason: 'merge_vetoed' });

        // Retorno temprano `unchanged`: extrae uploadedCierreIds desde `value`
        mocks.prepareSalesPushPayload.mockReturnValue({
            payload: localSales,
            strategy: 'union-merge',
            vetoed: false,
            reason: 'ok',
        });
        const firstOk = await pushCloudSyncDetailed('bodega_sales_v1', localSales, false, { collectCierreIds: true });
        expect(firstOk.ok).toBe(true);
        const secondUnchanged = await pushCloudSyncDetailed('bodega_sales_v1', localSales, false, { collectCierreIds: true });
        expect(secondUnchanged.ok).toBe(true);
        expect(secondUnchanged.reason).toBe('unchanged');
        expect(secondUnchanged.uploadedCierreIds).toContain('999');
    });

    it('beforeunload llama preventDefault únicamente cuando hay subida crítica activa', async () => {
        await mountCloudSync();
        let release;
        mocks.rpc.mockImplementation((name) => {
            if (name === 'write_paired_sync_document') {
                return makeAbortableRpc(({ resolve }) => { release = resolve; });
            }
            return makeRpcResponse({ data: { success: true }, error: null });
        });

        const idleEvent = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(idleEvent);
        expect(idleEvent.defaultPrevented).toBe(false);

        const inflight = pushCriticalCloudSync('bodega_sales_v1', [{ id: 'v-bu' }]);
        await vi.advanceTimersByTimeAsync(0);
        const busyEvent = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(busyEvent);
        expect(busyEvent.defaultPrevented).toBe(true);

        release({ data: { success: true }, error: null });
        await inflight;

        const afterEvent = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(afterEvent);
        expect(afterEvent.defaultPrevented).toBe(false);
    });

    it('aborta una subida ordinaria colgada en cola para que el cierre crítico no quede bloqueado ni exceda 90s', async () => {
        await mountCloudSync();
        let ordinarySignal = null;
        let callIndex = 0;

        mocks.rpc.mockImplementation((name) => {
            if (name !== 'write_paired_sync_document') {
                return makeRpcResponse({ data: { success: true }, error: null });
            }
            callIndex += 1;
            if (callIndex === 1) {
                // Subida ordinaria colgada que nunca responde por sí sola
                return makeAbortableRpc(({ reject, getSignal }) => {
                    const sig = getSignal();
                    ordinarySignal = sig;
                    sig?.addEventListener('abort', () => {
                        const err = new Error('aborted');
                        err.name = 'AbortError';
                        reject(err);
                    }, { once: true });
                });
            }
            return makeRpcResponse({ data: { success: true }, error: null });
        });

        const ordinaryPush = pushCloudSync('bodega_sales_v1', [{ id: 'v-old' }]);
        await vi.advanceTimersByTimeAsync(0);
        expect(ordinarySignal).toBeTruthy();
        expect(ordinarySignal.aborted).toBe(false);

        const cierreSales = [{ id: 'cierre_777', tipo: 'REGISTRO_CIERRE', cierreId: 777 }];
        const criticalRes = await pushCriticalCloudSync('bodega_sales_v1', cierreSales, {
            expectedCierreId: 777,
        });

        expect(ordinarySignal.aborted).toBe(true);
        expect(await ordinaryPush).toBe(false);
        expect(criticalRes).toEqual({ ok: true, reason: 'ok' });
        // El aborto de la subida ordinaria obsoleta no debe ensuciar cooldown global
        expect(getCloudRetryState(`sync:${DEVICE_ID}`).coolingDown).toBe(false);
    });
});

describe('Fase 1 + 2B — CierreCajaSummaryModal banners de estado', () => {
    const baseSummary = {
        sales: [{ id: 'v1' }],
        todayTotalUsd: 50,
        todayTotalBs: 2000,
        todayItemsSold: 3,
        reconData: { expectedUsd: 50, declaredUsd: 50, expectedBs: 0, declaredBs: 0 },
    };

    it('renderiza estados syncing, synced (+ signalPending) y failed (+ botón reintento)', async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);

        await act(async () => {
            root.render(createElement(CierreCajaSummaryModal, {
                isOpen: true,
                onClose: vi.fn(),
                summaryData: baseSummary,
                syncStatus: 'syncing',
            }));
        });
        expect(host.textContent).toContain('Sincronizando cierre con el Supervisor');
        expect(host.textContent).toContain('Guardado local — Enviando al Supervisor');
        expect(host.textContent).not.toContain('Cierre Completado');

        const onRetrySignal = vi.fn();
        await act(async () => {
            root.render(createElement(CierreCajaSummaryModal, {
                isOpen: true,
                onClose: vi.fn(),
                summaryData: baseSummary,
                syncStatus: 'synced',
                signalPending: true,
                onRetrySignal,
            }));
        });
        expect(host.textContent).toContain('Cierre Completado y Enviado');
        expect(host.textContent).toContain('Cierre enviado y confirmado en la nube');
        const resendBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('Reenviar aviso al Supervisor'));
        expect(resendBtn).toBeTruthy();
        await act(async () => resendBtn.click());
        expect(onRetrySignal).toHaveBeenCalledTimes(1);

        const onRetrySync = vi.fn();
        await act(async () => {
            root.render(createElement(CierreCajaSummaryModal, {
                isOpen: true,
                onClose: vi.fn(),
                summaryData: baseSummary,
                syncStatus: 'failed',
                syncError: 'Tiempo de espera agotado',
                onRetrySync,
            }));
        });
        expect(host.textContent).toContain('Cierre guardado solo en esta PC');
        expect(host.textContent).not.toContain('Cierre Completado');
        expect(host.textContent).toContain('Cierre guardado en esta PC');
        expect(host.textContent).toContain('Tiempo de espera agotado');
        const retryBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('Reintentar envío ahora'));
        expect(retryBtn).toBeTruthy();
        await act(async () => retryBtn.click());
        expect(onRetrySync).toHaveBeenCalledTimes(1);
    });
});
