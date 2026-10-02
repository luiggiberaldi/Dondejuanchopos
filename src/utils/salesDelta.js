/**
 * salesDelta.js — Ventas por delta (Fase 2 del plan de egress).
 *
 * Problema: `bodega_sales_v1` (1.76 MB medidos, 1262 ventas) se re-subía
 * COMPLETO en cada venta y Realtime lo retransmitía entero a cada monitor
 * (~4 MB/venta con kardex+productos). Patrón portado de PreciosAlDía Pro
 * (QUOTA-003): en cada venta solo viaja el delta del día
 * (`bodega_sales_delta_YYYY-MM-DD`, ~KB). El receptor fusiona por id con
 * mergeSalesArrays (idempotente, no destructivo). La ventana completa se
 * sigue subiendo pero throttled (bootstrap de monitores).
 *
 * Todo aquí es puro y testeable; el wiring vive en
 * useCloudSync (push) y useMonitorSync (merge).
 */

export const SALES_DELTA_KEY_PREFIX = 'bodega_sales_delta_';

/** Días de delta que el monitor pide en cada full pull (catch-up offline). */
export const SALES_DELTA_PULL_DAYS = 7;

/** Fecha local YYYY-MM-DD (zona horaria del dispositivo, igual que la caja). */
export function salesDayString(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** doc_id del delta para un día: `bodega_sales_delta_2026-10-02`. */
export function salesDeltaKeyForDate(dateStr) {
    return `${SALES_DELTA_KEY_PREFIX}${dateStr}`;
}

/** ¿Es esta key un delta diario de ventas? */
export function isSalesDeltaKey(key) {
    return typeof key === 'string'
        && key.startsWith(SALES_DELTA_KEY_PREFIX)
        && /^\d{4}-\d{2}-\d{2}$/.test(key.slice(SALES_DELTA_KEY_PREFIX.length));
}

/** Keys de delta de hoy hacia atrás (para pulls de bootstrap/catch-up). */
export function salesDeltaKeysForLastNDays(n = SALES_DELTA_PULL_DAYS, fromDate = new Date()) {
    const keys = [];
    for (let i = 0; i < n; i++) {
        const d = new Date(fromDate);
        d.setDate(d.getDate() - i);
        keys.push(salesDeltaKeyForDate(salesDayString(d)));
    }
    return keys;
}

function saleTimestampMs(sale) {
    const raw = sale?.createdAt || sale?.timestamp || sale?.fecha;
    const t = raw ? new Date(raw).getTime() : NaN;
    return Number.isFinite(t) ? t : 0;
}

/** ms del timestamp de una venta (para agrupar deltas por día). */
export function saleTimeMs(sale) {
    return saleTimestampMs(sale);
}

/** Tickets cuya fecha de venta cae en el día dado (YYYY-MM-DD local). */
export function filterTicketsForDay(tickets, dateStr) {
    if (!Array.isArray(tickets)) return [];
    return tickets.filter((t) => {
        const ts = saleTimestampMs(t);
        if (!ts) return false;
        return salesDayString(new Date(ts)) === dateStr;
    });
}

/** Payload del delta: { date, tickets } con solo los tickets del día. */
export function buildSalesDeltaPayload(tickets, dateStr) {
    const date = dateStr || salesDayString();
    return { date, tickets: filterTicketsForDay(tickets, date) };
}

/** Validador liviano del payload del delta. */
export function isValidSalesDelta(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    if (typeof payload.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) return false;
    return Array.isArray(payload.tickets);
}

/** Extrae los tickets de un payload de delta (acepta array legacy). */
export function salesDeltaTickets(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.tickets)) return payload.tickets;
    return [];
}
