import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    FileText, Search, Download, ArrowUpRight, ArrowDownRight,
    RefreshCw, Layers, DollarSign, Package, User, Clock, AlertTriangle, ShieldCheck
} from 'lucide-react';
import { getKardexHistory, seedInitialKardexIfEmpty } from '../services/kardexService';
import { filterKardexByLocalDate, calculateInventoryValue, buildKardexCsv } from '../utils/kardexScope';
import { useProductContext } from '../context/ProductContext';
import { useAuthStore } from '../hooks/store/useAuthStore';

export default function KardexView() {
    const { products } = useProductContext();
    const activeUser = useAuthStore(state => state.usuarioActivo);
    const [kardexList, setKardexList] = useState([]);
    const [loading, setLoading] = useState(true);

    // Filtros de búsqueda
    const [searchQuery, setSearchQuery] = useState('');
    const [tipoFilter, setTipoFilter] = useState('TODOS');
    const [fechaExacta, setFechaExacta] = useState('');
    const [fechaDesde, setFechaDesde] = useState('');
    const [fechaHasta, setFechaHasta] = useState('');

    const hasSeededRef = useRef(false);

    const loadKardex = async () => {
        setLoading(true);
        try {
            const history = await getKardexHistory();
            if (history.length === 0 && products && products.length > 0 && !hasSeededRef.current) {
                hasSeededRef.current = true;
                const deviceId = localStorage.getItem('dj_device_id') || 'CAJA_PRINCIPAL';
                await seedInitialKardexIfEmpty(products, deviceId, activeUser);
                const reloaded = await getKardexHistory();
                setKardexList(reloaded);
            } else {
                setKardexList(history);
            }
        } catch (e) {
            console.error('[KardexView] Error al cargar Kardex:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadKardex();
        const handleKardexRecorded = () => loadKardex();
        window.addEventListener('kardex_movement_recorded', handleKardexRecorded);
        return () => window.removeEventListener('kardex_movement_recorded', handleKardexRecorded);
    }, []);

    // Filtrar movimientos.
    // `fechaExacta` muestra TODOS los movimientos de ese día; si está definida,
    // tiene prioridad sobre el rango Desde/Hasta.
    const filteredMovements = useMemo(() => {
        return filterKardexByLocalDate(kardexList, {
            query: searchQuery,
            tipo: tipoFilter,
            fechaExacta,
            fechaDesde,
            fechaHasta,
        });
    }, [kardexList, searchQuery, tipoFilter, fechaExacta, fechaDesde, fechaHasta]);

    const clearFilters = () => {
        setSearchQuery('');
        setTipoFilter('TODOS');
        setFechaExacta('');
        setFechaDesde('');
        setFechaHasta('');
    };

    const hasActiveFilters = Boolean(
        searchQuery || tipoFilter !== 'TODOS' || fechaExacta || fechaDesde || fechaHasta
    );

    // Estadísticas del Kardex
    const stats = useMemo(() => {
        const invVal = calculateInventoryValue(products || []);
        let entradasQty = 0;
        let salidasQty = 0;

        filteredMovements.forEach(m => {
            const q = Number(m.cantidad) || 0;
            if (q > 0) entradasQty += q;
            else salidasQty += Math.abs(q);
        });

        return {
            totalMovimientos: filteredMovements.length,
            valorInventarioUsd: invVal.totalValorizadoUsd,
            totalEntradas: entradasQty,
            totalSalidas: salidasQty
        };
    }, [filteredMovements, products]);

    // Exportación a CSV
    const exportCSV = () => {
        if (filteredMovements.length === 0) return;
        const headers = ['Fecha/Hora', 'Producto', 'SKU', 'Tipo', 'Subtipo', 'Cantidad', 'Stock Antes', 'Stock Después', 'Costo U (USD)', 'Costo Total (USD)', 'Referencia', 'Usuario', 'Motivo'];

        const rows = filteredMovements.map(m => [
            `"${m.created_at ? new Date(m.created_at).toLocaleString('es-VE') : ''}"`,
            `"${m.producto_nombre || ''}"`,
            `"${m.sku || ''}"`,
            `"${m.tipo || ''}"`,
            `"${m.subtipo || ''}"`,
            m.cantidad,
            m.stock_antes,
            m.stock_despues,
            m.costo_unitario,
            m.costo_total,
            `"${m.referencia_numero || m.referencia_id || ''}"`,
            `"${m.usuario_nombre || ''}"`,
            `"${m.motivo || ''}"`
        ]);

        const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
        const link = document.createElement('a');
        link.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(buildKardexCsv(filteredMovements)));
        link.setAttribute('download', `Kardex_Inventario_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const getBadgeStyle = (tipo, cantidad) => {
        if (tipo === 'VENTA') return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
        if (tipo === 'COMPRA' || tipo === 'INICIAL') return 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20';
        if (tipo === 'DEVOLUCION') return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
        if (tipo === 'MERMA' || tipo === 'AUTOCONSUMO') return 'bg-rose-500/10 text-rose-500 border-rose-500/20';
        return cantidad > 0 ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-amber-500/10 text-amber-500 border-amber-500/20';
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 p-4 md:p-6 space-y-6">
            {/* Header del Kardex */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 bg-cyan-600/10 text-cyan-500 rounded-2xl flex items-center justify-center border border-cyan-500/20 shrink-0">
                            <Layers size={22} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                                Kardex de Inventario
                            </h1>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                                Auditoría inmutable de movimientos, entradas, salidas y trazabilidad
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={loadKardex}
                        className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl transition-all active:scale-95"
                        title="Recargar Kardex"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </button>
                    <button
                        onClick={exportCSV}
                        className="px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl shadow-lg flex items-center gap-2 text-sm transition-all active:scale-95"
                    >
                        <Download size={16} />
                        <span>Exportar CSV</span>
                    </button>
                </div>
            </div>

            {/* Tarjetas de Estadísticas */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
                    <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider">Movimientos</span>
                        <FileText size={18} className="text-cyan-500" />
                    </div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white">
                        {stats.totalMovimientos}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 font-medium">Registros auditados</div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
                    <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider">Valor Inventario</span>
                        <DollarSign size={18} className="text-emerald-500" />
                    </div>
                    <div className="text-2xl font-black text-emerald-500">
                        ${stats.valorInventarioUsd.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 font-medium">Costo promedio ponderado</div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
                    <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider">Entradas</span>
                        <ArrowUpRight size={18} className="text-emerald-500" />
                    </div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white">
                        +{stats.totalEntradas} <span className="text-xs font-normal text-slate-400">unds</span>
                    </div>
                    <div className="text-[10px] text-emerald-500/80 mt-1 font-medium">Compras / Ajustes +</div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
                    <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider">Salidas</span>
                        <ArrowDownRight size={18} className="text-rose-500" />
                    </div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white">
                        -{stats.totalSalidas} <span className="text-xs font-normal text-slate-400">unds</span>
                    </div>
                    <div className="text-[10px] text-rose-500/80 mt-1 font-medium">Ventas / Mermas -</div>
                </div>
            </div>

            {/* Barra de Filtros */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Filtros</span>
                    {hasActiveFilters && (
                        <button
                            onClick={clearFilters}
                            className="text-[11px] font-bold text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-200 dark:border-cyan-800/50 transition-all cursor-pointer"
                        >
                            <RefreshCw size={13} /> Limpiar filtros
                        </button>
                    )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 items-end">
                    {/* Búsqueda */}
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 pl-0.5">
                            Buscar Producto / SKU
                        </label>
                        <div className="relative">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Buscar producto, SKU, ref..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full h-10 pl-9 pr-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 transition-all"
                            />
                        </div>
                    </div>

                    {/* Filtro por Tipo */}
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 pl-0.5">
                            Tipo de Movimiento
                        </label>
                        <select
                            value={tipoFilter}
                            onChange={e => setTipoFilter(e.target.value)}
                            className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 transition-all cursor-pointer"
                        >
                            <option value="TODOS">Todos los tipos</option>
                            <option value="VENTA">Ventas</option>
                            <option value="COMPRA">Compras</option>
                            <option value="AJUSTE">Ajustes</option>
                            <option value="DEVOLUCION">Devoluciones</option>
                            <option value="MERMA">Mermas / Daños</option>
                            <option value="AUTOCONSUMO">Autoconsumo</option>
                            <option value="INICIAL">Iniciales</option>
                        </select>
                    </div>

                    {/* Fecha exacta */}
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 pl-0.5">
                            Día Específico
                        </label>
                        <input
                            type="date"
                            value={fechaExacta}
                            onChange={e => {
                                setFechaExacta(e.target.value);
                                setFechaDesde('');
                                setFechaHasta('');
                            }}
                            className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 transition-all"
                        />
                    </div>

                    {/* Desde */}
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 pl-0.5">
                            Rango Desde
                        </label>
                        <input
                            type="date"
                            value={fechaDesde}
                            onChange={e => {
                                setFechaDesde(e.target.value);
                                setFechaExacta('');
                            }}
                            className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 transition-all"
                        />
                    </div>

                    {/* Hasta */}
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 pl-0.5">
                            Rango Hasta
                        </label>
                        <input
                            type="date"
                            value={fechaHasta}
                            onChange={e => {
                                setFechaHasta(e.target.value);
                                setFechaExacta('');
                            }}
                            className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 transition-all"
                        />
                    </div>
                </div>
            </div>

            {/* Tabla Principal de Kardex */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                        <thead>
                            <tr className="bg-slate-100 dark:bg-slate-950/80 text-slate-500 dark:text-slate-400 font-bold uppercase border-b border-slate-200 dark:border-slate-800">
                                <th className="p-3">Fecha / Hora</th>
                                <th className="p-3">Producto / SKU</th>
                                <th className="p-3">Tipo</th>
                                <th className="p-3 text-right">Cantidad</th>
                                <th className="p-3 text-center">Stock (Antes → Después)</th>
                                <th className="p-3 text-right">Costo Und.</th>
                                <th className="p-3 text-right">Costo Total</th>
                                <th className="p-3">Referencia / Motivo</th>
                                <th className="p-3">Usuario</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                            {filteredMovements.length === 0 ? (
                                <tr>
                                    <td colSpan="9" className="p-8 text-center text-slate-400">
                                        <div className="flex flex-col items-center justify-center gap-2">
                                            <Package size={32} className="text-slate-400 opacity-40" />
                                            <span>No se encontraron movimientos en el Kardex</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredMovements.map(m => {
                                    const isPositive = Number(m.cantidad) > 0;
                                    return (
                                        <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                            <td className="p-3 whitespace-nowrap text-slate-500 dark:text-slate-400">
                                                <div className="flex items-center gap-1.5">
                                                    <Clock size={13} className="text-slate-400 shrink-0" />
                                                    <span>{m.created_at ? new Date(m.created_at).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</span>
                                                </div>
                                            </td>
                                            <td className="p-3">
                                                <div className="font-bold text-slate-800 dark:text-slate-100">
                                                    {m.producto_nombre}
                                                </div>
                                                {m.sku && <div className="text-[10px] text-slate-400 font-mono">{m.sku}</div>}
                                            </td>
                                            <td className="p-3 whitespace-nowrap">
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border uppercase tracking-wider ${getBadgeStyle(m.tipo, m.cantidad)}`}>
                                                    {m.tipo}
                                                </span>
                                            </td>
                                            <td className={`p-3 text-right font-black text-sm whitespace-nowrap ${isPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                {isPositive ? `+${m.cantidad}` : m.cantidad} {m.unidad || 'unds'}
                                            </td>
                                            <td className="p-3 text-center whitespace-nowrap">
                                                <span className="text-slate-400">{m.stock_antes} unds</span>
                                                <span className="mx-1 text-slate-300 dark:text-slate-600">→</span>
                                                <span className="font-bold text-slate-800 dark:text-white">{m.stock_despues} unds</span>
                                            </td>
                                            <td className="p-3 text-right font-mono text-slate-600 dark:text-slate-300">
                                                ${Number(m.costo_unitario || 0).toFixed(2)}
                                            </td>
                                            <td className="p-3 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                                                ${Number(m.costo_total || 0).toFixed(2)}
                                            </td>
                                            <td className="p-3 max-w-[240px] whitespace-normal break-words">
                                                {m.referencia_numero || m.referencia_id ? (
                                                    <span className="font-mono text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded mr-1">
                                                        {m.referencia_numero || m.referencia_id.slice(0, 8)}
                                                    </span>
                                                ) : null}
                                                <span className="text-slate-500 text-[11px]">{m.motivo || m.observaciones || '—'}</span>
                                            </td>
                                            <td className="p-3 whitespace-nowrap text-slate-500 dark:text-slate-400">
                                                <div className="flex items-center gap-1">
                                                    <User size={12} className="text-slate-400" />
                                                    <span>{m.usuario_nombre || 'Sistema'}</span>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
