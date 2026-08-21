/**
 * src/hooks/useSupervisorCommandQueue.js
 *
 * Cola de comandos supervisor → caja: pendientes locales (TTL 24h), en vuelo
 * (TTL 20min), comandos en la nube, polling de estado, realtime, autoupload,
 * anulación de comandos y descarga de backup remoto.
 *
 * Extraído de OwnerMonitorView.jsx (refactor 2026-08-21). Comportamiento
 * idéntico; los estados/handlers se movieron sin cambios de lógica.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { showToast } from '../components/Toast';
import { COMMAND_STATUS } from '../constants/commandStatus';
import { fetchRemoteFullBackup } from '../services/remoteAuditService';
import { applyProjectedStock } from '../utils/supervisorStockProjection';
import {
    createSupervisorCommandId,
    getSupervisorChangeKey,
    getSupervisorChangeResolution,
    normalizeSupervisorChanges,
    restoreLocalRateState,
    SUPERVISOR_RATE_PENDING_KEY,
} from '../utils/supervisorCommandModel';

const PENDING_KEY = 'dj_pending_inventory_changes_v1';
const INFLIGHT_KEY = 'dj_inflight_inventory_changes_v1';

export function useSupervisorCommandQueue({
    pairedDeviceId,
    products,
    setProducts,
    supervisorUser,
    triggerHaptic,
    setSales,
    setSelectedSaleDetail,
}) {
    const [cloudPendingCmds, setCloudPendingCmds] = useState([]);
    const [allCloudCmds, setAllCloudCmds] = useState([]);
    const [cmdTabFilter, setCmdTabFilter] = useState('todos'); // 'todos', 'pending', 'applied', 'cancelled'
    const [currentPageCambios, setCurrentPageCambios] = useState(1);
    const ITEMS_PER_PAGE_CAMBIOS = 10;
    const [showCloudPendingModal, setShowCloudPendingModal] = useState(false);
    const [showDiscardQueueModal, setShowDiscardQueueModal] = useState(false);
    const [cancellingCmdId, setCancellingCmdId] = useState(null);
    const [downloadingBackup, setDownloadingBackup] = useState(false);
    const [pendingChanges, setPendingChanges] = useState(() => {
        try {
            const raw = localStorage.getItem(PENDING_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            const now = Date.now();
            const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h para pendientes locales
            const valid = (Array.isArray(arr) ? arr : []).filter(c => {
                const time = new Date(c.queuedAt || c.sentAt || 0).getTime();
                return !Number.isFinite(time) || (now - time) < MAX_AGE_MS;
            });
            return normalizeSupervisorChanges(valid);
        } catch { return []; }
    });
    const [inFlightChanges, setInFlightChanges] = useState(() => {
        try {
            const raw = localStorage.getItem(INFLIGHT_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            const now = Date.now();
            const MAX_INFLIGHT_AGE_MS = 20 * 60 * 1000; // 20 minutos máximo para cambios en confirmación huérfanos
            const valid = (Array.isArray(arr) ? arr : []).filter(c => {
                const time = new Date(c.sentAt || c.queuedAt || 0).getTime();
                return Number.isFinite(time) && (now - time) < MAX_INFLIGHT_AGE_MS;
            });
            return normalizeSupervisorChanges(valid);
        } catch { return []; }
    });
    const [uploading, setUploading] = useState(false);
    const uploadingRef = useRef(false);
    const [recentlyConfirmedIds, setRecentlyConfirmedIds] = useState(() => new Set());
    const [pendingVoidSaleIds, setPendingVoidSaleIds] = useState(() => new Set());
    const [pendingVoidCommands, setPendingVoidCommands] = useState({});
    const notifiedCommandIdsRef = useRef(new Set());
    const autoUploadTimerRef = useRef(null);
    const uploadPendingChangesRef = useRef(null);

    const totalControlChanges = pendingChanges.length + cloudPendingCmds.length;

    // El polling de estado solo consulta IDs que el Supervisor ya conoce. Así
    // recupera un UPDATE perdido sin volver a descargar los 150 comandos cada
    // pocos segundos ni consumir egress cuando no hay nada pendiente.
    const commandStateRefs = useRef({
        allCloudCmds: [],
        pendingChanges: [],
        inFlightChanges: [],
        pendingVoidCommands: {},
    });

    useEffect(() => {
        commandStateRefs.current = {
            allCloudCmds,
            pendingChanges,
            inFlightChanges,
            pendingVoidCommands,
        };
    }, [allCloudCmds, pendingChanges, inFlightChanges, pendingVoidCommands]);

    const persistInFlight = useCallback((next) => {
        const normalized = normalizeSupervisorChanges(next);
        setInFlightChanges(normalized);
        try {
            localStorage.setItem(INFLIGHT_KEY, JSON.stringify(normalized));
        } catch { /* storage lleno */ }
    }, []);

    const getChangeKey = useCallback((change) => getSupervisorChangeKey(change), []);

    const isInventoryChangeConfirmed = useCallback((change, catalog) => {
        if (!change || !Array.isArray(catalog)) return false;
        const product = catalog.find(p => String(p.id) === String(change.productId));

        if (change.action === 'add') {
            if (!product) return false;
            const expectedStock = Number(change.data?.stock);
            return Number.isFinite(expectedStock)
                ? Number(product.stock) === Math.max(0, expectedStock)
                    || product.stockOperationIds?.includes(change.commandId)
                : true;
        }
        if (change.action === 'delete') return !product;
        if (change.action === 'adjust_stock') {
            if (product.stockOperationIds?.includes(change.commandId)) return true;
            const target = change.data?.targetStock;
            const expectedStock = target !== undefined && target !== null && target !== ''
                ? Math.max(0, Number(target))
                : (change.baseStock !== undefined
                    ? applyProjectedStock(Number(change.baseStock), [change])
                    : null);
            return Boolean(product && expectedStock !== null && Number(product.stock) === expectedStock);
        }
        if (change.action !== 'edit' || !product) return false;

        const data = change.data || {};
        return Object.entries(data)
            .filter(([key]) => !['baseUpdatedAt', 'updatedAt', 'createdAt', 'stock'].includes(key) && !key.startsWith('_'))
            .every(([key, expected]) => {
                if (key === 'name') return String(product[key] || '').trim() === String(expected || '').trim();
                if (expected === null || expected === undefined || expected === '') return true;
                return String(product[key] ?? '') === String(expected);
            });
    }, []);

    useEffect(() => {
        if (inFlightChanges.length === 0 || !Array.isArray(products)) return;

        const ownMonitorId = localStorage.getItem('dj_device_id');
        const inventoryCommands = new Map(
            (Array.isArray(allCloudCmds) ? allCloudCmds : [])
                .filter(command => command.monitor_device_id === ownMonitorId
                    && command.command_type === 'inventory_update')
                .map(command => [command.id, command])
        );
        const commandList = [...inventoryCommands.values()];
        const confirmedKeys = new Set();
        const rejectedKeys = new Set();

        for (const change of inFlightChanges) {
            const resolution = getSupervisorChangeResolution(change, commandList);
            const command = resolution.command;
            if (resolution.status === 'pending' || !command) continue;

            if (resolution.status === 'rejected') {
                rejectedKeys.add(getChangeKey(change));
                if (command.id && !notifiedCommandIdsRef.current.has(command.id)) {
                    notifiedCommandIdsRef.current.add(command.id);
                    showToast(
                        `La caja rechazó ${change.action === 'adjust_stock' ? 'el ajuste de stock' : 'el cambio de inventario'}${command.error_reason ? `: ${command.error_reason}` : ''}. Se restauró la vista anterior.`,
                        'error'
                    );
                }
            } else if (resolution.status === 'applied' || ['applied', 'applied_with_warnings'].includes(command.status)) {
                confirmedKeys.add(getChangeKey(change));
            }
        }

        // Las órdenes confirmadas por la caja (o reflejadas en catálogo) se retiran de inmediato de la cola
        for (const change of inFlightChanges) {
            if (rejectedKeys.has(getChangeKey(change)) || confirmedKeys.has(getChangeKey(change))) continue;
            const command = inventoryCommands.get(change.commandId);
            if (command && ['applied', 'applied_with_warnings'].includes(command.status)) {
                confirmedKeys.add(getChangeKey(change));
            } else if (change.action !== 'adjust_stock' && isInventoryChangeConfirmed(change, products)) {
                confirmedKeys.add(getChangeKey(change));
            }
        }

        const stockGroups = new Map();
        inFlightChanges
            .filter(change => change.action === 'adjust_stock' && !rejectedKeys.has(getChangeKey(change)) && !confirmedKeys.has(getChangeKey(change)))
            .forEach(change => {
                const key = String(change.productId);
                if (!stockGroups.has(key)) stockGroups.set(key, []);
                stockGroups.get(key).push(change);
            });

        for (const [productId, group] of stockGroups) {
            const product = products.find(p => String(p.id) === productId);
            if (!product || group.length === 0) continue;
            const ordered = [...group].sort((a, b) =>
                String(a.sentAt || a.queuedAt || '').localeCompare(String(b.sentAt || b.queuedAt || ''))
            );
            const firstBase = Number(ordered[0].baseStock);
            if (!Number.isFinite(firstBase)) continue;

            let expected = Math.max(0, firstBase);
            let matchedPrefix = -1;
            for (let index = 0; index < ordered.length; index++) {
                const command = inventoryCommands.get(ordered[index].commandId);
                if (command && ['applied', 'applied_with_warnings'].includes(command.status)) {
                    matchedPrefix = index;
                    break;
                }
                expected = applyProjectedStock(expected, [ordered[index]]);
                if (Number(product.stock) === Number(expected)) matchedPrefix = index;
            }
            if (matchedPrefix >= 0) {
                ordered.slice(0, matchedPrefix + 1).forEach(change => confirmedKeys.add(getChangeKey(change)));
            }
        }

        const resolvedKeys = new Set([...confirmedKeys, ...rejectedKeys]);
        if (resolvedKeys.size > 0) {
            const confirmedChanges = inFlightChanges.filter(change => confirmedKeys.has(getChangeKey(change)));
            const confirmedProdIds = confirmedChanges.map(c => String(c.productId || c.data?.id)).filter(Boolean);

            if (confirmedChanges.length > 0 && typeof setProducts === 'function') {
                setProducts(prevProducts => {
                    let updated = Array.isArray(prevProducts) ? [...prevProducts] : [];
                    for (const change of confirmedChanges) {
                        const pId = String(change.productId || change.data?.id);
                        const existingIdx = updated.findIndex(p => String(p.id) === pId);

                        if (change.action === 'adjust_stock' && existingIdx >= 0) {
                            const newStock = applyProjectedStock(updated[existingIdx].stock, [change]);
                            updated[existingIdx] = { ...updated[existingIdx], stock: newStock };
                        } else if (change.action === 'edit' && existingIdx >= 0) {
                            updated[existingIdx] = { ...updated[existingIdx], ...(change.data || {}) };
                        } else if (change.action === 'add') {
                            if (existingIdx < 0 && change.data) {
                                updated.unshift({ ...change.data, id: change.productId || change.data.id });
                            }
                        } else if (change.action === 'delete' && existingIdx >= 0) {
                            updated.splice(existingIdx, 1);
                        }
                    }
                    try {
                        import('../utils/storageService').then(({ storageService }) => {
                            storageService.setItem('bodega_products_v1', updated).catch(() => {});
                        });
                    } catch {}
                    return updated;
                });
            }

            if (confirmedProdIds.length > 0) {
                setRecentlyConfirmedIds(prev => {
                    const next = new Set(prev);
                    confirmedProdIds.forEach(id => next.add(id));
                    return next;
                });
                setTimeout(() => {
                    setRecentlyConfirmedIds(prev => {
                        const next = new Set(prev);
                        confirmedProdIds.forEach(id => next.delete(id));
                        return next;
                    });
                }, 3000);
            }

            persistInFlight(inFlightChanges.filter(change => !resolvedKeys.has(getChangeKey(change))));
        }
    }, [products, setProducts, inFlightChanges, allCloudCmds, getChangeKey, isInventoryChangeConfirmed, persistInFlight]);

    // Consulta en tiempo real del historial completo de comandos (pendientes, aplicados y anulados)
    const fetchAllCloudCmds = useCallback(async () => {
        if (!supabaseCloud || !pairedDeviceId) return;
        try {
            const { data } = await supabaseCloud
                .from('supervisor_commands')
                .select('*')
                .eq('primary_device_id', pairedDeviceId)
                .order('created_at', { ascending: false })
                .limit(150);

            const all = data || [];
            setAllCloudCmds(all);
            setCloudPendingCmds(all.filter(c => c.status === 'pending'));
        } catch (err) {
            console.warn('[OwnerMonitor] Error al consultar historial de comandos:', err);
        }
    }, [pairedDeviceId]);

    useEffect(() => {
        fetchAllCloudCmds();
        if (!supabaseCloud || !pairedDeviceId) return;

        const myDeviceId = localStorage.getItem('dj_device_id');

        const channel = supabaseCloud
            .channel(`supervisor_cmds:${pairedDeviceId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'supervisor_commands',
                filter: `primary_device_id=eq.${pairedDeviceId}`
            }, (payload) => {
                fetchAllCloudCmds();

                // Notificar en tiempo real únicamente cuando OTRO supervisor inserte un comando nuevo (FP6)
                /** @type {any} */
                const newCmd = payload.new;
                if (payload.eventType === 'INSERT' && newCmd && newCmd.monitor_device_id !== myDeviceId) {
                    let actionText = 'realizó un cambio remoto';
                    if (newCmd.command_type === 'void_sale') actionText = 'anuló una venta';
                    else if (newCmd.command_type === 'rate_change') actionText = 'actualizó la tasa de cambio';
                    else if (newCmd.command_type === 'inventory_update') actionText = 'actualizó el inventario';
                    else if (newCmd.command_type === 'user_update') actionText = 'modificó la lista de usuarios';

                    showToast(`Otro supervisor ${actionText}`, 'info');
                }

                // Notificar confirmación / error de aplicación en la caja principal para comandos emitidos por este monitor
                if (payload.eventType === 'UPDATE' && newCmd && newCmd.monitor_device_id === myDeviceId) {
                    /** @type {any} */
                    const oldCmd = payload.old;
                    if (oldCmd?.status === COMMAND_STATUS.PENDING && (newCmd.status === COMMAND_STATUS.APPLIED || newCmd.status === COMMAND_STATUS.APPLIED_WITH_WARNINGS)) {
                        const count = newCmd.payload?.data?.items?.length || 1;
                        if (newCmd.status === COMMAND_STATUS.APPLIED_WITH_WARNINGS) {
                            showToast(`⚠️ Caja aplicó cambios con advertencias: ${newCmd.error_reason || ''}`, 'info');
                        } else {
                            showToast(`✅ Caja principal confirmó actualización de ${count} precio(s)`, 'success');
                        }
                    } else if (oldCmd?.status === COMMAND_STATUS.PENDING && newCmd.status === COMMAND_STATUS.FAILED) {
                        showToast(`❌ La caja rechazó los cambios: ${newCmd.error_reason || 'Error desconocido'}`, 'error');
                    }
                }
            })
            .subscribe();

        return () => {
            supabaseCloud.removeChannel(channel).catch(() => {});
        };
    }, [pairedDeviceId, fetchAllCloudCmds]);

    const refreshPendingCloudCmds = useCallback(async () => {
        if (!supabaseCloud || !pairedDeviceId) return;

        const state = commandStateRefs.current;
        const trackedIds = new Set([
            ...(state.allCloudCmds || [])
                .filter(command => command?.status === 'pending')
                .map(command => command.id),
            ...(state.pendingChanges || []).map(change => change.commandId),
            ...(state.inFlightChanges || []).map(change => change.commandId),
            ...Object.values(state.pendingVoidCommands || {}),
        ].filter(Boolean));

        try {
            const pendingRate = localStorage.getItem(SUPERVISOR_RATE_PENDING_KEY);
            if (pendingRate) {
                const parsed = JSON.parse(pendingRate);
                if (parsed?.commandId) trackedIds.add(parsed.commandId);
            }
        } catch { /* una cola de tasa corrupta no debe romper el polling */ }

        if (trackedIds.size === 0) return;

        try {
            const { data, error } = await supabaseCloud
                .from('supervisor_commands')
                .select('id,status,error_reason,applied_at,payload,command_type,monitor_device_id,created_at,primary_device_id')
                .eq('primary_device_id', pairedDeviceId)
                .in('id', [...trackedIds]);

            if (error) {
                console.warn('[OwnerMonitor] No se pudieron actualizar estados de comandos:', error.message);
                return;
            }

            const remoteRows = Array.isArray(data) ? data : [];
            const mergeRows = current => {
                const byId = new Map(remoteRows.map(row => [row.id, row]));
                const merged = (current || []).map(command => (
                    byId.has(command.id) ? { ...command, ...byId.get(command.id) } : command
                ));
                const known = new Set(merged.map(command => command.id));
                remoteRows.forEach(row => {
                    if (!known.has(row.id)) merged.push(row);
                });
                return merged.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
            };

            setAllCloudCmds(previous => mergeRows(previous));
            setCloudPendingCmds(previous => mergeRows(previous).filter(command => command.status === 'pending'));
        } catch (error) {
            console.warn('[OwnerMonitor] Excepción actualizando estados de comandos:', error);
        }
    }, [pairedDeviceId]);

    // Realtime sigue siendo el camino rápido. Este respaldo barato consulta solo
    // comandos conocidos cada 15 s y al volver a la pestaña/red, evitando que un
    // UPDATE perdido obligue a pulsar «Subir» por segunda vez.
    useEffect(() => {
        if (!supabaseCloud || !pairedDeviceId) return;

        refreshPendingCloudCmds();
        const intervalId = setInterval(refreshPendingCloudCmds, 15000);
        const handleOnline = () => refreshPendingCloudCmds();
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') refreshPendingCloudCmds();
        };
        window.addEventListener('online', handleOnline);
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            clearInterval(intervalId);
            window.removeEventListener('online', handleOnline);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [pairedDeviceId, refreshPendingCloudCmds]);

    // Cerrar una orden remota es una transacción de UI: mientras está pendiente
    // se pinta de forma optimista; si la caja la rechaza/cancela se quita la
    // proyección y se vuelve al catálogo/venta sincronizada anterior.
    useEffect(() => {
        if (!Array.isArray(allCloudCmds) || allCloudCmds.length === 0) return;
        const ownMonitorId = localStorage.getItem('dj_device_id');
        const terminalStatuses = new Set(['applied', 'applied_with_warnings', 'failed', 'cancelled']);

        const ratePendingRaw = localStorage.getItem(SUPERVISOR_RATE_PENDING_KEY);
        if (ratePendingRaw) {
            try {
                const ratePending = JSON.parse(ratePendingRaw);
                const rateCommand = allCloudCmds.find(command => command.id === ratePending.commandId);
                if (rateCommand && terminalStatuses.has(rateCommand.status)) {
                    if (rateCommand.status === 'failed' || rateCommand.status === 'cancelled') {
                        restoreLocalRateState(ratePending.previous);
                        showToast('La caja rechazó la tasa. Se restauró el valor anterior.', 'error');
                    } else {
                        // No borrar todavía el recibo: useMonitorSync lo conserva
                        // como barrera hasta observar en la nube las tres claves
                        // de la tasa. Si se elimina aquí, un pull viejo puede
                        // devolver visualmente la tasa anterior y provocar el
                        // segundo clic que este flujo debe evitar.
                        showToast('La caja confirmó la nueva tasa. Esperando eco de configuración.', 'success');
                    }
                }
            } catch {
                localStorage.removeItem(SUPERVISOR_RATE_PENDING_KEY);
            }
        }



        const terminalVoidCommands = allCloudCmds.filter(command =>
            command.monitor_device_id === ownMonitorId
            && command.command_type === 'void_sale'
            && terminalStatuses.has(command.status)
        );
        for (const command of terminalVoidCommands) {
            const saleId = command.payload?.saleId;
            if (!saleId || !pendingVoidSaleIds.has(saleId)) continue;
            setPendingVoidSaleIds(previous => {
                const next = new Set(previous);
                next.delete(saleId);
                return next;
            });
            setPendingVoidCommands(previous => {
                const next = { ...previous };
                delete next[saleId];
                return next;
            });
            if (command.status === 'failed' || command.status === 'cancelled') {
                showToast(`La caja no anuló la venta: ${command.error_reason || 'operación rechazada'}.`, 'error');
            } else {
                setSales(previous => previous.map(sale => sale.id === saleId ? { ...sale, status: 'ANULADA' } : sale));
                setSelectedSaleDetail(previous => previous?.id === saleId
                    ? { ...previous, status: 'ANULADA' }
                    : previous);
                showToast('La caja confirmó la anulación de la venta.', 'success');
            }
        }
    }, [allCloudCmds, inFlightChanges, pendingVoidSaleIds, pendingVoidCommands, persistInFlight, getChangeKey]);

    const wipeMonitorSession = async () => {
        localStorage.removeItem('dj_pairing_code');
        localStorage.removeItem('dj_pairing_mode');
        localStorage.removeItem('dj_paired_device_id');
        localStorage.removeItem('monitor_last_sync');
        localStorage.removeItem('business_name');
        localStorage.removeItem('business_rif');
        localStorage.removeItem(PENDING_KEY);

        try {
            const { default: localforage } = await import('localforage');
            localforage.config({ name: 'BodegaApp', storeName: 'bodega_app_data' });
            await localforage.clear();
        } catch (e) {
            console.warn('[OwnerMonitorView] Error limpiando IndexedDB:', e);
        }
    };

    // Detección de revocación remota emitida por el heartbeat (F4, B4, FX4)
    useEffect(() => {
        const handleRevoked = async () => {
            showToast('El acceso de este dispositivo ha sido revocado', 'error');
            await wipeMonitorSession();
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        };

        window.addEventListener('monitor_revoked', handleRevoked);
        return () => window.removeEventListener('monitor_revoked', handleRevoked);
    }, []);

    const persistPending = useCallback((next) => {
        const normalized = normalizeSupervisorChanges(next);
        setPendingChanges(normalized);
        try { localStorage.setItem(PENDING_KEY, JSON.stringify(normalized)); } catch { /* storage lleno */ }
    }, []);

    // Fusión de cambios en cola con setPendingChanges(prev => ...) para evitar
    // closure stale cuando el usuario pulsa +/- rápidamente antes del re-render.
    // Cada cambio conserva un UUID desde el primer intento; así un timeout del
    // monitor no puede convertir el mismo clic en dos comandos distintos.
    const queueInventoryChange = useCallback((action, productId, data) => {
        setPendingChanges(prev => {
            const next = normalizeSupervisorChanges([...prev]);
            const now = new Date().toISOString();
            const idxOf = (act) => next.findIndex(c => c.productId === productId && c.action === act);
            const makeChange = (existing = null, nextData = data) => ({
                ...(existing || {}),
                action,
                productId,
                data: nextData,
                commandId: existing?.commandId || createSupervisorCommandId(),
                queuedAt: existing?.queuedAt || now,
            });

            if (action === 'adjust_stock') {
                const hasTarget = data?.targetStock !== undefined && data?.targetStock !== null && data?.targetStock !== '';
                const adjustIndexes = next
                    .map((change, index) => ({ change, index }))
                    .filter(({ change }) => change.productId === productId && change.action === 'adjust_stock');
                const lastAdjust = adjustIndexes[adjustIndexes.length - 1]?.change;

                if (hasTarget) {
                    // Un objetivo absoluto reemplaza únicamente lo que todavía
                    // está en la cola local. Los comandos ya enviados tienen su
                    // propio UUID y terminarán antes de este objetivo.
                    for (let i = adjustIndexes.length - 1; i >= 0; i--) next.splice(adjustIndexes[i].index, 1);
                    next.push(makeChange(lastAdjust, { targetStock: Number(data.targetStock) }));
                } else {
                    const pendingTargetIndex = adjustIndexes.find(({ change }) =>
                        change.data?.targetStock !== undefined && change.data?.targetStock !== null && change.data?.targetStock !== ''
                    )?.index;
                    if (pendingTargetIndex !== undefined) {
                        next.push(makeChange(null, { delta: Number(data?.delta) || 0 }));
                    } else {
                        const pendingDeltaIndexes = adjustIndexes.filter(({ change }) =>
                            change.data?.targetStock === undefined || change.data?.targetStock === null || change.data?.targetStock === ''
                        );
                        const firstDelta = pendingDeltaIndexes[0];
                        if (firstDelta) {
                            const newDelta = (Number(firstDelta.change.data?.delta) || 0) + (Number(data?.delta) || 0);
                            if (newDelta === 0) next.splice(firstDelta.index, 1);
                            else next[firstDelta.index] = {
                                ...firstDelta.change,
                                data: { delta: newDelta },
                                queuedAt: firstDelta.change.queuedAt || now,
                            };
                        } else {
                            next.push(makeChange(null, { delta: Number(data?.delta) || 0 }));
                        }
                    }
                }
            } else if (action === 'edit') {
                // F5: enviar la versión base (baseUpdatedAt) únicamente en edits para versionado optimista.
                const targetProd = (products || []).find(p => p.id === productId);
                const editData = (targetProd?.updatedAt && !data?.baseUpdatedAt)
                    ? { ...data, baseUpdatedAt: targetProd.updatedAt }
                    : data;
                const addIdx = idxOf('add');
                if (addIdx >= 0) {
                    next[addIdx] = {
                        ...next[addIdx],
                        data: { ...editData, id: productId },
                        commandId: next[addIdx].commandId || createSupervisorCommandId(),
                        queuedAt: next[addIdx].queuedAt || now,
                    };
                } else {
                    const i = idxOf('edit');
                    next[i >= 0 ? i : next.length] = makeChange(i >= 0 ? next[i] : null, editData);
                }
            } else if (action === 'delete') {
                const existing = next.find(c => c.productId === productId);
                const hadAdd = idxOf('add') >= 0;
                for (let i = next.length - 1; i >= 0; i--) {
                    if (next[i].productId === productId) next.splice(i, 1);
                }
                if (!hadAdd) next.push(makeChange(existing, null));
            } else {
                next.push(makeChange());
            }

            const normalized = normalizeSupervisorChanges(next);
            try { localStorage.setItem(PENDING_KEY, JSON.stringify(normalized)); } catch { /* storage lleno */ }
            return normalized;
        });

        return true;
    }, [products]);

    // Delta de stock pendiente por producto (para proyectar en la fila)
    const pendingStockDelta = (productId) => {
        const baseStock = (products || []).find(p => String(p.id) === String(productId))?.stock || 0;
        const changes = [...inFlightChanges, ...pendingChanges]
            .filter(c => String(c.productId) === String(productId) && c.action === 'adjust_stock');
        return applyProjectedStock(baseStock, changes) - (Number(baseStock) || 0);
    };

    const hasPendingFor = (productId) => [...inFlightChanges, ...pendingChanges].some(c => c.productId === productId);
    const hasInventoryChanges = pendingChanges.length > 0 || inFlightChanges.length > 0;

    const handleDownloadRemoteBackup = async () => {
        if (downloadingBackup) return;
        if (!pairedDeviceId) {
            showToast('No hay una caja emparejada para respaldar.', 'error');
            return;
        }

        setDownloadingBackup(true);
        triggerHaptic?.();
        try {
            if (!supabaseCloud) throw new Error('La conexión Cloud no está configurada.');

            const monitorDeviceId = localStorage.getItem('dj_device_id');
            if (!monitorDeviceId) throw new Error('El Supervisor no tiene una identidad válida.');

            // No se arma el backup con la copia del Supervisor: se solicita a la
            // caja que lea su IndexedDB bajo lock y publique un snapshot completo.
            const requestId = crypto.randomUUID();
            const { error: requestError } = await supabaseCloud
                .from('supervisor_commands')
                .insert({
                    id: requestId,
                    primary_device_id: pairedDeviceId,
                    monitor_device_id: monitorDeviceId,
                    command_type: 'request_full_backup',
                    payload: {
                        requestedAt: new Date().toISOString(),
                        purpose: 'inventory_kardex_reconciliation',
                    },
                    status: 'pending',
                });

            if (requestError) throw requestError;

            let backup = null;
            for (let attempt = 0; attempt < 30; attempt += 1) {
                if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 1000));

                // Consultar primero el estado pequeño del comando evita descargar
                // repetidamente un backup anterior de varios megabytes mientras la
                // caja todavía está capturando su IndexedDB.
                const { data: requestRow, error: statusError } = await supabaseCloud
                    .from('supervisor_commands')
                    .select('status, error_reason')
                    .eq('id', requestId)
                    .maybeSingle();
                if (statusError) throw statusError;

                if (requestRow?.status === 'failed') {
                    throw new Error(requestRow.error_reason || 'La caja no pudo generar el backup completo.');
                }

                if (requestRow?.status === 'applied' || requestRow?.status === 'applied_with_warnings') {
                    const result = await fetchRemoteFullBackup(pairedDeviceId);
                    if (!result.success) {
                        throw new Error(result.error?.message || 'No se pudo leer el backup completo de la caja.');
                    }

                    // El requestId evita descargar un backup anterior que estuviera
                    // guardado en cloud_backups antes de esta solicitud.
                    if (result.backup?.metadata?.requestId === requestId) {
                        backup = result.backup;
                        break;
                    }
                    throw new Error('La caja confirmó la captura, pero el snapshot remoto no coincide con la solicitud.');
                }
            }

            if (!backup) {
                throw new Error('La caja no respondió con un backup completo. Verifica que esté en línea y tenga la versión actualizada.');
            }

            const isPartial = backup.metadata?.isReconciliationReady !== true
                || (backup.metadata?.missingCriticalDocIds || []).length > 0;
            const suffix = isPartial ? 'parcial' : 'completo';
            const safeDeviceId = pairedDeviceId.replace(/[^a-zA-Z0-9_-]/g, '_');
            const date = new Date().toISOString().slice(0, 10);
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `backup_${safeDeviceId}_${suffix}_${date}.json`;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            URL.revokeObjectURL(url);

            if (isPartial) {
                showToast(
                    `Backup generado, pero faltan datos para conciliación: ${(backup.metadata?.missingCriticalDocIds || backup.metadata?.missingDocIds || []).join(', ')}`,
                    'warning',
                );
            } else {
                showToast('Backup completo de la caja descargado.', 'success');
            }
        } catch (error) {
            console.error('[OwnerMonitor] Error descargando backup completo remoto:', error);
            showToast(error.message || 'No se pudo descargar el backup completo.', 'error');
        } finally {
            setDownloadingBackup(false);
        }
    };

    // «Subir al sistema»: vacía la cola enviando los comandos individuales ya
    // fusionados. Reutiliza toda la infraestructura existente (dedup, catch-up,
    // validación y estado por comando en la caja). Los que fallen al insertar
    // permanecen en la cola.
    const uploadPendingChanges = async (overrideList = null) => {
        if (!supabaseCloud || !pairedDeviceId) {
            showToast('Sin conexión con la caja', 'error');
            return;
        }
        if (uploadingRef.current) return;
        const listToProcess = normalizeSupervisorChanges(overrideList || pendingChanges);
        if (!listToProcess || listToProcess.length === 0) return;

        uploadingRef.current = true;
        setUploading(true);
        const monitorDeviceId = localStorage.getItem('dj_device_id') || 'monitor_web';
        const actor = {
            supervisorId: supervisorUser?.id || null,
            supervisorNombre: supervisorUser?.nombre || supervisorUser?.usuario || 'Supervisor',
            supervisorRol: supervisorUser?.rol || 'SUPERVISOR',
        };

        try {
            const rowsToInsert = listToProcess.map(change => {
                const commandId = change.commandId || createSupervisorCommandId();
                const commandType = change.action === 'user_update' ? 'user_update' : 'inventory_update';
                const payload = change.action === 'user_update'
                    ? { ...(change.data || {}), commandId, ...actor }
                    : {
                        action: change.action,
                        productId: change.productId,
                        data: change.data,
                        commandId,
                        issuedAt: change.queuedAt || new Date().toISOString(),
                        ...actor,
                    };

                return {
                    id: commandId,
                    primary_device_id: pairedDeviceId,
                    monitor_device_id: monitorDeviceId,
                    command_type: commandType,
                    payload,
                    status: 'pending'
                };
            });

            // Inserción fila a fila: un cambio inválido no bloquea los demás.
            // Si la respuesta se perdió después de que Postgres insertó la fila,
            // el UUID estable se resuelve como "ya aceptado" en vez de crear otro.
            const okRows = [];
            const failedRows = [];
            const okChanges = [];

            for (let i = 0; i < rowsToInsert.length; i++) {
                const row = rowsToInsert[i];
                const change = listToProcess[i];
                let { error: rowError } = await supabaseCloud
                    .from('supervisor_commands')
                    .insert(row);

                if (rowError?.code === '23505') {
                    const { data: existingCommand, error: lookupError } = await supabaseCloud
                        .from('supervisor_commands')
                        .select('id,status,primary_device_id,monitor_device_id')
                        .eq('id', row.id)
                        .maybeSingle();
                    const isSamePair = existingCommand
                        && existingCommand.primary_device_id === pairedDeviceId
                        && existingCommand.monitor_device_id === monitorDeviceId;
                    if (!lookupError && isSamePair
                        && ['pending', 'applied', 'applied_with_warnings'].includes(existingCommand.status)) {
                        rowError = null;
                    }
                }

                if (rowError) {
                    failedRows.push({ row, change, message: rowError.message, code: rowError.code });
                    console.warn(
                        `[OwnerMonitor] Comando '${row.command_type}' rechazado ` +
                        `(${rowError.code || 's/c'}): ${rowError.message}`
                    );
                } else {
                    okRows.push(row);
                    okChanges.push({ ...change, commandId: row.id });
                }
            }

            if (failedRows.length > 0) {
                const detalle = failedRows
                    .map(f => `${f.row.command_type}${f.code ? ` (${f.code})` : ''}`)
                    .join(', ');
                showToast(
                    `${okRows.length} de ${rowsToInsert.length} cambios enviados. Fallaron: ${detalle}`,
                    okRows.length > 0 ? 'warning' : 'error'
                );
            }

            if (!overrideList) {
                const sentKeys = new Set(okChanges.map(getChangeKey));
                const remainingPending = pendingChanges.filter(c => !sentKeys.has(getChangeKey(c)));
                persistPending(remainingPending);
                if (okChanges.length > 0) {
                    const sentAt = new Date().toISOString();
                    const nextInFlight = [
                        ...inFlightChanges.filter(existing => !sentKeys.has(getChangeKey(existing))),
                        ...okChanges.map(change => ({
                            ...change,
                            ...(change.action === 'adjust_stock'
                                ? { baseStock: products.find(p => String(p.id) === String(change.productId))?.stock }
                                : {}),
                            sentAt,
                            syncState: 'sent',
                        })),
                    ];
                    persistInFlight(nextInFlight);
                }
                if (failedRows.length === 0) {
                    showToast(`${okRows.length} cambio${okRows.length !== 1 ? 's' : ''} enviado${okRows.length !== 1 ? 's' : ''}; esperando confirmación de la caja`, 'success');
                }
            } else if (failedRows.length === 0) {
                showToast(`${okRows.length} cambio${okRows.length !== 1 ? 's' : ''} enviado${okRows.length !== 1 ? 's' : ''} con éxito a la caja principal`, 'success');
            }
        } catch (err) {
            console.error('[OwnerMonitor] Excepción al subir lote:', err);
            showToast('Error de conexión al enviar cambios. La cola local se conserva.', 'error');
        } finally {
            uploadingRef.current = false;
            setUploading(false);
        }
    };
    uploadPendingChangesRef.current = uploadPendingChanges;

    const discardPendingChanges = () => {
        persistPending([]);
        persistInFlight([]);
        showToast('Cola de cambios descartada', 'info');
    };

    const discardSinglePendingChange = (targetIndex) => {
        const next = pendingChanges.filter((_, idx) => idx !== targetIndex);
        persistPending(next);
        showToast('Cambio descartado de la cola', 'info');
    };

    const cancelSingleCloudCmd = async (cmdId) => {
        setCancellingCmdId(cmdId);
        try {
            const { error } = await supabaseCloud
                .from('supervisor_commands')
                .update({ status: 'cancelled' })
                .eq('id', cmdId);

            if (error) throw error;
            setCloudPendingCmds(prev => prev.filter(c => c.id !== cmdId));
            showToast('Comando anulado en la nube', 'success');
        } catch (err) {
            console.error('[OwnerMonitor] Error al anular comando:', err);
            showToast('No se pudo anular el comando', 'error');
        } finally {
            setCancellingCmdId(null);
        }
    };

    const cancelAllCloudCmds = async () => {
        if (cloudPendingCmds.length === 0) return;
        try {
            const ids = cloudPendingCmds.map(c => c.id);
            const { error } = await supabaseCloud
                .from('supervisor_commands')
                .update({ status: 'cancelled' })
                .in('id', ids);

            if (error) throw error;
            setCloudPendingCmds([]);
            setShowCloudPendingModal(false);
            showToast('Todos los comandos pendientes fueron anulados', 'success');
        } catch (err) {
            console.error('[OwnerMonitor] Error al anular comandos:', err);
            showToast('Error al anular los comandos', 'error');
        }
    };

    return {
        allCloudCmds,
        setAllCloudCmds,
        cloudPendingCmds,
        setCloudPendingCmds,
        cmdTabFilter,
        setCmdTabFilter,
        currentPageCambios,
        setCurrentPageCambios,
        ITEMS_PER_PAGE_CAMBIOS,
        showCloudPendingModal,
        setShowCloudPendingModal,
        showDiscardQueueModal,
        setShowDiscardQueueModal,
        cancellingCmdId,
        downloadingBackup,
        pendingChanges,
        setPendingChanges,
        inFlightChanges,
        uploading,
        recentlyConfirmedIds,
        pendingVoidSaleIds,
        setPendingVoidSaleIds,
        pendingVoidCommands,
        setPendingVoidCommands,
        persistPending,
        queueInventoryChange,
        pendingStockDelta,
        hasPendingFor,
        hasInventoryChanges,
        uploadPendingChanges,
        discardPendingChanges,
        discardSinglePendingChange,
        cancelSingleCloudCmd,
        cancelAllCloudCmds,
        handleDownloadRemoteBackup,
        totalControlChanges,
        wipeMonitorSession,
        fetchAllCloudCmds,
    };
}
