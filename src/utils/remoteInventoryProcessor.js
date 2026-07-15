// remoteInventoryProcessor.js — Aplica comandos de inventario del supervisor en la CAJA.
//
// Reglas de diseño (ver future_plans/inventario_remoto_supervisor.md):
//  - D3: toda mutación ocurre dentro de withLock('pos_write_lock') re-leyendo
//    bodega_products_v1 FRESCO de storage (mismo patrón que checkoutProcessor).
//    Nunca desde estado React: eso competiría con la deducción de stock del checkout.
//  - D4: la caja es la fuente de verdad — re-valida barcodes únicos, nombre y
//    precios aunque el monitor ya haya validado.
//  - D8: en 'edit' se PRESERVA la imagen local si el payload no trae `image`
//    (los comandos nunca llevan base64).
// storageService.setItem dispara 'app_storage_update' → ProductContext se refresca solo.

import { storageService } from './storageService';
import { withLock } from './withLock';
import { logEvent } from '../services/auditService';

const PRODUCTS_KEY = 'bodega_products_v1';
const VALID_ACTIONS = ['add', 'edit', 'delete', 'adjust_stock'];

// Los 3 códigos que deben ser únicos en todo el inventario (lógica de formatos)
const BARCODE_FIELDS = ['barcode', 'boxBarcode', 'halfBoxBarcode'];

function collectBarcodes(product) {
    return BARCODE_FIELDS
        .map(f => (product?.[f] ?? '').toString().trim())
        .filter(Boolean);
}

/** Valida unicidad de los barcodes de `candidate` entre sí y contra `products` (excluyendo excludeId). */
function findBarcodeConflict(candidate, products, excludeId = null) {
    const own = collectBarcodes(candidate);
    const dupInside = own.find((code, i) => own.indexOf(code) !== i);
    if (dupInside) return `El código "${dupInside}" está repetido dentro del mismo producto`;

    for (const p of products) {
        if (excludeId && p.id === excludeId) continue;
        const other = collectBarcodes(p);
        const clash = own.find(code => other.includes(code));
        if (clash) return `El código "${clash}" ya pertenece a "${p.name}"`;
    }
    return null;
}

function validateProductData(data) {
    if (!data || typeof data !== 'object') return 'Datos de producto ausentes';
    if (!data.name || !String(data.name).trim()) return 'El nombre es obligatorio';
    const price = Number(data.priceUsd);
    if (isNaN(price) || price < 0) return 'Precio USD inválido';
    for (const f of ['priceBsManual', 'boxPriceUsd', 'boxPriceBs', 'halfBoxPriceUsd', 'halfBoxPriceBs', 'costUsd', 'costBs']) {
        if (data[f] != null && data[f] !== '' && (isNaN(Number(data[f])) || Number(data[f]) < 0)) {
            return `Campo ${f} inválido`;
        }
    }
    if (data.sellByHalfBox && !data.sellByBox) return '½ Caja requiere Caja activa';
    return null;
}

/** Normalización mínima de consistencia (espejo de buildProductPayload para la vía remota). */
function normalizeProduct(data) {
    const normalized = { ...data };
    normalized.name = String(data.name).trim();
    normalized.priceUsd = Number(data.priceUsd) || 0;
    normalized.priceUsdt = normalized.priceUsd; // alias canónico legacy — SIEMPRE espejo
    normalized.priceBsManual = data.priceBsManual != null && data.priceBsManual !== '' ? Number(data.priceBsManual) : null;
    normalized.stock = Number(data.stock) || 0;
    for (const f of BARCODE_FIELDS) {
        normalized[f] = (data[f] ?? '').toString().trim() || null;
    }
    normalized.sellByBox = Boolean(data.sellByBox);
    normalized.sellByHalfBox = Boolean(data.sellByBox) && Boolean(data.sellByHalfBox);
    normalized.unit = data.unit || 'unidad';
    normalized.packagingType = data.packagingType || 'suelto';
    normalized.lowStockAlert = Number(data.lowStockAlert) || 5;
    return normalized;
}

/**
 * Aplica un comando de inventario emitido por el supervisor.
 * @param {{action:string, productId?:string, data?:object}} payload
 * @returns {Promise<{success:boolean, error?:string, productName?:string}>}
 */
export async function applyInventoryCommand(payload) {
    if (!payload || !VALID_ACTIONS.includes(payload.action)) {
        return { success: false, error: `Acción inválida: ${payload?.action}` };
    }
    const { action, productId, data } = payload;
    if (action !== 'add' && !productId) {
        return { success: false, error: 'productId requerido' };
    }

    // withLock retorna directamente el valor del callback (mismo contrato que checkoutProcessor)
    const lockResult = await withLock('pos_write_lock', async () => {
        const products = await storageService.getItem(PRODUCTS_KEY, []) || [];

        if (action === 'add') {
            const validationError = validateProductData(data);
            if (validationError) return { success: false, error: validationError };
            const normalized = normalizeProduct(data);
            normalized.id = data.id || crypto.randomUUID();
            if (products.some(p => p.id === normalized.id)) {
                return { success: false, error: 'Ya existe un producto con ese ID' };
            }
            const conflict = findBarcodeConflict(normalized, products);
            if (conflict) return { success: false, error: conflict };
            normalized.createdAt = new Date().toISOString();
            await storageService.setItem(PRODUCTS_KEY, [...products, normalized]);
            logEvent('INVENTARIO', 'REMOTO_ADD', `Supervisor agregó "${normalized.name}"`);
            return { success: true, productName: normalized.name };
        }

        const existing = products.find(p => p.id === productId);
        if (!existing) return { success: false, error: 'Producto no encontrado en la caja' };

        if (action === 'edit') {
            const validationError = validateProductData(data);
            if (validationError) return { success: false, error: validationError };
            const normalized = normalizeProduct(data);
            normalized.id = productId;
            // D8: preservar imagen local si el comando no la trae (nunca viaja base64)
            if (normalized.image === undefined) normalized.image = existing.image;
            // Anti-pisado: una edición remota NUNCA modifica el stock — la caja pudo
            // vender mientras el cambio esperaba en la cola del monitor. El stock
            // solo cambia vía 'adjust_stock' (deltas aditivos).
            normalized.stock = existing.stock;
            const conflict = findBarcodeConflict(normalized, products, productId);
            if (conflict) return { success: false, error: conflict };
            const updated = products.map(p => p.id === productId ? { ...existing, ...normalized } : p);
            await storageService.setItem(PRODUCTS_KEY, updated);
            logEvent('INVENTARIO', 'REMOTO_EDIT', `Supervisor editó "${normalized.name}"`);
            return { success: true, productName: normalized.name };
        }

        if (action === 'delete') {
            await storageService.setItem(PRODUCTS_KEY, products.filter(p => p.id !== productId));
            logEvent('INVENTARIO', 'REMOTO_DELETE', `Supervisor eliminó "${existing.name}"`);
            return { success: true, productName: existing.name };
        }

        // adjust_stock — misma regla de negativos que adjustStock del ProductContext
        const delta = Number(data?.delta);
        if (isNaN(delta) || delta === 0) return { success: false, error: 'Delta de stock inválido' };
        const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';
        const current = Number(existing.stock) || 0;
        const next = allowNeg ? current + delta : Math.max(0, current + delta);
        const updated = products.map(p => p.id === productId ? { ...p, stock: next } : p);
        await storageService.setItem(PRODUCTS_KEY, updated);
        logEvent('INVENTARIO', 'REMOTO_STOCK', `Supervisor ajustó stock de "${existing.name}": ${delta > 0 ? '+' : ''}${delta} (→ ${next})`);
        return { success: true, productName: existing.name };
    });

    return lockResult ?? { success: false, error: 'Fallo inesperado al aplicar el comando' };
}
