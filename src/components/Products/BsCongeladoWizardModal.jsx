import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Lock, Sparkles, Check, AlertTriangle, Search, RefreshCw, X, ShieldCheck, ArrowRight } from 'lucide-react';
import { formatBs } from '../../utils/calculatorUtils';
import { roundBs, round2 } from '../../utils/dinero';
import { useAuthStore } from '../../hooks/store/useAuthStore';
import { showToast } from '../Toast';
import { logEvent } from '../../services/auditService';

// Subcomponente de Fila Optimizado con React.memo para CERO LAG (60 FPS)
const BsCongeladoRow = React.memo(function BsCongeladoRow({
    item,
    editEntry,
    onEditChange,
    onApplySuggestion
}) {
    const isEdited = editEntry && (editEntry.bs !== '' || editEntry.usd !== '');
    const initialUsd = item.currentUsd > 0 ? item.currentUsd : (item.usdBefore > 0 ? item.usdBefore : item.usdNow);

    const displayUsd = isEdited && editEntry.usd !== undefined ? editEntry.usd : initialUsd;
    const displayBs  = isEdited && editEntry.bs  !== undefined ? editEntry.bs  : item.currentBs;

    // ¿La sugerencia fue exactamente aplicada?
    const isSuggestionApplied = isEdited
        && Number(editEntry.usd) === item.suggestedUsd
        && Number(editEntry.bs)  === item.suggestedBs;

    return (
        <div
            className={`rounded-2xl border transition-all duration-200 ${
                isSuggestionApplied
                    ? 'bg-emerald-500/5 border-emerald-500/50 dark:bg-emerald-950/25 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]'
                    : isEdited
                        ? 'bg-amber-500/5 border-amber-500/40 dark:bg-amber-950/20 shadow-[0_0_0_1px_rgba(245,158,11,0.20)]'
                        : 'bg-white dark:bg-slate-800/60 border-slate-200/80 dark:border-slate-700/60 hover:border-slate-300 hover:shadow-sm'
            }`}
        >
            {/* ── Fila principal ── */}
            <div className="p-3 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">

                {/* Info Producto */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden border border-slate-200/50 dark:border-slate-700/50">
                        {item.image ? (
                            <img src={item.image} alt={item.productName} className="w-full h-full object-contain" />
                        ) : (
                            <Lock size={18} className="text-amber-500" />
                        )}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-bold text-sm text-slate-800 dark:text-slate-100 truncate">
                                {item.productName}
                            </h4>
                            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 shrink-0">
                                {item.label}
                            </span>
                            {/* Badge: sugerencia aplicada */}
                            {isSuggestionApplied && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                                    <Check size={10} strokeWidth={3} /> Sugerido
                                </span>
                            )}
                            {/* Badge: editado manualmente */}
                            {isEdited && !isSuggestionApplied && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                                    ✎ Editado
                                </span>
                            )}
                        </div>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                            <span>Bs actual: <strong className="text-slate-600 dark:text-slate-300">{formatBs(item.currentBs)} Bs</strong></span>
                            <span>· Equivalía a <strong className="text-blue-500 dark:text-blue-400">${item.usdBefore.toFixed(2)} USD</strong></span>
                        </p>
                    </div>
                </div>

                {/* Controles de Precio */}
                <div className="flex items-end gap-2 shrink-0 self-end lg:self-auto flex-wrap sm:flex-nowrap">

                    {/* Botón Sugerencia */}
                    <div className="flex flex-col items-center gap-1">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 select-none">
                            Sugerido
                        </span>
                        <button
                            type="button"
                            onClick={() => onApplySuggestion(item)}
                            className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shrink-0 ${
                                isSuggestionApplied
                                    ? 'bg-emerald-500 border-emerald-500 text-white shadow-md shadow-emerald-500/30'
                                    : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-100 hover:border-emerald-500/60'
                            }`}
                            title="Aplicar precio sugerido ajustado a la nueva tasa"
                        >
                            {isSuggestionApplied
                                ? <Check size={13} strokeWidth={3} />
                                : <Sparkles size={13} className="text-emerald-500" />
                            }
                            <span>${item.suggestedUsd % 1 === 0 ? item.suggestedUsd : item.suggestedUsd.toFixed(2)} / {formatBs(item.suggestedBs)} Bs</span>
                        </button>
                    </div>

                    {/* Separador */}
                    <div className="w-px h-8 bg-slate-200 dark:bg-slate-700 self-end mb-1 hidden sm:block" />

                    {/* Input $ USD */}
                    <div className="flex flex-col items-center gap-1">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-blue-500 dark:text-blue-400 select-none">
                            Precio USD
                        </span>
                        <div className="relative w-24 sm:w-28">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-blue-400 dark:text-blue-500 pointer-events-none select-none">
                                $
                            </span>
                            <input
                                type="number"
                                step="any"
                                value={displayUsd}
                                onFocus={(e) => {
                                    e.target.select();
                                    setTimeout(() => e.target.select(), 10);
                                }}
                                onChange={(e) => onEditChange(item.key, 'usd', e.target.value)}
                                className={`w-full pl-6 pr-2 py-1.5 text-xs font-black rounded-xl border text-right focus:outline-none focus:ring-2 transition-all ${
                                    isEdited
                                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-200 focus:ring-blue-500/30'
                                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:border-blue-400 focus:ring-blue-400/20'
                                }`}
                                placeholder={initialUsd ? String(initialUsd) : '0'}
                            />
                        </div>
                    </div>

                    {/* Input Bs */}
                    <div className="flex flex-col items-center gap-1">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-amber-500 dark:text-amber-400 select-none">
                            Precio Bs
                        </span>
                        <div className="relative w-28 sm:w-32">
                            <input
                                type="number"
                                step="any"
                                value={displayBs}
                                onFocus={(e) => {
                                    e.target.select();
                                    setTimeout(() => e.target.select(), 10);
                                }}
                                onChange={(e) => onEditChange(item.key, 'bs', e.target.value)}
                                className={`w-full pr-8 pl-2 py-1.5 text-xs font-black rounded-xl border text-right focus:outline-none focus:ring-2 transition-all ${
                                    isEdited
                                        ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 focus:ring-amber-500/30'
                                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:border-amber-400 focus:ring-amber-400/20'
                                }`}
                                placeholder={item.currentBs ? String(item.currentBs) : '0'}
                            />
                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-amber-400 dark:text-amber-500 pointer-events-none select-none">
                                Bs
                            </span>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
});

export default function BsCongeladoWizardModal({
    isOpen,
    onClose,
    prevRate = 0,
    newRate = 0,
    products = [],
    onSaveProducts,
    triggerHaptic,
    bsRoundingStep = 10,
}) {
    const [searchTerm, setSearchTerm] = useState('');
    const [edits, setEdits] = useState({}); // { [itemKey]: { usd: string | number, bs: string | number } }
    const [supervisorPin, setSupervisorPin] = useState('');
    const [showPinPrompt, setShowPinPrompt] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const activeUser = useAuthStore((state) => state.usuarioActivo);
    const isCajero = activeUser?.rol === 'CAJERO';

    // Identificar todos los productos/ítems con precio en Bs Congelado (Unidad, Caja o Medio Bulto)
    const frozenItems = useMemo(() => {
        if (!products || products.length === 0) return [];
        const list = [];

        const isFrozenMode = (mode, bsManual, forceBcv, bsUsdRef) => {
            if (['bs_fijo', 'fijo', 'bs_manual'].includes(mode)) return true;
            if (['tasa_dia', 'bcv', 'dual_usd'].includes(mode) || forceBcv || Number(bsUsdRef) > 0) return false;
            return Number(bsManual) > 0;
        };

        products.forEach(p => {
            // 1. Unidad
            if (isFrozenMode(p.pricingMode, p.priceBsManual, p.forceBcv, p.priceBsUsdRef)) {
                const currentBs = p.priceBsManual || 0;
                const currentUsd = p.priceUsdt || p.priceUsd || 0;
                const usdBefore = prevRate > 0 ? round2(currentBs / prevRate) : round2(currentUsd);
                const usdNow = newRate > 0 ? round2(currentBs / newRate) : 0;
                const baseUsdCalc = currentUsd > 0 ? currentUsd : (usdBefore > 0 ? usdBefore : usdNow);
                const suggestedUsd = baseUsdCalc >= 1 ? Math.round(baseUsdCalc) : round2(baseUsdCalc);
                const rawSuggestedBs = suggestedUsd > 0 ? (suggestedUsd * newRate) : currentBs;
                const suggestedBs = roundBs(rawSuggestedBs, bsRoundingStep);

                list.push({
                    key: `${p.id}_unit`,
                    productId: p.id,
                    productName: p.name,
                    image: p.image,
                    type: 'unidad',
                    label: 'Unidad',
                    currentBs,
                    currentUsd,
                    usdBefore,
                    usdNow,
                    suggestedUsd,
                    suggestedBs,
                    rawProduct: p
                });
            }

            // 2. Caja / Bulto
            const boxMode = p.boxPricingMode === 'inherit' ? p.pricingMode : p.boxPricingMode;
            if (p.hasBox && isFrozenMode(boxMode, p.boxPriceBsManual || p.boxPriceBs, p.forceBcv, p.boxPriceBsUsdRef)) {
                const currentBs = p.boxPriceBsManual || p.boxPriceBs || 0;
                const currentUsd = p.boxPriceUsdt || p.boxPriceUsd || 0;
                const usdBefore = prevRate > 0 ? round2(currentBs / prevRate) : round2(currentUsd);
                const usdNow = newRate > 0 ? round2(currentBs / newRate) : 0;
                const baseUsdCalc = currentUsd > 0 ? currentUsd : (usdBefore > 0 ? usdBefore : usdNow);
                const suggestedUsd = baseUsdCalc >= 1 ? Math.round(baseUsdCalc) : round2(baseUsdCalc);
                const rawSuggestedBs = suggestedUsd > 0 ? (suggestedUsd * newRate) : currentBs;
                const suggestedBs = roundBs(rawSuggestedBs, bsRoundingStep);

                list.push({
                    key: `${p.id}_box`,
                    productId: p.id,
                    productName: p.name,
                    image: p.image,
                    type: 'caja',
                    label: `Caja (${p.boxUnits || 1} ud)`,
                    currentBs,
                    currentUsd,
                    usdBefore,
                    usdNow,
                    suggestedUsd,
                    suggestedBs,
                    rawProduct: p
                });
            }

            // 3. Medio Bulto
            const halfBoxMode = p.halfBoxPricingMode === 'inherit' ? p.pricingMode : p.halfBoxPricingMode;
            if (p.hasHalfBox && isFrozenMode(halfBoxMode, p.halfBoxPriceBsManual || p.halfBoxPriceBs, p.forceBcv, p.halfBoxPriceBsUsdRef)) {
                const currentBs = p.halfBoxPriceBsManual || p.halfBoxPriceBs || 0;
                const currentUsd = p.halfBoxPriceUsdt || p.halfBoxPriceUsd || 0;
                const usdBefore = prevRate > 0 ? round2(currentBs / prevRate) : round2(currentUsd);
                const usdNow = newRate > 0 ? round2(currentBs / newRate) : 0;
                const baseUsdCalc = currentUsd > 0 ? currentUsd : (usdBefore > 0 ? usdBefore : usdNow);
                const suggestedUsd = baseUsdCalc >= 1 ? Math.round(baseUsdCalc) : round2(baseUsdCalc);
                const rawSuggestedBs = suggestedUsd > 0 ? (suggestedUsd * newRate) : currentBs;
                const suggestedBs = roundBs(rawSuggestedBs, bsRoundingStep);

                list.push({
                    key: `${p.id}_halfBox`,
                    productId: p.id,
                    productName: p.name,
                    image: p.image,
                    type: 'medioBulto',
                    label: `Medio Bulto (${p.halfBoxUnits || 1} ud)`,
                    currentBs,
                    currentUsd,
                    usdBefore,
                    usdNow,
                    suggestedUsd,
                    suggestedBs,
                    rawProduct: p
                });
            }
        });

        return list;
    }, [products, prevRate, newRate, bsRoundingStep]);

    // Resetear formulario al abrir
    useEffect(() => {
        if (isOpen) {
            setEdits({});
            setSearchTerm('');
            setSupervisorPin('');
            setShowPinPrompt(false);
        }
    }, [isOpen]);

    // Handlers optimizados con useCallback para evitar re-renderizado de filas no editadas
    const handleEditChange = useCallback((key, fieldType, valStr) => {
        const numVal = parseFloat(valStr);
        if (valStr === '' || isNaN(numVal)) {
            setEdits(prev => {
                const currentObj = prev[key] || {};
                const updated = { ...currentObj, [fieldType]: '' };
                if (!updated.usd && !updated.bs) {
                    const copy = { ...prev };
                    delete copy[key];
                    return copy;
                }
                return { ...prev, [key]: updated };
            });
        } else if (fieldType === 'usd') {
            // Al cambiar $ USD base: se sugiere el nuevo monto equivalente en Bs a la nueva tasa
            const calcBs = roundBs(numVal * (newRate || 1), bsRoundingStep);
            setEdits(prev => ({
                ...prev,
                [key]: {
                    ...(prev[key] || {}),
                    usd: valStr,
                    bs: calcBs
                }
            }));
        } else if (fieldType === 'bs') {
            // Al cambiar el precio fijo en Bs Congelado: se actualiza SOLO el monto en Bs sin corromper el USD de referencia
            setEdits(prev => ({
                ...prev,
                [key]: {
                    ...(prev[key] || {}),
                    bs: valStr
                }
            }));
        }
    }, [newRate, bsRoundingStep]);

    const handleApplySuggestion = useCallback((item) => {
        triggerHaptic && triggerHaptic();
        setEdits(prev => ({
            ...prev,
            [item.key]: { usd: item.suggestedUsd, bs: item.suggestedBs }
        }));
    }, [triggerHaptic]);

    if (!isOpen) return null;

    // Filtrar por término de búsqueda
    const filteredItems = frozenItems.filter(item => 
        item.productName.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Handler para aplicar sugerencias a TODOS de un solo clic
    const handleApplyAllSuggestions = () => {
        triggerHaptic && triggerHaptic();
        const newEdits = {};
        frozenItems.forEach(item => {
            newEdits[item.key] = { usd: item.suggestedUsd, bs: item.suggestedBs };
        });
        setEdits(newEdits);
        showToast(`Se aplicaron ${frozenItems.length} sugerencias de precio`, 'info');
    };

    // Total de cambios pendientes
    const modifiedKeys = Object.keys(edits).filter(k => edits[k] && (edits[k].bs !== '' || edits[k].usd !== ''));
    const modifiedCount = modifiedKeys.length;

    // Guardar cambios finales
    const handleConfirmSave = async () => {
        if (modifiedCount === 0) {
            onClose();
            return;
        }

        // Si es cajero y requiere clave de supervisor
        if (isCajero && !showPinPrompt) {
            const storedPin = localStorage.getItem('supervisor_pin') || '1234';
            setShowPinPrompt(true);
            return;
        }

        if (isCajero && showPinPrompt) {
            const storedPin = localStorage.getItem('supervisor_pin') || '1234';
            if (supervisorPin !== storedPin) {
                showToast('PIN de supervisor incorrecto', 'error');
                return;
            }
        }

        setIsSubmitting(true);

        try {
            // Mapear productos modificados
            const updatedProductsMap = new Map();

            frozenItems.forEach(item => {
                const editEntry = edits[item.key];
                if (editEntry && (editEntry.bs !== '' || editEntry.usd !== '')) {
                    const newPriceBs = editEntry.bs !== '' ? parseFloat(editEntry.bs) : undefined;
                    const newPriceUsd = editEntry.usd !== '' ? parseFloat(editEntry.usd) : undefined;
                    const origProd = updatedProductsMap.get(item.productId) || { ...item.rawProduct };

                    if (item.type === 'unidad') {
                        if (newPriceBs !== undefined && !isNaN(newPriceBs)) {
                            origProd.priceBsManual = newPriceBs;
                            origProd.pricingMode = 'bs_fijo';
                            origProd.forceBcv = false;
                        }
                        if (newPriceUsd !== undefined && !isNaN(newPriceUsd)) {
                            origProd.priceUsdt = newPriceUsd;
                            origProd.priceUsd = newPriceUsd;
                        }
                    } else if (item.type === 'caja') {
                        if (newPriceBs !== undefined && !isNaN(newPriceBs)) {
                            origProd.boxPriceBsManual = newPriceBs;
                            origProd.boxPricingMode = 'bs_fijo';
                        }
                        if (newPriceUsd !== undefined && !isNaN(newPriceUsd)) {
                            origProd.boxPriceUsdt = newPriceUsd;
                            origProd.boxPriceUsd = newPriceUsd;
                        }
                    } else if (item.type === 'medioBulto') {
                        if (newPriceBs !== undefined && !isNaN(newPriceBs)) {
                            origProd.halfBoxPriceBsManual = newPriceBs;
                            origProd.halfBoxPricingMode = 'bs_fijo';
                        }
                        if (newPriceUsd !== undefined && !isNaN(newPriceUsd)) {
                            origProd.halfBoxPriceUsdt = newPriceUsd;
                            origProd.halfBoxPriceUsd = newPriceUsd;
                        }
                    }

                    updatedProductsMap.set(item.productId, origProd);
                }
            });

            const updatedProductsList = Array.from(updatedProductsMap.values());

            if (onSaveProducts && updatedProductsList.length > 0) {
                await onSaveProducts(updatedProductsList);
                await logEvent('INVENTARIO', 'AJUSTE_BS_CONGELADO', `Ajustados ${updatedProductsList.length} productos en USD ($) y Bs tras cambio de tasa (${prevRate} -> ${newRate})`);
                showToast(`¡Se actualizaron ${updatedProductsList.length} precios correctamente!`, 'success');
            }

            onClose();
        } catch (err) {
            console.error('Error al actualizar precios en Bs congelado:', err);
            showToast('Error al guardar los cambios de precio', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const effectivePrevRate = prevRate > 0 
        ? prevRate 
        : parseFloat(localStorage.getItem('dj_prev_rate') || '0');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-md animate-fadeIn">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh] overflow-hidden">
                
                {/* Header Modal */}
                <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center shrink-0">
                            <Lock size={22} />
                        </div>
                        <div>
                            <h3 className="font-outfit text-lg font-black text-slate-800 dark:text-white leading-tight">
                                Revisión de Precios en Bs Congelado
                            </h3>
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5">
                                Tasa anterior: <span className="font-bold text-slate-700 dark:text-slate-300">{effectivePrevRate > 0 ? formatBs(effectivePrevRate) : '---'} Bs</span>
                                <ArrowRight size={12} className="text-amber-500" />
                                Nueva tasa: <span className="font-bold text-emerald-600 dark:text-emerald-400">{newRate > 0 ? formatBs(newRate) : '---'} Bs</span>
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Toolbar: Buscador y Botón Masivo */}
                <div className="p-3 sm:p-4 bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
                    <div className="relative flex-1 min-w-[200px]">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Buscar producto congelado..."
                            className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-amber-500"
                        />
                    </div>
                    {frozenItems.length > 0 && (
                        <button
                            onClick={handleApplyAllSuggestions}
                            className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all active:scale-95 cursor-pointer"
                            title="Ajustar automáticamente todos los precios en $ y Bs congelados"
                        >
                            <Sparkles size={14} />
                            <span>Aplicar Sugerencia a Todos ({frozenItems.length})</span>
                        </button>
                    )}
                </div>

                {/* Lista de Ítems Congelados (Renderizado Optimizado a 60 FPS) */}
                <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-3 custom-scrollbar">
                    {filteredItems.length === 0 ? (
                        <div className="py-12 text-center text-slate-400">
                            <Lock size={36} className="mx-auto mb-2 opacity-30 text-amber-500" />
                            <p className="text-sm font-medium">No hay productos en Bs congelado para mostrar.</p>
                        </div>
                    ) : (
                        filteredItems.map(item => (
                            <BsCongeladoRow
                                key={item.key}
                                item={item}
                                editEntry={edits[item.key]}
                                onEditChange={handleEditChange}
                                onApplySuggestion={handleApplySuggestion}
                            />
                        ))
                    )}
                </div>

                {/* Prompt PIN Supervisor si es Cajero */}
                {showPinPrompt && (
                    <div className="p-4 bg-amber-500/10 border-t border-amber-500/30 flex items-center justify-between gap-3 animate-fadeIn">
                        <div className="flex items-center gap-2">
                            <ShieldCheck size={20} className="text-amber-600 dark:text-amber-400 shrink-0" />
                            <p className="text-xs font-bold text-amber-800 dark:text-amber-200">
                                Requiere Clave PIN de Supervisor para actualizar inventario:
                            </p>
                        </div>
                        <input
                            type="password"
                            maxLength={8}
                            value={supervisorPin}
                            onChange={(e) => setSupervisorPin(e.target.value)}
                            placeholder="PIN..."
                            className="w-28 px-3 py-1.5 text-xs font-bold bg-white dark:bg-slate-800 border border-amber-500 rounded-xl focus:outline-none text-center"
                            autoFocus
                        />
                    </div>
                )}

                {/* Footer Modal */}
                <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between gap-3">
                    <p className="text-xs font-bold text-slate-400">
                        {modifiedCount === 0 ? 'Sin cambios pendientes' : `${modifiedCount} precio(s) modificado(s)`}
                    </p>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-xs transition-colors cursor-pointer"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleConfirmSave}
                            disabled={isSubmitting}
                            className="px-5 py-2 rounded-xl bg-brand hover:bg-brand-dark text-white dark:text-slate-950 font-black text-xs shadow-md shadow-brand/20 flex items-center gap-2 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                        >
                            {isSubmitting ? (
                                <RefreshCw size={14} className="animate-spin" />
                            ) : (
                                <Check size={14} strokeWidth={3} />
                            )}
                            <span>{modifiedCount > 0 ? `Guardar ${modifiedCount} Cambios` : 'Listo'}</span>
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
}
