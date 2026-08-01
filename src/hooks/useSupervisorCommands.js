import { useEffect } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { applyInventoryCommand, isReappliableCommand } from '../utils/remoteInventoryProcessor';
import { COMMAND_STATUS, VALID_COMMAND_STATUSES } from '../constants/commandStatus';

// ── Deduplicación por ID de comando ─────────────────────────────────────────
// El catch-up (select de pendientes) y el stream realtime pueden entregar el
// MISMO comando dos veces. Para rate_change re-aplicar es inofensivo (valor
// absoluto), pero inventory_update con deltas de stock corrompería datos.
// Registramos los últimos IDs aplicados en localStorage ANTES de marcar
// 'applied' en Supabase, así un fallo del UPDATE remoto tampoco re-aplica.
const APPLIED_IDS_KEY = 'dj_applied_supervisor_cmds_v1';
const APPLIED_IDS_MAX = 200;

function loadAppliedIds() {
    try {
        const raw = localStorage.getItem(APPLIED_IDS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch { return []; }
}

function markApplied(commandId) {
    try {
        const arr = loadAppliedIds().filter(id => id !== commandId);
        arr.push(commandId);
        while (arr.length > APPLIED_IDS_MAX) arr.shift();
        localStorage.setItem(APPLIED_IDS_KEY, JSON.stringify(arr));
    } catch { /* localStorage lleno/bloqueado: el Set en memoria sigue protegiendo la sesión */ }
}

function unmarkApplied(commandId) {
    try {
        const arr = loadAppliedIds().filter(id => id !== commandId);
        localStorage.setItem(APPLIED_IDS_KEY, JSON.stringify(arr));
    } catch { /* ignore */ }
}

let cloudSyncTimer = null;
let cloudSyncPending = false;

export async function flushCloudProductsSync() {
    if (!cloudSyncPending) return;
    cloudSyncPending = false;
    if (cloudSyncTimer) {
        clearTimeout(cloudSyncTimer);
        cloudSyncTimer = null;
    }
    try {
        const { pushCloudSync } = await import('./useCloudSync');
        const { storageService } = await import('../utils/storageService');
        const fresh = await storageService.getItem('bodega_products_v1', []);
        await pushCloudSync('bodega_products_v1', fresh, true);
    } catch (syncErr) {
        cloudSyncPending = true;
        console.error('[SupervisorCommands] Error en push de sincronización diferida:', syncErr);
    }
}

function scheduleCloudProductsSync() {
    cloudSyncPending = true;
    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(() => {
        flushCloudProductsSync();
    }, 400);
}

async function updateCommandStatus(commandId, status, errorReason = null, maxRetries = 3) {
    if (import.meta.env.DEV && !VALID_COMMAND_STATUSES.includes(status)) {
        throw new Error(`[SupervisorCommands] Status "${status}" no está en VALID_COMMAND_STATUSES — la BD lo va a rechazar.`);
    }

    const fields = { status };
    if (status === COMMAND_STATUS.APPLIED || status === COMMAND_STATUS.APPLIED_WITH_WARNINGS) {
        fields.applied_at = new Date().toISOString();
    }
    if (errorReason) fields.error_reason = String(errorReason).slice(0, 500);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const { error } = await supabaseCloud
                .from('supervisor_commands')
                .update(fields)
                .eq('id', commandId);
            if (!error) return true;
            if (error.code && ['23514', '23503', '22P02'].includes(error.code)) {
                console.error(`[SupervisorCommands] Error de esquema al fijar status="${status}" — no se reintenta:`, error);
                return false;
            }
            console.warn(`[SupervisorCommands] Intento ${attempt}/${maxRetries} falló al actualizar status de ${commandId}:`, error);
        } catch (e) {
            console.warn(`[SupervisorCommands] Excepción en intento ${attempt}/${maxRetries} al actualizar status:`, e);
        }
        if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, attempt * 1500));
        }
    }
    return false;
}

async function applyRateChange(command) {
    const { rateMode, customRate } = command.payload || {};

    let pushLocalSync = null;
    try {
        const syncModule = await import('./useCloudSync');
        pushLocalSync = syncModule.pushLocalSync;
    } catch (e) {
        console.error('[SupervisorCommands] Error al importar dinámicamente pushLocalSync:', e);
    }

    if (rateMode) {
        localStorage.setItem('bodega_rate_mode', rateMode);
        localStorage.setItem('bodega_use_auto_rate', JSON.stringify(rateMode !== 'manual'));
        if (pushLocalSync) {
            pushLocalSync('bodega_rate_mode', rateMode);
            pushLocalSync('bodega_use_auto_rate', rateMode !== 'manual');
        }
    }

    if (customRate !== undefined && customRate !== null) {
        localStorage.setItem('bodega_custom_rate', String(customRate));
        if (pushLocalSync) {
            pushLocalSync('bodega_custom_rate', parseFloat(customRate));
        }
    }

    window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_rate_mode' } }));
    window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_custom_rate' } }));
    window.dispatchEvent(new CustomEvent('supervisor_rate_applied', {
        detail: { rateMode, customRate }
    }));
}

export function useSupervisorCommands(deviceId) {
    useEffect(() => {
        if (!supabaseCloud || !deviceId) return;

        // Set en memoria sembrado desde localStorage (sobrevive recargas)
        const appliedIds = new Set(loadAppliedIds());
        let disposed = false;

        const processCommand = async (command) => {
            if (!command || command.status !== 'pending') return;
            if (appliedIds.has(command.id)) return; // dedup: catch-up + realtime

            if (command.command_type === 'rate_change') {
                try {
                    appliedIds.add(command.id);
                    markApplied(command.id);
                    await applyRateChange(command);
                    await updateCommandStatus(command.id, 'applied');
                } catch (err) {
                    console.error('[SupervisorCommands] Error al aplicar rate_change:', err);
                    await updateCommandStatus(command.id, 'failed', err?.message);
                }
            } else if (command.command_type === 'inventory_update') {
                try {
                    appliedIds.add(command.id);
                    markApplied(command.id);
                    const result = await applyInventoryCommand(command.payload);
                    if (result.success) {
                        const nextStatus = result.failedCount > 0 ? COMMAND_STATUS.APPLIED_WITH_WARNINGS : COMMAND_STATUS.APPLIED;
                        const warnMsg = result.failedCount > 0 ? `${result.appliedCount} aplicados, ${result.failedCount} fallaron (${result.failedItems?.map(f => f.productName || f.productId).join(', ')})` : null;
                        const ok = await updateCommandStatus(command.id, nextStatus, warnMsg);
                        if (!ok) {
                            if (isReappliableCommand(command.payload)) {
                                console.error(`[SupervisorCommands] El comando ${command.id} se aplicó localmente pero no se pudo marcar en la nube. Se desmarca para reintento.`);
                                unmarkApplied(command.id);
                                appliedIds.delete(command.id);
                            } else {
                                console.error(`[SupervisorCommands] ${command.id} se aplicó localmente pero no se pudo marcar, y no es re-aplicable: se deja marcado. Quedará 'pending' en la nube.`);
                            }
                        }
                        window.dispatchEvent(new CustomEvent('supervisor_inventory_applied', {
                            detail: {
                                action: command.payload?.action,
                                productName: result.productName || '',
                                updatedProducts: result.updatedProducts || null
                            }
                        }));

                        // Sincronización diferida (Debounce) a la nube para no estrangular el procesamiento en lote
                        scheduleCloudProductsSync();
                    } else {
                        await updateCommandStatus(command.id, 'failed', result.error);
                    }
                } catch (err) {
                    console.error('[SupervisorCommands] Error al aplicar inventory_update:', err);
                    await updateCommandStatus(command.id, 'failed', err?.message);
                }
            } else if (command.command_type === 'user_update') {
                try {
                    const { action, userId, newPin, nombre, rol, bypassPin } = command.payload || {};
                    const { useAuthStore } = await import('./store/useAuthStore');
                    const store = useAuthStore.getState();

                    let res;
                    let applied = false;
                    let failReason = '';

                    if (action === 'change_pin' && userId && newPin) {
                        const target = store.usuarios.find(u => u.id === userId);
                        if (!target) {
                            failReason = `Usuario con ID ${userId} no existe en la caja`;
                        } else if (store.usuarios.some(u => u.id !== userId && (u.plainPin === newPin || u.pin === newPin))) {
                            failReason = `El PIN ya está asignado a otro usuario en la caja`;
                        } else {
                            res = store.cambiarPin(userId, newPin);
                            applied = true;
                        }
                    } else if (action === 'add' && nombre) {
                        if (!bypassPin && newPin && store.usuarios.some(u => u.plainPin === newPin || u.pin === newPin)) {
                            failReason = `El PIN ya está asignado a otro usuario en la caja`;
                        } else {
                            res = store.agregarUsuario(nombre, rol || 'CAJERO', newPin || '000000', bypassPin);
                            applied = true;
                        }
                    } else if (action === 'edit' && userId) {
                        const target = store.usuarios.find(u => u.id === userId);
                        if (!target) {
                            failReason = `Usuario con ID ${userId} no existe en la caja`;
                        } else {
                            res = store.editarUsuario(userId, { nombre, rol, bypassPin });
                            applied = true;
                        }
                    } else if (action === 'delete' && userId) {
                        const target = store.usuarios.find(u => u.id === userId);
                        if (!target) {
                            failReason = `Usuario con ID ${userId} no existe en la caja`;
                        } else {
                            const deleteOk = store.eliminarUsuario(userId);
                            if (deleteOk === false) {
                                failReason = `No se puede eliminar el usuario ${target.nombre} (último admin o sesión activa)`;
                            } else {
                                applied = true;
                            }
                        }
                    } else {
                        failReason = `Acción de usuario no reconocida o incompleta: ${action}`;
                    }

                    if (!applied) {
                        await updateCommandStatus(command.id, 'failed', failReason || 'Acción no aplicada');
                        return;
                    }

                    // El hash del PIN es asíncrono: esperamos a que se complete antes de leer el catálogo
                    await res?.done;

                    appliedIds.add(command.id);
                    markApplied(command.id);

                    // Notificar y actualizar catálogo de usuarios sanitizado en la nube (SEC-002: sin pin ni plainPin)
                    const freshUsers = useAuthStore.getState().usuarios;
                    localStorage.setItem('bodega_users_catalog_v1', JSON.stringify(freshUsers));
                    try {
                        const { sanitizeUserCatalog } = await import('../utils/userCatalog');
                        const sanitizedUsers = sanitizeUserCatalog(freshUsers);
                        const { pushCloudSync } = await import('./useCloudSync');
                        await pushCloudSync('bodega_users_catalog_v1', sanitizedUsers);
                    } catch {}

                    await updateCommandStatus(command.id, 'applied');
                } catch (err) {
                    console.error('[SupervisorCommands] Error al aplicar user_update:', err);
                    await updateCommandStatus(command.id, 'failed', err?.message);
                }
            } else if (command.command_type === 'void_sale') {
                try {
                    appliedIds.add(command.id);
                    markApplied(command.id);
                    const { saleId } = command.payload || {};
                    const { storageService } = await import('../utils/storageService');
                    const { processVoidSale } = await import('../utils/voidSaleProcessor');
                    const { pushCloudSync } = await import('./useCloudSync');

                    const freshSales = await storageService.getItem('bodega_sales_v1', []) || [];
                    const freshProducts = await storageService.getItem('bodega_products_v1', []) || [];

                    const targetSale = freshSales.find(s => s.id === saleId);
                    if (!targetSale) {
                        await updateCommandStatus(command.id, 'failed', 'Venta no encontrada en la caja');
                    } else if (targetSale.status === 'ANULADA') {
                        await updateCommandStatus(command.id, 'applied');
                    } else {
                        const result = await processVoidSale(targetSale, freshSales, freshProducts);
                        await updateCommandStatus(command.id, 'applied');

                        window.dispatchEvent(new CustomEvent('supervisor_sale_voided', {
                            detail: { saleId, updatedSales: result.updatedSales, updatedProducts: result.updatedProducts }
                        }));
                        window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_sales_v1' } }));
                        window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_products_v1' } }));

                        try {
                            if (result.updatedSales) await pushCloudSync('bodega_sales_v1', result.updatedSales, true);
                            if (result.updatedProducts) await pushCloudSync('bodega_products_v1', result.updatedProducts, true);
                            if (result.updatedCustomers) await pushCloudSync('bodega_customers_v1', result.updatedCustomers, true);
                        } catch (syncErr) {
                            console.error('[SupervisorCommands] Error en push de sincronizacion post-anulacion:', syncErr);
                        }
                    }
                } catch (err) {
                    console.error('[SupervisorCommands] Error al anular venta remota:', err);
                    await updateCommandStatus(command.id, 'failed', err?.message);
                }
            } else if (command.command_type === 'force_daily_close') {
                try {
                    appliedIds.add(command.id);
                    markApplied(command.id);
                    const { storageService } = await import('../utils/storageService');
                    const { pushCloudSync } = await import('./useCloudSync');
                    const { withLock } = await import('../utils/withLock');
                    const { getOpenShiftMovements } = await import('../utils/shiftScope');

                    const result = await withLock('pos_write_lock', async () => {
                        const sales = await storageService.getItem('bodega_sales_v1', []) || [];
                        const targetCierreId = command.payload?.cierreId || Date.now();

                        if (sales.some(s => s.cierreId === targetCierreId && s.tipo === 'REGISTRO_CIERRE')) {
                            return { alreadyApplied: true, sales };
                        }

                        const { movements, orphans } = getOpenShiftMovements(sales);
                        if (movements.length === 0) {
                            return { empty: true };
                        }

                        const closingIds = new Set(movements.map(s => s.id));
                        const updatedSales = sales.map(s =>
                            closingIds.has(s.id) ? { ...s, cajaCerrada: true, cierreId: targetCierreId } : s
                        );

                        const existingCloses = sales.filter(s => s.tipo === 'REGISTRO_CIERRE');
                        const cierreNumber = command.payload?.cierreNumber || (existingCloses.reduce((mx, s) => Math.max(mx, s.cierreNumber || 0), 0) + 1);

                        const registroCierre = {
                            id: `cierre_${targetCierreId}`,
                            tipo: 'REGISTRO_CIERRE',
                            cierreId: targetCierreId,
                            cierreNumber: cierreNumber,
                            timestamp: new Date().toISOString(),
                            cajaCerrada: true,
                            remoteTriggered: true,
                            summary: {
                                ...(command.payload || {}),
                                reconData: null,
                                sinCuadreFisico: true,
                                orphanCount: orphans.length
                            }
                        };

                        updatedSales.push(registroCierre);
                        await storageService.setItem('bodega_sales_v1', updatedSales);
                        return { updatedSales, orphanCount: orphans.length };
                    });

                    if (result?.alreadyApplied) {
                        await updateCommandStatus(command.id, 'applied');
                        return;
                    }

                    if (result?.empty) {
                        await updateCommandStatus(command.id, 'failed', 'No hay movimientos abiertos para cerrar en el turno actual');
                        return;
                    }

                    await pushCloudSync('bodega_sales_v1', result.updatedSales);
                    await updateCommandStatus(command.id, 'applied');
                    window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_sales_v1' } }));
                } catch (err) {
                    console.error('[SupervisorCommands] Error al ejecutar Cierre Remoto en la caja:', err);
                    await updateCommandStatus(command.id, 'failed', err?.message);
                }
            } else if (command.command_type === 'reopen_shift') {
                try {
                    appliedIds.add(command.id);
                    markApplied(command.id);
                    const { storageService } = await import('../utils/storageService');
                    const { pushCloudSync } = await import('./useCloudSync');
                    const { withLock } = await import('../utils/withLock');

                    const result = await withLock('pos_write_lock', async () => {
                        const sales = await storageService.getItem('bodega_sales_v1', []) || [];
                        const targetCierreId = command.payload?.cierreId;

                        const explicitCloses = sales.filter(s => s.tipo === 'REGISTRO_CIERRE');
                        if (explicitCloses.length === 0) {
                            return { empty: true };
                        }

                        const targetClose = targetCierreId
                            ? explicitCloses.find(s => s.cierreId === targetCierreId || s.id === `cierre_${targetCierreId}`)
                            : explicitCloses[0];

                        const cierreIdToReopen = targetClose?.cierreId || targetCierreId;

                        const reopenedSales = sales
                            .filter(s => s.id !== targetClose?.id && (s.cierreId !== cierreIdToReopen || s.tipo !== 'REGISTRO_CIERRE'))
                            .map(s => {
                                if (!cierreIdToReopen || s.cierreId === cierreIdToReopen) {
                                    const { cierreId, ...rest } = s;
                                    return { ...rest, cajaCerrada: false };
                                }
                                return s;
                            });

                        await storageService.setItem('bodega_sales_v1', reopenedSales);

                        try {
                            const MIRROR_KEY = 'bodega_sales_mirror_v1';
                            await storageService.setItem(MIRROR_KEY, reopenedSales);
                        } catch (e) {}

                        return { reopenedSales, cierreId: cierreIdToReopen };
                    });

                    if (result?.empty) {
                        await updateCommandStatus(command.id, 'failed', 'No hay cierres de caja para reabrir');
                        return;
                    }

                    await pushCloudSync('bodega_sales_v1', result.reopenedSales, true);
                    await pushCloudSync('bodega_sales_mirror_v1', result.reopenedSales, true);
                    await updateCommandStatus(command.id, 'applied');

                    window.dispatchEvent(new CustomEvent('supervisor_shift_reopened', { detail: { cierreId: result.cierreId } }));
                    window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_sales_v1' } }));
                } catch (err) {
                    console.error('[SupervisorCommands] Error al reabrir turno remoto:', err);
                    await updateCommandStatus(command.id, 'failed', err?.message);
                }
            }
            // Tipos desconocidos: se ignoran (comportamiento histórico)
        };

        // Catch-up: el realtime de Supabase NO re-emite INSERTs perdidos
        // (caja cerrada u offline/micro-cortes). Al montar, en cada reconexión
        // y periódicamente se consultan los comandos pendientes y se procesan.
        let isFetchingPending = false;

        const catchUpPending = async (retryCount = 0) => {
            if (disposed || isFetchingPending) return;
            isFetchingPending = true;
            try {
                const { data, error } = await supabaseCloud
                    .from('supervisor_commands')
                    .select('*')
                    .eq('primary_device_id', deviceId)
                    .eq('status', 'pending')
                    .order('created_at', { ascending: true });

                if (error) {
                    console.warn(`[SupervisorCommands] Error en catch-up (intento ${retryCount + 1}):`, error.message);
                    if (retryCount < 3 && !disposed) {
                        setTimeout(() => catchUpPending(retryCount + 1), (retryCount + 1) * 3000);
                    }
                    return;
                }

                if (disposed) return;

                for (const command of data || []) {
                    await processCommand(command);
                }
            } catch (err) {
                console.error('[SupervisorCommands] Excepción en catch-up:', err);
                if (retryCount < 3 && !disposed) {
                    setTimeout(() => catchUpPending(retryCount + 1), (retryCount + 1) * 3000);
                }
            } finally {
                isFetchingPending = false;
            }
        };

        const channel = supabaseCloud
            .channel(`supervisor_commands:${deviceId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'supervisor_commands',
                filter: `primary_device_id=eq.${deviceId}`
            }, (payload) => processCommand(payload.new))
            .subscribe((status) => {
                // SUBSCRIBED se emite al conectar Y al reconectar: cubre los
                // comandos que llegaron mientras el websocket estuvo caído.
                if (status === 'SUBSCRIBED') catchUpPending();
            });

        // Red de seguridad contra micro-cortes: Polling periódico cada 12s
        const intervalId = setInterval(() => {
            if (!disposed && navigator.onLine !== false) {
                catchUpPending();
            }
        }, 12000);

        // Nota: visibilitychange pertenece al objeto `document` y NO burbujea a `window`.
        // `visibilitychange → hidden` corre ANTES de congelar la app en móviles (garantía de tiempo).
        // `pagehide` y `beforeunload` corren al cerrar pestaña (best-effort).
        const handleVisibility = () => {
            if (document.visibilityState === 'hidden') {
                flushCloudProductsSync();
            }
        };
        const handleUnload = () => {
            flushCloudProductsSync();
        };

        document.addEventListener('visibilitychange', handleVisibility);
        window.addEventListener('pagehide', handleUnload);
        window.addEventListener('beforeunload', handleUnload);

        return () => {
            disposed = true;
            clearInterval(intervalId);
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('pagehide', handleUnload);
            window.removeEventListener('beforeunload', handleUnload);
            supabaseCloud.removeChannel(channel).catch(() => {});
        };
    }, [deviceId]);
}
