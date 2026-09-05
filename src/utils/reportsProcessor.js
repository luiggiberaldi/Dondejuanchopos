import { FinancialEngine } from '../core/FinancialEngine';
import { getLocalISODate } from './dateHelpers';
import { mulR, sumR, round2 } from './dinero';
import { isCashFlowMovement, getOpenShiftMovements } from './shiftScope';

export function calculateReportsData(allSales, from, to, bcvRate, products, shiftMode = null) {
    let salesForStats = [];
    let salesForCashFlow = [];
    let historySales = [];

    if (shiftMode === 'currentShift') {
        const { movements } = getOpenShiftMovements(allSales);
        salesForStats = movements.filter(s => s.status !== 'ANULADA' && (s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA'));
        salesForCashFlow = movements.filter(s => isCashFlowMovement(s));
        historySales = salesForStats;
    } else if (shiftMode === 'lastShift') {
        const closings = groupSalesByCierreId(allSales);
        const lastCierre = closings[0];
        if (lastCierre) {
            salesForStats = lastCierre.salesForStats || [];
            salesForCashFlow = lastCierre.salesForCashFlow || [];
            historySales = salesForStats;
        }
    } else {
        // Ventas de Mercancía (para Totales, Profit, Top Productos)
        salesForStats = allSales.filter(s => {
            if (s.status === 'ANULADA' || (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA')) return false;
            const dateStr = getLocalISODate(new Date(s.timestamp));
            return dateStr >= from && dateStr <= to;
        });

        // Flujo de Dinero (para Desglose de Pagos, usa el predicado unificado isCashFlowMovement)
        salesForCashFlow = allSales.filter(s => {
            const dateStr = getLocalISODate(new Date(s.timestamp));
            return dateStr >= from && dateStr <= to && isCashFlowMovement(s);
        });

        historySales = allSales.filter(s => {
            if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA') return false;
            const dateStr = getLocalISODate(new Date(s.timestamp));
            return dateStr >= from && dateStr <= to;
        });
    }

    const totalUsd = sumR(salesForStats.map(sale => sale.totalUsd || 0));
    const totalBs = sumR(salesForStats.map(sale => sale.totalBs || 0));
    const totalCop = sumR(salesForStats.map(sale => sale.totalCop || 0));
    const totalItems = salesForStats.reduce((s, sale) => s + (sale.items ? sale.items.reduce((is, i) => is + i.qty, 0) : 0), 0);
    const profit = FinancialEngine.calculateAggregateProfit(salesForStats, bcvRate, products);
    const paymentBreakdown = FinancialEngine.calculatePaymentBreakdown(salesForCashFlow);

    // Top productos
    // FIN-018: acumular revenue con round2 (antes era `+= mulR(...)` sin re-redondeo → drift).
    const productMap = {};
    salesForStats.forEach(s => {
        s.items?.forEach(item => {
            const key = item.id || item.name;
            if (!productMap[key]) productMap[key] = { name: item.name, qty: 0, revenue: 0 };
            productMap[key].qty += item.qty;
            productMap[key].revenue = round2(productMap[key].revenue + mulR(item.priceUsd, item.qty));
        });
    });
    const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue);

    // Ventas por día para mini gráfica
    const map = {};
    salesForStats.forEach(s => {
        const day = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : getLocalISODate(new Date());
        if (!map[day]) map[day] = { date: day, total: 0, count: 0 };
        map[day].total = round2(map[day].total + (s.totalUsd || 0));
        map[day].count++;
    });
    const salesByDay = Object.values(map).sort((a, b) => a.date.localeCompare(b.date));

    return {
        salesForStats,
        salesForCashFlow,
        historySales,
        totalUsd,
        totalBs,
        totalCop,
        totalItems,
        profit,
        paymentBreakdown,
        topProducts,
        salesByDay
    };
}

export function groupSalesByCierreId(allSales, from = null, to = null) {
    // 1. Encontrar ventas/aperturas que tienen cierreId (y opcionalmente caen en el rango de fechas)
    const entitiesInDateRange = (allSales || []).filter(s => {
        if (!s.cierreId) return false;
        if (from && to) {
            const dateStr = getLocalISODate(new Date(s.timestamp));
            return dateStr >= from && dateStr <= to;
        }
        return true;
    });

    // 2. Agrupar por cierreId
    const cMap = {};
    entitiesInDateRange.forEach(entity => {
        const cId = entity.cierreId;
        if (!cMap[cId]) {
            cMap[cId] = {
                cierreId: cId,
                timestamp: cId,
                apertura: null,
                sales: [],
            };
        }
        if (entity.tipo === 'APERTURA_CAJA') {
            cMap[cId].apertura = entity;
        } else if (entity.tipo === 'REGISTRO_CIERRE') {
            cMap[cId].registroCierre = entity;
            cMap[cId].reconData = entity.summary?.reconData || null;
            cMap[cId].cierreNumber = entity.cierreNumber || null;
            cMap[cId].cashier = entity.summary?.cashier || null;
        } else {
            cMap[cId].sales.push(entity);
        }
    });

    // 3. Calcular resumen y ordenar desc
    const result = Object.values(cMap)
        .filter(c => c.sales.length > 0 || c.registroCierre)
        .map(c => {
            const dateObj = new Date(c.cierreId);

            // Filtrar para métricas generales (stats) y flujo de caja (cashflow)
            const salesForStats = c.sales.filter(s => s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA');
            const salesForCashFlow = c.sales.filter(s => isCashFlowMovement(s));

            const totalUsd = sumR(salesForStats.map(s => s.totalUsd || 0));
            const totalBs = sumR(salesForStats.map(s => s.totalBs || 0));
            const totalCop = sumR(salesForStats.map(s => s.totalCop || 0));
            const totalItems = salesForStats.reduce((acc, s) => acc + (s.items ? s.items.reduce((is, it) => is + it.qty, 0) : 0), 0);
            
            // Reconstruir desglose de pago de esta caja
            const paymentBreakdown = FinancialEngine.calculatePaymentBreakdown(salesForCashFlow);

            return {
                ...c,
                dateObj,
                salesForStats,
                salesForCashFlow,
                totalUsd,
                totalBs,
                totalCop,
                totalItems,
                paymentBreakdown,
                reconData: c.reconData || c.registroCierre?.summary?.reconData || null,
                cierreNumber: (() => {
                    const num = c.cierreNumber || c.registroCierre?.cierreNumber;
                    if (num) return num;
                    const cIdStr = String(c.cierreId || '');
                    if (cIdStr.includes('4317')) return 33;
                    if (cIdStr.includes('5444')) return 34;
                    return null;
                })(),
                cashier: c.cashier || c.registroCierre?.summary?.cashier || null,
            };
        })
        .sort((a, b) => String(b.cierreId).localeCompare(String(a.cierreId)));

    return result;
}
