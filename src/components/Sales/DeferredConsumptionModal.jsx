// src/components/Sales/DeferredConsumptionModal.jsx
// Modal de gestión de Fichas Activas de Consumo Diferido en Sitio (Caja de Cervezas / Combos)

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Beer, CheckCircle2, Clock, Plus, Minus, X, AlertTriangle, ChevronRight, History, PackageCheck, Loader2, Undo2, RotateCcw } from 'lucide-react';
import { Modal } from '../Modal';
import { getActiveSessions, registerPartialDispatch, revertDispatchRound } from '../../services/consumptionSessionService';
import { showToast } from '../Toast';
import { useAuthStore } from '../../hooks/store/useAuthStore';

export default function DeferredConsumptionModal({
    isOpen,
    onClose,
    products = [],
    triggerHaptic
}) {
    const [sessions, setSessions] = useState([]);
    const [selectedSession, setSelectedSession] = useState(null);
    const [dispatchSelections, setDispatchSelections] = useState({}); // { [productId]: qty }
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [activeTab, setActiveTab] = useState('active'); // 'active' | 'history'
    const [allSessionsHistory, setAllSessionsHistory] = useState([]);
    const [confirmRevertData, setConfirmRevertData] = useState(null); // { sessionId, dispatch }
    const dispatchRequestIdRef = useRef(null);

    const loadSessions = useCallback(async () => {
        const active = await getActiveSessions();
        setSessions(active);

        try {
            const { getAllSessions } = await import('../../services/consumptionSessionService');
            const all = await getAllSessions();
            setAllSessionsHistory(all);
        } catch (e) {}
    }, []);

    useEffect(() => {
        if (isOpen) {
            loadSessions();
            setSelectedSession(null);
            setDispatchSelections({});
            dispatchRequestIdRef.current = null;
        }
    }, [isOpen, loadSessions]);

    useEffect(() => {
        const handleUpdate = () => {
            if (isOpen) loadSessions();
        };
        window.addEventListener('consumption-sessions-updated', handleUpdate);
        window.addEventListener('app_storage_update', handleUpdate);
        return () => {
            window.removeEventListener('consumption-sessions-updated', handleUpdate);
            window.removeEventListener('app_storage_update', handleUpdate);
        };
    }, [isOpen, loadSessions]);

    if (!isOpen) return null;

    const activeUser = useAuthStore.getState().usuarioActivo;
    const cajeroNombre = activeUser ? (activeUser.nombre || activeUser.usuario || 'Cajero') : 'Cajero';

    // Obtener productos elegibles para el combo de la ficha
    const getEligibleProducts = (session) => {
        if (!session) return [];
        const comboObj = products.find(p => p.id === session.comboId || p.name === session.comboName);

        let allowedIds = new Set();
        if (comboObj && comboObj.modularGroups && Array.isArray(comboObj.modularGroups)) {
            comboObj.modularGroups.forEach(g => {
                (g.allowedProductIds || []).forEach(id => allowedIds.add(id));
            });
        }

        if (allowedIds.size > 0) {
            return products.filter(p => allowedIds.has(p.id));
        }

        // Fallback: Si no hay IDs explícitos, mostrar todos los productos que no sean combos
        return products.filter(p => !p.isCombo);
    };

    const eligibleProducts = selectedSession ? getEligibleProducts(selectedSession) : [];

    const getDispatchTotal = () => {
        return Object.values(dispatchSelections).reduce((sum, q) => sum + (Number(q) || 0), 0);
    };

    const handleUpdateDispatchQty = (productId, delta, session) => {
        if (!session) return;
        const currentQty = dispatchSelections[productId] || 0;
        const currentTotal = getDispatchTotal();
        const remainingQuota = session.totalQuota - session.servedCount;
        const targetProd = products.find(p => p.id === productId);
        const availableStock = Number(targetProd?.stock) || 0;

        if (delta > 0) {
            // Guardagujas 1: Límite de Cuota Restante
            if (currentTotal >= remainingQuota) {
                showToast(`Cuota máxima alcanzada (${remainingQuota} pendientes)`, 'warning');
                triggerHaptic?.();
                return;
            }
            // Guardagujas 2: Stock Físico Disponible
            if (currentQty >= availableStock) {
                showToast(`Stock máximo alcanzado para "${targetProd?.name || 'producto'}"`, 'warning');
                triggerHaptic?.();
                return;
            }
        }

        const nextQty = Math.max(0, currentQty + delta);
        setDispatchSelections(prev => {
            const copy = { ...prev };
            if (nextQty === 0) delete copy[productId];
            else copy[productId] = nextQty;
            return copy;
        });
    };

    const handleConfirmDispatch = async () => {
        if (!selectedSession || isSubmitting) return;

        const validItems = Object.entries(dispatchSelections)
            .filter(([, qty]) => Number(qty) > 0)
            .map(([productId, qty]) => {
                const prod = products.find(p => p.id === productId);
                return {
                    productId,
                    productName: prod?.name || 'Cerveza',
                    qty: Number(qty)
                };
            });

        if (validItems.length === 0) {
            showToast('Selecciona al menos 1 unidad para despachar', 'warning');
            return;
        }

        setIsSubmitting(true);
        triggerHaptic?.();

        try {
            // El mismo requestId sobrevive un fallo de respuesta para que un
            // reintento no vuelva a descontar el despacho ya aplicado.
            dispatchRequestIdRef.current ||= crypto.randomUUID();
            const res = await registerPartialDispatch(
                selectedSession.id,
                validItems,
                cajeroNombre,
                dispatchRequestIdRef.current,
                activeUser
            );
            if (!res.success) {
                showToast(res.error || 'Error al despachar cervezas', 'error');
                return;
            }

            showToast(
                res.isCompleted
                    ? '¡Ficha completada exitosamente! Todas las unidades servidas.'
                    : `¡${getDispatchTotal()} cerveza(s) entregadas con éxito! Stock descontado.`,
                'success'
            );

            setSelectedSession(null);
            setDispatchSelections({});
            dispatchRequestIdRef.current = null;
            await loadSessions();
        } catch (err) {
            console.error('[DeferredModal] Error en despacho:', err);
            showToast('Error inesperado al despachar', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleExecuteRevert = async () => {
        if (!confirmRevertData || isSubmitting) return;
        setIsSubmitting(true);
        triggerHaptic?.();
        try {
            const res = await revertDispatchRound(
                confirmRevertData.sessionId,
                confirmRevertData.dispatch.id,
                cajeroNombre,
                activeUser
            );
            if (!res.success) {
                showToast(res.error || 'Error al revertir la entrega', 'error');
                return;
            }

            showToast(`¡Entrega revertida con éxito! ${res.revertedQty || ''} unidad(es) devueltas al inventario.`, 'success');
            setConfirmRevertData(null);
            setSelectedSession(null);
            await loadSessions();
        } catch (err) {
            console.error('[DeferredModal] Error en reversión:', err);
            showToast('Error inesperado al revertir la entrega', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const formatTimeAgo = (isoString) => {
        if (!isoString) return '';
        const mins = Math.floor((Date.now() - new Date(isoString).getTime()) / 60000);
        if (mins < 1) return 'Hace un momento';
        if (mins < 60) return `Hace ${mins} min`;
        const hrs = Math.floor(mins / 60);
        return `Hace ${hrs} hr${hrs > 1 ? 's' : ''}`;
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="" size="max-w-2xl">
            <div className="space-y-4 text-slate-800 dark:text-slate-200">
                {/* Header Principal */}
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-xl flex items-center justify-center text-amber-600 dark:text-amber-400">
                            <Beer size={22} />
                        </div>
                        <div>
                            <h3 className="font-black text-slate-800 dark:text-white text-base">
                                Fichas de Consumo en Sitio
                            </h3>
                            <p className="text-xs text-amber-600 dark:text-amber-400 font-bold">
                                Control de despacho de cervezas por cuotas en local
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                            <button
                                onClick={() => setActiveTab('active')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                                    activeTab === 'active'
                                        ? 'bg-amber-500 text-white shadow-sm'
                                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
                                }`}
                            >
                                Activas ({sessions.length})
                            </button>
                            <button
                                onClick={() => setActiveTab('history')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                                    activeTab === 'history'
                                        ? 'bg-amber-500 text-white shadow-sm'
                                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
                                }`}
                            >
                                Historial ({allSessionsHistory.length})
                            </button>
                        </div>
                    </div>
                </div>

                {/* Sub-pantalla: Despachar en Ficha Seleccionada */}
                {selectedSession ? (
                    <div className="space-y-4 animate-in fade-in zoom-in-95 duration-150">
                        {/* Banner Ficha Seleccionada */}
                        <div className="bg-gradient-to-r from-amber-500 to-amber-600 text-white p-4 rounded-2xl shadow-lg flex justify-between items-center">
                            <div>
                                <div className="text-xs uppercase tracking-wider font-bold text-amber-100">
                                    Despachando a Cliente
                                </div>
                                <div className="text-lg font-black">{selectedSession.customerRef}</div>
                                <div className="text-xs text-amber-100 flex items-center gap-2">
                                    <span>Venta #{selectedSession.saleNumber}</span>
                                    <span>•</span>
                                    <span>{selectedSession.comboName}</span>
                                </div>
                            </div>
                            <div className="text-right bg-white/10 backdrop-blur-md px-3 py-2 rounded-xl border border-white/20">
                                <div className="text-[10px] uppercase font-bold text-amber-100">Cuota Servida</div>
                                <div className="text-xl font-black">{selectedSession.servedCount} / {selectedSession.totalQuota}</div>
                                <div className="text-[10px] font-bold text-amber-200">Quedan {selectedSession.totalQuota - selectedSession.servedCount} pendientes</div>
                            </div>
                        </div>

                        {/* Opción 2: Banner de Deshacer última entrega rápida si existe */}
                        {(() => {
                            const dispatches = selectedSession.dispatches || [];
                            const lastDispatch = dispatches[dispatches.length - 1];
                            if (!lastDispatch) return null;
                            const summary = lastDispatch.items?.map(i => `${i.qty}x ${i.productName}`).join(', ');

                            return (
                                <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 rounded-2xl p-3 flex items-center justify-between gap-3 animate-in fade-in">
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-black text-rose-900 dark:text-rose-200 flex items-center gap-1.5">
                                            <Undo2 size={14} className="text-rose-500" />
                                            <span>¿Equivocación en la entrega anterior?</span>
                                        </div>
                                        <div className="text-[11px] font-bold text-rose-700 dark:text-rose-300 truncate">
                                            Última ronda: {summary}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setConfirmRevertData({ sessionId: selectedSession.id, dispatch: lastDispatch })}
                                        className="shrink-0 px-3 py-1.5 bg-rose-500 hover:bg-rose-600 text-white font-black rounded-xl text-xs flex items-center gap-1 shadow-sm active:scale-95 transition-all cursor-pointer"
                                    >
                                        <Undo2 size={12} /> Deshacer ronda
                                    </button>
                                </div>
                            );
                        })()}

                        {/* Selección de Modelos/Cervezas a Servir */}
                        <div className="space-y-2">
                            <div className="flex justify-between items-center px-1">
                                <span className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase">
                                    Selecciona los modelos a entregar ahora:
                                </span>
                                <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
                                    Lote actual: {getDispatchTotal()} uds
                                </span>
                            </div>

                            <div className="max-h-[42vh] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                                {eligibleProducts.map(prod => {
                                    const qtySelected = dispatchSelections[prod.id] || 0;
                                    const stock = Number(prod.stock) || 0;
                                    const remainingQuota = selectedSession.totalQuota - selectedSession.servedCount;
                                    const canAdd = getDispatchTotal() < remainingQuota && qtySelected < stock;

                                    return (
                                        <div
                                            key={prod.id}
                                            className={`p-3 rounded-2xl border transition-all flex items-center justify-between ${
                                                qtySelected > 0
                                                    ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700/60 ring-2 ring-amber-500/20'
                                                    : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800'
                                            }`}
                                        >
                                            <div className="min-w-0 flex-1 mr-3">
                                                <div className="text-xs font-black text-slate-800 dark:text-white capitalize truncate">
                                                    {prod.name}
                                                </div>
                                                <div className="text-[10px] text-slate-400 font-medium flex items-center gap-2 mt-0.5">
                                                    <span>${(prod.priceUsd || 0).toFixed(2)}</span>
                                                    <span>·</span>
                                                    {stock > 0 ? (
                                                        <span className="font-bold text-slate-500 dark:text-slate-400">
                                                            Stock disponible: {stock} u
                                                        </span>
                                                    ) : (
                                                        <span className="font-black text-rose-500 bg-rose-50 dark:bg-rose-950/40 px-1.5 py-0.5 rounded">
                                                            Agotado en inventario (0)
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleUpdateDispatchQty(prod.id, -1, selectedSession)}
                                                        disabled={qtySelected === 0}
                                                        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 transition-colors"
                                                    >
                                                        <Minus size={14} strokeWidth={3} />
                                                    </button>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        max={stock}
                                                        value={qtySelected === 0 ? '' : qtySelected}
                                                        placeholder="0"
                                                        onChange={(e) => {
                                                            const parsed = parseInt(e.target.value, 10);
                                                            const nextVal = isNaN(parsed) ? 0 : Math.max(0, parsed);
                                                            const diff = nextVal - qtySelected;
                                                            if (diff !== 0) handleUpdateDispatchQty(prod.id, diff, selectedSession);
                                                        }}
                                                        onFocus={(e) => e.target.select()}
                                                        className="w-11 text-center text-xs font-black text-amber-600 dark:text-amber-400 bg-white dark:bg-slate-900 outline-none rounded-lg py-1 px-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => handleUpdateDispatchQty(prod.id, 1, selectedSession)}
                                                        disabled={!canAdd}
                                                        className="w-8 h-8 rounded-lg flex items-center justify-center text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-30 disabled:bg-slate-300 dark:disabled:bg-slate-700 transition-colors"
                                                    >
                                                        <Plus size={14} strokeWidth={3} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Acciones de Despacho */}
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex gap-3">
                            <button
                                type="button"
                                onClick={() => { setSelectedSession(null); setDispatchSelections({}); }}
                                disabled={isSubmitting}
                                className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 font-bold rounded-2xl text-xs uppercase tracking-wider transition-all"
                            >
                                Volver a Fichas
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmDispatch}
                                disabled={getDispatchTotal() === 0 || isSubmitting}
                                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-black rounded-2xl text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        <span>Despachando...</span>
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle2 size={16} />
                                        <span>Servir {getDispatchTotal()} Cervezas</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                ) : (
                    /* Lista de Fichas Activas */
                    <div className="space-y-3">
                        {activeTab === 'active' ? (
                            sessions.length === 0 ? (
                                <div className="text-center py-12 bg-slate-50 dark:bg-slate-800/40 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 space-y-2">
                                    <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 text-amber-500 rounded-2xl flex items-center justify-center mx-auto">
                                        <Beer size={24} />
                                    </div>
                                    <h4 className="font-black text-slate-700 dark:text-slate-300 text-sm">
                                        No hay fichas de consumo activas
                                    </h4>
                                    <p className="text-xs text-slate-400 max-w-xs mx-auto font-medium">
                                        Al cobrar un combo modular activando la opción "Consumo Diferido en Sitio", la ficha aparecerá aquí automáticamente.
                                    </p>
                                </div>
                            ) : (
                                <div className="max-h-[55vh] overflow-y-auto space-y-3 pr-1 custom-scrollbar">
                                    {sessions.map(session => {
                                        const pct = Math.min(100, Math.round((session.servedCount / session.totalQuota) * 100));

                                        return (
                                            <div
                                                key={session.id}
                                                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-amber-400 dark:hover:border-amber-600 rounded-2xl p-4 shadow-xs transition-all space-y-3"
                                            >
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-black text-base text-slate-800 dark:text-white">
                                                                {session.customerRef}
                                                            </span>
                                                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
                                                                Venta #{session.saleNumber}
                                                            </span>
                                                        </div>
                                                        <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                                            {session.comboName}
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400">
                                                        <Clock size={13} />
                                                        <span>{formatTimeAgo(session.createdAt)}</span>
                                                    </div>
                                                </div>

                                                {/* Barra de Progreso de Servidos */}
                                                <div>
                                                    <div className="flex justify-between items-center text-xs mb-1">
                                                        <span className="font-black text-slate-700 dark:text-slate-300">
                                                            Progreso de Entrega
                                                        </span>
                                                        <span className="font-black text-amber-600 dark:text-amber-400">
                                                            {session.servedCount} / {session.totalQuota} servidas ({pct}%)
                                                        </span>
                                                    </div>
                                                    <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-300"
                                                            style={{ width: `${pct}%` }}
                                                        />
                                                    </div>
                                                </div>

                                                {/* Historial rápido de rondas despachadas */}
                                                {session.dispatches && session.dispatches.length > 0 && (
                                                    <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl text-[11px] space-y-1">
                                                        <div className="font-black text-slate-400 uppercase text-[9px] flex items-center gap-1">
                                                            <History size={10} /> Entregas realizadas ({session.dispatches.length} ronda{session.dispatches.length > 1 ? 's' : ''}):
                                                        </div>
                                                        {session.dispatches.map((d, dIdx) => (
                                                            <div key={dIdx} className="flex justify-between items-center text-slate-600 dark:text-slate-400 font-medium">
                                                                <span>
                                                                    Ronda {dIdx + 1}: {d.items?.map(it => `${it.qty}x ${it.productName}`).join(', ')}
                                                                </span>
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[10px] text-slate-400">by {d.cashier}</span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setConfirmRevertData({ sessionId: session.id, dispatch: d })}
                                                                        className="text-[9px] font-black text-rose-600 dark:text-rose-400 hover:text-rose-700 bg-rose-100 dark:bg-rose-950/60 hover:bg-rose-200 px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors cursor-pointer"
                                                                        title="Revertir esta entrega y devolver inventario"
                                                                    >
                                                                        <RotateCcw size={10} /> Revertir
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Botón Acción Despachar */}
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setSelectedSession(session);
                                                        setDispatchSelections({});
                                                    }}
                                                    className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-black rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all"
                                                >
                                                    <Beer size={15} />
                                                    <span>Servir Cervezas a esta Ficha</span>
                                                    <ChevronRight size={15} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )
                        ) : (
                            /* Historial completo de Fichas */
                            <div className="max-h-[55vh] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                                {allSessionsHistory.map(session => (
                                    <div key={session.id} className="p-3 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex justify-between items-center">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-black text-sm text-slate-800 dark:text-white">{session.customerRef}</span>
                                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                                                    session.status === 'COMPLETED'
                                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                                        : session.status === 'CANCELLED'
                                                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                                        : 'bg-amber-100 text-amber-700'
                                                }`}>
                                                    {session.status === 'COMPLETED' ? 'Completada' : session.status === 'CANCELLED' ? 'Anulada' : 'Activa'}
                                                </span>
                                            </div>
                                            <div className="text-xs text-slate-400 font-medium">{session.comboName} · Venta #{session.saleNumber}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-xs font-black text-slate-700 dark:text-slate-300">{session.servedCount} / {session.totalQuota} servidas</div>
                                            <div className="text-[10px] text-slate-400">{new Date(session.createdAt).toLocaleDateString()}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Modal Confirmación de Reversión de Entrega */}
            {confirmRevertData && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 max-w-sm w-full space-y-4 shadow-2xl">
                        <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950 text-rose-600 rounded-2xl flex items-center justify-center mx-auto">
                            <RotateCcw size={24} />
                        </div>
                        <div className="text-center space-y-1">
                            <h4 className="font-black text-slate-800 dark:text-white text-base">
                                ¿Revertir esta entrega?
                            </h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                                Se reintegrará el stock al inventario físico y se restará de las unidades servidas al cliente.
                            </p>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-xs space-y-1">
                            <div className="font-black text-slate-700 dark:text-slate-300">
                                Ronda a devolver:
                            </div>
                            <div className="font-bold text-rose-600 dark:text-rose-400">
                                {confirmRevertData.dispatch?.items?.map(i => `${i.qty}x ${i.productName}`).join(', ')}
                            </div>
                            <div className="text-[10px] text-slate-400">
                                Despachado por: {confirmRevertData.dispatch?.cashier || 'Cajero'}
                            </div>
                        </div>
                        <div className="flex gap-2 pt-1">
                            <button
                                type="button"
                                onClick={() => setConfirmRevertData(null)}
                                disabled={isSubmitting}
                                className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs uppercase"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={handleExecuteRevert}
                                disabled={isSubmitting}
                                className="flex-1 py-2.5 bg-rose-500 hover:bg-rose-600 text-white font-black rounded-xl text-xs uppercase shadow-sm flex items-center justify-center gap-1.5"
                            >
                                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : 'Confirmar Reversión'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </Modal>
    );
}
