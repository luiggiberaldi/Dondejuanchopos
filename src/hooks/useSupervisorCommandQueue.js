/**
 * src/hooks/useSupervisorCommandQueue.js
 *
 * Cola durable supervisor → caja: pendientes locales, envíos inciertos y
 * confirmaciones sin caducidad ciega. Conserva UUID y contenido desde el primer
 * intento, y separa el acuse de la caja del catálogo realmente sincronizado.
 * Incluye consulta de estados, cancelación y descarga de respaldo remoto.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { showToast } from '../components/Toast';
import { COMMAND_STATUS } from '../constants/commandStatus';
import { fetchRemoteFullBackup } from '../services/remoteAuditService';
import { applyProjectedStock, hasSupervisorReceipt, shouldProjectSupervisorChange } from '../utils/supervisorStockProjection';
import { useDurableSupervisorQueue, LEGACY_PENDING_KEY, LEGACY_INFLIGHT_KEY } from './useDurableSupervisorQueue';
import {
    createSupervisorCommandId,
    getSupervisorChangeResolution,
    normalizeSupervisorChanges,
    sameSupervisorRequest,
    restoreLocalRateState,
    SUPERVISOR_RATE_PENDING_KEY,
} from '../utils/supervisorCommandModel';

const PENDING_KEY = LEGACY_PENDING_KEY;

export function useSupervisorCommandQueue({
    pairedDeviceId,
    products,
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
    const durableQueue = useDurableSupervisorQueue(pairedDeviceId);
    const { ref: queueRef, update: updateQueue } = durableQueue;
    const { pending: pendingChanges, inFlight: inFlightChanges } = durableQueue.state;
    const resolvedIdsRef = useRef(new Set());
    const recoveryRequestedRef = useRef(new Set());
    const timersRef = useRef(new Set());
    const [uploading, setUploading] = useState(false);
    const uploadingRef = useRef(false);
    const [recentlyConfirmedIds, setRecentlyConfirmedIds] = useState(() => new Set());
    const [pendingVoidSaleIds, setPendingVoidSaleIds] = useState(() => new Set());
    const [pendingVoidCommands, setPendingVoidCommands] = useState({});
    const notifiedCommandIdsRef = useRef(new Set());
    useEffect(() => {
        if (durableQueue.error && !notifiedCommandIdsRef.current.has('queue-storage-error')) {
            notifiedCommandIdsRef.current.add('queue-storage-error');
            showToast('No se pudo recuperar la cola guardada. Se conservaron los datos; no se enviarán cambios hasta resolver el almacenamiento.', 'error');
        }
    }, [durableQueue.error]);
    const requestRecovery = useCallback((id) => {
        if (recoveryRequestedRef.current.has(id)) return;
        recoveryRequestedRef.current.add(id);
        window.dispatchEvent(new CustomEvent('supervisor_sync_requested'));
    }, []);
    useEffect(() => () => {
        timersRef.current.forEach(clearTimeout);
        timersRef.current.clear();
    }, []);

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

    const isInventoryChangeConfirmed = useCallback((change, catalog, acknowledged = false, command = null) => {
        if (!change || !Array.isArray(catalog)) return false;
        const product = catalog.find(p => String(p.id) === String(change.productId));
        if (hasSupervisorReceipt(product, change)) return true;
        if (!acknowledged) return false;
        // Tras más de 25 movimientos el recibo puede salir del anillo. Un ACK
        // sin advertencias + una traza física POSTERIOR (ambas fechadas por la
        // misma caja) permite adoptar el catálogo nuevo sin recrear el delta.
        // Sin estas evidencias se mantiene la espera; la igualdad de stock no basta.
        if (change.action === 'adjust_stock') {
            return command?.status === 'applied' && Array.isArray(product?.stockOperationIds)
                && product.stockOperationIds.length >= 25
                && Number.isFinite(Date.parse(command.applied_at))
                && Date.parse(product.stockUpdatedAt) > Date.parse(command.applied_at);
        }
        if (change.action === 'delete') return !product;
        if (change.action === 'add') return Boolean(product);
        if (change.action !== 'edit' || !product) return false;
        return Object.entries(change.data || {})
            .filter(([key]) => !['baseUpdatedAt', 'updatedAt', 'createdAt', 'stock'].includes(key) && !key.startsWith('_'))
            .every(([key, expected]) => key === 'name'
                ? String(product[key] || '').trim() === String(expected || '').trim()
                : JSON.stringify(product[key] ?? null) === JSON.stringify(expected ?? null));
    }, []);

    useEffect(() => {
        const ownMonitorId = localStorage.getItem('dj_device_id');
        const ownCommands = allCloudCmds.filter(command => command.monitor_device_id === ownMonitorId
            && command.primary_device_id === pairedDeviceId);
        const current = queueRef.current;
        const changes = [...current.inFlight, ...current.pending.filter(c => c.attemptedAt)];
        const resolved = new Set();
        const awaiting = new Set();
        const confirmedProdIds = [];
        for (const change of changes) {
            const resolution = getSupervisorChangeResolution(change, ownCommands);
            if (resolution.status === 'rejected') {
                resolved.add(change.commandId);
                if (!notifiedCommandIdsRef.current.has(change.commandId)) {
                    notifiedCommandIdsRef.current.add(change.commandId);
                    showToast(`La caja rechazó el cambio: ${resolution.command.error_reason || resolution.command.status}.`, 'error');
                }
            } else if (isInventoryChangeConfirmed(change, products, resolution.status === 'applied', resolution.command)
                || (resolution.status === 'applied' && !['add', 'edit', 'delete', 'adjust_stock'].includes(change.action))) {
                if (resolution.status === 'applied') requestRecovery(change.commandId);
                resolved.add(change.commandId);
                if (change.productId) confirmedProdIds.push(String(change.productId));
            } else if (resolution.status === 'applied') {
                if (change.syncState !== 'awaiting_catalog') awaiting.add(change.commandId);
                requestRecovery(change.commandId);
            }
        }
        if (!resolved.size && !awaiting.size) return;
        try {
            updateQueue(state => {
                const waiting = state.pending.filter(c => awaiting.has(c.commandId));
                return {
                    pending: state.pending.filter(c => !resolved.has(c.commandId) && !awaiting.has(c.commandId)),
                    inFlight: [...state.inFlight, ...waiting].filter(c => !resolved.has(c.commandId))
                        .map(c => awaiting.has(c.commandId) ? { ...c, syncState: 'awaiting_catalog' } : c),
                };
            });
            resolved.forEach(id => resolvedIdsRef.current.add(id));
        } catch (error) {
            console.warn('[OwnerMonitor] No se pudo persistir la confirmación; se reintentará:', error);
            return;
        }
        // La confirmación solo retira la proyección. Nunca escribe productos:
        // ese catálogo pertenece exclusivamente al eco canónico de la caja.
        if (confirmedProdIds.length) {
            setRecentlyConfirmedIds(prev => new Set([...prev, ...confirmedProdIds]));
            const timer = setTimeout(() => {
                timersRef.current.delete(timer);
                setRecentlyConfirmedIds(prev => new Set([...prev].filter(id => !confirmedProdIds.includes(id))));
            }, 3000);
            timersRef.current.add(timer);
        }
    }, [products, pendingChanges, inFlightChanges, allCloudCmds, pairedDeviceId,
        queueRef, updateQueue, isInventoryChangeConfirmed, requestRecovery]);

    // Consulta en tiempo real del historial completo de comandos (pendientes, aplicados y anulados)
    const fetchAllCloudCmds = useCallback(async () => {
        if (!supabaseCloud || !pairedDeviceId) return;
        try {
            const { data, error } = await supabaseCloud
                .from('supervisor_commands')
                .select('*')
                .eq('primary_device_id', pairedDeviceId)
                .order('created_at', { ascending: false })
                .limit(150);

            if (error) throw error;
            const all = Array.isArray(data) ? data : [];
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
                const rateCommand = allCloudCmds.find(command => command.id === ratePending.commandId
                    && command.monitor_device_id === ownMonitorId && command.primary_device_id === pairedDeviceId
                    && command.command_type === 'rate_change');
                if (rateCommand && terminalStatuses.has(rateCommand.status)
                    && localStorage.getItem(SUPERVISOR_RATE_PENDING_KEY) === ratePendingRaw) {
                    const noticeId = `rate:${rateCommand.id}:${rateCommand.status}`;
                    if (rateCommand.status === 'failed' || rateCommand.status === 'cancelled') {
                        // Retirar solo la solicitud actual ANTES de notificar storage.
                        // Los listeners pueden crear una nueva solicitud al restaurar.
                        localStorage.removeItem(SUPERVISOR_RATE_PENDING_KEY);
                        restoreLocalRateState(ratePending.previous);
                        requestRecovery(noticeId);
                        if (!notifiedCommandIdsRef.current.has(noticeId)) {
                            notifiedCommandIdsRef.current.add(noticeId);
                            showToast('La caja rechazó la tasa. Se restauró el valor anterior.', 'error');
                        }
                    } else if (!notifiedCommandIdsRef.current.has(noticeId)) {
                        notifiedCommandIdsRef.current.add(noticeId);
                        // El éxito conserva la barrera hasta observar las tres claves.
                        requestRecovery(noticeId);
                        showToast('La caja confirmó la nueva tasa. Esperando eco de configuración.', 'success');
                    }
                }
            } catch (error) {
                console.warn('[OwnerMonitor] No se pudo resolver la tasa pendiente:', error);
                // No borrar una solicitud nueva que un listener haya creado.
                if (localStorage.getItem(SUPERVISOR_RATE_PENDING_KEY) === ratePendingRaw) {
                    try { JSON.parse(ratePendingRaw); } catch { localStorage.removeItem(SUPERVISOR_RATE_PENDING_KEY); }
                }
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
    }, [allCloudCmds, inFlightChanges, pendingVoidSaleIds, pendingVoidCommands,
        pairedDeviceId, requestRecovery, setSales, setSelectedSaleDetail]);

    const wipeMonitorSession = async () => {
        localStorage.removeItem('dj_pairing_code');
        localStorage.removeItem('dj_pairing_mode');
        localStorage.removeItem('dj_paired_device_id');
        localStorage.removeItem('monitor_last_sync');
        localStorage.removeItem('business_name');
        localStorage.removeItem('business_rif');
        localStorage.removeItem(PENDING_KEY);
        localStorage.removeItem(LEGACY_INFLIGHT_KEY);
        localStorage.removeItem(durableQueue.key);
        localStorage.removeItem(SUPERVISOR_RATE_PENDING_KEY);

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
        try {
            updateQueue(state => ({ ...state,
                pending: typeof next === 'function' ? next(state.pending) : next,
            }));
            return true;
        } catch (error) {
            console.warn('[OwnerMonitor] No se pudo guardar la cola:', error);
            showToast(`No se pudo guardar el cambio: ${error.message || 'almacenamiento no disponible'}. La cola existente se conserva.`, 'error');
            return false;
        }
    }, [updateQueue]);
    const setPendingChanges = persistPending;

    // Fusión de cambios en cola con setPendingChanges(prev => ...) para evitar
    // closure stale cuando el usuario pulsa +/- rápidamente antes del re-render.
    // Cada cambio conserva un UUID desde el primer intento; así un timeout del
    // monitor no puede convertir el mismo clic en dos comandos distintos.
    const queueInventoryChange = useCallback((action, productId, data) => {
        return persistPending(prev => {
            // Desde el primer intento, UUID y payload son inmutables. Los
            // cambios nuevos solo se fusionan con otros todavía no enviados.
            const frozen = prev.filter(change => change.attemptedAt);
            const next = normalizeSupervisorChanges(prev.filter(change => !change.attemptedAt));
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

            return normalizeSupervisorChanges([...frozen, ...next]);
        });
    }, [products, persistPending]);

    // Delta de stock pendiente por producto (para proyectar en la fila)
    const pendingStockDelta = (productId) => {
        const product = (products || []).find(p => String(p.id) === String(productId));
        const baseStock = product?.stock || 0;
        const changes = [...inFlightChanges, ...pendingChanges]
            .filter(c => String(c.productId) === String(productId) && c.action === 'adjust_stock'
                && shouldProjectSupervisorChange(c, product));
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
        const monitorDeviceId = localStorage.getItem('dj_device_id');
        if (!monitorDeviceId || localStorage.getItem('dj_paired_device_id') !== pairedDeviceId) {
            showToast('La identidad o vinculación del supervisor no es válida.', 'error');
            return;
        }
        if (Array.isArray(overrideList)) {
            // Un onClick puede pasar un evento React; solo un array es un lote.
            // También los lotes explícitos quedan recuperables si se pierde la respuesta.
            if (!persistPending(previous => {
                const byId = new Map(previous.map(c => [c.commandId, c]));
                normalizeSupervisorChanges(overrideList).forEach(c => {
                    if (!byId.has(c.commandId) && !resolvedIdsRef.current.has(c.commandId)) byId.set(c.commandId, c);
                });
                return [...byId.values()];
            })) return;
        }
        const listToProcess = normalizeSupervisorChanges(queueRef.current.pending)
            .filter(change => change.syncState !== 'rejected_local');
        if (!listToProcess.length) return;

        uploadingRef.current = true;
        setUploading(true);
        const actor = {
            supervisorId: supervisorUser?.id || null,
            supervisorNombre: supervisorUser?.nombre || supervisorUser?.usuario || 'Supervisor',
            supervisorRol: supervisorUser?.rol || 'SUPERVISOR',
        };

        try {
            const buildRequest = change => {
                if (change.request) return change.request;
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
            };
            const rowsToInsert = listToProcess.map(buildRequest);

            // Inserción fila a fila: un cambio inválido no bloquea los demás.
            // Si la respuesta se perdió después de que Postgres insertó la fila,
            // el UUID estable se resuelve como "ya aceptado" en vez de crear otro.
            const okRows = [];
            const failedRows = [];
            for (let i = 0; i < rowsToInsert.length; i++) {
                durableQueue.assertScope();
                const id = rowsToInsert[i].id;
                const change = queueRef.current.pending.find(c => c.commandId === id);
                if (!change || resolvedIdsRef.current.has(id) || change.syncState === 'rejected_local') continue;
                // Congelar solo el que va a salir. B no se marca como intentado
                // si la respuesta incierta de A impide llegar a su petición.
                const priorAttemptUncertain = Boolean(change.attemptedAt && change.syncState !== 'rejected_local');
                const attemptedAt = change.attemptedAt || new Date().toISOString();
                updateQueue(state => ({ ...state, pending: state.pending.map(c => c.commandId === id
                    ? { ...c, attemptedAt, request: buildRequest(c) } : c) }));
                const row = queueRef.current.pending.find(c => c.commandId === id)?.request;
                if (!row) continue;
                if (row.primary_device_id !== pairedDeviceId || row.monitor_device_id !== monitorDeviceId) {
                    throw new Error('El comando guardado pertenece a otra vinculación.');
                }
                let rowError;
                let requestConflict = false;
                try {
                    ({ error: rowError } = await supabaseCloud.from('supervisor_commands').insert(row));
                } catch (error) {
                    rowError = { message: error.message || 'Respuesta de red desconocida' };
                }
                durableQueue.assertScope();

                if (rowError?.code === '23505') {
                    const { data: existingCommand, error: lookupError } = await supabaseCloud
                        .from('supervisor_commands')
                        .select('id,status,primary_device_id,monitor_device_id,command_type,payload,error_reason')
                        .eq('id', row.id)
                        .maybeSingle();
                    durableQueue.assertScope();
                    if (!lookupError && sameSupervisorRequest(existingCommand, row)) {
                        rowError = null;
                        setAllCloudCmds(previous => [...previous.filter(c => c.id !== existingCommand.id), existingCommand]);
                    } else if (!lookupError && existingCommand) {
                        requestConflict = true;
                        rowError = { code: 'REQUEST_ID_CONFLICT', message: 'Ese identificador ya corresponde a otro contenido. No se ha reenviado como una operación nueva.' };
                    }
                }

                // Solo una respuesta definitiva al primer intento permite afirmar
                // que NO se insertó. Un rechazo tras un timeout anterior no borra
                // la incertidumbre de la petición original.
                const rejectedWithoutInsert = requestConflict || (!priorAttemptUncertain && rowError
                    && (/^(22|23)/.test(String(rowError.code)) && rowError.code !== '23505'
                        || ['42501', 'PGRST102', 'PGRST204'].includes(rowError.code)));
                if (rowError) {
                    failedRows.push({ row, change, message: rowError.message, code: rowError.code });
                    updateQueue(state => ({ ...state, pending: state.pending.map(c => c.commandId === id ? {
                        ...c,
                        syncState: rejectedWithoutInsert ? 'rejected_local' : 'uncertain',
                        lastError: rowError.message || 'No se pudo confirmar el envío',
                    } : c) }));
                    console.warn(`[OwnerMonitor] Comando ${id}: ${rowError.message}`);
                } else {
                    okRows.push(row);
                    // Conciliar cada respuesta contra el estado vigente, no contra
                    // la fotografía del inicio del lote. Un ACK adelantado manda.
                    updateQueue(state => {
                        const pending = state.pending.find(c => c.commandId === row.id);
                        if (!pending || resolvedIdsRef.current.has(row.id)) return state;
                        return {
                            pending: state.pending.filter(c => c.commandId !== row.id),
                            inFlight: [...state.inFlight.filter(c => c.commandId !== row.id), {
                                ...pending, sentAt: new Date().toISOString(), syncState: 'sent',
                            }],
                        };
                    });
                }
                // No adelantar comandos nuevos al que tiene resultado incierto.
                // Una consulta/reintento con su mismo UUID resolverá primero ese envío.
                if (rowError && !rejectedWithoutInsert) break;
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

            if (failedRows.length === 0 && okRows.length > 0) {
                showToast(`${okRows.length} cambio(s) enviado(s); esperando confirmación de la caja`, 'success');
            }
        } catch (err) {
            console.error('[OwnerMonitor] Excepción al subir lote:', err);
            showToast('Error de conexión al enviar cambios. La cola local se conserva.', 'error');
        } finally {
            uploadingRef.current = false;
            setUploading(false);
        }
    };
    const discardPendingChanges = () => {
        const retained = queueRef.current.pending.some(c => c.attemptedAt && c.syncState !== 'rejected_local') || queueRef.current.inFlight.length > 0;
        if (persistPending(previous => previous.filter(c => c.attemptedAt && c.syncState !== 'rejected_local'))) {
            showToast(retained ? 'Descartados solo cambios sin enviar. Los enviados se conservan hasta confirmar o cancelar en la nube.' : 'Cola local descartada', 'info');
        }
    };

    const discardSinglePendingChange = (targetIndex) => {
        const target = pendingChanges[targetIndex];
        if (!target) return;
        if (target.attemptedAt && target.syncState !== 'rejected_local') {
            showToast('El envío puede existir en la nube. Verifica su estado antes de cancelarlo.', 'warning');
            return;
        }
        if (persistPending(previous => previous.filter(c => c.commandId !== target.commandId
            || (c.attemptedAt && c.syncState !== 'rejected_local')))) {
            showToast('Cambio descartado de la cola local', 'info');
        }
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
