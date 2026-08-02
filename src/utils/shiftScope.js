// src/utils/shiftScope.js
// El turno NO está acotado por día: puede cruzar la medianoche (ver commit 62aaa77).
// Acotarlo por `localDate === today` hacía que el resumen contara una fracción de
// lo que el cierre marcaba como cerrado, y esa diferencia se perdía para siempre.
//
// GASTO_INTERNO va INCLUIDO: es plata que sale de la gaveta y tiene que bajar el
// efectivo esperado del arqueo. FinancialEngine ya distingue por `afectaCaja`
// (el autoconsumo no toca la gaveta), así que aquí no hay que filtrarlo.
export const TIPOS_CIERRE = ['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA', 'COBRO_DEUDA', 'PAGO_PROVEEDOR', 'GASTO_INTERNO', 'APERTURA_CAJA'];

/**
 * Predicado oficial para determinar si un movimiento forma parte del flujo de caja.
 * Excluye movimientos ya cerrados o anulados.
 */
export function isCashFlowMovement(sale) {
    if (!sale || sale.status === 'ANULADA') return false;
    const tipo = sale.tipo || 'VENTA';
    return TIPOS_CIERRE.includes(tipo);
}

/** Apertura que abrió el turno vigente (la única APERTURA_CAJA sin cerrar). */
export function findOpenApertura(sales) {
    const list = sales || [];
    for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i];
        if (s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada) {
            return s;
        }
    }
    return list.find(s => s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada) || null;
}

/**
 * Movimientos del turno abierto: todo lo no cerrado desde la apertura vigente.
 * @returns {{ movements: Array, orphans: Array, apertura: object|null }}
 *   `orphans` son movimientos sin cerrar ANTERIORES a la apertura vigente —
 *   restos de un turno que nunca se cerró. No se arrastran en silencio: se
 *   reportan para que el usuario decida.
 */
export function getOpenShiftMovements(sales) {
    const apertura = findOpenApertura(sales);
    const from = apertura?.timestamp ? new Date(apertura.timestamp).getTime() : null;

    const movements = [];
    const orphans = [];
    for (const s of sales || []) {
        if (s.cajaCerrada === true) continue;
        if (s.status === 'ANULADA') continue;
        if (!TIPOS_CIERRE.includes(s.tipo || 'VENTA')) continue;
        const ts = s.timestamp ? new Date(s.timestamp).getTime() : null;
        if (from !== null && ts !== null && ts < from) orphans.push(s);
        else movements.push(s);
    }
    return { movements, orphans, apertura };
}
