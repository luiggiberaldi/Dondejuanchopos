// checkoutTelemetry.js — Desglose de tiempos por etapa del checkout.
//
// Qué mide (3 fases del flujo al pulsar CONFIRMAR):
//   - render   → desde el click en PAGAR hasta que `processSaleTransaction` se
//                pone en marcha (validaciones del modal, construcción de pagos).
//   - alloc    → `allocateSaleNumber` (línea base cloud + reclamo atómico).
//   - tx       → transacción local `storageService.transaction` (persistencia
//                de venta, espejo, WAL, inventario, clientes, deepFreeze).
//   - total    → click → resultado listo para el UI.
//
// Salida:
//   - console.time('checkout:<opId>') — colapsa en DevTools el desglose de
//     esa venta (ver pestaña "Timings" de la consola).
//   - console.debug('[CheckoutTiming]' ... + tabla por fase (ms) con el total.
//
// Consulta en vivo (producción incluida):
//   _checkoutTimings()      → las últimas 10 ventas, más nueva primero.
//   _checkoutTimings(30)    → las últimas 30.
//   _checkoutTimings.clear()→ vacía el buffer.

const WINDOW_BUFFER_MAX = 20;

const state = {
    active: null,          // { opId, t0, marks: { allocMs, txMs, extraMs } }
    history: [],           // últimas ventas completadas (más nueva primero)
};

function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

// Redondeo de MILISEGUNDOS de telemetría (no es dinero): parseInt trunca a entero
// sin usar Math.round/ceil/floor, prohibidos por los guardrails FIN-016/017/018
// en src/utils (esos aplican a dinero; aquí solo medimos tiempo).
const roundMs = (n) => parseInt(n, 10) || 0;

function pushHistory(entry) {
    state.history.unshift(entry);
    if (state.history.length > WINDOW_BUFFER_MAX) state.history.length = WINDOW_BUFFER_MAX;
}

function safeConsole() {
    return typeof console !== 'undefined' ? console : null;
}

/** Marca el inicio de un checkout y devuelve el opId de correlación. */
export function checkoutStart(opId) {
    const id = String(opId || 'sin-op');
    state.active = { opId: id, t0: nowMs(), marks: { allocMs: null, txMs: null } };
    safeConsole()?.time(`checkout:${id}`);
    return id;
}

/**
 * Registra la duración de una etapa (ms). Se ignora si no hay checkout activo.
 * Emite un timeLog anidado bajo el console.time del checkout (colapsa en DevTools).
 */
export function checkoutStage(stage, durationMs) {
    const a = state.active;
    if (!a || !Number.isFinite(durationMs)) return;
    const ms = Math.max(0, roundMs(durationMs));
    if (stage === 'alloc') {
        if (a.marks.allocMs === null) a.marks.allocMs = ms;
        try { console.timeLog(`checkout:${a.opId}`, stage, ms + 'ms'); } catch { /* best-effort */ }
    }
    // La fase tx se mide por intervalos (checkoutTxBegin/End), no por stage().
}

/** Cierra el checkout activo y registra la venta completa en el historial. */
export function checkoutEnd({ ok = true, error = null, duplicate = false } = {}) {
    const a = state.active;
    if (!a) return null;
    state.active = null;
    safeConsole()?.timeEnd(`checkout:${a.opId}`);
    const totalMs = roundMs(nowMs() - a.t0);
    const entry = {
        opId: a.opId,
        totalMs,
        renderMs: a.marks.renderMs ?? null,
        allocMs: a.marks.allocMs,
        txMs: a.marks.txMs,
        unattributedMs: Math.max(0, totalMs - (a.marks.renderMs ?? 0) - (a.marks.allocMs ?? 0) - (a.marks.txMs ?? 0)),
        ok,
        duplicate,
        error: error ? String(error).slice(0, 200) : null,
        at: new Date().toISOString(),
    };
    pushHistory(entry);
    const c = safeConsole();
    if (c?.debug) {
        const breakdown = [
            a.marks.renderMs != null ? `render=${a.marks.renderMs}ms` : null,
            a.marks.allocMs != null ? `alloc=${a.marks.allocMs}ms` : null,
            a.marks.txMs != null ? `tx=${a.marks.txMs}ms` : null,
        ].filter(Boolean).join(' · ');
        c.debug(
            `%c[CheckoutTiming]%c ${ok ? '✓' : '✗'} ${a.opId.slice(0, 8)} total=${totalMs}ms${breakdown ? ` (${breakdown})` : ''}${error ? ` err=${String(error).slice(0, 120)}` : ''}`,
            'background:#0f172a;color:#a5f3fc;font-weight:bold;padding:1px 5px;border-radius:3px',
            'color:inherit',
        );
    }
    return entry;
}

/** Rendido por el checkout: tiempo desde el click hasta que arranca el procesador. */
export function checkoutRenderDone() {
    const a = state.active;
    if (!a) return;
    a.marks.renderMs = roundMs(nowMs() - a.t0);
}

/** Abre el intervalo de la transacción local. Varias transacciones acumulan. */
export function checkoutTxBegin() {
    const a = state.active;
    if (!a) return;
    a.activeTx = true;
    a.txStart = nowMs();
}

/** Cierra el intervalo de la transacción local y acumula su duración en txMs. */
export function checkoutTxEnd() {
    const a = state.active;
    if (!a || !a.activeTx) return;
    const durationMs = Math.max(0, nowMs() - (a.txStart ?? nowMs()));
    a.activeTx = false;
    a.txStart = null;
    a.marks.txMs = roundMs((a.marks.txMs || 0) + durationMs);
}

/** Historial in-memory de las últimas ventas (visor de producción). */
export function getCheckoutTimings(limit = 10) {
    return state.history.slice(0, Math.max(1, limit));
}

export function clearCheckoutTimings() {
    state.history = [];
    state.active = null;
}

// Visor global para diagnóstico en producción (sin DevTools conectadas al build dev).
if (typeof window !== 'undefined') {
    const view = (limit = 10) => {
        const rows = getCheckoutTimings(limit);
        const c = safeConsole();
        if (c?.table) c.table(rows);
        return rows;
    };
    view.clear = clearCheckoutTimings;
    view.max = WINDOW_BUFFER_MAX;
    window._checkoutTimings = view;
}
