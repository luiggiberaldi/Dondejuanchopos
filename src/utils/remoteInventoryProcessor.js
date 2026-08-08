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
import { PRICING_MODES, FROZEN_MODES } from '../constants/pricingModes';
import { readPositiveMoney } from './productPriceMigration';

const PRODUCTS_KEY = 'bodega_products_v1';
const VALID_ACTIONS = ['add', 'edit', 'delete', 'adjust_stock', 'batch_edit'];

/**
 * ¿Es seguro que el catch-up vuelva a aplicar este comando?
 * Sólo lo es si repetirlo deja el mismo estado. `adjust_stock` con delta es
 * aditivo y duplicaría el stock; 'add'/'edit'/'delete' no corrompen pero el
 * reintento falla y marcaría como 'failed' algo que sí se aplicó.
 */
export function isReappliableCommand(payload) {
    const action = payload?.action;
    if (action === 'batch_edit') return true;
    if (action === 'adjust_stock') {
        const t = payload?.data?.targetStock;
        return t !== undefined && t !== null && t !== '';
    }
    return false;
}

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
    for (const f of ['priceBsManual', 'boxPriceUsd', 'boxPriceBs', 'boxPriceBsManual', 'halfBoxPriceUsd', 'halfBoxPriceBs', 'halfBoxPriceBsManual', 'costUsd', 'costBs']) {
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
    delete normalized.baseUpdatedAt;
    for (const k of Object.keys(normalized)) {
        if (k.startsWith('_')) delete normalized[k];
    }
    normalized.name = String(data.name).trim();
    normalized.priceUsd = Number(data.priceUsd) || 0;
    normalized.priceUsdt = normalized.priceUsd; // alias canónico legacy — SIEMPRE espejo
    normalized.priceBsManual = data.priceBsManual != null && data.priceBsManual !== '' ? Number(data.priceBsManual) : null;
    const boxPriceBs = readPositiveMoney(data.boxPriceBs, data.boxPriceBsManual);
    const halfBoxPriceBs = readPositiveMoney(data.halfBoxPriceBs, data.halfBoxPriceBsManual);
    normalized.boxPriceBs = boxPriceBs;
    normalized.boxPriceBsManual = boxPriceBs;
    normalized.halfBoxPriceBs = halfBoxPriceBs;
    normalized.halfBoxPriceBsManual = halfBoxPriceBs;
    normalized.boxPriceUsd = readPositiveMoney(data.boxPriceUsd, data.boxPriceUsdt);
    normalized.halfBoxPriceUsd = readPositiveMoney(data.halfBoxPriceUsd, data.halfBoxPriceUsdt);
    if (data.boxPricingMode) normalized.boxPricingMode = data.boxPricingMode;
    if (data.halfBoxPricingMode) normalized.halfBoxPricingMode = data.halfBoxPricingMode;
    normalized.stock = Number(data.stock) || 0;
    for (const f of BARCODE_FIELDS) {
        normalized[f] = (data[f] ?? '').toString().trim() || null;
    }
    normalized.sellByBox = Boolean(data.sellByBox);
    normalized.sellByHalfBox = Boolean(data.sellByBox) && Boolean(data.sellByHalfBox);
    normalized.unit = data.unit || 'unidad';
    normalized.packagingType = data.packagingType || 'suelto';
    normalized.lowStockAlert = Number(data.lowStockAlert) || 5;

    // D4: si el payload trae pricingMode, limpiar los campos Bs que no corresponden
    // (mismo contrato que buildProductPayload — evita priceBsManual basura en modo bcv)
    if (PRICING_MODES.includes(data.pricingMode)) {
        normalized.pricingMode = data.pricingMode;
        normalized.forceBcv = data.pricingMode === 'bcv';
        if (!FROZEN_MODES.includes(data.pricingMode)) {
            normalized.priceBsManual = null;
        }
        if (data.pricingMode !== 'dual_usd') normalized.priceBsUsdRef = null;
    }

    const boxMode = data.boxPricingMode === 'inherit' ? data.pricingMode : data.boxPricingMode;
    if (boxMode && !FROZEN_MODES.includes(boxMode)) {
        normalized.boxPriceBs = null;
        normalized.boxPriceBsManual = null;
    }

    const halfBoxMode = data.halfBoxPricingMode === 'inherit' ? data.pricingMode : data.halfBoxPricingMode;
    if (halfBoxMode && !FROZEN_MODES.includes(halfBoxMode)) {
        normalized.halfBoxPriceBs = null;
        normalized.halfBoxPriceBsManual = null;
    }

    return normalized;
}

/**
 * Un reintento de un alta debe ser idempotente. El monitor puede perder la
 * confirmacion despues de que la caja ya persistio el producto; en ese caso
 * no debemos reportarlo como fallo ni volver a crear otra fila.
 *
 * Se comparan solo campos de identidad/configuracion. Stock, timestamps e
 * imagen no forman parte de la comparacion porque pueden cambiar en la caja
 * mientras el comando estaba en vuelo.
 */
function isSameProductForIdempotentAdd(existing, candidate) {
    const text = value => String(value ?? '').trim().toLowerCase();
    const number = value => Number(value ?? 0);
    const sameNumber = (a, b) => Math.abs(number(a) - number(b)) < 0.000001;
    const sameNullableText = (a, b) => text(a) === text(b);

    return text(existing?.name) === text(candidate?.name)
        && sameNumber(existing?.priceUsd, candidate?.priceUsd)
        && sameNullableText(existing?.barcode, candidate?.barcode)
        && sameNullableText(existing?.boxBarcode, candidate?.boxBarcode)
        && sameNullableText(existing?.halfBoxBarcode, candidate?.halfBoxBarcode)
        && Boolean(existing?.isCombo) === Boolean(candidate?.isCombo)
        && Boolean(existing?.sellByBox) === Boolean(candidate?.sellByBox)
        && Boolean(existing?.sellByHalfBox) === Boolean(candidate?.sellByHalfBox);
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
    if (action !== 'add' && action !== 'batch_edit' && !productId) {
        return { success: false, error: 'productId requerido' };
    }

    // EGRESS RC2: si el monitor no pudo subir la imagen (offline), la caja lo intenta.
    // Se hace ANTES del withLock — un upload de red no puede sostener el write-lock
    // porque bloquearía el checkout durante segundos.
    // El upload es idempotente (upsert:true, ruta determinística por ID).
    let resolvedPayload = payload;
    const payloadImg = payload.data?.image;
    if (payloadImg && typeof payloadImg === 'string' && payloadImg.startsWith('data:')) {
        try {
            const { uploadProductImage } = await import('./imageUpload');
            const imgId = payload.data?.id || payload.productId;
            const url = await uploadProductImage(payloadImg, { id: imgId });
            if (url) {
                resolvedPayload = { ...payload, data: { ...payload.data, image: url } };
            }
        } catch { /* fallback: el base64 sigue en resolvedPayload.data.image */ }
    }

    // withLock retorna directamente el valor del callback (mismo contrato que checkoutProcessor)
    const lockResult = await withLock('pos_write_lock', async () => {
        const { action, productId, data } = resolvedPayload;
        const products = await storageService.getItem(PRODUCTS_KEY, []) || [];

        if (action === 'batch_edit') {
            const items = data?.items;
            if (!Array.isArray(items) || items.length === 0) {
                return { success: false, error: 'Lista de lote vacía' };
            }

            const byId = new Map(products.map(p => [p.id, p]));
            const nowIso = new Date().toISOString();
            let appliedCount = 0;
            const failedItems = [];

            for (const item of items) {
                const pId = item.productId;
                const pData = item.data;
                const existingProd = byId.get(pId);
                if (!existingProd || !pData) {
                    failedItems.push({ productId: pId, reason: 'Producto no encontrado en la caja' });
                    continue;
                }

                const mergedPayload = { ...existingProd, ...pData };
                const valErr = validateProductData(mergedPayload);
                if (valErr) {
                    failedItems.push({ productId: pId, productName: existingProd.name, reason: valErr });
                    continue;
                }

                const normalized = normalizeProduct(mergedPayload);
                normalized.id = pId;
                if (normalized.image === undefined) normalized.image = existingProd.image;
                normalized.stock = existingProd.stock;
                normalized.updatedAt = nowIso;

                byId.set(pId, { ...existingProd, ...normalized });
                appliedCount++;
            }

            if (appliedCount > 0) {
                const updatedList = products.map(p => byId.get(p.id) || p);
                await storageService.setItem(PRODUCTS_KEY, updatedList);
                logEvent('INVENTARIO', 'REMOTO_BATCH_EDIT', `Supervisor editó lote de ${appliedCount} productos (${failedItems.length} fallidos)`);
                return {
                    success: true,
                    productName: `Lote de ${appliedCount} productos`,
                    updatedProducts: updatedList,
                    appliedCount,
                    failedCount: failedItems.length,
                    failedItems
                };
            } else {
                const firstErr = failedItems[0]?.reason || 'No se pudo aplicar ningún cambio del lote';
                return { success: false, error: firstErr, failedItems };
            }
        }

        if (action === 'add') {
            const validationError = validateProductData(data);
            if (validationError) return { success: false, error: validationError };
            const normalized = normalizeProduct(data);
            // Compatibilidad con comandos antiguos que guardaban el ID en el
            // sobre del comando y no dentro de data.
            normalized.id = data.id || productId || crypto.randomUUID();
            const existingById = products.find(p => p.id === normalized.id);
            if (existingById) {
                if (isSameProductForIdempotentAdd(existingById, normalized)) {
                    return {
                        success: true,
                        idempotent: true,
                        productName: existingById.name || normalized.name,
                        updatedProducts: products
                    };
                }
                return {
                    success: false,
                    duplicateId: true,
                    error: 'DUPLICATE_PRODUCT_ID_CONFLICT: Ya existe otro producto con ese ID. No se reintento para evitar duplicarlo.'
                };
            }
            const conflict = findBarcodeConflict(normalized, products);
            if (conflict) return { success: false, error: conflict };
            const nowIso = new Date().toISOString();
            normalized.createdAt = normalized.createdAt || nowIso;
            normalized.updatedAt = nowIso;
            const updated = [...products, normalized];
            await storageService.setItem(PRODUCTS_KEY, updated);

            if (normalized.stock > 0) {
                try {
                    const { recordKardexMovementUnlocked } = await import('../services/kardexService');
                    await recordKardexMovementUnlocked({
                        productoId: normalized.id,
                        productoNombre: normalized.name,
                        sku: normalized.barcode || normalized.sku || '',
                        tipo: 'INICIAL',
                        subtipo: 'CREACION_PRODUCTO',
                        cantidad: normalized.stock,
                        unidad: normalized.unit || 'unidad',
                        stock_antes: 0,
                        stock_despues: normalized.stock,
                        costoUnitario: Number(normalized.costUsd || 0),
                        motivo: 'Registro inicial al crear producto remoto por Supervisor',
                        usuarioId: payload?.supervisorId || payload?.cajeroId || 'SUPERVISOR_REMOTO',
                        usuarioNombre: payload?.supervisorNombre || payload?.cajeroNombre || 'Supervisor (Remoto)'
                    });
                } catch (e) { console.error('[remoteInventoryProcessor] Error Kardex add:', e); }
            }

            logEvent('INVENTARIO', 'REMOTO_ADD', `Supervisor agregó "${normalized.name}"`);
            return { success: true, productName: normalized.name, updatedProducts: updated };
        }

        const existing = products.find(p => p.id === productId);
        if (!existing) return { success: false, error: 'Producto no encontrado en la caja' };

        if (action === 'edit') {
            // Versionado optimista (FASE 6, R1): verificar que el producto no haya sido modificado posteriormente por otro supervisor
            if (data?.baseUpdatedAt && existing.updatedAt) {
                const baseTime = new Date(data.baseUpdatedAt).getTime();
                const existingTime = new Date(existing.updatedAt).getTime();
                if (!isNaN(baseTime) && !isNaN(existingTime) && baseTime < existingTime) {
                    return {
                        success: false,
                        error: 'El producto fue modificado por otro supervisor. Vuelve a encolar el cambio.'
                    };
                }
            }

            const mergedPayload = { ...existing, ...data };
            const validationError = validateProductData(mergedPayload);
            if (validationError) return { success: false, error: validationError };
            const normalized = normalizeProduct(mergedPayload);
            normalized.id = productId;
            // D8: preservar imagen local si el comando no la trae.
            // Puede llegar base64 como fallback cuando el monitor estaba offline;
            // en ese caso RC2 ya intentó subirlo antes del lock.
            if (normalized.image === undefined) normalized.image = existing.image;
            // Anti-pisado: una edición remota NUNCA modifica el stock — la caja pudo
            // vender mientras el cambio esperaba en la cola del monitor. El stock
            // solo cambia vía 'adjust_stock' (deltas aditivos).
            normalized.stock = existing.stock;
            normalized.updatedAt = new Date().toISOString();
            const conflict = findBarcodeConflict(normalized, products, productId);
            if (conflict) return { success: false, error: conflict };
            const updated = products.map(p => p.id === productId ? { ...existing, ...normalized } : p);
            await storageService.setItem(PRODUCTS_KEY, updated);
            logEvent('INVENTARIO', 'REMOTO_EDIT', `Supervisor editó "${normalized.name}"`);
            return { success: true, productName: normalized.name, updatedProducts: updated };
        }

        if (action === 'delete') {
            const updated = products.filter(p => p.id !== productId);
            await storageService.setItem(PRODUCTS_KEY, updated);
            logEvent('INVENTARIO', 'REMOTO_DELETE', `Supervisor eliminó "${existing.name}"`);
            return { success: true, productName: existing.name, updatedProducts: updated };
        }

        // adjust_stock — soporta delta relativo o targetStock absoluto (Fijar Stock)
        const delta = Number(data?.delta);
        const hasTargetStock = data?.targetStock !== undefined && data?.targetStock !== null && data?.targetStock !== '';
        const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';
        const current = Number(existing.stock) || 0;
        let next;

        if (hasTargetStock) {
            const target = Number(data.targetStock);
            if (!Number.isFinite(target)) return { success: false, error: 'Stock objetivo inválido' };
            next = allowNeg ? target : Math.max(0, target);
        } else {
            if (!Number.isFinite(delta) || delta === 0) return { success: false, error: 'Delta de stock inválido' };
            next = allowNeg ? current + delta : Math.max(0, current + delta);
        }

        const actualQtyChange = next - current;

        const updated = products.map(p => p.id === productId ? { ...p, stock: next } : p);
        await storageService.setItem(PRODUCTS_KEY, updated);

        if (actualQtyChange !== 0) {
            try {
                const { recordKardexMovementUnlocked } = await import('../services/kardexService');
                const tipoKardex = actualQtyChange > 0 ? (hasTargetStock ? 'AJUSTE' : (delta > 0 ? 'COMPRA' : 'AJUSTE')) : 'AJUSTE';
                await recordKardexMovementUnlocked({
                    productoId: existing.id,
                    productoNombre: existing.name,
                    sku: existing.barcode || existing.sku || '',
                    tipo: tipoKardex,
                    subtipo: 'AJUSTE_INVENTARIO',
                    cantidad: actualQtyChange,
                    unidad: existing.unit || 'unidad',
                    stock_antes: current,
                    stock_despues: next,
                    costoUnitario: Number(existing.costUsd || existing.cost || 0),
                    motivo: data?.motivo || (hasTargetStock ? `Stock fijado a ${next} u por Supervisor` : `Ajuste remoto por Supervisor (${actualQtyChange > 0 ? '+' : ''}${actualQtyChange} u)`),
                    usuarioId: payload?.supervisorId || payload?.cajeroId || 'SUPERVISOR_REMOTO',
                    usuarioNombre: payload?.supervisorNombre || payload?.cajeroNombre || 'Supervisor (Remoto)'
                });
            } catch (e) { console.error('[remoteInventoryProcessor] Error Kardex adjust:', e); }
        }

        logEvent('INVENTARIO', 'REMOTO_STOCK', `Supervisor ajustó stock de "${existing.name}": ${hasTargetStock ? `fijado a ${next}` : `${delta > 0 ? '+' : ''}${delta} (→ ${next})`}`);
        return { success: true, productName: existing.name, updatedProducts: updated };
    });

    return lockResult ?? { success: false, error: 'Fallo inesperado al aplicar el comando' };
}
