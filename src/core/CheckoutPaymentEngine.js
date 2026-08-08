import { divR, mulR, round2, subR, sumR } from '../utils/dinero';
import { CHECKOUT_POLICY } from '../utils/securityConstants';

const VIRTUAL_METHODS = new Set(['cashea', 'saldo_favor']);
const CASH_METHODS = new Set(['efectivo_usd', 'efectivo_bs', 'efectivo_cop']);

const normalizeCurrency = (currency) => {
    const normalized = String(currency || '').toUpperCase();
    return normalized === 'VES' ? 'BS' : normalized;
};

const finiteMoney = (value) => Number.isFinite(Number(value)) && Number(value) >= 0;

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
        const amountInput = Number(payment.amountInput ?? (currency === 'USD' ? payment.amountUsd : currency === 'BS' ? payment.amountBs : payment.amountCop));
        const amountUsd = payment.amountUsd != null
            ? Number(payment.amountUsd)
            : currency === 'USD'
                ? amountInput
                : currency === 'COP' && safeTasaCop > 0
                    ? divR(amountInput, safeTasaCop)
                    : safeRate > 0
                        ? divR(amountInput, safeRate)
                        : 0;
        const amountBs = payment.amountBs != null
            ? Number(payment.amountBs)
            : currency === 'BS'
                ? amountInput
                : currency === 'COP' && safeTasaCop > 0 && safeRate > 0
                    ? mulR(divR(amountInput, safeTasaCop), safeRate)
                    : safeRate > 0
                        ? mulR(amountInput, safeRate)
                        : 0;
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
            change: { usd: 0, bs: changeBs },
        };
    } else {
        const paidUsd = sumR([foreignUsd, safeRate > 0 ? divR(paidBs, safeRate) : 0]);
        const remainingUsd = round2(Math.max(0, subR(totalUsd, paidUsd)));
        const changeUsd = round2(Math.max(0, subR(paidUsd, totalUsd)));

        state = {
            regime: 'USD',
            paid: { usd: paidUsd, bs: round2(mulR(paidUsd, safeRate)), cop: sumR(normalizedPayments.filter((payment) => payment.currency === 'COP').map((payment) => payment.amountInput)) },
            remaining: { usd: remainingUsd, bs: round2(mulR(remainingUsd, safeRate)) },
            change: { usd: changeUsd, bs: round2(mulR(changeUsd, safeRate)) },
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

export function calculateChangeDistribution({
    changeUsd = 0,
    physicalUsd = 0,
    physicalBs = 0,
    rate,
    resolution = null,
}) {
    const safeRate = Number(rate) > 0 ? Number(rate) : 0;
    const givenUsd = round2(Number(physicalUsd) || 0);
    const givenBs = round2(Number(physicalBs) || 0);
    const givenEquivalentUsd = sumR([givenUsd, safeRate > 0 ? divR(givenBs, safeRate) : 0]);
    const remainingUsd = round2(Math.max(0, subR(changeUsd, givenEquivalentUsd)));

    const output = {
        givenUsd,
        givenBs,
        remainingUsd,
        resolution,
    };

    if (resolution && !['tip', 'owed', 'voucher', 'wallet'].includes(resolution)) {
        return { ...output, error: 'Resolución de vuelto inválida.' };
    }
    if (givenEquivalentUsd > Number(changeUsd) + CHECKOUT_POLICY.CHANGE_SPLIT_TOLERANCE) {
        return { ...output, error: 'El vuelto físico excede el vuelto real.' };
    }
    return output;
}

export function assertCheckoutInvariants({ changeUsd = 0, changeBreakdown = {} }) {
    const physicalUsd = Number(changeBreakdown.changeUsdGiven) || 0;
    const physicalBsUsd = Number(changeBreakdown.changeBsGivenUsd) || 0;
    const walletUsd = Number(changeBreakdown.walletUsd) || 0;
    const owedUsd = Number(changeBreakdown.owedUsd) || 0;
    const donatedUsd = Number(changeBreakdown.donatedUsd) || 0;
    const voucherUsd = Number(changeBreakdown.voucherUsd) || 0;
    const allocated = sumR([physicalUsd, physicalBsUsd, walletUsd, owedUsd, donatedUsd, voucherUsd]);

    if (allocated > Number(changeUsd) + CHECKOUT_POLICY.CHANGE_SPLIT_TOLERANCE) {
        return { valid: false, error: 'La distribución de vuelto excede el cambio real.' };
    }
    return { valid: true, allocated };
}

export default {
    calculateChangeDistribution,
    calculatePaymentState,
    isCashPayment,
    validatePaymentInput,
    assertCheckoutInvariants,
};
