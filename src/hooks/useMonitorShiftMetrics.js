/**
 * src/hooks/useMonitorShiftMetrics.js
 *
 * Métricas del turno activo, historial de cierres y comandos remotos de cierre/
 * reapertura para el Monitor del Supervisor.
 *
 * Extraído de OwnerMonitorView.jsx (refactor 2026-08-21). Comportamiento
 * idéntico; los estados/memos se movieron sin cambios de lógica.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { showToast } from '../components/Toast';
import { findOpenApertura, getOpenShiftMovements } from '../utils/shiftScope';
import { FinancialEngine } from '../core/FinancialEngine';
import { calculateSupervisorChangeMetrics, calculateSupervisorOutflowMetrics } from '../utils/supervisorShiftMetrics';
import { round2 } from '../utils/dinero';
import { getEffectiveSaleTotalBs, getSaleChangeDetails } from '../utils/monitorSaleFormat';
import { getPaymentLabel, toTitleCase } from '../config/paymentMethods';
import { createSupervisorCommandId } from '../utils/supervisorCommandModel';

export function useMonitorShiftMetrics({
    sales,
    products,
    effectiveRate,
    bcvRate,
    pairedDeviceId,
    supervisorUser,
    copEnabled,
    tasaCop,
    activeCashier,
    triggerHaptic,
    setClosingRemote,
    setShowRemoteCloseModal,
}) {
    const [selectedCierreId, setSelectedCierreId] = useState(null);
    const [exportingCierreId, setExportingCierreId] = useState(null);

    // ── TURNO ACTIVO & ESTADO DE CAJA ──
    const [nowTick, setNowTick] = useState(() => Date.now());

    useEffect(() => {
        const timer = setInterval(() => setNowTick(Date.now()), 30000);
        return () => clearInterval(timer);
    }, []);

    // Apertura de caja del turno activo
    const activeShiftApertura = useMemo(() => {
        return findOpenApertura(sales);
    }, [sales]);

    // Estado global del turno (Abierta/Cerrada + Tiempo transcurrido)
    const shiftStatusInfo = useMemo(() => {
        const openTs = activeShiftApertura?.timestamp;

        if (!openTs) {
            return { isOpen: false, openTime: null, formattedTime: '', elapsedLabel: 'Caja Cerrada' };
        }

        const openDate = new Date(openTs);
        const diffMs = Math.max(0, nowTick - openDate.getTime());
        const diffMins = Math.floor(diffMs / 60000);

        let elapsedLabel = '';
        if (diffMins < 1) {
            elapsedLabel = 'hace menos de 1m';
        } else if (diffMins < 60) {
            elapsedLabel = `hace ${diffMins}m`;
        } else if (diffMins < 1440) {
            const h = Math.floor(diffMins / 60);
            const m = diffMins % 60;
            elapsedLabel = m > 0 ? `hace ${h}h ${m}m` : `hace ${h}h`;
        } else {
            const d = Math.floor(diffMins / 1440);
            const h = Math.floor((diffMins % 1440) / 60);
            elapsedLabel = h > 0 ? `hace ${d}d ${h}h` : `hace ${d}d`;
        }

        const formattedTime = openDate.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true });

        return {
            isOpen: true,
            openTime: openDate,
            formattedTime,
            elapsedLabel
        };
    }, [sales, activeShiftApertura, nowTick]);

    // Filtrar ventas del turno activo con guarda-railes estrictos
    const activeShiftSales = useMemo(() => {
        // Guarda-rail 1: Si la caja está cerrada, no hay ventas en el turno activo
        if (!activeShiftApertura || !activeShiftApertura.timestamp) return [];

        const aperturaTs = new Date(activeShiftApertura.timestamp).getTime();
        if (isNaN(aperturaTs)) return [];

        const filtered = sales.filter(s => {
            // Validar tipos de transacción de venta
            if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA') return false;

            // Guarda-rail 4: Ignorar ventas cerradas en arqueos previos
            if (s.cajaCerrada === true || s.cajaCerrada === 'true') return false;

            // Guarda-rail 2: Solo transacciones posteriores a la apertura activa
            const saleTs = s.timestamp ? new Date(s.timestamp).getTime() : 0;
            if (isNaN(saleTs) || saleTs < aperturaTs) return false;

            return true;
        });

        return filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }, [sales, activeShiftApertura]);

    // Métricas del turno activo
    const activeShiftMetrics = useMemo(() => {
        let usd = 0;
        let bs = 0;
        const validSales = activeShiftSales.filter(s => s.status !== 'ANULADA');
        validSales.forEach(s => {
            usd += s.totalUsd || 0;
            bs += getEffectiveSaleTotalBs(s, products, effectiveRate, bcvRate);
        });

        // Calcular ganancia estimada si los productos tienen costo
        let costSum = 0;
        validSales.forEach(s => {
            if (!s.items) return;
            s.items.forEach(item => {
                const prod = products.find(p => p.id === item.productId || p.id === item.id);
                if (prod && (prod.costUsd || prod.costPrice)) {
                    costSum += (prod.costUsd || prod.costPrice) * item.qty;
                }
            });
        });

        const profitUsd = Math.max(0, usd - costSum);

        return {
            totalUsd: usd,
            totalBs: bs,
            profitUsd,
            count: validSales.length
        };
    }, [activeShiftSales, products, effectiveRate, bcvRate]);

    // Métricas de gastos de caja (Egresos de dinero físico) del turno activo
    const activeShiftExpensesMetrics = useMemo(() => {
        const flow = getOpenShiftMovements(sales).movements;
        const gastos = flow.filter(s =>
            s.tipo === 'GASTO_INTERNO' &&
            s.status !== 'ANULADA' &&
            !s.isAutoconsumo &&
            s.category !== 'autoconsumo' &&
            s.afectaCaja !== false
        );
        let totalUsd = 0;
        let totalBs = 0;
        let totalCop = 0;
        const categoryMap = {};

        gastos.forEach(g => {
            const payment = Array.isArray(g.payments) && g.payments[0] ? g.payments[0] : null;
            const curr = g.currency || payment?.currency || (
                (g.paymentMethod && (g.paymentMethod.includes('usd') || g.paymentMethod.includes('zelle') || g.paymentMethod.includes('binance') || g.paymentMethod === 'dolares')) ? 'USD' :
                (g.paymentMethod && g.paymentMethod.includes('cop')) ? 'COP' : 'BS'
            );

            let usd = 0;
            let bs = 0;
            let cop = 0;

            if (curr === 'USD') {
                usd = Math.abs(payment?.amountUsd ? payment.amountUsd : (g.totalUsd || 0));
            } else if (curr === 'COP') {
                cop = Math.abs(payment?.amountCop ? payment.amountCop : (g.totalCop || g.totalBs || 0));
            } else {
                bs = Math.abs(payment?.amountBs ? payment.amountBs : (g.totalBs || 0));
            }

            totalUsd += usd;
            totalBs += bs;
            totalCop += cop;

            const cat = g.category || 'otros';
            if (!categoryMap[cat]) {
                categoryMap[cat] = { count: 0, totalUsd: 0, totalBs: 0, totalCop: 0 };
            }
            categoryMap[cat].count += 1;
            categoryMap[cat].totalUsd += usd;
            categoryMap[cat].totalBs += bs;
            categoryMap[cat].totalCop += cop;
        });

        return {
            totalUsd,
            totalBs,
            totalCop,
            count: gastos.length,
            categoryMap,
            gastosList: gastos.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        };
    }, [sales]);

    // Métricas de Consumo Interno / Autoconsumo (Retiro físico de mercancía / Artículos)
    const activeShiftAutoconsumoMetrics = useMemo(() => {
        const flow = getOpenShiftMovements(sales).movements;
        const autoconsumos = flow.filter(s =>
            (s.isAutoconsumo === true || s.category === 'autoconsumo' || s.paymentMethod === 'autoconsumo') &&
            s.status !== 'ANULADA'
        );
        let totalUnits = 0;
        autoconsumos.forEach(g => {
            if (Array.isArray(g.items) && g.items.length > 0) {
                totalUnits += g.items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
            } else {
                totalUnits += 1;
            }
        });

        return {
            count: autoconsumos.length,
            totalUnits,
            list: autoconsumos.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        };
    }, [sales]);

    const activeShiftOutflowMetrics = useMemo(() => (
        calculateSupervisorOutflowMetrics(getOpenShiftMovements(sales).movements)
    ), [sales]);

    const activeShiftSupplierMetrics = activeShiftOutflowMetrics.supplierPayments;

    // Desglose por método de pago del turno activo (Cobros de clientes + vueltos)
    const activeShiftPaymentBreakdown = useMemo(() => {
        const breakdown = {};
        let totalVueltoBs = 0;
        let totalVueltoUsd = 0;
        let totalVueltoCop = 0;

        // Movimientos de ventas del turno activo (excluyendo egresos de caja y autoconsumo)
        const activeFlow = getOpenShiftMovements(sales).movements.filter(s =>
            s.tipo !== 'APERTURA_CAJA' &&
            s.tipo !== 'GASTO_INTERNO' &&
            !s.isAutoconsumo &&
            s.category !== 'autoconsumo' &&
            s.tipo !== 'REGISTRO_CIERRE' &&
            s.status !== 'ANULADA'
        );

        const addResolutionRow = (id, label, part) => {
            if (!part || (part.usd <= 0.009 && part.bs <= 0.009)) return;
            if (!breakdown[id]) {
                breakdown[id] = {
                    totalUsd: 0,
                    totalBs: 0,
                    count: 0,
                    label,
                    currency: part.bs > 0.009 && part.usd <= 0.009 ? 'BS' : 'USD',
                    isChange: true,
                };
            }
            breakdown[id].totalUsd = round2(breakdown[id].totalUsd + part.usd);
            breakdown[id].totalBs = round2(breakdown[id].totalBs + part.bs);
        };

        activeFlow.forEach(sale => {
            const saleChange = getSaleChangeDetails(sale, products, effectiveRate, bcvRate);
            const { changeUsd, changeBs, changeCop } = saleChange;
            if (changeBs > 0) totalVueltoBs = round2(totalVueltoBs + changeBs);
            if (changeUsd > 0) totalVueltoUsd = round2(totalVueltoUsd + changeUsd);
            if (changeCop > 0) totalVueltoCop = round2(totalVueltoCop + changeCop);

            const ledger = saleChange.ledger;
            addResolutionRow('vuelto_wallet', 'Abono a cuenta', ledger?.wallet);
            addResolutionRow(
                'vuelto_owed',
                `Vuelto por fuera${ledger?.owed?.method ? ` (${ledger.owed.method})` : ''}`,
                ledger?.owed,
            );
            addResolutionRow(
                'vuelto_voucher',
                `Voucher emitido${ledger?.voucher?.code ? ` (${ledger.voucher.code})` : ''}`,
                ledger?.voucher,
            );
            addResolutionRow('vuelto_donado', 'Vuelto cedido/donado', ledger?.donated);

            if (sale.tipo === 'VENTA_FIADA') {
                if (!breakdown['fiado']) {
                    breakdown['fiado'] = { totalUsd: 0, totalBs: 0, count: 0, label: 'Fiado (Por Cobrar)', currency: 'FIADO' };
                }
                const fiadoAmountUsd = sale.fiadoUsd != null ? sale.fiadoUsd : (sale.totalUsd || 0);
                const fiadoAmountBs = sale.totalBs || 0;
                breakdown['fiado'].totalUsd += fiadoAmountUsd;
                breakdown['fiado'].totalBs += fiadoAmountBs;
                breakdown['fiado'].count += 1;

                const remainingUpfrontUsd = (sale.totalUsd || 0) - fiadoAmountUsd;
                if (remainingUpfrontUsd <= 0.009 && (!sale.payments || sale.payments.length === 0)) {
                    return;
                }
            }

            if (sale.tipo === 'VENTA_CASHEA' || (sale.casheaUsd && sale.casheaUsd > 0)) {
                if (!breakdown['cashea']) {
                    breakdown['cashea'] = { totalUsd: 0, totalBs: 0, count: 0, label: 'Cashea (Por Cobrar)', currency: 'FIADO' };
                }
                const casheaAmountUsd = sale.casheaUsd || 0;
                if (casheaAmountUsd > 0) {
                    breakdown['cashea'].totalUsd += casheaAmountUsd;
                    breakdown['cashea'].totalBs += sale.totalBs || 0;
                    breakdown['cashea'].count += 1;
                }
                const remainingUpfrontUsd = (sale.totalUsd || 0) - casheaAmountUsd;
                if (remainingUpfrontUsd <= 0.009 && (!sale.payments || sale.payments.length === 0)) {
                    return;
                }
            }

            if (sale.payments && sale.payments.length > 0) {
                sale.payments.forEach(p => {
                    if (p.methodId === 'fiado' || p.methodId === 'cashea' || p.methodId === 'autoconsumo') return;
                    const methodId = p.methodId || 'efectivo_bs';
                    if (!breakdown[methodId]) {
                        const label = p.methodLabel || getPaymentLabel(methodId) || toTitleCase(methodId.replace(/_/g, ' '));
                        breakdown[methodId] = { totalUsd: 0, totalBs: 0, count: 0, label, currency: p.currency || 'BS' };
                    }
                    breakdown[methodId].totalUsd += p.amountUsd || 0;
                    breakdown[methodId].totalBs += p.amountBs || 0;
                    breakdown[methodId].count += 1;
                });
            } else {
                if (sale.tipo === 'VENTA_FIADA' || sale.tipo === 'VENTA_CASHEA' || sale.paymentMethod === 'autoconsumo' || sale.metodoPago === 'autoconsumo') return;
                const methodId = sale.paymentMethod || sale.metodoPago || 'efectivo_bs';
                if (methodId === 'autoconsumo') return;
                if (!breakdown[methodId]) {
                    const label = getPaymentLabel(methodId) || toTitleCase(methodId.replace(/_/g, ' '));
                    let currency = 'BS';
                    if (methodId.includes('usd') || methodId.includes('zelle') || methodId.includes('binance')) currency = 'USD';
                    else if (methodId.includes('cop')) currency = 'COP';
                    breakdown[methodId] = { totalUsd: 0, totalBs: 0, count: 0, label, currency };
                }
                breakdown[methodId].totalUsd += sale.totalUsd || 0;
                breakdown[methodId].totalBs += sale.totalBs || 0;
                breakdown[methodId].count += 1;
            }
        });

        const rate = effectiveRate || bcvRate || 1;

        if (totalVueltoBs > 0) {                breakdown['vuelto_bs'] = {
                totalUsd: 0,
                totalBs: totalVueltoBs,
                count: 0,
                label: 'Vuelto Entregado (en Bs)',
                currency: 'BS',
                isChange: true
            };

        }
        if (totalVueltoUsd > 0) {
            breakdown['vuelto_usd'] = {
                totalUsd: totalVueltoUsd,
                totalBs: totalVueltoUsd * rate,
                count: 0,
                label: 'Vuelto Entregado (en $)',
                currency: 'USD',
                isChange: true
            };
        }
        if (totalVueltoCop > 0) {
            breakdown['vuelto_cop'] = {
                totalUsd: 0,
                totalBs: 0,
                totalCop: totalVueltoCop,
                count: 0,
                label: 'Vuelto Entregado (en COP)',
                currency: 'COP',
                isChange: true
            };
        }

        return Object.entries(breakdown)
            .filter(([mId, data]) => mId !== 'autoconsumo' && (data.totalUsd > 0 || data.totalBs > 0 || data.count > 0))
            .sort(([, a], [, b]) => {
                if (a.isChange && !b.isChange) return 1;
                if (!a.isChange && b.isChange) return -1;
                return b.totalUsd - a.totalUsd;
            });
    }, [sales, activeShiftApertura, effectiveRate, bcvRate]);

    const activeShiftChangeMetrics = useMemo(() => (
        calculateSupervisorChangeMetrics(
            getOpenShiftMovements(sales).movements,
            sale => getSaleChangeDetails(sale, products, effectiveRate, bcvRate)
        )
    ), [sales, products, effectiveRate, bcvRate]);

    // Base de los porcentajes del desglose: SOLO los cobros reales.
    // Los vueltos (isChange) y las propinas (isTip) son disposiciones de ese mismo
    // dinero, no ingresos adicionales. Antes se dividía entre el total NETO de
    // ventas mientras los numeradores eran importes BRUTOS, así que un pago de
    // $26.00 sobre un neto de $19.24 se mostraba como 135% y la suma pasaba de 100.
    const activeShiftGrossUsd = useMemo(
        () => activeShiftPaymentBreakdown
            .filter(([, d]) => !d.isChange && !d.isTip)
            .reduce((sum, [, d]) => sum + (d.totalUsd || 0), 0),
        [activeShiftPaymentBreakdown]
    );

    // Cálculo exacto del Efectivo Físico Esperado en Gaveta mediante FinancialEngine (Arqueo Teórico de Caja en Vivo)
    const activeShiftExpectedCash = useMemo(() => {
        const openMovements = getOpenShiftMovements(sales).movements;
        const breakdown = FinancialEngine.calculatePaymentBreakdown(openMovements);
        const expected = FinancialEngine.computeExpectedCash(breakdown);

        return {
            expectedBs: Math.max(0, round2(expected.bs || 0)),
            expectedUsd: Math.max(0, round2(expected.usd || 0)),
            expectedCop: Math.max(0, round2(expected.cop || 0))
        };
    }, [sales]);

    const activeShiftTipTotals = useMemo(() => {
        const activeFlow = getOpenShiftMovements(sales).movements;
        let tipUsd = 0;
        let tipBs = 0;
        let tipCount = 0;
        activeFlow.forEach(s => {
            if (s.tipDonated) {
                tipUsd += (s.tipDonated.amountUsd || 0);
                tipBs += (s.tipDonated.amountBs || 0);
                tipCount++;
            }
        });
        return { tipUsd: round2(tipUsd), tipBs: round2(tipBs), tipCount };
    }, [sales]);

    // Ticket promedio del turno activo
    const activeShiftAvgTicket = useMemo(() => {
        if (activeShiftSales.length === 0) return 0;
        return activeShiftMetrics.totalUsd / activeShiftSales.length;
    }, [activeShiftMetrics.totalUsd, activeShiftSales.length]);

    // ── HISTORIAL DE CIERRES DE CAJA ──

    // Reconstruir cierres agrupados por cierreId
    const registerCloses = useMemo(() => {
        const explicitCloses = sales.filter(s => s.tipo === 'REGISTRO_CIERRE');

        // Agrupar transacciones cerradas por cierreId
        const groups = {};
        sales.forEach(s => {
            if (s.cierreId && s.tipo !== 'REGISTRO_CIERRE') {
                const cId = s.cierreId;
                if (!groups[cId]) {
                    groups[cId] = {
                        cierreId: cId,
                        timestamp: typeof cId === 'number' ? new Date(cId).toISOString() : (s.timestamp || new Date().toISOString()),
                        sales: []
                    };
                }
                groups[cId].sales.push(s);
            }
        });

        // Asegurar que todo REGISTRO_CIERRE explícito quede incluido en los grupos
        explicitCloses.forEach(ec => {
            const cId = ec.cierreId || ec.timestamp;
            if (!cId) return;
            if (!groups[cId]) {
                groups[cId] = {
                    cierreId: cId,
                    timestamp: ec.timestamp || (typeof cId === 'number' ? new Date(cId).toISOString() : new Date().toISOString()),
                    sales: []
                };
            }
        });

        // Formatear cada grupo combinando datos explícitos de arqueo si existen
        return Object.values(groups).filter(g => {
            const explicit = explicitCloses.find(ec => ec.cierreId === g.cierreId || ec.timestamp === g.timestamp);
            return explicit || g.sales.some(s => s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA');
        }).map(g => {
            const explicit = explicitCloses.find(ec => ec.cierreId === g.cierreId || ec.timestamp === g.timestamp);

            // Filtrar para métricas generales y de caja
            const salesForStats = g.sales.filter(s => s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA');
            const salesForCashFlow = g.sales.filter(s => s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA' || s.tipo === 'COBRO_DEUDA' || s.tipo === 'PAGO_PROVEEDOR');

            const calculatedTotalUsd = salesForStats.reduce((sum, s) => sum + (s.totalUsd || 0), 0);
            const calculatedTotalBs = salesForStats.reduce((sum, s) => sum + (s.totalBs || 0), 0);
            const calculatedTotalItems = salesForStats.reduce((sum, s) => sum + (s.items ? s.items.reduce((is, it) => is + it.qty, 0) : 0), 0);

            const totalUsd = explicit?.summary?.todayTotalUsd ?? calculatedTotalUsd;
            const totalBs = explicit?.summary?.todayTotalBs ?? calculatedTotalBs;
            const totalItems = explicit?.summary?.todayItemsSold ?? calculatedTotalItems;

            // Reconstruir desglose de pagos del cierre
            const breakdown = {};
            salesForCashFlow.forEach(sale => {
                if (sale.tipo === 'VENTA_FIADA') {
                    if (!breakdown['fiado']) {
                        breakdown['fiado'] = { totalUsd: 0, totalBs: 0, count: 0, label: 'Fiado (Por Cobrar)', currency: 'FIADO' };
                    }
                    const fiadoAmountUsd = sale.fiadoUsd != null ? sale.fiadoUsd : (sale.totalUsd || 0);
                    const fiadoAmountBs = sale.totalBs || 0;
                    breakdown['fiado'].totalUsd += fiadoAmountUsd;
                    breakdown['fiado'].totalBs += fiadoAmountBs;
                    breakdown['fiado'].count += 1;

                    const remainingUpfrontUsd = (sale.totalUsd || 0) - fiadoAmountUsd;
                    if (remainingUpfrontUsd <= 0.009 && (!sale.payments || sale.payments.length === 0)) {
                        return;
                    }
                }

                if (sale.tipo === 'VENTA_CASHEA' || (sale.casheaUsd && sale.casheaUsd > 0)) {
                    if (!breakdown['cashea']) {
                        breakdown['cashea'] = { totalUsd: 0, totalBs: 0, count: 0, label: 'Cashea (Por Cobrar)', currency: 'FIADO' };
                    }
                    const casheaAmountUsd = sale.casheaUsd || 0;
                    if (casheaAmountUsd > 0) {
                        breakdown['cashea'].totalUsd += casheaAmountUsd;
                        breakdown['cashea'].totalBs += sale.totalBs || 0;
                        breakdown['cashea'].count += 1;
                    }
                    const remainingUpfrontUsd = (sale.totalUsd || 0) - casheaAmountUsd;
                    if (remainingUpfrontUsd <= 0.009 && (!sale.payments || sale.payments.length === 0)) {
                        return;
                    }
                }

                if (sale.payments && sale.payments.length > 0) {
                    sale.payments.forEach(p => {
                        if (p.methodId === 'fiado' || p.methodId === 'cashea') return;
                        const mId = p.methodId || 'efectivo_bs';
                        if (!breakdown[mId]) {
                            breakdown[mId] = { totalUsd: 0, totalBs: 0, count: 0, label: p.methodLabel || getPaymentLabel(mId), currency: p.currency || 'BS' };
                        }
                        breakdown[mId].totalUsd += p.amountUsd || 0;
                        breakdown[mId].totalBs += p.amountBs || 0;
                        breakdown[mId].count += 1;
                    });
                } else {
                    if (sale.tipo === 'VENTA_FIADA' || sale.tipo === 'VENTA_CASHEA') return;
                    const mId = sale.paymentMethod || sale.metodoPago || 'efectivo_bs';
                    if (!breakdown[mId]) {
                        breakdown[mId] = { totalUsd: 0, totalBs: 0, count: 0, label: getPaymentLabel(mId), currency: mId.includes('usd') ? 'USD' : 'BS' };
                    }
                    breakdown[mId].totalUsd += sale.totalUsd || 0;
                    breakdown[mId].totalBs += sale.totalBs || 0;
                    breakdown[mId].count += 1;
                }
            });

            const sortedBreakdown = Object.entries(breakdown)
                .sort(([, a], [, b]) => b.totalUsd - a.totalUsd);

            const apertura = g.sales.find(s => s.tipo === 'APERTURA_CAJA') || null;

            return {
                cierreId: g.cierreId,
                cierreNumber: explicit?.cierreNumber || (typeof g.cierreId === 'number' ? String(g.cierreId).slice(-4) : 'N/A'),
                timestamp: g.timestamp,
                sales: salesForStats,
                totalUsd,
                totalBs,
                totalItems,
                paymentBreakdown: sortedBreakdown,
                apertura,
                reconData: explicit?.summary?.reconData || null,
                cashier: explicit?.summary?.cashier || { nombre: 'Cajero', rol: 'CAJERO' }
            };
        }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }, [sales]);

    // Establecer primer cierre por defecto si cambia la lista
    useEffect(() => {
        if (registerCloses.length > 0 && !selectedCierreId) {
            setSelectedCierreId(registerCloses[0].cierreId);
        }
    }, [registerCloses, selectedCierreId]);

    // 📄 Generar y Descargar PDF del Cierre Seleccionado
    const handleDownloadCierrePDF = useCallback(async (cierreObj, e) => {
        if (e) e.stopPropagation();
        triggerHaptic?.();
        if (!cierreObj) return;

        setExportingCierreId(cierreObj.cierreId);
        try {
            const { generateDailyClosePDF } = await import('../utils/dailyCloseGenerator');

            // Agrupar los productos más vendidos del cierre
            const prodMap = {};
            (cierreObj.sales || []).forEach(s => {
                (s.items || []).forEach(item => {
                    const name = item.name || 'Producto';
                    if (!prodMap[name]) prodMap[name] = { name, qty: 0, revenue: 0 };
                    prodMap[name].qty += item.qty || 1;
                    prodMap[name].revenue += (item.priceUsd || item.price || 0) * (item.qty || 1);
                });
            });
            const topProducts = Object.values(prodMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

            // Formatear paymentBreakdown como objeto
            const paymentBreakdownObj = {};
            if (Array.isArray(cierreObj.paymentBreakdown)) {
                cierreObj.paymentBreakdown.forEach(([mId, data]) => {
                    paymentBreakdownObj[mId] = data;
                });
            } else if (typeof cierreObj.paymentBreakdown === 'object' && cierreObj.paymentBreakdown !== null) {
                Object.assign(paymentBreakdownObj, cierreObj.paymentBreakdown);
            }

            // Calcular ganancia estimada del cierre
            let calculatedProfitUsd = 0;
            (cierreObj.sales || []).forEach(s => {
                (s.items || []).forEach(it => {
                    const price = it.priceUsd != null ? it.priceUsd : (it.price || 0);
                    const cost = it.costUsd != null ? it.costUsd : (it.costPrice != null ? it.costPrice : (it.cost || 0));
                    calculatedProfitUsd += (price - cost) * (it.qty || 1);
                });
            });

            // Normalizar reconData con propiedades unificadas
            const reconDataFormatted = cierreObj.reconData ? {
                ...cierreObj.reconData,
                declaredUsd: cierreObj.reconData.cashUsd ?? cierreObj.reconData.declaredUsd ?? 0,
                declaredBs: cierreObj.reconData.cashBs ?? cierreObj.reconData.declaredBs ?? 0,
                declaredCop: cierreObj.reconData.cashCop ?? cierreObj.reconData.declaredCop ?? 0,
                diffUsd: cierreObj.reconData.diffUsd ?? ((cierreObj.reconData.cashUsd ?? 0) - (cierreObj.reconData.expectedUsd ?? cierreObj.totalUsd ?? 0)),
                diffBs: cierreObj.reconData.diffBs ?? ((cierreObj.reconData.cashBs ?? 0) - (cierreObj.reconData.expectedBs ?? cierreObj.totalBs ?? 0)),
            } : null;

            await generateDailyClosePDF({
                sales: cierreObj.sales || [],
                allSales: cierreObj.sales || [],
                bcvRate: effectiveRate || bcvRate || 1,
                paymentBreakdown: paymentBreakdownObj,
                topProducts,
                todayTotalUsd: cierreObj.totalUsd || 0,
                todayTotalBs: cierreObj.totalBs || 0,
                todayProfit: calculatedProfitUsd,
                todayProfitUsd: calculatedProfitUsd,
                todayItemsSold: cierreObj.totalItems || 0,
                reconData: reconDataFormatted,
                apertura: cierreObj.apertura || null,
                copEnabled,
                tasaCop,
                action: 'download',
            });
            showToast?.(`PDF del Cierre #${cierreObj.cierreNumber || ''} descargado`, 'success');
        } catch (err) {
            console.error('Error generando PDF del cierre:', err);
            showToast?.('Error al generar PDF del cierre', 'error');
        } finally {
            setExportingCierreId(null);
        }
    }, [effectiveRate, bcvRate, triggerHaptic]);

    const handleRemoteForceDailyClose = useCallback(async () => {
        if (!pairedDeviceId || !supabaseCloud) return;
        setClosingRemote(true);
        triggerHaptic?.();
        try {
            const monitorDeviceId = localStorage.getItem('dj_device_id') || 'monitor_web';
            const commandId = createSupervisorCommandId();
            const currentCierreId = Date.now();

            // El monitor NO calcula el cierre: su copia de bodega_sales_v1 puede estar
            // atrasada y sobrescribir el documento financiero de la caja borraría ventas.
            // Envía la orden; la caja re-lee fresco bajo lock y publica el resultado.
            const { error } = await supabaseCloud
                .from('supervisor_commands')
                .insert({
                    id: commandId,
                    primary_device_id: pairedDeviceId,
                    monitor_device_id: monitorDeviceId,
                    command_type: 'force_daily_close',
                    payload: {
                        commandId,
                        cierreId: currentCierreId,
                        referencia: {
                            totalUsd: activeShiftMetrics.totalUsd,
                            totalBs: activeShiftMetrics.totalBs,
                            count: activeShiftMetrics.count,
                        },
                        cashier: { nombre: 'Supervisión Remota', rol: 'SUPERVISOR_REMOTO' },
                        observedCashier: activeCashier?.nombre || null,
                        supervisorId: supervisorUser?.id || null,
                        supervisorName: supervisorUser?.nombre || supervisorUser?.usuario || 'Supervisor',
                        supervisorRole: supervisorUser?.rol || 'SUPERVISOR',
                        copEnabled,
                        tasaCop,
                    },
                    status: 'pending'
                });

            if (error) throw error;

            setShowRemoteCloseModal(false);
            showToast('Orden de cierre enviada. Se aplicará en la caja al recibirla.', 'success');
        } catch (err) {
            console.error('[OwnerMonitor] Error al enviar el cierre remoto:', err);
            showToast('No se pudo enviar la orden de cierre', 'error');
        } finally {
            setClosingRemote(false);
        }
    }, [pairedDeviceId, activeShiftMetrics, activeCashier, supervisorUser, copEnabled, tasaCop, triggerHaptic]);

    const handleReopenRemoteShift = useCallback(async (targetCierreId = null) => {
        if (shiftStatusInfo.isOpen) {
            showToast('Ya hay un turno abierto actualmente en la caja', 'warning');
            return;
        }
        if (!pairedDeviceId || !supabaseCloud) return;
        triggerHaptic?.();
        try {
            const monitorDeviceId = localStorage.getItem('dj_device_id') || 'monitor_web';
            const commandId = createSupervisorCommandId();
            const { error } = await supabaseCloud
                .from('supervisor_commands')
                .insert({
                    id: commandId,
                    primary_device_id: pairedDeviceId,
                    monitor_device_id: monitorDeviceId,
                    command_type: 'reopen_shift',
                    payload: {
                        commandId,
                        cierreId: targetCierreId || null,
                        cashier: { nombre: 'Supervisión Remota', rol: 'SUPERVISOR_REMOTO' },
                        observedCashier: activeCashier?.nombre || null,
                        supervisorId: supervisorUser?.id || null,
                        supervisorName: supervisorUser?.nombre || supervisorUser?.usuario || 'Supervisor',
                        supervisorRole: supervisorUser?.rol || 'SUPERVISOR',
                    },
                    status: 'pending'
                });

            if (error) throw error;

            showToast('🔓 Orden de reapertura de turno enviada a la caja.', 'success');
        } catch (err) {
            console.error('[OwnerMonitor] Error enviando comando de reapertura:', err);
            showToast('No se pudo enviar la orden de reapertura', 'error');
        }
    }, [pairedDeviceId, shiftStatusInfo, activeCashier, supervisorUser, triggerHaptic]);

    return {
        selectedCierreId,
        setSelectedCierreId,
        exportingCierreId,
        setExportingCierreId,
        activeShiftApertura,
        shiftStatusInfo,
        activeShiftSales,
        activeShiftMetrics,
        activeShiftExpensesMetrics,
        activeShiftAutoconsumoMetrics,
        activeShiftOutflowMetrics,
        activeShiftSupplierMetrics,
        activeShiftPaymentBreakdown,
        activeShiftChangeMetrics,
        activeShiftGrossUsd,
        activeShiftExpectedCash,
        activeShiftTipTotals,
        activeShiftAvgTicket,
        registerCloses,
        handleDownloadCierrePDF,
        handleRemoteForceDailyClose,
        handleReopenRemoteShift,
    };
}
