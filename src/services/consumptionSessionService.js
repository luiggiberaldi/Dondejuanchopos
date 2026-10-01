// src/services/consumptionSessionService.js
// Servicio Thread-Safe para administrar Fichas de Consumo Diferido en Sitio (Caja de Cervezas / Combos Modulares)

import { storageService } from '../utils/storageService';
import { withLock } from '../utils/withLock';
import { applyInventoryOperationUnlocked } from './inventoryOperationService';
import { pushCloudSync } from '../hooks/useCloudSync';

export const CONSUMPTION_SESSIONS_KEY = 'bodega_consumption_sessions_v1';
const PRODUCTS_KEY = 'bodega_products_v1';

function normalizeActor(actorOrName, fallback = {}) {
    const actor = typeof actorOrName === 'object' && actorOrName !== null
        ? actorOrName
        : fallback;
    return {
        usuarioId: actor.usuarioId || actor.id || actor.userId || null,
        usuarioNombre: actor.usuarioNombre || actor.nombre || actor.usuario || actor.userName
            || (typeof actorOrName === 'string' ? actorOrName : 'Sistema'),
        usuarioRol: actor.usuarioRol || actor.rol || actor.userRole || 'SYSTEM',
        supervisorId: actor.supervisorId || null,
    };
}

/**
 * Crea una nueva Ficha de Consumo Activa vinculada a una Venta (versión interna sin cerrojo).
 */
export async function createSessionFromSaleUnlocked(sale, cartItem) {
    if (!sale || !cartItem) return null;

    const customerRef = (cartItem.deferredCustomerRef || sale.customerName || 'Cliente en Sitio').trim();
    const sessionId = `session_${String(sale.id)}_${String(cartItem.id || cartItem._originalId || 'item')}`
        .replace(/[^a-zA-Z0-9:_-]/g, '_');
    const sessions = await storageService.getItem(CONSUMPTION_SESSIONS_KEY, []) || [];
    const existingSession = sessions.find(session => (
        session.saleId === sale.id && session.comboId === cartItem.id
    ));
    if (existingSession) return existingSession;
    
    // Determinar la cuota total de unidades del combo
    let totalQuota = 0;
    if (cartItem.modularGroups && Array.isArray(cartItem.modularGroups)) {
        totalQuota = cartItem.modularGroups.reduce((sum, g) => sum + (Number(g.requiredQty) || 0), 0);
    }
    if (totalQuota <= 0) {
        totalQuota = Number(cartItem.totalUnits) || 36;
    }
    totalQuota = totalQuota * (Number(cartItem.qty ?? cartItem.quantity) || 1);

    // Selecciones iniciales realizadas en caja al cobrar (si las hay)
    const initialItems = (cartItem.modularSelections || []).filter(s => s.productId && Number(s.qty) > 0);
    const initialServedCount = initialItems.reduce((sum, i) => sum + Number(i.qty), 0);
    const isInitialCompleted = initialServedCount >= totalQuota;

    const initialDispatchId = `dispatch_${sessionId}_initial`;
    const saleActor = normalizeActor(sale.actor || {
        id: sale.cajeroId || sale.usuarioId,
        nombre: sale.cajero || sale.usuarioNombre,
        rol: sale.cajeroRol || sale.usuarioRol,
    });
    const initialDispatches = initialItems.length > 0 ? [{
        id: initialDispatchId,
        timestamp: new Date().toISOString(),
        cashier: saleActor.usuarioNombre,
        actorId: saleActor.usuarioId,
        actorRole: saleActor.usuarioRol,
        items: initialItems.map(i => ({
            productId: i.productId,
            productName: i.productName || 'Cerveza',
            qty: Number(i.qty),
            costUsd: Number(i.costUsd || 0)
        }))
    }] : [];

    const newSession = {
        id: sessionId,
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
        createdBy: saleActor,
        deviceId: typeof localStorage !== 'undefined' ? localStorage.getItem('dj_device_id') || 'CAJA_PRINCIPAL' : 'CAJA_PRINCIPAL',
        dispatches: initialDispatches
    };

    try {
        // Descontar inventario físico y registrar Kardex como una sola operación.
        if (initialItems.length > 0) {
            const inventoryResult = await applyInventoryOperationUnlocked({
                operationId: `dispatch_${initialDispatchId}`,
                referenceId: initialDispatchId,
                referenceType: 'CONSUMO_DIFERIDO',
                source: 'CONSUMO_DIFERIDO',
                tipo: 'SALIDA_CONSUMO_DIFERIDO',
                subtipo: 'ENTREGA_INICIAL',
                reason: 'Entrega inicial',
                allowNegative: false,
                actor: saleActor,
                deductions: initialItems.map(item => ({
                    productoId: item.productId,
                    cantidad: -Math.abs(Number(item.qty)),
                    unidad: item.unit || 'unidad',
                    origen: 'CONSUMO_DIFERIDO'
                })),
                metadata: {
                    sessionId: newSession.id,
                    saleId: sale.id,
                    customerRef,
                    dispatchId: initialDispatchId
                }
            });
            if (!inventoryResult.success) {
                return null;
            }
        }

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
}

/**
 * Crea una nueva Ficha de Consumo Activa vinculada a una Venta cuando se cobra un combo diferido.
 */
export async function createSessionFromSale(sale, cartItem) {
    return await withLock('pos_write_lock', async () => {
        return await createSessionFromSaleUnlocked(sale, cartItem);
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
 * Registra una entrega parcial de productos en una ficha de consumo (versión interna sin cerrojo).
 */
export async function registerPartialDispatchUnlocked(sessionId, dispatchedItems, cashierName = 'Cajero', requestId = null, actorOverride = null) {
    if (!sessionId || !Array.isArray(dispatchedItems) || dispatchedItems.length === 0) {
        return { success: false, error: 'Parámetros de despacho inválidos' };
    }

    const validItems = dispatchedItems.filter(i => i.productId && Number(i.qty) > 0);
    if (validItems.length === 0) {
        return { success: false, error: 'Debes seleccionar al menos 1 unidad para entregar' };
    }

    const dispatchTotalQty = validItems.reduce((sum, i) => sum + Number(i.qty), 0);
    const dispatchActor = normalizeActor(actorOverride, { nombre: cashierName });

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

        const dispatchId = requestId || crypto.randomUUID();
        const operationId = `dispatch_${dispatchId}`;

        // Si el cliente reintenta una solicitud cuyo despacho ya se confirmó,
        // no se vuelve a descontar stock ni se crea otra ronda.
        const existingDispatch = (session.dispatches || []).find(dispatch => dispatch.id === dispatchId);
        if (existingDispatch) {
            return {
                success: true,
                session,
                updatedProducts: products,
                isCompleted: session.status === 'COMPLETED',
                idempotent: true
            };
        }

        const operationRecords = await storageService.getItem('bodega_inventory_operations_v1', []) || [];
        const existingOperation = operationRecords.find(operation => (
            operation.operationId === operationId
            && operation.metadata?.sessionId === session.id
        ));

        // 1. Guardagujas Guardrail: Límite de Cuota
        const remainingQuota = session.totalQuota - session.servedCount;
        if (dispatchTotalQty > remainingQuota) {
            return {
                success: false,
                error: `No se pueden despachar ${dispatchTotalQty} unidades. Solo quedan ${remainingQuota} por servir.`
            };
        }

        // 2. Guardagujas Guardrail: Stock Disponible por Producto.
        // Si ya existe la operación persistida, el primer intento pudo haber
        // aplicado stock y fallado antes de guardar la ficha.
        if (!existingOperation) for (const item of validItems) {
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

        // 3. Crear registro de despacho con ID estable para reintentos.
        const dispatchRecord = {
            id: dispatchId,
            timestamp: new Date().toISOString(),
            cashier: dispatchActor.usuarioNombre,
            actorId: dispatchActor.usuarioId,
            actorRole: dispatchActor.usuarioRol,
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

        // 4. Descontar productos y registrar Kardex con snapshots explícitos.
        const inventoryResult = await applyInventoryOperationUnlocked({
            operationId,
            referenceId: dispatchRecord.id,
            referenceType: 'CONSUMO_DIFERIDO',
            source: 'CONSUMO_DIFERIDO',
            tipo: 'SALIDA_CONSUMO_DIFERIDO',
            subtipo: 'ENTREGA_PARCIAL',
            reason: 'Despacho',
            allowNegative: false,
            actor: dispatchActor,
            deductions: validItems.map(item => ({
                productoId: item.productId,
                cantidad: -Math.abs(Number(item.qty)),
                unidad: item.unit || 'unidad',
                origen: 'CONSUMO_DIFERIDO'
            })),
            metadata: {
                sessionId: session.id,
                saleId: session.saleId,
                customerRef: session.customerRef,
                comboName: session.comboName,
                dispatchId: dispatchRecord.id
            }
        });
        if (!inventoryResult.success) {
            return { success: false, pending: inventoryResult.pending === true, error: inventoryResult.error };
        }
        const updatedProducts = inventoryResult.updatedProducts || products;

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

        // 5. Persistir la ficha; el catálogo ya fue aplicado por la operación.
        await storageService.setItem(CONSUMPTION_SESSIONS_KEY, updatedSessions);

        try {
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
}

/**
 * Registra una entrega parcial de productos en una ficha de consumo.
 * Descuenta stock físico de cada SKU servido, registra en Kardex y actualiza la cuota.
 */
export async function registerPartialDispatch(sessionId, dispatchedItems, cashierName = 'Cajero', requestId = null, actorOverride = null) {
    return await withLock('pos_write_lock', async () => {
        return await registerPartialDispatchUnlocked(sessionId, dispatchedItems, cashierName, requestId, actorOverride);
    });
}

/**
 * Anula una ficha de consumo asociada a una venta anulada (versión interna sin cerrojo).
 */
export async function cancelSessionBySaleIdUnlocked(saleId, cashierName = 'Supervisor', actorOverride = null) {
    if (!saleId) return false;

    try {
        const cancellationActor = normalizeActor(actorOverride, { nombre: cashierName });
        const sessions = await storageService.getItem(CONSUMPTION_SESSIONS_KEY, []) || [];
        const sessionIndex = sessions.findIndex(s => s.saleId === saleId && s.status !== 'CANCELLED');
        if (sessionIndex === -1) return false;

        const session = sessions[sessionIndex];

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

        const refundEntries = Object.entries(itemsToRefund)
            .filter(([, qty]) => Number(qty) > 0)
            .map(([prodId, qty]) => ({
                productoId: prodId,
                cantidad: Math.abs(Number(qty)),
                origen: 'DEVOLUCION'
            }));

        if (refundEntries.length > 0) {
            const inventoryResult = await applyInventoryOperationUnlocked({
                operationId: `cancel_session_${session.id}`,
                referenceId: session.id,
                referenceType: 'ANULACION_CONSUMO_DIFERIDO',
                source: 'ANULACION_CONSUMO_DIFERIDO',
                tipo: 'DEVOLUCION',
                subtipo: 'ANULACION_CONSUMO_DIFERIDO',
                reason: 'Anulación venta',
                allowNegative: true,
                actor: cancellationActor,
                deductions: refundEntries,
                metadata: { saleId, sessionId: session.id }
            });
            if (!inventoryResult.success) return false;
        }

        const updatedSession = {
            ...session,
            status: 'CANCELLED',
            cancelledAt: new Date().toISOString(),
            cancelledBy: cancellationActor,
            updatedAt: new Date().toISOString()
        };

        const updatedSessions = [...sessions];
        updatedSessions[sessionIndex] = updatedSession;

        // `applyInventoryOperationUnlocked` ya persistió el catálogo y el
        // movimiento. Solo se confirma el documento de la ficha aquí.
        await storageService.setItem(CONSUMPTION_SESSIONS_KEY, updatedSessions);

        try {
            await pushCloudSync(CONSUMPTION_SESSIONS_KEY, updatedSessions, true);
        } catch (e) {}

        window.dispatchEvent(new CustomEvent('consumption-sessions-updated'));
        window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: PRODUCTS_KEY } }));

        return true;
    } catch (err) {
        console.error('[ConsumptionService] Error al anular ficha de consumo:', err);
        return false;
    }
}

/**
 * Anula una ficha de consumo asociada a una venta anulada y restituye el stock
 * de las unidades que ya hubiesen sido despachadas físicamente.
 */
export async function cancelSessionBySaleId(saleId, cashierName = 'Supervisor', actorOverride = null) {
    return await withLock('pos_write_lock', async () => {
        return await cancelSessionBySaleIdUnlocked(saleId, cashierName, actorOverride);
    });
}

/**
 * Revierte una ronda de entrega parcial de consumo diferido (versión interna sin cerrojo).
 */
export async function revertDispatchRoundUnlocked(sessionId, dispatchId, cashierName = 'Cajero', actorOverride = null) {
    if (!sessionId || !dispatchId) {
        return { success: false, error: 'Parámetros insuficientes para revertir' };
    }

    try {
        const revertActor = normalizeActor(actorOverride, { nombre: cashierName });
        const sessions = await storageService.getItem(CONSUMPTION_SESSIONS_KEY, []) || [];

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

        // 1. Restituir inventario físico y registrar Kardex mediante la
        // fachada única. El operationId estable hace segura la repetición si
        // falla la persistencia de la ficha después del movimiento.
        const inventoryResult = await applyInventoryOperationUnlocked({
            operationId: `revert_dispatch_${session.id}_${targetDispatch.id}`,
            referenceId: targetDispatch.id,
            referenceType: 'REVERSION_CONSUMO_DIFERIDO',
            source: 'CONSUMO_DIFERIDO',
            tipo: 'DEVOLUCION',
            subtipo: 'REVERSION_CONSUMO_DIFERIDO',
            reason: 'Reversión despacho',
            allowNegative: true,
            actor: revertActor,
            deductions: dispatchItems.map(item => ({
                productoId: item.productId,
                cantidad: Math.abs(Number(item.qty)),
                origen: 'DEVOLUCION'
            })),
            metadata: {
                saleId: session.saleId,
                sessionId: session.id,
                customerRef: session.customerRef,
                comboName: session.comboName,
                dispatchId: targetDispatch.id
            }
        });
        if (!inventoryResult.success) {
            return { success: false, pending: inventoryResult.pending === true, error: inventoryResult.error };
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
        // `applyInventoryOperationUnlocked` ya persistió el catálogo y el
        // movimiento. Solo se confirma el documento de la ficha aquí.
        await storageService.setItem(CONSUMPTION_SESSIONS_KEY, updatedSessions);

        try {
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
}

/**
 * Revierte una ronda de entrega parcial de consumo diferido.
 * Reintegra las unidades al stock físico de los productos, descuenta la cuota servida,
 * reabre la ficha si estaba completada y registra movimiento en Kardex.
 */
export async function revertDispatchRound(sessionId, dispatchId, cashierName = 'Cajero', actorOverride = null) {
    return await withLock('pos_write_lock', async () => {
        return await revertDispatchRoundUnlocked(sessionId, dispatchId, cashierName, actorOverride);
    });
}

