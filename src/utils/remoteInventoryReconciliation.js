const EPSILON = 0.000001;
const SALE_TYPES = new Set(['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA']);

function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function movementTimestamp(movement) {
    const parsed = new Date(movement?.created_at || movement?.timestamp || 0).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

function issue(code, message, details = {}) {
    return { code, message, ...details };
}

function hasPhysicalItems(sale) {
    return Array.isArray(sale?.items)
        && sale.items.some(item => {
            const name = String(item?.name || '').trim().toLowerCase();
            const isVirtualAmount = item?.isCustomAmount === true
                || String(item?.id || '').startsWith('custom_')
                || name === 'venta libre';
            return !isVirtualAmount;
        });
}

/**
 * Compara los documentos de una caja sin mutarlos ni recalcular el carrito.
 * La fuente de verdad física son los snapshots del Kardex y sus operation_id.
 */
export function reconcileRemoteInventory({
    products = [],
    sales = [],
    kardex = [],
    operations = [],
    missingDocIds = [],
} = {}) {
    const safeProducts = Array.isArray(products) ? products : [];
    const safeSales = Array.isArray(sales) ? sales : [];
    const safeKardex = Array.isArray(kardex) ? kardex.filter(Boolean) : [];
    const safeOperations = Array.isArray(operations) ? operations.filter(Boolean) : [];
    const missing = [...new Set(Array.isArray(missingDocIds) ? missingDocIds : [])];
    const discrepancies = [];
    const warnings = [];
    const productsById = new Map(safeProducts.map(product => [String(product?.id), product]));
    const movementsByProduct = new Map();
    const movementsByReference = new Map();
    const movementIds = new Set();
    const operationProductKeys = new Set();

    for (const movement of safeKardex) {
        const productId = movement?.producto_id == null ? '' : String(movement.producto_id);
        const movementId = movement?.id == null ? '' : String(movement.id);
        const operationId = movement?.operation_id || movement?.metadata?.operationId || '';

        if (!productId) {
            discrepancies.push(issue(
                'MOVEMENT_PRODUCT_MISSING',
                'Movimiento sin producto_id.',
                { movementId },
            ));
        } else if (!productsById.has(productId)) {
            discrepancies.push(issue(
                'MOVEMENT_PRODUCT_UNKNOWN',
                'El movimiento referencia un producto que no existe en el catálogo remoto.',
                { movementId, productId },
            ));
        }

        if (movementId && movementIds.has(movementId)) {
            discrepancies.push(issue(
                'DUPLICATE_MOVEMENT_ID',
                'El mismo movimiento aparece más de una vez.',
                { movementId, productId },
            ));
        }
        if (movementId) movementIds.add(movementId);

        const quantity = number(movement?.cantidad);
        const stockBefore = number(movement?.stock_antes);
        const stockAfter = number(movement?.stock_despues);
        if (quantity === null || stockBefore === null || stockAfter === null
            || Math.abs(stockBefore + quantity - stockAfter) > EPSILON) {
            discrepancies.push(issue(
                'INVALID_STOCK_TRANSITION',
                'stock_antes + cantidad no coincide con stock_despues.',
                { movementId, productId, stockBefore, quantity, stockAfter },
            ));
        }

        if (operationId && productId) {
            const operationProductKey = `${operationId}:${productId}`;
            if (operationProductKeys.has(operationProductKey)) {
                discrepancies.push(issue(
                    'DUPLICATE_OPERATION_PRODUCT',
                    'Una operación tiene más de un movimiento para el mismo producto físico.',
                    { operationId, productId },
                ));
            }
            operationProductKeys.add(operationProductKey);
        }

        if (!movementsByProduct.has(productId)) movementsByProduct.set(productId, []);
        movementsByProduct.get(productId).push(movement);

        const referenceId = movement?.referencia_id;
        if (referenceId) {
            if (!movementsByReference.has(String(referenceId))) movementsByReference.set(String(referenceId), []);
            movementsByReference.get(String(referenceId)).push(movement);
        }
    }

    for (const [productId, movements] of movementsByProduct) {
        const chronological = [...movements].sort((a, b) => movementTimestamp(a) - movementTimestamp(b));
        for (let index = 1; index < chronological.length; index += 1) {
            const previous = chronological[index - 1];
            const current = chronological[index];
            const previousAfter = number(previous?.stock_despues);
            const currentBefore = number(current?.stock_antes);
            if (previousAfter !== null && currentBefore !== null
                && Math.abs(previousAfter - currentBefore) > EPSILON) {
                discrepancies.push(issue(
                    'BROKEN_STOCK_CONTINUITY',
                    'El stock final de un movimiento no coincide con el stock inicial del siguiente.',
                    { productId, previousMovementId: previous.id, movementId: current.id, previousAfter, currentBefore },
                ));
            }
        }

        const product = productsById.get(productId);
        const lastMovement = chronological[chronological.length - 1];
        const currentStock = number(product?.stock);
        const lastStock = number(lastMovement?.stock_despues);
        if (product && lastMovement && currentStock !== null && lastStock !== null
            && Math.abs(currentStock - lastStock) > EPSILON) {
            discrepancies.push(issue(
                'CURRENT_STOCK_MISMATCH',
                'El stock actual no coincide con el último stock_despues del Kardex.',
                { productId, productStock: currentStock, kardexStock: lastStock },
            ));
        }

        if (!chronological.some(movement => movement?.tipo === 'INICIAL')) {
            warnings.push(issue(
                'HISTORY_WITHOUT_INITIAL',
                'No existe movimiento INICIAL para reconstruir todo el historial de este producto.',
                { productId },
            ));
        }
    }

    for (const operation of safeOperations) {
        const status = String(operation?.status || '').toUpperCase();
        if (status === 'PENDING' || status === 'FAILED_RETRYABLE') {
            warnings.push(issue(
                'PENDING_OPERATION',
                'Existe una operación de inventario pendiente o recuperable.',
                { operationId: operation.operationId, status },
            ));
        }

        if (status === 'APPLIED_LOCAL') {
            const movementIdsForOperation = Array.isArray(operation.movementIds) ? operation.movementIds : [];
            const absent = movementIdsForOperation.filter(id => !movementIds.has(String(id)));
            if (absent.length > 0) {
                discrepancies.push(issue(
                    'APPLIED_OPERATION_WITHOUT_MOVEMENT',
                    'Una operación aplicada no tiene todos sus movimientos publicados.',
                    { operationId: operation.operationId, missingMovementIds: absent },
                ));
            }
        }
    }

    for (const sale of safeSales) {
        if (!SALE_TYPES.has(sale?.tipo) || !hasPhysicalItems(sale)) continue;
        const saleMovements = movementsByReference.get(String(sale.id)) || [];
        if (saleMovements.length === 0 && sale.status !== 'ANULADA') {
            warnings.push(issue(
                'SALE_WITHOUT_PHYSICAL_MOVEMENT',
                'Venta con artículos físicos sin movimientos Kardex enlazados.',
                { saleId: sale.id },
            ));
        }
        if (sale.status === 'ANULADA') {
            const hasSale = saleMovements.some(movement => movement.tipo === 'VENTA');
            const hasReturn = saleMovements.some(movement => movement.tipo === 'DEVOLUCION');
            if (hasSale && !hasReturn) {
                discrepancies.push(issue(
                    'VOID_WITHOUT_RETURN',
                    'Venta anulada con salida física, pero sin devolución enlazada.',
                    { saleId: sale.id },
                ));
            }
        }
    }

    if (missing.length > 0) {
        warnings.push(issue(
            'REMOTE_DATA_INCOMPLETE',
            'Faltan documentos remotos; no se puede declarar la auditoría como OK.',
            { missingDocIds: missing },
        ));
    }

    const status = missing.length > 0
        ? 'INCOMPLETE'
        : discrepancies.length > 0
            ? 'DISCREPANCIES'
            : warnings.length > 0
                ? 'REVIEW'
                : 'OK';

    return {
        ok: status === 'OK',
        status,
        checkedAt: new Date().toISOString(),
        totals: {
            products: safeProducts.length,
            sales: safeSales.length,
            movements: safeKardex.length,
            operations: safeOperations.length,
            discrepancies: discrepancies.length,
            warnings: warnings.length,
        },
        missingDocIds: missing,
        discrepancies,
        warnings,
    };
}
