import { useMemo, useCallback } from 'react';
import { FinancialEngine } from '../core/FinancialEngine';
import { sumR, mulR } from '../utils/dinero';
import { getLocalISODate } from '../utils/dateHelpers';

/**
 * Hook de métricas del Dashboard.
 *
 * FIN-013: weekData ya NO excluye VENTA_FIADA (criterio unificado con todayTotalUsd).
 * FIN-019: totalDeudas y topProducts usan sumR/mulR en vez de reduce/multiplicación raw.
 */
export function useDashboardMetrics(sales, customers, products, bcvRate) {
    const today = getLocalISODate();

    // Memoize sales with pre-calculated local dates to avoid parsing new Date inside nested loops
    const salesWithLocalDate = useMemo(() => {
        return sales.map(s => {
            const localDate = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : today;
            return {
                ...s,
                localDate
            };
        });
    }, [sales, today]);

    const todaySales = useMemo(() =>
        salesWithLocalDate.filter(s => {
            if (s.status === 'ANULADA') return false;
            if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA') return false;
            if (s.cajaCerrada === true) return false;
            return s.localDate === today;
        }),
        [salesWithLocalDate, today]
    );

    // Movimientos reales de caja para el cuadre (Ventas + Abonos + Egresos + Apertura)
    const todayCashFlow = useMemo(() =>
        salesWithLocalDate.filter(s => {
            if (s.status === 'ANULADA') return false;
            if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'PAGO_PROVEEDOR' && s.tipo !== 'APERTURA_CAJA') return false;
            if (s.cajaCerrada === true) return false;
            return s.localDate === today;
        }),
        [salesWithLocalDate, today]
    );

    // Detect if apertura was already registered today
    const todayApertura = useMemo(() => {
        return salesWithLocalDate.find(s => {
            if (s.tipo !== 'APERTURA_CAJA' || s.cajaCerrada) return false;
            return s.localDate === today;
        });
    }, [salesWithLocalDate, today]);

    const todayTotalBs = useMemo(() => sumR(todaySales.map(s => s.totalBs || 0)), [todaySales]);
    const todayTotalUsd = useMemo(() => sumR(todaySales.map(s => s.totalUsd || 0)), [todaySales]);
    const todayTotalCop = useMemo(() => sumR(todaySales.map(s => s.totalCop || 0)), [todaySales]);
    const todayItemsSold = useMemo(() => todaySales.reduce((sum, s) => sum + (s.items ? s.items.reduce((is, i) => is + i.qty, 0) : 0), 0), [todaySales]);

    // Egresos del día (pagos a proveedores)
    const todayExpenses = useMemo(() => {
        return salesWithLocalDate.filter(s => {
            if (s.tipo !== 'PAGO_PROVEEDOR') return false;
            if (s.cajaCerrada === true) return false;
            return s.localDate === today;
        });
    }, [salesWithLocalDate, today]);
    const todayExpensesUsd = useMemo(() => sumR(todayExpenses.map(s => Math.abs(s.totalUsd || 0))), [todayExpenses]);

    const todayProfit = useMemo(() =>
        FinancialEngine.calculateAggregateProfit(todaySales, bcvRate, products),
        [todaySales, bcvRate, products]
    );

    // Últimas ventas (por defecto las últimas 7, o las del día seleccionado en la gráfica)
    const getRecentSales = useCallback((selectedChartDate) => {
        if (selectedChartDate) {
            return salesWithLocalDate.filter(s => s.localDate === selectedChartDate);
        }
        return salesWithLocalDate.slice(0, 7);
    }, [salesWithLocalDate]);

    // Datos últimos 7 días (para gráfica)
    // FIN-013: unificar criterio — INCLUIR VENTA_FIADA como todayTotalUsd hace.
    // Antes weekData excluía VENTA_FIADA mientras todayTotalUsd la incluía →
    // la suma de la gráfica nunca cuadraba con el total del día.
    const weekData = useMemo(() => Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        const dateStr = getLocalISODate(d);
        const daySales = salesWithLocalDate.filter(s => {
            if (s.status === 'ANULADA') return false;
            if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA') return false;
            return s.localDate === dateStr;
        });

        return { date: dateStr, total: sumR(daySales.map(s => s.totalUsd || 0)), count: daySales.length };
    }), [salesWithLocalDate]);

    // Productos bajo stock
    const lowStockProducts = useMemo(() =>
        products.filter(p => (p.stock ?? 0) <= (p.lowStockAlert ?? 5))
            .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0)).slice(0, 6),
        [products]
    );

    // Deudas pendientes totales
    // FIN-019: usar sumR en vez de reduce raw.
    const totalDeudas = useMemo(() => {
        const deudores = customers.filter(c => (c.deuda || 0) > 0.01);
        const totalUsd = sumR(deudores.map(c => c.deuda || 0));
        return { count: deudores.length, totalUsd, top5: [...deudores].sort((a, b) => (b.deuda || 0) - (a.deuda || 0)).slice(0, 5) };
    }, [customers]);

    // Top productos vendidos (todas las ventas netas)
    // FIN-019: usar mulR + round2 en vez de multiplicación raw.
    const topProducts = useMemo(() => {
        const productSalesMap = {};
        sales.filter(s => s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'AJUSTE_ENTRADA' && s.tipo !== 'AJUSTE_SALIDA' && s.status !== 'ANULADA').forEach(s => {
            if (s.items) {
                s.items.forEach(item => {
                    if (!productSalesMap[item.name]) productSalesMap[item.name] = { name: item.name, qty: 0, revenue: 0 };
                    productSalesMap[item.name].qty += item.qty;
                    productSalesMap[item.name].revenue = sumR(productSalesMap[item.name].revenue, mulR(item.priceUsd, item.qty));
                });
            }
        });
        return Object.values(productSalesMap).sort((a, b) => b.qty - a.qty).slice(0, 5);
    }, [sales]);

    // Payment method breakdown (today)
    const paymentBreakdown = useMemo(() => {
        return FinancialEngine.calculatePaymentBreakdown(todayCashFlow);
    }, [todayCashFlow]);

    // Top productos vendidos HOY (para cierre del día)
    // FIN-019: usar mulR + round2 en vez de multiplicación raw.
    const todayTopProducts = useMemo(() => {
        const todayProductMap = {};
        todaySales.forEach(s => {
            if (s.items) {
                s.items.forEach(item => {
                    if (!todayProductMap[item.name]) todayProductMap[item.name] = { name: item.name, qty: 0, revenue: 0 };
                    todayProductMap[item.name].qty += item.qty;
                    todayProductMap[item.name].revenue = sumR(todayProductMap[item.name].revenue, mulR(item.priceUsd, item.qty));
                });
            }
        });
        return Object.values(todayProductMap).sort((a, b) => b.qty - a.qty).slice(0, 10);
    }, [todaySales]);

    return {
        today,
        todaySales,
        todayCashFlow,
        todayApertura,
        todayTotalBs,
        todayTotalUsd,
        todayTotalCop,
        todayItemsSold,
        todayExpenses,
        todayExpensesUsd,
        todayProfit,
        getRecentSales,
        weekData,
        lowStockProducts,
        totalDeudas,
        topProducts,
        paymentBreakdown,
        todayTopProducts,
    };
}
