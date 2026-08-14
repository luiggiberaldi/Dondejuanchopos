// src/utils/inventoryMovementModel.js
// Modelo puro de inventario: traduce unidades comerciales a movimientos físicos.
// No debe leer storage, localStorage, window, red ni reloj.

import { mulR, sumR, subR } from './dinero';

export const INVENTORY_SOURCES = Object.freeze({
    SALE: 'VENTA',
    COMBO: 'COMBO',
    MODULAR: 'MODULAR',
    DEFERRED_CONSUMPTION: 'CONSUMO_DIFERIDO',
    ADJUSTMENT: 'AJUSTE',
    RETURN: 'DEVOLUCION'
});

function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value) {
    return Math.max(0, finiteNumber(value));
}

function cleanFormatSuffix(value) {
    return String(value || '').replace(/_(?:half|box|unit)$/i, '');
}

function cleanFormatName(value) {
    return String(value || '')
        .replace(/\s*\((?:½|1\/2)\s*caja\)\s*$/i, '')
        .replace(/\s*\(caja\)\s*$/i, '')
        .trim()
        .toLowerCase();
}

/**
 * Resuelve la fila física aun cuando el carrito legado solo conserve el ID
 * sintético del formato (`producto_half`/`producto_box`) y no `_originalId`.
 */
function resolvePhysicalProduct(products, item) {
    if (!Array.isArray(products) || !item) return { product: null, productId: null };

    const rawIds = [item._originalId, item.productId, item.id]
        .filter(value => value !== null && value !== undefined && value !== '')
        .map(String);

    for (const rawId of rawIds) {
        const direct = products.find(product => String(product?.id) === rawId);
        if (direct) return { product: direct, productId: direct.id };

        const strippedId = cleanFormatSuffix(rawId);
        if (strippedId !== rawId) {
            const formatted = products.find(product => String(product?.id) === strippedId);
            if (formatted) return { product: formatted, productId: formatted.id };
        }
    }

    const normalizedName = cleanFormatName(item.name);
    if (normalizedName) {
        const byName = products.find(product => cleanFormatName(product?.name) === normalizedName);
        if (byName) return { product: byName, productId: byName.id };
    }

    return { product: null, productId: rawIds[0] || null };
}

/**
 * Calcula la cantidad física que representa una línea comercial.
 * @param {Object} item
 * @returns {number}
 */
export function getPhysicalQuantity(item) {
    if (!item) return 0;

    const quantity = positiveNumber(item.qty ?? item.quantity);
    if (item.isWeight) return quantity;

    const mode = item._mode || item.mode || 'unit';
    if (mode === 'box') {
        return mulR(quantity, Math.max(1, finiteNumber(item.boxUnits, 1)));
    }
    if (mode === 'halfBox') {
        return mulR(quantity, Math.max(1, finiteNumber(item.halfBoxUnits, 1)));
    }
    return quantity;
}

function createDeduction({
    productoId,
    cantidad,
    unidad = 'unidad',
    origen,
    item,
    parentProductId = null,
    metadata = {}
}) {
    const qty = positiveNumber(cantidad);
    if (!productoId || qty <= 0) return null;

    return {
        productoId,
        cantidad: -qty,
        cantidadSolicitada: -qty,
        unidad,
        origen,
        saleItemId: item?.id || null,
        parentProductId,
        metadata
    };
}

/**
 * Expande un carrito a las unidades físicas que realmente reducen inventario.
 * Los ítems de consumo diferido se omiten: el despacho los registra después.
 *
 * @param {Array} cart
 * @param {Array} products
 * @param {{ includeDeferred?: boolean }} options
 * @returns {{ deductions: Array, anomalies: Array }}
 */
export function expandCartToPhysicalDeductions(cart, products, options = {}) {
    const { includeDeferred = false } = options;
    const deductions = [];
    const anomalies = [];

    if (!Array.isArray(cart)) return { deductions, anomalies };

    for (const item of cart) {
        if (!item) continue;
        // "Venta Libre" representa un importe sin SKU físico; no debe crear
        // una salida Kardex ni dejar una operación pendiente por producto ausente.
        const isVirtualAmount = item.isCustomAmount === true
            || String(item.id || '').startsWith('custom_')
            || String(item.name || '').trim().toLowerCase() === 'venta libre';
        if (isVirtualAmount) continue;
        if (item.isDeferredConsumption && !includeDeferred) continue;

        const resolved = resolvePhysicalProduct(products, item);
        const itemId = resolved.productId;
        const physicalQty = getPhysicalQuantity(item);
        if (!itemId || physicalQty <= 0) {
            if (itemId && physicalQty <= 0) {
                anomalies.push({
                    tipo: 'CANTIDAD_INVALIDA',
                    productoId: itemId,
                    saleItemId: item.id || null,
                    descripcion: 'La línea comercial no tiene cantidad física positiva.'
                });
            }
            continue;
        }

        const product = resolved.product;
        const isCombo = Boolean(product?.isCombo);
        const isModular = Boolean(item.isModular || product?.isModular);
        let expanded = false;

        if (isCombo && Array.isArray(product.comboItems) && product.comboItems.length > 0) {
            expanded = true;
            for (const component of product.comboItems) {
                const componentQty = mulR(physicalQty, positiveNumber(component?.qty));
                const deduction = createDeduction({
                    productoId: component?.productId,
                    cantidad: componentQty,
                    origen: INVENTORY_SOURCES.COMBO,
                    item,
                    parentProductId: itemId,
                    metadata: { componentOf: itemId }
                });
                if (deduction) deductions.push(deduction);
            }
        }

        if (isModular && Array.isArray(item.modularSelections) && item.modularSelections.length > 0) {
            expanded = true;
            for (const selection of item.modularSelections) {
                const selectionQty = mulR(physicalQty, positiveNumber(selection?.qty));
                const deduction = createDeduction({
                    productoId: selection?.productId,
                    cantidad: selectionQty,
                    origen: INVENTORY_SOURCES.MODULAR,
                    item,
                    parentProductId: itemId,
                    metadata: { selectedFor: itemId, groupId: selection?.groupId || null }
                });
                if (deduction) deductions.push(deduction);
            }
        }

        if (!expanded) {
            if (isCombo) {
                anomalies.push({
                    tipo: 'COMBO_SIN_COMPONENTES',
                    productoId: itemId,
                    saleItemId: item.id || null,
                    descripcion: 'El combo no tiene componentes físicos configurados; no se creó una salida ficticia del padre.'
                });
                continue;
            }

            const deduction = createDeduction({
                productoId: itemId,
                cantidad: physicalQty,
                origen: INVENTORY_SOURCES.SALE,
                item,
                metadata: { productId: itemId }
            });
            if (deduction) deductions.push(deduction);
        }
    }

    return { deductions, anomalies };
}

/**
 * Agrupa deducciones por producto físico para que una operación genere un snapshot
 * único y no pierda cantidades por el guardián de idempotencia.
 */
export function aggregatePhysicalDeductions(deductions) {
    if (!Array.isArray(deductions)) return [];

    const grouped = new Map();
    for (const deduction of deductions) {
        if (!deduction?.productoId) continue;
        const current = grouped.get(deduction.productoId);
        if (!current) {
            grouped.set(deduction.productoId, {
                ...deduction,
                cantidad: finiteNumber(deduction.cantidad),
                cantidadSolicitada: finiteNumber(deduction.cantidadSolicitada ?? deduction.cantidad),
                origins: deduction.origen ? [deduction.origen] : [],
                sourceItems: deduction.saleItemId ? [deduction.saleItemId] : []
            });
            continue;
        }

        current.cantidad = sumR(current.cantidad, finiteNumber(deduction.cantidad));
        current.cantidadSolicitada = sumR(
            current.cantidadSolicitada,
            finiteNumber(deduction.cantidadSolicitada ?? deduction.cantidad)
        );
        if (deduction.origen && !current.origins.includes(deduction.origen)) {
            current.origins.push(deduction.origen);
        }
        if (deduction.saleItemId && !current.sourceItems.includes(deduction.saleItemId)) {
            current.sourceItems.push(deduction.saleItemId);
        }
    }

    return [...grouped.values()]
        .filter(deduction => deduction.cantidad !== 0)
        .map(deduction => ({
            ...deduction,
            origen: deduction.origins.join('+') || deduction.origen,
            metadata: {
                ...(deduction.metadata || {}),
                origins: deduction.origins,
                sourceItems: deduction.sourceItems
            }
        }));
}

/**
 * Calcula una transición de stock y separa lo solicitado de lo realmente aplicado.
 */
export function buildStockTransition(stockBefore, requestedDelta, options = {}) {
    const before = finiteNumber(stockBefore);
    const requested = finiteNumber(requestedDelta);
    const allowNegative = options.allowNegative === true;
    const unclampedAfter = sumR(before, requested);
    const after = allowNegative ? unclampedAfter : Math.max(0, unclampedAfter);
    const applied = subR(after, before);
    const notApplied = subR(requested, applied);

    return {
        stockAntes: before,
        stockDespues: after,
        cantidadAplicada: applied,
        cantidadSolicitada: requested,
        cantidadNoAplicada: notApplied,
        clamped: Math.abs(notApplied) > 0.000001,
        negativeStockUsed: after < 0
    };
}

/**
 * Verifica la invariante de una transición sin efectos secundarios.
 */
export function isValidStockTransition(transition, tolerance = 0.000001) {
    if (!transition) return false;
    const expected = sumR(transition.stockAntes, transition.cantidadAplicada);
    return Math.abs(expected - transition.stockDespues) <= tolerance;
}
