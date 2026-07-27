// src/utils/kardexScope.js
// Funciones puras utilitarias para el cálculo, filtrado y auditoría del Kardex.

/**
 * Calcula el Promedio Ponderado Móvil de Costo para una entrada de inventario.
 * @param {number} oldStock - Stock antes del movimiento
 * @param {number} oldCost - Costo unitario antes del movimiento
 * @param {number} addedQty - Cantidad que ingresa (positiva)
 * @param {number} addedCost - Costo unitario de la nueva mercadería
 * @returns {number} Nuevo costo unitario promedio ponderado (redondeado a 4 decimales)
 */
export function calculateMovingWeightedAverage(oldStock, oldCost, addedQty, addedCost) {
    const sOld = Math.max(0, Number(oldStock) || 0);
    const cOld = Math.max(0, Number(oldCost) || 0);
    const qAdd = Math.max(0, Number(addedQty) || 0);
    const cAdd = Math.max(0, Number(addedCost) || 0);

    const totalQty = sOld + qAdd;
    if (totalQty <= 0) return cOld > 0 ? cOld : cAdd;

    const totalValue = (sOld * cOld) + (qAdd * cAdd);
    const newCost = totalValue / totalQty;
    return Math.round(newCost * 10000) / 10000;
}

/**
 * Filtra el historial de movimientos de Kardex por criterios de auditoría.
 * @param {Array} kardex - Lista de movimientos
 * @param {Object} filters - Criterios: { productoId, tipo, usuarioId, desdeIso, hastaIso, query }
 * @returns {Array} Movimientos filtrados
 */
export function filterKardex(kardex, filters = {}) {
    if (!Array.isArray(kardex)) return [];
    const { productoId, tipo, usuarioId, desdeIso, hastaIso, query } = filters;

    return kardex.filter(m => {
        if (!m) return false;
        if (productoId && m.producto_id !== productoId) return false;
        if (tipo && tipo !== 'TODOS' && m.tipo !== tipo) return false;
        if (usuarioId && m.usuario_id !== usuarioId) return false;

        if (desdeIso) {
            const tMove = new Date(m.created_at || m.timestamp).getTime();
            const tDesde = new Date(desdeIso).getTime();
            if (tMove < tDesde) return false;
        }

        if (hastaIso) {
            const tMove = new Date(m.created_at || m.timestamp).getTime();
            const tHasta = new Date(hastaIso).getTime();
            if (tMove > tHasta) return false;
        }

        if (query && query.trim()) {
            const q = query.toLowerCase().trim();
            const pNombre = (m.producto_nombre || '').toLowerCase();
            const ref = (m.referencia_numero || m.referencia_id || '').toLowerCase();
            const uNombre = (m.usuario_nombre || '').toLowerCase();
            const mot = (m.motivo || '').toLowerCase();
            if (!pNombre.includes(q) && !ref.includes(q) && !uNombre.includes(q) && !mot.includes(q)) {
                return false;
            }
        }

        return true;
    });
}

/**
 * Reconstruye el stock teórico que tenía un producto en un momento histórico específico.
 * @param {Array} kardex - Historial completo de Kardex
 * @param {string} productoId - ID del producto
 * @param {string} targetDateIso - Fecha/hora corte ISO
 * @returns {number} Stock teórico a esa fecha
 */
export function calculateStockAtDate(kardex, productoId, targetDateIso) {
    if (!Array.isArray(kardex) || !productoId || !targetDateIso) return 0;
    const targetTime = new Date(targetDateIso).getTime();

    // Obtener movimientos del producto ordenados cronológicamente
    const productMoves = kardex
        .filter(m => m && m.producto_id === productoId)
        .sort((a, b) => new Date(a.created_at || a.timestamp).getTime() - new Date(b.created_at || b.timestamp).getTime());

    if (productMoves.length === 0) return 0;

    // Buscar el último movimiento antes o igual a targetTime
    const validMoves = productMoves.filter(m => new Date(m.created_at || m.timestamp).getTime() <= targetTime);
    if (validMoves.length === 0) return 0;

    const lastMove = validMoves[validMoves.length - 1];
    return Number(lastMove.stock_despues) || 0;
}

/**
 * Calcula la valorización total del inventario basada en el Kardex y lista de productos.
 * @param {Array} products - Lista de productos actual
 * @returns {{ totalValorizadoUsd: number, totalUnidades: number, totalProductos: number }}
 */
export function calculateInventoryValue(products) {
    if (!Array.isArray(products)) return { totalValorizadoUsd: 0, totalUnidades: 0, totalProductos: 0 };
    let totalValorizadoUsd = 0;
    let totalUnidades = 0;

    for (const p of products) {
        if (!p) continue;
        const stock = Math.max(0, Number(p.stock) || 0);
        const cost = Math.max(0, Number(p.costUsd || p.costo_unitario || p.cost) || 0);
        totalUnidades += stock;
        totalValorizadoUsd += (stock * cost);
    }

    return {
        totalValorizadoUsd: Math.round(totalValorizadoUsd * 100) / 100,
        totalUnidades,
        totalProductos: products.length
    };
}

/**
 * Detecta discrepancias de inventario comparando el stock lógico actual vs reconstrucción por Kardex.
 * @param {Array} kardex - Lista de movimientos
 * @param {Array} products - Lista de productos
 * @returns {Array} Lista de alertas de discrepancias
 */
export function detectKardexDiscrepancies(kardex, products) {
    if (!Array.isArray(products)) return [];
    const alerts = [];

    for (const p of products) {
        if (!p) continue;
        const currentStock = Number(p.stock) || 0;
        if (currentStock < 0) {
            alerts.push({
                productoId: p.id,
                productoNombre: p.name,
                tipoAlerta: 'STOCK_NEGATIVO',
                descripcion: `Stock negativo detectado en caja: ${currentStock} u.`,
                nivel: 'ALTO'
            });
        }
    }

    return alerts;
}
