import React, { useState } from 'react';
import { Gift, CheckCircle, Package, Plus, Minus } from 'lucide-react';
import { Modal } from '../Modal';

export default function ModularComboPickerModal({
    isOpen,
    onClose,
    combo,
    products = [],
    effectiveRate = 1,
    onConfirm
}) {
    // selections: { [groupId]: { [productId]: qty } }
    const [selections, setSelections] = useState({});

    // Reset when modal opens for a combo
    React.useEffect(() => {
        if (isOpen) {
            setSelections({});
        }
    }, [isOpen, combo]);

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

    const handleConfirm = () => {
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
                                        <span className={`text-xs font-black px-2 py-0.5 rounded-full ${
                                            isFulfilled
                                                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                                                : 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
                                        }`}>
                                            {currentTotal} / {reqQty} elegidas
                                        </span>
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
                                            <div key={pid} className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                                                <div className="min-w-0 flex-1 mr-2">
                                                    <div className="text-xs font-bold text-slate-800 dark:text-white truncate capitalize">
                                                        {prod.name}
                                                    </div>
                                                    <div className="text-[10px] text-slate-400 font-medium flex items-center gap-2">
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

                                                <div className="flex items-center gap-1 shrink-0 bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleUpdateQty(group.id, pid, -1)}
                                                        disabled={qtySelected === 0}
                                                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                                                    >
                                                        <Minus size={12} strokeWidth={3} />
                                                    </button>
                                                    <span className="w-6 text-center text-xs font-black text-purple-600 dark:text-purple-400">
                                                        {qtySelected}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleUpdateQty(group.id, pid, 1)}
                                                        disabled={!canAdd}
                                                        className="w-7 h-7 rounded-lg flex items-center justify-center text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-30 disabled:bg-slate-300 dark:disabled:bg-slate-700"
                                                    >
                                                        <Plus size={12} strokeWidth={3} />
                                                    </button>
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
                        disabled={!isAllFulfilled}
                        className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white font-black rounded-2xl text-xs uppercase tracking-wider shadow-lg shadow-purple-500/20 transition-all flex items-center justify-center gap-1.5"
                    >
                        <CheckCircle size={15} /> Agregar al Carrito
                    </button>
                </div>
            </div>
        </Modal>
    );
}
