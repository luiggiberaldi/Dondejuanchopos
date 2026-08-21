/**
 * src/utils/supervisorStockProjection.js
 *
 * Proyección optimista de stock para el Monitor del Supervisor.
 * Extraído de OwnerMonitorView.jsx (refactor 2026-08-21).
 */
export function applyProjectedStock(baseStock, changes = []) {
    let stock = Math.max(0, Number(baseStock) || 0);
    for (const change of changes) {
        if (change?.action !== 'adjust_stock') continue;
        const target = change.data?.targetStock;
        if (target !== undefined && target !== null && target !== '') {
            const parsedTarget = Number(target);
            if (!Number.isNaN(parsedTarget)) stock = Math.max(0, parsedTarget);
        } else {
            stock = Math.max(0, stock + (Number(change.data?.delta) || 0));
        }
    }
    return stock;
}
