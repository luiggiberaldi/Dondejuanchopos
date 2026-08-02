/**
 * dinero.js — Aritmética financiera segura
 *
 * Centraliza TODA la lógica de redondeo del sistema POS.
 * Usa round-half-away-from-zero (estándar financiero internacional).
 *
 * REGLA DE ORO: Toda operación aritmética con dinero DEBE pasar por estas funciones.
 *               Nunca usar Math.round, toFixed, o parseFloat para redondear montos.
 */

/**
 * Redondea `n` a `decimals` decimales con round-half-away-from-zero, sin el bug
 * clásico de IEEE-754 en el caso .5 (ej: 2.005 → 2.01, no 2.00).
 *
 * Técnica: desplazar el punto decimal operando sobre la representación en STRING
 * del número (vía notación exponencial `NeD`), no multiplicando el float. Multiplicar
 * (`n * 10**decimals`) reintroduce el error de representación en punto flotante y ese
 * error CRECE con la magnitud de `n` — para montos en Bs (que en un POS venezolano
 * fácilmente superan varios miles por la inflación) el enfoque ingenuo con
 * `Number.EPSILON` deja de funcionar a partir de 2^13 = 8192 porque a esa magnitud
 * el ULP del double ya excede EPSILON. El shift por string evita ese problema porque
 * usa el parser decimal correctamente redondeado del motor JS, no una multiplicación.
 * Verificado sin fallos en un scan exhaustivo de 1..2,000,000 con offset .005.
 *
 * @param {number} n
 * @param {number} decimals
 * @returns {number}
 */
// ── GR-5: Tripwire de resultado no finito ────────────────────────────────────
// Un `NaN` no lanza: se propaga. `calculatePaymentBreakdown` filtra por
// `total !== 0`, que es `true` para `NaN`, así que un bucket corrupto sobrevive
// hasta el PDF de cierre sin que nadie lo note. Si una entrada finita produce una
// salida no finita, es un bug de la primitiva y debe ser ruidoso, nunca silencioso.
let _nanReportCount = 0;
const _NAN_REPORT_CAP = 5; // evita inundar la auditoría si el fallo es sistemático

function _tripwire(n, decimals, out) {
    if (Number.isFinite(out)) return out;

    const msg = `[dinero] Resultado no finito: _shiftRound(${n}, ${decimals}) → ${out}`;

    if (import.meta.env?.DEV) {
        throw new Error(msg);
    }

    console.error(msg);
    if (_nanReportCount < _NAN_REPORT_CAP) {
        _nanReportCount++;
        // Import diferido: dinero.js es una hoja y no debe crear un ciclo estático.
        import('../services/auditService')
            .then(({ logEvent }) => logEvent('CONFIG', 'DINERO_NON_FINITE', msg, null, { input: String(n), decimals }))
            .catch(() => { /* la auditoría nunca puede tumbar un cálculo */ });
    }
    return 0;
}

function _shiftRound(n, decimals) {
    if (!Number.isFinite(n)) return 0;
    const sign = n < 0 ? -1 : 1;
    const abs = Math.abs(n);
    if (abs < 1e-12) return 0;
    const [mantissa, exp = '0'] = abs.toExponential().split('e');
    const shifted = Number(`${mantissa}e${Number(exp) + decimals}`);
    const rounded = Math.round(shifted);
    const [rm, re = '0'] = Math.abs(rounded).toExponential().split('e');
    const out = sign * Math.sign(rounded) * Number(`${rm}e${Number(re) - decimals}`);
    return _tripwire(n, decimals, out + 0);   // `+ 0` normaliza -0 → 0
}

/**
 * Redondea a 2 decimales (centavos) con round-half-away-from-zero.
 * @param {number} n - Número a redondear
 * @returns {number} Número redondeado a 2 decimales
 */
export const round2 = (n) => _shiftRound(n, 2);

/**
 * Redondea a 4 decimales (para tasas de cambio y precios unitarios internos).
 * @param {number} n
 * @returns {number}
 */
export const round4 = (n) => _shiftRound(n, 4);

/**
 * Redondea a 3 decimales (para cantidades de peso: gramos/kg en ventas por peso).
 * @param {number} n
 * @returns {number}
 */
export const round3 = (n) => _shiftRound(n, 3);

/**
 * Redondea a entero (round-half-away-from-zero).
 * Útil para Bs (política del POS: precios en Bs siempre a entero) y scores.
 * @param {number} n
 * @returns {number}
 */
export const round0 = (n) => _shiftRound(n, 0);

/**
 * Redondea un monto en Bolívares al múltiplo MÁS CERCANO del paso indicado (ej: 10 Bs).
 *
 * POLÍTICA OFICIAL de precios en Bs del POS (decisión D-2, confirmada 2026-08-01).
 * Es bidireccional a propósito: `45 → 50` (+5) pero `44 → 40` (−4). El diferencial
 * resultante es de signo variable, así que lo que importa es el ACUMULADO del turno,
 * no el de cada línea — se expone como `bsRoundingDiffBs` en `buildCartTotals`.
 *
 * Si step <= 0, retorna round2(amount) sin redondeo de múltiplo.
 * @param {number} n
 * @param {number} step
 * @returns {number}
 */
export const roundBs = (n, step = 10) => {
    if (!Number.isFinite(n)) return 0;
    if (!step || step <= 0) return round2(n);
    return Math.round(n / step) * step;
};

/**
 * Redondea hacia +infinito (ceil) a entero. Reemplaza `Math.ceil` en código financiero.
 *
 * ⚠️ NO es la política de precios en Bolívares. Esta función existe para los casos
 * puntuales que sí requieren techo; el redondeo de precios en Bs lo hace `roundBs`,
 * al múltiplo MÁS CERCANO (decisión D-2, confirmada 2026-08-01).
 *
 * El JSDoc anterior afirmaba "siempre redondear Bs hacia arriba", que describe una
 * política que el sistema no aplica: el camino `tasa_dia` de `calculatePricing` usa
 * `roundBs`, no `ceilR`. La documentación era el defecto, no el código.
 *
 * @param {number} n
 * @returns {number}
 */
export const ceilR = (n) => {
    if (!Number.isFinite(n)) return 0;
    return Math.ceil(n);
};

/**
 * Multiplica dos números y redondea a 2 decimales.
 * Para cadenas como precio * cantidad * tasa, encadenar: mulR(mulR(price, qty), rate)
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export const mulR = (a, b) => round2((a || 0) * (b || 0));

/**
 * Divide dos números y redondea a 2 decimales.
 * Para conversiones de moneda: divR(montoBs, tasa) = montoUsd
 * @param {number} a - Numerador
 * @param {number} b - Denominador (si es 0, retorna 0)
 * @returns {number}
 */
export const divR = (a, b) => {
    if (!b || !Number.isFinite(b) || b === 0) return 0;
    return round2((a || 0) / b);
};

/**
 * Suma números o un array de números y redondea el resultado a 2 decimales.
 * Previene acumulación de drift en reduce().
 * @example sumR([1, 2, 3]) // 6
 * @example sumR(1, 2) // 3
 * @param {...number|number[]} args
 * @returns {number}
 */
export const sumR = (...args) => {
    const arr = Array.isArray(args[0]) ? args[0] : args;
    return round2(arr.reduce((a, b) => a + (b || 0), 0));
};

/**
 * Resta segura: a - b, redondeada a 2 decimales.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export const subR = (a, b) => round2((a || 0) - (b || 0));
