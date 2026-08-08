import { mulR, divR, round2, roundBs } from './dinero';
import { migrateFormatPriceAliases, readPositiveMoney, resolveFormatBsPrice } from './productPriceMigration';

/**
 * Construye el objeto payload para guardar o actualizar productos en el sistema local
 * con normalización canónica por modo (D1, D2, D4).
 */
export function buildProductPayload(formData, effectiveRate) {
    const {
        name,
        barcode,
        priceUsd,
        priceBs,
        costUsd,
        costBs,
        stock,
        stockInLotes,
        packagingType,
        unitsPerPackage,
        granelUnit,
        sellByUnit,
        unitPriceUsd,
        category,
        lowStockAlert,
        forceBcv,
        pricingMode: rawPricingMode,
        boxPricingMode: rawBoxPricingMode,
        halfBoxPricingMode: rawHalfBoxPricingMode,
        priceBsManual: rawBsManual,
        priceBsUsdRef: rawBsUsdRef,
        sellByBox,
        boxUnits,
        boxBarcode,
        boxPriceUsd,
        boxPriceBs: rawBoxPriceBs,
        boxPriceBsUsdRef: rawBoxPriceBsUsdRef,
        sellByHalfBox,
        halfBoxUnits,
        halfBoxBarcode,
        halfBoxPriceUsd,
        halfBoxPriceBs: rawHalfBoxPriceBs,
        halfBoxPriceBsUsdRef: rawHalfBoxPriceBsUsdRef,
    } = formData;

    const formattedName = name ? name.replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase()) : '';
    const finalPriceUsd = priceUsd !== '' && priceUsd != null ? parseFloat(priceUsd) : (priceBs ? parseFloat(priceBs) / effectiveRate : 0);
    const finalCostUsd = costUsd !== '' && costUsd != null ? parseFloat(costUsd) : (costBs ? parseFloat(costBs) / effectiveRate : 0);
    const finalCostBs = costBs !== '' && costBs != null ? parseFloat(costBs) : (costUsd ? parseFloat(costUsd) * effectiveRate : 0);

    // D2: derive pricingMode si no viene explícito
    let pricingMode = rawPricingMode;
    if (!['tasa_dia', 'bcv', 'dual_usd', 'bs_fijo'].includes(pricingMode)) {
        if (Boolean(forceBcv)) {
            pricingMode = 'bcv';
        } else if (Number(rawBsUsdRef) > 0) {
            pricingMode = 'dual_usd';
        } else if (Number(rawBsManual) > 0) {
            pricingMode = 'bs_fijo';
        } else {
            pricingMode = 'tasa_dia';
        }
    }

    const priceBsManual = pricingMode === 'bs_fijo' && rawBsManual !== '' && rawBsManual != null ? Number(rawBsManual) : null;
    const priceBsUsdRef = pricingMode === 'dual_usd' && rawBsUsdRef !== '' && rawBsUsdRef != null ? Number(rawBsUsdRef) : null;

    // Box pricing mode
    let boxPricingMode = rawBoxPricingMode || 'inherit';
    const effectiveBoxMode = boxPricingMode === 'inherit' ? pricingMode : boxPricingMode;
    const resolvedBoxPriceBs = effectiveBoxMode === 'bs_fijo' && rawBoxPriceBs !== '' && rawBoxPriceBs != null ? Number(rawBoxPriceBs) : null;
    const resolvedBoxPriceBsUsdRef = effectiveBoxMode === 'dual_usd' && rawBoxPriceBsUsdRef !== '' && rawBoxPriceBsUsdRef != null ? Number(rawBoxPriceBsUsdRef) : null;

    // HalfBox pricing mode
    let halfBoxPricingMode = rawHalfBoxPricingMode || 'inherit';
    const effectiveHalfBoxMode = halfBoxPricingMode === 'inherit' ? pricingMode : halfBoxPricingMode;
    const resolvedHalfBoxPriceBs = effectiveHalfBoxMode === 'bs_fijo' && rawHalfBoxPriceBs !== '' && rawHalfBoxPriceBs != null ? Number(rawHalfBoxPriceBs) : null;
    const resolvedHalfBoxPriceBsUsdRef = effectiveHalfBoxMode === 'dual_usd' && rawHalfBoxPriceBsUsdRef !== '' && rawHalfBoxPriceBsUsdRef != null ? Number(rawHalfBoxPriceBsUsdRef) : null;

    let legacyUnit = 'unidad';
    if (packagingType === 'lote') legacyUnit = 'paquete';
    else if (packagingType === 'granel') legacyUnit = granelUnit;

    const isLote = packagingType === 'lote';
    const parsedUnitsPerPkg = isLote && unitsPerPackage ? parseInt(unitsPerPackage) : 1;
    const autoUnitPrice = parsedUnitsPerPkg > 1 ? finalPriceUsd / parsedUnitsPerPkg : finalPriceUsd;
    const finalUnitPrice = sellByUnit && unitPriceUsd ? parseFloat(unitPriceUsd) : autoUnitPrice;

    let finalStock = stock ? parseInt(stock) : 0;
    if (isLote && stockInLotes && parsedUnitsPerPkg > 0) {
        finalStock = parseInt(stockInLotes) * parsedUnitsPerPkg;
    }

    return {
        name: formattedName,
        barcode: barcode ? barcode.trim() : null,
        priceUsd: finalPriceUsd,
        priceUsdt: finalPriceUsd,
        pricingMode,
        forceBcv: pricingMode === 'bcv',
        priceBsManual,
        priceBsUsdRef,
        costUsd: finalCostUsd,
        costBs: finalCostBs,
        stock: finalStock,
        unit: legacyUnit,
        packagingType: packagingType || 'suelto',
        unitsPerPackage: parsedUnitsPerPkg,
        sellByUnit: isLote ? Boolean(sellByUnit) : false,
        unitPriceUsd: isLote && sellByUnit ? finalUnitPrice : null,
        stockInLotes: isLote && stockInLotes ? parseInt(stockInLotes) : null,
        category: category,
        lowStockAlert: lowStockAlert ? parseInt(lowStockAlert) : 5,

        // Box
        sellByBox: Boolean(sellByBox),
        boxUnits: sellByBox && boxUnits ? parseInt(boxUnits, 10) : null,
        boxBarcode: sellByBox && boxBarcode ? boxBarcode.trim() : null,
        boxPriceUsd: sellByBox && boxPriceUsd !== '' && boxPriceUsd != null ? Number(boxPriceUsd) : null,
        boxPricingMode: sellByBox ? effectiveBoxMode : 'inherit',
        boxPriceBs: sellByBox ? resolvedBoxPriceBs : null,
        boxPriceBsManual: sellByBox ? resolvedBoxPriceBs : null,
        boxPriceBsUsdRef: sellByBox ? resolvedBoxPriceBsUsdRef : null,

        // HalfBox
        sellByHalfBox: Boolean(sellByBox) && Boolean(sellByHalfBox),
        halfBoxUnits: sellByBox && sellByHalfBox && halfBoxUnits ? parseInt(halfBoxUnits, 10) : null,
        halfBoxBarcode: sellByBox && sellByHalfBox && halfBoxBarcode ? halfBoxBarcode.trim() : null,
        halfBoxPriceUsd: sellByBox && sellByHalfBox && halfBoxPriceUsd !== '' && halfBoxPriceUsd != null ? Number(halfBoxPriceUsd) : null,
        halfBoxPricingMode: sellByBox && sellByHalfBox ? effectiveHalfBoxMode : 'inherit',
        halfBoxPriceBs: sellByBox && sellByHalfBox ? resolvedHalfBoxPriceBs : null,
        halfBoxPriceBsManual: sellByBox && sellByHalfBox ? resolvedHalfBoxPriceBs : null,
        halfBoxPriceBsUsdRef: sellByBox && sellByHalfBox ? resolvedHalfBoxPriceBsUsdRef : null,
    };
}

/**
 * Normaliza cualquier objeto producto proveniente de IndexedDB, Firestore o legacy
 * a la estructura canónica esperada por la app (D1, D2, D4).
 */
export function normalizeProduct(raw = {}) {
    if (!raw) return {};

    const migrated = migrateFormatPriceAliases(raw);

    const priceUsd = Number(raw.priceUsd ?? raw.priceUsdt ?? raw.price ?? 0);
    const forceBcv = Boolean(raw.forceBcv);

    let pricingMode = raw.pricingMode;
    if (!['tasa_dia', 'bcv', 'dual_usd', 'bs_fijo'].includes(pricingMode)) {
        if (forceBcv) {
            pricingMode = 'bcv';
        } else if (Number(raw.priceBsUsdRef) > 0) {
            pricingMode = 'dual_usd';
        } else if (Number(raw.priceBsManual) > 0) {
            pricingMode = 'bs_fijo';
        } else {
            pricingMode = 'tasa_dia';
        }
    }

    const isBox = Boolean(raw.sellByBox || raw._mode === 'box'
        || resolveFormatBsPrice(raw, 'box') !== null
        || readPositiveMoney(raw.boxPriceUsd, raw.boxPriceUsdt) !== null);
    const isHalfBox = Boolean(raw.sellByHalfBox || raw._mode === 'halfBox'
        || resolveFormatBsPrice(raw, 'halfBox') !== null
        || readPositiveMoney(raw.halfBoxPriceUsd, raw.halfBoxPriceUsdt) !== null);

    const boxPriceBs = resolveFormatBsPrice(migrated, 'box');
    const halfBoxPriceBs = resolveFormatBsPrice(migrated, 'halfBox');
    const boxPriceBsFallback = isBox && raw._mode === 'box'
        ? readPositiveMoney(raw.priceBsManual)
        : null;
    const halfBoxPriceBsFallback = isHalfBox && raw._mode === 'halfBox'
        ? readPositiveMoney(raw.priceBsManual)
        : null;

    return {
        ...raw,
        pricingMode,
        forceBcv: pricingMode === 'bcv',
        priceUsd,
        priceBsManual: pricingMode === 'bs_fijo' && raw.priceBsManual ? Number(raw.priceBsManual) : null,
        priceBsUsdRef: pricingMode === 'dual_usd' && raw.priceBsUsdRef ? Number(raw.priceBsUsdRef) : null,

        sellByBox: isBox,
        boxUnits: isBox ? (parseInt(raw.boxUnits, 10) || null) : null,
        boxPriceUsd: isBox ? readPositiveMoney(raw.boxPriceUsd, raw.boxPriceUsdt) : null,
        boxPricingMode: isBox ? (raw.boxPricingMode || 'inherit') : 'inherit',
        boxPriceBs: isBox ? (boxPriceBs ?? boxPriceBsFallback) : null,
        boxPriceBsManual: isBox ? (boxPriceBs ?? boxPriceBsFallback) : null,
        boxPriceBsUsdRef: isBox && raw.boxPriceBsUsdRef != null ? Number(raw.boxPriceBsUsdRef) : (isBox && raw._mode === 'box' && raw.priceBsUsdRef ? Number(raw.priceBsUsdRef) : null),

        sellByHalfBox: isHalfBox,
        halfBoxUnits: isHalfBox ? (parseInt(raw.halfBoxUnits, 10) || null) : null,
        halfBoxPriceUsd: isHalfBox ? readPositiveMoney(raw.halfBoxPriceUsd, raw.halfBoxPriceUsdt) : null,
        halfBoxPricingMode: isHalfBox ? (raw.halfBoxPricingMode || 'inherit') : 'inherit',
        halfBoxPriceBs: isHalfBox ? (halfBoxPriceBs ?? halfBoxPriceBsFallback) : null,
        halfBoxPriceBsManual: isHalfBox ? (halfBoxPriceBs ?? halfBoxPriceBsFallback) : null,
        halfBoxPriceBsUsdRef: isHalfBox && raw.halfBoxPriceBsUsdRef != null ? Number(raw.halfBoxPriceBsUsdRef) : (isHalfBox && raw._mode === 'halfBox' && raw.priceBsUsdRef ? Number(raw.priceBsUsdRef) : null),
    };
}

/** Paso de redondeo de Bs por defecto cuando no hay configuración guardada. */
export const DEFAULT_BS_ROUNDING_STEP = 10;

/**
 * F7 — Punto ÚNICO donde se resuelve el paso de redondeo de Bs.
 *
 * Antes esto vivía embebido en `calculatePricing`, que está documentado como motor
 * puro pero leía `localStorage` en cada ítem de cada llamada: el resultado dependía
 * del entorno, no de los argumentos, y por eso los tests no eran reproducibles.
 *
 * Además valida el tipo. Un objeto (`{ bsRoundingStep: 1 }`) pasaba antes la guarda
 * `!== null && !== undefined`, se colaba hasta `activeStep > 0`, coercía a `NaN` y
 * DESACTIVABA el redondeo en silencio — un test podía quedar en verde por accidente
 * mientras el parámetro estaba mal.
 *
 * @param {number|null|undefined} explicit - Paso inyectado por el llamante.
 * @returns {number} Paso efectivo (>= 0).
 */
export function resolveBsRoundingStep(explicit) {
    if (explicit !== null && explicit !== undefined) {
        const n = Number(explicit);
        if (Number.isFinite(n) && n >= 0) return n;

        const msg = `[productProcessor] bsRoundingStep inválido: ${JSON.stringify(explicit)} (se esperaba un número >= 0)`;
        if (import.meta.env?.DEV) throw new TypeError(msg);
        console.error(msg);
        // En producción NO se adivina: se cae a la configuración guardada.
    }

    if (typeof localStorage === 'undefined') return DEFAULT_BS_ROUNDING_STEP;
    const saved = parseInt(localStorage.getItem('bs_rounding_step') || String(DEFAULT_BS_ROUNDING_STEP), 10);
    return Number.isFinite(saved) && saved >= 0 ? saved : DEFAULT_BS_ROUNDING_STEP;
}

/**
 * Calcula la estructura completa de cobro para un producto en el carrito (D1, D3, D5).
 */
export function calculatePricing(product, effectiveRate, bcvRate, format = null, bsRoundingStep = null) {
    const p = normalizeProduct(product);
    const targetFormat = format || p._mode || 'unit';
    let baseUsd = p.priceUsd;
    let mode = p.pricingMode;

    const activeStep = resolveBsRoundingStep(bsRoundingStep);

    if (targetFormat === 'box' && (p.sellByBox || p._mode === 'box') && (p.boxPriceUsd > 0 || p.priceUsd > 0)) {
        baseUsd = p.boxPriceUsd || p.priceUsd;
        if (p.boxPricingMode && p.boxPricingMode !== 'inherit') mode = p.boxPricingMode;
    } else if (targetFormat === 'halfBox' && (p.sellByHalfBox || p._mode === 'halfBox') && (p.halfBoxPriceUsd > 0 || p.priceUsd > 0)) {
        baseUsd = p.halfBoxPriceUsd || p.priceUsd;
        if (p.halfBoxPricingMode && p.halfBoxPricingMode !== 'inherit') mode = p.halfBoxPricingMode;
    }

    let unitPriceUsd = baseUsd;
    let unitPriceBs = 0;
    let pricingError = null;

    switch (mode) {
        case 'bcv': {
            const rate = bcvRate > 0 ? bcvRate : effectiveRate;
            unitPriceUsd = baseUsd;
            unitPriceBs = mulR(baseUsd, rate);
            if (rate > 0 && unitPriceBs > 0) {
                const nearestInt = Math.round(unitPriceBs);
                if (Math.abs(unitPriceBs - nearestInt) <= 0.05 && Math.abs(divR(nearestInt, rate) - round2(baseUsd)) < 0.01) {
                    unitPriceBs = nearestInt;
                }
            }
            break;
        }

        case 'dual_usd': {
            const refUsd = format === 'box' && p.boxPriceBsUsdRef > 0 
                ? p.boxPriceBsUsdRef 
                : format === 'halfBox' && p.halfBoxPriceBsUsdRef > 0 
                    ? p.halfBoxPriceBsUsdRef 
                    : (p.priceBsUsdRef || baseUsd);
            unitPriceUsd = baseUsd;
            unitPriceBs = mulR(refUsd, effectiveRate);
            if (effectiveRate > 0 && unitPriceBs > 0) {
                const nearestInt = Math.round(unitPriceBs);
                if (Math.abs(unitPriceBs - nearestInt) <= 0.05 && Math.abs(divR(nearestInt, effectiveRate) - round2(refUsd)) < 0.01) {
                    unitPriceBs = nearestInt;
                }
            }
            break;
        }

        case 'bs_fijo': {
            const formatBsPrice = targetFormat === 'box'
                ? p.boxPriceBs
                : targetFormat === 'halfBox'
                    ? p.halfBoxPriceBs
                    : p.priceBsManual;
            const hasExplicitFormatMode = targetFormat === 'box'
                ? p.boxPricingMode && p.boxPricingMode !== 'inherit'
                : targetFormat === 'halfBox'
                    ? p.halfBoxPricingMode && p.halfBoxPricingMode !== 'inherit'
                    : true;
            const bsManual = formatBsPrice > 0
                ? formatBsPrice
                : (!hasExplicitFormatMode && targetFormat !== 'unit' ? (p.priceBsManual || 0) : 0);
            unitPriceBs = bsManual;
            unitPriceUsd = effectiveRate > 0 ? divR(bsManual, effectiveRate) : baseUsd;
            if (!(bsManual > 0)) pricingError = 'PRECIO_BS_FORMATO_AUSENTE';
            break;
        }

        case 'tasa_dia':
        default: {
            unitPriceUsd = baseUsd;
            const rawBs = (baseUsd || 0) * (effectiveRate || 0);
            unitPriceBs = activeStep > 0 ? roundBs(rawBs, activeStep) : round2(rawBs);
            break;
        }
    }

    return {
        unitPriceUsd: round2(unitPriceUsd),
        unitPriceBs: round2(unitPriceBs),
        mode,
        isBcv: mode === 'bcv',
        pricingError,
    };
}

/**
 * Propuesta A: Calcula el stock disponible de un combo (normal o modular).
 */
export function calculateComboStock(comboProduct, allProducts = []) {
    if (!comboProduct || !comboProduct.isCombo) {
        return comboProduct?.stock ?? 0;
    }

    const { comboItems = [], isModular, modularGroups = [] } = comboProduct;
    const effectiveModular = isModular || (modularGroups && modularGroups.length > 0);

    if (comboItems.length === 0 && (!effectiveModular || modularGroups.length === 0)) {
        return 0;
    }

    const avails = [];

    if (comboItems.length > 0) {
        comboItems.forEach(ci => {
            const p = ci._product || allProducts.find(x => String(x.id) === String(ci.productId));
            if (!p || ci.qty <= 0) {
                avails.push(0);
            } else {
                avails.push(Math.floor((p.stock ?? 0) / ci.qty));
            }
        });
    }

    if (effectiveModular && modularGroups.length > 0) {
        modularGroups.forEach(g => {
            const allowedIds = g.allowedProductIds || [];
            const reqQty = Math.max(1, parseInt(g.requiredQty, 10) || 1);
            
            const totalGroupStock = allowedIds.reduce((sum, pid) => {
                const p = allProducts.find(x => String(x.id) === String(pid));
                return sum + (p?.stock ?? 0);
            }, 0);

            avails.push(Math.floor(totalGroupStock / reqQty));
        });
    }

    return avails.length > 0 ? Math.max(0, Math.min(...avails)) : 0;
}

/**
 * Calcula el costo en USD de un producto (normal o combo).
 * Para combos sin costo manual, suma los costos de sus insumos componentes.
 */
export function getEffectiveCostUsd(product, allProducts = []) {
    if (!product) return 0;

    const directCost = Number(product.costUsd || product.costPrice || 0);
    if (directCost > 0) return directCost;

    if (product.isCombo || product.type === 'combo' || product.category === 'combo') {
        const { comboItems = [], isModular, modularGroups = [] } = product;
        let sum = 0;

        if (comboItems.length > 0) {
            comboItems.forEach(ci => {
                const comp = ci._product || allProducts.find(x => String(x.id) === String(ci.productId));
                if (comp) {
                    const compCost = Number(comp.costUsd || comp.costPrice || 0);
                    const qty = Number(ci.qty || 1);
                    sum += compCost * qty;
                }
            });
        }

        if ((isModular || (modularGroups && modularGroups.length > 0)) && modularGroups.length > 0) {
            modularGroups.forEach(g => {
                const allowedIds = g.allowedProductIds || [];
                const reqQty = Math.max(1, parseInt(g.requiredQty, 10) || 1);
                if (allowedIds.length > 0) {
                    const costs = allowedIds.map(pid => {
                        const comp = allProducts.find(x => String(x.id) === String(pid));
                        return Number(comp?.costUsd || comp?.costPrice || 0);
                    });
                    const avgCost = costs.reduce((a, b) => a + b, 0) / (costs.length || 1);
                    sum += avgCost * reqQty;
                }
            });
        }

        return sum;
    }

    return 0;
}
