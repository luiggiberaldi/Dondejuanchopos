import { useState, useEffect } from 'react';
import { Package, Calculator, ChevronDown } from 'lucide-react';
import { BODEGA_CATEGORIES, CATEGORY_ICONS, CATEGORY_COLORS } from '../../config/categories';
import { formatCop, formatBs, getCop, getUsd } from '../../utils/calculatorUtils';

const PAGE_SIZE = 30;

export default function CategoryBar({
    selectedCategory,
    setSelectedCategory,
    filteredByCategory,
    addToCart,
    triggerHaptic,
    searchTerm = '',
    onOpenCustomAmount,
    products = [],
    copEnabled,
    copPrimary,
    tasaCop,
    effectiveRate,
    categories = [],
}) {
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

    // Reset pagination when category changes
    useEffect(() => {
        setVisibleCount(PAGE_SIZE);
    }, [selectedCategory]);

    const visibleProducts = filteredByCategory.slice(0, visibleCount);
    const hasMore = filteredByCategory.length > visibleCount;
    const allowNegativeStock = localStorage.getItem('allow_negative_stock') === 'true';

    // Fallback to static config if no categories passed from context
    const categoryList = categories && categories.length > 0 ? categories : BODEGA_CATEGORIES;

    // Filter categories that have at least one product
    const activeCategories = categoryList.filter(cat => cat.id === 'todos' || products.some(p => p.category === cat.id));

    return (
        <div className={`relative ${searchTerm.length === 0 ? 'lg:flex-1 lg:overflow-hidden lg:flex lg:flex-col lg:min-h-0' : ''}`}>
            {/* Category Chips Container with Mask */}
            <div className="relative horizontal-scroll-mask mb-1">
                <div 
                    className="shrink-0 flex gap-1 overflow-x-auto pb-1.5 pt-1 pl-0.5 pr-12 scrollbar-hide"
                    onWheel={(e) => {
                        if (e.deltaY !== 0) {
                            e.preventDefault();
                            e.currentTarget.scrollLeft += e.deltaY;
                        }
                    }}
                >
                    {/* Monto Libre Button */}
                    <button
                        onClick={() => { triggerHaptic && triggerHaptic(); onOpenCustomAmount && onOpenCustomAmount(); }}
                        className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black transition-all active:scale-95 bg-brand-light dark:bg-surface-800/30 text-brand-dark dark:text-brand border border-surface-300 dark:border-surface-700 hover:bg-brand-light shadow-sm"
                    >
                        <Calculator size={11} />
                        Monto Libre
                    </button>

                    {/* Divider */}
                    <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 my-auto mx-0.5 rounded-full shrink-0" />

                    {/* Show categories with products */}
                    {activeCategories.map(cat => {
                        const isActive = selectedCategory === cat.id;
                        const count = products.filter(p => cat.id === 'todos' ? true : p.category === cat.id).length;
                        const catColorClass = CATEGORY_COLORS[cat.color] || 'bg-emerald-500 text-white';

                        return (
                            <button
                                key={cat.id}
                                onClick={() => { triggerHaptic && triggerHaptic(); setSelectedCategory(isActive && cat.id !== 'todos' ? 'todos' : cat.id); }}
                                className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold transition-all active:scale-95 border ${
                                    isActive
                                        ? `${catColorClass} shadow-sm border-transparent`
                                        : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-emerald-300'
                                }`}
                            >
                                {cat.label}
                                <span className={`text-[8.5px] ${isActive ? 'opacity-90' : 'text-slate-400 dark:text-slate-500'}`}>
                                    · {count}
                                </span>
                            </button>
                        );
                    })}
                    {/* Spacer to prevent clipping on scroll */}
                    <div className="shrink-0 w-10 h-px" />
                </div>
            </div>

            {/* Product Grid */}
            {searchTerm.length === 0 && (
                <div className="flex-1 overflow-y-auto min-h-0 pb-2">
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                        {visibleProducts.map(p => {
                            const isOut = (p.stock ?? 0) <= 0;
                            const isDisabled = isOut && !allowNegativeStock;
                            const CatIcon = CATEGORY_ICONS[p.category] || Package;
                            return (
                                <button
                                    key={p.id}
                                    onClick={() => addToCart(p)}
                                    disabled={isDisabled}
                                    className={`bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-2 flex flex-col items-center text-center transition-all active:scale-95 hover:border-emerald-300 hover:shadow-sm ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''
                                        }`}
                                >
                                    <div className="w-10 h-10 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center mb-1.5 overflow-hidden">
                                        {p.image
                                            ? <img src={p.image} className="w-full h-full object-contain" alt={p.name} />
                                            : <CatIcon size={18} className="text-slate-400" />
                                        }
                                    </div>
                                    <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 leading-tight line-clamp-2 mb-1">{p.name}</p>
                                    <p className={`text-[11px] font-black ${copPrimary ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                        {copPrimary ? `${getCop(p, tasaCop).toLocaleString('es-CO')} COP` : `$${p.priceUsdt?.toFixed(2)}`}
                                    </p>
                                    {copEnabled && tasaCop > 0 && (
                                        <p className="text-[8px] leading-tight mt-0.5">
                                            {copPrimary ? (
                                                <>
                                                    <span className="font-bold text-emerald-600 dark:text-emerald-400">${getUsd(p, tasaCop).toFixed(2)} USD</span>
                                                    <span className="text-slate-300 mx-0.5">|</span>
                                                    <span className="font-bold text-brand dark:text-brand">{formatBs(getUsd(p, tasaCop) * (effectiveRate || 0))} Bs</span>
                                                </>
                                            ) : (
                                                <>
                                                    <span className="font-bold text-amber-600 dark:text-amber-400">{formatCop(getCop(p, tasaCop))} COP</span>
                                                    <span className="text-slate-300 mx-0.5">|</span>
                                                    <span className="font-bold text-brand dark:text-brand">{formatBs(p.priceUsdt * (effectiveRate || 0))} Bs</span>
                                                </>
                                            )}
                                        </p>
                                    )}
                                    <p className="text-[9px] text-slate-400 font-medium">{isOut ? 'Agotado' : `${p.stock ?? 0} disp.`}</p>
                                </button>
                            );
                        })}
                    </div>

                    {/* Load More button */}
                    {hasMore && (
                        <div className="flex justify-center mt-3">
                            <button
                                onClick={() => { triggerHaptic && triggerHaptic(); setVisibleCount(prev => prev + PAGE_SIZE); }}
                                className="flex items-center gap-1.5 px-5 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:border-emerald-400 hover:text-emerald-600 transition-all active:scale-95 shadow-sm"
                            >
                                <ChevronDown size={14} />
                                Cargar Mas ({filteredByCategory.length - visibleCount} restantes)
                            </button>
                        </div>
                    )}

                    {filteredByCategory.length === 0 && (
                        <div className="text-center py-10">
                            <Package size={32} className="mx-auto text-slate-300 dark:text-slate-700 mb-2" />
                            <p className="text-xs text-slate-400 font-medium">Sin productos en esta categoria</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
