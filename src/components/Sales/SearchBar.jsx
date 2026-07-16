import { forwardRef } from 'react';
import { Search, Mic, Package, X, Box, Tag } from 'lucide-react';
import { BODEGA_CATEGORIES, CATEGORY_ICONS, CATEGORY_COLORS } from '../../config/categories';
import { formatCop, getCop, getUsd } from '../../utils/calculatorUtils';

const formatBs = (n) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const SearchBar = forwardRef(function SearchBar({
    searchTerm,
    onSearchChange,
    onKeyDown,
    onPasteBarcode,
    searchResults,
    selectedIndex,
    setSelectedIndex,
    effectiveRate,
    addToCart,
    isRecording,
    isProcessingAudio,
    startRecording,
    stopRecording,
    // Popups
    hierarchyPending,
    setHierarchyPending,
    weightPending,
    setWeightPending,
    // COP
    copEnabled,
    copPrimary,
    tasaCop,
}, ref) {
    return (
        <div className="relative">
            <Search size={20} className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
                ref={ref}
                type="text"
                value={searchTerm}
                onChange={e => onSearchChange(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={(e) => {
                    const pastedData = e.clipboardData.getData('Text').trim();
                    if (pastedData) {
                        onPasteBarcode?.(pastedData);
                    }
                }}
                placeholder="Buscar producto..."
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl sm:rounded-2xl py-3 pl-10 sm:pl-12 pr-14 sm:pr-20 text-slate-800 dark:text-white font-medium outline-none focus:ring-2 focus:ring-emerald-500/50 shadow-inner text-sm sm:text-base transition-all" />

            <div className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 flex items-center pr-1 gap-0.5">
                {searchTerm && (
                    <button onClick={() => { onSearchChange(''); ref.current?.focus(); }} className="text-slate-400 hover:text-slate-600 p-1.5 transition-colors">
                        <X size={18} />
                    </button>
                )}
                <button
                    onPointerDown={(e) => { e.preventDefault(); startRecording(); }}
                    onPointerUp={(e) => { e.preventDefault(); stopRecording(); }}
                    onPointerLeave={(e) => { if (isRecording) stopRecording(); }}
                    // Prevenir el menú contextual en móvil al mantener presionado
                    onContextMenu={(e) => e.preventDefault()}
                    className={`p-1.5 rounded-full transition-all flex items-center justify-center select-none ${isRecording
                        ? 'bg-red-100 text-red-500 shadow-inner animate-pulse scale-110'
                        : isProcessingAudio
                            ? 'bg-amber-100 text-amber-500'
                            : 'text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30'
                        }`}
                    title={isRecording ? "Mantén presionado y habla" : "Mantén presionado para hablar"}
                >
                    {isProcessingAudio ? (
                        <div className="w-[18px] h-[18px] border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                    ) : (
                        <Mic size={18} className={isRecording ? 'animate-bounce' : ''} />
                    )}
                </button>
            </div>

            {/* Search Dropdown */}
            {searchResults.length > 0 && (
                <div className="absolute top-full mt-2 left-0 right-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-20 overflow-hidden">
                    {searchResults.map((p, index) => {
                        const isLowStock = (p.stock ?? 0) <= (p.lowStockAlert ?? 5) && (p.stock ?? 0) >= 0;
                        const isOutOfStock = (p.stock ?? 0) === 0;
                        const catInfo = BODEGA_CATEGORIES.find(c => c.id === p.category);
                        const catColor = catInfo ? CATEGORY_COLORS[catInfo.color] : null;
                        const CatIcon = catInfo ? CATEGORY_ICONS[catInfo.id] : null;
                        const isSelected = index === selectedIndex;
                        return (
                            <button
                                key={p.id}
                                onClick={() => addToCart(p)}
                                onMouseEnter={() => setSelectedIndex(index)}
                                className={`w-full flex items-center gap-3 px-3 py-2.5 border-b border-slate-50 dark:border-slate-800/50 last:border-0 transition-all active:scale-[0.98]
                                    ${isSelected
                                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-l-4 border-l-emerald-500'
                                        : 'bg-transparent border-l-4 border-l-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                    }
                                    ${isOutOfStock ? 'opacity-50' : ''}`}
                            >
                                <div className="w-10 h-10 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden">
                                    {p.image
                                        ? <img src={p.image} className="w-full h-full object-contain" alt={p.name} />
                                        : CatIcon
                                            ? <CatIcon size={20} className="text-slate-400" />
                                            : <Package size={16} className="text-slate-400" />
                                    }
                                </div>
                                <div className="flex-1 min-w-0 text-left">
                                    <p className={`text-sm font-bold truncate leading-tight ${isSelected ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-100'}`}>
                                        {p.name}
                                    </p>
                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                        {catInfo && catInfo.id !== 'otros' && catInfo.id !== 'todos' && catColor && (
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${catColor}`}>
                                                {catInfo.label}
                                            </span>
                                        )}
                                        <span className={`text-[10px] font-medium flex items-center gap-1
                                            ${isOutOfStock ? 'text-red-500' : isLowStock ? 'text-amber-500' : 'text-slate-400'}`}>
                                            {isLowStock && !isOutOfStock && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />}
                                            {isOutOfStock ? 'Sin stock' : `Stock: ${p.stock ?? 0}`}
                                        </span>
                                    </div>
                                    {(p.barcode || (p.sellByBox && p.boxBarcode) || (p.sellByHalfBox && p.halfBoxBarcode)) && (
                                        <div className="flex gap-2 text-[9px] text-slate-400 dark:text-slate-500 font-bold mt-1 select-all">
                                            {p.barcode && <span>U: {p.barcode}</span>}
                                            {p.sellByBox && p.boxBarcode && <span>Cj: {p.boxBarcode}</span>}
                                            {p.sellByHalfBox && p.halfBoxBarcode && <span>½ Cj: {p.halfBoxBarcode}</span>}
                                        </div>
                                    )}
                                </div>
                                <div className="text-right shrink-0">
                                    {copEnabled && copPrimary && tasaCop > 0 ? (
                                        <>
                                            <p className="text-sm font-black text-amber-600 dark:text-amber-400">
                                                {formatCop(getCop(p, tasaCop))} COP
                                            </p>
                                            <p className="text-[10px] font-medium text-slate-400">
                                                ${getUsd(p, tasaCop).toFixed(2)}
                                            </p>
                                        </>
                                    ) : (
                                        <>
                                            <p className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                                                ${getUsd(p, tasaCop).toFixed(2)}
                                            </p>
                                            <p className="text-[10px] font-medium text-slate-400">
                                                {copEnabled && tasaCop > 0 ? `${formatCop(getCop(p, tasaCop))} COP` : `${formatBs(p.priceUsdt * effectiveRate)} Bs`}
                                            </p>
                                        </>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                    <div className="bg-slate-50 dark:bg-slate-950 p-2 text-center border-t border-slate-100 dark:border-slate-800">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center justify-center gap-2">
                            Navega con flechas <span className="px-1 bg-slate-200 dark:bg-slate-800 rounded">↓</span><span className="px-1 bg-slate-200 dark:bg-slate-800 rounded">↑</span> y presiona <span className="px-1 bg-slate-200 dark:bg-slate-800 rounded">ENTER ↵</span>
                        </span>
                    </div>
                </div>
            )}

            {/* ─── POPUP JERARQUÍA: Formatos de Venta ─── */}
            {hierarchyPending && (
                <div className="absolute top-full mt-2 left-0 right-0 z-30 bg-white dark:bg-slate-900 border-2 border-surface-300 dark:border-surface-800 rounded-2xl shadow-2xl shadow-primary/10 overflow-hidden">
                    <div className="p-3 bg-brand-light dark:bg-surface-800/20 border-b border-surface-200 dark:border-surface-800">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs font-black text-brand-dark dark:text-brand uppercase tracking-wider">Selecciona Formato de Venta</p>
                                <p className="text-[11px] text-brand/70 dark:text-brand/50 font-medium mt-0.5">{hierarchyPending.name}</p>
                            </div>
                            <button onClick={() => setHierarchyPending(null)} className="p-1 text-brand hover:text-brand-dark"><X size={16} /></button>
                        </div>
                    </div>
                    <div className={`grid gap-3 p-3 ${
                        (hierarchyPending.sellByBox && hierarchyPending.sellByHalfBox) ? 'grid-cols-3' : (hierarchyPending.sellByBox || hierarchyPending.sellByHalfBox) ? 'grid-cols-2' : 'grid-cols-1'
                    }`}>
                        {/* 1. Unidad */}
                        <button onClick={() => addToCart(hierarchyPending, null, 'unit')}
                            className="flex flex-col items-center justify-between gap-2 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border-2 border-emerald-250 dark:border-emerald-900/60 hover:border-emerald-500 hover:bg-emerald-100 dark:hover:bg-emerald-950/40 transition-all active:scale-95 text-center">
                            <Tag size={20} className="text-emerald-600 dark:text-emerald-400" />
                            <span className="text-[10px] font-black text-emerald-700 dark:text-emerald-300 uppercase">Unidad</span>
                            <div className="flex flex-col">
                                <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">${hierarchyPending.priceUsd?.toFixed(2)}</span>
                                <span className="text-[9px] font-bold text-slate-400">
                                    {hierarchyPending.priceBsManual ? `${Number(hierarchyPending.priceBsManual).toFixed(2)} Bs` : `${(hierarchyPending.priceUsd * effectiveRate).toFixed(2)} Bs`}
                                </span>
                            </div>
                        </button>

                        {/* 2. Caja */}
                        {hierarchyPending.sellByBox && (
                            <button onClick={() => addToCart(hierarchyPending, null, 'box')}
                                className="flex flex-col items-center justify-between gap-2 p-3.5 rounded-xl bg-[#193275]/5 dark:bg-[#193275]/20 border-2 border-[#193275]/15 hover:border-[#193275] hover:bg-[#193275]/10 transition-all active:scale-95 text-center">
                                <Package size={20} className="text-[#193275] dark:text-brand" />
                                <span className="text-[10px] font-black text-[#193275] dark:text-brand uppercase">Caja ({hierarchyPending.boxUnits} Uds)</span>
                                <div className="flex flex-col">
                                    <span className="text-xs font-black text-[#193275] dark:text-brand">${hierarchyPending.boxPriceUsd?.toFixed(2)}</span>
                                    <span className="text-[9px] font-bold text-slate-450 dark:text-slate-400">
                                        {hierarchyPending.boxPriceBs ? `${Number(hierarchyPending.boxPriceBs).toFixed(2)} Bs` : `${(hierarchyPending.boxPriceUsd * effectiveRate).toFixed(2)} Bs`}
                                    </span>
                                </div>
                            </button>
                        )}

                        {/* 3. Media Caja */}
                        {hierarchyPending.sellByHalfBox && (
                            <button onClick={() => addToCart(hierarchyPending, null, 'halfBox')}
                                className="flex flex-col items-center justify-between gap-2 p-3.5 rounded-xl bg-purple-50 dark:bg-purple-950/20 border-2 border-purple-250 dark:border-purple-900/60 hover:border-purple-500 hover:bg-purple-100 dark:hover:bg-purple-950/40 transition-all active:scale-95 text-center">
                                <Package size={20} className="text-purple-600 dark:text-purple-400" />
                                <span className="text-[10px] font-black text-purple-700 dark:text-purple-300 uppercase">½ Caja ({hierarchyPending.halfBoxUnits} Uds)</span>
                                <div className="flex flex-col">
                                    <span className="text-xs font-black text-purple-600 dark:text-purple-400">${hierarchyPending.halfBoxPriceUsd?.toFixed(2)}</span>
                                    <span className="text-[9px] font-bold text-slate-400">
                                        {hierarchyPending.halfBoxPriceBs ? `${Number(hierarchyPending.halfBoxPriceBs).toFixed(2)} Bs` : `${(hierarchyPending.halfBoxPriceUsd * effectiveRate).toFixed(2)} Bs`}
                                    </span>
                                </div>
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* ─── POPUP PESAJE: Kg / Litro ─── */}
            {weightPending && (
                <div className="absolute top-full mt-2 left-0 right-0 z-30 bg-white dark:bg-slate-900 border-2 border-amber-200 dark:border-amber-800 rounded-2xl shadow-2xl shadow-amber-500/10 overflow-hidden">
                    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-800">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs font-black text-amber-700 dark:text-amber-300 uppercase tracking-wider">
                                    ¿Cuántos {weightPending.unit === 'kg' ? 'kilos' : 'litros'}?
                                </p>
                                <p className="text-[11px] text-amber-500/70 dark:text-amber-400/50 font-medium mt-0.5">{weightPending.name} · ${weightPending.priceUsdt?.toFixed(2)}/{weightPending.unit === 'kg' ? 'kg' : 'lt'}</p>
                            </div>
                            <button onClick={() => setWeightPending(null)} className="p-1 text-amber-400 hover:text-amber-600"><X size={16} /></button>
                        </div>
                    </div>
                    <div className="p-3 space-y-3">
                        {/* Botones rápidos */}
                        <div className="grid grid-cols-4 gap-2">
                            {[0.25, 0.5, 1, 2].map(q => (
                                <button key={q} onClick={() => { addToCart(weightPending, q); setWeightPending(null); }}
                                    className="py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm font-black text-amber-700 dark:text-amber-300 hover:bg-amber-100 active:scale-95 transition-all">
                                    {q} {weightPending.unit === 'kg' ? 'kg' : 'lt'}
                                </button>
                            ))}
                        </div>
                        {/* Input manual */}
                        <div className="flex gap-2 items-center">
                            <div className="flex-1 flex items-center bg-amber-50 dark:bg-slate-800 border border-amber-200 dark:border-amber-700 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-amber-500/50 transition-all">
                                <button
                                    type="button"
                                    onClick={() => {
                                        const input = document.getElementById('weight-input');
                                        if (input) {
                                            const currentVal = parseFloat(input.value) || 0;
                                            const step = 0.1;
                                            input.value = Math.max(0.01, parseFloat((currentVal - step).toFixed(3))).toString();
                                        }
                                    }}
                                    className="px-4 py-3 text-amber-600 hover:bg-amber-100/30 active:bg-amber-200/30 transition-colors font-black text-base select-none"
                                >
                                    -
                                </button>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    placeholder="0.00"
                                    id="weight-input"
                                    defaultValue="1.00"
                                    className="flex-1 bg-transparent text-center py-3 font-bold text-slate-700 dark:text-white outline-none text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            const val = parseFloat(e.target.value);
                                            if (val > 0) { addToCart(weightPending, val); setWeightPending(null); }
                                        }
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        const input = document.getElementById('weight-input');
                                        if (input) {
                                            const currentVal = parseFloat(input.value) || 0;
                                            const step = 0.1;
                                            input.value = parseFloat((currentVal + step).toFixed(3)).toString();
                                        }
                                    }}
                                    className="px-4 py-3 text-amber-600 hover:bg-amber-100/30 active:bg-amber-200/30 transition-colors font-black text-base select-none"
                                >
                                    +
                                </button>
                            </div>
                            <button
                                onClick={() => {
                                    const input = document.getElementById('weight-input');
                                    const val = parseFloat(input?.value);
                                    if (val > 0) { addToCart(weightPending, val); setWeightPending(null); }
                                }}
                                className="px-5 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-black text-sm active:scale-95 transition-all shrink-0"
                            >
                                Agregar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

export default SearchBar;
