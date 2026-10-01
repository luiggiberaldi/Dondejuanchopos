// src/services/inventoryOperationService.js
// Fachada única para mutaciones físicas de inventario + Kardex.

import { storageService } from '../utils/storageService';
import { withLock } from '../utils/withLock';
import { logEvent } from './auditService';
import { aggregatePhysicalDeductions, buildStockTransition, isValidStockTransition } from '../utils/inventoryMovementModel';
import { round2 } from '../utils/dinero';

export const PRODUCTS_KEY = 'bodega_products_v1';
export const KARDEX_KEY = 'bodega_kardex_v1';
export const INVENTORY_OPERATIONS_KEY = 'bodega_inventory_operations_v1';
export const SALES_KEY = 'bodega_sales_v1';

const OPERATION_PENDING = 'PENDING';
const OPERATION_APPLIED = 'APPLIED_LOCAL';
const OPERATION_FAILED = 'FAILED_RETRYABLE';

function getDeviceId() {
    return typeof localStorage !== 'undefined'
        ? localStorage.getItem('dj_device_id') || 'CAJA_PRINCIPAL'
        : 'CAJA_PRINCIPAL';
}

function nowIso() {
    return new Date().toISOString();
}

function stableMovementId(operationId, productId) {
    return `kdx_${String(operationId)}_${String(productId)}`
        .replace(/[^a-zA-Z0-9:_-]/g, '_');
}

function sameNumber(a, b) {
    return Math.abs(Number(a) - Number(b)) <= 0.000001;
}

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

// IndexedDB normalmente confirma la escritura al resolver setItem, pero el
// storage de contingencia puede absorber un error. Verificar la lectura local
// deja la operación en outbox en vez de anunciar un stock aplicado a medias.
async function persistAndVerify(key, value) {
    await storageService.setItem(key, value);
    const persisted = await storageService.getItem(key, null);
    if (JSON.stringify(persisted) !== JSON.stringify(value)) {
        const error = new Error(`Persistencia no verificada para ${key}`);
        error.code = 'INVENTORY_PERSISTENCE_MISMATCH';
        throw error;
    }
    return value;
}

function findOperation(operations, operationId) {
    return (Array.isArray(operations) ? operations : [])
        .find(operation => operation?.operationId === operationId) || null;
}

function actorData(actor = {}) {
    return {
        usuarioId: actor.usuarioId || actor.id || actor.userId || null,
        usuarioNombre: actor.usuarioNombre || actor.nombre || actor.usuario || actor.userName || 'Sistema',
        usuarioRol: actor.usuarioRol || actor.rol || actor.userRole || 'SYSTEM',
        supervisorId: actor.supervisorId || null
    };
}

function normalizeOperation(operation) {
    const operationId = operation?.operationId;
    if (!operationId) throw new Error('operationId es requerido para una operación de inventario');
    if (!Array.isArray(operation?.deductions)) {
        throw new Error('deductions debe ser un arreglo');
    }

    const deductions = aggregatePhysicalDeductions(operation.deductions)
        .filter(deduction => Number(deduction.cantidad) !== 0);
    if (deductions.length === 0) {
        throw new Error('La operación no contiene cantidades físicas distintas de cero');
    }

    return {
        operationId: String(operationId),
        referenceId: operation.referenceId || operationId,
        referenceType: operation.referenceType || 'INVENTARIO',
        tipo: operation.tipo || 'AJUSTE',
        subtipo: operation.subtipo || 'SISTEMA',
        reason: operation.reason || operation.motivo || 'Operación de inventario',
        source: operation.source || 'INVENTARIO',
        allowNegative: operation.allowNegative === true,
        actor: actorData(operation.actor),
        deductions,
        metadata: operation.metadata || {},
        productsFallback: Array.isArray(operation.productsFallback) ? operation.productsFallback : []
    };
}

function buildTransitionPlan(products, operation) {
    const transitions = [];
    const missingProducts = [];

    for (const deduction of operation.deductions) {
        const product = products.find(item => item?.id === deduction.productoId);
        if (!product) {
            missingProducts.push(deduction.productoId);
            continue;
        }

        const transition = buildStockTransition(
            product.stock,
            deduction.cantidad,
            { allowNegative: operation.allowNegative }
        );
        if (!isValidStockTransition(transition)) {
            throw new Error(`Transición inválida para producto ${deduction.productoId}`);
        }

        transitions.push({
            productoId: deduction.productoId,
            productoNombre: product.name || 'Producto Desconocido',
            sku: product.barcode || product.sku || '',
            unidad: deduction.unidad || product.unit || 'unidad',
            costoUnitario: Number(product.costUsd || product.cost || 0),
            cantidad: transition.cantidadAplicada,
            cantidadSolicitada: transition.cantidadSolicitada,
            stockAntes: transition.stockAntes,
            stockDespues: transition.stockDespues,
            cantidadNoAplicada: transition.cantidadNoAplicada,
            clamped: transition.clamped,
            negativeStockUsed: transition.negativeStockUsed,
            origen: deduction.origen,
            metadata: {
                ...(deduction.metadata || {}),
                sourceItems: deduction.sourceItems || [],
                requestedQuantity: transition.cantidadSolicitada,
                appliedQuantity: transition.cantidadAplicada,
                unappliedQuantity: transition.cantidadNoAplicada
            }
        });
    }

    if (missingProducts.length > 0) {
        const error = new Error(`Productos físicos no encontrados: ${missingProducts.join(', ')}`);
        error.code = 'INVENTORY_PRODUCT_NOT_FOUND';
        error.productIds = missingProducts;
        throw error;
    }

    return transitions;
}

function buildMovement(operation, transition) {
    const movementId = stableMovementId(operation.operationId, transition.productoId);
    const movementTimestamp = nowIso();
    return {
        id: movementId,
        operation_id: operation.operationId,
        device_id: getDeviceId(),
        sucursal_id: 'principal',
        producto_id: transition.productoId,
        sku: transition.sku,
        producto_nombre: transition.productoNombre,
        tipo: operation.tipo,
        subtipo: operation.subtipo,
        cantidad: transition.cantidad,
        unidad: transition.unidad,
        stock_antes: transition.stockAntes,
        stock_despues: transition.stockDespues,
        costo_unitario: transition.costoUnitario,
        costo_total: round2(Math.abs(transition.cantidad) * transition.costoUnitario),
        moneda: 'USD',
        referencia_id: operation.referenceId,
        referencia_tipo: operation.referenceType,
        referencia_numero: operation.metadata?.referenceNumber || null,
        cierre_id: operation.metadata?.cierreId || null,
        turno_id: operation.metadata?.turnoId || null,
        usuario_id: operation.actor.usuarioId,
        usuario_nombre: operation.actor.usuarioNombre,
        usuario_rol: operation.actor.usuarioRol,
        actor_id: operation.actor.usuarioId,
        actor_name: operation.actor.usuarioNombre,
        actor_role: operation.actor.usuarioRol,
        supervisor_id: operation.actor.supervisorId,
        motivo: operation.reason,
        observaciones: transition.clamped
            ? `Cantidad solicitada ${transition.cantidadSolicitada}; aplicada ${transition.cantidad}`
            : null,
        metadata: {
            ...operation.metadata,
            source: operation.source,
            origen: transition.origen,
            requestedQuantity: transition.cantidadSolicitada,
            appliedQuantity: transition.cantidad,
            unappliedQuantity: transition.cantidadNoAplicada,
            clamped: transition.clamped,
            negativeStockUsed: transition.negativeStockUsed,
            operationId: operation.operationId
        },
        created_at: movementTimestamp,
        timestamp: movementTimestamp,
        createdAt: movementTimestamp,
        updatedAt: movementTimestamp,
    };
}

function operationRecord(operation, transitions, status = OPERATION_PENDING, error = null) {
    const occurredAt = nowIso();
    return {
        operationId: operation.operationId,
        referenceId: operation.referenceId,
        referenceType: operation.referenceType,
        status,
        error: error ? String(error.message || error) : null,
        movementIds: transitions.map(transition => stableMovementId(operation.operationId, transition.productoId)),
        transitions: clone(transitions),
        deductions: clone(operation.deductions),
        actor: clone(operation.actor),
        actorId: operation.actor.usuarioId,
        actorName: operation.actor.usuarioNombre,
        actorRole: operation.actor.usuarioRol,
        source: operation.source,
        tipo: operation.tipo,
        subtipo: operation.subtipo,
        reason: operation.reason,
        metadata: clone(operation.metadata),
        deviceId: getDeviceId(),
        device_id: getDeviceId(),
        createdAt: occurredAt,
        updatedAt: occurredAt,
        occurredAt,
    };
}

function updateOperationRecord(operations, operationId, patch) {
    return (Array.isArray(operations) ? operations : []).map(operation => (
        operation?.operationId === operationId
            ? { ...operation, ...patch, updatedAt: nowIso() }
            : operation
    ));
}

function applyTransitionsToProducts(products, transitions, operation) {
    const byId = new Map(transitions.map(transition => [transition.productoId, transition]));
    const appliedAt = nowIso();
    return products.map(product => {
        const transition = byId.get(product.id);
        if (!transition) return product;

        const currentStock = Number(product.stock) || 0;
        if (!sameNumber(currentStock, transition.stockAntes)
            && !sameNumber(currentStock, transition.stockDespues)) {
            const error = new Error(`Conflicto de stock para ${product.id}: esperado ${transition.stockAntes} o ${transition.stockDespues}, recibido ${currentStock}`);
            error.code = 'INVENTORY_STOCK_CONFLICT';
            throw error;
        }

        // Un movimiento físico conserva su propia trazabilidad sin tocar
        // `updatedAt`, que pertenece a la versión de atributos del producto.
        // `stockOperationIds` permite al Supervisor confirmar un comando aunque
        // una venta posterior ya haya cambiado nuevamente el stock.
        if (sameNumber(currentStock, transition.stockDespues)) return product;
        const previousOperationIds = Array.isArray(product.stockOperationIds)
            ? product.stockOperationIds.filter(Boolean)
            : [];
        const stockOperationIds = [
            ...previousOperationIds.filter(id => id !== operation.operationId),
            operation.operationId,
        ].slice(-25);
        return {
            ...product,
            stock: transition.stockDespues,
            lastStockOperationId: operation.operationId,
            stockOperationIds,
            stockUpdatedAt: appliedAt,
            stockUpdatedBy: operation.actor.usuarioId,
            stockUpdatedByName: operation.actor.usuarioNombre,
            stockUpdatedByRole: operation.actor.usuarioRol,
        };
    });
}

function appendMissingMovements(kardex, movements) {
    const current = Array.isArray(kardex) ? kardex : [];
    const existingIds = new Set(current.map(movement => movement?.id));
    const missing = movements.filter(movement => !existingIds.has(movement.id));
    return missing.length > 0 ? [...missing.reverse(), ...current] : current;
}

async function persistSaleInventoryTrace(operation, transitions) {
    if (operation.referenceType !== 'VENTA' || !operation.referenceId) return;
    // Si la operación fue disparada desde POS_CHECKOUT, checkoutProcessor consolida
    // la venta final con sus transiciones de inventario en una única escritura atómica bajo pos_write_lock.
    if (operation.source === 'POS_CHECKOUT') return;

    const sales = await storageService.getItem(SALES_KEY, []) || [];
    const sale = sales.find(item => item?.id === operation.referenceId);
    if (!sale) return;

    const appliedDeductions = transitions
        .filter(transition => Number(transition.cantidad) !== 0)
        .map(transition => ({
            productoId: transition.productoId,
            cantidad: transition.cantidad,
            cantidadSolicitada: transition.cantidadSolicitada,
            unidad: transition.unidad,
            origen: transition.origen,
            metadata: transition.metadata,
        }));
    const updatedAt = nowIso();
    const updatedSales = sales.map(item => item.id === operation.referenceId
        ? {
            ...item,
            inventoryDeductionsApplied: appliedDeductions,
            inventoryOperationId: operation.operationId,
            inventoryReconciledAt: updatedAt,
            updatedAt,
        }
        : item
    );
    await persistAndVerify(SALES_KEY, updatedSales);

    try {
        const mirror = await storageService.getItem('bodega_sales_mirror_v1', []);
        if (Array.isArray(mirror)) {
            await persistAndVerify('bodega_sales_mirror_v1',
                mirror.some(item => item.id === operation.referenceId)
                    ? mirror.map(item => item.id === operation.referenceId
                        ? updatedSales.find(saleItem => saleItem.id === operation.referenceId)
                        : item)
                    : updatedSales.filter(item => item.id === operation.referenceId).concat(mirror)
            );
        }
    } catch (mirrorError) {
        console.warn('[InventoryOperation] No se pudo actualizar el espejo de venta:', mirrorError);
    }
}

function getOperationResult(operation, transitions, movements, pending = false, error = null) {
    return {
        success: !error,
        pending,
        operationId: operation.operationId,
        movementIds: movements.map(movement => movement.id),
        transitions: clone(transitions),
        movements: clone(movements),
        error: error?.message || null
    };
}

/**
 * Aplica una operación dentro de un lock ya adquirido.
 * Los callers que ya están bajo pos_write_lock deben usar esta variante.
 */
export async function applyInventoryOperationUnlocked(rawOperation) {
    let operation;
    try {
        operation = normalizeOperation(rawOperation);
    } catch (error) {
        return { success: false, pending: false, error: error.message };
    }

    let operations = await storageService.getItem(INVENTORY_OPERATIONS_KEY, []) || [];
    const previous = findOperation(operations, operation.operationId);
    if (previous?.status === OPERATION_APPLIED) {
        const kardex = await storageService.getItem(KARDEX_KEY, []) || [];
        const movements = kardex.filter(movement => previous.movementIds?.includes(movement?.id));
        const hasAllMovements = (previous.movementIds || []).every(id => movements.some(movement => movement.id === id));
        if (hasAllMovements) {
            const products = await storageService.getItem(PRODUCTS_KEY, operation.productsFallback) || operation.productsFallback || [];
            return {
                ...getOperationResult(operation, previous.transitions || [], movements, false),
                updatedProducts: products,
                updatedKardex: kardex
            };
        }
        // Un registro APPLIED sin todos sus movimientos es reparable: se reabre
        // como operación pendiente y el flujo normal volverá a insertar solo lo
        // que falte, conservando la idempotencia por movementId.
    }

    let originalProducts = null;
    let originalKardex = null;
    let productsWriteApplied = false;
    let kardexWriteApplied = false;

    try {
        const products = await storageService.getItem(PRODUCTS_KEY, operation.productsFallback) || operation.productsFallback || [];
        const kardex = await storageService.getItem(KARDEX_KEY, []) || [];
        originalProducts = products;
        originalKardex = kardex;
        const transitions = previous?.transitions?.length
            ? previous.transitions
            : buildTransitionPlan(products, operation);
        const movements = transitions.map(transition => buildMovement(operation, transition));

        const pending = previous || operationRecord(operation, transitions, OPERATION_PENDING);
        if (!previous) {
            operations = [...operations, pending];
            await persistAndVerify(INVENTORY_OPERATIONS_KEY, operations);
        } else if (previous.status !== OPERATION_PENDING) {
            operations = updateOperationRecord(operations, operation.operationId, {
                status: OPERATION_PENDING,
                error: null,
                transitions
            });
            await persistAndVerify(INVENTORY_OPERATIONS_KEY, operations);
        }

        const updatedProducts = applyTransitionsToProducts(products, transitions, operation);
        const updatedKardex = appendMissingMovements(kardex, movements);

        // El orden permite recuperar: si el Kardex falla después del catálogo,
        // la operación queda PENDING y el siguiente reintento detecta el stock final.
        await persistAndVerify(PRODUCTS_KEY, updatedProducts);
        productsWriteApplied = true;
        await persistAndVerify(KARDEX_KEY, updatedKardex);
        kardexWriteApplied = true;

        operations = updateOperationRecord(operations, operation.operationId, {
            status: OPERATION_APPLIED,
            error: null,
            movementIds: movements.map(movement => movement.id),
            transitions
        });
        await persistAndVerify(INVENTORY_OPERATIONS_KEY, operations);
        await persistSaleInventoryTrace(operation, transitions);

        logEvent('INVENTARIO', 'OPERACION_APLICADA',
            `${operation.source}: ${operation.reason} (${transitions.length} producto(s))`,
            operation.actor,
            { operationId: operation.operationId, movementIds: movements.map(movement => movement.id) }
        );

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('inventory_operation_applied', {
                detail: { operationId: operation.operationId, transitions, movements }
            }));
        }

        return {
            ...getOperationResult(operation, transitions, movements),
            updatedProducts,
            updatedKardex
        };
    } catch (error) {
        // Si una escritura intermedia falla, volver al snapshot anterior evita
        // dejar catálogo y Kardex en estados distintos. La operación fallida se
        // conserva como outbox para que el siguiente arranque la reintente.
        try {
            if (kardexWriteApplied && originalKardex) {
                await persistAndVerify(KARDEX_KEY, originalKardex);
            }
            if (productsWriteApplied && originalProducts) {
                await persistAndVerify(PRODUCTS_KEY, originalProducts);
            }
        } catch (rollbackError) {
            console.error('[InventoryOperation] Falló rollback local; queda outbox para recuperación:', rollbackError);
        }

        try {
            const hasOperationRecord = operations.some(item => item?.operationId === operation.operationId);
            const failureRecord = operationRecord(
                operation,
                previous?.transitions || [],
                OPERATION_FAILED,
                error
            );
            operations = hasOperationRecord
                ? updateOperationRecord(operations, operation.operationId, {
                    status: OPERATION_FAILED,
                    error: error.message || String(error),
                    deductions: clone(operation.deductions)
                })
                : [...operations, failureRecord];
            await persistAndVerify(INVENTORY_OPERATIONS_KEY, operations);
        } catch (recordError) {
            console.error('[InventoryOperation] No se pudo guardar estado pendiente:', recordError);
        }

        console.error('[InventoryOperation] Operación pendiente:', error);
        return getOperationResult(operation, previous?.transitions || [], [], true, error);
    }
}

/** Fachada pública para callers que no tienen un lock activo. */
export async function applyInventoryOperation(operation) {
    return await withLock('pos_write_lock', async () => (
        applyInventoryOperationUnlocked(operation)
    ));
}

/**
 * Reintenta operaciones que quedaron PENDING/FAILED_RETRYABLE.
 * Debe llamarse bajo el lock o mediante esta fachada.
 */
export async function recoverPendingInventoryOperationsUnlocked() {
    const operations = await storageService.getItem(INVENTORY_OPERATIONS_KEY, []) || [];
    const pending = operations.filter(operation => (
        (operation?.status === OPERATION_PENDING || operation?.status === OPERATION_FAILED)
        && ((Array.isArray(operation.transitions) && operation.transitions.length > 0)
            || (Array.isArray(operation.deductions) && operation.deductions.length > 0))
    ));
    const results = [];
    for (const operation of pending) {
        const result = await applyInventoryOperationUnlocked({
            operationId: operation.operationId,
            referenceId: operation.referenceId,
            referenceType: operation.referenceType,
            source: operation.source,
            actor: operation.actor,
            deductions: (operation.deductions?.length > 0
                ? operation.deductions
                : operation.transitions.map(transition => ({
                    productoId: transition.productoId,
                    cantidad: transition.cantidadSolicitada,
                    unidad: transition.unidad,
                    origen: transition.origen,
                    metadata: transition.metadata
                }))),
            tipo: operation.tipo || 'AJUSTE',
            subtipo: operation.subtipo || 'RECUPERACION',
            reason: operation.reason || 'Recuperación de operación pendiente',
            metadata: operation.metadata || {}
        });
        results.push(result);
    }
    return results;
}

export async function recoverPendingInventoryOperations() {
    return await withLock('pos_write_lock', async () => (
        recoverPendingInventoryOperationsUnlocked()
    ));
}

export async function getInventoryOperations() {
    return await storageService.getItem(INVENTORY_OPERATIONS_KEY, []) || [];
}
