// src/services/shiftCloseSignalService.js
// Fase 2B (PLAN_CIERRE_CAJA_TIEMPO_REAL_SUPERVISOR): cola durable multi-cierre
// en 2 estados (`awaiting_upload` → `ready_to_emit`) y emisión fail-open de la
// señal liviana `emit_shift_close_event` (~500 bytes, sin datos financieros).
import { supabaseCloud } from '../config/supabaseCloud';
import {
    clearCloudRetryFailure,
    getCloudRetryState,
    isPermanentCloudError,
    recordCloudRetryFailure,
    setCloudRetryCooldown,
} from '../utils/cloudRetry';

export const PENDING_CLOSE_SIGNAL_STORAGE_KEY = 'dj_pending_close_signal_v1';
export const CLOSE_SIGNAL_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
export const CLOSE_SIGNAL_MAX_ENTRIES = 20;
export const CLOSE_SIGNAL_RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1000; // 10 min
const DEFAULT_IMMEDIATE_RETRY_DELAYS_MS = [3000, 8000];

const _flushInFlightByDevice = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function closeSignalRetryKey(deviceId) {
    return `close_signal:${deviceId}`;
}

function dispatchQueueChanged(deviceId) {
    try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('close_signal_queue_changed', {
                detail: { deviceId },
            }));
        }
    } catch {
        // Entorno sin DOM
    }
}

/**
 * Fast-path O(1) sin caché en memoria (seguro multi-pestaña PWA):
 * revisa el string crudo antes de parsear JSON.
 */
export function hasAnyPendingCloseSignalRaw() {
    try {
        const raw = localStorage.getItem(PENDING_CLOSE_SIGNAL_STORAGE_KEY);
        return Boolean(raw && raw !== '[]');
    } catch {
        return false;
    }
}

function readQueueRaw() {
    try {
        const raw = localStorage.getItem(PENDING_CLOSE_SIGNAL_STORAGE_KEY);
        if (!raw || raw === '[]') return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeQueueRaw(entries, deviceId) {
    try {
        if (!entries || entries.length === 0) {
            localStorage.removeItem(PENDING_CLOSE_SIGNAL_STORAGE_KEY);
        } else {
            localStorage.setItem(PENDING_CLOSE_SIGNAL_STORAGE_KEY, JSON.stringify(entries));
        }
    } catch (err) {
        console.warn('[ShiftCloseSignal] No se pudo persistir la cola de señales:', err?.message || err);
    }
    dispatchQueueChanged(deviceId);
}

function pruneExpired(entries, now = Date.now()) {
    const valid = entries.filter((entry) => (
        entry
        && typeof entry.deviceId === 'string'
        && entry.deviceId.length > 0
        && entry.cierreId != null
        && Number.isFinite(Number(entry.queuedAt))
        && (now - Number(entry.queuedAt)) < CLOSE_SIGNAL_TTL_MS
    ));
    return { valid, changed: valid.length !== entries.length };
}

/**
 * Persiste la intención de emitir la señal inmediatamente después de guardar el
 * cierre en IndexedDB y ANTES de subir `bodega_sales_v1` a la nube.
 */
export function enqueuePendingCloseSignal({ deviceId, registroCierre, now = Date.now() } = {}) {
    if (!deviceId || !registroCierre || registroCierre.cierreId == null) return false;
    const cierreId = Number(registroCierre.cierreId);
    if (!Number.isFinite(cierreId)) return false;

    const cierreNumber = registroCierre.cierreNumber != null
        ? Number(registroCierre.cierreNumber)
        : null;

    const { valid } = pruneExpired(readQueueRaw(), now);
    const existingIdx = valid.findIndex(
        (e) => e.deviceId === deviceId && String(e.cierreId) === String(cierreId),
    );

    if (existingIdx >= 0) {
        const existing = valid[existingIdx];
        valid[existingIdx] = {
            ...existing,
            cierreNumber: Number.isFinite(cierreNumber) ? cierreNumber : existing.cierreNumber,
        };
    } else {
        valid.push({
            deviceId,
            cierreId,
            cierreNumber: Number.isFinite(cierreNumber) ? cierreNumber : null,
            state: 'awaiting_upload',
            queuedAt: now,
        });
    }

    const capped = valid.length > CLOSE_SIGNAL_MAX_ENTRIES
        ? valid.slice(valid.length - CLOSE_SIGNAL_MAX_ENTRIES)
        : valid;

    writeQueueRaw(capped, deviceId);
    return true;
}

/**
 * Promueve de `awaiting_upload` a `ready_to_emit` únicamente las entradas del
 * `deviceId` activo cuyo `cierreId` esté presente en el payload aceptado.
 */
export function markCloseSignalsUploaded(deviceId, uploadedCierreIds, { now = Date.now() } = {}) {
    if (!deviceId || !hasAnyPendingCloseSignalRaw()) return 0;
    if (!Array.isArray(uploadedCierreIds) || uploadedCierreIds.length === 0) return 0;

    const idSet = new Set(uploadedCierreIds.map((id) => String(id)));
    const { valid, changed: pruned } = pruneExpired(readQueueRaw(), now);

    let promoted = 0;
    const next = valid.map((entry) => {
        if (
            entry.deviceId === deviceId
            && entry.state === 'awaiting_upload'
            && idSet.has(String(entry.cierreId))
        ) {
            promoted += 1;
            return { ...entry, state: 'ready_to_emit' };
        }
        return entry;
    });

    if (promoted > 0 || pruned) {
        writeQueueRaw(next, deviceId);
    }
    return promoted;
}

/**
 * Predicado puro de solo lectura (sin efectos secundarios): indica si el
 * `cierreId` del `deviceId` activo sigue pendiente en la cola dentro del TTL.
 */
export function hasPendingCloseSignal(deviceId, cierreId, { now = Date.now() } = {}) {
    if (!deviceId || cierreId == null || !hasAnyPendingCloseSignalRaw()) return false;
    const entries = readQueueRaw();
    return entries.some((entry) => (
        entry
        && entry.deviceId === deviceId
        && String(entry.cierreId) === String(cierreId)
        && Number.isFinite(Number(entry.queuedAt))
        && (now - Number(entry.queuedAt)) < CLOSE_SIGNAL_TTL_MS
    ));
}

function removeEntryFromQueue(deviceId, cierreId, now = Date.now()) {
    const { valid } = pruneExpired(readQueueRaw(), now);
    const next = valid.filter(
        (e) => !(e.deviceId === deviceId && String(e.cierreId) === String(cierreId)),
    );
    writeQueueRaw(next, deviceId);
}

/**
 * Envía las señales en estado `ready_to_emit` del `deviceId` activo.
 * - Fast-path O(1) si la cola está vacía (sin parsear JSON).
 * - Single-flight por dispositivo (`_flushInFlightByDevice`).
 * - Backoff dedicado `close_signal:<deviceId>` (nunca toca `sync:<deviceId>`).
 * - Reintentos cortos `[3000, 8000]` solo cuando `immediate === true`.
 * - Fail-open: nunca lanza excepción ni revierte el estado `'synced'` del cierre.
 */
export function flushPendingCloseSignals(
    deviceId,
    {
        client = supabaseCloud,
        immediate = false,
        manual = false,
        retryDelaysMs = DEFAULT_IMMEDIATE_RETRY_DELAYS_MS,
    } = {},
) {
    if (!deviceId || !client || !hasAnyPendingCloseSignalRaw()) {
        return Promise.resolve({ ok: true, pending: false, flushed: 0 });
    }

    const existing = _flushInFlightByDevice.get(deviceId);
    if (existing) return existing;

    let settled = false;
    const run = (async () => {
        try {
            const now = Date.now();
            const { valid, changed: pruned } = pruneExpired(readQueueRaw(), now);
            if (pruned) writeQueueRaw(valid, deviceId);

            const deviceEntries = valid.filter((e) => e.deviceId === deviceId);
            const readyEntries = deviceEntries.filter((e) => e.state === 'ready_to_emit');
            if (readyEntries.length === 0) {
                return { ok: true, pending: deviceEntries.length > 0, flushed: 0 };
            }

            const retryOp = closeSignalRetryKey(deviceId);
            const retryState = getCloudRetryState(retryOp);
            if (retryState.coolingDown) {
                if (retryState.permanent) {
                    return { ok: false, pending: true, flushed: 0, reason: 'permanent_cooldown' };
                }
                const isRateLimited = retryState.lastCode === 'rate_limited';
                if (isRateLimited && !manual) {
                    return { ok: false, pending: true, flushed: 0, reason: 'cooldown' };
                }
                if (!isRateLimited && !immediate && !manual) {
                    return { ok: false, pending: true, flushed: 0, reason: 'cooldown' };
                }
                // `immediate: true` tras un cierre ignora cooldowns transitorios previos;
                // `manual: true` ("Reenviar aviso") ignora además `rate_limited`.
                clearCloudRetryFailure(retryOp);
            }

            let flushed = 0;
            let lastError = null;
            let lastReason = null;

            for (const entry of readyEntries) {
                const maxAttempts = immediate ? (1 + retryDelaysMs.length) : 1;
                let entrySettled = false;
                let stopQueue = false;

                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                    if (attempt > 0) {
                        const delay = retryDelaysMs[attempt - 1] ?? 0;
                        if (delay > 0) await sleep(delay);
                    }

                    try {
                        const { data, error } = await client.rpc('emit_shift_close_event', {
                            p_primary_device_id: deviceId,
                            p_cierre_id: Number(entry.cierreId),
                            p_cierre_number: entry.cierreNumber ?? null,
                        });

                        if (error) {
                            lastError = error;
                            if (isPermanentCloudError(error)) {
                                recordCloudRetryFailure(retryOp, error);
                                lastReason = 'permanent_error';
                                console.warn('[ShiftCloseSignal] Error permanente emitiendo señal de cierre:', error.code || error.status, error.message);
                                stopQueue = true;
                                break;
                            }

                            const hasMoreRetries = immediate && attempt < maxAttempts - 1;
                            if (hasMoreRetries) {
                                clearCloudRetryFailure(retryOp);
                                continue;
                            }
                            recordCloudRetryFailure(retryOp, error);
                            lastReason = 'rpc_error';
                            console.warn('[ShiftCloseSignal] Error transitorio emitiendo señal de cierre:', error.code || error.status, error.message);
                            stopQueue = true;
                            break;
                        }

                        const reason = data?.reason || (data?.success ? 'inserted' : 'unknown');
                        if (reason === 'rate_limited') {
                            setCloudRetryCooldown(retryOp, CLOSE_SIGNAL_RATE_LIMIT_COOLDOWN_MS, {
                                lastCode: 'rate_limited',
                            });
                            lastReason = 'rate_limited';
                            console.warn('[ShiftCloseSignal] Rate limit alcanzado al emitir señal de cierre; enfriamiento 10 min.');
                            stopQueue = true;
                            break;
                        }

                        if (
                            reason === 'inserted'
                            || reason === 'reemitted'
                            || reason === 'recent'
                            || (data?.success === true && !data?.throttled)
                        ) {
                            removeEntryFromQueue(deviceId, entry.cierreId);
                            clearCloudRetryFailure(retryOp);
                            flushed += 1;
                            entrySettled = true;
                            lastError = null;
                            lastReason = reason;
                            break;
                        }

                        // Respuesta inesperada pero sin excepción: conservar en cola
                        lastReason = reason;
                        stopQueue = true;
                        break;
                    } catch (err) {
                        lastError = err;
                        const hasMoreRetries = immediate && attempt < maxAttempts - 1;
                        if (hasMoreRetries) {
                            clearCloudRetryFailure(retryOp);
                            continue;
                        }
                        recordCloudRetryFailure(retryOp, err);
                        lastReason = 'transport';
                        console.warn('[ShiftCloseSignal] Fallo de transporte emitiendo señal de cierre:', err?.message || err);
                        stopQueue = true;
                        break;
                    }
                }

                if (stopQueue || !entrySettled) break;
            }

            const remaining = readQueueRaw().some(
                (e) => e && e.deviceId === deviceId && (Date.now() - Number(e.queuedAt)) < CLOSE_SIGNAL_TTL_MS,
            );
            const ok = !lastError && lastReason !== 'rate_limited' && !remaining;
            return {
                ok,
                pending: remaining,
                flushed,
                reason: lastReason || (ok ? 'ok' : 'pending'),
                ...(lastError ? { error: lastError } : {}),
            };
        } catch (err) {
            console.warn('[ShiftCloseSignal] Error inesperado en flushPendingCloseSignals:', err?.message || err);
            return { ok: false, pending: true, flushed: 0, reason: 'unexpected', error: err };
        } finally {
            settled = true;
            _flushInFlightByDevice.delete(deviceId);
        }
    })();

    if (!settled) {
        _flushInFlightByDevice.set(deviceId, run);
    }
    return run;
}
