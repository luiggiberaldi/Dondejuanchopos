import React, { useState } from 'react';
import { Gift, CheckCircle, Package, Plus, Minus, Zap, RotateCcw, Beer } from 'lucide-react';
import { Modal } from '../Modal';

export default function ModularComboPickerModal({
    isOpen,
    onClose,
    combo,
    products = [],
    effectiveRate = 1,
    initialSelections = null,
    onConfirm
}) {
    const [isDeferred, setIsDeferred] = useState(false);
    const [deferredCustomerRef, setDeferredCustomerRef] = useState('');
    // selections: { [groupId]: { [productId]: qty } }
    const [selections, setSelections] = useState({});

    // Reset or populate when modal opens for a combo
    React.useEffect(() => {
        if (isOpen) {
            setIsDeferred(false);
            setDeferredCustomerRef('');
            if (initialSelections && Array.isArray(initialSelections)) {
                const map = {};
                initialSelections.forEach(s => {
                    if (!map[s.groupId]) map[s.groupId] = {};
                    map[s.groupId][s.productId] = s.qty;
                });
                setSelections(map);
            } else {
                setSelections({});
            }
        }
    }, [isOpen, combo, initialSelections]);

    if (!isOpen || !combo) return null;

    // Helper: calculate total selected in a group
    const getGroupTotal = (groupId) => {
        const groupSel = selections[groupId] || {};
        return Object.values(groupSel).reduce((sum, q) => sum + (q || 0), 0);
    };

    // Check if all groups have reached their required quantity
    const isAllFulfilled = (combo.modularGroups || []).every(g => {
        return getGroupTotal(g.id) === (g.requiredQty || 1);
    });

    const handleFillRemaining = (groupId, productId) => {
        const group = combo.modularGroups?.find(g => g.id === groupId);
        if (!group) return;

        const reqQty = group.requiredQty || 1;
        const currentGroupTotal = getGroupTotal(groupId);
        const currentQty = selections[groupId]?.[productId] || 0;
        const targetProduct = products.find(p => p.id === productId);
        const availableStock = targetProduct?.stock ?? 0;

        const remainingForGroup = reqQty - (currentGroupTotal - currentQty);
        if (remainingForGroup <= 0) return;

        const qtyToAssign = Math.min(remainingForGroup, availableStock);
        if (qtyToAssign <= 0) return;

        setSelections(prev => {
            const groupSel = { ...(prev[groupId] || {}), [productId]: qtyToAssign };
            return {
                ...prev,
                [groupId]: groupSel
            };
        });
    };

    const handleClearProduct = (groupId, productId) => {
        setSelections(prev => {
            const groupSel = { ...(prev[groupId] || {}) };
            delete groupSel[productId];
            return {
                ...prev,
                [groupId]: groupSel
            };
        });
    };

    const handleClearGroup = (groupId) => {
        setSelections(prev => {
            const next = { ...prev };
            delete next[groupId];
            return next;
        });
    };

    const handleUpdateQty = (groupId, productId, delta) => {
        const group = combo.modularGroups?.find(g => g.id === groupId);
        if (!group) return;

        const currentGroupTotal = getGroupTotal(groupId);
        const currentQty = selections[groupId]?.[productId] || 0;
        const targetProduct = products.find(p => p.id === productId);
        const availableStock = targetProduct?.stock ?? 0;

        if (delta > 0) {
            // Check quota limit
            if (currentGroupTotal >= group.requiredQty) return;
            // Check stock limit
            if (currentQty >= availableStock) return;
        }

        const newQty = Math.max(0, currentQty + delta);

        setSelections(prev => {
            const groupSel = { ...(prev[groupId] || {}) };
            if (newQty === 0) {
                delete groupSel[productId];
            } else {
                groupSel[productId] = newQty;
            }
            return {
                ...prev,
                [groupId]: groupSel
            };
        });
    };

    const handleDirectQtyChange = (groupId, productId, valString) => {
        const group = combo.modularGroups?.find(g => g.id === groupId);
        if (!group) return;

        if (valString === '' || valString === null) {
            setSelections(prev => {
                const groupSel = { ...(prev[groupId] || {}) };
                delete groupSel[productId];
                return { ...prev, [groupId]: groupSel };
            });
            return;
        }

        let parsed = parseInt(valString, 10);
        if (isNaN(parsed) || parsed < 0) parsed = 0;

        const currentGroupTotal = getGroupTotal(groupId);
        const currentQty = selections[groupId]?.[productId] || 0;
        const targetProduct = products.find(p => p.id === productId);
        const availableStock = targetProduct?.stock ?? 0;

        const otherQty = currentGroupTotal - currentQty;
        const maxForGroup = (group.requiredQty || 1) - otherQty;
        const allowedMax = Math.max(0, Math.min(availableStock, maxForGroup));

        const finalQty = Math.min(parsed, allowedMax);

        setSelections(prev => {
            const groupSel = { ...(prev[groupId] || {}) };
            if (finalQty === 0) {
                delete groupSel[productId];
            } else {
                groupSel[productId] = finalQty;
            }
            return {
                ...prev,
                [groupId]: groupSel
            };
        });
    };

    const handleConfirm = () => {
        if (isDeferred) {
            if (!deferredCustomerRef.trim()) return;
            onConfirm([], {
                isDeferredConsumption: true,
                deferredCustomerRef: deferredCustomerRef.trim()
            });
            return;
        }

        if (!isAllFulfilled) return;

        const modularSelections = [];
        (combo.modularGroups || []).forEach(g => {
            const groupSel = selections[g.id] || {};
            Object.entries(groupSel).forEach(([productId, qty]) => {
                if (qty > 0) {
                    const prod = products.find(p => p.id === productId);
                    modularSelections.push({
                        groupId: g.id,
                        groupTitle: g.title,
                        productId,
                        qty,
                        productName: prod?.name || productId
                    });
                }
            });
        });

        onConfirm(modularSelections);
    };

    const priceBs = combo.priceBsManual != null && combo.priceBsManual > 0
        ? combo.priceBsManual
        : Math.round((combo.priceUsd || 0) * effectiveRate);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="" size="max-w-lg">
            <div className="space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center">
                            <Gift size={20} className="text-purple-600 dark:text-purple-400" />
                        </div>
                        <div>
                            <h3 className="font-black text-slate-800 dark:text-white text-base capitalize">
                                {combo.name}
                            </h3>
                            <p className="text-xs text-purple-600 dark:text-purple-400 font-bold">
                                Combo Modular Híbrido
                            </p>
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-base font-black text-brand">${(combo.priceUsd || 0).toFixed(2)}</div>
                        <div className="text-[10px] font-bold text-slate-400">{priceBs} Bs</div>
                    </div>
                </div>

                {/* Consumo Diferido en Sitio Toggle Card */}
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-2xl p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                                <Beer size={18} />
                            </div>
                            <div>
                                <div className="text-xs font-black text-amber-900 dark:text-amber-300">
                                    Consumo Diferido en Sitio
                                </div>
                                <div className="text-[10px] font-medium text-amber-700 dark:text-amber-400">
                                    Cobrar combo ahora y entregar marcas progresivamente
                                </div>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={isDeferred}
                                onChange={(e) => setIsDeferred(e.target.checked)}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:after:border-slate-600 peer-checked:bg-amber-500"></div>
                        </label>
                    </div>

                    {isDeferred && (
                        <div className="space-y-1 pt-1.5 border-t border-amber-200/60 dark:border-amber-800/40">
                            <label className="text-[11px] font-black text-amber-900 dark:text-amber-300 flex items-center justify-between">
                                <span>Nombre del Cliente / Mesa / Referencia <span className="text-rose-500">*</span></span>
                            </label>
                            <input
                                type="text"
                                placeholder="Ej. Juan Pérez - Barra / Mesa 4"
                                value={deferredCustomerRef}
                                onChange={(e) => setDeferredCustomerRef(e.target.value)}
                                className="w-full bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700/80 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-amber-500"
                            />
                        </div>
                    )}
                </div>

                {/* Fixed items section (if any) */}
                {combo.comboItems?.length > 0 && (
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-1.5">
                        <div className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
                            <Package size={12} /> Incluye (Ítems fijos)
                        </div>
                        <div className="space-y-1">
                            {combo.comboItems.map(ci => {
                                const prod = products.find(p => p.id === ci.productId);
                                return (
                                    <div key={ci.productId} className="flex justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                                        <span className="capitalize">• {ci.qty}x {prod?.name || 'Producto'}</span>
                                        <span className="text-[10px] text-emerald-500 font-black">Incluido</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Modular Groups selection */}
                <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1 custom-scrollbar">
                    {(combo.modularGroups || []).map(group => {
                        const currentTotal = getGroupTotal(group.id);
                        const reqQty = group.requiredQty || 1;
                        const isFulfilled = currentTotal === reqQty;
                        const pct = Math.min(100, Math.round((currentTotal / reqQty) * 100));

                        return (
                            <div key={group.id} className="bg-white dark:bg-slate-900 border border-purple-100 dark:border-purple-900/30 rounded-2xl p-3.5 space-y-3">
                                {/* Group header & progress */}
                                <div>
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="font-black text-sm text-slate-800 dark:text-white capitalize">
                                            🔀 {group.title}
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                            {currentTotal > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleClearGroup(group.id)}
                                                    className="text-[10px] font-black text-rose-500 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 px-2 py-0.5 rounded-full transition-all cursor-pointer flex items-center gap-1"
                                                    title="Vaciar todas las selecciones de este grupo"
                                                >
                                                    <RotateCcw size={10} />
                                                    <span>Vaciar todo</span>
                                                </button>
                                            )}
                                            <span className={`text-xs font-black px-2 py-0.5 rounded-full ${
                                                isFulfilled
                                                    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                                                    : 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
                                            }`}>
                                                {currentTotal} / {reqQty} elegidas
                                            </span>
                                        </div>
                                    </div>
                                    <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full transition-all duration-300 ${
                                                isFulfilled ? 'bg-emerald-500' : 'bg-purple-500'
                                            }`}
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Product list */}
                                <div className="space-y-2">
                                    {(group.allowedProductIds || []).map(pid => {
                                        const prod = products.find(p => p.id === pid);
                                        if (!prod) return null;
                                        const qtySelected = selections[group.id]?.[pid] || 0;
                                        const stock = prod.stock ?? 0;
                                        const canAdd = currentTotal < reqQty && qtySelected < stock;

                                        return (
                                            <div key={pid} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-xs font-bold text-slate-800 dark:text-white truncate capitalize">
                                                        {prod.name}
                                                    </div>
                                                    <div className="text-[10px] text-slate-400 font-medium flex items-center gap-1.5 flex-wrap">
                                                        <span>${(prod.priceUsd || 0).toFixed(2)} c/u</span>
                                                        <span>·</span>
                                                        {stock > 0 ? (
                                                            <span className="text-[10px] font-bold text-slate-400">
                                                                Disponibles: {stock}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400">
                                                                Agotado (0)
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    {/* Botón rápido Quitar */}
                                                    {qtySelected > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleClearProduct(group.id, pid)}
                                                            title={`Quitar las ${qtySelected} unidades de este producto`}
                                                            className="px-2 py-1 rounded-lg text-[10px] font-black bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300 hover:bg-rose-600 hover:text-white dark:hover:bg-rose-600 border border-rose-200 dark:border-rose-800/80 transition-all active:scale-95 flex items-center gap-1 shadow-xs cursor-pointer"
                                                        >
                                                            <RotateCcw size={10} />
                                                            <span>Quitar</span>
                                                        </button>
                                                    )}

                                                    {/* Botón rápido Llenar Todo/Restante */}
                                                    {stock > 0 && currentTotal < reqQty && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleFillRemaining(group.id, pid)}
                                                            title={`Asignar ${Math.min(reqQty - (currentTotal - qtySelected), stock)} unidades con 1 solo clic`}
                                                            className="px-2 py-1 rounded-lg text-[10px] font-black bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 hover:bg-purple-600 hover:text-white dark:hover:bg-purple-600 border border-purple-200 dark:border-purple-800/80 transition-all active:scale-95 flex items-center gap-1 shadow-xs cursor-pointer"
                                                        >
                                                            <Zap size={10} className="fill-current" />
                                                            <span>+{Math.min(reqQty - (currentTotal - qtySelected), stock)}</span>
                                                        </button>
                                                    )}

                                                    {/* Stepper +/- */}
                                                    <div className="flex items-center gap-0.5 bg-white dark:bg-slate-900 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleUpdateQty(group.id, pid, -1)}
                                                            disabled={qtySelected === 0}
                                                            className="w-6.5 h-6.5 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                                                        >
                                                            <Minus size={11} strokeWidth={3} />
                                                        </button>
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            max={stock}
                                                            value={qtySelected === 0 ? '' : qtySelected}
                                                            placeholder="0"
                                                            onChange={(e) => handleDirectQtyChange(group.id, pid, e.target.value)}
                                                            onFocus={(e) => e.target.select()}
                                                            className="w-8 text-center text-xs font-black text-purple-600 dark:text-purple-400 bg-slate-50/80 dark:bg-slate-800/80 outline-none focus:ring-2 focus:ring-purple-500/50 rounded-md py-0.5 px-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none cursor-text selection:bg-purple-200"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => handleUpdateQty(group.id, pid, 1)}
                                                            disabled={!canAdd}
                                                            className="w-6.5 h-6.5 rounded-md flex items-center justify-center text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-30 disabled:bg-slate-300 dark:disabled:bg-slate-700"
                                                        >
                                                            <Plus size={11} strokeWidth={3} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Footer action */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 font-bold rounded-2xl text-xs uppercase tracking-wider transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        disabled={isDeferred ? !deferredCustomerRef.trim() : !isAllFulfilled}
                        className={`flex-1 py-3 font-black rounded-2xl text-xs uppercase tracking-wider shadow-lg transition-all flex items-center justify-center gap-1.5 ${
                            isDeferred
                                ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-500/20 disabled:opacity-40'
                                : 'bg-purple-600 hover:bg-purple-700 text-white shadow-purple-500/20 disabled:opacity-40'
                        }`}
                    >
                        {isDeferred ? <Beer size={15} /> : <CheckCircle size={15} />} {isDeferred ? 'Agregar Consumo Diferido' : 'Agregar al Carrito'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
