/**
 * salesHistoryRestore.js — FASE 2 del plan maestro (reconstrucción del historial).
 *
 * Helpers PUROS para el comando de supervisor `replace_sales_history`
 * (ver docs/FASE-2-HANDOFF-REPLACE-SALES-HISTORY.md):
 *
 *   - detectActiveShift(sales): ¿hay un turno abierto en este array de ventas?
 *   - computeConfirmToken(sales): `${cierreCount}:${maxSaleNumber}:${recordCount}`
 *   - validateReplacePreconditions(local, cloud, token?): valida todo lo que el
 *     comando exige ANTES de tocar bodega_sales_v1.
 *
 * Sin dependencias de storage ni red: el handler de
 * useSupervisorCommands.js inyecta los datos y estas funciones deciden.
 * Todos los umbrales están testeados en tests/salesHistoryRestore.test.js.
 */

/**
 * Detecta el estado del turno a partir de un array de registros de venta.
 * Regla: existe un turno abierto si la última APERTURA_CAJA es posterior al
 * último REGISTRO_CIERRE (por timestamp). Sin aperturas no hay turno abierto.
 *
 * @param {Array} sales
 * @returns {{ open: boolean, aperturaId?: string, aperturaTs?: string, cierreId?: string, cierreTs?: string }}
 */
export function detectActiveShift(sales) {
    const arr = Array.isArray(sales) ? sales : [];
    let lastApertura = null;
    let lastCierre = null;
    for (const s of arr) {
        if (!s || typeof s !== 'object') continue;
        const ts = String(s.timestamp || '');
        if (s.tipo === 'APERTURA_CAJA') {
            if (!lastApertura || ts > String(lastApertura.timestamp || '')) lastApertura = s;
        } else if (s.tipo === 'REGISTRO_CIERRE') {
            if (!lastCierre || ts > String(lastCierre.timestamp || '')) lastCierre = s;
        }
    }
    const aperturaTs = String(lastApertura?.timestamp || '');
    const cierreTs = String(lastCierre?.timestamp || '');
    const open = Boolean(lastApertura) && aperturaTs > cierreTs;
    return {
        open,
        aperturaId: lastApertura?.id || undefined,
        aperturaTs: lastApertura?.timestamp || undefined,
        cierreId: lastCierre?.id || undefined,
        cierreTs: lastCierre?.timestamp || undefined,
    };
}

/** Máximo saleNumber numérico de las VENTA del array (0 si no hay). */
function maxSaleNumber(sales) {
    let max = 0;
    for (const s of sales) {
        if (s?.tipo === 'VENTA') {
            const n = Number(s.saleNumber);
            if (Number.isFinite(n) && n > max) max = n;
        }
    }
    return max;
}

/**
 * Token de confirmación de la referencia cloud:
 * `${cierreCount}:${maxSaleNumber}:${recordCount}`.
 * El encolador lo calcula de su propia lectura del Doc 60 y el phase `apply`
 * lo recalcula FRESCO antes de tocar nada: si la nube se movió entre prepare y
 * apply, el token no coincide y el apply se rechaza (sin round-trip de resultado).
 *
 * @param {Array} sales - array canónico (Doc 60)
 * @returns {string}
 */
export function computeConfirmToken(sales) {
    const arr = Array.isArray(sales) ? sales : [];
    const cierreCount = arr.filter((s) => s?.tipo === 'REGISTRO_CIERRE').length;
    return `${cierreCount}:${maxSaleNumber(arr)}:${arr.length}`;
}

/**
 * Valida TODAS las precondiciones del reemplazo. No muta nada.
 *
 * @param {Array} localSales - bodega_sales_v1 local del dispositivo.
 * @param {Array|null} cloudReference - copia fresca del Doc 60 (o null).
 * @param {string|null} [confirmToken] - token esperado (solo en phase `apply`).
 * @returns {{ ok: boolean, reason?: string, confirmToken: string }}
 */
export function validateReplacePreconditions(localSales, cloudReference, confirmToken = null) {
    const local = Array.isArray(localSales) ? localSales : [];

    if (!Array.isArray(cloudReference) || cloudReference.length === 0) {
        return { ok: false, reason: 'referencia cloud vacía o ilegible', confirmToken: '' };
    }
    const cierreCount = cloudReference.filter((s) => s?.tipo === 'REGISTRO_CIERRE').length;
    if (cierreCount < 1) {
        return { ok: false, reason: 'la referencia cloud no contiene cierres (doc sospechoso)', confirmToken: '' };
    }

    const token = computeConfirmToken(cloudReference);
    if (confirmToken != null && String(confirmToken) !== token) {
        return { ok: false, reason: `token no coincide (esperado ${token}, recibido ${String(confirmToken)})`, confirmToken: token };
    }

    const localMax = maxSaleNumber(local);
    const cloudMax = maxSaleNumber(cloudReference);
    if (localMax > cloudMax) {
        return {
            ok: false,
            reason: `regresión de numeración: max local (${localMax}) > max cloud (${cloudMax})`,
            confirmToken: token,
        };
    }

    const shift = detectActiveShift(local);
    if (shift.open) {
        return {
            ok: false,
            reason: `turno activo — reintentar en horario cerrado (apertura ${shift.aperturaId || '?'})`,
            confirmToken: token,
        };
    }

    return { ok: true, confirmToken: token };
}
