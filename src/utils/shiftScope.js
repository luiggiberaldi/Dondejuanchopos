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
    const openAperturas = list.filter(s => s && s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
    if (openAperturas.length === 0) return null;
    if (openAperturas.length === 1) return openAperturas[0];

    // Guarda-rail Anti-Reinicio Accidental:
    // Si hay múltiples aperturas abiertas (ej. el cajero re-abrió con 0 Bs tras un reinicio falso),
    // se prioriza aquella que contenga fondos iniciales reales (openingBs > 0 || openingUsd > 0)
    // y que tenga el timestamp más temprano del turno actual, protegiendo las ventas previas de ser huérfanas.
    const withFloat = openAperturas.filter(a => (
        (Number(a.openingBs) || 0) > 0 ||
        (Number(a.openingUsd) || 0) > 0 ||
        (Number(a.openingCop) || 0) > 0
    ));
    if (withFloat.length > 0) {
        return withFloat.sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime())[0];
    }

    // Si ninguna tiene fondos declarados, retornar la última registrada
    return openAperturas[openAperturas.length - 1];
}

/**
 * Movimientos del turno abierto: todo lo no cerrado desde la apertura vigente.
 * @returns {{ movements: Array, orphans: Array, voided: Array, apertura: object|null }}
 *   `orphans` son movimientos sin cerrar ANTERIORES a la apertura vigente —
 *   restos de un turno que nunca se cerró. No se arrastran en silencio: se
 *   reportan para que el usuario decida.
 *   `voided` son ventas anuladas ocurridas durante el turno activo para archivarlas
 *   al cerrar caja.
 */
export function getOpenShiftMovements(sales) {
    const apertura = findOpenApertura(sales);
    const from = apertura?.timestamp ? new Date(apertura.timestamp).getTime() : null;

    const movements = [];
    const orphans = [];
    const voided = [];
    for (const s of sales || []) {
        if (s.cajaCerrada === true) continue;
        const ts = s.timestamp ? new Date(s.timestamp).getTime() : null;
        if (s.status === 'ANULADA') {
            if (from !== null && ts !== null && ts >= from) {
                voided.push(s);
            }
            continue;
        }
        if (!TIPOS_CIERRE.includes(s.tipo || 'VENTA')) continue;
        if (from === null || (ts !== null && ts < from)) orphans.push(s);
        else movements.push(s);
    }
    return { movements, orphans, voided, apertura };
}

