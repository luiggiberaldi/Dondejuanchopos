import { divR, mulR, round2, subR, sumR } from '../utils/dinero';
import { CHECKOUT_POLICY } from '../utils/securityConstants';

const VIRTUAL_METHODS = new Set(['cashea', 'saldo_favor']);
const CASH_METHODS = new Set(['efectivo_usd', 'efectivo_bs', 'efectivo_cop']);

// Métodos permitidos para liquidar el faltante de vuelto fuera de la gaveta.
// Se valida otra vez en el processor: la UI nunca es la autoridad financiera.
export const CHANGE_OWED_METHODS = Object.freeze([
    'pago_movil',
    'zelle',
    'transferencia',
    'efectivo_externo',
    'otro',
]);

const normalizeCurrency = (currency) => {
    const normalized = String(currency || '').toUpperCase();
    return normalized === 'VES' ? 'BS' : normalized;
};

const finiteMoney = (value) => Number.isFinite(Number(value)) && Number(value) >= 0;

export function validateChangeOwed(changeOwed, { rate = 0 } = {}) {
    if (!changeOwed || typeof changeOwed !== 'object') {
        return { valid: false, error: 'El vuelto por fuera no está configurado.' };
    }

    const method = String(changeOwed.method || '').trim();
    if (!CHANGE_OWED_METHODS.includes(method)) {
        return { valid: false, error: `Método de vuelto por fuera inválido: ${method || '(vacío)'}.` };
    }

    const amountUsd = Number(changeOwed.amountUsd);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
        return { valid: false, error: 'El monto de vuelto por fuera es inválido.' };
    }

    const hasAmountBs = Object.prototype.hasOwnProperty.call(changeOwed, 'amountBs');
    const amountBs = hasAmountBs ? Number(changeOwed.amountBs) : null;
    if (hasAmountBs && (!Number.isFinite(amountBs) || amountBs < 0)) {
        return { valid: false, error: 'El equivalente en bolívares del vuelto por fuera es inválido.' };
    }
    if (hasAmountBs && Number(rate) > 0 && Math.abs(subR(divR(amountBs, rate), round2(amountUsd))) > CHECKOUT_POLICY.TOTAL_DRIFT_USD) {
        return { valid: false, error: 'El vuelto por fuera no cuadra entre USD y bolívares.' };
    }

    return {
        valid: true,
        method,
        amountUsd: round2(amountUsd),
        amountBs: amountBs === null ? null : round2(amountBs),
        note: typeof changeOwed.note === 'string' ? changeOwed.note.trim().slice(0, 240) : '',
    };
}

export const isCashPayment = (payment, activeMethods = []) => {
    if (typeof payment?.isCash === 'boolean') return payment.isCash;
    if (CASH_METHODS.has(payment?.methodId)) return true;
    const configured = activeMethods.find((method) => method.id === payment?.methodId);
    return configured?.isCash === true;
};

const resolveMethod = (payment, activeMethods) => {
    if (VIRTUAL_METHODS.has(payment?.methodId)) return true;
    if (!payment?.methodId) return false;
    if (!Array.isArray(activeMethods) || activeMethods.length === 0) return true;
    return activeMethods.some((method) => method.id === payment.methodId);
};

export function validatePaymentInput(payment, activeMethods = []) {
    const currency = normalizeCurrency(payment?.currency);
    const amountInput = Number(payment?.amountInput ?? payment?.amountUsd ?? payment?.amountBs ?? payment?.amountCop);

    if (!payment || !payment.methodId) return { valid: false, error: 'Método de pago ausente.' };
    if (!CHECKOUT_POLICY.VALID_CURRENCIES.includes(currency)) {
        return { valid: false, error: `Moneda de pago inválida: ${currency || '(vacía)'}.` };
    }
    if (!resolveMethod(payment, activeMethods)) {
        return { valid: false, error: `Método de pago no activo: ${payment.methodId}.` };
    }
    if (!finiteMoney(amountInput)) {
        return { valid: false, error: `Monto inválido para ${payment.methodId}.` };
    }
    return { valid: true };
}

export function calculatePaymentState({
    cartTotalUsd,
    cartTotalBs,
    payments = [],
    rate,
    tasaCop = 0,
    activeMethods = [],
    saldoFavorUsd = 0,
    casheaUsd = 0,
}) {
    const totalUsd = round2(Number(cartTotalUsd) || 0);
    const totalBs = round2(Number(cartTotalBs) || 0);
    const safeRate = Number(rate) > 0 ? Number(rate) : 0;
    const safeTasaCop = Number(tasaCop) > 0 ? Number(tasaCop) : 0;
    const errors = [];
    const normalizedPayments = [];

    for (const payment of payments) {
        const validation = validatePaymentInput(payment, activeMethods);
        if (!validation.valid) {
            errors.push(validation.error);
            continue;
        }
        const currency = normalizeCurrency(payment.currency);
        const amountInput = round2(Number(payment.amountInput ?? (currency === 'USD' ? payment.amountUsd : currency === 'BS' ? payment.amountBs : payment.amountCop)) || 0);
        const amountUsd = round2(payment.amountUsd != null
            ? Number(payment.amountUsd) || 0
            : currency === 'USD'
                ? amountInput
                : currency === 'COP' && safeTasaCop > 0
                    ? divR(amountInput, safeTasaCop)
                    : safeRate > 0
                        ? divR(amountInput, safeRate)
                        : 0);
        const amountBs = round2(payment.amountBs != null
            ? Number(payment.amountBs) || 0
            : currency === 'BS'
                ? amountInput
                : currency === 'COP' && safeTasaCop > 0 && safeRate > 0
                    ? mulR(divR(amountInput, safeTasaCop), safeRate)
                    : safeRate > 0
                        ? mulR(amountInput, safeRate)
                        : 0);
        if (!finiteMoney(amountUsd) || !finiteMoney(amountBs)) {
            errors.push(`Conversión inválida para ${payment.methodId}.`);
            continue;
        }
        normalizedPayments.push({
            ...payment,
            currency,
            amountInput,
            amountUsd,
            amountBs,
            isCash: isCashPayment(payment, activeMethods),
        });
    }

    const paidBs = sumR(normalizedPayments
        .filter((payment) => payment.currency === 'BS')
        .map((payment) => payment.amountBs));
    const paidUsdDirect = sumR(normalizedPayments
        .filter((payment) => payment.currency === 'USD' && payment.methodId !== 'saldo_favor' && payment.methodId !== 'cashea')
        .map((payment) => payment.amountUsd));
    const paidCopUsd = safeTasaCop > 0
        ? sumR(normalizedPayments.filter((payment) => payment.currency === 'COP').map((payment) => divR(payment.amountInput, safeTasaCop)))
        : 0;
    const foreignUsd = sumR([paidUsdDirect, paidCopUsd, Number(saldoFavorUsd) || 0, Number(casheaUsd) || 0]);
    const hasForeignPayment = foreignUsd > CHECKOUT_POLICY.PAYMENT_ZERO;

    let state;
    if (!hasForeignPayment) {
        const remainingBs = round2(Math.max(0, subR(totalBs, paidBs)));
        const changeBs = round2(Math.max(0, subR(paidBs, totalBs)));
        const paidRatio = totalBs > 0 ? divR(paidBs, totalBs) : 0;
        const remainingRatio = totalBs > 0 ? divR(remainingBs, totalBs) : 0;
        state = {
            regime: 'PURE_BS',
            paid: { usd: round2(mulR(totalUsd, paidRatio)), bs: paidBs, cop: 0 },
            remaining: { usd: round2(mulR(totalUsd, remainingRatio)), bs: remainingBs },
            // En régimen puro Bs el vuelto real y operativo está en Bs. El USD es
            // únicamente una equivalencia visual; no debe alimentar la caja ni el
            // registro de vuelto y provocar una doble contabilización.
            change: {
                usd: 0,
                bs: changeBs,
                totalUsd: safeRate > 0 ? divR(changeBs, safeRate) : 0,
                totalBs: changeBs,
                authority: 'BS',
            },
        };

    } else {
        const paidUsd = sumR([foreignUsd, safeRate > 0 ? divR(paidBs, safeRate) : 0]);
        const remainingUsd = round2(Math.max(0, subR(totalUsd, paidUsd)));
        const changeUsd = round2(Math.max(0, subR(paidUsd, totalUsd)));

        const changeTotalBs = round2(mulR(changeUsd, safeRate));
        state = {
            regime: 'USD',
            paid: { usd: paidUsd, bs: round2(mulR(paidUsd, safeRate)), cop: sumR(normalizedPayments.filter((payment) => payment.currency === 'COP').map((payment) => payment.amountInput)) },
            remaining: { usd: remainingUsd, bs: round2(mulR(remainingUsd, safeRate)) },
            change: {
                usd: changeUsd,
                bs: changeTotalBs,
                totalUsd: changeUsd,
                totalBs: changeTotalBs,
                authority: 'USD',
            },
        };
    }

    const physicalCashReceived = {
        usd: sumR(normalizedPayments.filter((payment) => payment.isCash && payment.currency === 'USD').map((payment) => payment.amountUsd)),
        bs: sumR(normalizedPayments.filter((payment) => payment.isCash && payment.currency === 'BS').map((payment) => payment.amountBs)),
        cop: sumR(normalizedPayments.filter((payment) => payment.isCash && payment.currency === 'COP').map((payment) => payment.amountInput)),
    };

    return {
        ...state,
        isPaid: state.remaining.usd <= CHECKOUT_POLICY.PAYMENT_ZERO,
        errors,
        normalizedPayments,
        physicalCashReceived,
        hasForeignPayment,
        safeRate,
        safeTasaCop,
        totalUsd,
        totalBs,
    };
}

/**
 * Calcula una partición de vuelto sin convertir de una moneda a otra y volver a
 * redondear el total. `totalChangeBs` es la autoridad cuando se proporciona;
 * así un vuelto puro en Bs de 50 no se transforma en 1.09 USD y luego en 50.14 Bs.
 */
export function calculateChangeAllocation({
    totalChangeUsd = 0,
    totalChangeBs = null,
    physicalUsd = 0,
    physicalBs = 0,
    rate,
}) {
    const safeRate = Number(rate) > 0 ? Number(rate) : 0;
    const hasBsAuthority = totalChangeBs !== null && totalChangeBs !== undefined;
    const targetBs = hasBsAuthority
        ? round2(Number(totalChangeBs) || 0)
        : safeRate > 0
            ? mulR(Number(totalChangeUsd) || 0, safeRate)
            : 0;
    const givenUsd = round2(Number(physicalUsd) || 0);
    const givenBs = round2(Number(physicalBs) || 0);
    const givenBsFromUsd = safeRate > 0 ? mulR(givenUsd, safeRate) : 0;
    const distributedBs = sumR([givenBsFromUsd, givenBs]);
    const remainingBs = round2(Math.max(0, subR(targetBs, distributedBs)));

    return {
        givenUsd,
        givenBs,
        givenBsFromUsd,
        distributedBs,
        totalChangeBs: targetBs,
        remainingBs,
        totalChangeUsd: safeRate > 0 ? divR(targetBs, safeRate) : round2(Number(totalChangeUsd) || 0),
        remainingUsd: safeRate > 0 ? divR(remainingBs, safeRate) : 0,
    };
}

/**
 * Actualiza un campo de partición de vuelto sin modificar silenciosamente el
 * otro campo. El cajero puede registrar, por ejemplo, $4 + Bs 500; solo se
 * limita el campo que exceda el vuelto disponible.
 */
export function calculateChangeInputUpdate({
    currency,
    requestedValue = 0,
    currentUsd = 0,
    currentBs = 0,
    totalChangeBs = 0,
    rate,
}) {
    const safeRate = Number(rate) > 0 ? Number(rate) : 0;
    const targetBs = round2(Math.max(0, Number(totalChangeBs) || 0));
    const existingUsd = round2(Math.max(0, Number(currentUsd) || 0));
    const existingBs = round2(Math.max(0, Number(currentBs) || 0));
    const requested = round2(Math.max(0, Number(requestedValue) || 0));

    if (currency === 'usd') {
        const maxUsd = safeRate > 0
            ? divR(Math.max(0, subR(targetBs, existingBs)), safeRate)
            : 0;
        const usd = Math.min(requested, maxUsd);
        return {
            usd: round2(usd),
            bs: existingBs,
            wasClamped: requested > maxUsd + CHECKOUT_POLICY.CHANGE_SPLIT_TOLERANCE,
            max: round2(maxUsd),
        };
    }

    const maxBs = round2(Math.max(0, subR(targetBs, mulR(existingUsd, safeRate))));
    const bs = Math.min(requested, maxBs);
    return {
        usd: existingUsd,
        bs: round2(bs),
        wasClamped: requested > maxBs + CHECKOUT_POLICY.CHANGE_SPLIT_TOLERANCE,
        max: maxBs,
    };
}

export function calculateChangeDistribution({
    changeUsd = 0,
    changeBs = null,
    physicalUsd = 0,
    physicalBs = 0,
    rate,
    resolution = null,
}) {
    const allocation = calculateChangeAllocation({
        totalChangeUsd: changeUsd,
        totalChangeBs: changeBs,
        physicalUsd,
        physicalBs,
        rate,
    });
    const output = {
        givenUsd: allocation.givenUsd,
        givenBs: allocation.givenBs,
        remainingUsd: allocation.remainingUsd,
        remainingBs: allocation.remainingBs,
        resolution,
    };

    if (resolution && !['tip', 'owed', 'voucher', 'wallet'].includes(resolution)) {
        return { ...output, error: 'Resolución de vuelto inválida.' };
    }
    const targetBs = allocation.totalChangeBs;
    if (allocation.distributedBs > targetBs + CHECKOUT_POLICY.CHANGE_SPLIT_TOLERANCE) {
        return { ...output, error: 'El vuelto físico excede el vuelto real.' };
    }
    return output;
}

export function assertCheckoutInvariants({
    changeUsd = 0,
    changeTotalBs = null,
    rate = 0,
    changeBreakdown = {},
    requireComplete = false,
}) {
    const changeUsdGiven = Number(changeBreakdown.changeUsdGiven ?? 0);
    const changeBsGiven = Number(changeBreakdown.changeBsGiven ?? 0);
    const changeBsGivenUsd = Number(changeBreakdown.changeBsGivenUsd ?? 0);
    const walletUsd = Number(changeBreakdown.walletUsd ?? 0);
    const owedUsd = Number(changeBreakdown.owedUsd ?? 0);
    const donatedUsd = Number(changeBreakdown.donatedUsd ?? 0);
    const voucherUsd = Number(changeBreakdown.voucherUsd ?? 0);

    const explicitBsAmounts = [
        changeBreakdown.walletBs,
        changeBreakdown.owedBs,
        changeBreakdown.donatedBs,
        changeBreakdown.voucherBs,
    ];
    const rawAmounts = [
        changeUsdGiven,
        changeBsGiven,
        changeBsGivenUsd,
        walletUsd,
        owedUsd,
        donatedUsd,
        voucherUsd,
        ...explicitBsAmounts.filter((amount) => amount !== null && amount !== undefined).map(Number),
    ];
    if (rawAmounts.some((amount) => !Number.isFinite(amount) || amount < 0)) {
        return { valid: false, error: 'La distribución de vuelto contiene un monto inválido.' };
    }

    const normalizedChangeUsd = Number(changeUsd ?? 0);
    if (!Number.isFinite(normalizedChangeUsd) || normalizedChangeUsd < 0) {
        return { valid: false, error: 'El vuelto total contiene un monto inválido.' };
    }

    const hasBsAuthority = changeTotalBs !== null && changeTotalBs !== undefined && Number(rate) > 0;
    const normalizedLimit = Number(changeTotalBs);
    if (hasBsAuthority && (!Number.isFinite(normalizedLimit) || normalizedLimit < 0)) {
        return { valid: false, error: 'El vuelto total contiene un monto inválido.' };
    }

    const walletBs = changeBreakdown.walletBs === null || changeBreakdown.walletBs === undefined
        ? mulR(walletUsd, rate)
        : Number(changeBreakdown.walletBs);
    const owedBs = changeBreakdown.owedBs === null || changeBreakdown.owedBs === undefined
        ? mulR(owedUsd, rate)
        : Number(changeBreakdown.owedBs);
    const donatedBs = changeBreakdown.donatedBs === null || changeBreakdown.donatedBs === undefined
        ? mulR(donatedUsd, rate)
        : Number(changeBreakdown.donatedBs);
    const voucherBs = changeBreakdown.voucherBs === null || changeBreakdown.voucherBs === undefined
        ? mulR(voucherUsd, rate)
        : Number(changeBreakdown.voucherBs);

    if ([walletBs, owedBs, donatedBs, voucherBs].some((amount) => !Number.isFinite(amount) || amount < 0)) {
        return { valid: false, error: 'La distribución de vuelto contiene un equivalente inválido.' };
    }

    // Cada destino digital debe conservar la misma cifra en USD y Bs. Sin esta
    // comprobación un caller podría registrar $2 de abono y Bs 80 a una tasa 40,
    // pero persistir Bs 40 y descuadrar cliente, ticket y caja.
    if (Number(rate) > 0) {
        const pairedParts = [
            ['abono a cuenta', walletUsd, walletBs],
            ['vuelto por fuera', owedUsd, owedBs],
            ['donación de vuelto', donatedUsd, donatedBs],
            ['voucher de vuelto', voucherUsd, voucherBs],
        ];
        for (const [label, usd, bs] of pairedParts) {
            if (Math.abs(subR(divR(bs, rate), round2(usd))) > CHECKOUT_POLICY.TOTAL_DRIFT_USD) {
                return { valid: false, error: `El ${label} no cuadra entre USD y bolívares.` };
            }
        }
    }

    const allocated = hasBsAuthority
        ? sumR([
            mulR(changeUsdGiven, rate),
            changeBsGiven,
            walletBs,
            owedBs,
            donatedBs,
            voucherBs,
        ])
        : sumR([
            changeUsdGiven,
            changeBsGivenUsd,
            walletUsd,
            owedUsd,
            donatedUsd,
            voucherUsd,
        ]);
    const limit = hasBsAuthority ? round2(normalizedLimit) : normalizedChangeUsd;

    if (allocated > limit + CHECKOUT_POLICY.CHANGE_SPLIT_TOLERANCE) {
        return { valid: false, error: 'La distribución de vuelto excede el cambio real.' };
    }

    // La UI ofrece un solo destino para el faltante. Mantener esta regla también
    // en el processor evita particiones ambiguas creadas por reintentos o callers
    // antiguos que envíen dos destinos a la vez.
    const activeResolutions = [
        walletUsd > CHECKOUT_POLICY.PAYMENT_ZERO || walletBs > CHECKOUT_POLICY.TOTAL_DRIFT_BS,
        owedUsd > CHECKOUT_POLICY.PAYMENT_ZERO || owedBs > CHECKOUT_POLICY.TOTAL_DRIFT_BS,
        donatedUsd > CHECKOUT_POLICY.PAYMENT_ZERO || donatedBs > CHECKOUT_POLICY.TOTAL_DRIFT_BS,
        voucherUsd > CHECKOUT_POLICY.PAYMENT_ZERO || voucherBs > CHECKOUT_POLICY.TOTAL_DRIFT_BS,
    ].filter(Boolean).length;
    if (activeResolutions > 1) {
        return { valid: false, error: 'El vuelto solo puede tener un destino pendiente a la vez.' };
    }

    if (requireComplete
        && limit > CHECKOUT_POLICY.PAYMENT_ZERO
        && subR(limit, allocated) > CHECKOUT_POLICY.CHANGE_SPLIT_TOLERANCE) {
        return { valid: false, error: 'La distribución de vuelto no cuadra con el cambio real.' };
    }

    return { valid: true, allocated, allocatedUsd: hasBsAuthority ? divR(allocated, rate) : allocated };
}

export default {
    calculateChangeAllocation,
    calculateChangeDistribution,
    calculateChangeInputUpdate,
    calculatePaymentState,
    isCashPayment,
    validatePaymentInput,
    validateChangeOwed,
    assertCheckoutInvariants,
};
