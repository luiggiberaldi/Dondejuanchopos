import { useEffect } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { applyInventoryCommand, isReappliableCommand } from '../utils/remoteInventoryProcessor';
import { COMMAND_STATUS } from '../constants/commandStatus';
import { IDB_KEYS, LS_KEYS } from '../config/backupKeys';
import { REMOTE_BACKUP_EXCLUDED_KEYS } from '../services/remoteAuditService';
import { restoreLocalRateState } from '../utils/supervisorCommandModel';
import { logEvent } from '../services/auditService';

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

// ── Singleton guard ─────────────────────────────────────────────────────────
// El hook puede montarse varias veces si hay múltiples instancias de
// ProductProvider / useCloudSync activas (ej: modo monitor + modo normal
// montados simultáneamente en App.jsx). Sin esta protección cada instancia
// crearía su propio canal Realtime y su propio intervalo de polling,
// disparando cada comando 2–3 veces.
let _activeSubscriberCount = 0;
// Realtime INSERT y catch-up pueden entregar la misma fila en paralelo. El
// id estable del comando se procesa una sola vez por sesión; la idempotencia
// persistida de cada operación cubre además una recarga completa.
const _processingCommandIds = new Set();
const _activeSubscriberDevices = new Set();

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

async function updateCommandStatus(commandId, status, errorReason = null) {
    const fields = { status };
    if (status === COMMAND_STATUS.APPLIED || status === COMMAND_STATUS.APPLIED_WITH_WARNINGS) {
        fields.applied_at = new Date().toISOString();
    }
    if (errorReason) fields.error_reason = String(errorReason).slice(0, 500);

    try {
        const { error } = await supabaseCloud
            .from('supervisor_commands')
            .update(fields)
            .eq('id', commandId);

        if (!error) return true;

        // Guarda-rail: si falló con campos opcionales (applied_at / error_reason no existen en el schema)
        // o con cualquier otro error 4xx, reintentar SOLO con status.
        console.warn(`[SupervisorCommands] Fallo al actualizar con campos completos (${error.code || error.message}). Reintentando solo con status...`);
        const { error: fallbackErr } = await supabaseCloud
            .from('supervisor_commands')
            .update({ status })
            .eq('id', commandId);

        if (!fallbackErr) return true;

        console.error(`[SupervisorCommands] Fallback también falló para cmd ${commandId}:`, fallbackErr);
        return false;
    } catch (e) {
        console.error('[SupervisorCommands] Excepción al actualizar status:', e);
        return false;
    }
}

async function applyRateChange(command) {
    const { rateMode, customRate } = command.payload || {};
    const previous = {
        rateMode: localStorage.getItem('bodega_rate_mode'),
        useAutoRate: localStorage.getItem('bodega_use_auto_rate'),
        customRate: localStorage.getItem('bodega_custom_rate'),
    };

    let pushLocalSync = null;
    try {
        const syncModule = await import('./useCloudSync');
        pushLocalSync = syncModule.pushLocalSync;
    } catch (e) {
        console.error('[SupervisorCommands] Error al importar dinámicamente pushLocalSync:', e);
    }

    try {
        if (rateMode) {
            localStorage.setItem('bodega_rate_mode', rateMode);
            localStorage.setItem('bodega_use_auto_rate', JSON.stringify(rateMode !== 'manual'));
        }

        if (customRate !== undefined && customRate !== null) {
            localStorage.setItem('bodega_custom_rate', String(customRate));
        } else if (rateMode && rateMode !== 'manual') {
            localStorage.removeItem('bodega_custom_rate');
        }

        if (pushLocalSync) {
            if (rateMode) {
                pushLocalSync('bodega_rate_mode', rateMode);
                pushLocalSync('bodega_use_auto_rate', rateMode !== 'manual');
            }
            if (customRate !== undefined && customRate !== null) {
                pushLocalSync('bodega_custom_rate', parseFloat(customRate));
            } else if (rateMode && rateMode !== 'manual') {
                // Publicar también la eliminación de la tasa manual; de lo
                // contrario el monitor podía conservar un customRate antiguo y
                // la barrera de confirmación nunca observaba el estado completo.
                pushLocalSync('bodega_custom_rate', null);
            }
        }

        window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_rate_mode' } }));
        window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_custom_rate' } }));
        window.dispatchEvent(new CustomEvent('supervisor_rate_applied', {
            detail: { rateMode, customRate }
        }));
        logEvent(
            'CONFIG',
            'TASA_REMOTA_APLICADA',
            `Caja aplicó tasa ${rateMode}${customRate != null ? ` (${customRate})` : ''}`,
            {
                id: command.payload?.supervisorId || null,
                nombre: command.payload?.supervisorName || 'Supervisor',
                rol: command.payload?.supervisorRole || 'SUPERVISOR',
            },
            { commandId: command.id, rateMode, customRate }
        );
    } catch (error) {
        restoreLocalRateState(previous);
        if (pushLocalSync) {
            if (previous.rateMode != null) pushLocalSync('bodega_rate_mode', previous.rateMode);
            if (previous.useAutoRate != null) pushLocalSync('bodega_use_auto_rate', previous.useAutoRate);
            if (previous.customRate != null) pushLocalSync('bodega_custom_rate', previous.customRate);
        }
        throw error;
    }
}

export function useSupervisorCommands(deviceId) {
    useEffect(() => {
        if (!supabaseCloud || !deviceId) return;

        // Singleton guard: si ya hay una instancia activa con este deviceId,
        // no crear un segundo canal. Incrementar contador; decrementar al desmontar.
        const subscriberKey = String(deviceId);
        _activeSubscriberCount++;
        if (_activeSubscriberCount > 1 && _activeSubscriberDevices.has(subscriberKey)) {
            // Ya existe una instancia manejando los comandos de ESTE dispositivo.
            // Otra caja montada en la misma página conserva su propio canal.
            return () => {
                _activeSubscriberCount--;
            };
        }
        _activeSubscriberDevices.add(subscriberKey);

        // Set en memoria sembrado desde localStorage (sobrevive recargas)
        const appliedIds = new Set(loadAppliedIds());
        let disposed = false;

        const processCommand = async (command) => {
            if (!command || command.status !== 'pending') return;
            // FASE 3A: aislamiento de la instancia fantasma. Con gate registrado,
            // solo la instancia primaria procesa comandos; las demás NO los
            // consumen (quedan pending para la caja real). Sin gate → fail-open
            // (comportamiento previo, despliegue seguro).
            try {
                const { getInstanceId, readGate, canProcessCommands } = await import('../utils/instanceFingerprint');
                const myId = getInstanceId();
                const gate = await readGate(deviceId, supabaseCloud);
                const decision = canProcessCommands(gate, myId);
                if (!decision.allowed) {
                    console.warn(`[SupervisorCommands] ${decision.reason}: comando ${command.id} (${command.command_type}) se deja pending para la instancia primaria.`);
                    return;
                }
            } catch (gateErr) {
                console.warn('[SupervisorCommands] Gate de instancia no disponible (fail-open):', gateErr?.message || gateErr);
            }
            if (appliedIds.has(command.id)) return; // dedup: catch-up + realtime
            if (_processingCommandIds.has(command.id)) return;
            _processingCommandIds.add(command.id);

            if (command.command_type === 'request_full_backup') {
                try {
                    const { storageService } = await import('../utils/storageService');
                    const { withLock } = await import('../utils/withLock');
                    const { buildLocalRemoteBackup } = await import('../services/remoteAuditService');
                    const backup = await withLock('pos_write_lock', async () => {
                        const idbData = {};
                        for (const key of IDB_KEYS) {
                            const value = await storageService.getItem(key, null);
                            if (value !== null) idbData[key] = value;
                        }

                        const lsData = {};
                        for (const key of LS_KEYS) {
                            if (REMOTE_BACKUP_EXCLUDED_KEYS.includes(key)) continue;
                            const value = localStorage.getItem(key);
                            if (value !== null) lsData[key] = value;
                        }

                        const { getInstanceId, hasServiceWorker } = await import('../utils/instanceFingerprint');
                        return buildLocalRemoteBackup(deviceId, command.id, idbData, lsData, undefined, getInstanceId(), hasServiceWorker());
                    });
                    const { error } = await supabaseCloud.rpc('write_paired_cloud_backup', {
                        p_device_id: deviceId,
                        p_request_id: command.id,
                        p_backup_data: backup,
                    });
                    if (error) throw error;

                    appliedIds.add(command.id);
                    markApplied(command.id);
                    await updateCommandStatus(command.id, COMMAND_STATUS.APPLIED);
                    window.dispatchEvent(new CustomEvent('remote_full_backup_applied', {
                        detail: {
                            requestId: command.id,
                            missingDocIds: backup.metadata?.missingDocIds || [],
                            missingCriticalDocIds: backup.metadata?.missingCriticalDocIds || [],
                            updatedAt: backup.timestamp,
                        },
                    }));
                } catch (err) {
                    appliedIds.delete(command.id);
                    unmarkApplied(command.id);
                    console.error('[SupervisorCommands] Error al generar backup completo remoto:', err);
                    await updateCommandStatus(command.id, COMMAND_STATUS.FAILED, err?.message);
                }
            } else if (command.command_type === 'rate_change') {
                try {
                    // Marcar después de terminar la mutación local. Si una de las
                    // claves falla, el comando queda reintentable y applyRateChange
                    // restaura la fotografía anterior.
                    await applyRateChange(command);
                    appliedIds.add(command.id);
                    markApplied(command.id);
                    await updateCommandStatus(command.id, 'applied');
                } catch (err) {
                    appliedIds.delete(command.id);
                    unmarkApplied(command.id);
                    console.error('[SupervisorCommands] Error al aplicar rate_change:', err);
                    await updateCommandStatus(command.id, 'failed', err?.message);
                }
            } else if (command.command_type === 'inventory_update' && command.payload?.action !== 'enable_feature' && command.payload?.action !== 'replace_sales_history') {
                if (command.payload?.action === 'save_customer' || command.payload?.action === 'update_customer_balance') {
                    try {
                        const { customerId, customerCode, deuda, favor, customer, action } = command.payload || {};
                        const { storageService } = await import('../utils/storageService');
                        const { pushCloudSync } = await import('./useCloudSync');
                        const { withLock } = await import('../utils/withLock');
                        const { subR, round2 } = await import('../utils/dinero');

                        let savedCustomers = null;
                        await withLock('pos_write_lock', async () => {
                            const customers = await storageService.getItem('bodega_customers_v1', []) || [];
                            let updated = false;
                            const newCustomers = customers.map(c => {
                                const isMatch = (customerId && (c.id === customerId || c._id === customerId)) ||
                                                (customerCode && (c.code === customerCode || c.id === customerCode)) ||
                                                (customer?.id && (c.id === customer.id || c._id === customer.id));
                                if (isMatch) {
                                    updated = true;
                                    const rawDeuda = deuda !== undefined ? Number(deuda) : (customer?.deuda !== undefined ? Number(customer.deuda) : c.deuda);
                                    const rawFavor = favor !== undefined ? Number(favor) : (customer?.favor !== undefined ? Number(customer.favor) : c.favor);
                                    const saldoNeto = subR(rawFavor, rawDeuda);
                                    return {
                                        ...c,
                                        ...(customer || {}),
                                        favor: saldoNeto > 0 ? round2(saldoNeto) : 0,
                                        deuda: saldoNeto < 0 ? round2(Math.abs(saldoNeto)) : 0,
                                        updatedAt: new Date().toISOString()
                                    };
                                }
                                return c;
                            });

                            // Si es save_customer y no existía, agregarlo como nuevo cliente
                            if (!updated && (action === 'save_customer' || command.payload?.action === 'save_customer') && customer) {
                                const rawDeuda = Number(customer.deuda || deuda || 0);
                                const rawFavor = Number(customer.favor || favor || 0);
                                const saldoNeto = subR(rawFavor, rawDeuda);
                                const nextCodeNum = customers.reduce((mx, c) => {
                                    const numPart = parseInt(c.code?.replace('CLI-', ''), 10);
                                    return isNaN(numPart) ? mx : Math.max(mx, numPart);
                                }, 0) + 1;
                                const generatedCode = `CLI-${String(nextCodeNum).padStart(5, '0')}`;
                                const newCust = {
                                    id: customer.id || crypto.randomUUID(),
                                    code: customer.code || generatedCode,
                                    name: customer.name || 'Cliente',
                                    documentId: customer.documentId || '',
                                    phone: customer.phone || '',
                                    ...customer,
                                    favor: saldoNeto > 0 ? round2(saldoNeto) : 0,
                                    deuda: saldoNeto < 0 ? round2(Math.abs(saldoNeto)) : 0,
                                    createdAt: customer.createdAt || new Date().toISOString(),
                                    updatedAt: new Date().toISOString(),
                                };
                                newCustomers.push(newCust);
                                updated = true;
                            }

                            if (updated) {
                                await storageService.setItem('bodega_customers_v1', newCustomers);
                                savedCustomers = newCustomers;
                            }
                        });

                        if (savedCustomers) {
                            appliedIds.add(command.id);
                            markApplied(command.id);
                            await updateCommandStatus(command.id, 'applied');
                            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_customers_v1', value: savedCustomers } }));
                            await pushCloudSync('bodega_customers_v1', savedCustomers, true);
                        } else {
                            await updateCommandStatus(command.id, 'failed', 'Cliente no encontrado en la caja');
                        }
                    } catch (err) {
                        appliedIds.delete(command.id);
                        unmarkApplied(command.id);
                        console.error('[SupervisorCommands] Error al actualizar cliente remoto:', err);
                        await updateCommandStatus(command.id, 'failed', err?.message);
                    }
                    return;
                }
                if (command.payload?.action === 'delete_customer') {
                    try {
                        const { customerId, customerCode, force } = command.payload || {};
                        const { storageService } = await import('../utils/storageService');
                        const { pushCloudSync } = await import('./useCloudSync');
                        const { withLock } = await import('../utils/withLock');

                        let deleted = false;
                        await withLock('pos_write_lock', async () => {
                            const customers = await storageService.getItem('bodega_customers_v1', []) || [];
                            const target = customers.find(c =>
                                (customerId && (c.id === customerId || c._id === customerId)) ||
                                (customerCode && (c.code === customerCode || c.id === customerCode))
                            );
                            if (!target) return; // deleted = false → "no encontrado"
                            // Blindaje: no borrar un cliente con saldo pendiente sin force.
                            const tieneSaldo = (Number(target.deuda) || 0) > 0 || (Number(target.favor) || 0) > 0;
                            if (tieneSaldo && !force) return; // deleted = false → "con saldo"
                            const newCustomers = customers.filter(c => c !== target);
                            await storageService.setItem('bodega_customers_v1', newCustomers);
                            deleted = true;
                            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_customers_v1', value: newCustomers } }));
                            await pushCloudSync('bodega_customers_v1', newCustomers, true);
                        });

                        if (deleted) {
                            appliedIds.add(command.id);
                            markApplied(command.id);
                            await updateCommandStatus(command.id, 'applied');
                        } else {
                            const customers = await (async () => {
                                const { storageService } = await import('../utils/storageService');
                                return await storageService.getItem('bodega_customers_v1', []) || [];
                            })();
                            const target = customers.find(c =>
                                (customerId && (c.id === customerId || c._id === customerId)) ||
                                (customerCode && (c.code === customerCode || c.id === customerCode))
                            );
                            await updateCommandStatus(command.id, 'failed',
                                !target ? 'Cliente a eliminar no encontrado en la caja'
                                    : 'Cliente con saldo pendiente; se requiere force:true para eliminar');
                        }
                    } catch (err) {
                        appliedIds.delete(command.id);
                        unmarkApplied(command.id);
                        console.error('[SupervisorCommands] Error al eliminar cliente remoto:', err);
                        await updateCommandStatus(command.id, 'failed', err?.message);
                    }
                    return;
                }
                if (command.payload?.action === 'register_customer_payment') {
                    try {
                        const { cobro, creditos, customerId, customerCode, deuda, favor } = command.payload || {};
                        const { storageService } = await import('../utils/storageService');
                        const { pushCloudSync } = await import('./useCloudSync');
                        const { withLock } = await import('../utils/withLock');
                        const { subR, round2 } = await import('../utils/dinero');

                        // Acepta un cobro (ABONO) y/o un lote de ventas fiadas (CREDITO).
                        const records = [cobro, ...(Array.isArray(creditos) ? creditos : [])].filter(r => r && r.id);
                        if (records.length === 0) {
                            await updateCommandStatus(command.id, 'failed', 'Datos de transacción inválidos');
                            return;
                        }

                        let savedCustomers = null;
                        await withLock('pos_write_lock', async () => {
                            const sales = await storageService.getItem('bodega_sales_v1', []) || [];
                            // Idempotencia por id: solo inserta los registros que falten.
                            const faltantes = records.filter(r => !sales.some(s => s.id === r.id));
                            if (faltantes.length > 0) {
                                const updatedSales = [...faltantes, ...sales];
                                await storageService.setItem('bodega_sales_v1', updatedSales);
                                try {
                                    await storageService.setItem('bodega_sales_mirror_v1', updatedSales);
                                } catch (_) {}
                            }

                            const customers = await storageService.getItem('bodega_customers_v1', []) || [];
                            const newCustomers = customers.map(c => {
                                const isMatch = (customerId && (c.id === customerId || c._id === customerId)) ||
                                                (customerCode && (c.code === customerCode || c.id === customerCode));
                                if (!isMatch) return c;
                                const rawDeuda = deuda !== undefined ? Number(deuda) : c.deuda;
                                const rawFavor = favor !== undefined ? Number(favor) : c.favor;
                                const saldoNeto = subR(rawFavor, rawDeuda);
                                return {
                                    ...c,
                                    favor: saldoNeto > 0 ? round2(saldoNeto) : 0,
                                    deuda: saldoNeto < 0 ? round2(Math.abs(saldoNeto)) : 0,
                                    updatedAt: new Date().toISOString(),
                                };
                            });
                            await storageService.setItem('bodega_customers_v1', newCustomers);
                            savedCustomers = newCustomers;
                        });

                        if (savedCustomers) {
                            appliedIds.add(command.id);
                            markApplied(command.id);
                            await updateCommandStatus(command.id, 'applied');
                            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_sales_v1' } }));
                            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_customers_v1', value: savedCustomers } }));
                            await pushCloudSync('bodega_sales_v1', await storageService.getItem('bodega_sales_v1', []), true).catch(() => {});
                            await pushCloudSync('bodega_customers_v1', savedCustomers, true);
                        } else {
                            await updateCommandStatus(command.id, 'failed', 'No se pudo registrar el abono');
                        }
                    } catch (err) {
                        appliedIds.delete(command.id);
                        unmarkApplied(command.id);
                        console.error('[SupervisorCommands] Error al registrar abono de cliente:', err);
                        await updateCommandStatus(command.id, 'failed', err?.message);
                    }
                    return;
                }
                if (command.payload?.action === 'update_sales_record') {
                    try {
                        const { recordId, patch } = command.payload || {};
                        const { storageService } = await import('../utils/storageService');
                        const { pushCloudSync } = await import('./useCloudSync');
                        const { withLock } = await import('../utils/withLock');

                        if (!recordId || !patch || typeof patch !== 'object') {
                            await updateCommandStatus(command.id, 'failed', 'Datos de corrección inválidos');
                            return;
                        }

                        let updated = false;
                        let updatedSales = null;
                        await withLock('pos_write_lock', async () => {
                            const sales = await storageService.getItem('bodega_sales_v1', []) || [];
                            updatedSales = sales.map(s => {
                                if (s.id !== recordId) return s;
                                updated = true;
                                return { ...s, ...patch, updatedAt: new Date().toISOString() };
                            });
                            if (updated) {
                                await storageService.setItem('bodega_sales_v1', updatedSales);
                                try {
                                    await storageService.setItem('bodega_sales_mirror_v1', updatedSales);
                                } catch (_) {}
                            }
                        });

                        if (updated) {
                            appliedIds.add(command.id);
                            markApplied(command.id);
                            await updateCommandStatus(command.id, 'applied');
                            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_sales_v1' } }));
                            await pushCloudSync('bodega_sales_v1', updatedSales, true).catch(() => {});
                        } else {
                            await updateCommandStatus(command.id, 'failed', 'Registro no encontrado en la caja');
                        }
                    } catch (err) {
                        appliedIds.delete(command.id);
                        unmarkApplied(command.id);
                        console.error('[SupervisorCommands] Error al corregir registro de ventas:', err);
                        await updateCommandStatus(command.id, 'failed', err?.message);
                    }
                    return;
                }
                if (command.payload?.action === 'void_employee_consumption') {
                    try {
                        const { consumptionId, reason } = command.payload || {};
                        const { voidEmployeeConsumptionFromSupervisor } = await import('../services/employeeService');
                        const { pushCloudSync } = await import('./useCloudSync');
                        const { storageService } = await import('../utils/storageService');

                        await voidEmployeeConsumptionFromSupervisor(consumptionId, reason || 'Anulado por Supervisor', {
                            id: command.payload?.supervisorId || null,
                            nombre: command.payload?.supervisorName || command.payload?.supervisorNombre || 'Supervisor',
                            rol: command.payload?.supervisorRole || command.payload?.supervisorRol || 'SUPERVISOR',
                        });
                        appliedIds.add(command.id);
                        markApplied(command.id);
                        await updateCommandStatus(command.id, 'applied');

                        window.dispatchEvent(new CustomEvent('employee-data-updated'));
                        window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_employee_consumptions_v1' } }));
                        window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_products_v1' } }));

                        try {
                            const freshConsumptions = await storageService.getItem('bodega_employee_consumptions_v1', []);
                            const freshProducts = await storageService.getItem('bodega_products_v1', []);
                            const freshProjection = await storageService.getItem('bodega_employee_payroll_projection_v1', null);
                            if (freshConsumptions) await pushCloudSync('bodega_employee_consumptions_v1', freshConsumptions, true);
                            if (freshProducts) await pushCloudSync('bodega_products_v1', freshProducts, true);
                            if (freshProjection) await pushCloudSync('bodega_employee_payroll_projection_v1', freshProjection, true);
                        } catch (_) {}
                    } catch (err) {
                        appliedIds.delete(command.id);
                        unmarkApplied(command.id);
                        console.error('[SupervisorCommands] Error al anular consumo de empleado:', err);
                        await updateCommandStatus(command.id, 'failed', err?.message);
                    }
                    return;
                }
                if (command.payload?.action === 'save_employee') {
                    try {
                        const { employee } = command.payload || {};
                        const { saveEmployeeFromSupervisor } = await import('../services/employeeService');
                        const { pushCloudSync } = await import('./useCloudSync');
                        const { storageService } = await import('../utils/storageService');

                        if (employee) {
                            await saveEmployeeFromSupervisor(employee, {
                                id: command.payload?.supervisorId || null,
                                nombre: command.payload?.supervisorName || command.payload?.supervisorNombre || 'Supervisor',
                                rol: command.payload?.supervisorRole || command.payload?.supervisorRol || 'SUPERVISOR',
                            });
                            appliedIds.add(command.id);
                            markApplied(command.id);
                            await updateCommandStatus(command.id, 'applied');

                            window.dispatchEvent(new CustomEvent('employee-data-updated'));
                            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_employees_v1' } }));

                            try {
                                const freshEmployees = await storageService.getItem('bodega_employees_v1', []);
                                const freshProjection = await storageService.getItem('bodega_employee_payroll_projection_v1', null);
                                if (freshEmployees) await pushCloudSync('bodega_employees_v1', freshEmployees, true);
                                if (freshProjection) await pushCloudSync('bodega_employee_payroll_projection_v1', freshProjection, true);
                            } catch (_) {}
                        }
                    } catch (err) {
                        appliedIds.delete(command.id);
                        unmarkApplied(command.id);
                        console.error('[SupervisorCommands] Error al guardar empleado:', err);
                        await updateCommandStatus(command.id, 'failed', err?.message);
                    }
                    return;
                }
                if (command.payload?.action === 'delete_employee') {
                    try {
                        const { employeeId } = command.payload || {};
                        const { deleteEmployeeFromSupervisor } = await import('../services/employeeService');
                        const { pushCloudSync } = await import('./useCloudSync');
                        const { storageService } = await import('../utils/storageService');

                        if (employeeId) {
                            await deleteEmployeeFromSupervisor(employeeId, {
                                id: command.payload?.supervisorId || null,
                                nombre: command.payload?.supervisorName || command.payload?.supervisorNombre || 'Supervisor',
                                rol: command.payload?.supervisorRole || command.payload?.supervisorRol || 'SUPERVISOR',
                            });
                            appliedIds.add(command.id);
                            markApplied(command.id);
                            await updateCommandStatus(command.id, 'applied');

                            window.dispatchEvent(new CustomEvent('employee-data-updated'));
                            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_employees_v1' } }));

                            try {
                                const freshEmployees = await storageService.getItem('bodega_employees_v1', []);
                                const freshProjection = await storageService.getItem('bodega_employee_payroll_projection_v1', null);
                                if (freshEmployees) await pushCloudSync('bodega_employees_v1', freshEmployees, true);
                                if (freshProjection) await pushCloudSync('bodega_employee_payroll_projection_v1', freshProjection, true);
                            } catch (_) {}
                        }
                    } catch (err) {
                        appliedIds.delete(command.id);
                        unmarkApplied(command.id);
                        console.error('[SupervisorCommands] Error al eliminar empleado:', err);
                        await updateCommandStatus(command.id, 'failed', err?.message);
                    }
                    return;
                }
                if (command.payload?.action === 'register_expense' || command.payload?.action === 'add_gasto') {
                    try {
                        const { gasto } = command.payload || {};
                        const { storageService } = await import('../utils/storageService');
                        const { pushCloudSync } = await import('./useCloudSync');
                        const { withLock } = await import('../utils/withLock');

                        if (!gasto || !gasto.id) {
                            await updateCommandStatus(command.id, 'failed', 'Datos de gasto inválidos');
                            return;
                        }

                        let updatedSales = null;
                        await withLock('pos_write_lock', async () => {
                            const sales = await storageService.getItem('bodega_sales_v1', []) || [];
                            if (sales.some(s => s.id === gasto.id)) {
                                updatedSales = sales;
                                return;
                            }
                            updatedSales = [gasto, ...sales];
                            await storageService.setItem('bodega_sales_v1', updatedSales);
                            try {
                                await storageService.setItem('bodega_sales_mirror_v1', updatedSales);
                            } catch (_) {}
                        });

                        appliedIds.add(command.id);
                        markApplied(command.id);
                        await updateCommandStatus(command.id, 'applied');

                        window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_sales_v1' } }));
                        window.dispatchEvent(new CustomEvent('supervisor_expense_registered', { detail: { gasto } }));

                        if (updatedSales) {
                            await pushCloudSync('bodega_sales_v1', updatedSales, true).catch(() => {});
                            await pushCloudSync('bodega_sales_mirror_v1', updatedSales, true).catch(() => {});
                        }
                    } catch (err) {
                        appliedIds.delete(command.id);
                        unmarkApplied(command.id);
                        console.error('[SupervisorCommands] Error al registrar gasto desde supervisor:', err);
                        await updateCommandStatus(command.id, 'failed', err?.message);
                    }
                    return;
                }
                try {
                    const result = await applyInventoryCommand({
                        ...(command.payload || {}),
                        operationId: command.id
                    });
                    if (result.success) {
                        // Marcar solo después de que la caja confirmó la mutación
                        // local. Si falla el comando, el catch-up debe poder reintentarlo.
                        appliedIds.add(command.id);
                        markApplied(command.id);
                        const nextStatus = result.pending || result.failedCount > 0
                            ? COMMAND_STATUS.APPLIED_WITH_WARNINGS
                            : COMMAND_STATUS.APPLIED;
                        const warnMsg = result.pending
                            ? `Operación ${result.operationId || command.id} quedó persistida para recuperación local.`
                            : (result.failedCount > 0
                                ? `${result.appliedCount} aplicados, ${result.failedCount} fallaron (${result.failedItems?.map(f => f.productName || f.productId).join(', ')})`
                                : null);
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
                        appliedIds.delete(command.id);
                        unmarkApplied(command.id);
                        await updateCommandStatus(command.id, 'failed', result.error);
                    }
                } catch (err) {
                    appliedIds.delete(command.id);
                    unmarkApplied(command.id);
                    console.error('[SupervisorCommands] Error al aplicar inventory_update:', err);
                    await updateCommandStatus(command.id, 'failed', err?.message);
                }
            } else if (command.command_type === 'user_update') {
                try {
                    const { action, userId, newPin, newPinHash, nombre, rol, bypassPin } = command.payload || {};
                    // S5: `newPin` (en claro) queda solo por compatibilidad con
                    // comandos encolados antes del despliegue de esta versión.
                    // Se eliminará en la siguiente. El camino vigente es newPinHash.
                    if (newPin) {
                        console.warn('[SupervisorCommands] Comando legacy con PIN en claro; migra el monitor a newPinHash.');
                    }
                    const { useAuthStore } = await import('./store/useAuthStore');
                    const store = useAuthStore.getState();

                    let res;
                    let applied = false;
                    let failReason = '';

                    if (action === 'change_pin' && userId && (newPinHash || newPin)) {
                        const target = store.usuarios.find(u => u.id === userId);
                        if (!target) {
                            failReason = `Usuario con ID ${userId} no existe en la caja`;
                        } else if (newPin && store.usuarios.some(u => u.id !== userId && (u.plainPin === newPin || u.pin === newPin))) {
                            failReason = `El PIN ya está asignado a otro usuario en la caja`;
                        } else {
                            // S5: ruta preferente = hash; `cambiarPin` (claro) es legacy.
                            res = newPinHash
                                ? store.setPinHash(userId, newPinHash)
                                : store.cambiarPin(userId, newPin);
                            applied = true;
                        }
                    } else if (action === 'add' && nombre) {
                        if (!bypassPin && !newPinHash && !newPin) {
                            failReason = `Comando inválido: falta el PIN del nuevo usuario`;
                        } else if (!bypassPin && newPin && store.usuarios.some(u => u.plainPin === newPin || u.pin === newPin)) {
                            failReason = `El PIN ya está asignado a otro usuario en la caja`;
                        } else {
                            res = store.agregarUsuario(
                                nombre, rol || 'CAJERO', newPin || '', bypassPin,
                                newPinHash ? { pinHash: newPinHash } : undefined
                            );
                            if (!res?.ok && res?.error) {
                                failReason = res.error;
                            } else {
                                applied = true;
                            }
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
                    try {
                        const { sanitizeUserCatalog } = await import('../utils/userCatalog');
                        const sanitizedUsers = sanitizeUserCatalog(freshUsers);
                        // S4: el catálogo en disco también viaja a sync_documents vía
                        // forcePushLocalData. Escribirlo en crudo aquí anulaba el
                        // saneamiento de la subida.
                        localStorage.setItem('bodega_users_catalog_v1', JSON.stringify(sanitizeUserCatalog(freshUsers)));
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
                        appliedIds.add(command.id);
                        markApplied(command.id);
                        await updateCommandStatus(command.id, 'applied');
                    } else {
                        const result = await processVoidSale(targetSale, freshSales, freshProducts, {
                            id: command.payload?.supervisorId,
                            nombre: command.payload?.supervisorName,
                            rol: command.payload?.supervisorRole,
                            commandId: command.id,
                        });
                        appliedIds.add(command.id);
                        markApplied(command.id);
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
                    appliedIds.delete(command.id);
                    unmarkApplied(command.id);
                    console.error('[SupervisorCommands] Error al anular venta remota:', err);
                    await updateCommandStatus(command.id, 'failed', err?.message);
                }
            } else if (command.command_type === 'save_employee' || (command.command_type === 'inventory_update' && command.payload?.action === 'save_employee')) {
                try {
                    const { employee } = command.payload || {};
                    const { saveEmployeeFromSupervisor } = await import('../services/employeeService');
                    const { pushCloudSync } = await import('./useCloudSync');
                    const { storageService } = await import('../utils/storageService');

                    if (employee) {
                        await saveEmployeeFromSupervisor(employee, {
                            id: command.payload?.supervisorId || null,
                            nombre: command.payload?.supervisorName || command.payload?.supervisorNombre || 'Supervisor',
                            rol: command.payload?.supervisorRole || command.payload?.supervisorRol || 'SUPERVISOR',
                        });
                        appliedIds.add(command.id);
                        markApplied(command.id);
                        await updateCommandStatus(command.id, 'applied');

                        window.dispatchEvent(new CustomEvent('employee-data-updated'));
                        window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_employees_v1' } }));

                        try {
                            const freshEmployees = await storageService.getItem('bodega_employees_v1', []);
                            const freshProjection = await storageService.getItem('bodega_employee_payroll_projection_v1', null);
                            if (freshEmployees) await pushCloudSync('bodega_employees_v1', freshEmployees, true);
                            if (freshProjection) await pushCloudSync('bodega_employee_payroll_projection_v1', freshProjection, true);
                        } catch (_) {}
                    }
                } catch (err) {
                    appliedIds.delete(command.id);
                    unmarkApplied(command.id);
                    console.error('[SupervisorCommands] Error al guardar empleado remoto:', err);
                    await updateCommandStatus(command.id, 'failed', err?.message);
                }
            } else if (command.command_type === 'delete_employee' || (command.command_type === 'inventory_update' && command.payload?.action === 'delete_employee')) {
                try {
                    const { employeeId } = command.payload || {};
                    const { deleteEmployeeFromSupervisor } = await import('../services/employeeService');
                    const { pushCloudSync } = await import('./useCloudSync');
                    const { storageService } = await import('../utils/storageService');

                    if (employeeId) {
                        await deleteEmployeeFromSupervisor(employeeId, {
                            id: command.payload?.supervisorId || null,
                            nombre: command.payload?.supervisorName || command.payload?.supervisorNombre || 'Supervisor',
                            rol: command.payload?.supervisorRole || command.payload?.supervisorRol || 'SUPERVISOR',
                        });
                        appliedIds.add(command.id);
                        markApplied(command.id);
                        await updateCommandStatus(command.id, 'applied');

                        window.dispatchEvent(new CustomEvent('employee-data-updated'));
                        window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_employees_v1' } }));

                        try {
                            const freshEmployees = await storageService.getItem('bodega_employees_v1', []);
                            const freshProjection = await storageService.getItem('bodega_employee_payroll_projection_v1', null);
                            if (freshEmployees) await pushCloudSync('bodega_employees_v1', freshEmployees, true);
                            if (freshProjection) await pushCloudSync('bodega_employee_payroll_projection_v1', freshProjection, true);
                        } catch (_) {}
                    }
                } catch (err) {
                    appliedIds.delete(command.id);
                    unmarkApplied(command.id);
                    console.error('[SupervisorCommands] Error al eliminar empleado remoto:', err);
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

                        const { movements, orphans, voided, apertura } = getOpenShiftMovements(sales);
                        if (movements.length === 0 && (orphans || []).length === 0 && (!voided || voided.length === 0) && !apertura) {
                            return { empty: true };
                        }

                        const closingIds = new Set([
                            ...movements.map(s => s.id),
                            ...(orphans || []).map(s => s.id),
                            ...(voided || []).map(s => s.id),
                            ...(apertura ? [apertura.id] : [])
                        ]);
                        const updatedSales = sales.map(s =>
                            closingIds.has(s.id) ? { ...s, cajaCerrada: true, cierreId: targetCierreId } : s
                        );

                        const existingCloses = sales.filter(s => s.tipo === 'REGISTRO_CIERRE');
                        const cierreNumber = command.payload?.cierreNumber || (existingCloses.reduce((mx, s) => Math.max(mx, s.cierreNumber || 0), 0) + 1);

                        const allShiftSales = [...movements, ...(orphans || [])].filter(s => ['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA'].includes(s.tipo || 'VENTA'));
                        const totalUsd = allShiftSales.reduce((sum, s) => sum + (s.totalUsd || 0), 0);
                        const totalBs = allShiftSales.reduce((sum, s) => sum + (s.totalBs || 0), 0);
                        const itemsSold = allShiftSales.reduce((sum, s) => sum + (s.items ? s.items.reduce((is, i) => is + i.qty, 0) : 0), 0);

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
                                todayTotalUsd: totalUsd,
                                todayTotalBs: totalBs,
                                todayItemsSold: itemsSold,
                                reconData: null,
                                sinCuadreFisico: true,
                                orphanCount: orphans.length
                            }
                        };

                        updatedSales.push(registroCierre);
                        await storageService.setItem('bodega_sales_v1', updatedSales);
                        try {
                            await storageService.setItem('bodega_sales_mirror_v1', updatedSales);
                            localStorage.removeItem('bodega_active_shift_anchor');
                            await storageService.removeItem('bodega_active_shift_v1');
                        } catch (_) {}
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
                    await pushCloudSync('bodega_sales_mirror_v1', result.updatedSales, true).catch(() => {});
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
                            const activeApertura = reopenedSales.find(s => s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
                            if (activeApertura) {
                                localStorage.setItem('bodega_active_shift_anchor', JSON.stringify(activeApertura));
                                await storageService.setItem('bodega_active_shift_v1', activeApertura);
                            }
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
            } else if (
                command.command_type === 'enable_feature' ||
                (command.command_type === 'inventory_update' && command.payload?.action === 'enable_feature')
            ) {
                // FASE 1 del plan maestro: activación remota de feature flags.
                // Sobre el envelope inventory_update (único permitido por la
                // constraint viva de supervisor_commands). Lista blanca estricta:
                // solo flags de sync aprobados. Cualquier otra clave se rechaza
                // explícitamente (no es un backdoor de config genérico).
                // Idempotente: reenviar el comando no rompe nada. Con código VIEJO
                // en la caja, el envelope cae en applyInventoryCommand y falla con
                // "Acción inválida" (inofensivo) hasta que el SW se active.
                try {
                    const flag = command.payload?.flag;
                    // Existing queued envelopes use action=enable_feature; keep
                    // the operation separate from the routing discriminator.
                    const action = command.payload?.action === 'enable_feature'
                        ? (command.payload?.flagAction ?? 'enable')
                        : command.payload?.action; // 'enable' | 'disable' | 'clear'
                    const ALLOWED_FLAGS = ['dj_sales_push_merge_v1'];

                    if (!ALLOWED_FLAGS.includes(flag)) {
                        await updateCommandStatus(command.id, 'failed', `Flag no permitido: ${String(flag).slice(0, 100)}`);
                        return;
                    }

                    if (action === 'enable') {
                        localStorage.setItem(flag, 'true');
                    } else if (action === 'disable') {
                        localStorage.setItem(flag, 'false');
                    } else if (action === 'clear') {
                        localStorage.removeItem(flag);
                    } else {
                        await updateCommandStatus(command.id, 'failed', `Acción inválida: ${String(action).slice(0, 50)}`);
                        return;
                    }

                    appliedIds.add(command.id);
                    markApplied(command.id);
                    await updateCommandStatus(command.id, 'applied');

                    // Efecto inmediato: con el merge activado, empujar el historial
                    // local fusionado. Si el RPC de lectura falla o no hay pairing,
                    // el push actúa igual que siempre (passthrough + breaker).
                    if (flag === 'dj_sales_push_merge_v1' && action === 'enable') {
                        try {
                            const { pushCloudSync } = await import('./useCloudSync');
                            const { storageService } = await import('../utils/storageService');
                            const sales = await storageService.getItem('bodega_sales_v1', []);
                            await pushCloudSync('bodega_sales_v1', sales, true);
                        } catch (pushErr) {
                            console.warn('[SupervisorCommands] Push post-enable falló (se reintentará en el ciclo periódico):', pushErr);
                        }
                    }
                } catch (err) {
                    console.error('[SupervisorCommands] Error en enable_feature:', err);
                    await updateCommandStatus(command.id, 'failed', err?.message);
                }
            } else if (
                command.command_type === 'inventory_update' &&
                command.payload?.action === 'replace_sales_history'
            ) {
                // FASE 2 del plan maestro: reconstrucción del historial local de
                // ventas desde el Doc 60 canónico, en dos fases (prepare → apply).
                // Especificación: docs/FASE-2-HANDOFF-REPLACE-SALES-HISTORY.md
                // Con código VIEJO en la caja, el envelope cae en
                // applyInventoryCommand y falla como "Acción inválida"
                // (inofensivo, sin efectos) hasta que el SW se active.
                try {
                    const PROD_DEVICE_ID = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';
                    const { withLock } = await import('../utils/withLock');
                    const { storageService } = await import('../utils/storageService');
                    const { fetchCloudSalesReference } = await import('../utils/salesPushMerge');
                    const { detectActiveShift, validateReplacePreconditions } = await import('../utils/salesHistoryRestore');
                    const { pushCloudSync } = await import('./useCloudSync');

                    const localSales = await storageService.getItem('bodega_sales_v1', []);
                    const phase = command.payload?.phase === 'apply' ? 'apply' : 'prepare';

                    // Gate 1: solo el dispositivo de producción. La instancia
                    // fantasma (mismo device_id) aplicarla es seguro por diseño:
                    // su store pasaría a ser copia del Doc 60 (spec §3).
                    if (deviceId !== PROD_DEVICE_ID) {
                        await updateCommandStatus(command.id, 'failed', `Dispositivo no autorizado: ${String(deviceId).slice(0, 60)}`);
                        return;
                    }

                    // Gate 2: sin turno activo — re-verificado en AMBAS fases.
                    const shift = detectActiveShift(localSales);
                    if (shift.open) {
                        await updateCommandStatus(command.id, 'failed', `turno activo — reintentar en horario cerrado (apertura ${shift.aperturaId || '?'})`);
                        return;
                    }

                    if (phase === 'prepare') {
                        // ── PREPARE: validar + verificar backup. NO muta ventas. ──
                        // Lectura FRESCA del Doc 60 (sin caché TTL): el token y la
                        // decisión dependen del estado real de la nube.
                        const cloudRef = await fetchCloudSalesReference(deviceId, undefined, { fresh: true });
                        const check = validateReplacePreconditions(localSales, cloudRef, null);
                        if (!check.ok) {
                            await updateCommandStatus(command.id, 'failed', check.reason);
                            return;
                        }
                        // Red de seguridad obligatoria: debe existir un backup
                        // completo reciente (<30 min). El encolador lanza
                        // request_full_backup justo antes de prepare.
                        const { data: pair } = await supabaseCloud
                            .from('device_pairings')
                            .select('monitor_device_id')
                            .eq('primary_device_id', deviceId)
                            .maybeSingle();
                        const { data: bk, error: bkErr } = await supabaseCloud.rpc('read_paired_cloud_backup', {
                            p_primary_device_id: deviceId,
                            p_monitor_device_id: pair?.monitor_device_id || '',
                            p_updated_after: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
                        });
                        if (bkErr || !Array.isArray(bk) || bk.length === 0) {
                            await updateCommandStatus(command.id, 'failed', 'sin backup reciente (<30 min) — encolar request_full_backup antes de prepare');
                            return;
                        }
                        appliedIds.add(command.id);
                        markApplied(command.id);
                        await updateCommandStatus(command.id, COMMAND_STATUS.APPLIED);
                        logEvent('SUPERVISOR', 'replace_sales_history_prepare', `token=${check.confirmToken}; local=${Array.isArray(localSales) ? localSales.length : 0} registros; cloud=${cloudRef.length} registros (comando ${command.id})`);
                        return;
                    }

                    // ── APPLY: la reconstrucción real, bajo pos_write_lock ──
                    const result = await withLock('pos_write_lock', async () => {
                        // Re-chequeo de gates: el estado pudo cambiar tras prepare.
                        const localNow = await storageService.getItem('bodega_sales_v1', []);
                        const shiftNow = detectActiveShift(localNow);
                        if (shiftNow.open) throw new Error(`turno activo — apply cancelado (apertura ${shiftNow.aperturaId || '?'})`);
                        // Re-lectura FRESCA + token: prueba que el encolador verificó
                        // la MISMA nube y que no se movió desde prepare.
                        const cloudNow = await fetchCloudSalesReference(deviceId, undefined, { fresh: true });
                        const check = validateReplacePreconditions(localNow, cloudNow, command.payload?.confirmToken);
                        if (!check.ok) throw new Error(check.reason);
                        const before = Array.isArray(localNow) ? localNow.length : 0;
                        // ÚNICA escritura: bodega_sales_v1. Jamás otros docs ni flags.
                        await storageService.setItem('bodega_sales_v1', cloudNow);
                        // Post-invariantes (reporte; no hay rollback automático: el
                        // rollback es el backup de prepare + re-aplicar desde nube).
                        const afterArr = await storageService.getItem('bodega_sales_v1', []);
                        const after = Array.isArray(afterArr) ? afterArr.length : -1;
                        const cierresDespues = (Array.isArray(afterArr) ? afterArr : []).filter((s) => s?.tipo === 'REGISTRO_CIERRE').length;
                        const cierresCloud = cloudNow.filter((s) => s?.tipo === 'REGISTRO_CIERRE').length;
                        const warnings = [];
                        if (after !== cloudNow.length) warnings.push(`conteo post-apply ${after} != cloud ${cloudNow.length}`);
                        if (cierresDespues !== cierresCloud) warnings.push(`cierres post-apply ${cierresDespues} != cloud ${cierresCloud}`);
                        return { before, after, token: check.confirmToken, cloudCount: cloudNow.length, warnings };
                    });

                    appliedIds.add(command.id);
                    markApplied(command.id);
                    await updateCommandStatus(
                        command.id,
                        result.warnings.length ? COMMAND_STATUS.APPLIED_WITH_WARNINGS : COMMAND_STATUS.APPLIED,
                        result.warnings.length ? result.warnings.join('; ') : null,
                    );
                    logEvent('SUPERVISOR', 'replace_sales_history_apply', `historial reconstruido desde Doc 60: ${result.before} → ${result.after} registros, token=${result.token} (comando ${command.id})`);

                    // Confirmación end-to-end: con FASE 1 activa, un push fusionado
                    // es un no-op de unión (local == cloud). Si el flag NO está
                    // activo, no empujar: el breaker lo bloquearía (ruido inútil).
                    if (localStorage.getItem('dj_sales_push_merge_v1') === 'true') {
                        try {
                            const restored = await storageService.getItem('bodega_sales_v1', []);
                            await pushCloudSync('bodega_sales_v1', restored, true);
                        } catch (pushErr) {
                            console.warn('[SupervisorCommands] Push post-replace falló (se reintentará en el ciclo):', pushErr);
                        }
                    }
                    window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_sales_v1' } }));
                } catch (err) {
                    console.error('[SupervisorCommands] Error en replace_sales_history:', err);
                    await updateCommandStatus(command.id, 'failed', err?.message);
                }
            }
            // Tipos desconocidos: se ignoran (comportamiento histórico)
        };

        const processCommandOnce = async (command) => {
            try {
                return await processCommand(command);
            } finally {
                if (command?.id) _processingCommandIds.delete(command.id);
            }
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
                    await processCommandOnce(command);
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
            }, (payload) => processCommandOnce(payload.new))
            .subscribe((status) => {
                // SUBSCRIBED se emite al conectar Y al reconectar: cubre los
                // comandos que llegaron mientras el websocket estuvo caído.
                if (status === 'SUBSCRIBED') catchUpPending();
            });

        // Red de seguridad contra micro-cortes: Polling periódico cada 12s.
        // Si el WebSocket falla silenciosamente (sin emitir CLOSED), esta línea
        // de defensa limpia los comandos pendientes que se hayan acumulado.
        const intervalId = setInterval(() => {
            if (!disposed && navigator.onLine !== false) {
                catchUpPending();
            }
        }, 12000);

        // Catch-up inmediato al recuperar conexión de red
        const handleOnline = () => {
            if (!disposed) catchUpPending();
        };
        window.addEventListener('online', handleOnline);

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
            _activeSubscriberCount--;
            _activeSubscriberDevices.delete(subscriberKey);
            clearInterval(intervalId);
            window.removeEventListener('online', handleOnline);
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('pagehide', handleUnload);
            window.removeEventListener('beforeunload', handleUnload);
            supabaseCloud.removeChannel(channel).catch(() => {});
        };
    }, [deviceId]);
}
