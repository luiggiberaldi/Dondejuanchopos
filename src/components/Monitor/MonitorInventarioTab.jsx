import React from 'react';

export default function MonitorInventarioTab({ ChevronLeft, ChevronRight, Clock, Hash, MinusCircle, Package, Pencil, Plus, PlusCircle, Search, Sparkles, Trash2, X, bcvRate, calculatePricing, cancelAllCloudCmds, categories, cloudPendingCmds, currentPageInventario, effectiveRate, filterStockInventario, filteredProducts, formatBs, hasPendingFor, inventoryMetrics, paginatedProducts, pendingStockDelta, queueInventoryChange, searchTermInventario, setCurrentPageInventario, setEditingCombo, setFilterStockInventario, setRemoteDeleteTarget, setRemoteEditingProduct, setSearchTermInventario, setShowCloudPendingModal, setShowComboModal, setShowRemoteForm, setStockAdjustProduct, toTitleCase, totalPagesInventario, triggerHaptic }) {
    return (
                    <div className="space-y-6 animate-fade-in">
                        {/* Fila de Resumen de Inventario */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                            {/* Total Productos */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Total Artículos</span>
                                <div className="flex items-end justify-between mt-1">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-slate-800 dark:text-white tabular-nums leading-none">
                                        {inventoryMetrics.count}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-bold">{inventoryMetrics.totalQty} unds</span>
                                </div>
                            </div>

                            {/* Valorización Costo */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Valor Inventario (Costo)</span>
                                <div className="flex items-end justify-between mt-1">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-slate-800 dark:text-white tabular-nums leading-none">
                                        ${inventoryMetrics.totalCost.toFixed(2)}
                                    </span>
                                </div>
                            </div>

                            {/* Valorización Venta */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Valor Estimado (Venta)</span>
                                <div className="flex items-end justify-between mt-1">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-slate-800 dark:text-white tabular-nums leading-none">
                                        ${inventoryMetrics.totalRetail.toFixed(2)}
                                    </span>
                                </div>
                            </div>

                            {/* Ganancia Potencial */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Ganancia en Stock</span>
                                <div className="flex items-end justify-between mt-1">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-blue-600 dark:text-blue-400 tabular-nums leading-none">
                                        ${inventoryMetrics.expectedProfit.toFixed(2)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Banner de Comandos Subidos Pendientes de Aplicar por la Caja */}
                        {cloudPendingCmds.length > 0 && (
                            <div className="bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-purple-500/10 border border-amber-300/70 dark:border-amber-700/60 p-3.5 sm:p-4 rounded-3xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-xs animate-fade-in">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-black shrink-0">
                                        <Clock size={20} className="animate-pulse" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h4 className="text-xs sm:text-sm font-black text-slate-800 dark:text-white">
                                                {cloudPendingCmds.length} cambio{cloudPendingCmds.length !== 1 ? 's' : ''} subido{cloudPendingCmds.length !== 1 ? 's' : ''} a la nube
                                            </h4>
                                            <span className="text-[9.5px] font-black uppercase px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200">
                                                En espera de la caja
                                            </span>
                                        </div>
                                        <p className="text-[10.5px] text-slate-500 dark:text-slate-400 font-medium mt-0.5 truncate">
                                            Se aplicarán automáticamente apenas la caja principal se conecte. Puedes anularlos si lo deseas.
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        onClick={() => { triggerHaptic?.(); setShowCloudPendingModal(true); }}
                                        className="flex-1 sm:flex-none px-3.5 py-2.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-black text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-2xs cursor-pointer"
                                    >
                                        Ver lista ({cloudPendingCmds.length})
                                    </button>
                                    <button
                                        onClick={() => { triggerHaptic?.(); cancelAllCloudCmds(); }}
                                        className="flex-1 sm:flex-none px-3.5 py-2.5 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-black uppercase tracking-wider shadow-md shadow-rose-500/25 transition-all active:scale-95 cursor-pointer"
                                    >
                                        Anular Todos 🚫
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Barra de Filtro y Búsqueda */}
                        <div className="bg-white dark:bg-slate-900 p-3.5 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col md:flex-row gap-3 sm:gap-4 items-stretch md:items-center justify-between">
                            {/* Top row on mobile: Botones de Acción (Producto / Combo) + Input de Búsqueda */}
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        onClick={() => { triggerHaptic?.(); setRemoteEditingProduct(null); setShowRemoteForm(true); }}
                                        className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2.5 rounded-2xl bg-brand hover:bg-brand-dark text-white text-[10px] sm:text-xs font-black uppercase tracking-wider shadow-md shadow-brand/20 transition-all active:scale-95 cursor-pointer"
                                        title="Crear un nuevo producto individual"
                                    >
                                        <Plus size={14} strokeWidth={3} /> Producto
                                    </button>
                                    <button
                                        onClick={() => { triggerHaptic?.(); setEditingCombo(null); setShowComboModal(true); }}
                                        className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2.5 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-[10px] sm:text-xs font-black uppercase tracking-wider shadow-md shadow-purple-500/25 transition-all active:scale-95 cursor-pointer"
                                        title="Crear un nuevo combo promocional o modular"
                                    >
                                        <Sparkles size={14} /> Combo
                                    </button>
                                </div>
                                {/* Input de Búsqueda */}
                                <div className="relative flex-1">
                                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-450">
                                        <Search size={14} />
                                    </span>
                                    <input
                                        type="text"
                                        placeholder="Buscar producto por nombre o código..."
                                        value={searchTermInventario}
                                        onChange={(e) => setSearchTermInventario(e.target.value)}
                                        className="w-full pl-10 pr-8 py-2.5 text-xs rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500/70 transition-colors"
                                    />
                                    {searchTermInventario && (
                                        <button 
                                            onClick={() => setSearchTermInventario('')}
                                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-650"
                                        >
                                            <X size={14} />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Filtro de Segmentación de Stock - Scrollable horizontalmente en móvil */}
                            <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-2xl border border-slate-200/60 dark:border-slate-850 overflow-x-auto w-full md:w-auto shrink-0 shadow-inner custom-scrollbar">
                                <button
                                    onClick={() => { triggerHaptic?.(); setFilterStockInventario('todos'); }}
                                    className={`px-3 py-1.5 text-[10px] sm:text-xs font-black rounded-xl transition-all whitespace-nowrap ${
                                        filterStockInventario === 'todos'
                                            ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm'
                                            : 'text-slate-450 hover:text-slate-650 dark:hover:text-slate-350'
                                    }`}
                                >
                                    Todos ({inventoryMetrics.count})
                                </button>
                                <button
                                    onClick={() => { triggerHaptic?.(); setFilterStockInventario('bajo'); }}
                                    className={`px-3 py-1.5 text-[10px] sm:text-xs font-black rounded-xl transition-all flex items-center gap-1 whitespace-nowrap ${
                                        filterStockInventario === 'bajo'
                                            ? 'bg-amber-500 text-white shadow-sm'
                                            : 'text-amber-600 dark:text-amber-400 hover:text-amber-700'
                                    }`}
                                >
                                    Bajo Stock ({inventoryMetrics.lowStockCount})
                                </button>
                                <button
                                    onClick={() => { triggerHaptic?.(); setFilterStockInventario('agotado'); }}
                                    className={`px-3 py-1.5 text-[10px] sm:text-xs font-black rounded-xl transition-all flex items-center gap-1 whitespace-nowrap ${
                                        filterStockInventario === 'agotado'
                                            ? 'bg-rose-500 text-white shadow-sm'
                                            : 'text-rose-600 dark:text-rose-400 hover:text-rose-700'
                                    }`}
                                >
                                    Agotados ({inventoryMetrics.outOfStockCount})
                                </button>
                            </div>
                        </div>

                        {/* Listado de Productos (Fichas separadas e independientes con borde y margen claro) */}
                        <div>
                            {filteredProducts.length === 0 ? (
                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 py-16 text-center text-slate-400 flex flex-col items-center justify-center space-y-3 shadow-sm">
                                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 text-slate-300 dark:text-slate-600 rounded-full">
                                        <Package size={36} />
                                    </div>
                                    <div className="space-y-0.5">
                                        <p className="text-xs font-black text-slate-700 dark:text-slate-200">No se encontraron productos</p>
                                        <p className="text-[10px] text-slate-450">Intenta buscando con otro término o cambiando los filtros.</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-3.5 sm:space-y-4">
                                    {paginatedProducts.map((p) => {
                                        const stock = p.stock || 0;
                                        const minStock = p.minStock || 5;
                                        const isAgotado = stock <= 0;
                                        const isBajo = !isAgotado && stock <= minStock;
                                        const itemCost = p._effectiveCost ?? (p.costUsd || p.costPrice || 0);
                                        const profitUsd = Math.max(0, p.priceUsd - itemCost);
                                        const profitPct = p.priceUsd > 0 ? Math.round((profitUsd / p.priceUsd) * 100) : 0;
                                        const isComboProd = p.isCombo || p.type === 'combo' || p._isCombo;

                                        return (
                                            <div
                                                key={p.id}
                                                className="bg-white dark:bg-slate-900 rounded-3xl border-2 border-slate-200/90 dark:border-slate-800 p-4 sm:p-5 shadow-sm hover:shadow-md hover:border-brand/40 dark:hover:border-brand/40 transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative overflow-hidden group pl-5 sm:pl-6"
                                            >
                                                {/* Borde acentuado izquierdo para inicio de ficha claro */}
                                                <div className={`absolute top-0 left-0 bottom-0 w-2 ${
                                                    isAgotado
                                                        ? 'bg-rose-500'
                                                        : isBajo
                                                            ? 'bg-amber-500'
                                                            : 'bg-emerald-500'
                                                }`} />

                                                {/* Izquierda: Info de Producto */}
                                                <div className="flex-1 min-w-0 space-y-1.5">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <h4 className="text-sm sm:text-base font-black text-slate-900 dark:text-white uppercase leading-snug tracking-tight">{p.name}</h4>
                                                        <span className={`text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-lg shadow-2xs ${
                                                            isAgotado
                                                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                                                                : isBajo
                                                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                                                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                                        }`}>
                                                            {isAgotado ? 'Agotado' : isBajo ? 'Bajo Stock' : 'Disponible'}
                                                        </span>
                                                        {p.sellByBox && (
                                                            <span className="text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                                                📦 Caja{p.boxUnits ? ` ×${p.boxUnits}` : ''}
                                                            </span>
                                                        )}
                                                        {p.sellByHalfBox && (
                                                            <span className="text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                                                                ½ Caja{p.halfBoxUnits ? ` ×${p.halfBoxUnits}` : ''}
                                                            </span>
                                                        )}
                                                        {p._isRecentlyConfirmed && (
                                                            <span className="inline-flex items-center gap-1 text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700 animate-in fade-in zoom-in-95 duration-200 shadow-2xs">
                                                                <span>✓ Confirmado</span>
                                                            </span>
                                                        )}
                                                        {p._isInFlight && !p._isRecentlyConfirmed && (
                                                            <span className="inline-flex items-center gap-1.5 text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-lg bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-200 border border-blue-300 dark:border-blue-700 animate-pulse transition-all shadow-2xs">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 animate-ping" />
                                                                <span className="hidden sm:inline">⏳ Sincronizando con caja...</span>
                                                                <span className="sm:hidden">⏳ Sincronizando</span>
                                                            </span>
                                                        )}
                                                        {(p._isLocalPending || p._isQueuedNew || p._isQueuedEdit || hasPendingFor(p.id)) && !p._isInFlight && !p._isRecentlyConfirmed && (
                                                            <span className="inline-flex items-center gap-1.5 text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-lg bg-amber-100/90 text-amber-800 dark:bg-amber-950/80 dark:text-amber-200 border border-amber-300/80 dark:border-amber-700 transition-all shadow-2xs">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                                                                <span className="hidden sm:inline">⏳ En cola local (Sin subir)</span>
                                                                <span className="sm:hidden">⏳ En cola local</span>
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 font-bold flex-wrap">
                                                        {p.barcode && (
                                                            <span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md text-[11px]">
                                                                <Hash size={12} className="text-slate-400" /> {p.barcode}
                                                            </span>
                                                        )}
                                                        <span>Categoría: <strong className="text-slate-700 dark:text-slate-200">{
                                                            (categories || []).find(c => c.id === p.category)?.label || toTitleCase(p.category || 'Varios')
                                                        }</strong></span>
                                                    </div>
                                                </div>

                                                {/* Derecha: Valores y Stock (Responsivo: apilado en móvil, horizontal en desktop) */}
                                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between lg:justify-end gap-3 sm:gap-5 pt-3 lg:pt-0 border-t border-slate-100 dark:border-slate-800 lg:border-t-0 shrink-0">
                                                    {/* Costo, Venta, Margen */}
                                                    <div className="grid grid-cols-3 gap-3 sm:gap-5 text-left sm:text-right bg-slate-50 dark:bg-slate-950/80 p-3 lg:p-2.5 rounded-2xl border border-slate-200/60 dark:border-slate-800">
                                                        {/* Costo */}
                                                        <div>
                                                            <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-black tracking-wider block mb-0.5">Costo</span>
                                                            <span className="font-outfit text-sm sm:text-base font-black text-slate-700 dark:text-slate-200 tabular-nums">${itemCost.toFixed(2)}</span>
                                                        </div>
                                                        {/* Venta */}
                                                        <div>
                                                            <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-black tracking-wider block mb-0.5">Venta (USD/Bs)</span>
                                                            <span className="font-outfit text-base sm:text-lg font-black text-emerald-600 dark:text-emerald-400 tabular-nums block">${p.priceUsd.toFixed(2)}</span>
                                                            <span className="font-outfit text-xs font-bold text-slate-600 dark:text-slate-300 block tabular-nums leading-tight mt-0.5">
                                                                {(() => {
                                                                    const { unitPriceBs } = calculatePricing(p, effectiveRate, bcvRate);
                                                                    return unitPriceBs > 0 ? `${formatBs(unitPriceBs)} Bs` : 'N/D';
                                                                })()}
                                                            </span>
                                                        </div>
                                                        {/* Ganancia */}
                                                        <div>
                                                            <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-black tracking-wider block mb-0.5">Ganancia</span>
                                                            <span className="font-outfit text-sm sm:text-base font-black text-blue-600 dark:text-blue-400 tabular-nums block">${profitUsd.toFixed(2)}</span>
                                                            <span className="text-[10px] text-blue-500 dark:text-blue-300 block font-extrabold leading-none mt-0.5">+{profitPct}%</span>
                                                        </div>
                                                    </div>

                                                    {/* Controles de Stock y Acciones */}
                                                    <div className="flex items-center justify-between sm:justify-end gap-3">
                                                        {/* Botones +/- y Badge de Stock */}
                                                        {isComboProd ? (
                                                            <div 
                                                                title="El stock de los combos es dinámico y se calcula automáticamente en función del stock disponible de sus insumos componentes."
                                                                className="relative px-3 py-2 rounded-2xl border border-purple-200/80 bg-purple-50/80 dark:bg-purple-950/50 dark:border-purple-900/60 text-purple-700 dark:text-purple-300 shadow-2xs flex items-center gap-2 cursor-help"
                                                            >
                                                                <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                                                                <div>
                                                                    <span className="text-[9px] uppercase font-black block leading-none mb-0.5 opacity-90">
                                                                        Combo • Auto
                                                                    </span>
                                                                    <span className="font-outfit text-sm font-black tabular-nums leading-none">
                                                                        {stock} u <span className="text-[9px] font-bold opacity-75">(Dinámico)</span>
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-1.5">
                                                                <button
                                                                    onClick={() => { triggerHaptic?.(); queueInventoryChange('adjust_stock', p.id, { delta: -1 }); }}
                                                                    title="Restar 1 unidad (en cola)"
                                                                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-rose-600 hover:border-rose-300 dark:hover:text-rose-400 shadow-2xs transition-all active:scale-90 cursor-pointer"
                                                                >
                                                                    <MinusCircle size={16} />
                                                                </button>
                                                                <button
                                                                    onClick={() => { triggerHaptic?.(); setStockAdjustProduct(p); }}
                                                                    title="Toca para ingresar stock (+40, -10) o fijar cantidad exacta"
                                                                    className={`relative min-w-[85px] sm:min-w-[95px] text-center py-2 px-2.5 rounded-2xl border-2 transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-xs ${
                                                                        isAgotado
                                                                            ? 'bg-rose-50 border-rose-300 text-rose-700 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300 hover:border-rose-400'
                                                                            : isBajo
                                                                                ? 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300 hover:border-amber-400'
                                                                                : 'bg-white border-slate-200 text-slate-800 dark:bg-slate-850 dark:border-slate-700 dark:text-slate-100 hover:border-emerald-400 hover:bg-emerald-50/30'
                                                                    }`}
                                                                >
                                                                    <span className="text-[9px] uppercase font-black block leading-none mb-1 text-slate-500 dark:text-slate-400 flex items-center justify-center gap-0.5">
                                                                        Stock <Pencil size={8} />
                                                                    </span>
                                                                    <span className="font-outfit text-sm font-black tabular-nums leading-none">
                                                                        {p.isWeight ? `${stock.toFixed(3)} Kg` : `${stock} u`}
                                                                    </span>
                                                                    {p.sellByBox && p.boxUnits > 0 && !p.isWeight && (
                                                                        <span className="text-[8px] font-bold block leading-none mt-1 text-slate-500 dark:text-slate-400 truncate">
                                                                            ≈ {(stock / p.boxUnits).toFixed(1)} cj
                                                                        </span>
                                                                    )}
                                                                    {pendingStockDelta(p.id) !== 0 && (
                                                                        <span className={`absolute -top-2 -right-2 px-2 py-0.5 rounded-full text-[9px] font-black text-white shadow-md ${pendingStockDelta(p.id) > 0 ? 'bg-emerald-600' : 'bg-rose-600'}`}>
                                                                            {pendingStockDelta(p.id) > 0 ? '+' : ''}{pendingStockDelta(p.id)}
                                                                        </span>
                                                                    )}
                                                                </button>
                                                                <button
                                                                    onClick={() => { triggerHaptic?.(); queueInventoryChange('adjust_stock', p.id, { delta: 1 }); }}
                                                                    title="Sumar 1 unidad (en cola)"
                                                                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-emerald-600 hover:border-emerald-300 dark:hover:text-emerald-400 shadow-2xs transition-all active:scale-90 cursor-pointer"
                                                                >
                                                                    <PlusCircle size={16} />
                                                                </button>
                                                            </div>
                                                        )}

                                                        {/* Botones Editar / Eliminar horizontales */}
                                                        <div className="flex items-center gap-2 ml-1">
                                                            {isComboProd ? (
                                                                <button
                                                                    onClick={() => { triggerHaptic?.(); setEditingCombo(p); setShowComboModal(true); }}
                                                                    title="Editar combo (en cola)"
                                                                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 flex items-center justify-center text-purple-600 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/60 shadow-2xs transition-all active:scale-90 cursor-pointer"
                                                                >
                                                                    <Pencil size={15} />
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    onClick={() => { triggerHaptic?.(); setRemoteEditingProduct(p); setShowRemoteForm(true); }}
                                                                    title="Editar producto (en cola)"
                                                                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-brand hover:border-brand/40 shadow-2xs transition-all active:scale-90 cursor-pointer"
                                                                >
                                                                    <Pencil size={15} />
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => { triggerHaptic?.(); setRemoteDeleteTarget(p); }}
                                                                title="Eliminar (en cola)"
                                                                className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-rose-600 hover:border-rose-300 dark:hover:text-rose-400 shadow-2xs transition-all active:scale-90 cursor-pointer"
                                                            >
                                                                <Trash2 size={15} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Controles de Paginación */}
                        {totalPagesInventario > 1 && (
                            <div className="flex items-center justify-between bg-white dark:bg-slate-900 px-4 py-3 sm:px-6 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm mt-4">
                                <button
                                    onClick={() => {
                                        if (currentPageInventario > 1) {
                                            triggerHaptic?.();
                                            setCurrentPageInventario(prev => prev - 1);
                                        }
                                    }}
                                    disabled={currentPageInventario === 1}
                                    className="p-2 rounded-xl text-slate-500 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-slate-800 dark:hover:text-emerald-450 border border-slate-200 dark:border-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors duration-150"
                                >
                                    <ChevronLeft size={16} />
                                </button>

                                <span className="text-xs font-black text-slate-500 dark:text-slate-400">
                                    Página {currentPageInventario} de {totalPagesInventario}
                                    <span className="text-[10px] text-slate-450 font-medium ml-2">
                                        ({filteredProducts.length} productos)
                                    </span>
                                </span>

                                <button
                                    onClick={() => {
                                        if (currentPageInventario < totalPagesInventario) {
                                            triggerHaptic?.();
                                            setCurrentPageInventario(prev => prev + 1);
                                        }
                                    }}
                                    disabled={currentPageInventario === totalPagesInventario}
                                    className="p-2 rounded-xl text-slate-500 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-slate-800 dark:hover:text-emerald-450 border border-slate-200 dark:border-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors duration-150"
                                >
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        )}
                    </div>
    );
}
