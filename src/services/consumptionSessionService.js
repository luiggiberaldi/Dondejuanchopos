// src/services/consumptionSessionService.js
// Servicio Thread-Safe para administrar Fichas de Consumo Diferido en Sitio (Caja de Cervezas / Combos Modulares)

import { storageService } from '../utils/storageService';
import { withLock } from '../utils/withLock';
import { recordKardexMovement } from './kardexService';
import { pushCloudSync } from '../hooks/useCloudSync';

export const CONSUMPTION_SESSIONS_KEY = 'bodega_consumption_sessions_v1';
const PRODUCTS_KEY = 'bodega_products_v1';

/**
 * Crea una nueva Ficha de Consumo Activa vinculada a una Venta cuando se cobra un combo diferido.
 */
export async function createSessionFromSale(sale, cartItem) {
    if (!sale || !cartItem) return null;

    const customerRef = (cartItem.deferredCustomerRef || sale.customerName || 'Cliente en Sitio').trim();
    
    // Determinar la cuota total de unidades del combo
    let totalQuota = 0;
    if (cartItem.modularGroups && Array.isArray(cartItem.modularGroups)) {
        totalQuota = cartItem.modularGroups.reduce((sum, g) => sum + (Number(g.requiredQty) || 0), 0);
    }
    if (totalQuota <= 0) {
        totalQuota = Number(cartItem.totalUnits) || 36;
    }
    totalQuota = totalQuota * (Number(cartItem.quantity) || 1);

    // Selecciones iniciales realizadas en caja al cobrar (si las hay)
    const initialItems = (cartItem.modularSelections || []).filter(s => s.productId && Number(s.qty) > 0);
    const initialServedCount = initialItems.reduce((sum, i) => sum + Number(i.qty), 0);
    const isInitialCompleted = initialServedCount >= totalQuota;

    const initialDispatchId = crypto.randomUUID();
    const initialDispatches = initialItems.length > 0 ? [{
        id: initialDispatchId,
        timestamp: new Date().toISOString(),
        cashier: sale.cashier || 'Cajero',
        items: initialItems.map(i => ({
            productId: i.productId,
            productName: i.productName || 'Cerveza',
            qty: Number(i.qty),
            costUsd: Number(i.costUsd || 0)
        }))
    }] : [];

    const newSession = {
        id: `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        saleId: sale.id,
        saleNumber: sale.saleNumber || (sale.id ? sale.id.slice(-6) : 'N/A'),
        customerRef,
        comboId: cartItem.id,
        comboName: cartItem.name,
        totalQuota,
        servedCount: initialServedCount,
        status: isInitialCompleted ? 'COMPLETED' : 'OPEN', // 'OPEN', 'COMPLETED', 'CANCELLED'
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: isInitialCompleted ? new Date().toISOString() : null,
        dispatches: initialDispatches
    };

    return await withLock('pos_write_lock', async () => {
        try {
            // Descontar inventario físico y registrar en Kardex si hubo selección inicial
            if (initialItems.length > 0) {
                const products = await storageService.getItem(PRODUCTS_KEY, []) || [];
                const updatedProducts = products.map(p => {
                    const foundSel = initialItems.find(it => it.productId === p.id);
                    if (foundSel) {
                        const newStock = Math.max(0, (Number(p.stock) || 0) - Number(foundSel.qty));
                        return { ...p, stock: newStock };
                    }
                    return p;
                });
                await storageService.setItem(PRODUCTS_KEY, updatedProducts);

                for (const item of initialItems) {
                    const targetProd = products.find(p => p.id === item.productId);
                    await recordKardexMovement({
                        productoId: item.productId,
                        productoNombre: targetProd?.name || item.productName || 'Producto Cerveza',
                        sku: targetProd?.barcode || targetProd?.sku || '',
                        tipo: 'SALIDA_CONSUMO_DIFERIDO',
                        subtipo: 'ENTREGA_INICIAL',
                        cantidad: -Math.abs(Number(item.qty)),
                        costoUnitario: Number(targetProd?.costUsd || targetProd?.cost || 0),
                        referenciaId: initialDispatchId,
                        referenciaTipo: 'CONSUMO_DIFERIDO',
                        referenciaNumero: newSession.saleNumber,
                        usuarioNombre: sale.cashier || 'Cajero',
                        motivo: `Entrega inicial Ficha: ${customerRef} (${item.qty} u)`,
                        metadata: {
                            sessionId: newSession.id,
                            saleId: sale.id,
                            customerRef
                        }
                    });
                }
            }

            const sessions = await storageService.getItem(CONSUMPTION_SESSIONS_KEY, []) || [];
            const updatedSessions = [newSession, ...sessions];
            await storageService.setItem(CONSUMPTION_SESSIONS_KEY, updatedSessions);

            try {
                await pushCloudSync(CONSUMPTION_SESSIONS_KEY, updatedSessions, true);
            } catch (syncErr) {
                console.warn('[ConsumptionService] Error al sincronizar ficha en la nube:', syncErr);
            }

            window.dispatchEvent(new CustomEvent('consumption-sessions-updated'));
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: PRODUCTS_KEY } }));
            return newSession;
        } catch (err) {
            console.error('[ConsumptionService] Error al crear ficha de consumo:', err);
            return null;
        }
    });
}

/**
 * Obtiene todas las fichas de consumo activas (OPEN).
 */
export async function getActiveSessions() {
    try {
        const sessions = await storageService.getItem(CONSUMPTION_SESSIONS_KEY, []) || [];
        return sessions.filter(s => s && s.status === 'OPEN');
    } catch {
        return [];
    }
}

/**
 * Obtiene el historial completo de fichas de consumo.
 */
export async function getAllSessions() {
    try {
        return await storageService.getItem(CONSUMPTION_SESSIONS_KEY, []) || [];
    } catch {
        return [];
    }
}

/**
 * Registra una entrega parcial de productos en una ficha de consumo.
 * Descuenta stock físico de cada SKU servido, registra en Kardex y actualiza la cuota.
 */
export async function registerPartialDispatch(sessionId, dispatchedItems, cashierName = 'Cajero') {
    if (!sessionId || !Array.isArray(dispatchedItems) || dispatchedItems.length === 0) {
        return { success: false, error: 'Parámetros de despacho inválidos' };
    }

    const validItems = dispatchedItems.filter(i => i.productId && Number(i.qty) > 0);
    if (validItems.length === 0) {
        return { success: false, error: 'Debes seleccionar al menos 1 unidad para entregar' };
    }

    const dispatchTotalQty = validItems.reduce((sum, i) => sum + Number(i.qty), 0);

    return await withLock('consumption_dispatch_lock', async () => {
        try {
            const sessions = await storageService.getItem(CONSUMPTION_SESSIONS_KEY, []) || [];
            const products = await storageService.getItem(PRODUCTS_KEY, []) || [];

            const sessionIndex = sessions.findIndex(s => s.id === sessionId);
            if (sessionIndex === -1) {
                return { success: false, error: 'Ficha de consumo no encontrada' };
            }

            const session = sessions[sessionIndex];
            if (session.status !== 'OPEN') {
                return { success: false, error: 'Esta ficha de consumo ya no está activa' };
            }

            // 1. Guardagujas Guardrail: Límite de Cuota
            const remainingQuota = session.totalQuota - session.servedCount;
            if (dispatchTotalQty > remainingQuota) {
                return {
                    success: false,
                    error: `No se pueden despachar ${dispatchTotalQty} unidades. Solo quedan ${remainingQuota} por servir.`
                };
            }

            // 2. Guardagujas Guardrail: Stock Disponible por Producto
            for (const item of validItems) {
                const prod = products.find(p => p.id === item.productId);
                if (!prod) {
                    return { success: false, error: `Producto con ID "${item.productId}" no encontrado` };
                }
                const currentStock = Number(prod.stock) || 0;
                if (currentStock < item.qty) {
                    return {
                        success: false,
                        error: `Stock insuficiente para "${prod.name}". Disponible: ${currentStock}, Solicitado: ${item.qty}`
                    };
                }
            }

            // 3. Descontar Inventario Físico de Productos y Registrar Kardex
            const updatedProducts = products.map(p => {
                const matchItem = validItems.find(i => i.productId === p.id);
                if (matchItem) {
                    const oldStock = Number(p.stock) || 0;
                    return {
                        ...p,
                        stock: oldStock - Number(matchItem.qty),
                        updatedAt: new Date().toISOString()
                    };
                }
                return p;
            });

            // 4. Crear registro de despacho con ID único
            const dispatchRecord = {
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                cashier: cashierName,
                items: validItems.map(i => {
                    const targetProd = products.find(p => p.id === i.productId);
                    return {
                        productId: i.productId,
                        productName: targetProd?.name || i.productName || 'Cerveza',
                        qty: Number(i.qty),
                        costUsd: Number(targetProd?.costUsd || targetProd?.cost || 0)
                    };
                })
            };

            // Registrar movimientos en Kardex para cada producto despachado
            for (const item of validItems) {
                const targetProd = products.find(p => p.id === item.productId);
                await recordKardexMovement({
                    productoId: item.productId,
                    productoNombre: targetProd?.name || item.productName || 'Producto Cerveza',
                    sku: targetProd?.barcode || targetProd?.sku || '',
                    tipo: 'SALIDA_CONSUMO_DIFERIDO',
                    subtipo: 'ENTREGA_PARCIAL',
                    cantidad: -Math.abs(Number(item.qty)),
                    costoUnitario: Number(targetProd?.costUsd || targetProd?.cost || 0),
                    referenciaId: dispatchRecord.id,
                    referenciaTipo: 'CONSUMO_DIFERIDO',
                    referenciaNumero: session.saleNumber,
                    usuarioNombre: cashierName,
                    motivo: `Despacho Ficha: ${session.customerRef} (${item.qty} u)`,
                    metadata: {
                        sessionId: session.id,
                        saleId: session.saleId,
                        customerRef: session.customerRef,
                        comboName: session.comboName
                    }
                });
            }

            const newServedCount = session.servedCount + dispatchTotalQty;
            const isFullyCompleted = newServedCount >= session.totalQuota;

            const updatedSession = {
                ...session,
                servedCount: newServedCount,
                status: isFullyCompleted ? 'COMPLETED' : 'OPEN',
                completedAt: isFullyCompleted ? new Date().toISOString() : null,
                updatedAt: new Date().toISOString(),
                dispatches: [...(session.dispatches || []), dispatchRecord]
            };

            const updatedSessions = [...sessions];
            updatedSessions[sessionIndex] = updatedSession;

            // 5. Persistir en IndexedDB y Sincronizar en la Nube
            await storageService.setItem(PRODUCTS_KEY, updatedProducts);
            await storageService.setItem(CONSUMPTION_SESSIONS_KEY, updatedSessions);

            try {
                await pushCloudSync(PRODUCTS_KEY, updatedProducts, true);
                await pushCloudSync(CONSUMPTION_SESSIONS_KEY, updatedSessions, true);
            } catch (syncErr) {
                console.warn('[ConsumptionService] Error en push de sincronización post-despacho:', syncErr);
            }

            // Notificar cambios al sistema React
            window.dispatchEvent(new CustomEvent('consumption-sessions-updated'));
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: PRODUCTS_KEY } }));

            return {
                success: true,
                session: updatedSession,
                updatedProducts,
                isCompleted: isFullyCompleted
            };
        } catch (err) {
            console.error('[ConsumptionService] Error al registrar despacho parcial:', err);
            return { success: false, error: err?.message || 'Error al procesar despacho' };
        }
    });
}

/**
 * Anula una ficha de consumo asociada a una venta anulada y restituye el stock
 * de las unidades que ya hubiesen sido despachadas físicamente.
 */
export async function cancelSessionBySaleId(saleId, cashierName = 'Supervisor') {
    if (!saleId) return false;

    return await withLock('consumption_dispatch_lock', async () => {
        try {
            const sessions = await storageService.getItem(CONSUMPTION_SESSIONS_KEY, []) || [];
            const sessionIndex = sessions.findIndex(s => s.saleId === saleId && s.status !== 'CANCELLED');
            if (sessionIndex === -1) return false;

            const session = sessions[sessionIndex];
            const products = await storageService.getItem(PRODUCTS_KEY, []) || [];

            // Si se despacharon unidades, devolverlas al stock físico
            const itemsToRefund = {};
            if (session.dispatches && Array.isArray(session.dispatches)) {
                session.dispatches.forEach(d => {
                    if (d.items && Array.isArray(d.items)) {
                        d.items.forEach(it => {
                            itemsToRefund[it.productId] = (itemsToRefund[it.productId] || 0) + Number(it.qty);
                        });
                    }
                });
            }

            const updatedProducts = products.map(p => {
                const refundQty = itemsToRefund[p.id];
                if (refundQty && refundQty > 0) {
                    return {
                        ...p,
                        stock: (Number(p.stock) || 0) + refundQty,
                        updatedAt: new Date().toISOString()
                    };
                }
                return p;
            });

            // Registrar movimientos de reversión en Kardex
            for (const [prodId, qty] of Object.entries(itemsToRefund)) {
                if (qty > 0) {
                    const targetProd = products.find(p => p.id === prodId);
                    await recordKardexMovement({
                        productoId: prodId,
                        productoNombre: targetProd?.name || 'Cerveza',
                        sku: targetProd?.barcode || targetProd?.sku || '',
                        tipo: 'DEVOLUCION',
                        subtipo: 'ANULACION_CONSUMO_DIFERIDO',
                        cantidad: qty,
                        referenciaId: session.id,
                        referenciaTipo: 'ANULACION_CONSUMO_DIFERIDO',
                        usuarioNombre: cashierName,
                        motivo: `Anulación Venta ${saleId} - Devolución Ficha Consumo (${qty} u)`
                    });
                }
            }

            const updatedSession = {
                ...session,
                status: 'CANCELLED',
                cancelledAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            const updatedSessions = [...sessions];
            updatedSessions[sessionIndex] = updatedSession;

            await storageService.setItem(PRODUCTS_KEY, updatedProducts);
            await storageService.setItem(CONSUMPTION_SESSIONS_KEY, updatedSessions);

            try {
                await pushCloudSync(PRODUCTS_KEY, updatedProducts, true);
                await pushCloudSync(CONSUMPTION_SESSIONS_KEY, updatedSessions, true);
            } catch (e) {}

            window.dispatchEvent(new CustomEvent('consumption-sessions-updated'));
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: PRODUCTS_KEY } }));

            return true;
        } catch (err) {
            console.error('[ConsumptionService] Error al anular ficha de consumo:', err);
            return false;
        }
    });
}

/**
 * Revierte una ronda de entrega parcial de consumo diferido.
 * Reintegra las unidades al stock físico de los productos, descuenta la cuota servida,
 * reabre la ficha si estaba completada y registra movimiento en Kardex.
 */
export async function revertDispatchRound(sessionId, dispatchId, cashierName = 'Cajero') {
    if (!sessionId || !dispatchId) {
        return { success: false, error: 'Parámetros insuficientes para revertir' };
    }

    return await withLock('consumption_dispatch_lock', async () => {
        try {
            const sessions = await storageService.getItem(CONSUMPTION_SESSIONS_KEY, []) || [];
            const products = await storageService.getItem(PRODUCTS_KEY, []) || [];

            const sessionIndex = sessions.findIndex(s => s.id === sessionId);
            if (sessionIndex === -1) {
                return { success: false, error: 'Ficha de consumo no encontrada' };
            }

            const session = sessions[sessionIndex];
            const dispatches = session.dispatches || [];
            const targetDispatchIndex = dispatches.findIndex(d => d.id === dispatchId);

            if (targetDispatchIndex === -1) {
                return { success: false, error: 'Ronda de despacho no encontrada en la ficha' };
            }

            const targetDispatch = dispatches[targetDispatchIndex];
            const dispatchItems = targetDispatch.items || [];
            const revertTotalQty = dispatchItems.reduce((sum, i) => sum + (Number(i.qty) || 0), 0);

            // 1. Restituir inventario físico de productos
            const updatedProducts = products.map(p => {
                const matchItem = dispatchItems.find(i => i.productId === p.id);
                if (matchItem) {
                    const currentStock = Number(p.stock) || 0;
                    return {
                        ...p,
                        stock: currentStock + Number(matchItem.qty),
                        updatedAt: new Date().toISOString()
                    };
                }
                return p;
            });

            // 2. Registrar movimientos de reversión en Kardex
            for (const item of dispatchItems) {
                const targetProd = products.find(p => p.id === item.productId);
                await recordKardexMovement({
                    productoId: item.productId,
                    productoNombre: targetProd?.name || item.productName || 'Producto Cerveza',
                    sku: targetProd?.barcode || targetProd?.sku || '',
                    tipo: 'DEVOLUCION',
                    subtipo: 'REVERSION_CONSUMO_DIFERIDO',
                    cantidad: Math.abs(Number(item.qty)), // Entra (+) al inventario
                    costoUnitario: Number(targetProd?.costUsd || targetProd?.cost || 0),
                    referenciaId: targetDispatch.id,
                    referenciaTipo: 'REVERSION_CONSUMO_DIFERIDO',
                    referenciaNumero: session.saleNumber,
                    usuarioNombre: cashierName,
                    motivo: `Reversión entrega parcial: ${session.customerRef} (${item.qty} u)`,
                    metadata: {
                        saleId: session.saleId,
                        customerRef: session.customerRef,
                        comboName: session.comboName,
                        dispatchId: targetDispatch.id
                    }
                });
            }

            // 3. Actualizar Estado de la Ficha
            const updatedDispatches = dispatches.filter(d => d.id !== dispatchId);
            const newServedCount = Math.max(0, session.servedCount - revertTotalQty);

            const updatedSession = {
                ...session,
                servedCount: newServedCount,
                status: 'OPEN', // Reabre automáticamente la ficha si estaba completada
                completedAt: null,
                updatedAt: new Date().toISOString(),
                dispatches: updatedDispatches
            };

            const updatedSessions = [...sessions];
            updatedSessions[sessionIndex] = updatedSession;

            // 4. Persistir en IndexedDB y Sincronizar en la Nube
            await storageService.setItem(PRODUCTS_KEY, updatedProducts);
            await storageService.setItem(CONSUMPTION_SESSIONS_KEY, updatedSessions);

            try {
                await pushCloudSync(PRODUCTS_KEY, updatedProducts, true);
                await pushCloudSync(CONSUMPTION_SESSIONS_KEY, updatedSessions, true);
            } catch (syncErr) {
                console.warn('[ConsumptionService] Error al sincronizar reversión en la nube:', syncErr);
            }

            // Notificar cambios al sistema React
            window.dispatchEvent(new CustomEvent('consumption-sessions-updated'));
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: PRODUCTS_KEY } }));

            return {
                success: true,
                session: updatedSession,
                revertedQty: revertTotalQty
            };
        } catch (err) {
            console.error('[ConsumptionService] Error al revertir ronda de despacho:', err);
            return { success: false, error: err?.message || 'Error inesperado al revertir entrega' };
        }
    });
}

