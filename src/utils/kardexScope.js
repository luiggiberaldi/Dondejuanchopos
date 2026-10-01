// src/utils/kardexScope.js
// Funciones puras utilitarias para el cálculo, filtrado y auditoría del Kardex.

import { getLocalISODate } from './dateHelpers';
import { round2 } from './dinero';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function getMovementLocalDate(movement) {
    const raw = movement?.created_at || movement?.timestamp;
    if (!raw) return '';
    if (typeof raw === 'string' && DATE_ONLY_PATTERN.test(raw.trim())) return raw.trim();
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? '' : getLocalISODate(date);
}

function csvCell(value) {
    const text = value == null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

export const KARDEX_CSV_HEADERS = Object.freeze([
    'Fecha/Hora', 'Producto', 'SKU', 'Tipo', 'Subtipo', 'Cantidad',
    'Stock Antes', 'Stock Después', 'Costo U (USD)', 'Costo Total (USD)',
    'Referencia', 'Tipo Referencia', 'Operation ID', 'Usuario', 'Motivo', 'Metadata'
]);

/**
 * Aplica los filtros visuales del Kardex usando fechas calendario locales.
 * Central y Supervisor remoto deben pasar por esta misma función para no mezclar
 * límites UTC con la fecha que ve el usuario.
 */
export function filterKardexByLocalDate(kardex, filters = {}) {
    const { fechaExacta, fechaDesde, fechaHasta, ...scopeFilters } = filters;
    return filterKardex(kardex, {
        ...scopeFilters,
        desdeIso: null,
        hastaIso: null,
    }).filter(movement => {
        const localDate = getMovementLocalDate(movement);
        if (!localDate) return !fechaExacta && !fechaDesde && !fechaHasta;
        if (fechaExacta) return localDate === fechaExacta;
        if (fechaDesde && localDate < fechaDesde) return false;
        if (fechaHasta && localDate > fechaHasta) return false;
        return true;
    });
}

/** Genera el CSV canónico compartido por Kardex central y remoto. */
export function buildKardexCsv(movements = []) {
    const rows = (Array.isArray(movements) ? movements : []).map(movement => [
        movement?.created_at || movement?.timestamp || '',
        movement?.producto_nombre || '',
        movement?.sku || '',
        movement?.tipo || '',
        movement?.subtipo || '',
        movement?.cantidad ?? '',
        movement?.stock_antes ?? '',
        movement?.stock_despues ?? '',
        movement?.costo_unitario ?? '',
        movement?.costo_total ?? '',
        movement?.referencia_numero || movement?.referencia_id || '',
        movement?.referencia_tipo || '',
        movement?.operation_id || movement?.metadata?.operationId || '',
        movement?.usuario_nombre || '',
        movement?.motivo || movement?.observaciones || '',
        movement?.metadata ? JSON.stringify(movement.metadata) : '',
    ]);

    return [
        KARDEX_CSV_HEADERS.map(csvCell).join(','),
        ...rows.map(row => row.map(csvCell).join(',')),
    ].join('\n');
}

export function getKardexMovementLocalDate(movement) {
    return getMovementLocalDate(movement);
}


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
    return round2(newCost);
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
        if (tipo && tipo !== 'TODOS' && m.tipo !== tipo && m.subtipo !== tipo) return false;
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
            const pNombre = String(m.producto_nombre || '').toLowerCase();
            const ref = String(m.referencia_numero != null && m.referencia_numero !== '' ? m.referencia_numero : (m.referencia_id || '')).toLowerCase();
            const uNombre = String(m.usuario_nombre || '').toLowerCase();
            const mot = String(m.motivo || '').toLowerCase();
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
        totalValorizadoUsd: round2(totalValorizadoUsd),
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
