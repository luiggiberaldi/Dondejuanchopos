/**
 * src/utils/supervisorStockProjection.js
 *
 * Proyección optimista de stock para el Monitor del Supervisor.
 * Extraído de OwnerMonitorView.jsx (refactor 2026-08-21).
 */
export function hasSupervisorReceipt(product, change) {
    const id = change?.commandId;
    if (!product || !id) return false;
    return product.lastOperationId === id || product.lastStockOperationId === id
        || (Array.isArray(product.stockOperationIds) && product.stockOperationIds.includes(id));
}

export function shouldProjectSupervisorChange(change, product) {
    // Una confirmación sin eco se presenta como espera, no como otra mutación
    // de la base canónica. Los recibos excluyen el delta incluso antes del ACK.
    if (['awaiting_catalog', 'rejected_local'].includes(change?.syncState) || hasSupervisorReceipt(product, change)) return false;
    return true;
}

export function applyProjectedStock(baseStock, changes = []) {
    let stock = Number(baseStock) || 0;
    for (const change of changes) {
        if (change?.action !== 'adjust_stock') continue;
        const target = change.data?.targetStock;
        if (target !== undefined && target !== null && target !== '') {
            const parsedTarget = Number(target);
            if (!Number.isNaN(parsedTarget)) stock = parsedTarget;
        } else {
            stock = stock + (Number(change.data?.delta) || 0);
        }
    }
    return stock;
}
