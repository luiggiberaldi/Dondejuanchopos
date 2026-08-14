import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Search, TrendingUp, TrendingDown, Check, Package, X, AlertTriangle, Minus, Plus, Boxes, Edit3, Zap, Beer, Layers, Sparkles, CheckCircle2 } from 'lucide-react';
import { showToast } from '../Toast';
import { CATEGORY_COLORS } from '../../config/categories';
import { storageService } from '../../utils/storageService';

// Helper para obtener las unidades por empaque/caja registradas en el producto
function getStoredPkgSize(p) {
    if (!p) return 1;
    
    // 1. boxUnits (numérico o string)
    if (p.boxUnits != null) {
        const parsed = parseInt(p.boxUnits, 10);
        if (!isNaN(parsed) && parsed > 1) return parsed;
    }

    // 2. unitsPerPackage (numérico o string)
    if (p.unitsPerPackage != null) {
        const parsed = parseInt(p.unitsPerPackage, 10);
        if (!isNaN(parsed) && parsed > 1) return parsed;
    }

    // 3. purchaseBoxUnits
    if (p.purchaseBoxUnits != null) {
        const parsed = parseInt(p.purchaseBoxUnits, 10);
        if (!isNaN(parsed) && parsed > 1) return parsed;
    }

    // 4. halfBoxUnits (* 2)
    if (p.halfBoxUnits != null) {
        const parsed = parseInt(p.halfBoxUnits, 10);
        if (!isNaN(parsed) && parsed > 1) return parsed * 2;
    }

    // 5. Si la venta por caja está activa pero el valor guardado es <= 1
    if (p.sellByBox || p.sellByHalfBox) {
        const cat = (p.category || '').toLowerCase();
        const name = (p.name || '').toLowerCase();
        if (cat.includes('lata') || name.includes('lata') || cat.includes('tercio') || name.includes('tercio')) {
            return 24;
        }
        return 36;
    }

    return 1;
}

// ─── FILA DEL CATÁLOGO (VISTA GRID CARD) ───
function CatalogRow({ p, maxStock, onTapAdd }) {
    const stock = p.stock ?? 0;
    const lowAlert = p.lowStockAlert ?? 5;
    const isLow = stock <= lowAlert;
    const unitsPerPkg = getStoredPkgSize(p);
    const hasBulk = unitsPerPkg > 1;
    const isBoxProduct = Boolean(
        p?.sellByBox ||
        (p?.boxUnits != null && parseInt(p.boxUnits, 10) > 1) ||
        (p?.purchaseBoxUnits != null && parseInt(p.purchaseBoxUnits, 10) > 1)
    );
    const pkgLabel = isBoxProduct ? 'caja' : 'bulto';

    return (
        <div
            onClick={() => onTapAdd(p.id)}
            className="flex flex-col justify-between p-3 bg-slate-50/70 dark:bg-slate-900/60 hover:bg-white dark:hover:bg-slate-850 border border-slate-200/80 dark:border-slate-800 rounded-2xl cursor-pointer transition-all hover:shadow-md hover:border-brand/40 group active:scale-[0.98] relative overflow-hidden"
        >
            {/* Top row: Image/Category icon + Name */}
            <div className="flex items-start gap-2.5">
                {p.image ? (
                    <img
                        src={p.image}
                        alt={p.name}
                        className="w-9 h-9 rounded-xl object-cover shrink-0 border border-slate-200/60 dark:border-slate-700/60"
                    />
                ) : (
                    <div className="w-9 h-9 rounded-xl bg-slate-200/60 dark:bg-slate-800 flex items-center justify-center shrink-0 text-slate-500 font-bold text-xs">
                        {p.name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                )}

                <div className="min-w-0 flex-1">
                    <p className="text-xs font-black text-slate-800 dark:text-slate-100 truncate group-hover:text-brand transition-colors leading-tight">
                        {p.name}
                    </p>
                    {hasBulk && (
                        <p className="text-[10px] font-extrabold text-brand dark:text-brand-light mt-0.5 flex items-center gap-1">
                            <Package size={11} strokeWidth={2.5} />
                            <span>{unitsPerPkg} uds/{pkgLabel}</span>
                        </p>
                    )}
                </div>
            </div>

            {/* Bottom row: Stock badge + Add button */}
            <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-slate-200/40 dark:border-slate-800/60">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg border ${
                        isLow
                            ? 'bg-amber-100/80 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-300/40 animate-pulse'
                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}>
                        Stock: {stock}
                    </span>
                    {isLow && (
                        <span className="text-[9px] font-black text-rose-500 bg-rose-50 dark:bg-rose-950/30 px-1.5 py-0.5 rounded border border-rose-200/30">
                            Bajo
                        </span>
                    )}
                </div>

                <div className="w-7 h-7 rounded-xl bg-brand/10 dark:bg-brand/20 text-brand flex items-center justify-center group-hover:bg-brand group-hover:text-white transition-all shadow-sm">
                    <Plus size={14} strokeWidth={3} />
                </div>
            </div>
        </div>
    );
}

// ─── FILA EN AJUSTE (VISTA DE CONTROL DE CANTIDAD) ───
function AdjustRow({ p, qty, direction, adjUnit, tempPkgSize, onSetQty, onSetAdjUnit, onSetTempPkgSize }) {
    const stock = p.stock ?? 0;
    const storedUpp = getStoredPkgSize(p);
    const unitsPerPkg = tempPkgSize > 1 ? tempPkgSize : storedUpp;
    const hasBulk = unitsPerPkg > 1;
    const isBoxProduct = Boolean(
        p?.sellByBox ||
        (p?.boxUnits != null && parseInt(p.boxUnits, 10) > 1) ||
        (p?.purchaseBoxUnits != null && parseInt(p.purchaseBoxUnits, 10) > 1)
    );
    const unitTag = isBoxProduct ? 'caja' : 'bulto';
    const unitTagCap = isBoxProduct ? 'Caja' : 'Bulto';
    const unitTagPluralCap = isBoxProduct ? 'Cajas' : 'Bultos';

    const delta = hasBulk && adjUnit === 'lotes' ? qty * unitsPerPkg : qty;
    const newStock = direction === 'ingreso' ? stock + delta : Math.max(0, stock - delta);

    const deltaLabel = hasBulk && adjUnit === 'lotes'
        ? `${direction === 'ingreso' ? '+' : '-'}${qty} ${unitTag}${qty !== 1 ? 's' : ''} (${direction === 'ingreso' ? '+' : '-'}${delta} uds)`
        : `${direction === 'ingreso' ? '+' : '-'}${delta} ud${delta !== 1 ? 's' : ''}`;

    const currentBultos = hasBulk ? Math.floor(stock / unitsPerPkg) : null;
    const inputVal = tempPkgSize > 0 ? tempPkgSize : (storedUpp > 1 ? storedUpp : '');

    // Calcular porcentaje relativo para la barra de progreso
    const maxVal = Math.max(stock, newStock, 1);
    const oldWidth = Math.round((stock / maxVal) * 100);
    const newWidth = Math.round((newStock / maxVal) * 100);

    return (
        <div className="p-3.5 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800/80 space-y-3">
            {/* Header del producto */}
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <h4 className="text-xs font-black text-slate-800 dark:text-slate-100 truncate">{p.name}</h4>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[10px] font-extrabold text-slate-500 dark:text-slate-400">
                            Actual: <strong className="text-slate-700 dark:text-slate-200">{stock} uds</strong>
                            {currentBultos !== null && ` (${currentBultos} ${unitTag}s)`}
                        </span>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${
                            direction === 'ingreso'
                                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200/40'
                                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border-rose-200/40'
                        }`}>
                            {deltaLabel}
                        </span>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => onSetQty(p.id, 0)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                    title="Quitar"
                >
                    <X size={15} strokeWidth={2.5} />
                </button>
            </div>

            {/* Barra de progreso de stock */}
            <div className="space-y-1">
                <div className="flex justify-between text-[9px] font-black text-slate-400 uppercase tracking-wider">
                    <span>Stock previo ({stock})</span>
                    <span className={direction === 'ingreso' ? 'text-emerald-500' : 'text-rose-500'}>
                        Nuevo ({newStock})
                    </span>
                </div>
                <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                    <div
                        style={{ width: `${Math.min(oldWidth, newWidth)}%` }}
                        className="h-full bg-slate-400 dark:bg-slate-600 transition-all duration-300"
                    />
                    {direction === 'ingreso' ? (
                        <div
                            style={{ width: `${Math.max(0, newWidth - oldWidth)}%` }}
                            className="h-full bg-emerald-500 animate-pulse transition-all duration-300"
                        />
                    ) : (
                        <div
                            style={{ width: `${Math.max(0, oldWidth - newWidth)}%` }}
                            className="h-full bg-rose-500 animate-pulse transition-all duration-300"
                        />
                    )}
                </div>
            </div>

            {/* Modos de Unidad: Cards prominentes con iconos vectoriales */}
            {hasBulk && (
                <div className="grid grid-cols-2 gap-2">
                    <button
                        type="button"
                        onClick={() => onSetAdjUnit(p.id, 'lotes')}
                        className={`p-2.5 rounded-xl border text-left transition-all flex items-center gap-2.5 ${
                            adjUnit === 'lotes'
                                ? 'bg-brand/10 dark:bg-brand/20 border-brand text-brand dark:text-brand-light shadow-sm font-black'
                                : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300'
                        }`}
                    >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            adjUnit === 'lotes' ? 'bg-brand text-white' : 'bg-slate-200/70 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                        }`}>
                            <Package size={16} strokeWidth={2.5} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-[9px] font-black uppercase tracking-wider opacity-70">Por {unitTagCap}s</p>
                            <p className="text-xs font-extrabold truncate">1 {unitTag} = {unitsPerPkg} uds</p>
                        </div>
                    </button>

                    <button
                        type="button"
                        onClick={() => onSetAdjUnit(p.id, 'uds')}
                        className={`p-2.5 rounded-xl border text-left transition-all flex items-center gap-2.5 ${
                            adjUnit === 'uds'
                                ? 'bg-slate-800 dark:bg-slate-200 border-slate-800 dark:border-slate-200 text-white dark:text-slate-900 shadow-sm font-black'
                                : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300'
                        }`}
                    >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            adjUnit === 'uds' ? 'bg-white text-slate-900 dark:bg-slate-900 dark:text-white' : 'bg-slate-200/70 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                        }`}>
                            <Beer size={16} strokeWidth={2.5} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-[9px] font-black uppercase tracking-wider opacity-70">Unidades Sueltas</p>
                            <p className="text-xs font-extrabold truncate">1 unidad individual</p>
                        </div>
                    </button>
                </div>
            )}

            {/* Controles de cantidad + accesos rápidos */}
            <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
                {/* Selector numérico principal */}
                <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                    <button
                        type="button"
                        onClick={() => onSetQty(p.id, Math.max(1, qty - 1))}
                        className="w-8 h-8 rounded-lg bg-white dark:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 shadow-sm active:scale-95 transition-all"
                    >
                        <Minus size={14} strokeWidth={3} />
                    </button>
                    <input
                        type="number"
                        min="1"
                        value={qty || ''}
                        onChange={(e) => onSetQty(p.id, e.target.value)}
                        className="w-12 text-center text-sm font-black bg-transparent border-none outline-none focus:ring-0 text-slate-800 dark:text-white"
                    />
                    <button
                        type="button"
                        onClick={() => onSetQty(p.id, qty + 1)}
                        className="w-8 h-8 rounded-lg bg-white dark:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 shadow-sm active:scale-95 transition-all"
                    >
                        <Plus size={14} strokeWidth={3} />
                    </button>
                </div>

                {/* Chips de incremento rápido (+1, +5, +10) */}
                <div className="flex items-center gap-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase mr-1 flex items-center gap-0.5">
                        <Zap size={10} className="text-amber-500 fill-amber-500" />
                        Rápido:
                    </span>
                    {[1, 5, 10].map(inc => (
                        <button
                            key={inc}
                            type="button"
                            onClick={() => onSetQty(p.id, qty + inc)}
                            className="px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-brand/10 hover:text-brand dark:hover:bg-brand/20 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-black border border-slate-200 dark:border-slate-700 transition-all active:scale-95"
                        >
                            +{inc}
                        </button>
                    ))}
                </div>

                {/* Campo Uds/caja no intrusivo */}
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold ml-auto">
                    <Edit3 size={11} className="text-slate-400" />
                    <span>Uds/{unitTag}:</span>
                    <input
                        type="number"
                        min="1"
                        value={inputVal}
                        placeholder="—"
                        onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            onSetTempPkgSize(p.id, val);
                        }}
                        className="w-10 h-6 text-center text-xs font-black bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md outline-none focus:ring-1 focus:ring-brand text-slate-700 dark:text-slate-200"
                    />
                </div>
            </div>
        </div>
    );
}

export default function StockBatchModal({
    isOpen,
    onClose,
    products,
    categories,
    adjustStock,
    setProducts,
    triggerHaptic,
}) {
    const [direction, setDirection] = useState('ingreso');
    const [search, setSearch] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('todos');
    const [adjustments, setAdjustments] = useState({});
    const [adjustmentUnits, setAdjustmentUnits] = useState({});
    const [tempPackageSizes, setTempPackageSizes] = useState({});
    const [note, setNote] = useState('');
    const [activeTab, setActiveTab] = useState('catalog');
    const [isApplying, setIsApplying] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const categoryScrollRef = useRef(null);
    const listRef = useRef(null);

    const allProducts = useMemo(() =>
        (products || []).filter(p => !p.isCombo),
    [products]);

    const getCategoryProductCount = (catId) => {
        if (catId === 'todos') return allProducts.length;
        return allProducts.filter(p => p.category === catId).length;
    };

    const selectedProducts = useMemo(() =>
        allProducts.filter(p => (adjustments[p.id] || 0) > 0)
            .sort((a, b) => a.name.localeCompare(b.name)),
    [allProducts, adjustments]);

    const getEffectiveUpp = useCallback((p) => {
        if (!p) return 1;
        const temp = tempPackageSizes[p.id] || 0;
        if (temp > 1) return temp;
        return getStoredPkgSize(p);
    }, [tempPackageSizes]);

    const activeAdjustments = useMemo(() =>
        Object.entries(adjustments)
            .filter(([, qty]) => qty > 0)
            .map(([productId, qty]) => {
                const p = allProducts.find(x => x.id === productId);
                const unitsPerPkg = getEffectiveUpp(p);
                const adjUnit = adjustmentUnits[productId] || (unitsPerPkg > 1 ? 'lotes' : 'uds');
                const deltaUnits = (unitsPerPkg > 1 && adjUnit === 'lotes') ? qty * unitsPerPkg : qty;
                return { productId, qty, adjUnit, unitsPerPkg, deltaUnits, p };
            }),
    [adjustments, adjustmentUnits, allProducts, getEffectiveUpp]);

    const totalItems = activeAdjustments.reduce((sum, { deltaUnits }) => sum + deltaUnits, 0);

    const unselectedProducts = useMemo(() => {
        const term = search.toLowerCase().trim();
        return allProducts
            .filter(p => (adjustments[p.id] || 0) === 0)
            .filter(p => {
                const matchesCat = selectedCategory === 'todos' || p.category === selectedCategory;
                const matchesSearch = !term || p.name.toLowerCase().includes(term);
                return matchesCat && matchesSearch;
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [allProducts, search, selectedCategory, adjustments]);

    const setQty = (productId, val) => {
        const num = Math.max(0, parseInt(val) || 0);
        setAdjustments(prev => ({ ...prev, [productId]: num }));
    };

    const setAdjUnit = useCallback((productId, unit) => {
        setAdjustmentUnits(prev => ({ ...prev, [productId]: unit }));
    }, []);

    const setTempPkgSize = useCallback((productId, size) => {
        setTempPackageSizes(prev => ({ ...prev, [productId]: size }));
    }, []);

    const tapAdd = useCallback((productId) => {
        triggerHaptic && triggerHaptic();
        const p = allProducts.find(x => x.id === productId);
        const temp = tempPackageSizes[productId] || 0;
        const stored = getStoredPkgSize(p);
        const unitsPerPkg = temp > 1 ? temp : stored;
        if (unitsPerPkg > 1) {
            setAdjustmentUnits(prev => ({ ...prev, [productId]: 'lotes' }));
        }
        setAdjustments(prev => ({ ...prev, [productId]: (prev[productId] || 0) + 1 }));
    }, [triggerHaptic, allProducts, tempPackageSizes]);

    const needsNote = direction === 'egreso' && !note.trim();

    const handleApply = async () => {
        if (activeAdjustments.length === 0) return;
        if (needsNote) {
            showToast('Escribe un motivo para el egreso', 'error');
            triggerHaptic && triggerHaptic();
            return;
        }
        if (!showConfirm) {
            setShowConfirm(true);
            return;
        }
        setIsApplying(true);
        triggerHaptic && triggerHaptic();

        try {
            for (const { productId, deltaUnits } of activeAdjustments) {
                const delta = direction === 'ingreso' ? deltaUnits : -deltaUnits;
                await adjustStock(productId, delta, {
                    motivo: direction === 'egreso'
                        ? note.trim()
                        : 'Ingreso lote'
                });
            }

            // Persistir permanentemente los tamanos de empaque editados inline
            const pkgEntries = Object.entries(tempPackageSizes).filter(([, size]) => size > 1);
            if (pkgEntries.length > 0 && setProducts) {
                setProducts(prev =>
                    prev.map(p => {
                        const newSize = tempPackageSizes[p.id];
                        if (newSize && newSize > 1) {
                            return {
                                ...p,
                                unitsPerPackage: newSize,
                                ...(p.sellByBox ? { boxUnits: newSize } : {})
                            };
                        }
                        return p;
                    })
                );
            }

            const actionLabel = direction === 'ingreso' ? 'Ingreso' : 'Egreso';
            showToast(
                `✓ ${actionLabel} completado: ${direction === 'ingreso' ? '+' : '-'}${totalItems} uds en ${activeAdjustments.length} prod`,
                'success'
            );

            setAdjustments({});
            setAdjustmentUnits({});
            setTempPackageSizes({});
            setNote('');
            setSearch('');
            setSelectedCategory('todos');
            setActiveTab('catalog');
            setShowConfirm(false);
            onClose();
        } catch (e) {
            showToast('Error al aplicar ajuste: ' + e.message, 'error');
        } finally {
            setIsApplying(false);
        }
    };

    const handleClose = () => {
        setAdjustments({});
        setAdjustmentUnits({});
        setTempPackageSizes({});
        setSearch('');
        setNote('');
        setSelectedCategory('todos');
        setActiveTab('catalog');
        setShowConfirm(false);
        onClose();
    };

    const maxStock = useMemo(() =>
        Math.max(1, ...allProducts.map(p => p.stock ?? 0)),
    [allProducts]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="absolute inset-0" onClick={handleClose} />

            <div className="relative bg-white dark:bg-slate-900 w-full max-w-md md:max-w-2xl lg:max-w-3xl rounded-t-3xl sm:rounded-3xl shadow-2xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200 flex flex-col max-h-[92vh] sm:max-h-[85vh]">

                {/* Header */}
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50 rounded-t-3xl shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-brand-light dark:bg-slate-800 text-brand">
                            <Boxes size={16} strokeWidth={2.5} />
                        </div>
                        <h3 className="text-lg font-black text-slate-800 dark:text-white tracking-tight">
                            {showConfirm ? 'Confirmar Ajuste' : 'Ajuste de Inventario'}
                        </h3>
                    </div>
                    <button onClick={handleClose} className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors active:scale-90">
                        <X size={20} />
                    </button>
                </div>

                {showConfirm ? (
                    <div className="p-5 space-y-4 overflow-y-auto flex-1 scrollbar-hide">
                        <div className={`p-4 rounded-2xl border ${
                            direction === 'ingreso'
                                ? 'bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-200/50 dark:border-emerald-800/30'
                                : 'bg-red-50/50 dark:bg-red-900/10 border-red-200/50 dark:border-red-800/30'
                        }`}>
                            <p className={`text-xs font-black uppercase tracking-widest mb-3.5 ${
                                direction === 'ingreso' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'
                            }`}>
                                {direction === 'ingreso' ? 'Ingreso' : 'Egreso'} masivo - {activeAdjustments.length} prod - {totalItems} uds totales
                            </p>
                            <div className="space-y-2.5 max-h-[38vh] overflow-y-auto scrollbar-hide pr-1">
                                {activeAdjustments.map(({ productId, qty, adjUnit, unitsPerPkg, deltaUnits, p }) => {
                                    const stock = p?.stock ?? 0;
                                    const newStock = direction === 'ingreso' ? stock + deltaUnits : Math.max(0, stock - deltaUnits);
                                    const isBulkMode = unitsPerPkg > 1 && adjUnit === 'lotes';
                                    const hasInlineEdit = (tempPackageSizes[productId] || 0) > 1;

                                    return (
                                        <div key={productId} className="py-2 border-b border-slate-100 dark:border-slate-800/40">
                                            <div className="flex items-start justify-between gap-3">
                                                <span className="font-bold text-xs text-slate-650 dark:text-slate-300 truncate flex-1">{p?.name || '?'}</span>
                                                <span className="font-black text-xs shrink-0 text-slate-700 dark:text-slate-350">
                                                    {stock} <span className={direction === 'ingreso' ? 'text-emerald-600 dark:text-emerald-400 font-black' : 'text-rose-600 dark:text-rose-450 font-black'}>→ {newStock}</span>
                                                </span>
                                            </div>
                                            <p className={`text-[10px] font-black mt-0.5 ${direction === 'ingreso' ? 'text-emerald-700 dark:text-emerald-350' : 'text-rose-700 dark:text-rose-350'}`}>
                                                {isBulkMode
                                                    ? `${direction === 'ingreso' ? '+' : '-'}${qty} bulto${qty !== 1 ? 's' : ''} x ${unitsPerPkg} uds = ${direction === 'ingreso' ? '+' : '-'}${deltaUnits} uds`
                                                    : `${direction === 'ingreso' ? '+' : '-'}${deltaUnits} ud${deltaUnits !== 1 ? 's' : ''}`
                                                }
                                            </p>
                                            {hasInlineEdit && (
                                                <p className="text-[9px] text-brand dark:text-brand-light font-black mt-0.5">
                                                    Tamano de empaque guardado: {tempPackageSizes[productId]} uds/bulto
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            {note.trim() && (
                                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                                    <p className="text-xs text-slate-500 dark:text-slate-400"><span className="font-bold">Motivo:</span> {note}</p>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => setShowConfirm(false)}
                                className="flex-1 py-3.5 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-white font-bold rounded-xl active:scale-[0.98] transition-all text-sm border border-slate-200 dark:border-slate-700"
                            >
                                Volver
                            </button>
                            <button
                                type="button"
                                onClick={handleApply}
                                disabled={isApplying}
                                className={`flex-[2] py-3.5 text-white font-bold rounded-xl active:scale-[0.98] transition-all text-sm shadow-md disabled:opacity-50 disabled:cursor-not-allowed ${
                                    direction === 'ingreso'
                                        ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20'
                                        : 'bg-red-500 hover:bg-red-600 shadow-red-500/20'
                                }`}
                            >
                                {isApplying ? 'Aplicando...' : `Confirmar ${direction === 'ingreso' ? 'Ingreso' : 'Egreso'}`}
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="p-5 space-y-4 overflow-y-auto flex-1 scrollbar-hide">
                            {/* Direction Toggle */}
                            <div className="flex bg-slate-100 dark:bg-slate-800/80 p-1 rounded-2xl shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setDirection('ingreso')}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold rounded-xl transition-all ${
                                        direction === 'ingreso'
                                            ? 'bg-white dark:bg-slate-900 shadow-md text-emerald-600 dark:text-emerald-400 font-black'
                                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-350'
                                    }`}
                                >
                                    <TrendingUp size={16} strokeWidth={2.5} /> Ingreso
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDirection('egreso')}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold rounded-xl transition-all ${
                                        direction === 'egreso'
                                            ? 'bg-white dark:bg-slate-900 shadow-md text-red-500 font-black'
                                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-350'
                                    }`}
                                >
                                    <TrendingDown size={16} strokeWidth={2.5} /> Egreso
                                </button>
                            </div>

                            {/* Campo de motivo para Egreso - Prominente desde el inicio */}
                            {direction === 'egreso' && (
                                <div className="p-3 bg-red-50/70 dark:bg-red-950/20 border border-red-200 dark:border-red-800/40 rounded-2xl space-y-1.5 animate-in fade-in duration-200">
                                    <label className="text-[11px] font-black text-red-600 dark:text-red-400 flex items-center gap-1.5 uppercase tracking-wider">
                                        <AlertTriangle size={13} /> Motivo del Egreso (Obligatorio)
                                    </label>
                                    <input
                                        type="text"
                                        value={note}
                                        onChange={(e) => setNote(e.target.value)}
                                        placeholder="Ej: Merma, rotura, producto vencido, autoconsumo..."
                                        className="w-full bg-white dark:bg-slate-900 border border-red-200 dark:border-red-800/60 rounded-xl py-2 px-3 text-xs text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-red-500/40 transition-all"
                                    />
                                </div>
                            )}

                            {/* Search Bar */}
                            <div className="relative shrink-0">
                                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-450" />
                                <input
                                    type="text"
                                    placeholder="Buscar producto por nombre..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl py-2.5 pl-10 pr-4 text-xs text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/50 transition-all shadow-sm"
                                />
                            </div>

                            {/* Category Filter Chips */}
                            <div className="relative w-full shrink-0">
                                <div
                                    ref={categoryScrollRef}
                                    className="flex gap-1.5 overflow-x-auto py-1 pl-0.5 pr-2 scrollbar-hide scroll-smooth"
                                >
                                    <button
                                        type="button"
                                        onClick={() => setSelectedCategory('todos')}
                                        className={`shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${
                                            selectedCategory === 'todos'
                                                ? 'bg-brand text-white border-brand shadow-sm font-black'
                                                : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 active:scale-95'
                                        }`}
                                    >
                                        Todos
                                        <span className={`ml-1 text-[9px] ${selectedCategory === 'todos' ? 'opacity-90' : 'text-slate-400'}`}>
                                            - {getCategoryProductCount('todos')}
                                        </span>
                                    </button>

                                    {categories.filter(c => c.id !== 'todos').map(cat => {
                                        const count = getCategoryProductCount(cat.id);
                                        const isActive = selectedCategory === cat.id;
                                        const catColorClass = CATEGORY_COLORS[cat.color] || 'bg-brand text-white border-brand';
                                        return (
                                            <button
                                                key={cat.id}
                                                type="button"
                                                onClick={() => setSelectedCategory(cat.id)}
                                                className={`shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${
                                                    isActive
                                                        ? `${catColorClass} shadow-sm border-transparent font-black`
                                                        : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 active:scale-95'
                                                }`}
                                            >
                                                {cat.label}
                                                <span className={`ml-1 text-[9px] ${isActive ? 'opacity-90' : 'text-slate-450 dark:text-slate-500'}`}>
                                                    - {count}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Navigation Tabs */}
                            <div className="flex border-b border-slate-100 dark:border-slate-800 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('catalog')}
                                    className={`flex-1 pb-2.5 text-xs font-bold transition-all border-b-2 text-center ${
                                        activeTab === 'catalog'
                                            ? 'border-brand text-brand font-black'
                                            : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-650'
                                    }`}
                                >
                                    Catálogo ({unselectedProducts.length})
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('adjusting')}
                                    className={`flex-1 pb-2.5 text-xs font-bold transition-all border-b-2 text-center flex items-center justify-center gap-1.5 ${
                                        activeTab === 'adjusting'
                                            ? 'border-brand text-brand font-black'
                                            : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-650'
                                    }`}
                                >
                                    En ajuste
                                    {selectedProducts.length > 0 && (
                                        <span className={`px-1.5 py-0.5 text-[9px] font-black rounded-full ${
                                            direction === 'ingreso'
                                                ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                                                : 'bg-red-100 dark:bg-red-950 text-red-500'
                                        }`}>
                                            {selectedProducts.length}
                                        </span>
                                    )}
                                </button>
                            </div>

                            {/* Product List Container */}
                            <div ref={listRef} className="max-h-[38vh] min-h-[22vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-2 scrollbar-hide">
                                {activeTab === 'catalog' ? (
                                    unselectedProducts.length === 0 ? (
                                        <div className="py-12 text-center text-xs text-slate-400 font-medium col-span-full">
                                            <Package size={22} className="mx-auto mb-2 opacity-40" />
                                            Sin productos disponibles
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            {unselectedProducts.map(p => (
                                                <CatalogRow
                                                    key={p.id} p={p} maxStock={maxStock}
                                                    onTapAdd={tapAdd}
                                                />
                                            ))}
                                        </div>
                                    )
                                ) : (
                                    selectedProducts.length === 0 ? (
                                        <div className="py-12 text-center text-xs text-slate-400 font-medium">
                                            <Boxes size={22} className="mx-auto mb-2 opacity-40 text-slate-300 dark:text-slate-700" />
                                            No has seleccionado productos
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {selectedProducts.map(p => {
                                                const effUpp = getEffectiveUpp(p);
                                                const defaultUnit = effUpp > 1 ? 'lotes' : 'uds';
                                                const adjUnit = adjustmentUnits[p.id] || defaultUnit;
                                                const tempPkgSize = tempPackageSizes[p.id] || 0;
                                                return (
                                                    <AdjustRow
                                                        key={p.id}
                                                        p={p}
                                                        qty={adjustments[p.id] || 0}
                                                        direction={direction}
                                                        adjUnit={adjUnit}
                                                        tempPkgSize={tempPkgSize}
                                                        onSetQty={setQty}
                                                        onSetAdjUnit={setAdjUnit}
                                                        onSetTempPkgSize={setTempPkgSize}
                                                    />
                                                );
                                            })}
                                        </div>
                                    )
                                )}
                            </div>

                            {/* Nota opcional para ingreso */}
                            {direction === 'ingreso' && activeTab === 'adjusting' && selectedProducts.length > 0 && (
                                <div className="relative shrink-0 animate-in fade-in slide-in-from-bottom-2 duration-150">
                                    <input
                                        type="text"
                                        value={note}
                                        onChange={(e) => setNote(e.target.value)}
                                        placeholder="Nota / motivo del ingreso (opcional)"
                                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl py-2.5 px-4 text-xs text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/50 transition-all"
                                    />
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-4 sm:p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-850/80 rounded-b-3xl shrink-0 space-y-3">
                            {/* Mini-resumen flotante si hay productos en ajuste */}
                            {activeAdjustments.length > 0 && (
                                <div className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/70 rounded-xl flex items-center justify-between gap-3 text-xs shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-150">
                                    <div className="flex items-center gap-2.5 truncate">
                                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${direction === 'ingreso' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/40' : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200/40'}`}>
                                            <Layers size={14} strokeWidth={2.5} />
                                        </div>
                                        <span className="font-black text-slate-800 dark:text-slate-200">
                                            {selectedProducts.length} {selectedProducts.length === 1 ? 'producto' : 'productos'}
                                        </span>
                                        <span className="text-slate-400">·</span>
                                        <span className={`font-black ${direction === 'ingreso' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                            {direction === 'ingreso' ? '+' : '-'}{totalItems} uds totales
                                        </span>
                                    </div>
                                    {activeTab === 'catalog' && (
                                        <button
                                            type="button"
                                            onClick={() => setActiveTab('adjusting')}
                                            className="text-[10px] font-black text-brand hover:underline shrink-0"
                                        >
                                            Ver detalle →
                                        </button>
                                    )}
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={activeTab === 'catalog' && selectedProducts.length > 0 ? () => setActiveTab('adjusting') : handleApply}
                                disabled={activeAdjustments.length === 0}
                                className={`w-full py-3.5 font-bold rounded-xl active:scale-95 transition-all text-sm flex justify-center items-center gap-2 ${
                                    activeAdjustments.length === 0
                                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-200/50 dark:border-slate-700/50'
                                        : direction === 'ingreso'
                                            ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/25'
                                            : 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/25'
                                }`}
                            >
                                {activeAdjustments.length > 0 && <Check size={16} />}
                                {activeAdjustments.length === 0
                                    ? 'Toca productos para agregar'
                                    : activeTab === 'catalog'
                                        ? `Revisar ajuste (${selectedProducts.length} prod - ${totalItems} uds) →`
                                        : `Aplicar ${direction === 'ingreso' ? 'Ingreso' : 'Egreso'} (${totalItems} uds)`
                                }
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
