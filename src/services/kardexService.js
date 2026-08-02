// src/services/kardexService.js
// Servicio Thread-Safe inmutable para la grabación y consulta de movimientos de Kardex.

import { storageService } from '../utils/storageService';
import { withLock } from '../utils/withLock';
import { logEvent } from './auditService';
import { queueCloudSync } from '../hooks/useCloudSync';

const KARDEX_KEY = 'bodega_kardex_v1';
const KARDEX_SNAPSHOTS_KEY = 'bodega_kardex_snapshots_v1';
const PRODUCTS_KEY = 'bodega_products_v1';

/**
 * Registra un nuevo movimiento de Kardex en IndexedDB (versión interna sin cerrojo para evitar reentrancia).
 * @param {Object} params - Datos del movimiento
 * @returns {Promise<{ success: boolean, movement?: Object, error?: string, duplicated?: boolean }>}
 */
export async function recordKardexMovementUnlocked(params) {
    const {
        deviceId = localStorage.getItem('dj_device_id') || 'CAJA_PRINCIPAL',
        sucursalId = 'principal',
        productoId,
        sku = '',
        productoNombre,
        tipo,              // 'VENTA', 'COMPRA', 'AJUSTE', 'MERMA', 'DEVOLUCION', 'INICIAL', 'CONTEO', 'AUTOCONSUMO'
        subtipo = 'SISTEMA',
        cantidad,          // Positivo (+) Entradas, Negativo (-) Salidas
        unidad = 'unidad',
        costoUnitario = 0,
        moneda = 'USD',
        referenciaId = null,
        referenciaTipo = null,
        referenciaNumero = null,
        cierreId = null,
        turnoId = null,
        usuarioId = null,
        usuarioNombre = null,
        supervisorId = null,
        motivo = null,
        observaciones = null,
        metadata = {}
    } = params || {};

    if (!productoId) return { success: false, error: 'productoId es requerido' };
    if (!tipo) return { success: false, error: 'tipo de movimiento es requerido' };
    const numQty = Number(cantidad);
    if (isNaN(numQty) || numQty === 0) return { success: false, error: 'cantidad inválida (debe ser distinta de 0)' };

    try {
        const kardex = await storageService.getItem(KARDEX_KEY, []) || [];
        const products = await storageService.getItem(PRODUCTS_KEY, []) || [];

        // ── Guardián de Idempotencia por Referencia ──────────────────
        if (referenciaId && referenciaTipo) {
            const existing = kardex.find(m =>
                m &&
                m.referencia_id === referenciaId &&
                m.referencia_tipo === referenciaTipo &&
                m.producto_id === productoId
            );
            if (existing) {
                console.log(`[KardexService] Movimiento duplicado omitido por idempotencia (${referenciaTipo}:${referenciaId}:${productoId})`);
                return { success: true, movement: existing, duplicated: true };
            }
        }

        const targetProd = products.find(p => p.id === productoId);
        const pName = productoNombre || targetProd?.name || 'Producto Desconocido';
        const pSku = sku || targetProd?.barcode || targetProd?.sku || '';
        const pUnit = unidad || targetProd?.unit || 'unidad';
        const unitCost = Number(costoUnitario || targetProd?.costUsd || targetProd?.cost || 0);

        // Re-leer stock actual fresco desde el producto
        const stockAntes = Number(targetProd?.stock) || 0;
        const stockDespues = stockAntes + numQty;

        const movement = {
            id: crypto.randomUUID(),
            device_id: deviceId,
            sucursal_id: sucursalId,
            producto_id: productoId,
            sku: pSku,
            producto_nombre: pName,
            tipo,
            subtipo,
            cantidad: numQty,
            unidad: pUnit,
            stock_antes: stockAntes,
            stock_despues: stockDespues,
            costo_unitario: unitCost,
            costo_total: Math.round(Math.abs(numQty) * unitCost * 100) / 100,
            moneda,
            referencia_id: referenciaId,
            referencia_tipo: referenciaTipo,
            referencia_numero: referenciaNumero,
            cierre_id: cierreId,
            turno_id: turnoId,
            usuario_id: usuarioId,
            usuario_nombre: usuarioNombre,
            supervisor_id: supervisorId,
            motivo,
            observaciones,
            metadata,
            created_at: new Date().toISOString()
        };

        const updatedKardex = [movement, ...kardex];
        await storageService.setItem(KARDEX_KEY, updatedKardex);
        queueCloudSync(KARDEX_KEY, updatedKardex);

        window.dispatchEvent(new CustomEvent('kardex_movement_recorded', { detail: movement }));
        logEvent('KARDEX', `MOVIMIENTO_${tipo}`, `${tipo} de ${numQty > 0 ? '+' : ''}${numQty} u en "${pName}" (Stock: ${stockAntes} → ${stockDespues})`);

        return { success: true, movement };
    } catch (err) {
        console.error('[KardexService] Error al registrar movimiento:', err);
        return { success: false, error: err?.message || 'Error al guardar movimiento de Kardex' };
    }
}

/**
 * Registra un nuevo movimiento de Kardex en IndexedDB dentro del cerrojo de concurrencia withLock.
 * @param {Object} params - Datos del movimiento
 * @returns {Promise<{ success: boolean, movement?: Object, error?: string, duplicated?: boolean }>}
 */
export async function recordKardexMovement(params) {
    return await withLock('pos_write_lock', async () => {
        return await recordKardexMovementUnlocked(params);
    });
}

/**
 * Obtiene el historial completo de movimientos de Kardex.
 * @returns {Promise<Array>} Lista de movimientos
 */
export async function getKardexHistory() {
    try {
        return await storageService.getItem(KARDEX_KEY, []) || [];
    } catch {
        return [];
    }
}

let _isSeeding = false;

/**
 * Registra los movimientos iniciales de inventario fundacionales en un solo lote atómico si el Kardex está vacío.
 * @param {Array} products - Productos actuales
 * @param {string} deviceId - ID del dispositivo
 * @param {Object} user - Usuario activo
 */
export async function seedInitialKardexIfEmpty(products, deviceId, user) {
    if (_isSeeding) return;
    if (!Array.isArray(products) || products.length === 0) return;

    return await withLock('pos_write_lock', async () => {
        const existing = await storageService.getItem(KARDEX_KEY, null);
        if (existing !== null && existing.length > 0) return;

        _isSeeding = true;
        try {
            console.log('[KardexService] Sembrando movimientos fundacionales INICIAL en el Kardex en lote...');
            const initialMovements = [];
            const nowIso = new Date().toISOString();

            for (const p of products) {
                if (!p || !p.id) continue;
                const initialStock = Number(p.stock) || 0;
                if (initialStock <= 0) continue;

                initialMovements.push({
                    id: crypto.randomUUID(),
                    device_id: deviceId || 'CAJA_PRINCIPAL',
                    sucursal_id: 'principal',
                    producto_id: p.id,
                    sku: p.barcode || p.sku || '',
                    producto_nombre: p.name,
                    tipo: 'INICIAL',
                    subtipo: 'CORTE_INICIAL',
                    cantidad: initialStock,
                    unidad: p.unit || 'unidad',
                    stock_antes: 0,
                    stock_despues: initialStock,
                    costo_unitario: Number(p.costUsd || p.cost || 0),
                    costo_total: Math.round(initialStock * Number(p.costUsd || p.cost || 0) * 100) / 100,
                    moneda: 'USD',
                    referencia_id: null,
                    referencia_tipo: 'INICIAL',
                    referencia_numero: 'INICIAL',
                    cierre_id: null,
                    turno_id: null,
                    usuario_id: user?.id || 'SISTEMA',
                    usuario_nombre: user?.nombre || 'Sistema',
                    supervisor_id: null,
                    motivo: 'Inventario inicial fundacional al activar Kardex',
                    observaciones: null,
                    metadata: {},
                    created_at: nowIso
                });
            }

            if (initialMovements.length > 0) {
                await storageService.setItem(KARDEX_KEY, initialMovements);
                queueCloudSync(KARDEX_KEY, initialMovements);
            }
        } finally {
            _isSeeding = false;
        }
    });
}

/**
 * Crea un Snapshot del inventario para un Cierre de Caja / Arqueo de Turno.
 * @param {string} cierreId - ID del cierre
 * @param {Array} products - Lista de productos al cierre
 * @param {Object} user - Usuario que ejecuta el cierre
 */
export async function createInventorySnapshot(cierreId, products, user) {
    if (!cierreId || !Array.isArray(products)) return;
    const deviceId = localStorage.getItem('dj_device_id') || 'CAJA_PRINCIPAL';

    let totalValor = 0;
    let totalItems = 0;
    const resumen = products.map(p => {
        const stock = Math.max(0, Number(p.stock) || 0);
        const cost = Math.max(0, Number(p.costUsd || p.cost || 0));
        const itemVal = stock * cost;
        totalValor += itemVal;
        totalItems += stock;
        return {
            productoId: p.id,
            productoNombre: p.name,
            sku: p.barcode || p.sku || '',
            stockTeorico: stock,
            costoUnitario: cost,
            valorTotalUsd: Math.round(itemVal * 100) / 100
        };
    });

    const snapshot = {
        id: crypto.randomUUID(),
        device_id: deviceId,
        cierre_id: cierreId,
        fecha_corte: new Date().toISOString(),
        usuario_id: user?.id || null,
        usuario_nombre: user?.nombre || 'Sistema',
        total_items: totalItems,
        total_valorizado_usd: Math.round(totalValor * 100) / 100,
        resumen_productos: resumen,
        created_at: new Date().toISOString()
    };

    return await withLock('pos_write_lock', async () => {
        const snapshots = await storageService.getItem(KARDEX_SNAPSHOTS_KEY, []) || [];
        const updated = [snapshot, ...snapshots];
        await storageService.setItem(KARDEX_SNAPSHOTS_KEY, updated);
        queueCloudSync(KARDEX_SNAPSHOTS_KEY, updated);
        return snapshot;
    });
}
