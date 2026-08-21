import { useState, useMemo, useEffect } from 'react';
import { Package, Search, Download, Filter, ArrowUpDown, ChevronDown, ChevronUp, Check, X, Calendar, CheckSquare, Square, ChevronLeft, ChevronRight } from 'lucide-react';
import { calculateArticleSalesReport, formatCategoryName } from '../../utils/articleSalesReportProcessor';
import { generateArticleSalesReportPDF } from '../../utils/articleSalesReportPdfGenerator';
import { formatBs, formatUsd } from '../../utils/calculatorUtils';
import { getDateRange, getLocalISODate } from '../../utils/dateHelpers';
import EmptyState from '../EmptyState';

const RANGE_OPTIONS = [
    { id: 'currentShift', label: 'Turno Actual' },
    { id: 'lastShift', label: 'Último Turno' },
    { id: 'today', label: 'Hoy' },
    { id: 'yesterday', label: 'Ayer' },
    { id: 'week', label: 'Esta Semana' },
    { id: 'month', label: 'Este Mes' },
    { id: 'lastMonth', label: 'Mes Anterior' },
    { id: 'custom', label: 'Personalizado' },
];

function formatRangeSummary(fromStr, toStr) {
    if (!fromStr || !toStr) return '';
    try {
        const f = new Date(fromStr + 'T00:00:00');
        const t = new Date(toStr + 'T00:00:00');
        const diffTime = Math.abs(t - f);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        
        const fFormatted = f.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
        const tFormatted = t.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
        
        if (fromStr === toStr) {
            return `Día: ${fFormatted}`;
        }
        return `${fFormatted} — ${tFormatted} (${diffDays} días)`;
    } catch {
        return `${fromStr} al ${toStr}`;
    }
}

export default function ReportsArticleTab({
    salesForStats = [],
    products = [],
    bcvRate = 0,
    triggerHaptic,
    from,
    to,
    artRange,
    setArtRange,
    setArtFrom,
    setArtTo,
}) {
    const [selectedCategories, setSelectedCategories] = useState([]);
    const [selectedArticleIds, setSelectedArticleIds] = useState([]);
    const [search, setSearch] = useState('');
    const [sortField, setSortField] = useState('revenueUsd'); // 'revenueUsd' | 'qty' | 'name'
    const [sortDirection, setSortDirection] = useState('desc');
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
    
    // Paginación
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    // Estado de filtros de categorías (inline y modal bottom sheet)
    const [showCategoryFilterInline, setShowCategoryFilterInline] = useState(false);
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [categoryModalSearch, setCategoryModalSearch] = useState('');

    // Lista única de categorías disponibles (formateadas sin guiones bajos)
    const availableCategories = useMemo(() => {
        const set = new Set();
        (products || []).forEach(p => {
            if (p.category && p.category.trim()) {
                set.add(formatCategoryName(p.category.trim()));
            }
        });
        return Array.from(set).sort();
    }, [products]);

    // Categorías filtradas por la búsqueda interna del modal
    const filteredModalCategories = useMemo(() => {
        if (!categoryModalSearch.trim()) return availableCategories;
        const term = categoryModalSearch.toLowerCase().trim();
        return availableCategories.filter(c => c.toLowerCase().includes(term));
    }, [availableCategories, categoryModalSearch]);

    // Manejador de cambio de rango cuando se usa en Supervisor Mode
    const handleRangeChange = (rangeId) => {
        triggerHaptic && triggerHaptic();
        if (setArtRange) {
            setArtRange(rangeId);
            if (rangeId !== 'custom' && rangeId !== 'currentShift' && rangeId !== 'lastShift' && setArtFrom && setArtTo) {
                const { from: newFrom, to: newTo } = getDateRange(rangeId);
                setArtFrom(newFrom);
                setArtTo(newTo);
            }
        }
    };

    // Calcular reporte con el agregador
    const reportData = useMemo(() => {
        return calculateArticleSalesReport(salesForStats, products, {
            selectedCategories,
            search,
        });
    }, [salesForStats, products, selectedCategories, search]);

    // Filas ordenadas
    const sortedRows = useMemo(() => {
        const rows = [...reportData.rows];
        rows.sort((a, b) => {
            let valA = a[sortField];
            let valB = b[sortField];

            if (typeof valA === 'string') {
                valA = valA.toLowerCase();
                valB = (valB || '').toLowerCase();
                return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }

            return sortDirection === 'asc' ? valA - valB : valB - valA;
        });
        return rows;
    }, [reportData.rows, sortField, sortDirection]);

    // Restablecer la página a 1 cuando cambian los filtros
    useEffect(() => {
        setCurrentPage(1);
    }, [search, selectedCategories, sortField, sortDirection, artRange]);

    // Paginación calculada
    const totalPages = useMemo(() => {
        return Math.max(1, Math.ceil(sortedRows.length / itemsPerPage));
    }, [sortedRows.length, itemsPerPage]);

    const paginatedRows = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return sortedRows.slice(start, start + itemsPerPage);
    }, [sortedRows, currentPage, itemsPerPage]);

    const startIndex = sortedRows.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
    const endIndex = Math.min(currentPage * itemsPerPage, sortedRows.length);

    // Helper de Selección de Artículos
    const toggleArticleSelection = (id) => {
        triggerHaptic && triggerHaptic();
        setSelectedArticleIds(prev => {
            if (prev.includes(id)) {
                return prev.filter(item => item !== id);
            }
            return [...prev, id];
        });
    };

    const isAllSelected = useMemo(() => {
        if (sortedRows.length === 0) return false;
        return sortedRows.every(r => selectedArticleIds.includes(r.id || r.sku));
    }, [sortedRows, selectedArticleIds]);

    const toggleSelectAll = () => {
        triggerHaptic && triggerHaptic();
        if (isAllSelected) {
            setSelectedArticleIds([]);
        } else {
            setSelectedArticleIds(sortedRows.map(r => r.id || r.sku));
        }
    };

    const handleSort = (field) => {
        triggerHaptic && triggerHaptic();
        if (sortField === field) {
            setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortField(field);
            setSortDirection('desc');
        }
    };

    const toggleCategory = (cat) => {
        triggerHaptic && triggerHaptic();
        setSelectedCategories(prev => {
            if (prev.includes(cat)) {
                return prev.filter(c => c !== cat);
            }
            return [...prev, cat];
        });
    };

    const handleExportPDF = async () => {
        triggerHaptic && triggerHaptic();
        setIsGeneratingPdf(true);
        try {
            let rangeTitle = '';
            if (artRange === 'currentShift') rangeTitle = 'Turno Actual (Sesión Activa)';
            else if (artRange === 'lastShift') rangeTitle = 'Último Turno Cerrado';

            await generateArticleSalesReportPDF({
                reportData,
                from,
                to,
                rangeTitle,
                filters: { selectedCategories, search, selectedArticleIds },
                bcvRate,
            });
        } catch (error) {
            console.error('Error generando PDF de artículos:', error);
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    const { totals } = reportData;

    return (
        <div className="space-y-4 animate-in fade-in duration-200">
            {/* Header & Acciones rápidas de la pestaña */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 bg-white dark:bg-surface-900 rounded-2xl p-3 sm:p-4 border border-slate-200 dark:border-surface-800 shadow-sm">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-brand/10 dark:bg-brand/20 text-brand dark:text-brand flex items-center justify-center font-bold shrink-0">
                        <Package size={18} />
                    </div>
                    <div className="min-w-0">
                        <h3 className="font-black text-slate-800 dark:text-white text-sm sm:text-base leading-tight truncate">Reporte de Ventas por Artículo</h3>
                        <p className="text-[11px] text-slate-500 dark:text-surface-400 font-medium truncate mt-0.5">
                            {rowsCountText(totals.itemCount, selectedCategories.length, selectedArticleIds.length)}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 self-stretch sm:self-auto shrink-0">
                    {selectedArticleIds.length > 0 && (
                        <button
                            onClick={() => { triggerHaptic && triggerHaptic(); setSelectedArticleIds([]); }}
                            className="flex-1 sm:flex-initial flex items-center justify-center px-3 py-2 text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/50 rounded-xl hover:bg-rose-100 transition-all active:scale-95 cursor-pointer"
                        >
                            Limpiar ({selectedArticleIds.length})
                        </button>
                    )}

                    <button
                        onClick={handleExportPDF}
                        disabled={isGeneratingPdf || totals.itemCount === 0}
                        className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 bg-brand hover:bg-brand-dark disabled:bg-slate-300 dark:disabled:bg-surface-700 text-white font-black rounded-xl text-xs shadow-sm shadow-brand/20 active:scale-95 transition-all cursor-pointer"
                    >
                        <Download size={14} />
                        <span>{isGeneratingPdf 
                            ? 'Generando...' 
                            : selectedArticleIds.length > 0
                                ? `PDF (${selectedArticleIds.length})`
                                : 'Exportar PDF'}</span>
                    </button>
                </div>
            </div>

            {/* Selector de Rango si se usa desde Supervisor Mode */}
            {setArtRange && (
                <div className="bg-white dark:bg-surface-900 rounded-2xl p-3 sm:p-4 border border-slate-200 dark:border-surface-800 shadow-sm space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                            <Calendar size={14} className="text-brand dark:text-brand" />
                            <span className="text-xs font-black text-slate-700 dark:text-slate-200">Período de Consulta:</span>
                        </div>
                        {artRange === 'currentShift' && (
                            <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 px-2 py-0.5 rounded-lg">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                ⚡ Turno Actual
                            </span>
                        )}
                        {artRange === 'lastShift' && (
                            <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/50 px-2 py-0.5 rounded-lg">
                                🔒 Último Turno
                            </span>
                        )}
                        {artRange === 'custom' && from && to && (
                            <span className="hidden sm:inline-block text-[11px] font-bold text-brand dark:text-brand bg-brand/10 px-2.5 py-0.5 rounded-lg">
                                📅 {formatRangeSummary(from, to)}
                            </span>
                        )}
                    </div>

                    {/* Botones de Selección Rápida de Período (2 Filas Simétricas de 4 Columnas) */}
                    <div className="grid grid-cols-4 gap-1 sm:gap-1.5">
                        {RANGE_OPTIONS.map(opt => (
                            <button
                                key={opt.id}
                                onClick={() => handleRangeChange(opt.id)}
                                className={`px-1 sm:px-2.5 py-2 min-h-[36px] rounded-xl text-[10.5px] sm:text-xs font-bold text-center leading-tight transition-all active:scale-95 cursor-pointer truncate ${
                                    artRange === opt.id
                                        ? 'bg-brand text-white shadow-sm shadow-brand/25 ring-1 ring-brand'
                                        : 'bg-slate-100 dark:bg-surface-800 text-slate-600 dark:text-surface-300 hover:bg-slate-200 dark:hover:bg-surface-700'
                                }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>

                    {/* Panel Desplegable de Fecha Personalizada */}
                    {artRange === 'custom' && setArtFrom && setArtTo && (
                        <div className="pt-3 border-t border-slate-100 dark:border-surface-800 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                            {/* Inputs Desde / Hasta */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                <div className="space-y-1">
                                    <label className="text-[11px] font-bold text-slate-600 dark:text-surface-300 flex items-center gap-1">
                                        <span>Fecha Inicial (Desde):</span>
                                    </label>
                                    <input
                                        type="date"
                                        value={from || ''}
                                        max={to || getLocalISODate()}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (!val) return;
                                            setArtFrom(val);
                                            if (to && val > to) setArtTo(val);
                                        }}
                                        className="w-full px-3 py-2.5 min-h-[44px] bg-slate-50 dark:bg-surface-800 border border-slate-200 dark:border-surface-700 rounded-xl text-xs sm:text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-brand/30 focus:outline-none transition-all"
                                    />
                                </div>

                                <div className="space-y-1">
                                    <label className="text-[11px] font-bold text-slate-600 dark:text-surface-300 flex items-center gap-1">
                                        <span>Fecha Final (Hasta):</span>
                                    </label>
                                    <input
                                        type="date"
                                        value={to || ''}
                                        min={from || ''}
                                        max={getLocalISODate()}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (!val) return;
                                            setArtTo(val);
                                            if (from && val < from) setArtFrom(val);
                                        }}
                                        className="w-full px-3 py-2.5 min-h-[44px] bg-slate-50 dark:bg-surface-800 border border-slate-200 dark:border-surface-700 rounded-xl text-xs sm:text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-brand/30 focus:outline-none transition-all"
                                    />
                                </div>
                            </div>

                            {/* Accesos Rápidos (Presets) */}
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[10px] font-black uppercase text-slate-400 mr-1">Rápidos:</span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            triggerHaptic?.();
                                            const now = new Date();
                                            const past = new Date(now);
                                            past.setDate(past.getDate() - 6);
                                            setArtFrom(getLocalISODate(past));
                                            setArtTo(getLocalISODate(now));
                                        }}
                                        className="px-2.5 py-1.5 text-[10.5px] font-bold rounded-lg bg-brand/10 text-brand dark:text-brand hover:bg-brand/20 transition-all active:scale-95"
                                    >
                                        Últimos 7 días
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            triggerHaptic?.();
                                            const now = new Date();
                                            const past = new Date(now);
                                            past.setDate(past.getDate() - 29);
                                            setArtFrom(getLocalISODate(past));
                                            setArtTo(getLocalISODate(now));
                                        }}
                                        className="px-2.5 py-1.5 text-[10.5px] font-bold rounded-lg bg-brand/10 text-brand dark:text-brand hover:bg-brand/20 transition-all active:scale-95"
                                    >
                                        Últimos 30 días
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            triggerHaptic?.();
                                            const now = new Date();
                                            const start = new Date(now.getFullYear(), 0, 1);
                                            setArtFrom(getLocalISODate(start));
                                            setArtTo(getLocalISODate(now));
                                        }}
                                        className="px-2.5 py-1.5 text-[10.5px] font-bold rounded-lg bg-brand/10 text-brand dark:text-brand hover:bg-brand/20 transition-all active:scale-95"
                                    >
                                        Este Año
                                    </button>
                                </div>

                                {from && to && (
                                    <div className="sm:hidden text-[11px] font-bold text-slate-500 dark:text-surface-400 bg-slate-100 dark:bg-surface-800/80 px-2.5 py-1.5 rounded-lg text-center">
                                        📅 {formatRangeSummary(from, to)}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Panel de Filtros: Búsqueda y Categorías */}
            <div className="bg-white dark:bg-surface-900 rounded-2xl p-3 md:p-4 border border-slate-200 dark:border-surface-800 space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                    {/* Input Búsqueda */}
                    <div className="relative flex-1">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 dark:text-surface-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar por artículo, categoría o SKU..."
                            className="w-full pl-9 pr-8 py-2.5 min-h-[44px] bg-slate-100 dark:bg-surface-800 border border-slate-200 dark:border-surface-700 rounded-xl text-xs sm:text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand/30"
                        />
                        {search && (
                            <button
                                onClick={() => setSearch('')}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-600 dark:text-surface-400"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    {/* Botón Categorías */}
                    <button
                        onClick={() => {
                            triggerHaptic?.();
                            if (window.innerWidth < 640) {
                                setShowCategoryModal(true);
                            } else {
                                setShowCategoryFilterInline(!showCategoryFilterInline);
                            }
                        }}
                        className={`flex items-center justify-center gap-2 px-3.5 py-2.5 min-h-[44px] rounded-xl text-xs font-bold border transition-all ${
                            selectedCategories.length > 0
                                ? 'bg-brand/10 border-brand/40 text-brand dark:text-brand'
                                : 'bg-slate-100 dark:bg-surface-800 border-slate-200 dark:border-surface-700 text-slate-700 dark:text-surface-300'
                        }`}
                    >
                        <Filter size={14} />
                        <span>Categorías {selectedCategories.length > 0 && `(${selectedCategories.length})`}</span>
                        <ChevronDown size={14} className="hidden sm:inline" />
                    </button>
                </div>

                {/* Vista previa de Categorías Seleccionadas */}
                {selectedCategories.length > 0 && (
                    <div className="pt-2 border-t border-slate-100 dark:border-surface-800">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-surface-400">Filtros Activos</span>
                            <button
                                onClick={() => { triggerHaptic?.(); setSelectedCategories([]); }}
                                className="text-[10px] font-bold text-brand hover:underline"
                            >
                                Limpiar todos
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {selectedCategories.map(cat => (
                                <span
                                    key={cat}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-brand text-white shadow-tone-sm"
                                >
                                    {cat}
                                    <button
                                        onClick={() => toggleCategory(cat)}
                                        className="hover:bg-brand-dark rounded-full p-0.5"
                                    >
                                        <X size={12} />
                                    </button>
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Inline Chips solo en Pantallas Medianas/Desktop */}
                {showCategoryFilterInline && (
                    <div className="hidden sm:block pt-2 border-t border-slate-100 dark:border-surface-800">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold uppercase text-slate-600 dark:text-surface-400">Filtrar por Categoría</span>
                            {selectedCategories.length > 0 && (
                                <button
                                    onClick={() => { triggerHaptic?.(); setSelectedCategories([]); }}
                                    className="text-[10px] font-bold text-brand hover:underline"
                                >
                                    Limpiar filtros
                                </button>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto scrollbar-hide pr-1">
                            <button
                                onClick={() => { triggerHaptic?.(); setSelectedCategories([]); }}
                                className={`px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-bold transition-all active:scale-95 flex items-center gap-1 ${
                                    selectedCategories.length === 0
                                        ? 'bg-brand text-white shadow-tone-sm'
                                        : 'bg-slate-100 dark:bg-surface-800 text-slate-600 dark:text-surface-400 hover:bg-slate-200'
                                }`}
                            >
                                Todas
                            </button>
                            {availableCategories.map(cat => {
                                const isSelected = selectedCategories.includes(cat);
                                return (
                                    <button
                                        key={cat}
                                        onClick={() => toggleCategory(cat)}
                                        className={`px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-bold transition-all active:scale-95 flex items-center gap-1 ${
                                            isSelected
                                                ? 'bg-brand text-white shadow-tone-sm'
                                                : 'bg-slate-100 dark:bg-surface-800 text-slate-600 dark:text-surface-400 hover:bg-slate-200 dark:hover:bg-surface-700'
                                        }`}
                                    >
                                        {isSelected && <Check size={12} />}
                                        {cat}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Tarjetas de Resumen Global de los Artículos */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-white dark:bg-surface-900 rounded-2xl p-3 md:p-4 border border-slate-200 dark:border-surface-800 shadow-sm">
                    <p className="text-[10px] font-bold text-slate-600 dark:text-surface-400 uppercase">Artículos Distintos</p>
                    <p className="text-xl md:text-2xl font-outfit font-bold text-slate-900 dark:text-white mt-1">
                        {totals.itemCount}
                    </p>
                </div>
                <div className="bg-white dark:bg-surface-900 rounded-2xl p-3 md:p-4 border border-slate-200 dark:border-surface-800 shadow-sm">
                    <p className="text-[10px] font-bold text-slate-600 dark:text-surface-400 uppercase">Unidades Vendidas</p>
                    <p className="text-xl md:text-2xl font-outfit font-bold text-brand dark:text-brand mt-1">
                        {totals.totalQty} <span className="text-xs font-bold text-slate-600 dark:text-surface-400">uds</span>
                    </p>
                </div>
                <div className="bg-white dark:bg-surface-900 rounded-2xl p-3 md:p-4 border border-slate-200 dark:border-surface-800 shadow-sm">
                    <p className="text-[10px] font-bold text-slate-600 dark:text-surface-400 uppercase">Total Recaudado ($)</p>
                    <p className="text-xl md:text-2xl font-outfit font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                        ${formatUsd(totals.totalRevenueUsd)}
                    </p>
                </div>
                <div className="bg-white dark:bg-surface-900 rounded-2xl p-3 md:p-4 border border-slate-200 dark:border-surface-800 shadow-sm">
                    <p className="text-[10px] font-bold text-slate-600 dark:text-surface-400 uppercase">Total Recaudado (Bs)</p>
                    <p className="text-xl md:text-2xl font-outfit font-bold text-slate-900 dark:text-white mt-1">
                        Bs. {formatBs(totals.totalRevenueUsd * (bcvRate || 1))}
                    </p>
                </div>
            </div>

            {/* Bar de Selección de Lote si existen artículos */}
            {sortedRows.length > 0 && (
                <div className="flex items-center justify-between bg-slate-100 dark:bg-surface-800/80 px-3.5 py-2 rounded-xl border border-slate-200/80 dark:border-surface-700">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={toggleSelectAll}
                            className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:text-brand dark:hover:text-brand transition-colors"
                        >
                            {isAllSelected ? <CheckSquare size={16} className="text-brand" /> : <Square size={16} className="text-slate-400" />}
                            <span>{isAllSelected ? 'Desmarcar Todos' : 'Seleccionar Todos'}</span>
                        </button>
                    </div>
                    {selectedArticleIds.length > 0 && (
                        <span className="text-xs font-bold text-brand dark:text-brand">
                            {selectedArticleIds.length} de {sortedRows.length} seleccionados para PDF
                        </span>
                    )}
                </div>
            )}

            {/* VISTA DE RESULTADOS: Tarjetas en Móvil (sm:hidden) vs Tabla en Desktop (hidden sm:block) */}
            
            {/* 1. MÓVIL: Tarjetas Individuales Táctiles (sm:hidden) */}
            <div className="block sm:hidden space-y-3">
                {paginatedRows.length === 0 ? (
                    <div className="bg-white dark:bg-surface-900 rounded-2xl p-6 border border-slate-200 dark:border-surface-800 text-center">
                        <EmptyState
                            title="Sin artículos registrados"
                            description="No se encontraron ventas para los filtros o fechas seleccionadas."
                        />
                    </div>
                ) : (
                    paginatedRows.map((row, idx) => {
                        const globalIndex = startIndex + idx;
                        const itemKey = row.id || row.sku;
                        const isChecked = selectedArticleIds.includes(itemKey);
                        return (
                            <div
                                key={itemKey || idx}
                                onClick={() => toggleArticleSelection(itemKey)}
                                className={`bg-white dark:bg-surface-900 rounded-2xl p-3.5 border transition-all cursor-pointer shadow-sm space-y-2.5 ${
                                    isChecked 
                                        ? 'border-brand ring-2 ring-brand/20 bg-brand/5 dark:bg-brand/10' 
                                        : 'border-slate-200 dark:border-surface-800'
                                }`}
                            >
                                {/* Cabecera de la Tarjeta */}
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-center gap-2.5">
                                        <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={() => {}} // Handled by parent div
                                            className="w-4 h-4 rounded text-brand border-slate-300 focus:ring-brand accent-brand cursor-pointer shrink-0"
                                        />
                                        <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-surface-800 text-[10px] font-bold text-slate-500 flex items-center justify-center shrink-0">
                                            {globalIndex}
                                        </span>
                                        <div>
                                            <h4 className="font-bold text-slate-900 dark:text-white text-xs leading-snug">
                                                {row.name}
                                            </h4>
                                            <span className="text-[10px] font-mono text-slate-500 dark:text-surface-400">
                                                SKU: {row.sku}
                                            </span>
                                        </div>
                                    </div>
                                    <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-surface-800 text-slate-600 dark:text-surface-300 shrink-0">
                                        {row.category}
                                    </span>
                                </div>

                                {/* Cuerpo: Cantidad y Empaque */}
                                <div className="flex items-center justify-between bg-slate-50 dark:bg-surface-800/60 p-2.5 rounded-xl border border-slate-100 dark:border-surface-700/50">
                                    <div>
                                        <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-surface-400 block">Cantidad Vendida</span>
                                        <span className="text-sm font-black font-outfit text-brand dark:text-brand">{row.qty} uds.</span>
                                    </div>
                                    {row.packInfo?.hasPack && (
                                        <div className="text-right">
                                            <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-surface-400 block">Equivalencia</span>
                                            <span className="text-xs font-bold text-slate-700 dark:text-surface-200">{row.packInfo.text}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Fila Inferior de Métricas */}
                                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100 dark:border-surface-800 text-center">
                                    <div>
                                        <span className="text-[9px] font-bold uppercase text-slate-400 block">P. Promedio</span>
                                        <span className="text-xs font-bold text-slate-700 dark:text-surface-200 font-outfit">${formatUsd(row.avgPriceUsd)}</span>
                                    </div>
                                    <div>
                                        <span className="text-[9px] font-bold uppercase text-slate-400 block">Total Recaudado</span>
                                        <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 font-outfit">${formatUsd(row.revenueUsd)}</span>
                                    </div>
                                    <div>
                                        <span className="text-[9px] font-bold uppercase text-slate-400 block">% Part.</span>
                                        <span className="text-xs font-bold text-slate-600 dark:text-surface-400 font-outfit">{row.share}%</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* 2. DESKTOP: Tabla Tradicional Completa (hidden sm:block) */}
            <div className="hidden sm:block bg-white dark:bg-surface-900 rounded-2xl border border-slate-200 dark:border-surface-800 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                        <thead>
                            <tr className="bg-slate-100 dark:bg-surface-800 text-slate-600 dark:text-surface-400 font-bold uppercase text-[10px] tracking-wider border-b border-slate-200 dark:border-surface-700">
                                <th className="p-3 w-10 text-center">
                                    <input
                                        type="checkbox"
                                        checked={isAllSelected}
                                        onChange={toggleSelectAll}
                                        title="Seleccionar / Desmarcar Todos"
                                        className="w-4 h-4 rounded text-brand border-slate-300 focus:ring-brand accent-brand cursor-pointer"
                                    />
                                </th>
                                <th className="p-3 w-10 text-center">#</th>
                                <th className="p-3">SKU / Código</th>
                                <th className="p-3 cursor-pointer hover:text-slate-900 dark:hover:text-white" onClick={() => handleSort('name')}>
                                    <div className="flex items-center gap-1">
                                        Producto
                                        <ArrowUpDown size={12} />
                                    </div>
                                </th>
                                <th className="p-3">Categoría</th>
                                <th className="p-3 text-right cursor-pointer hover:text-slate-900 dark:hover:text-white" onClick={() => handleSort('qty')}>
                                    <div className="flex items-center justify-end gap-1">
                                        Cant. Vendida (Empaque)
                                        <ArrowUpDown size={12} />
                                    </div>
                                </th>
                                <th className="p-3 text-right">P. Prom. ($)</th>
                                <th className="p-3 text-right cursor-pointer hover:text-slate-900 dark:hover:text-white" onClick={() => handleSort('revenueUsd')}>
                                    <div className="flex items-center justify-end gap-1">
                                        Total Recaudado ($)
                                        <ArrowUpDown size={12} />
                                    </div>
                                </th>
                                <th className="p-3 text-right">% Part.</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-surface-800">
                            {paginatedRows.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="p-8 text-center">
                                        <EmptyState
                                            title="Sin artículos registrados"
                                            description="No se encontraron ventas de artículos para los filtros o fechas seleccionadas."
                                        />
                                    </td>
                                </tr>
                            ) : (
                                paginatedRows.map((row, idx) => {
                                    const globalIndex = startIndex + idx;
                                    const itemKey = row.id || row.sku;
                                    const isChecked = selectedArticleIds.includes(itemKey);
                                    return (
                                        <tr
                                            key={itemKey || idx}
                                            className={`transition-colors text-slate-700 dark:text-surface-200 ${
                                                isChecked
                                                    ? 'bg-brand/5 dark:bg-brand/10 hover:bg-brand/10'
                                                    : 'hover:bg-slate-50 dark:hover:bg-surface-800/50'
                                            }`}
                                        >
                                            <td className="p-3 text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={isChecked}
                                                    onChange={() => toggleArticleSelection(itemKey)}
                                                    className="w-4 h-4 rounded text-brand border-slate-300 focus:ring-brand accent-brand cursor-pointer"
                                                />
                                            </td>
                                            <td className="p-3 text-center font-bold text-slate-600 dark:text-surface-400">{globalIndex}</td>
                                            <td className="p-3 font-mono text-[11px] text-slate-600 dark:text-surface-400">{row.sku}</td>
                                            <td className="p-3 font-bold text-slate-900 dark:text-white">{row.name}</td>
                                            <td className="p-3">
                                                <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-surface-800 text-slate-600 dark:text-surface-300">
                                                    {row.category}
                                                </span>
                                            </td>
                                            <td className="p-3 text-right font-outfit">
                                                <span className="font-bold text-brand dark:text-brand">{row.qty} uds.</span>
                                                {row.packInfo?.hasPack && (
                                                    <span className="block text-[10px] text-slate-500 dark:text-surface-400 font-normal">
                                                        {row.packInfo.text}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-3 text-right font-outfit font-medium">
                                                ${formatUsd(row.avgPriceUsd)}
                                            </td>
                                            <td className="p-3 text-right font-bold text-emerald-600 dark:text-emerald-400 font-outfit text-sm">
                                                ${formatUsd(row.revenueUsd)}
                                            </td>
                                            <td className="p-3 text-right font-outfit font-medium text-slate-600 dark:text-surface-400">
                                                {row.share}%
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                        {sortedRows.length > 0 && (
                            <tfoot>
                                <tr className="bg-slate-100 dark:bg-surface-800 font-bold text-slate-900 dark:text-white border-t border-slate-200 dark:border-surface-700">
                                    <td colSpan={5} className="p-3 uppercase text-[11px]">Totales de la Selección</td>
                                    <td className="p-3 text-right font-outfit text-sm text-brand dark:text-brand">{totals.totalQty} uds.</td>
                                    <td className="p-3 text-right">-</td>
                                    <td className="p-3 text-right font-outfit text-sm text-emerald-600 dark:text-emerald-400">${formatUsd(totals.totalRevenueUsd)}</td>
                                    <td className="p-3 text-right">100%</td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>

            {/* CONTROLES DE PAGINACIÓN */}
            {sortedRows.length > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-surface-900 rounded-2xl p-3.5 border border-slate-200 dark:border-surface-800 shadow-sm">
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-surface-400">
                        <span>Mostrando <strong className="text-slate-900 dark:text-white">{startIndex} - {endIndex}</strong> de <strong className="text-slate-900 dark:text-white">{sortedRows.length}</strong> artículos</span>
                        <select
                            value={itemsPerPage}
                            onChange={(e) => { triggerHaptic?.(); setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                            className="ml-2 px-2.5 py-1 min-h-[34px] bg-slate-100 dark:bg-surface-800 border border-slate-200 dark:border-surface-700 rounded-xl text-xs font-bold text-slate-700 dark:text-white focus:outline-none"
                        >
                            <option value={10}>10 / pág</option>
                            <option value={20}>20 / pág</option>
                            <option value={50}>50 / pág</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
                        <button
                            onClick={() => { triggerHaptic?.(); setCurrentPage(prev => Math.max(prev - 1, 1)); }}
                            disabled={currentPage === 1}
                            className="flex items-center gap-1 px-3 py-2 min-h-[38px] rounded-xl text-xs font-bold bg-slate-100 dark:bg-surface-800 hover:bg-slate-200 dark:hover:bg-surface-700 text-slate-700 dark:text-surface-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
                        >
                            <ChevronLeft size={16} />
                            <span>Anterior</span>
                        </button>

                        <span className="px-3 py-1.5 rounded-xl bg-brand/10 text-brand dark:text-brand text-xs font-bold shrink-0">
                            {currentPage} / {totalPages}
                        </span>

                        <button
                            onClick={() => { triggerHaptic?.(); setCurrentPage(prev => Math.min(prev + 1, totalPages)); }}
                            disabled={currentPage >= totalPages}
                            className="flex items-center gap-1 px-3 py-2 min-h-[38px] rounded-xl text-xs font-bold bg-slate-100 dark:bg-surface-800 hover:bg-slate-200 dark:hover:bg-surface-700 text-slate-700 dark:text-surface-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
                        >
                            <span>Siguiente</span>
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* BOTTOM SHEET MODAL DE CATEGORÍAS (Exclusivo Móvil) */}
            {showCategoryModal && (
                <div
                    className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-xs flex items-end justify-center p-0 animate-in fade-in duration-200"
                    onClick={() => setShowCategoryModal(false)}
                >
                    <div
                        className="bg-white dark:bg-surface-900 w-full rounded-t-3xl p-5 shadow-2xl space-y-4 max-h-[80vh] flex flex-col animate-in slide-in-from-bottom duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Drag indicator & Header */}
                        <div className="flex flex-col items-center">
                            <div className="w-12 h-1.5 bg-slate-200 dark:bg-surface-700 rounded-full mb-3" />
                            <div className="flex items-center justify-between w-full">
                                <h3 className="font-bold text-slate-800 dark:text-white text-base">Filtrar por Categorías</h3>
                                <button
                                    onClick={() => setShowCategoryModal(false)}
                                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Buscador interno del modal */}
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={categoryModalSearch}
                                onChange={(e) => setCategoryModalSearch(e.target.value)}
                                placeholder="Buscar categoría..."
                                className="w-full pl-9 pr-8 py-2.5 min-h-[44px] bg-slate-100 dark:bg-surface-800 border border-slate-200 dark:border-surface-700 rounded-xl text-xs text-slate-800 dark:text-white focus:outline-none"
                            />
                            {categoryModalSearch && (
                                <button
                                    onClick={() => setCategoryModalSearch('')}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        {/* Acciones Rápidas */}
                        <div className="flex items-center justify-between pt-1">
                            <span className="text-[11px] font-bold text-slate-500 dark:text-surface-400">
                                {selectedCategories.length === 0 ? 'Todas seleccionadas' : `${selectedCategories.length} seleccionadas`}
                            </span>
                            <div className="flex gap-3">
                                {selectedCategories.length > 0 && (
                                    <button
                                        onClick={() => { triggerHaptic?.(); setSelectedCategories([]); }}
                                        className="text-xs font-bold text-brand hover:underline"
                                    >
                                        Limpiar
                                    </button>
                                )}
                                <button
                                    onClick={() => { triggerHaptic?.(); setSelectedCategories([...availableCategories]); }}
                                    className="text-xs font-bold text-slate-700 dark:text-surface-200 hover:underline"
                                >
                                    Seleccionar Todas
                                </button>
                            </div>
                        </div>

                        {/* Lista de Categorías con Checkboxes Táctiles (Touch Target >= 44px) */}
                        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-surface-800 pr-1">
                            {filteredModalCategories.map(cat => {
                                const isSelected = selectedCategories.includes(cat);
                                return (
                                    <label
                                        key={cat}
                                        onClick={() => toggleCategory(cat)}
                                        className="flex items-center justify-between py-3 min-h-[48px] cursor-pointer active:bg-slate-50 dark:active:bg-surface-800 px-1 rounded-lg"
                                    >
                                        <span className="text-xs font-bold text-slate-800 dark:text-surface-100">{cat}</span>
                                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${
                                            isSelected ? 'bg-brand text-white shadow-tone-sm' : 'border border-slate-300 dark:border-surface-700 bg-slate-50 dark:bg-surface-800'
                                        }`}>
                                            {isSelected && <Check size={14} />}
                                        </div>
                                    </label>
                                );
                            })}
                        </div>

                        {/* Botón Listo */}
                        <button
                            onClick={() => setShowCategoryModal(false)}
                            className="w-full py-3.5 min-h-[48px] bg-brand text-white font-bold rounded-xl text-sm shadow-primary-tone active:scale-95 transition-all"
                        >
                            Ver Resultados
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function rowsCountText(count, catCount, selectedCount) {
    let text = `${count} artículos encontrados`;
    if (catCount > 0) text += ` en ${catCount} categorías filtradas`;
    if (selectedCount > 0) text += ` (${selectedCount} marcados para PDF)`;
    return text;
}
