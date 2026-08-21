/**
 * src/utils/monitorSaleFormat.js
 *
 * Helpers puros de formateo/derivación de ventas para el Monitor del Supervisor.
 * Extraídos de OwnerMonitorView.jsx (refactor 2026-08-21).
 */
import { Banknote, Smartphone, CreditCard, DollarSign, Wallet, Coins, Clock, RotateCcw } from 'lucide-react';
import { getPaymentLabel, toTitleCase } from '../config/paymentMethods';
import { getChangeLedger } from './changeLedger';
import { calculatePricing } from './productProcessor';
import { mulR, round2 } from './dinero';

// Helper: icon por método de pago
export const PAYMENT_METHOD_ICONS = {
    efectivo_bs: Banknote,
    pago_movil: Smartphone,
    punto_de_venta: CreditCard,
    efectivo_usd: DollarSign,
    zelle: Smartphone,
    binance: Wallet,
    efectivo_cop: Coins,
    transferencia_cop: CreditCard,
    fiado: Clock,
    cashea: Clock,
    vuelto_bs: RotateCcw,
    vuelto_usd: RotateCcw,
};

export function getMethodIcon(methodId) {
    return PAYMENT_METHOD_ICONS[methodId] || Wallet;
}

export const formatPayrollUsd = value => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
}).format(Number(value) || 0);

export function getFormattedPaymentMethod(sale) {
    if (!sale) return 'Efectivo (Bs)';

    const isFiado = sale.tipo === 'VENTA_FIADA' || sale.isFiado || (sale.fiadoUsd > 0.009);
    const isCashea = sale.tipo === 'VENTA_CASHEA' || sale.isCashea || (sale.casheaUsd > 0.009);

    let baseLabel = '';

    if (Array.isArray(sale.payments) && sale.payments.length > 0) {
        baseLabel = sale.payments.map(p => {
            const mId = (p.methodId || p.metodoPago || p.id || '').toLowerCase();
            let label = p.methodLabel || getPaymentLabel(mId);
            if (mId === 'efectivo_usd' || mId === 'efectivo usd') label = 'Efectivo ($)';
            else if (mId === 'efectivo_bs' || mId === 'efectivo bs' || mId === 'efectivo') label = 'Efectivo (Bs)';
            else if (mId === 'efectivo_cop' || mId === 'efectivo cop') label = 'Efectivo (COP)';
            return label;
        }).join(' + ');
    } else if (!isFiado && !isCashea) {
        const raw = (sale.metodoPago || sale.paymentMethod || 'efectivo_bs').toLowerCase();

        if (raw === 'efectivo_usd' || raw === 'efectivo usd' || raw === 'usd') baseLabel = 'Efectivo ($)';
        else if (raw === 'efectivo_bs' || raw === 'efectivo bs' || raw === 'efectivo' || raw === 'bs') baseLabel = 'Efectivo (Bs)';
        else if (raw === 'efectivo_cop' || raw === 'efectivo cop' || raw === 'cop') baseLabel = 'Efectivo (COP)';
        else baseLabel = getPaymentLabel(raw) || toTitleCase(raw);
    }

    if (isFiado) {
        return baseLabel ? `${baseLabel} + Fiado` : 'Fiado (Por Cobrar)';
    }

    if (isCashea) {
        return baseLabel ? `${baseLabel} + Cashea` : 'Cashea (Por Cobrar)';
    }

    return baseLabel || 'Efectivo (Bs)';
}

export function getPaymentBadgeStyle(sale) {
    const formatted = getFormattedPaymentMethod(sale).toLowerCase();
    if (formatted.includes('fiado') || formatted.includes('por cobrar')) return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300';
    if (formatted.includes('cashea')) return 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-300';
    if (formatted.includes('+')) return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300';
    if (formatted.includes('dólares') || formatted.includes('($)')) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300';
    if (formatted.includes('pago móvil')) return 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-300';
    if (formatted.includes('punto')) return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-300';
    return 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300';
}

export function getFormattedSaleCode(sale) {
    if (!sale) return '';
    if (sale.saleNumber != null && Number(sale.saleNumber) > 0) {
        return `#${String(sale.saleNumber).padStart(7, '0')}`;
    }
    return `#${sale.id ? sale.id.slice(-6).toUpperCase() : ''}`;
}

export function getSaleChangeDetails(sale, products = [], effectiveRate = 1, bcvRate = 1) {
    if (!sale) return { changeUsd: 0, changeBs: 0, hasChange: false, hasAnyChange: false };

    // El monitor debe usar la misma autoridad que tickets, caja y reportes.
    // En particular, nunca sumar `changeUsd` y `changeBs` cuando son dos
    // representaciones legacy del mismo vuelto.
    const rate = sale.rate || effectiveRate || bcvRate || 0;
    const ledger = getChangeLedger(sale, rate);
    const hasPhysicalChange = ledger.delivered.usd > 0.009
        || ledger.delivered.bs > 0.009
        || ledger.delivered.cop > 0.009;

    return {
        changeUsd: ledger.delivered.usd,
        changeBs: ledger.delivered.bs,
        changeCop: ledger.delivered.cop,
        hasChange: hasPhysicalChange,
        hasAnyChange: ledger.hasChange,
        isEquivalent: ledger.legacyEquivalent,
        ledger,
    };
}

export function getEffectiveSaleTotalBs(sale, products = [], effectiveRate = 1, bcvRate = 1) {
    if (!sale) return 0;
    if (!sale.items || sale.items.length === 0) return sale.totalBs || 0;

    const rate = sale.rate || effectiveRate || 1;
    const realBcv = sale.bcvRate || bcvRate || rate;

    let hasMatch = false;
    let sumBs = 0;

    for (const item of sale.items) {
        const cleanId = (item._originalId || item.id || '').replace(/_half|_box$/, '');
        const prod = products.find(p => p.id === cleanId || p.id === item.productId || p.id === item.id);

        if (prod) {
            hasMatch = true;
            const format = item._mode || (item.id && item.id.endsWith('_half') ? 'halfBox' : item.id && item.id.endsWith('_box') ? 'box' : 'unit');
            const pricing = calculatePricing(prod, rate, realBcv, format);
            sumBs += mulR(pricing.unitPriceBs, item.qty || 1);
        } else if (item.priceBsManual && item.pricingMode === 'bs_fijo') {
            hasMatch = true;
            sumBs += mulR(item.priceBsManual, item.qty || 1);
        } else if (item.subtotalBs != null && item.subtotalBs > 0) {
            sumBs += item.subtotalBs;
        } else {
            sumBs += mulR(mulR(item.priceUsd ?? item.price ?? 0, item.qty || 1), rate);
        }
    }

    return hasMatch ? round2(sumBs) : (sale.totalBs || 0);
}
