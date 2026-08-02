import { storageService } from './storageService';
import { procesarImpactoCliente } from './financialLogic';
import { logEvent } from '../services/auditService';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { round2, sumR, subR, divR, mulR } from './dinero';
import { withLock } from './withLock';          // FIN-007: feature detection + fallback.
import { deepFreeze } from './deepFreeze';      // FIN-008: deep freeze (no solo shallow).
import { FINANCIAL_EPSILON } from './securityConstants';
import { FinancialEngine } from '../core/FinancialEngine';
import { calculatePricing } from './productProcessor';

const SALES_KEY = 'bodega_sales_v1';
const PRODUCTS_KEY = 'bodega_products_v1';
const CUSTOMERS_KEY = 'bodega_customers_v1';

export async function processSaleTransaction({
    cart,
    cartTotalUsd,
    cartTotalBs,
    cartSubtotalUsd,
    payments,
    changeBreakdown,
    selectedCustomerId,
    customers,
    products,
    effectiveRate,
    tasaCop,
    copEnabled,
    discountData,
    useAutoRate,
    bcvRate
}) {
    if (cart.length === 0) return { success: false, error: 'Carrito vacío' };

    const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

    if (isNaN(cartTotalUsd) || cartTotalUsd < 0 || isNaN(cartTotalBs) || cartTotalBs < 0) {
        return { success: false, error: 'Integridad matemática comprometida' };
    }
    if (cartTotalUsd <= 0.01) {
        return { success: false, error: 'No se pueden generar ventas de $0.00' };
    }
    if (!Array.isArray(payments) || payments.some(p => isNaN(p.amountUsd) || p.amountUsd < 0)) {
        return { success: false, error: 'Datos de pago inválidos' };
    }

    // FIN-022: Validación de tasa y consistencia matemática entre USD y Bs.
    if (!effectiveRate || effectiveRate <= 0) {
        return { success: false, error: 'Tasa de cambio BCV inválida (<= 0). Configura la tasa antes de cobrar.' };
    }
    
    const totals = FinancialEngine.buildCartTotals(cart, discountData, effectiveRate, copEnabled ? tasaCop : 0, bcvRate);
    const expectedBs = totals.totalBs;
    const bsDrift = Math.abs(subR(cartTotalBs, expectedBs));
    if (bsDrift > FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_BS) {
        return { success: false, error: `Inconsistencia USD/Bs: drift de ${round2(bsDrift)} Bs (tasa ${effectiveRate}).` };
    }

    // ── Aritmética precisa con dinero.js (elimina IEEE 754 drift) ──
    const totalPaidUsd = sumR(payments.map(p => p.amountUsd));
    const totalPaidBs  = sumR(payments.map(p => p.amountBs || (p.amountUsd && effectiveRate ? mulR(p.amountUsd, effectiveRate) : 0)));

    // Si los pagos cubren completamente el total en Bolívares (cartTotalBs) en productos con Bs Fijo/Congelado
    const isPureBsPayment = payments.length > 0 && payments.every(p => p.currency === 'BS' || (p.amountBs > 0));
    const totalBsPaidFully = cartTotalBs > 0 && isPureBsPayment && totalPaidBs >= subR(cartTotalBs, 0.5);

    const effectiveCartTotalUsd = totalBsPaidFully ? totalPaidUsd : cartTotalUsd;

    const remainingUsd = totalBsPaidFully ? 0 : round2(Math.max(0, subR(effectiveCartTotalUsd, totalPaidUsd)));
    const changeUsd    = round2(Math.max(0, subR(totalPaidUsd, effectiveCartTotalUsd)));

    const casheaPayment = payments.find(p => p.methodId === 'cashea');
    const casheaUsd = casheaPayment ? round2(casheaPayment.amountUsd) : 0;

    if (!selectedCustomer && (remainingUsd > 0.01 || casheaUsd > 0)) {
        return { success: false, error: remainingUsd > 0.01 ? 'Se requiere cliente para ventas fiadas' : 'Se requiere cliente para ventas con Cashea' };
    }

    // FIN-005: Bloquear ventas con anomalía de vuelto (changeUsd > total * 5).
    const changeAnomalyThresholdUsd = mulR(cartTotalUsd, FINANCIAL_EPSILON.CHANGE_ANOMALY_MULTIPLIER);
    if (changeUsd > FINANCIAL_EPSILON.CHANGE_ANOMALY_MIN_USD && changeUsd > changeAnomalyThresholdUsd) {
        return {
            success: false,
            error: `Vuelto anómalo detectado: $${round2(changeUsd)} para una venta de $${round2(cartTotalUsd)}. Verifica los montos ingresados.`
        };
    }

    const fiadoAmountUsd = remainingUsd > 0.01 ? remainingUsd : 0;
    const tipoVenta = casheaUsd > 0 ? 'VENTA_CASHEA' : (fiadoAmountUsd > 0 ? 'VENTA_FIADA' : 'VENTA');

    // ── Normalizar payments: asegurar currency y methodLabel ──
    // Esto permite que el FinancialEngine calcule el breakdown correctamente
    // sin depender de campos que podían llegar undefined en versiones anteriores.
    const normalizedPayments = payments.map(p => ({
        ...p,
        currency:    p.currency    || 'USD',
        methodLabel: p.methodLabel || p.methodId,
    }));

    const activeUser = useAuthStore.getState().usuarioActivo;
    const cajeroNombre = activeUser ? (activeUser.nombre || activeUser.usuario || 'Cajero') : null;

    const sale = {
        id: crypto.randomUUID(),
        tipo: tipoVenta,
        status: 'COMPLETADA',
        cajero: cajeroNombre,
        cajeroId: activeUser?.id || null,
        items: cart.map(i => {
            const { unitPriceBs: _unitBs } = calculatePricing(i, effectiveRate, bcvRate);
            return {
                id: i.id,
                name: i.name,
                qty: i.qty,
                priceUsd: i.priceUsd,
                priceCop: i.priceCop || null,
                costBs: i.costBs || 0,
                costUsd: i.costUsd || 0,
                isWeight: i.isWeight,
                _mode: i._mode || i.mode || 'unit',
                boxUnits: i.boxUnits || null,
                halfBoxUnits: i.halfBoxUnits || null,
                priceBsManual: i.priceBsManual || null,
                priceBsUsdRef: i.priceBsUsdRef || null,
                pricingMode: i.pricingMode || null,
                forceBcv: i.forceBcv || null,
                isModular: i.isModular || false,
                modularSelections: i.modularSelections || [],
                isDeferredConsumption: i.isDeferredConsumption || false,
                deferredCustomerRef: i.deferredCustomerRef || null,
                // Bs exacto al momento de la venta (para recibos e historial)
                subtotalBs: mulR(_unitBs, i.qty)
            };
        }),
        cartSubtotalUsd: cartSubtotalUsd,
        discountType:       discountData?.type      || null,
        discountValue:      discountData?.value     || 0,
        discountAmountUsd:  discountData?.amountUsd || 0,
        totalUsd:  cartTotalUsd,
        totalBs:   cartTotalBs,
        totalCop:  totals.totalCop,
        payments:  normalizedPayments,          // ← Con currency + methodLabel
        rate:      effectiveRate,
        bcvRate:   bcvRate,
        tasaCop:   copEnabled ? tasaCop : 0,
        copEnabled: copEnabled,
        rateSource: useAutoRate ? 'BCV Auto' : 'Manual',
        timestamp: new Date().toISOString(),
        changeUsd: round2(changeBreakdown?.changeUsdGiven || 0),
        changeBs:  round2(changeBreakdown?.changeBsGiven  || 0),
        changeGiven: {
            usd: round2(changeBreakdown?.changeUsdGiven || 0),
            bs:  round2(changeBreakdown?.changeBsGiven  || 0),
        },
        // F7: divergencia Bs-vs-USD de esta venta (redondeo al múltiplo más cercano +
        // precios manuales en Bs). Se persiste para poder sumarla en el cierre: de signo
        // variable por línea, pero el acumulado del turno sí es una cifra auditable.
        bsVsUsdDiffBs: round2(totals.bsVsUsdDiffBs || 0),
        // FIN-012: Guardar vueltoParaMonedero para revertir al anular.
        // Por ahora el flujo de checkout no enruta vuelto a favor (siempre 0),
        // pero dejamos el campo para ventas futuras y abonos manuales.
        vueltoParaMonedero: 0,
        customerId:       selectedCustomerId || null,
        customerName:     selectedCustomer ? selectedCustomer.name : 'Consumidor Final',
        customerDocument: selectedCustomer?.documentId || null,
        customerPhone:    selectedCustomer?.phone      || null,
        fiadoUsd: fiadoAmountUsd,
        casheaUsd: casheaUsd
    };

    // FIN-008: deepFreeze en lugar de Object.freeze (congela items[] y payments[]).
    deepFreeze(sale);

    // FIN-007: withLock reemplaza navigator.locks.request directo (feature detection + fallback).
    const lockResult = await withLock('pos_write_lock', async () => {
        const existingSales = await storageService.getItem(SALES_KEY, []);
        const saleNumber = existingSales.reduce((mx, s) => Math.max(mx, s.saleNumber || 0), 0) + 1;
        // FIN-008: deep-freeze el sale persistido final.
        const finalPersistedSale = deepFreeze({ ...sale, saleNumber });

        const updatedSales = [finalPersistedSale, ...existingSales];
        await storageService.setItem(SALES_KEY, updatedSales);

        // ── BLINDAJE ANTI-PÉRDIDA DE DATOS: Espejo Inmutable de Ventas ──
        try {
            const MIRROR_KEY = 'bodega_sales_mirror_v1';
            const mirrorSales = await storageService.getItem(MIRROR_KEY, []);
            if (!mirrorSales.some(s => s.id === finalPersistedSale.id)) {
                await storageService.setItem(MIRROR_KEY, [finalPersistedSale, ...mirrorSales]);
            }
        } catch (mirrorErr) {
            console.warn('[checkoutProcessor] Error al actualizar espejo de ventas:', mirrorErr);
        }

        // Audit log
        const user = useAuthStore.getState().usuarioActivo;
        const tipo = casheaUsd > 0 ? 'VENTA_CASHEA' : (fiadoAmountUsd > 0 ? 'VENTA_FIADA' : 'VENTA_COMPLETADA');
        logEvent('VENTA', tipo,
            `Venta #${saleNumber} - $${round2(cartTotalUsd)} - ${cart.length} items - ${selectedCustomer?.name || 'Consumidor Final'}`,
            user,
            { saleId: finalPersistedSale.id, total: cartTotalUsd, items: cart.length }
        );

        // ── Crear Fichas de Consumo Activas para ítems con Consumo Diferido en Sitio ──
        try {
            const deferredItems = cart.filter(i => i.isDeferredConsumption);
            if (deferredItems.length > 0) {
                const { createSessionFromSaleUnlocked } = await import('../services/consumptionSessionService');
                for (const dItem of deferredItems) {
                    await createSessionFromSaleUnlocked(finalPersistedSale, dItem);
                }
            }
        } catch (deferredErr) {
            console.error('[checkoutProcessor] Error al crear Fichas de Consumo Diferido:', deferredErr);
        }

        // ── Deducir stock con precisión ──
        // FIN-027-pattern: re-leer productos fresco aquí para evitar stale state.
        const freshProducts = await storageService.getItem(PRODUCTS_KEY, products);
        const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';
        let negativeStockUsed = false;
        const negativeItems = [];

        // ── Calcular mapa de deducciones de stock ──
        const deduccionesMap = {}; // { [productId]: totalQtyToDeduct }
        const addDeduccion = (productId, qtyToDeduct) => {
            deduccionesMap[productId] = sumR(deduccionesMap[productId] || 0, qtyToDeduct);
        };

        cart.forEach(item => {
            // Consumo Diferido en Sitio: NO se descuenta inventario al cobrar el combo.
            // Las cervezas se irán descontando progresivamente con cada despacho en el local.
            if (item.isDeferredConsumption) {
                return;
            }

            const itemId = item._originalId || item.id;
            const itemQty = item.qty;
            const isWeight = item.isWeight;
            const mode = item._mode || 'unit';

            let physicalQty = itemQty;
            if (isWeight) {
                physicalQty = itemQty;
            } else if (mode === 'box') {
                const boxUnits = parseInt(item.boxUnits, 10) || 1;
                physicalQty = mulR(itemQty, boxUnits);
            } else if (mode === 'halfBox') {
                const halfBoxUnits = parseInt(item.halfBoxUnits, 10) || 1;
                physicalQty = mulR(itemQty, halfBoxUnits);
            }

            const prodObj = freshProducts.find(p => p.id === itemId);
            if (prodObj && prodObj.isCombo && prodObj.comboItems?.length > 0) {
                prodObj.comboItems.forEach(ci => {
                    const compDeduction = mulR(ci.qty, physicalQty);
                    addDeduccion(ci.productId, compDeduction);
                });
            }

            if (item.isModular && item.modularSelections?.length > 0) {
                item.modularSelections.forEach(sel => {
                    const compDeduction = mulR(sel.qty, physicalQty);
                    addDeduccion(sel.productId, compDeduction);
                });
            }

            if (!prodObj?.isCombo && !item.isModular) {
                addDeduccion(itemId, physicalQty);
            }
        });

        const updatedProducts = freshProducts.map(p => {
            const deduction = deduccionesMap[p.id];
            if (deduction && deduction > 0) {
                if (p.isCombo) return p; // Los combos no tienen stock fisico directo

                const newStock = subR(p.stock ?? 0, deduction);
                // FIN-014: auditar uso de stock negativo (no mover el flag, solo loguear).
                if (newStock < 0 && allowNeg) {
                    negativeStockUsed = true;
                    negativeItems.push({ productId: p.id, name: p.name, stockBefore: p.stock ?? 0, deducted: deduction, stockAfter: newStock });
                }
                return { ...p, stock: allowNeg ? newStock : Math.max(0, newStock) };
            }
            return p;
        });

        if (negativeStockUsed) {
            const user = useAuthStore.getState().usuarioActivo;
            logEvent('CONFIG', 'NEGATIVE_STOCK_USED',
                `Venta #${saleNumber} usó stock negativo en ${negativeItems.length} producto(s)`,
                user,
                { saleId: finalPersistedSale.id, items: negativeItems }
            );
        }

        // FIN-008: deep-freeze products antes de retornar.
        await storageService.setItem(PRODUCTS_KEY, updatedProducts);
        deepFreeze(updatedProducts);

        // ── Registro inmutable en Kardex ──
        try {
            const { recordKardexMovementUnlocked } = await import('../services/kardexService');
            for (const item of cart) {
                let physicalQty = Number(item.qty || item.quantity) || 1;
                const mode = item._mode || item.mode || 'unit';
                if (mode === 'box') {
                    const boxUnits = parseInt(item.boxUnits, 10) || 1;
                    physicalQty = mulR(physicalQty, boxUnits);
                } else if (mode === 'halfBox') {
                    const halfBoxUnits = parseInt(item.halfBoxUnits, 10) || 1;
                    physicalQty = mulR(physicalQty, halfBoxUnits);
                }
                const qtySold = -physicalQty;

                await recordKardexMovementUnlocked({
                    productoId: item._originalId || item.id,
                    productoNombre: item.name,
                    sku: item.barcode || item.sku || '',
                    tipo: 'VENTA',
                    subtipo: 'POS_CHECKOUT',
                    cantidad: qtySold,
                    unidad: item.unit || 'unidad',
                    costoUnitario: Number(item.costUsd || item.cost || 0),
                    referenciaId: finalPersistedSale.id,
                    referenciaTipo: 'VENTA',
                    referenciaNumero: `#${finalPersistedSale.saleNumber || finalPersistedSale.id.slice(0, 8)}`,
                    usuarioId: activeUser?.id || null,
                    usuarioNombre: activeUser?.nombre || 'Cajero'
                });
            }
        } catch (kardexErr) {
            console.error('[checkoutProcessor] Error registrando Kardex de venta:', kardexErr);
        }

        let updatedCustomer = null;
        let updatedCustomers = customers;

        if (selectedCustomer) {
            const amount_favor_used = sumR(normalizedPayments
                .filter(p => p.methodId === 'saldo_favor')
                .map(p => p.amountUsd));

            const deudaParaCliente = casheaUsd > 0 ? casheaUsd : fiadoAmountUsd;

            const transaccionOpts = {
                usaSaldoFavor:    amount_favor_used,
                esCredito:        deudaParaCliente > FINANCIAL_EPSILON.PAYMENT_ZERO,
                deudaGenerada:    deudaParaCliente,
                vueltoParaMonedero: 0,
                esCashea:         casheaUsd > 0
            };

            updatedCustomer  = procesarImpactoCliente(selectedCustomer, transaccionOpts);
            updatedCustomers = customers.map(c => c.id === selectedCustomer.id ? updatedCustomer : c);

            await storageService.setItem(CUSTOMERS_KEY, updatedCustomers);
            // FIN-008: deep-freeze customers antes de retornar.
            deepFreeze(updatedCustomers);
        }

        return {
            success: true,
            sale: finalPersistedSale,
            updatedProducts,
            updatedCustomers
        };
    });

    return lockResult;
}
