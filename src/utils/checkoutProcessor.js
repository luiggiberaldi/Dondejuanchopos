import { storageService } from './storageService';
import { procesarImpactoCliente } from './financialLogic';
import { logEvent } from '../services/auditService';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { round2, sumR, subR, divR, mulR } from './dinero';
import { withLock } from './withLock';          // FIN-007: feature detection + fallback.
import { deepFreeze } from './deepFreeze';      // FIN-008: deep freeze (no solo shallow).
import { FINANCIAL_EPSILON } from './securityConstants';
import { FinancialEngine } from '../core/FinancialEngine';
import { assertCheckoutInvariants, calculatePaymentState, validateChangeOwed } from '../core/CheckoutPaymentEngine';
import { calculatePricing } from './productProcessor';
import { getChangeLedger, normalizeChangeCurrency } from './changeLedger';
import { expandCartToPhysicalDeductions, aggregatePhysicalDeductions } from './inventoryMovementModel';
import { applyInventoryOperationUnlocked } from '../services/inventoryOperationService';

const SALES_KEY = 'bodega_sales_v1';
const PRODUCTS_KEY = 'bodega_products_v1';
const CUSTOMERS_KEY = 'bodega_customers_v1';
const SALES_JOURNAL_KEY = 'bodega_sales_journal_v1';

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
    bcvRate,
    paymentMethods,
    checkoutOperationId
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
    if (totals.pricingErrors?.length) {
        const firstError = totals.pricingErrors[0];
        return {
            success: false,
            error: `No se puede cobrar: ${firstError.itemName} no tiene un precio Bs válido para ${firstError.mode}.`,
            pricingErrors: totals.pricingErrors,
        };
    }
    const expectedBs = totals.totalBs;
    const bsDrift = Math.abs(subR(cartTotalBs, expectedBs));
    if (bsDrift > FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_BS) {
        return { success: false, error: `Inconsistencia USD/Bs: drift de ${round2(bsDrift)} Bs (tasa ${effectiveRate}).` };
    }

    // ── Aritmética precisa con dinero.js (elimina IEEE 754 drift) ──
    const normalizedPayments = payments.map(p => ({
        ...p,
        currency: String(p.currency || 'USD').toUpperCase() === 'VES' ? 'BS' : String(p.currency || 'USD').toUpperCase(),
        methodLabel: p.methodLabel || p.methodId,
    }));

    // Si los pagos cubren completamente el total en Bolívares (cartTotalBs) en productos con Bs Fijo/Congelado
    // NOTA: verificar currency === 'BS' explícitamente — NO usar amountBs > 0 porque los pagos USD
    // también tienen amountBs calculado (el equivalente), lo que causaría un falso positivo.
    const casheaPayment = normalizedPayments.find(p => p.methodId === 'cashea');
    const saldoFavorPayment = normalizedPayments.find(p => p.methodId === 'saldo_favor');
    const casheaUsd = casheaPayment ? round2(Number(casheaPayment.amountUsd ?? casheaPayment.amountInput) || 0) : 0;
    const saldoFavorUsd = saldoFavorPayment ? round2(Number(saldoFavorPayment.amountUsd ?? saldoFavorPayment.amountInput) || 0) : 0;
    const paymentState = calculatePaymentState({
        cartTotalUsd,
        cartTotalBs,
        payments: normalizedPayments,
        rate: effectiveRate,
        tasaCop: copEnabled ? tasaCop : 0,
        saldoFavorUsd,
        casheaUsd,
        activeMethods: paymentMethods || [],
    });
    if (paymentState.errors.length > 0) {
        return { success: false, error: paymentState.errors[0] };
    }

    const remainingUsd = paymentState.remaining.usd;
    const changeUsd = round2(paymentState.change.totalUsd ?? (
        paymentState.regime === 'PURE_BS' && effectiveRate > 0
            ? divR(paymentState.change.bs, effectiveRate)
            : paymentState.change.usd
    ));
    const changeTotalBs = round2(paymentState.change.totalBs ?? paymentState.change.bs ?? 0);
    const walletChangeCandidate = Number(changeBreakdown?.vueltoParaMonederoUsd ?? 0);
    if (!Number.isFinite(walletChangeCandidate) || walletChangeCandidate < 0) {
        return { success: false, error: 'Monto de abono a cuenta inválido.' };
    }
    const walletChangeUsd = round2(walletChangeCandidate);
    const hasWalletChangeBs = Object.prototype.hasOwnProperty.call(changeBreakdown || {}, 'vueltoParaMonederoBs');
    const walletChangeBsCandidate = hasWalletChangeBs ? Number(changeBreakdown.vueltoParaMonederoBs) : null;
    if (hasWalletChangeBs && (!Number.isFinite(walletChangeBsCandidate) || walletChangeBsCandidate < 0)) {
        return { success: false, error: 'Equivalente en bolívares del abono a cuenta inválido.' };
    }
    const walletChangeBs = hasWalletChangeBs ? round2(walletChangeBsCandidate) : null;

    if (selectedCustomerId && !selectedCustomer) {
        return { success: false, error: 'El cliente seleccionado ya no está disponible.' };
    }
    if (!selectedCustomer && (remainingUsd > 0.01 || casheaUsd > 0 || walletChangeUsd > 0.01)) {
        return {
            success: false,
            error: remainingUsd > 0.01
                ? 'Se requiere cliente para ventas fiadas'
                : casheaUsd > 0
                    ? 'Se requiere cliente para ventas con Cashea'
                    : 'Se requiere cliente para abonar el vuelto a cuenta'
        };
    }
    if (walletChangeUsd > changeUsd + 0.009) {
        return { success: false, error: 'El abono a cuenta excede el vuelto real.' };
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
    const rawChangeOwed = changeBreakdown?.changeOwed || null;
    const owedAmountUsd = Number(rawChangeOwed?.amountUsd) || 0;
    const owedAmountBs = rawChangeOwed && Object.prototype.hasOwnProperty.call(rawChangeOwed, 'amountBs')
        ? Number(rawChangeOwed.amountBs)
        : mulR(owedAmountUsd, effectiveRate);
    // Registrar cómo se aplicó el abono para que una anulación pueda restaurar
    // deuda o saldo a favor sin inferirlo desde el estado posterior del cliente.
    const walletDebtAppliedUsd = selectedCustomer
        ? round2(Math.min(walletChangeUsd, Math.max(0, Number(selectedCustomer.deuda) || 0)))
        : 0;
    const walletFavorAppliedUsd = round2(Math.max(0, subR(walletChangeUsd, walletDebtAppliedUsd)));

    // ── Normalizar payments: asegurar currency y methodLabel ──
    // Esto permite que el FinancialEngine calcule el breakdown correctamente
    // sin depender de campos que podían llegar undefined en versiones anteriores.
    const activeUser = useAuthStore.getState().usuarioActivo;
    const cajeroNombre = activeUser ? (activeUser.nombre || activeUser.usuario || 'Cajero') : null;
    const saleTimestamp = new Date().toISOString();
    const deviceId = typeof localStorage !== 'undefined'
        ? localStorage.getItem('dj_device_id') || 'CAJA_PRINCIPAL'
        : 'CAJA_PRINCIPAL';

    const sale = {
        id: crypto.randomUUID(),
        checkoutOperationId: checkoutOperationId || null,
        tipo: tipoVenta,
        status: 'COMPLETADA',
        cajero: cajeroNombre,
        cajeroId: activeUser?.id || null,
        cajeroRol: activeUser?.rol || 'SYSTEM',
        usuarioId: activeUser?.id || null,
        usuarioNombre: cajeroNombre || 'Sistema',
        usuarioRol: activeUser?.rol || 'SYSTEM',
        actor: {
            id: activeUser?.id || null,
            nombre: cajeroNombre || 'Sistema',
            rol: activeUser?.rol || 'SYSTEM',
        },
        deviceId,
        createdAt: saleTimestamp,
        updatedAt: saleTimestamp,
        items: cart.map(i => {
            const { unitPriceBs: _unitBs } = calculatePricing(i, effectiveRate, bcvRate);
            return {
                id: i.id,
                _originalId: i._originalId || i.id,
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
                // Precios de empaque para recalcular Bs futuro sin depender de la tasa
                boxPriceBs: i.boxPriceBs || null,
                boxPricingMode: i.boxPricingMode || null,
                halfBoxPriceBs: i.halfBoxPriceBs || null,
                halfBoxPricingMode: i.halfBoxPricingMode || null,
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
        paymentRegime: paymentState.regime,
        changeCurrency: paymentState.regime === 'PURE_BS' ? 'BS' : 'USD',
        rate:      effectiveRate,
        bcvRate:   bcvRate,
        tasaCop:   copEnabled ? tasaCop : 0,
        copEnabled: copEnabled,
        rateSource: useAutoRate ? 'BCV Auto' : 'Manual',
        timestamp: saleTimestamp,
        changeUsd: round2(changeBreakdown?.changeUsdGiven || 0),
        changeBs:  round2(changeBreakdown?.changeBsGiven  || 0),
        changeRealUsd: changeUsd,
        changeRealBs: changeTotalBs,
        changeGiven: {
            usd: round2(changeBreakdown?.changeUsdGiven || 0),
            bs:  round2(changeBreakdown?.changeBsGiven  || 0),
        },
        // F7: divergencia Bs-vs-USD de esta venta (redondeo al múltiplo más cercano +
        // precios manuales en Bs). Se persiste para poder sumarla en el cierre: de signo
        // variable por línea, pero el acumulado del turno sí es una cifra auditable.
        bsVsUsdDiffBs: round2(totals.bsVsUsdDiffBs || 0),
        // FIN-012: Guardar el abono y su distribución para revertirlo sin
        // heurísticas al anular una venta.
        vueltoParaMonedero: walletChangeUsd,
        vueltoParaMonederoBs: walletChangeBs ?? 0,
        vueltoParaMonederoCurrency: changeBreakdown?.vueltoParaMonederoCurrency || (paymentState.regime === 'PURE_BS' ? 'BS' : 'USD'),
        vueltoCredito: walletChangeUsd > 0.009 || (walletChangeBs ?? 0) > 0.009,
        vueltoParaMonederoDebtUsd: walletDebtAppliedUsd,
        vueltoParaMonederoFavorUsd: walletFavorAppliedUsd,
        customerId:       selectedCustomerId || null,
        customerName:     selectedCustomer ? selectedCustomer.name : 'Consumidor Final',
        customerDocument: selectedCustomer?.documentId || null,
        customerPhone:    selectedCustomer?.phone      || null,
        fiadoUsd: fiadoAmountUsd,
        casheaUsd: casheaUsd,
        tipDonated: changeBreakdown?.tipDonated || null,
        // FX19-S2: Vuelto que la caja adeuda al cliente por vía externa.
        // Se normaliza y se sella después de validar la partición completa.
        changeOwed: rawChangeOwed,
        // FX19-S3: Voucher textual (no afecta balance)
        changeVoucher: changeBreakdown?.changeVoucher || null,
    };

    // GR-FX19-1: La suma de vuelto dado + adeudado + donado no debe exceder el vuelto real
    const owedAmt = Number(changeBreakdown?.changeOwed?.amountUsd) || 0;
    const tipAmt = Number(changeBreakdown?.tipDonated?.amountUsd) || 0;
    const voucherAmt = Number(changeBreakdown?.changeVoucher?.amountUsd) || 0;
    const invariant = assertCheckoutInvariants({
        changeUsd,
        changeTotalBs,
        rate: effectiveRate,
        changeBreakdown: {
            changeUsdGiven: Number(changeBreakdown?.changeUsdGiven) || 0,
            changeBsGiven: Number(changeBreakdown?.changeBsGiven) || 0,
            changeBsGivenUsd: effectiveRate > 0 ? divR(Number(changeBreakdown?.changeBsGiven) || 0, effectiveRate) : 0,
            walletUsd: walletChangeUsd,
            walletBs: walletChangeBs,
            owedUsd: owedAmt,
            owedBs: owedAmountBs,
            donatedUsd: tipAmt,
            donatedBs: Number(changeBreakdown?.tipDonated?.amountBs) || null,
            voucherUsd: voucherAmt,
            voucherBs: Number(changeBreakdown?.changeVoucher?.amountBs) || null,
        },
        requireComplete: true,
    });
    if (!invariant.valid) return { success: false, error: invariant.error };

    if (rawChangeOwed) {
        const owedValidation = validateChangeOwed({
            ...rawChangeOwed,
            amountUsd: owedAmountUsd,
            amountBs: owedAmountBs,
        }, { rate: effectiveRate });
        if (!owedValidation.valid) return { success: false, error: owedValidation.error };

        sale.changeOwed = {
            amountUsd: owedValidation.amountUsd,
            amountBs: owedValidation.amountBs,
            currency: normalizeChangeCurrency(rawChangeOwed.currency) || sale.changeCurrency,
            method: owedValidation.method,
            note: owedValidation.note,
            reference: owedValidation.note || null,
            status: 'PENDIENTE',
            resolvedAt: null,
            createdAt: saleTimestamp,
            createdBy: {
                id: activeUser?.id || null,
                nombre: cajeroNombre || 'Sistema',
                rol: activeUser?.rol || 'SYSTEM',
            },
        };
    }

    // GR-FX19-3: Coherencia en donación parcial
    if (changeBreakdown?.tipDonated?.partial === true) {
        const physicalUsd = changeBreakdown.tipDonated.physicalGivenUsd || 0;
        const donatedUsd = changeBreakdown.tipDonated.amountUsd || 0;
        const physicalBs = Number(changeBreakdown.tipDonated.physicalGivenBs) || 0;
        const sumCheck = round2(physicalUsd + (effectiveRate > 0 ? divR(physicalBs, effectiveRate) : 0) + donatedUsd);
        if (Math.abs(sumCheck - changeUsd) > 0.009) {
            return { success: false, error: 'FX19-S1: physicalGivenUsd + tipDonated.amountUsd no cuadra con el cambio real.' };
        }
    }

    // Sellar cada destino de vuelto con actor y fecha. Los aliases anteriores
    // siguen presentes para compatibilidad, pero tickets/reportes consumen este
    // libro canónico y no vuelven a inferir la partición desde el total pagado.
    if (sale.changeVoucher) {
        sale.changeVoucher = {
            ...sale.changeVoucher,
            status: sale.changeVoucher.status || 'EMITIDO',
            createdAt: sale.changeVoucher.createdAt || saleTimestamp,
            createdBy: sale.changeVoucher.createdBy || {
                id: activeUser?.id || null,
                nombre: cajeroNombre || 'Sistema',
                rol: activeUser?.rol || 'SYSTEM',
            },
        };
    }
    if (sale.tipDonated) {
        sale.tipDonated = {
            ...sale.tipDonated,
            createdAt: sale.tipDonated.createdAt || saleTimestamp,
            createdBy: sale.tipDonated.createdBy || {
                id: activeUser?.id || null,
                nombre: cajeroNombre || 'Sistema',
                rol: activeUser?.rol || 'SYSTEM',
            },
        };
    }
    sale.changeLedger = getChangeLedger(sale, effectiveRate);
    if (!sale.changeLedger.balanced) {
        return { success: false, error: 'La partición final del vuelto no cuadra con el vuelto real.' };
    }

    // FIN-008: deepFreeze en lugar de Object.freeze (congela items[] y payments[]).
    deepFreeze(sale);

    // FIN-007: withLock reemplaza navigator.locks.request directo (feature detection + fallback).
    const lockResult = await withLock('pos_write_lock', async () => {
        const existingSales = await storageService.getItem(SALES_KEY, []);
        if (checkoutOperationId) {
            const duplicate = existingSales.find(s => s.checkoutOperationId === checkoutOperationId);
            if (duplicate) {
                // El reintento debe devolver el estado persistido, no los arrays
                // capturados antes del primer intento (podrían reintroducir stock
                // viejo en React después de una respuesta duplicada).
                const freshProducts = await storageService.getItem(PRODUCTS_KEY, products) || products;
                const freshCustomers = await storageService.getItem(CUSTOMERS_KEY, customers) || customers;
                return {
                    success: true,
                    sale: duplicate,
                    updatedProducts: freshProducts,
                    updatedCustomers: freshCustomers,
                    duplicate: true
                };
            }
        }
        const saleNumber = existingSales.reduce((mx, s) => Math.max(mx, s.saleNumber || 0), 0) + 1;

        // Capturar la composición física con el catálogo vigente antes de
        // persistir la venta. La anulación usa esta fotografía y no vuelve a
        // interpretar un combo que pudo haber sido editado después.
        const freshProducts = await storageService.getItem(PRODUCTS_KEY, products) || products;
        const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';
        const expanded = expandCartToPhysicalDeductions(cart, freshProducts);
        const physicalDeductions = aggregatePhysicalDeductions(expanded.deductions);

        // FIN-008: deep-freeze el sale persistido final.
        const finalPersistedSale = deepFreeze({
            ...sale,
            saleNumber,
            inventoryDeductions: physicalDeductions,
            inventoryDeductionsApplied: [],
            inventoryAnomalies: expanded.anomalies
        });

        // Audit log
        const user = useAuthStore.getState().usuarioActivo;
        const tipo = casheaUsd > 0 ? 'VENTA_CASHEA' : (fiadoAmountUsd > 0 ? 'VENTA_FIADA' : 'VENTA_COMPLETADA');
        logEvent('VENTA', tipo,
            `Venta #${saleNumber} - $${round2(cartTotalUsd)} - ${cart.length} items - ${selectedCustomer?.name || 'Consumidor Final'}`,
            user,
            {
                saleId: finalPersistedSale.id,
                total: cartTotalUsd,
                items: cart.length,
                vueltoCredito: walletChangeUsd > 0.009,
                vueltoParaMonederoUsd: walletChangeUsd,
                vueltoParaMonederoDebtUsd: walletDebtAppliedUsd,
                vueltoParaMonederoFavorUsd: walletFavorAppliedUsd,
                changeGiven: finalPersistedSale.changeGiven,
                changeOwed: finalPersistedSale.changeOwed
                    ? {
                        amountUsd: finalPersistedSale.changeOwed.amountUsd,
                        amountBs: finalPersistedSale.changeOwed.amountBs,
                        method: finalPersistedSale.changeOwed.method,
                        reference: finalPersistedSale.changeOwed.reference,
                        status: finalPersistedSale.changeOwed.status,
                    }
                    : null,
            }
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
        // La expansión se calculó dentro del mismo lock y quedó guardada en la
        // venta como inventoryDeductions para que la devolución sea idéntica.
        // Una ficha diferida pudo haber descontado su entrega inicial antes de
        // llegar aquí; volver a leer evita devolver un snapshot obsoleto al UI.
        const productsAfterDeferred = await storageService.getItem(PRODUCTS_KEY, freshProducts) || freshProducts;
        let negativeStockUsed = false;
        const negativeItems = [];
        if (expanded.anomalies.length > 0) {
            logEvent('INVENTARIO', 'ANOMALIA_MOVIMIENTO',
                `Venta #${saleNumber} contiene ${expanded.anomalies.length} anomalía(s) de expansión física`,
                useAuthStore.getState().usuarioActivo,
                { saleId: finalPersistedSale.id, anomalies: expanded.anomalies }
            );
        }

        // ── GUARDARRAÍL WAL: Write-Ahead Log de Venta antes de mutaciones de inventario ──
        try {
            const journal = await storageService.getItem(SALES_JOURNAL_KEY, []) || [];
            const journalEntry = {
                journalId: `wal_${finalPersistedSale.id}`,
                saleId: finalPersistedSale.id,
                saleNumber,
                timestamp: saleTimestamp,
                checkoutOperationId: checkoutOperationId || null,
                totalUsd: cartTotalUsd,
                totalBs: cartTotalBs,
                tipo: tipoVenta,
                cajero: cajeroNombre,
                saleSnapshot: finalPersistedSale,
                status: 'COMMITTED_INTENT'
            };
            const updatedJournal = [journalEntry, ...journal.filter(j => j.saleId !== finalPersistedSale.id)].slice(0, 500);
            await storageService.setItem(SALES_JOURNAL_KEY, updatedJournal);
        } catch (walErr) {
            console.warn('[checkoutProcessor] Error al escribir en Sales WAL Journal:', walErr);
        }

        let updatedProducts = productsAfterDeferred;
        let inventoryOperation = { success: true, pending: false, transitions: [], movements: [] };
        if (physicalDeductions.length > 0) {
            inventoryOperation = await applyInventoryOperationUnlocked({
                operationId: `sale_${finalPersistedSale.id}`,
                referenceId: finalPersistedSale.id,
                referenceType: 'VENTA',
                source: 'POS_CHECKOUT',
                tipo: 'VENTA',
                subtipo: 'POS_CHECKOUT',
                reason: `Venta #${saleNumber}`,
                allowNegative: allowNeg,
                actor: {
                    usuarioId: activeUser?.id || null,
                    usuarioNombre: activeUser?.nombre || 'Cajero',
                    usuarioRol: activeUser?.rol || 'SYSTEM',
                },
                deductions: physicalDeductions,
                productsFallback: freshProducts,
                metadata: {
                    saleId: finalPersistedSale.id,
                    saleNumber,
                    checkoutOperationId: checkoutOperationId || null
                }
            });
            updatedProducts = inventoryOperation.updatedProducts || freshProducts;
        }

        // ── Consolidar deducciones aplicadas y persistir la venta de forma atómica ──
        let appliedInventoryDeductions = [];
        if (physicalDeductions.length > 0 && inventoryOperation.success) {
            appliedInventoryDeductions = (inventoryOperation.transitions || [])
                .filter(transition => Number(transition.cantidad) !== 0)
                .map(transition => ({
                    productoId: transition.productoId,
                    cantidad: transition.cantidad,
                    cantidadSolicitada: transition.cantidadSolicitada,
                    unidad: transition.unidad,
                    origen: transition.origen,
                    metadata: transition.metadata
                }));
        }

        const saleForResult = deepFreeze({
            ...finalPersistedSale,
            inventoryDeductionsApplied: appliedInventoryDeductions,
            inventoryOperationId: inventoryOperation.operationId || null
        });

        // Releer lista fresca dentro del lock para evitar pisar cualquier operación concurrente
        const freshSalesList = await storageService.getItem(SALES_KEY, existingSales) || existingSales;
        const updatedSales = [saleForResult, ...freshSalesList.filter(item => item.id !== saleForResult.id)];
        await storageService.setItem(SALES_KEY, updatedSales);

        try {
            const MIRROR_KEY = 'bodega_sales_mirror_v1';
            const mirrorSales = await storageService.getItem(MIRROR_KEY, []) || [];
            const updatedMirror = [saleForResult, ...mirrorSales.filter(item => item.id !== saleForResult.id)];
            await storageService.setItem(MIRROR_KEY, updatedMirror);
        } catch (mirrorErr) {
            console.warn('[checkoutProcessor] Error al actualizar composición aplicada en espejo:', mirrorErr);
        }

        // Sellar estado COMPLETED en WAL Journal
        try {
            const journal = await storageService.getItem(SALES_JOURNAL_KEY, []) || [];
            const entryIndex = journal.findIndex(j => j.saleId === finalPersistedSale.id);
            if (entryIndex !== -1) {
                journal[entryIndex] = { ...journal[entryIndex], status: 'COMPLETED', completedAt: new Date().toISOString() };
                await storageService.setItem(SALES_JOURNAL_KEY, journal);
            }
        } catch (walCompleteErr) {
            console.warn('[checkoutProcessor] Error al marcar COMPLETED en Sales WAL Journal:', walCompleteErr);
        }

        // FIN-014: auditar uso de stock negativo y cantidades limitadas por clamp.
        for (const transition of inventoryOperation.transitions || []) {
            if (transition.negativeStockUsed && allowNeg) {
                negativeStockUsed = true;
                negativeItems.push({
                    productId: transition.productoId,
                    name: transition.productoNombre,
                    stockBefore: transition.stockAntes,
                    deducted: transition.cantidad,
                    stockAfter: transition.stockDespues
                });
            }
        }

        if (negativeStockUsed) {
            const user = useAuthStore.getState().usuarioActivo;
            logEvent('CONFIG', 'NEGATIVE_STOCK_USED',
                `Venta #${saleNumber} usó stock negativo en ${negativeItems.length} producto(s)`,
                user,
                { saleId: finalPersistedSale.id, items: negativeItems }
            );
        }

        // FIN-008: deep-freeze products antes de retornar.
        deepFreeze(updatedProducts);

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
                vueltoParaMonedero: walletChangeUsd,
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
            sale: saleForResult,
            updatedProducts,
            updatedCustomers,
            inventoryPending: inventoryOperation.pending === true,
            inventoryError: inventoryOperation.error || null,
            inventoryOperationId: inventoryOperation.operationId || null
        };
    });

    return lockResult;
}
