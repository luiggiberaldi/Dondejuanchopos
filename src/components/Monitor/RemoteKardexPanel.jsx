import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Download, FileText, Layers, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { fetchRemoteInventoryAudit, extractRemoteKardexData } from '../../services/remoteAuditService';
import { buildKardexCsv, calculateInventoryValue, filterKardexByLocalDate } from '../../utils/kardexScope';
import { reconcileRemoteInventory } from '../../utils/remoteInventoryReconciliation';

function safeDeviceId(deviceId) {
    return String(deviceId || 'caja').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
}

function badgeFor(type, quantity) {
    if (type === 'VENTA') return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
    if (type === 'DEVOLUCION') return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    if (type === 'COMPRA' || type === 'INICIAL') return 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20';
    if (type === 'MERMA' || type === 'AUTOCONSUMO') return 'bg-rose-500/10 text-rose-600 border-rose-500/20';
    return Number(quantity) > 0 ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-amber-500/10 text-amber-600 border-amber-500/20';
}

function statusCopy(status) {
    if (status === 'OK') return { label: 'Auditoría OK', className: 'text-emerald-700 bg-emerald-50 border-emerald-200', Icon: CheckCircle2 };
    if (status === 'INCOMPLETE') return { label: 'Datos incompletos', className: 'text-amber-700 bg-amber-50 border-amber-200', Icon: ShieldAlert };
    if (status === 'DISCREPANCIES') return { label: 'Discrepancias detectadas', className: 'text-rose-700 bg-rose-50 border-rose-200', Icon: AlertTriangle };
    return { label: 'Revisión requerida', className: 'text-amber-700 bg-amber-50 border-amber-200', Icon: AlertTriangle };
}

export default function RemoteKardexPanel({ deviceId, triggerHaptic }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [audit, setAudit] = useState(null);
    const [query, setQuery] = useState('');
    const [type, setType] = useState('TODOS');
    const [exactDate, setExactDate] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');

    const loadAudit = async () => {
        if (loading || !deviceId) return;
        setLoading(true);
        setError(null);
        triggerHaptic?.();
        try {
            const result = await fetchRemoteInventoryAudit(deviceId);
            if (!result.success) {
                setError(result.error?.message || 'No se pudo leer el Kardex remoto.');
                setAudit(null);
                return;
            }
            const data = extractRemoteKardexData(result.documents);
            setAudit({ ...result, ...data, missingDocIds: result.missingDocIds });
        } catch (loadError) {
            setError(loadError?.message || 'Error leyendo la auditoría remota.');
            setAudit(null);
        } finally {
            setLoading(false);
        }
    };

    const filteredMovements = useMemo(() => filterKardexByLocalDate(audit?.kardex || [], {
        query,
        tipo: type,
        fechaExacta: exactDate,
        fechaDesde: fromDate,
        fechaHasta: toDate,
    }), [audit?.kardex, query, type, exactDate, fromDate, toDate]);

    const reconciliation = useMemo(() => audit
        ? reconcileRemoteInventory({
            products: audit.products,
            sales: audit.sales,
            kardex: audit.kardex,
            operations: audit.operations,
            missingDocIds: audit.missingDocIds,
        })
        : null, [audit]);

    const inventoryValue = useMemo(() => calculateInventoryValue(audit?.products || []), [audit?.products]);

    const exportCsv = () => {
        if (filteredMovements.length === 0 || !deviceId) return;
        triggerHaptic?.();
        const blob = new Blob([buildKardexCsv(filteredMovements)], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `Kardex_${safeDeviceId(deviceId)}_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
    };

    const clearDates = () => {
        setExactDate('');
        setFromDate('');
        setToDate('');
    };

    if (!deviceId) {
        return <div className="p-8 text-center text-sm font-bold text-slate-400">No hay una caja emparejada.</div>;
    }

    return (
        <div className="space-y-5 animate-fade-in">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-sm">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 text-cyan-600 flex items-center justify-center shrink-0"><Layers size={21} /></div>
                    <div>
                        <h2 className="text-sm sm:text-base font-black text-slate-800 dark:text-white">Kardex remoto de la caja</h2>
                        <p className="text-[10px] text-slate-400 font-medium mt-0.5 break-all">{deviceId} · lectura bajo demanda, sin persistencia local</p>
                        {audit && <p className="text-[10px] text-slate-400 mt-1">Última actualización recibida: <strong>{formatDate(audit.maxUpdatedAt)}</strong></p>}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={loadAudit} disabled={loading} className="px-3.5 py-2.5 rounded-2xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-black flex items-center gap-2 disabled:opacity-50">
                        <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                        {loading ? 'Leyendo...' : audit ? 'Actualizar lectura' : 'Cargar Kardex'}
                    </button>
                    <button onClick={exportCsv} disabled={!audit || filteredMovements.length === 0} className="px-3.5 py-2.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-black text-slate-700 dark:text-slate-200 flex items-center gap-2 disabled:opacity-40">
                        <Download size={15} /> CSV
                    </button>
                </div>
            </div>

            {error && <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2"><AlertTriangle size={16} /> {error}</div>}

            {!audit && !error && (
                <div className="py-16 px-6 text-center bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 rounded-3xl space-y-3">
                    <FileText size={34} className="mx-auto text-slate-300" />
                    <h3 className="text-sm font-black text-slate-700 dark:text-slate-200">La lectura remota no se ejecuta automáticamente</h3>
                    <p className="text-xs text-slate-400 max-w-md mx-auto">Carga la auditoría cuando necesites revisar esta caja. Solo se hará una consulta con los documentos permitidos.</p>
                </div>
            )}

            {audit && (
                <>
                    {audit.missingDocIds.length > 0 && (
                        <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold flex items-start gap-2">
                            <ShieldAlert size={17} className="shrink-0 mt-0.5" />
                            <span>Lectura parcial. Faltan: {audit.missingDocIds.join(', ')}. No se declarará la auditoría como OK.</span>
                        </div>
                    )}

                    {reconciliation && (() => {
                        const status = statusCopy(reconciliation.status);
                        const StatusIcon = status.Icon;
                        return <div className="space-y-3">
                            <div className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${status.className}`}>
                                <div className="flex items-center gap-2"><StatusIcon size={18} /><strong className="text-xs font-black">{status.label}</strong><span className="text-[10px]">{reconciliation.totals.discrepancies} discrepancias · {reconciliation.totals.warnings} advertencias</span></div>
                                <span className="text-[10px] font-bold">Revisado {formatDate(reconciliation.checkedAt)}</span>
                            </div>
                            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                                <div className="p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800"><span className="text-[9px] font-black uppercase text-slate-400">Productos</span><strong className="block text-lg font-black mt-1">{reconciliation.totals.products}</strong></div>
                                <div className="p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800"><span className="text-[9px] font-black uppercase text-slate-400">Stock total</span><strong className="block text-lg font-black mt-1">{inventoryValue.totalUnidades}</strong></div>
                                <div className="p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800"><span className="text-[9px] font-black uppercase text-slate-400">Ventas</span><strong className="block text-lg font-black mt-1">{reconciliation.totals.sales}</strong></div>
                                <div className="p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800"><span className="text-[9px] font-black uppercase text-slate-400">Movimientos</span><strong className="block text-lg font-black mt-1">{reconciliation.totals.movements}</strong></div>
                                <div className="p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800"><span className="text-[9px] font-black uppercase text-slate-400">Valor costo</span><strong className="block text-lg font-black mt-1">${inventoryValue.totalValorizadoUsd.toFixed(2)}</strong></div>
                            </div>
                            {(reconciliation.discrepancies.length > 0 || reconciliation.warnings.length > 0) && <div className="grid lg:grid-cols-2 gap-3">
                                {reconciliation.discrepancies.length > 0 && <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200"><h4 className="text-[10px] font-black uppercase text-rose-700 mb-2">Discrepancias</h4><ul className="space-y-1 text-[10px] text-rose-800">{reconciliation.discrepancies.slice(0, 8).map((item, index) => <li key={`${item.code}-${index}`}>• {item.message}</li>)}</ul></div>}
                                {reconciliation.warnings.length > 0 && <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200"><h4 className="text-[10px] font-black uppercase text-amber-700 mb-2">Advertencias</h4><ul className="space-y-1 text-[10px] text-amber-800">{reconciliation.warnings.slice(0, 8).map((item, index) => <li key={`${item.code}-${index}`}>• {item.message}</li>)}</ul></div>}
                            </div>}
                        </div>;
                    })()}

                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 shadow-sm space-y-3">
                        <div className="flex items-center justify-between"><span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Filtros compartidos con Kardex central</span>{(query || type !== 'TODOS' || exactDate || fromDate || toDate) && <button onClick={() => { setQuery(''); setType('TODOS'); clearDates(); }} className="text-[10px] font-black text-cyan-600">Limpiar</button>}</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                            <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Producto, referencia..." className="w-full h-9 pl-8 pr-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs" /></div>
                            <select value={type} onChange={event => setType(event.target.value)} className="h-9 px-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"><option value="TODOS">Todos los tipos</option><option value="VENTA">Ventas</option><option value="COMPRA">Compras</option><option value="AJUSTE">Ajustes</option><option value="DEVOLUCION">Devoluciones</option><option value="MERMA">Mermas</option><option value="AUTOCONSUMO">Autoconsumo</option><option value="INICIAL">Iniciales</option></select>
                            <input type="date" value={exactDate} onChange={event => { setExactDate(event.target.value); setFromDate(''); setToDate(''); }} className="h-9 px-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs" title="Día específico" />
                            <input type="date" value={fromDate} onChange={event => { setFromDate(event.target.value); setExactDate(''); }} className="h-9 px-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs" title="Desde" />
                            <input type="date" value={toDate} onChange={event => { setToDate(event.target.value); setExactDate(''); }} className="h-9 px-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs" title="Hasta" />
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between"><span className="text-xs font-black text-slate-700 dark:text-slate-200">{filteredMovements.length} movimientos visibles</span><span className="text-[10px] text-slate-400 flex items-center gap-1"><Clock size={12} /> Datos recibidos {formatDate(audit.maxUpdatedAt)}</span></div>
                        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="bg-slate-100 dark:bg-slate-950/80 text-slate-500 font-bold uppercase"><th className="p-3">Fecha / Producto</th><th className="p-3">Tipo</th><th className="p-3 text-right">Cantidad</th><th className="p-3 text-center">Stock</th><th className="p-3">Referencia / Operación</th><th className="p-3">Usuario / Motivo</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{filteredMovements.length === 0 ? <tr><td colSpan="6" className="p-8 text-center text-slate-400">No se encontraron movimientos.</td></tr> : filteredMovements.map((movement, index) => <tr key={movement.id || `${movement.producto_id}-${index}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40"><td className="p-3"><div className="text-[10px] text-slate-400">{formatDate(movement.created_at || movement.timestamp)}</div><strong className="text-slate-800 dark:text-slate-100">{movement.producto_nombre || movement.producto_id}</strong><div className="text-[10px] text-slate-400">{movement.sku || ''}</div></td><td className="p-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-black border uppercase ${badgeFor(movement.tipo, movement.cantidad)}`}>{movement.tipo || '—'}</span></td><td className={`p-3 text-right font-black ${Number(movement.cantidad) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{Number(movement.cantidad) > 0 ? '+' : ''}{movement.cantidad}</td><td className="p-3 text-center whitespace-nowrap"><span className="text-slate-400">{movement.stock_antes}</span><span className="mx-1 text-slate-300">→</span><strong>{movement.stock_despues}</strong></td><td className="p-3 max-w-[260px] break-words"><div className="font-mono text-[10px] text-slate-600 dark:text-slate-300">{movement.referencia_numero || movement.referencia_id || '—'}</div><div className="text-[10px] text-cyan-700 dark:text-cyan-400">op: {movement.operation_id || movement.metadata?.operationId || '—'}</div><div className="text-[10px] text-slate-400">{movement.referencia_tipo || ''}</div></td><td className="p-3 max-w-[220px] break-words"><div>{movement.usuario_nombre || 'Sistema'}</div><div className="text-[10px] text-slate-400">{movement.motivo || movement.observaciones || '—'}</div></td></tr>)}</tbody></table></div>
                    </div>
                </>
            )}
        </div>
    );
}
