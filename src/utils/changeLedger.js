import { divR, mulR, round2, subR, sumR } from './dinero';

export const CHANGE_LEDGER_EPSILON = 0.009;

const amount = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? round2(numeric) : 0;
};

const hasValue = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));

function resolveRate(sale, rateOverride) {
    const candidate = Number(sale?.rate || rateOverride || 0);
    return Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
}

function resolveCopRate(sale) {
    const candidate = Number(sale?.tasaCop || 0);
    return Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
}

/** Normaliza la moneda que debe imprimirse, sin convertirla a otra moneda. */
export function normalizeChangeCurrency(value) {
    const normalized = String(value || '').trim().toUpperCase();
    if (['USD', 'US$', '$', 'DOLAR', 'DÓLAR', 'DIVISA'].includes(normalized)) return 'USD';
    if (['BS', 'VES', 'VEB', 'BOLIVAR', 'BOLÍVAR', 'BOLIVARES', 'BOLÍVARES'].includes(normalized)) return 'BS';
    if (['COP', 'PESO', 'PESOS'].includes(normalized)) return 'COP';
    return null;
}

function inferSaleChangeCurrency(sale) {
    const explicit = normalizeChangeCurrency(sale?.changeCurrency);
    if (explicit) return explicit;
    if (sale?.paymentRegime === 'PURE_BS') return 'BS';
    if (sale?.paymentRegime === 'USD') return 'USD';

    const payments = Array.isArray(sale?.payments)
        ? sale.payments.filter((payment) => !['cashea', 'saldo_favor'].includes(payment?.methodId))
        : [];
    const currencies = payments
        .map((payment) => normalizeChangeCurrency(payment?.currency))
        .filter(Boolean);
    if (currencies.length > 0 && currencies.every((currency) => currency === 'BS')) return 'BS';
    if (currencies.length > 0 && currencies.every((currency) => currency === 'COP')) return 'COP';

    const given = sale?.changeGiven;
    if (given && Number(given.bs) > CHANGE_LEDGER_EPSILON && Number(given.usd || 0) <= CHANGE_LEDGER_EPSILON && Number(given.cop || 0) <= CHANGE_LEDGER_EPSILON) return 'BS';
    if (given && Number(given.cop) > CHANGE_LEDGER_EPSILON && Number(given.usd || 0) <= CHANGE_LEDGER_EPSILON && Number(given.bs || 0) <= CHANGE_LEDGER_EPSILON) return 'COP';
    return 'USD';
}

function inferPartCurrency(raw, fallbackCurrency, usd, bs) {
    const explicit = normalizeChangeCurrency(raw?.currency || raw?.amountCurrency || raw?.currencyCode);
    if (explicit) return explicit;
    if (usd <= CHANGE_LEDGER_EPSILON && bs > CHANGE_LEDGER_EPSILON) return 'BS';
    if (bs <= CHANGE_LEDGER_EPSILON && usd > CHANGE_LEDGER_EPSILON) return 'USD';
    // Los registros anteriores guardaban USD y su equivalente Bs en el mismo
    // objeto. En ese caso la moneda visible sigue siendo la autoridad de la
    // venta, no las dos representaciones del mismo monto.
    return fallbackCurrency || (usd > CHANGE_LEDGER_EPSILON ? 'USD' : 'BS');
}

function resolvePart(raw, rate, fallbackUsd = 0, fallbackCurrency = 'USD') {
    const usd = amount(raw?.amountUsd ?? fallbackUsd);
    const bs = hasValue(raw?.amountBs)
        ? amount(raw.amountBs)
        : rate > 0
            ? mulR(usd, rate)
            : 0;
    return { usd, bs, currency: inferPartCurrency(raw, fallbackCurrency, usd, bs) };
}

/**
 * Devuelve las cantidades que deben imprimirse para una salida de vuelto.
 * Para una salida digital se elige su moneda real/autoridad; `amountBs` no se
 * imprime junto a `amountUsd` si solo era el equivalente contable.
 * `physical: true` sí conserva una mezcla física real de USD, Bs y COP.
 */
export function getChangeDisplayParts(part, { physical = false } = {}) {
    if (!part) return [];
    const values = [];
    const push = (currency, value) => {
        if (Number(value) > CHANGE_LEDGER_EPSILON) values.push({ currency, amount: round2(value) });
    };

    if (physical) {
        push('USD', part.usd);
        push('BS', part.bs);
        push('COP', part.cop);
        return values;
    }

    const currency = normalizeChangeCurrency(part.currency);
    if (currency === 'BS' && part.bs > CHANGE_LEDGER_EPSILON) {
        push('BS', part.bs);
        return values;
    }
    if (currency === 'COP' && part.cop > CHANGE_LEDGER_EPSILON) {
        push('COP', part.cop);
        return values;
    }
    if (currency === 'USD' && part.usd > CHANGE_LEDGER_EPSILON) {
        push('USD', part.usd);
        return values;
    }

    // Fallback seguro para datos legacy incompletos: mostrar el campo que sí
    // existe y nunca fabricar un "$0.00" por una conversión ausente.
    if (part.usd > CHANGE_LEDGER_EPSILON) push('USD', part.usd);
    else if (part.bs > CHANGE_LEDGER_EPSILON) push('BS', part.bs);
    else if (part.cop > CHANGE_LEDGER_EPSILON) push('COP', part.cop);
    return values;
}

/**
 * Normaliza una venta a un libro de vuelto único.
 *
 * `changeGiven` es la fuente autoritativa para ventas nuevas. Los aliases
 * changeUsd/changeBs se mantienen como fallback para ventas históricas. Cuando
 * una venta legacy guarda USD y Bs equivalentes simultáneamente, se conserva Bs
 * como la salida física para no duplicarla.
 */
export function getChangeLedger(sale, rateOverride = 0) {
    const rate = resolveRate(sale, rateOverride);
    const copRate = resolveCopRate(sale);
    const fallbackCurrency = inferSaleChangeCurrency(sale);
    const hasExplicitGiven = sale?.changeGiven && typeof sale.changeGiven === 'object';

    let deliveredUsd = amount(hasExplicitGiven ? sale.changeGiven.usd : sale?.changeUsd);
    let deliveredBs = amount(hasExplicitGiven ? sale.changeGiven.bs : sale?.changeBs);
    const deliveredCop = amount(hasExplicitGiven ? sale.changeGiven.cop : sale?.changeCop);
    let legacyEquivalent = false;

    // Antiguas ventas podían guardar el mismo vuelto en ambas monedas. El
    // registro nuevo usa changeGiven para distinguir una mezcla real.
    if (!hasExplicitGiven && deliveredUsd > CHANGE_LEDGER_EPSILON && deliveredBs > CHANGE_LEDGER_EPSILON && rate > 0) {
        const equivalentBs = mulR(deliveredUsd, rate);
        if (Math.abs(subR(equivalentBs, deliveredBs)) <= 1.5) {
            deliveredUsd = 0;
            legacyEquivalent = true;
        }
    }

    const deliveredUsdEquivalent = sumR([
        deliveredUsd,
        rate > 0 ? divR(deliveredBs, rate) : 0,
        copRate > 0 ? divR(deliveredCop, copRate) : 0,
    ]);

    const owed = {
        ...resolvePart(sale?.changeOwed, rate, 0, fallbackCurrency),
        method: sale?.changeOwed?.method || null,
        reference: sale?.changeOwed?.reference || sale?.changeOwed?.note || null,
        status: sale?.changeOwed?.status || null,
    };
    const wallet = resolvePart({
        amountUsd: sale?.vueltoParaMonedero,
        amountBs: sale?.vueltoParaMonederoBs,
        currency: sale?.vueltoParaMonederoCurrency || fallbackCurrency,
    }, rate, 0, fallbackCurrency);
    const voucher = {
        ...resolvePart(sale?.changeVoucher, rate, 0, fallbackCurrency),
        code: sale?.changeVoucher?.voucherCode || null,
        status: sale?.changeVoucher?.status || null,
    };
    const donated = resolvePart(sale?.tipDonated, rate, 0, fallbackCurrency);

    const destinationUsdEquivalent = (part) => part.bs > CHANGE_LEDGER_EPSILON && rate > 0
        ? divR(part.bs, rate)
        : part.usd;
    const destinationBsEquivalent = (part) => part.bs > CHANGE_LEDGER_EPSILON
        ? part.bs
        : rate > 0
            ? mulR(part.usd, rate)
            : 0;
    const allocatedUsd = sumR([
        deliveredUsdEquivalent,
        destinationUsdEquivalent(owed),
        destinationUsdEquivalent(wallet),
        destinationUsdEquivalent(voucher),
        destinationUsdEquivalent(donated),
    ]);
    // La autoridad de la partición es el monto físico de cada moneda. No
    // reconvertir allocatedUsd→Bs: en Bs puros, 50 / 45 = 1.11 y 1.11 * 45
    // vuelve a 49.95, inventando una diferencia que nunca existió.
    const allocatedBs = sumR([
        rate > 0 ? mulR(deliveredUsd, rate) : 0,
        deliveredBs,
        copRate > 0 && rate > 0 ? mulR(divR(deliveredCop, copRate), rate) : 0,
        destinationBsEquivalent(owed),
        destinationBsEquivalent(wallet),
        destinationBsEquivalent(voucher),
        destinationBsEquivalent(donated),
    ]);

    const totalUsd = hasValue(sale?.changeRealUsd)
        ? amount(sale.changeRealUsd)
        : allocatedUsd;
    const totalBs = hasValue(sale?.changeRealBs)
        ? amount(sale.changeRealBs)
        : rate > 0
            ? mulR(totalUsd, rate)
            : allocatedBs;
    const totalCop = hasValue(sale?.changeRealCop)
        ? amount(sale.changeRealCop)
        : deliveredCop;
    const remainingUsd = round2(Math.max(0, subR(totalUsd, allocatedUsd)));
    const remainingBs = rate > 0
        ? round2(Math.max(0, subR(totalBs, allocatedBs)))
        : 0;

    const parts = [
        {
            kind: 'delivered',
            label: 'Vuelto entregado',
            usd: deliveredUsd,
            bs: deliveredBs,
            cop: deliveredCop,
            currency: deliveredUsd > CHANGE_LEDGER_EPSILON && deliveredBs > CHANGE_LEDGER_EPSILON
                ? 'MIXED'
                : deliveredBs > CHANGE_LEDGER_EPSILON
                    ? 'BS'
                    : deliveredCop > CHANGE_LEDGER_EPSILON
                        ? 'COP'
                        : 'USD',
            usdEquivalent: deliveredUsdEquivalent,
        },
        {
            kind: 'owed',
            label: 'Vuelto por fuera',
            usd: owed.usd,
            bs: owed.bs,
            currency: owed.currency,
            usdEquivalent: destinationUsdEquivalent(owed),
            method: owed.method,
            reference: owed.reference,
            status: owed.status,
        },
        {
            kind: 'wallet',
            label: 'Abono a cuenta',
            usd: wallet.usd,
            bs: wallet.bs,
            currency: wallet.currency,
            usdEquivalent: destinationUsdEquivalent(wallet),
        },
        {
            kind: 'voucher',
            label: 'Voucher emitido',
            usd: voucher.usd,
            bs: voucher.bs,
            currency: voucher.currency,
            usdEquivalent: destinationUsdEquivalent(voucher),
            code: voucher.code,
            status: voucher.status,
        },
        {
            kind: 'donated',
            label: 'Vuelto cedido/donado',
            usd: donated.usd,
            bs: donated.bs,
            currency: donated.currency,
            usdEquivalent: destinationUsdEquivalent(donated),
        },
    ];

    const activeParts = parts.filter((part) => part.usd > CHANGE_LEDGER_EPSILON || part.bs > CHANGE_LEDGER_EPSILON || part.cop > CHANGE_LEDGER_EPSILON);
    const resolutionCount = activeParts.filter((part) => part.kind !== 'delivered').length;

    return {
        rate,
        changeCurrency: fallbackCurrency,
        totalUsd,
        totalBs,
        totalCop,
        displayTotal: fallbackCurrency === 'BS'
            ? { usd: 0, bs: totalBs, cop: 0, currency: 'BS' }
            : fallbackCurrency === 'COP'
                ? { usd: 0, bs: 0, cop: totalCop, currency: 'COP' }
                : { usd: totalUsd, bs: 0, cop: 0, currency: 'USD' },
        delivered: { usd: deliveredUsd, bs: deliveredBs, cop: deliveredCop, currency: deliveredUsd > CHANGE_LEDGER_EPSILON && deliveredBs > CHANGE_LEDGER_EPSILON ? 'MIXED' : deliveredBs > CHANGE_LEDGER_EPSILON ? 'BS' : deliveredCop > CHANGE_LEDGER_EPSILON ? 'COP' : 'USD', usdEquivalent: deliveredUsdEquivalent },
        owed,
        wallet,
        voucher,
        donated,
        allocatedUsd,
        allocatedBs,
        remainingUsd,
        remainingBs,
        balanced: remainingUsd <= CHANGE_LEDGER_EPSILON && remainingBs <= CHANGE_LEDGER_EPSILON,
        hasChange: totalUsd > CHANGE_LEDGER_EPSILON || totalBs > 0.99 || totalCop > CHANGE_LEDGER_EPSILON || activeParts.length > 0,
        resolutionCount,
        legacyEquivalent,
        parts: activeParts,
    };
}

/** Resume los libros de vuelto de un conjunto de ventas sin mezclar monedas. */
export function summarizeChangeLedgers(sales = [], rateOverride = 0) {
    const summary = {
        count: 0,
        totalUsd: 0,
        totalBs: 0,
        totalCop: 0,
        totalDisplayUsd: 0,
        totalDisplayBs: 0,
        totalDisplayCop: 0,
        deliveredUsd: 0,
        deliveredBs: 0,
        deliveredCop: 0,
        deliveredDisplayUsd: 0,
        deliveredDisplayBs: 0,
        deliveredDisplayCop: 0,
        owedUsd: 0,
        owedBs: 0,
        owedDisplayUsd: 0,
        owedDisplayBs: 0,
        owedDisplayCop: 0,
        walletUsd: 0,
        walletBs: 0,
        walletDisplayUsd: 0,
        walletDisplayBs: 0,
        walletDisplayCop: 0,
        voucherUsd: 0,
        voucherBs: 0,
        voucherDisplayUsd: 0,
        voucherDisplayBs: 0,
        voucherDisplayCop: 0,
        donatedUsd: 0,
        donatedBs: 0,
        donatedDisplayUsd: 0,
        donatedDisplayBs: 0,
        donatedDisplayCop: 0,
        allocatedUsd: 0,
        unresolvedUsd: 0,
        unbalancedCount: 0,
    };

    for (const sale of Array.isArray(sales) ? sales : []) {
        if (!sale || sale.status === 'ANULADA') continue;
        const ledger = getChangeLedger(sale, rateOverride);
        if (!ledger.hasChange) continue;
        const addDisplay = (prefix, part, options) => {
            for (const displayPart of getChangeDisplayParts(part, options)) {
                const key = displayPart.currency === 'USD'
                    ? `${prefix}DisplayUsd`
                    : displayPart.currency === 'BS'
                        ? `${prefix}DisplayBs`
                        : `${prefix}DisplayCop`;
                summary[key] = sumR(summary[key], displayPart.amount);
            }
        };
        summary.count += 1;
        summary.totalUsd = sumR(summary.totalUsd, ledger.totalUsd);
        summary.totalBs = sumR(summary.totalBs, ledger.totalBs);
        summary.totalCop = sumR(summary.totalCop, ledger.totalCop);
        summary.totalDisplayUsd = sumR(summary.totalDisplayUsd, ledger.displayTotal.usd);
        summary.totalDisplayBs = sumR(summary.totalDisplayBs, ledger.displayTotal.bs);
        summary.totalDisplayCop = sumR(summary.totalDisplayCop, ledger.displayTotal.cop);
        summary.deliveredUsd = sumR(summary.deliveredUsd, ledger.delivered.usd);
        summary.deliveredBs = sumR(summary.deliveredBs, ledger.delivered.bs);
        summary.deliveredCop = sumR(summary.deliveredCop, ledger.delivered.cop);
        addDisplay('delivered', ledger.delivered, { physical: true });
        summary.owedUsd = sumR(summary.owedUsd, ledger.owed.usd);
        summary.owedBs = sumR(summary.owedBs, ledger.owed.bs);
        addDisplay('owed', ledger.owed);
        summary.walletUsd = sumR(summary.walletUsd, ledger.wallet.usd);
        summary.walletBs = sumR(summary.walletBs, ledger.wallet.bs);
        addDisplay('wallet', ledger.wallet);
        summary.voucherUsd = sumR(summary.voucherUsd, ledger.voucher.usd);
        summary.voucherBs = sumR(summary.voucherBs, ledger.voucher.bs);
        addDisplay('voucher', ledger.voucher);
        summary.donatedUsd = sumR(summary.donatedUsd, ledger.donated.usd);
        summary.donatedBs = sumR(summary.donatedBs, ledger.donated.bs);
        addDisplay('donated', ledger.donated);
        summary.allocatedUsd = sumR(summary.allocatedUsd, ledger.allocatedUsd);
        summary.unresolvedUsd = sumR(summary.unresolvedUsd, ledger.remainingUsd);
        if (!ledger.balanced) summary.unbalancedCount += 1;
    }

    return summary;
}

export default { getChangeLedger, summarizeChangeLedgers, getChangeDisplayParts, normalizeChangeCurrency };
