import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CLOSE_SIGNAL_RATE_LIMIT_COOLDOWN_MS,
    CLOSE_SIGNAL_TTL_MS,
    PENDING_CLOSE_SIGNAL_STORAGE_KEY,
    enqueuePendingCloseSignal,
    flushPendingCloseSignals,
    hasPendingCloseSignal,
    markCloseSignalsUploaded,
} from '../src/services/shiftCloseSignalService';
import {
    clearCloudRetryFailure,
    getCloudRetryState,
    recordCloudRetryFailure,
} from '../src/utils/cloudRetry';

const DEV_A = 'POS-DEV-A';
const DEV_B = 'POS-DEV-B';

beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('Fase 2B — shiftCloseSignalService (cola durable + backoff dedicado)', () => {
    it('encola múltiples cierres en 24h en awaiting_upload, promueve selectivamente y emite payload exacto sin montos', async () => {
        const events = [];
        const onChanged = (e) => events.push(e.detail);
        window.addEventListener('close_signal_queue_changed', onChanged);

        try {
            enqueuePendingCloseSignal({ deviceId: DEV_A, registroCierre: { cierreId: 1001, cierreNumber: 10 } });
            enqueuePendingCloseSignal({ deviceId: DEV_A, registroCierre: { cierreId: 1002, cierreNumber: 11 } });

            expect(hasPendingCloseSignal(DEV_A, 1001)).toBe(true);
            expect(hasPendingCloseSignal(DEV_A, 1002)).toBe(true);
            expect(events.length).toBeGreaterThanOrEqual(2);

            const rpc = vi.fn(async () => ({ data: { success: true, inserted: true, reason: 'inserted' }, error: null }));
            const client = { rpc };

            // Sin promover: no emite nada
            const beforePromote = await flushPendingCloseSignals(DEV_A, { client });
            expect(beforePromote.flushed).toBe(0);
            expect(rpc).not.toHaveBeenCalled();

            // Promover solo 1001
            expect(markCloseSignalsUploaded(DEV_A, ['1001'])).toBe(1);
            const res = await flushPendingCloseSignals(DEV_A, { client });
            expect(res.flushed).toBe(1);
            expect(rpc).toHaveBeenCalledTimes(1);
            expect(rpc).toHaveBeenCalledWith('emit_shift_close_event', {
                p_primary_device_id: DEV_A,
                p_cierre_id: 1001,
                p_cierre_number: 10,
            });
            expect(hasPendingCloseSignal(DEV_A, 1001)).toBe(false);
            expect(hasPendingCloseSignal(DEV_A, 1002)).toBe(true);
        } finally {
            window.removeEventListener('close_signal_queue_changed', onChanged);
        }
    });

    it('fast-path O(1): no parsea JSON ni llama RPC cuando la cola está vacía', async () => {
        const parseSpy = vi.spyOn(JSON, 'parse');
        const rpc = vi.fn();
        try {
            const res = await flushPendingCloseSignals(DEV_A, { client: { rpc } });
            expect(res).toEqual({ ok: true, pending: false, flushed: 0 });
            expect(rpc).not.toHaveBeenCalled();
            expect(parseSpy).not.toHaveBeenCalled();
        } finally {
            parseSpy.mockRestore();
        }
    });

    it('aislamiento por deviceId: entradas de otro dispositivo no se promueven ni emiten', async () => {
        enqueuePendingCloseSignal({ deviceId: DEV_B, registroCierre: { cierreId: 500, cierreNumber: 5 } });
        expect(hasPendingCloseSignal(DEV_A, 500)).toBe(false);
        expect(markCloseSignalsUploaded(DEV_A, ['500'])).toBe(0);
        const rpc = vi.fn();
        await flushPendingCloseSignals(DEV_A, { client: { rpc } });
        expect(rpc).not.toHaveBeenCalled();
        expect(hasPendingCloseSignal(DEV_B, 500)).toBe(true);
    });

    it('usa backoff dedicado close_signal:<deviceId> sin tocar sync:<deviceId> y respeta errores permanentes (404/42883/42501)', async () => {
        enqueuePendingCloseSignal({ deviceId: DEV_A, registroCierre: { cierreId: 2001, cierreNumber: 20 } });
        markCloseSignalsUploaded(DEV_A, ['2001']);

        const rpc = vi.fn(async () => ({
            data: null,
            error: { status: 404, code: 'PGRST202', message: 'function not found' },
        }));
        const res = await flushPendingCloseSignals(DEV_A, { client: { rpc }, immediate: true });
        expect(res.ok).toBe(false);
        expect(res.pending).toBe(true);
        expect(rpc).toHaveBeenCalledTimes(1); // Error permanente: sin reintentos cortos

        expect(getCloudRetryState(`close_signal:${DEV_A}`).permanent).toBe(true);
        expect(getCloudRetryState(`sync:${DEV_A}`).coolingDown).toBe(false);

        // Incluso con manual:true, los errores permanentes se respetan
        const manualRes = await flushPendingCloseSignals(DEV_A, { client: { rpc }, immediate: true, manual: true });
        expect(manualRes.reason).toBe('permanent_cooldown');
        expect(rpc).toHaveBeenCalledTimes(1);
    });

    it('[v7] POS_SYNC_DEVICE_NOT_REGISTERED NO se trata como permanente', async () => {
        enqueuePendingCloseSignal({ deviceId: DEV_A, registroCierre: { cierreId: 2002, cierreNumber: 21 } });
        markCloseSignalsUploaded(DEV_A, ['2002']);

        const rpc = vi.fn(async () => ({
            data: null,
            error: { code: 'P0001', message: 'POS_SYNC_DEVICE_NOT_REGISTERED' },
        }));
        await flushPendingCloseSignals(DEV_A, { client: { rpc }, immediate: false });
        const state = getCloudRetryState(`close_signal:${DEV_A}`);
        expect(state.coolingDown).toBe(true);
        expect(state.permanent).toBe(false);
    });

    it('rate_limited fija cooldown de 10 min, conserva entrada, y manual:true lo ignora; reason=recent limpia la cola', async () => {
        enqueuePendingCloseSignal({ deviceId: DEV_A, registroCierre: { cierreId: 3001, cierreNumber: 30 } });
        markCloseSignalsUploaded(DEV_A, ['3001']);

        const rpc = vi.fn()
            .mockResolvedValueOnce({ data: { success: true, throttled: true, reason: 'rate_limited' }, error: null })
            .mockResolvedValueOnce({ data: { success: true, throttled: true, reason: 'recent' }, error: null });

        const first = await flushPendingCloseSignals(DEV_A, { client: { rpc } });
        expect(first.ok).toBe(false);
        expect(first.reason).toBe('rate_limited');
        expect(hasPendingCloseSignal(DEV_A, 3001)).toBe(true);
        const state = getCloudRetryState(`close_signal:${DEV_A}`);
        expect(state.coolingDown).toBe(true);
        expect(state.remainingMs).toBeGreaterThan(CLOSE_SIGNAL_RATE_LIMIT_COOLDOWN_MS - 5000);

        // Flush automático respeta cooldown
        const skipped = await flushPendingCloseSignals(DEV_A, { client: { rpc } });
        expect(skipped.reason).toBe('cooldown');
        expect(rpc).toHaveBeenCalledTimes(1);

        // Reintento manual ignora rate_limited y `recent` limpia la cola como éxito
        const manual = await flushPendingCloseSignals(DEV_A, { client: { rpc }, immediate: true, manual: true });
        expect(manual.ok).toBe(true);
        expect(manual.flushed).toBe(1);
        expect(hasPendingCloseSignal(DEV_A, 3001)).toBe(false);
    });

    it('reintentos cortos [3000, 8000] solo ocurren con immediate:true; single-flight evita llamadas duplicadas', async () => {
        enqueuePendingCloseSignal({ deviceId: DEV_A, registroCierre: { cierreId: 4001, cierreNumber: 40 } });
        markCloseSignalsUploaded(DEV_A, ['4001']);

        let calls = 0;
        const rpc = vi.fn(async () => {
            calls += 1;
            if (calls <= 2) return { data: null, error: { status: 503, message: 'net' } };
            return { data: { success: true, reason: 'inserted' }, error: null };
        });

        // Dos llamadas concurrentes comparten el mismo vuelo (single-flight)
        const p1 = flushPendingCloseSignals(DEV_A, { client: { rpc }, immediate: true });
        const p2 = flushPendingCloseSignals(DEV_A, { client: { rpc }, immediate: true });
        expect(p1).toBe(p2);

        await vi.advanceTimersByTimeAsync(3000);
        await vi.advanceTimersByTimeAsync(8000);
        const res = await p1;
        expect(res.ok).toBe(true);
        expect(calls).toBe(3);

        // Con immediate:false solo hace 1 intento sin esperar
        clearCloudRetryFailure(`close_signal:${DEV_A}`);
        enqueuePendingCloseSignal({ deviceId: DEV_A, registroCierre: { cierreId: 4002, cierreNumber: 41 } });
        markCloseSignalsUploaded(DEV_A, ['4002']);
        const rpcFail = vi.fn(async () => ({ data: null, error: { status: 503, message: 'net' } }));
        const nonImm = await flushPendingCloseSignals(DEV_A, { client: { rpc: rpcFail }, immediate: false });
        expect(nonImm.ok).toBe(false);
        expect(rpcFail).toHaveBeenCalledTimes(1);
    });

    it('expira entradas vencidas tras TTL de 24h y opera fail-open ante excepción de red', async () => {
        const t0 = Date.now();
        enqueuePendingCloseSignal({ deviceId: DEV_A, registroCierre: { cierreId: 5001 }, now: t0 });
        expect(hasPendingCloseSignal(DEV_A, 5001, { now: t0 + CLOSE_SIGNAL_TTL_MS - 1000 })).toBe(true);
        expect(hasPendingCloseSignal(DEV_A, 5001, { now: t0 + CLOSE_SIGNAL_TTL_MS + 1000 })).toBe(false);

        localStorage.removeItem(PENDING_CLOSE_SIGNAL_STORAGE_KEY);
        enqueuePendingCloseSignal({ deviceId: DEV_A, registroCierre: { cierreId: 5002 } });
        markCloseSignalsUploaded(DEV_A, ['5002']);
        const rpcThrows = vi.fn(async () => { throw new Error('Failed to fetch'); });
        const res = await flushPendingCloseSignals(DEV_A, { client: { rpc: rpcThrows }, immediate: false });
        expect(res.ok).toBe(false);
        expect(res.pending).toBe(true);
        expect(hasPendingCloseSignal(DEV_A, 5002)).toBe(true);
    });

    it('emisión inmediata tras cierre (immediate:true) ignora cooldown transitorio previo pero respeta rate_limited y permanentes', async () => {
        // Cooldown transitorio previo por fallo de red
        recordCloudRetryFailure(`close_signal:${DEV_A}`, { status: 503, message: 'net hiccup' });
        expect(getCloudRetryState(`close_signal:${DEV_A}`).coolingDown).toBe(true);

        enqueuePendingCloseSignal({ deviceId: DEV_A, registroCierre: { cierreId: 6001, cierreNumber: 60 } });
        markCloseSignalsUploaded(DEV_A, ['6001']);

        const rpc = vi.fn(async () => ({ data: { success: true, reason: 'inserted' }, error: null }));

        // Flush periódico (immediate:false) respeta el cooldown transitorio
        const autoRes = await flushPendingCloseSignals(DEV_A, { client: { rpc }, immediate: false });
        expect(autoRes.reason).toBe('cooldown');
        expect(rpc).not.toHaveBeenCalled();

        // Emisión inmediata tras cerrar caja (immediate:true) ignora cooldown transitorio y envía al instante
        const immRes = await flushPendingCloseSignals(DEV_A, { client: { rpc }, immediate: true });
        expect(immRes.ok).toBe(true);
        expect(immRes.flushed).toBe(1);
        expect(rpc).toHaveBeenCalledTimes(1);
    });
});
