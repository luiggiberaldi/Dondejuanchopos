// src/utils/shiftCloseSummary.js
// Fase 0 (PLAN_CIERRE_CAJA_TIEMPO_REAL_SUPERVISOR): el REGISTRO_CIERRE se
// construye SIEMPRE desde el scope fresco leído bajo `pos_write_lock`, nunca
// desde el estado React (que puede estar vacío o desfasado). Las fórmulas son
// las mismas de useDashboardMetrics para que el resumen del modal y el registro
// persistido coincidan con lo que el cajero ve en el Dashboard.
import { FinancialEngine } from '../core/FinancialEngine';
import { sumR, mulR } from './dinero';

const SALE_TYPES = ['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA'];

/** ¿El scope fresco obliga a crear un REGISTRO_CIERRE? */
export function shiftScopeRequiresClose(scope) {
    return Boolean(scope) && (
        (scope.movements || []).length > 0
        || (scope.orphans || []).length > 0
    );
}

function buildTopProducts(shiftSales, products = []) {
    const productMap = {};
    shiftSales.forEach(s => {
        (s.items || []).forEach(item => {
            if (!productMap[item.name]) productMap[item.name] = { name: item.name, qty: 0, revenue: 0 };
            productMap[item.name].qty += item.qty;
            const prod = products.find(p => p.id === item.id || p.name === item.name);
            const effectivePrice = (prod && item.priceUsd > 50 && prod.priceUsdt && Number(prod.priceUsdt) < 20)
                ? Number(prod.priceUsdt)
                : item.priceUsd;
            productMap[item.name].revenue = sumR(productMap[item.name].revenue, mulR(effectivePrice, item.qty));
        });
    });
    return Object.values(productMap).sort((a, b) => b.qty - a.qty).slice(0, 10);
}

/**
 * Totales del turno calculados desde el scope fresco (`getOpenShiftMovements`).
 * Igual que el Dashboard, los totales se acotan a `movements` del turno vigente.
 */
export function buildShiftCloseSummary(scope, { bcvRate = 0, products = [] } = {}) {
    const cashFlow = scope?.movements || [];
    const shiftSales = cashFlow.filter(s => SALE_TYPES.includes(s.tipo || 'VENTA'));
    return {
        cashFlow,
        sales: cashFlow.filter(s => s.tipo !== 'APERTURA_CAJA'),
        shiftSales,
        todayTotalUsd: sumR(shiftSales.map(s => s.totalUsd || 0)),
        todayTotalBs: sumR(shiftSales.map(s => s.totalBs || 0)),
        todayProfit: FinancialEngine.calculateAggregateProfit(shiftSales, bcvRate, products),
        todayItemsSold: shiftSales.reduce((sum, s) => sum + (s.items ? s.items.reduce((is, i) => is + i.qty, 0) : 0), 0),
        paymentBreakdown: FinancialEngine.calculatePaymentBreakdown(cashFlow),
        topProducts: buildTopProducts(shiftSales, products),
    };
}
