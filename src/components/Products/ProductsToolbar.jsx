import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Store, Plus, Trash2, Pencil, Search, LayoutGrid, List, Percent, CheckSquare, Gift, Boxes, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { CATEGORY_COLORS, getCategoryIcon } from '../../config/categories';

const ProductsToolbar = ({
    products,
    categories,
    activeCategory,
    searchTerm,
    viewMode,
    selectedIds,
    lowStockCount,
    isCajero,
    categoryScrollRef,
    // Handlers
    handleSetSearchTerm,
    handleSetActiveCategory,
    toggleViewMode,
    setSelectedIds,
    setIsModalOpen,
    setIsComboModalOpen,
    setIsBulkPriceOpen,
    setIsDeleteAllModalOpen,
    setIsCategoryManagerOpen,
    setIsStockBatchOpen,
    triggerHaptic,
    onSelectAllToast,
}) => {
    const [showLeftFade, setShowLeftFade] = useState(false);
    const [showManageMenu, setShowManageMenu] = useState(false);
    const menuRef = useRef(null);

    const handleScroll = (e) => {
        setShowLeftFade(e.target.scrollLeft > 4);
    };

    // Wheel → scroll horizontal en el carril de categorías sin advertencia de evento pasivo
    useEffect(() => {
        const el = categoryScrollRef?.current;
        if (!el) return;
        const handler = (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                el.scrollLeft += e.deltaY;
            }
        };
        el.addEventListener('wheel', handler, { passive: false });
        return () => el.removeEventListener('wheel', handler);
    }, [categoryScrollRef]);

    // Cerrar menú de gestión al hacer clic fuera
    useEffect(() => {
        if (!showManageMenu) return;
        const handler = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setShowManageMenu(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showManageMenu]);

    // Filtrar categoría duplicada "Todos"
    const filteredCategories = useMemo(() => {
        return categories.filter(cat => 
            cat.id.toLowerCase() !== 'todos' && 
            cat.label.toLowerCase() !== 'todos'
        );
    }, [categories]);

    // Helper to get count of products in a category
    const getCategoryProductCount = (catId) => {
        if (catId === 'todos') return products.length;
        return products.filter(p => p.category === catId).length;
    };

    const areAllSelected = products.length > 0 && selectedIds.size === products.length;
    const isBajoStockActive = activeCategory === 'bajo-stock';

    return (
        <div className="shrink-0 mb-4 p-4 bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur-md border border-slate-200/80 dark:border-slate-800/80 rounded-2xl shadow-sm space-y-3.5 transition-all duration-300">
            {/* Row 1: Title & Stats + Search + Actions & Toggle */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                {/* Title & Stats */}
                <div className="flex items-center gap-2 min-w-0">
                    <Store size={22} className="text-brand shrink-0 animate-pulse" />
                    <h2 className="text-lg font-black text-slate-800 dark:text-white tracking-tight truncate">
                        Inventario
                    </h2>
                    <span className="text-xs font-extrabold bg-brand/10 text-brand px-2.5 py-0.5 rounded-full shrink-0">
                        {products.length} uds
                    </span>
                </div>

                {/* Search Bar (Centered/flexible, max-width on desktop) */}
                <div className="relative flex-1 lg:max-w-md xl:max-w-lg">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Buscar producto por nombre o código..."
                        value={searchTerm}
                        onChange={(e) => handleSetSearchTerm(e.target.value)}
                        className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl py-2 pl-10 pr-4 text-xs text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand shadow-inner transition-all duration-200"
                    />
                </div>

                {/* Actions & Toggle */}
                <div className="flex items-center justify-end gap-2 shrink-0">
                    {/* Botón de Gestión / Lotes (Dropdown) */}
                    {products.length > 0 && !isCajero && (
                        <div className="relative" ref={menuRef}>
                            <button
                                onClick={() => { triggerHaptic && triggerHaptic(); setShowManageMenu(!showManageMenu); }}
                                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl border transition-all active:scale-95 cursor-pointer ${
                                    showManageMenu 
                                        ? 'bg-brand/10 border-brand text-brand shadow-sm' 
                                        : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-850'
                                }`}
                                title="Acciones y Ajustes por Lote"
                            >
                                <SlidersHorizontal size={14} strokeWidth={2.5} />
                                <span>Gestión</span>
                                <ChevronDown size={12} className={`transition-transform duration-200 ${showManageMenu ? 'rotate-180' : ''}`} />
                            </button>

                            {/* Dropdown Popover */}
                            {showManageMenu && (
                                <div className="absolute right-0 mt-2 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-lg py-1.5 z-30 animate-in fade-in slide-in-from-top-2 duration-150">
                                    <button
                                        onClick={() => { triggerHaptic && triggerHaptic(); setIsStockBatchOpen(true); setShowManageMenu(false); }}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold text-slate-700 dark:text-slate-350 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
                                    >
                                        <Boxes size={14} className="text-slate-400" />
                                        <span>Ajuste por Lote</span>
                                    </button>
                                    <button
                                        onClick={() => { triggerHaptic && triggerHaptic(); setIsBulkPriceOpen(true); setShowManageMenu(false); }}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold text-slate-700 dark:text-slate-355 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
                                    >
                                        <Percent size={14} className="text-slate-400" />
                                        <span>Ajuste de Precios</span>
                                    </button>
                                    <div className="h-px bg-slate-150 dark:bg-slate-800 my-1" />
                                    <button
                                        onClick={() => { triggerHaptic && triggerHaptic(); setIsDeleteAllModalOpen(true); setShowManageMenu(false); }}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                                    >
                                        <Trash2 size={14} className="text-red-500" />
                                        <span>Borrar Todo</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Botones de Creación */}
                    {!isCajero && (
                        <>
                            <button
                                onClick={() => { triggerHaptic && triggerHaptic(); setIsComboModalOpen(true); }}
                                className="flex items-center gap-1.5 px-3.5 py-2 bg-violet-100 hover:bg-violet-200 dark:bg-violet-950/40 text-violet-750 dark:text-violet-400 border border-violet-200/50 dark:border-violet-900/30 rounded-xl transition-all active:scale-95 font-bold text-xs cursor-pointer shadow-sm"
                                title="Crear Combo"
                            >
                                <Gift size={14} strokeWidth={2.5} />
                                <span>Combo</span>
                            </button>
                            <button
                                onClick={() => { triggerHaptic && triggerHaptic(); setIsModalOpen(true); }}
                                className="flex items-center gap-1.5 px-3.5 py-2 bg-brand hover:bg-brand-dark text-white rounded-xl transition-all active:scale-95 font-bold text-xs cursor-pointer shadow-sm hover:shadow-brand/20"
                                title="Agregar Producto"
                            >
                                <Plus size={14} strokeWidth={2.5} />
                                <span>Nuevo</span>
                            </button>
                        </>
                    )}

                    {/* Selector de vista */}
                    <button
                        onClick={toggleViewMode}
                        className="p-2 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-brand hover:border-brand-light transition-all active:scale-95 cursor-pointer shadow-sm"
                        title={viewMode === 'grid' ? 'Cambiar a vista lista' : 'Cambiar a vista cuadrícula'}
                    >
                        {viewMode === 'grid' ? <List size={14} strokeWidth={2.5} /> : <LayoutGrid size={14} strokeWidth={2.5} />}
                    </button>
                </div>
            </div>

            {/* Row 2: Select All & Low Stock Toggles */}
            <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                <button
                    onClick={() => {
                        triggerHaptic && triggerHaptic();
                        if (areAllSelected) {
                            setSelectedIds(new Set());
                        } else {
                            setSelectedIds(new Set(products.map(p => p.id)));
                            onSelectAllToast && onSelectAllToast();
                        }
                    }}
                    className={`text-[10px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 border ${
                        areAllSelected
                            ? 'bg-brand text-white border-transparent shadow-sm'
                            : 'bg-brand/10 hover:bg-brand/25 text-brand border-brand/20'
                    }`}
                >
                    <CheckSquare size={12} strokeWidth={2.5} />
                    <span>Seleccionar todo</span>
                </button>
                
                {lowStockCount > 0 && (
                    <button
                        onClick={() => {
                            triggerHaptic && triggerHaptic();
                            if (isBajoStockActive) {
                                handleSetActiveCategory('todos');
                            } else {
                                handleSetActiveCategory('bajo-stock');
                            }
                        }}
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1.5 cursor-pointer border transition-all active:scale-95 ${
                            isBajoStockActive
                                ? 'bg-amber-500 text-white border-transparent shadow-sm animate-pulse'
                                : 'bg-amber-50 dark:bg-amber-900/15 hover:bg-amber-100 dark:hover:bg-amber-900/25 text-amber-600 dark:text-amber-400 border-amber-200/50 dark:border-amber-800/30'
                        }`}
                    >
                        <span className="relative flex h-2 w-2">
                            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                                isBajoStockActive ? 'bg-white' : 'bg-amber-400'
                            }`}></span>
                            <span className={`relative inline-flex rounded-full h-2 w-2 ${
                                isBajoStockActive ? 'bg-white' : 'bg-amber-500'
                            }`}></span>
                        </span>
                        <span>{lowStockCount} bajo stock</span>
                    </button>
                )}
            </div>

            {/* Row 3: Category Filter Pills — horizontal scroll with left/right fade */}
            <div className="relative w-full py-0.5 pr-8">
                <div 
                    ref={categoryScrollRef}
                    className="flex gap-1.5 overflow-x-auto py-1 pl-1 pr-10 scrollbar-hide scroll-smooth"
                    onScroll={handleScroll}
                >
                    {/* Pestaña estática para la categoría 'Todos' */}
                    <button
                        onClick={() => { handleSetActiveCategory('todos'); triggerHaptic && triggerHaptic(); }}
                        className={`shrink-0 px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all border flex items-center gap-1.5 cursor-pointer ${
                            activeCategory === 'todos'
                                ? 'bg-brand text-white border-transparent shadow-sm font-extrabold scale-102'
                                : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 active:scale-95 shadow-sm'
                        }`}
                    >
                        <span> Todos </span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                            activeCategory === 'todos' 
                                ? 'bg-white/20 text-white' 
                                : 'bg-slate-100 dark:bg-slate-850 text-slate-400 dark:text-slate-500'
                        }`}>
                            {getCategoryProductCount('todos')}
                        </span>
                    </button>

                    {filteredCategories.map(cat => {
                        const count = getCategoryProductCount(cat.id);
                        const isActive = activeCategory === cat.id;
                        const catColorClass = CATEGORY_COLORS[cat.color] || 'bg-brand text-white border-brand';
                        const CatIcon = getCategoryIcon(cat.id, cat.label);
                        
                        return (
                            <button
                                key={cat.id}
                                onClick={() => { handleSetActiveCategory(cat.id); triggerHaptic && triggerHaptic(); }}
                                className={`shrink-0 px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all border flex items-center gap-1.5 cursor-pointer ${
                                    isActive
                                        ? `${catColorClass} shadow-sm border-transparent font-extrabold scale-102`
                                        : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 active:scale-95 shadow-sm'
                                }`}
                            >
                                <CatIcon size={12} strokeWidth={isActive ? 2.5 : 2} className="shrink-0" />
                                <span> {cat.label} </span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                                    isActive 
                                        ? 'bg-black/10 dark:bg-white/10' 
                                        : 'bg-slate-100 dark:bg-slate-850 text-slate-400 dark:text-slate-500'
                                }`}>
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                    {/* Spacer to prevent clipping by the fade overlay and Pencil button */}
                    <div className="shrink-0 w-10 h-px" />
                </div>

                {/* Edit Categories Icon Button (integrated transparently) */}
                <button
                    onClick={() => { triggerHaptic && triggerHaptic(); setIsCategoryManagerOpen(true); }}
                    className="absolute right-0 top-1/2 -translate-y-1/2 p-2 rounded-xl bg-slate-100/80 hover:bg-slate-200 dark:bg-slate-950/80 dark:hover:bg-slate-850 text-slate-500 dark:text-slate-400 border border-slate-200/50 dark:border-slate-800/50 backdrop-blur-sm shadow-sm transition-all active:scale-95 flex items-center justify-center z-10 cursor-pointer"
                    title="Gestionar Categorías"
                >
                    <Pencil size={11} strokeWidth={2.5} />
                </button>

                {/* Left fade indicator for scroll (appears only when scrolled to the right) */}
                {showLeftFade && (
                    <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-slate-50 dark:from-slate-950 to-transparent z-10 animate-in fade-in duration-200" />
                )}

                {/* Right fade indicator for scroll */}
                <div className="pointer-events-none absolute right-7 top-0 bottom-0 w-6 bg-gradient-to-l from-slate-50 dark:from-slate-950 to-transparent z-10" />
            </div>
        </div>
    );
};

export default ProductsToolbar;
