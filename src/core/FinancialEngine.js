/**
 * FinancialEngine.js
 *
 * Centralized, pure-function mathematical engine for POS calculations.
 * ALL financial logic across the app (profits, totals, discounts, breakdowns)
 * MUST route through these functions to guarantee 100% mathematical integrity
 * and shield against UI-side modifications.
 *
 * v2.1 — FIN-FIXES:
 *   - FIN-002: Apertura COP entra al breakdown de efectivo_cop.
 *   - FIN-003: No fallback mágico a tasaCop=1 para ventas legacy (skip + flag).
 *   - FIN-004: VENTA_FIADA usa sale.fiadoUsd y NO hace return; procesa pagos reales.
 *   - FIN-005: Anomalías de vuelto se devuelven en array (no se muta sale).
 *   - FIN-010: buildCartTotals.totalCop usa divR + round2 consistentemente.
 *   - FIN-011: calculateSaleProfit acepta Map<id, product> opcional (4to arg).
 */

import { round2, mulR, divR, subR, sumR } from '../utils/dinero';
import { FINANCIAL_EPSILON } from '../utils/securityConstants';
import { calculatePricing } from '../utils/productProcessor';

// ── Labels de métodos de pago de fábrica (lookup puro, sin async) ──
// Resuelve el nombre legible de un methodId sin necesitar el módulo async.
const FACTORY_LABELS = {
    efectivo_bs:       'Efectivo Bs',
    pago_movil:        'Pago Móvil',
    punto_venta:       'Punto de Venta',
    efectivo_usd:      'Efectivo $',
    efectivo_cop:      'Efectivo COP',
    transferencia_cop: 'Transferencia COP',
    saldo_favor:       'Saldo a Favor',
    fiado:             'Fiado (Por Cobrar)',
    cashea:            'Cashea (Por Cobrar)',
};

function _resolveMethodLabel(methodId) {
    if (!methodId) return 'Método Desconocido';
    if (FACTORY_LABELS[methodId]) return FACTORY_LABELS[methodId];
    if (methodId.startsWith('custom_')) return 'Método Personalizado';
    // Fallback: snake_case → Title Case
    return methodId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// FIN-011: Helpers para construir/consultar Map<id, product> (O(1) lookup).
function _buildProductsMap(products) {
    const map = new Map();
    if (!Array.isArray(products)) return map;
    for (const p of products) {
        if (!p) continue;
        if (p.id != null && !map.has(p.id)) map.set(p.id, p);
        if (p.name != null && !map.has(p.name)) map.set(p.name, p);
    }
    return map;
}

function _lookupProduct(map, item) {
    if (!map || !(map instanceof Map) || !item) return null;
    if (item.id != null && map.has(item.id)) return map.get(item.id);
    if (item._originalId != null && map.has(item._originalId)) return map.get(item._originalId);
    if (item.name != null && map.has(item.name)) return map.get(item.name);
    return null;
}

export class FinancialEngine {

    /**
     * Calculates the true net profit of a single sale.
     * Subtracts the global cart discount and evaluates margin per item.
     *
     * @param {Object} sale - The sale object from database
     * @param {number} bcvRate - The active BCV rate for fallback comparisons
     * @param {Array} products - The global product dictionary to resolve unknown costs
     * @param {Map} [productsMap] - Optional pre-built Map<id|name, product> for O(1) lookup (FIN-011).
     *                              If not provided, the array is indexed on every call (O(n) per item).
     * @returns {number} Net Profit in Bs.
     */
    static calculateSaleProfit(sale, bcvRate, products, productsMap) {
        if (!sale || !sale.items || sale.items.length === 0) return 0;

        const saleRate = sale.rate || bcvRate;
        // FIN-011: usar Map si viene, si no construirlo una sola vez por call.
        const pMap = (productsMap instanceof Map)
            ? productsMap
            : _buildProductsMap(products);

        // Sum the profit of each individual item (Revenue - Cost)
        const itemProfits = sale.items.map(item => {
            let costBs = 0;

            if (item.costUsd) {
                costBs = mulR(item.costUsd, saleRate);
            } else if (item.costBs) {
                costBs = round2(item.costBs);
            } else {
                // Fallback: Resolve cost dynamically — O(1) con Map, O(n) sin él.
                const p = _lookupProduct(pMap, item);
                if (p) {
                    costBs = p.costUsd ? mulR(p.costUsd, saleRate) : round2(p.costBs || 0);
                    if (item.id && typeof item.id === 'string' && item.id.endsWith('_unit')) {
                        costBs = divR(costBs, (p.unitsPerPackage || 1));
                    }
                }
            }

            // Revenue = exact subtotalBs saved if available, else price * qty * rate
            const itemRevenueBs = item.subtotalBs != null && item.subtotalBs > 0
                ? round2(item.subtotalBs)
                : mulR(mulR(item.priceUsd, item.qty), saleRate);
            const itemCostBs = mulR(costBs, item.qty);
            return subR(itemRevenueBs, itemCostBs);
        });

        const itemsProfit = sumR(itemProfits);

        // Subtract the global cart discount spread (represented in Bs)
        const discountBs = mulR((sale.discountAmountUsd || 0), saleRate);

        return subR(itemsProfit, discountBs);
    }

    /**
     * Aggregates total profit for an array of sales.
     * FIN-011: builds the products Map once for the whole array (was O(K·N·M), now O(N + K·M)).
     */
    static calculateAggregateProfit(salesArray, bcvRate, products) {
        if (!Array.isArray(salesArray) || salesArray.length === 0) return 0;
        const pMap = _buildProductsMap(products);
        const profits = salesArray.map(sale => this.calculateSaleProfit(sale, bcvRate, products, pMap));
        return sumR(profits);
    }

    /**
     * Integrates opening float (_apertura), change given (_vuelto_*), and gross cash receipts (efectivo_*)
     * into a single unified expected cash amount per currency.
     *
     * @param {Object} breakdown - Breakdown produced by calculatePaymentBreakdown
     * @returns {{ bs: number, usd: number, cop: number }} Expected physical cash in drawer per currency
     */
    static computeExpectedCash(breakdown) {
        if (!breakdown || typeof breakdown !== 'object') return { bs: 0, usd: 0, cop: 0 };

        const aperturaUsd = round2(breakdown['_apertura']?.openingUsd || breakdown['_apertura']?.usd || 0);
        const aperturaBs  = round2(breakdown['_apertura']?.openingBs  || breakdown['_apertura']?.bs  || 0);
        const aperturaCop = round2(breakdown['_apertura']?.openingCop || breakdown['_apertura']?.cop || 0);

        const brutoUsd = round2(breakdown['efectivo_usd']?.total || 0);
        const brutoBs  = round2(breakdown['efectivo_bs']?.total || 0);
        const brutoCop = round2(breakdown['efectivo_cop']?.total || 0);

        const vueltoUsd = round2(breakdown['_vuelto_usd']?.total || 0);
        const vueltoBs  = round2(breakdown['_vuelto_bs']?.total || 0);
        const vueltoCop = round2(breakdown['_vuelto_cop']?.total || 0);

        return {
            usd: round2(aperturaUsd + brutoUsd - vueltoUsd),
            bs:  round2(aperturaBs + brutoBs - vueltoBs),
            cop: round2(aperturaCop + brutoCop - vueltoCop)
        };
    }

    /**
     * Calculates the breakdown of payments received across multiple sales,
     * deducting the change returned (`changeUsd` or `changeBs`) to find the True Net Receipts.
     *
     * @param {Array} salesArray - Array of sales to aggregate
     * @param {{ withAnomalies?: boolean }} [opts] - If true, returns { breakdown, anomalies } (FIN-005).
     * @returns {Object|{ breakdown: Object, anomalies: Array }}
     */
    static calculatePaymentBreakdown(salesArray, opts = {}) {
        const breakdown = {};
        // FIN-005: Collect anomalies in a side array instead of mutating sale objects.
        const anomalies = [];

        salesArray.forEach(sale => {
            // ── APERTURA DE CAJA: store opening float in _apertura metadata bucket (not as revenue or payment method) ──
            if (sale.tipo === 'APERTURA_CAJA') {
                if (!breakdown['_apertura']) breakdown['_apertura'] = { openingBs: 0, openingUsd: 0, openingCop: 0, isApertura: true };
                if (sale.openingUsd > 0) {
                    breakdown['_apertura'].openingUsd = round2(breakdown['_apertura'].openingUsd + round2(sale.openingUsd));
                }
                if (sale.openingBs > 0) {
                    breakdown['_apertura'].openingBs = round2(breakdown['_apertura'].openingBs + round2(sale.openingBs));
                }
                if (sale.openingCop > 0) {
                    breakdown['_apertura'].openingCop = round2(breakdown['_apertura'].openingCop + round2(sale.openingCop));
                }
                return; // Do NOT count opening float as sales revenue or payment method receipts
            }

            // ── GASTO_INTERNO: egreso de caja chica (o autoconsumo inofensivo para la caja) ──
            if (sale.tipo === 'GASTO_INTERNO') {
                if (!sale.afectaCaja) return; // Autoconsumo: no afecta arqueo de caja física

                if (sale.payments && sale.payments.length > 0) {
                    sale.payments.forEach(p => {
                        if (!breakdown[p.methodId]) {
                            const resolvedLabel = (p.methodLabel && p.methodLabel !== p.methodId)
                                ? p.methodLabel
                                : _resolveMethodLabel(p.methodId);
                            breakdown[p.methodId] = {
                                total: 0,
                                currency: p.currency || 'BS',
                                label: resolvedLabel
                            };
                        }
                        let val = 0;
                        if (p.currency === 'USD') val = p.amountUsd;
                        else if (p.currency === 'BS') val = p.amountBs;
                        else if (p.currency === 'COP') val = p.amountCop || p.amountBs;

                        const valToDeduct = val < 0 ? val : -Math.abs(val);
                        breakdown[p.methodId].total = round2(breakdown[p.methodId].total + round2(valToDeduct));
                    });
                } else {
                    const method = sale.paymentMethod || 'efectivo_bs';
                    let currency = 'BS';
                    let valToDeduct = -Math.abs(sale.totalBs || 0);

                    if (method.includes('usd') || method.includes('zelle') || method.includes('binance')) {
                        currency = 'USD';
                        valToDeduct = -Math.abs(sale.totalUsd || 0);
                    } else if (method.includes('cop')) {
                        currency = 'COP';
                        valToDeduct = -Math.abs(sale.totalCop || 0);
                    }

                    if (!breakdown[method]) {
                        breakdown[method] = { total: 0, currency: currency, label: _resolveMethodLabel(method) };
                    }
                    breakdown[method].total = round2(breakdown[method].total + round2(valToDeduct));
                }
                return;
            }

            // Fiado sales: bucket "fiado" tracks the *outstanding debt* generated (fiadoUsd),
            // NOT the total sale (which may have partial real payments).
            // FIN-004: usar sale.fiadoUsd || sale.totalUsd para ventas legacy sin fiadoUsd.
            if (sale.tipo === 'VENTA_FIADA') {
                if (!breakdown['fiado']) {
                    breakdown['fiado'] = { total: 0, currency: 'FIADO', label: 'Fiado (Por Cobrar)' };
                }
                const fiadoAmount = round2(sale.fiadoUsd != null ? sale.fiadoUsd : (sale.totalUsd || 0));
                breakdown['fiado'].total = round2(breakdown['fiado'].total + fiadoAmount);
            }

            // Cashea sales: bucket "cashea" tracks the cashea financed amount
            if (sale.tipo === 'VENTA_CASHEA' || (sale.casheaUsd && sale.casheaUsd > 0)) {
                if (!breakdown['cashea']) {
                    breakdown['cashea'] = { total: 0, currency: 'FIADO', label: 'Cashea (Por Cobrar)' };
                }
                const casheaAmount = round2(sale.casheaUsd || 0);
                if (casheaAmount > 0) {
                    breakdown['cashea'].total = round2(breakdown['cashea'].total + casheaAmount);
                }
            }

            // Debt collection reduces the outstanding fiado balance for the period (using USD to prevent exchange rate drift)
            if (sale.tipo === 'COBRO_DEUDA') {
                if (!breakdown['fiado']) {
                    breakdown['fiado'] = { total: 0, currency: 'FIADO', label: 'Fiado (Por Cobrar)' };
                }
                breakdown['fiado'].total = round2(breakdown['fiado'].total - round2(sale.totalUsd || 0));
                // Continue execution below to register the actual cash/transfer received
            }

            if (!sale.payments || sale.payments.length === 0) {
                // Si la venta es VENTA_FIADA o VENTA_CASHEA y NO tiene payments (es decir, fue 100% fiada o a crédito),
                // NO se debe sumar sale.totalBs al bucket de efectivo_bs u otros métodos legacy.
                if (sale.tipo === 'VENTA_FIADA' || sale.tipo === 'VENTA_CASHEA') {
                    const fiadoAmount = round2(sale.fiadoUsd != null ? sale.fiadoUsd : (sale.casheaUsd != null ? sale.casheaUsd : (sale.totalUsd || 0)));
                    const remainingUpfrontUsd = round2(subR(sale.totalUsd || 0, fiadoAmount));
                    if (remainingUpfrontUsd <= 0.009) {
                        return; // 100% a crédito/fiado, no hay pago al contado que sumar
                    }
                }

                // V1 Legacy Sales & Cobro Deudas
                const method = sale.paymentMethod || 'efectivo_bs';
                let currency = 'BS';
                let valueToSum = round2(sale.totalBs || 0);

                if (method.includes('usd') || method.includes('zelle') || method.includes('binance')) {
                    currency = 'USD';
                    valueToSum = round2(sale.totalUsd || 0);
                } else if (method.includes('cop')) {
                    currency = 'COP';
                    valueToSum = round2(sale.totalCop || 0);
                }

                if (!breakdown[method]) {
                    breakdown[method] = { total: 0, currency: currency, label: _resolveMethodLabel(method) };
                }
                breakdown[method].total = round2(breakdown[method].total + valueToSum);
            } else {
                // Aggregate incoming payments (V2 sales)
                sale.payments.forEach(p => {
                    if (p.methodId === 'fiado' || p.methodId === 'cashea') return;

                    if (!breakdown[p.methodId]) {
                        const resolvedLabel = (p.methodLabel && p.methodLabel !== p.methodId)
                            ? p.methodLabel
                            : _resolveMethodLabel(p.methodId);

                        breakdown[p.methodId] = {
                            total: 0,
                            currency: p.currency || 'BS',
                            label: resolvedLabel
                        };
                    }

                    const saleRate = sale.rate || (sale.payments?.[0]?.amountUsd ? divR(sale.payments?.[0]?.amountBs, sale.payments?.[0]?.amountUsd) : 1) || 1;
                    const amountUsd = p.amountUsd !== undefined
                        ? round2(p.amountUsd)
                        : (p.currency === 'USD' ? round2(p.amount) : divR(p.amount, saleRate));
                    const amountBs = p.amountBs !== undefined
                        ? round2(p.amountBs)
                        : (p.currency === 'BS' ? round2(p.amount) : mulR(p.amount, saleRate));

                    if (p.currency === 'USD') {
                        breakdown[p.methodId].total = round2(breakdown[p.methodId].total + amountUsd);
                    } else if (p.currency === 'COP') {
                        // FIN-003: Ventas legacy sin tasaCop → fallback a `1` subestimaba COP por ~4000x.
                        // Si no hay tasaCop, NO sumamos al bucket COP (mejor ausente que mal).
                        // Registramos la anomalía para auditoría.
                        if (!sale.tasaCop || sale.tasaCop <= 0) {
                            anomalies.push({
                                saleId: sale.id,
                                type: 'TASA_COP_MISSING',
                                message: `Venta ${sale.id || '(sin id)'} con pago COP pero sin tasaCop; COP no contabilizado.`,
                                severity: 'warning'
                            });
                            // Sumamos al bucket en USD para que el pago NO desaparezca del flujo.
                            breakdown[p.methodId].total = round2(breakdown[p.methodId].total + amountUsd);
                        } else {
                            const copAmount = mulR(amountUsd, sale.tasaCop);
                            breakdown[p.methodId].total = round2(breakdown[p.methodId].total + copAmount);
                        }
                    } else {
                        breakdown[p.methodId].total = round2(breakdown[p.methodId].total + amountBs);
                    }
                });
            }

            // Deduct outgoing change to find True Net Income
            let safeChangeUsd = sale.changeGiven ? round2(sale.changeGiven.usd || 0) : round2(sale.changeUsd || 0);
            let safeChangeBs  = sale.changeGiven ? round2(sale.changeGiven.bs  || 0) : round2(sale.changeBs  || 0);

            // GR-7b: COP guardrail
            const copEnabledInSale = sale.copEnabled === true;
            const hasCopPayment = (sale.payments || []).some(p => p.currency === 'COP' || (p.methodId && p.methodId.includes('cop')));
            const hasCopChange = (sale.changeGiven?.cop > 0) || (sale.changeCop > 0);
            if (!copEnabledInSale && (hasCopPayment || hasCopChange)) {
                anomalies.push({
                    saleId: sale.id,
                    type: 'UNSUPPORTED_COP_PAYMENT',
                    severity: 'warning',
                    message: `Anomalía COP en venta ${sale.id || '(sin id)'}: pago/vuelto en COP detectado con copEnabled=false`
                });
            }

            // ── ANOMALY DETECTION (FIN-005): collect into array, no mutation of sale ──
            const saleRateForAnomaly = sale.rate
                || (sale.payments?.[0]?.amountBs && sale.payments?.[0]?.amountUsd
                    ? divR(sale.payments[0].amountBs, sale.payments[0].amountUsd)
                    : 1);
            const saleTotalUsd = round2(sale.totalUsd || 0);
            const saleTotalBs = round2(sale.totalBs || 0);
            // FIN-005: Umbrales centralizados en securityConstants.
            const isChangeAnomalousUsd =
                safeChangeUsd > FINANCIAL_EPSILON.CHANGE_ANOMALY_MIN_USD
                && safeChangeUsd > mulR(saleTotalUsd, FINANCIAL_EPSILON.CHANGE_ANOMALY_MULTIPLIER);
            const isChangeAnomalousBs =
                safeChangeBs > mulR(FINANCIAL_EPSILON.CHANGE_ANOMALY_MIN_BS_FACTOR, saleRateForAnomaly)
                && safeChangeBs > mulR(saleTotalBs, FINANCIAL_EPSILON.CHANGE_ANOMALY_MULTIPLIER);

            if (isChangeAnomalousUsd || isChangeAnomalousBs) {
                anomalies.push({
                    saleId: sale.id,
                    type: 'CHANGE_ANOMALY',
                    severity: 'warning',
                    changeUsd: safeChangeUsd,
                    changeBs: safeChangeBs,
                    totalUsd: saleTotalUsd,
                    totalBs: saleTotalBs,
                    message: `Anomalía de vuelto en venta ${sale.id || '(sin id)'}: changeUsd=${safeChangeUsd}, changeBs=${safeChangeBs}, totalUsd=${saleTotalUsd}`
                });
            }

            // If the sale was completely free/zero, any outgoing change is a glitch
            if (saleTotalUsd === 0 && saleTotalBs === 0) {
                safeChangeUsd = 0;
                safeChangeBs = 0;
            }

            if (safeChangeUsd > 0) {
                if (!breakdown['_vuelto_usd']) breakdown['_vuelto_usd'] = { total: 0, currency: 'USD', label: 'Vuelto En $ Entregado', isChange: true };
                breakdown['_vuelto_usd'].total = round2(breakdown['_vuelto_usd'].total + safeChangeUsd);
            }
            if (safeChangeBs > 0) {
                if (!breakdown['_vuelto_bs']) breakdown['_vuelto_bs'] = { total: 0, currency: 'BS', label: 'Vuelto En Bs Entregado', isChange: true };
                breakdown['_vuelto_bs'].total = round2(breakdown['_vuelto_bs'].total + safeChangeBs);
            }
        });

        // Final pass: round all totals strictly and filter out zeroes (preserving metadata buckets starting with _)
        const finalBreakdown = {};
        Object.keys(breakdown).forEach(k => {
            if (k.startsWith('_')) {
                finalBreakdown[k] = { ...breakdown[k] };
                if (typeof breakdown[k].total === 'number') {
                    finalBreakdown[k].total = round2(breakdown[k].total);
                }
                return;
            }
            const roundedTotal = round2(breakdown[k].total);
            if (roundedTotal !== 0) {
                finalBreakdown[k] = { ...breakdown[k], total: roundedTotal };
            }
        });

        if (opts.withAnomalies) {
            return { breakdown: finalBreakdown, anomalies };
        }
        return finalBreakdown;
    }

    /**
     * Generates standard Checkout Cart Totals (Gross -> Discount -> Net -> Bs / COP equivalent)
     * Used exclusively BEFORE persisting a sale.
     *
     * @param {Array} cartItems - Array of live cart items
     * @param {Object} discountData - { type: 'percentage'|'fixed', value: number }
     * @param {number} bcvRate - Exchange rate (global effective rate)
     * @param {number} copRate - USD to COP Exchange rate
     * @param {number} realBcvRate - Real official BCV rate
     * @returns {Object} Complete financial summary for the receipt.
     */
    static buildCartTotals(cartItems, discountData, bcvRate, copRate = 0, realBcvRate = 0, bsRoundingStep = null) {
        // USD: suma directa e independiente de priceUsd (redondear cada línea antes de sumar).
        const lineItemsUsd = cartItems.map(item => mulR(item.priceUsd, item.qty));
        const subtotalUsd = sumR(lineItemsUsd);

        // Bs: usa calculatePricing para respetar bs_fijo, bcv, dual_usd, tasa_dia y alineación canónica
        const lineItemsBs = cartItems.map(item => {
            const { unitPriceBs } = calculatePricing(item, bcvRate, realBcvRate, null, bsRoundingStep);
            return mulR(unitPriceBs, item.qty);
        });
        const subtotalBs = sumR(lineItemsBs);

        let discountAmountUsd = 0;
        if (discountData && discountData.value > 0) {
            if (discountData.type === 'percentage') {
                discountAmountUsd = mulR(subtotalUsd, divR(discountData.value, 100));
            } else if (discountData.type === 'fixed') {
                discountAmountUsd = round2(discountData.value);
            }
        }

        if (discountAmountUsd > subtotalUsd) discountAmountUsd = subtotalUsd;

        const totalUsd = round2(Math.max(0, subR(subtotalUsd, discountAmountUsd)));

        let discountAmountBs = 0;
        if (discountAmountUsd > 0 && subtotalUsd > 0) {
            discountAmountBs = sumR(cartItems.map((item, idx) => {
                const itemRate = item.forceBcv ? (realBcvRate || bcvRate) : bcvRate;
                const itemUsd = lineItemsUsd[idx];
                const proportion = divR(itemUsd, subtotalUsd);
                const itemDiscountUsd = mulR(discountAmountUsd, proportion);
                return mulR(itemDiscountUsd, itemRate);
            }));
        } else {
            discountAmountBs = mulR(discountAmountUsd, bcvRate);
        }

        const totalBs = round2(Math.max(0, subR(subtotalBs, discountAmountBs)));

        // FIN-010: totalCop unificado — divR para descuento proporcional, round2 consistente.
        const allItemsHaveCop = cartItems.every(i => i.priceCop != null && i.priceCop > 0);
        const totalCop = copRate > 0
            ? (allItemsHaveCop
                ? round2(mulR(
                    sumR(cartItems.map(i => mulR(i.priceCop, i.qty))),
                    subR(1, divR(discountAmountUsd, (subtotalUsd || 1)))
                ))
                : mulR(totalUsd, copRate))
            : 0;

        // ── F7: divergencia entre lo cobrado en Bs y la conversión directa desde USD ──
        // Con redondeo al múltiplo más cercano (política D-2) esta diferencia es de signo
        // variable: `45 → 50` suma, `44 → 40` resta. Hasta ahora no se contabilizaba en
        // ninguna parte, así que era dinero real sin cuenta contable donde caer.
        //
        // OJO con el nombre: NO es sólo redondeo. Incluye también los precios manuales en
        // Bs (`bs_fijo`), que divergen de la tasa a propósito. Se llama por lo que contiene
        // — la divergencia Bs-vs-USD — y no "diferencial de redondeo", que sería engañoso
        // en un carrito con precios manuales. Para el arqueo lo que importa es el
        // ACUMULADO del turno, no el de cada línea.
        const bsVsUsdDiffBs = bcvRate > 0
            ? round2(subR(totalBs, mulR(totalUsd, bcvRate)))
            : 0;

        return {
            subtotalUsd,
            subtotalBs,
            discountAmountUsd,
            discountAmountBs,
            totalUsd,
            totalBs,
            totalCop,
            bsVsUsdDiffBs
        };
    }
}
