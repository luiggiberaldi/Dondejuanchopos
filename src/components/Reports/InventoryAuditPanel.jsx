import { useMemo, useState } from 'react';
import {
    AlertTriangle,
    CheckCircle2,
    ClipboardList,
    Download,
    RefreshCw,
    Search,
    ShieldAlert,
} from 'lucide-react';
import {
    buildHistoricalInventoryCsv,
    buildHistoricalInventoryDryRun,
} from '../../utils/historicalInventoryReconciliation';

function formatQuantity(value) {
    if (value === null || value === undefined || value === '') return '—';
    return Number(value).toLocaleString('es-VE', { maximumFractionDigits: 2 });
}

function statusClasses(status) {
    if (status === 'OK') return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900';
    if (status === 'INCOMPLETE') return 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900';
    return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900';
}

function severityClasses(severity) {
    return severity === 'ALTO'
        ? 'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-950/30 dark:border-rose-900'
        : 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-900';
}

export default function InventoryAuditPanel({
    products = [],
    sales = [],
    kardex = [],
    operations = [],
    missingDocIds = [],
    loading = false,
    onRefresh,
}) {
    const [search, setSearch] = useState('');
    const [onlyAlerts, setOnlyAlerts] = useState(true);

    const report = useMemo(() => buildHistoricalInventoryDryRun({
        products,
        sales,
        kardex,
        operations,
        missingDocIds,
    }), [products, sales, kardex, operations, missingDocIds]);

    const visibleProducts = useMemo(() => {
        const term = search.trim().toLowerCase();
        return report.products
            .filter(row => !onlyAlerts || row.alertas.length > 0)
            .filter(row => {
                if (!term) return true;
                return String(row.producto || '').toLowerCase().includes(term)
                    || String(row.productoId || '').toLowerCase().includes(term)
                    || row.alertas.some(alert => alert.toLowerCase().includes(term));
            })
            .sort((a, b) => {
                if (b.alertas.length !== a.alertas.length) return b.alertas.length - a.alertas.length;
                return String(a.producto).localeCompare(String(b.producto), 'es');
            });
    }, [report.products, search, onlyAlerts]);

    const downloadCsv = () => {
        const csv = buildHistoricalInventoryCsv(report);
        const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `auditoria_inventario_dry_run_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const summaryCards = [
        { label: 'Ventas sin Kardex', value: report.summary.salesWithoutKardex, tone: 'text-rose-600' },
        { label: 'Anulaciones con saldo', value: report.summary.voidsWithNetDifference, tone: 'text-rose-600' },
        { label: 'Productos sin base', value: report.summary.productsWithoutKardex, tone: 'text-amber-600' },
        { label: 'Saltos de continuidad', value: report.summary.continuityBreaks, tone: 'text-amber-600' },
        { label: 'Componentes no reflejados', value: report.summary.modularMissingProducts, tone: 'text-purple-600' },
        { label: 'Operaciones pendientes', value: report.summary.pendingOperations, tone: 'text-cyan-600' },
    ];

    return (
        <section className="space-y-4" aria-label="Auditoría histórica de inventario">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-300 flex items-center justify-center border border-rose-500/20 shrink-0">
                        <ShieldAlert size={21} />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-slate-900 dark:text-white">Auditoría histórica</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Conciliación de ventas, Kardex y stock actual sin modificar datos.
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={loading}
                        className="min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-surface-800 bg-white dark:bg-surface-900 text-slate-600 dark:text-surface-300 text-xs font-bold flex items-center gap-2 disabled:opacity-50"
                    >
                        <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Recargar
                    </button>
                    <button
                        type="button"
                        onClick={downloadCsv}
                        disabled={report.products.length === 0}
                        className="min-h-[42px] px-3 rounded-xl bg-brand text-white text-xs font-bold flex items-center gap-2 shadow-primary-tone disabled:opacity-50"
                    >
                        <Download size={15} /> Exportar dry-run
                    </button>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className={`inline-flex items-center gap-2 border rounded-xl px-3 py-2 text-xs font-black ${statusClasses(report.status)}`}>
                    {report.status === 'OK' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                    Estado: {report.status}
                </div>
                <div className="inline-flex items-center gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    <ClipboardList size={14} /> Modo DRY-RUN · muta datos: no
                </div>
                {loading && <span className="text-[11px] text-slate-400">Cargando documentos…</span>}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                {summaryCards.map(card => (
                    <div key={card.label} className="bg-white dark:bg-surface-900 border border-slate-200 dark:border-surface-800 rounded-2xl p-3 shadow-sm">
                        <div className="text-[10px] uppercase tracking-wider font-black text-slate-400 leading-tight">{card.label}</div>
                        <div className={`text-2xl font-black mt-1 ${card.tone}`}>{formatQuantity(card.value)}</div>
                    </div>
                ))}
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 rounded-2xl p-3 text-xs text-amber-900 dark:text-amber-200">
                <strong>Regla de seguridad:</strong> este análisis solo propone acciones. No fija existencias ni crea movimientos Kardex; cualquier ajuste requiere backup completo, conteo físico y confirmación del supervisor.
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-bold text-slate-400">
                <span>Documentos: {report.sourceCoverage.products} productos · {report.sourceCoverage.sales} ventas · {report.sourceCoverage.kardex} movimientos</span>
                {report.sourceCoverage.missingDocIds.length > 0 && (
                    <span className="text-amber-600 dark:text-amber-300">Faltan: {report.sourceCoverage.missingDocIds.join(', ')}</span>
                )}
            </div>

            <div className="bg-white dark:bg-surface-900 border border-slate-200 dark:border-surface-800 rounded-2xl p-4 shadow-sm space-y-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="relative flex-1 max-w-xl">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <input
                            type="search"
                            value={search}
                            onChange={event => setSearch(event.target.value)}
                            placeholder="Buscar producto, ID o alerta…"
                            className="w-full h-10 pl-9 pr-3 rounded-xl bg-slate-50 dark:bg-surface-950 border border-slate-200 dark:border-surface-800 text-xs focus:outline-none focus:ring-2 focus:ring-brand/30"
                        />
                    </div>
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-surface-300 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={onlyAlerts}
                            onChange={event => setOnlyAlerts(event.target.checked)}
                            className="accent-brand"
                        />
                        Mostrar solo alertas ({report.products.filter(row => row.alertas.length > 0).length})
                    </label>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full min-w-[980px] text-left text-xs border-collapse">
                        <thead>
                            <tr className="bg-slate-100 dark:bg-surface-950 text-slate-500 dark:text-surface-400 font-black uppercase">
                                <th className="p-3">Producto</th>
                                <th className="p-3 text-right">Actual</th>
                                <th className="p-3 text-right">Últ. Kardex</th>
                                <th className="p-3 text-right">Diferencia</th>
                                <th className="p-3 text-right">Venta física</th>
                                <th className="p-3 text-right">Modular faltante</th>
                                <th className="p-3">Confianza</th>
                                <th className="p-3">Acción dry-run</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-surface-800/70">
                            {visibleProducts.length === 0 ? (
                                <tr><td colSpan="8" className="p-8 text-center text-slate-400">No hay productos para este filtro.</td></tr>
                            ) : visibleProducts.slice(0, 200).map(row => (
                                <tr key={row.productoId} className="hover:bg-slate-50 dark:hover:bg-surface-950/70">
                                    <td className="p-3">
                                        <div className="font-bold text-slate-800 dark:text-white">{row.producto}</div>
                                        <div className="text-[10px] font-mono text-slate-400 truncate max-w-[260px]">{row.productoId}</div>
                                        {row.alertas.length > 0 && <div className="text-[10px] text-rose-600 dark:text-rose-300 mt-1">{row.alertas.join(' · ')}</div>}
                                    </td>
                                    <td className={`p-3 text-right font-black ${row.stockActual < 0 ? 'text-rose-600' : 'text-slate-700 dark:text-surface-200'}`}>{formatQuantity(row.stockActual)}</td>
                                    <td className="p-3 text-right text-slate-600 dark:text-surface-300">{formatQuantity(row.ultimoStockKardex)}</td>
                                    <td className={`p-3 text-right font-black ${row.diferenciaStock !== null && row.diferenciaStock !== 0 ? 'text-amber-600' : 'text-slate-600 dark:text-surface-300'}`}>{formatQuantity(row.diferenciaStock)}</td>
                                    <td className="p-3 text-right text-slate-600 dark:text-surface-300">{formatQuantity(row.ventaFisicaEsperada)}</td>
                                    <td className="p-3 text-right font-bold text-purple-600 dark:text-purple-300">{formatQuantity(row.componentesModularesNoReflejados)}</td>
                                    <td className="p-3"><span className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-surface-800 text-[10px] font-black">{row.confianza}</span></td>
                                    <td className="p-3 text-[10px] font-bold text-slate-600 dark:text-surface-300">{row.accionDryRun}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {visibleProducts.length > 200 && <div className="text-[11px] text-slate-400">Mostrando 200 de {visibleProducts.length} productos. Exporta el CSV para el detalle completo.</div>}
            </div>

            <div className="bg-white dark:bg-surface-900 border border-slate-200 dark:border-surface-800 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle size={16} className="text-amber-500" />
                    <h4 className="text-sm font-black text-slate-800 dark:text-white">Hallazgos accionables</h4>
                    <span className="text-[10px] text-slate-400">({report.discrepancies.length})</span>
                </div>
                {report.discrepancies.length === 0 ? (
                    <p className="text-xs text-emerald-600 dark:text-emerald-300">No se detectaron discrepancias con los documentos cargados.</p>
                ) : (
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                        {report.discrepancies.slice(0, 100).map((finding, index) => (
                            <div key={`${finding.code}-${finding.saleId || finding.productoId || index}`} className="flex items-start gap-2 text-xs">
                                <span className={`px-1.5 py-0.5 rounded border text-[9px] font-black shrink-0 ${severityClasses(finding.severity)}`}>{finding.severity}</span>
                                <div>
                                    <div className="font-bold text-slate-700 dark:text-surface-200">{finding.code}</div>
                                    <div className="text-slate-500 dark:text-surface-400">{finding.description}</div>
                                    {finding.saleId && <div className="text-[10px] font-mono text-slate-400">Venta: {finding.saleNumber || finding.saleId}</div>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}
