const RETRY_STATE_PREFIX = 'dj_cloud_retry_v1:';
const TRANSIENT_RETRY_BASE_MS = 15_000;
const TRANSIENT_RETRY_MAX_MS = 30 * 60 * 1000;
const PERMANENT_RETRY_BASE_MS = 5 * 60 * 1000;
const PERMANENT_RETRY_MAX_MS = 6 * 60 * 60 * 1000;
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429]);
const PERMANENT_DATABASE_CODES = new Set(['42501', '42703', '42P01', '42883', 'P0001']);
const GLOBAL_DATABASE_CODES = new Set(['42501', '42703', '42P01', '42883', 'P0001']);
// FASE 1: el candado GLOBAL de subida nunca puede congelar la caja más de un tick (60 s)
// salvo errores fatales de credenciales/endpoint (401/403/404 o esquema permanente).
export const GLOBAL_LOCK_MAX_MS = 60 * 1000;
// FASE 1: un vínculo de emparejamiento desactualizado viaja como HTTP 400 + P0001,
// pero NO es un fallo de esquema: se cura solo cuando el vínculo se refresca.
const PAIRING_MESSAGE_MARKERS = ['REMOTE_AUDIT_', 'POS_SYNC_DEVICE_NOT_REGISTERED'];

function retryStorageKey(operation) {
    return `${RETRY_STATE_PREFIX}${encodeURIComponent(operation)}`;
}

function readState(operation) {
    try {
        const raw = localStorage.getItem(retryStorageKey(operation));
        if (!raw) return null;
        const state = JSON.parse(raw);
        return Number.isFinite(state?.failureCount) && Number.isFinite(state?.nextRetryAt) ? state : null;
    } catch {
        return null;
    }
}

function writeState(operation, state) {
    try {
        localStorage.setItem(retryStorageKey(operation), JSON.stringify(state));
    } catch {
        // Backoff is best-effort when browser storage is unavailable.
    }
}

export function isPairingLinkError(error) {
    const message = String(error?.message || '');
    return PAIRING_MESSAGE_MARKERS.some(marker => message.includes(marker));
}

export function isPermanentCloudError(error) {
    // FASE 1: el vínculo desactualizado llega con P0001 pero es transitorio:
    // no debe clasificarse como fallo permanente de esquema (5 min - 6 h).
    if (isPairingLinkError(error)) return false;
    const code = String(error?.code || '').toUpperCase();
    if (PERMANENT_DATABASE_CODES.has(code)) return true;

    const status = Number(error?.status ?? error?.statusCode);
    if (!Number.isFinite(status)) return false;
    if (RETRYABLE_HTTP_STATUSES.has(status)) return false;
    return status >= 400 && status < 500;
}

/** Authorization, missing endpoint/schema and transport/server failures affect
 * the whole sync route. Payload-specific client errors remain scoped per doc. */
export function isGlobalCloudFailure(error) {
    const code = String(error?.code || '').toUpperCase();
    if (GLOBAL_DATABASE_CODES.has(code)) return true;

    const status = Number(error?.status ?? error?.statusCode);
    if (!Number.isFinite(status)) return true; // network/transport failure
    return status === 401 || status === 403 || status === 404 || status === 429 || status >= 500;
}

/** FASE 1: ¿el candado global de este error puede acotarse a un tick (60 s)?
 * Sí para errores que se curan solos (vínculo desactualizado, red, 5xx, 429).
 * No para credenciales inválidas (401/403), endpoint ausente (404) ni esquema
 * permanente (42703/42P01/42883/42501), donde el backoff largo evita martillar. */
export function shouldCapGlobalLock(error) {
    if (isPairingLinkError(error)) return true;
    if (isPermanentCloudError(error)) return false;
    const status = Number(error?.status ?? error?.statusCode);
    if (!Number.isFinite(status)) return true; // red/transporte: transitorio
    if (status === 401 || status === 403 || status === 404) return false;
    return true;
}

/**
 * Reintentos transitorios: 15 s, 30 s, 60 s... hasta 30 min (+/- 20% jitter).
 * Errores 4xx/permisos/esquema empiezan en cinco minutos y crecen hasta seis horas.
 */
export function getCloudRetryDelay(error, failureCount, random = Math.random) {
    const exponent = Math.max(0, Math.min(20, Math.floor(failureCount) - 1));
    if (isPermanentCloudError(error)) {
        return Math.min(PERMANENT_RETRY_MAX_MS, PERMANENT_RETRY_BASE_MS * (2 ** exponent));
    }

    const baseDelay = Math.min(TRANSIENT_RETRY_MAX_MS, TRANSIENT_RETRY_BASE_MS * (2 ** exponent));
    const jitter = 0.8 + (Math.max(0, Math.min(1, random())) * 0.4);
    return Math.round(baseDelay * jitter);
}

export function getCloudRetryState(operation, now = Date.now()) {
    const state = readState(operation);
    const remainingMs = Math.max(0, (state?.nextRetryAt || 0) - now);
    return {
        coolingDown: remainingMs > 0,
        remainingMs,
        failureCount: state?.failureCount || 0,
        permanent: state?.permanent || false,
    };
}

export function recordCloudRetryFailure(operation, error, { now = Date.now(), random = Math.random, maxDelayMs = Infinity } = {}) {
    const previous = readState(operation);
    const failureCount = (previous?.failureCount || 0) + 1;
    // FASE 1: maxDelayMs acota el backoff (usado por el candado global de la caja).
    const delayMs = Math.min(getCloudRetryDelay(error, failureCount, random), maxDelayMs);
    const state = {
        failureCount,
        nextRetryAt: now + delayMs,
        permanent: isPermanentCloudError(error),
        lastStatus: Number(error?.status ?? error?.statusCode) || null,
        lastCode: String(error?.code || '') || null,
    };
    writeState(operation, state);
    return { ...state, delayMs };
}

export function clearCloudRetryFailure(operation) {
    try {
        localStorage.removeItem(retryStorageKey(operation));
    } catch {
        // Best-effort cleanup.
    }
}

/** Run one REST/RPC write and persist backoff if Supabase returns error or fetch rejects. */
export async function runCloudUploadWithBackoff(operation, upload, options = {}) {
    const retryState = getCloudRetryState(operation, options.now ?? Date.now());
    if (retryState.coolingDown) {
        return { success: false, skipped: true, retryInMs: retryState.remainingMs };
    }

    try {
        const result = await upload();
        if (result?.error) {
            const failure = recordCloudRetryFailure(operation, result.error, options);
            return { success: false, skipped: false, error: result.error, retryInMs: failure.delayMs };
        }
        clearCloudRetryFailure(operation);
        return { success: true, skipped: false, data: result?.data };
    } catch (error) {
        const failure = recordCloudRetryFailure(operation, error, options);
        return { success: false, skipped: false, error, retryInMs: failure.delayMs };
    }
}

