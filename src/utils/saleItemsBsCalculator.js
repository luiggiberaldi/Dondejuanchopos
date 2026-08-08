import { calculatePricing } from './productProcessor';
import { sumR, mulR, round2 } from './dinero';

/**
 * Calcula el monto actual en Bolívares (Bs) de los ítems de una venta fiada
 * utilizando el catálogo actual de productos del sistema (products) y
 * las reglas de precio canónicas de la aplicación (calculatePricing).
 * 
 * @param {Array} saleItems - Lista de ítems registrados en la venta fiada
 * @param {Array} [products=[]] - Catálogo de productos actual del sistema (opcional)
 * @param {number} [effectiveRate=0] - Tasa de cambio efectiva global (tasa_dia)
 * @param {number} [bcvRate=0] - Tasa oficial BCV
 * @param {number} [bsRoundingStep=10] - Paso de redondeo en Bs (default 10)
 * @returns {{ totalBs: number, isEstimated: boolean }} Objeto con el total en Bs y flag de estimación por fallback
 */
export function getSaleCurrentBsTotal(saleItems, products = [], effectiveRate = 0, bcvRate = 0, bsRoundingStep = 10) {
    // Compatibilidad hacia atrás si los argumentos se pasan sin el parámetro `products`
    if (typeof products === 'number') {
        bsRoundingStep = bcvRate || 10;
        bcvRate = effectiveRate;
        effectiveRate = products;
        products = [];
    }

    if (!Array.isArray(saleItems) || saleItems.length === 0) {
        return { totalBs: 0, isEstimated: true };
    }

    let isEstimated = false;
    const itemBsTotals = saleItems.map(item => {
        if (!item) return 0;

        const qty = Number(item.qty ?? item.quantity ?? 1);
        if (isNaN(qty) || qty <= 0) return 0;

        let formatMode = item._mode || item.mode || 'unit';
        const itemNameLower = (item.name || '').toLowerCase();

        // Detección automática del formato de empaque desde el nombre si el ítem no lo especifica explícitamente
        if (formatMode === 'unit') {
            if (itemNameLower.includes('(caja)') || itemNameLower.includes(' caja')) {
                formatMode = 'box';
            } else if (itemNameLower.includes('(½ caja)') || itemNameLower.includes('½ caja') || itemNameLower.includes('1/2 caja')) {
                formatMode = 'halfBox';
            }
        }

        // 1. Buscar coincidencia en el catálogo actual de productos (products)
        let matchingProduct = null;
        if (Array.isArray(products) && products.length > 0) {
            const targetId = item._originalId || item.id || item.productId;
            if (targetId) {
                matchingProduct = products.find(p => String(p.id) === String(targetId));
            }
            if (!matchingProduct && item.name) {
                // Limpiar sufijo del nombre (ej. "Cerveza Polar Light (Caja)" -> "Cerveza Polar Light")
                const cleanName = item.name.replace(/\s*\((caja|½ caja|1\/2 caja)\)/i, '').trim().toLowerCase();
                matchingProduct = products.find(p => p.name && p.name.trim().toLowerCase() === cleanName);
                // Si tampoco, buscar por priceUsd exacto (último recurso para modo box)
                if (!matchingProduct && item.priceUsd > 0 && formatMode === 'box') {
                    matchingProduct = products.find(p =>
                        p.sellByBox &&
                        p.boxPriceUsd > 0 &&
                        Math.abs(Number(p.boxPriceUsd) - Number(item.priceUsd)) < 0.01
                    );
                }
                if (!matchingProduct && item.priceUsd > 0 && formatMode === 'unit') {
                    matchingProduct = products.find(p =>
                        Math.abs(Number(p.priceUsd) - Number(item.priceUsd)) < 0.01
                    );
                }
            }
        }

        // 2. Si se encuentra el producto en el catálogo actual, calcular su precio oficial actual
        if (matchingProduct) {
            const pricing = calculatePricing(matchingProduct, effectiveRate, bcvRate, formatMode, bsRoundingStep);
            return mulR(pricing.unitPriceBs, qty);
        }

        // 3. Si el ítem traía metadatos de precio embebidos en el registro histórico
        const hasPricingInfo = item.pricingMode || item.boxPricingMode || item.halfBoxPricingMode ||
            item.priceBsManual > 0 || item.boxPriceBs > 0 || item.halfBoxPriceBs > 0 ||
            item.priceBsUsdRef > 0 || item.forceBcv != null;

        if (hasPricingInfo) {
            const itemToCalculate = {
                ...item,
                sellByBox: item.sellByBox || formatMode === 'box' || item.boxPriceBs > 0 || (formatMode === 'box' && item.priceBsManual > 0),
                sellByHalfBox: item.sellByHalfBox || formatMode === 'halfBox' || item.halfBoxPriceBs > 0 || (formatMode === 'halfBox' && item.priceBsManual > 0),
                boxPriceBs: item.boxPriceBs ?? (formatMode === 'box' ? item.priceBsManual : null),
                halfBoxPriceBs: item.halfBoxPriceBs ?? (formatMode === 'halfBox' ? item.priceBsManual : null),
                // Propagar el boxPricingMode como pricingMode si no hay pricingMode explícito
                pricingMode: item.pricingMode || (formatMode === 'box' ? item.boxPricingMode : null) || (formatMode === 'halfBox' ? item.halfBoxPricingMode : null),
            };
            const pricing = calculatePricing(itemToCalculate, effectiveRate, bcvRate, formatMode, bsRoundingStep);
            return mulR(pricing.unitPriceBs, qty);
        }

        // 3b. Usar subtotalBs guardado en el ítem (precio Bs al momento de la venta).
        // No es el precio actual, pero es el mejor dato disponible cuando el catálogo no coincide.
        if (item.subtotalBs > 0) {
            return item.subtotalBs;
        }

        // 4. Fallback final: convertir priceUsd con la tasa actual (menos preciso)
        isEstimated = true;
        const rateToUse = bcvRate > 0 ? bcvRate : (effectiveRate > 0 ? effectiveRate : 0);
        const itemUsd = Number(item.priceUsd ?? item.price ?? 0);
        return mulR(itemUsd, qty * rateToUse);
    });

    const totalBs = sumR(itemBsTotals);
    return { totalBs: round2(totalBs), isEstimated };
}
