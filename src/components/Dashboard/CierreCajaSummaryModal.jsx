import React, { useState } from 'react';
import { X, CheckCircle2, Printer, Download, Share2, AlertTriangle, Loader2, RefreshCw, CloudOff, BellRing } from 'lucide-react';
import { formatBs, formatCop } from '../../utils/calculatorUtils';

export default function CierreCajaSummaryModal({
    isOpen,
    onClose,
    summaryData,
    onPrint,
    onDownload,
    onShare,
    isBlindMode = false,
    syncStatus = 'idle',
    syncError = null,
    onRetrySync = null,
    signalPending = false,
    onRetrySignal = null,
}) {
    const [confirmCloseWhileSyncing, setConfirmCloseWhileSyncing] = useState(false);

    if (!isOpen || !summaryData) return null;

    const handleRequestClose = () => {
        if (syncStatus === 'syncing' && !confirmCloseWhileSyncing) {
            setConfirmCloseWhileSyncing(true);
            return;
        }
        setConfirmCloseWhileSyncing(false);
        onClose?.();
    };

    const {
        sales = [],
        todayTotalUsd = 0,
        todayTotalBs = 0,
        todayItemsSold = 0,
        reconData = {},
        copEnabled = false,
        tasaCop = 0,
    } = summaryData;

    // Diferencias
    const expectedUsd = reconData.expectedUsd || 0;
    const expectedBs = reconData.expectedBs || 0;
    const expectedCop = reconData.expectedCop || 0;

    const declaredUsd = reconData.declaredUsd ?? reconData.cashUsd ?? 0;
    const declaredBs = reconData.declaredBs ?? reconData.cashBs ?? 0;
    const declaredCop = reconData.declaredCop ?? reconData.cashCop ?? 0;

    const diffUsd = reconData.diffUsd ?? (declaredUsd - expectedUsd);
    const diffBs = reconData.diffBs ?? (declaredBs - expectedBs);
    const diffCop = reconData.diffCop ?? (declaredCop - expectedCop);

    const hasCop = copEnabled && (expectedCop > 0 || declaredCop > 0);
    const fmtCop = (v) => formatCop(v);

    // Determinar color de semáforo
    const isCuadrado = Math.abs(diffUsd) <= 0.50 && Math.abs(diffBs) <= expectedBs * 0.02 && (!hasCop || Math.abs(diffCop) <= expectedCop * 0.02);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 relative overflow-hidden">
                
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-3">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                            <CheckCircle2 size={18} />
                        </div>
                        <h3 className="text-base font-black text-slate-800 dark:text-white">Cierre Completado</h3>
                    </div>
                    <button
                        onClick={handleRequestClose}
                        className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Resumen Principal */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 rounded-2xl p-3 text-center">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Vendido USD</span>
                        <strong className="text-lg font-black text-slate-800 dark:text-white mt-0.5 block">${todayTotalUsd.toFixed(2)}</strong>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 rounded-2xl p-3 text-center">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Vendido Bs</span>
                        <strong className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-0.5 block">{formatBs(todayTotalBs)} Bs</strong>
                    </div>
                </div>

                {/* Detalles de Operaciones */}
                <div className="flex justify-between items-center text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800/30 rounded-xl">
                    <span className="font-semibold text-slate-500">Operaciones cerradas:</span>
                    <strong className="font-bold text-slate-700 dark:text-slate-200">{sales.length} transacciones ({todayItemsSold} art.)</strong>
                </div>

                {/* Cuadre de Arqueo Físico */}
                <div className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                        {isBlindMode ? 'Declaración de Efectivo (Cuadre Ciego)' : 'Cuadre de Efectivo'}
                    </span>
                    
                    <div className="border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden text-xs">
                        <div className={`grid ${isBlindMode ? 'grid-cols-2' : 'grid-cols-3'} gap-0 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 text-[10px] font-black text-slate-400 uppercase border-b border-slate-100 dark:border-slate-850`}>
                            <span>Moneda</span>
                            {!isBlindMode && <span className="text-center">Esperado</span>}
                            <span className="text-center">Declarado</span>
                        </div>

                        {/* USD Row */}
                        <div className={`grid ${isBlindMode ? 'grid-cols-2' : 'grid-cols-3'} gap-0 px-3 py-2.5 border-b border-slate-100 dark:border-slate-800/50`}>
                            <span className="font-bold text-slate-700 dark:text-slate-200">USD ($)</span>
                            {!isBlindMode && <span className="font-mono text-slate-500 text-center">${expectedUsd.toFixed(2)}</span>}
                            <span className="font-mono font-black text-center text-slate-800 dark:text-white">${declaredUsd.toFixed(2)}</span>
                        </div>

                        {/* Bs Row */}
                        <div className={`grid ${isBlindMode ? 'grid-cols-2' : 'grid-cols-3'} gap-0 px-3 py-2.5 border-b border-slate-100 dark:border-slate-800/50`}>
                            <span className="font-bold text-slate-700 dark:text-slate-200">Bs (Bs)</span>
                            {!isBlindMode && <span className="font-mono text-slate-500 text-center">{formatBs(expectedBs)}</span>}
                            <span className="font-mono font-black text-center text-slate-800 dark:text-white">{formatBs(declaredBs)}</span>
                        </div>

                        {/* COP Row */}
                        {hasCop && (
                            <div className={`grid ${isBlindMode ? 'grid-cols-2' : 'grid-cols-3'} gap-0 px-3 py-2.5 border-b border-slate-100 dark:border-slate-800/50`}>
                                <span className="font-bold text-amber-600 dark:text-amber-400">COP (Col)</span>
                                {!isBlindMode && <span className="font-mono text-slate-500 text-center">{fmtCop(expectedCop)}</span>}
                                <span className="font-mono font-black text-center text-slate-800 dark:text-white">{fmtCop(declaredCop)}</span>
                            </div>
                        )}

                        {/* Diferencia Summary */}
                        {!isBlindMode && (
                            <div className="grid grid-cols-3 gap-0 px-3 py-2 bg-slate-100/50 dark:bg-slate-800/30 text-[10px] font-black uppercase text-slate-400 border-t border-slate-100 dark:border-slate-800">
                                <span>Diferencia</span>
                                <span className={`text-center font-mono font-black ${diffUsd >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                                    {diffUsd >= 0 ? '+' : ''}${diffUsd.toFixed(2)}
                                </span>
                                <span className={`text-center font-mono font-black ${diffBs >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                                    {diffBs >= 0 ? '+' : ''}{formatBs(diffBs)}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Semáforo / Blind Alert */}
                    {isBlindMode ? (
                        <div className="p-3 rounded-2xl flex items-start gap-2.5 border text-[11px] leading-snug font-medium bg-slate-900 text-white border-slate-800">
                            <div className="shrink-0 mt-0.5 text-amber-400 font-bold">🔒</div>
                            <div>
                                Conteo registrado a ciegas. El reporte de discrepancias se guardó para revisión del Supervisor.
                            </div>
                        </div>
                    ) : (
                        <div className={`p-3 rounded-2xl flex items-start gap-2.5 border text-[11px] leading-snug font-medium ${
                            isCuadrado 
                                ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200/50 dark:border-emerald-900/30 text-emerald-700 dark:text-emerald-400' 
                                : 'bg-red-50 dark:bg-red-950/20 border-red-200/50 dark:border-red-900/30 text-red-700 dark:text-red-400'
                        }`}>
                            <div className="shrink-0 mt-0.5">
                                {isCuadrado ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                            </div>
                            <div>
                                {isCuadrado 
                                    ? 'Arqueo de caja cerrado en orden. Las discrepancias de efectivo se encuentran dentro del rango de tolerancia.' 
                                    : '¡Alerta de cuadre! Las declaraciones físicas ingresadas no coinciden con los saldos esperados por el sistema.'
                                }
                            </div>
                        </div>
                    )}
                </div>

                {/* Banner de estado de sincronización con el Supervisor (Fase 1 + Fase 2B) */}
                {syncStatus === 'syncing' && (
                    <div
                        role="status"
                        aria-live="polite"
                        className="p-3 rounded-2xl flex items-start gap-2.5 border text-[11px] leading-snug font-semibold bg-sky-50 dark:bg-sky-950/30 border-sky-200/70 dark:border-sky-800/50 text-sky-800 dark:text-sky-200"
                    >
                        <Loader2 size={15} className="shrink-0 mt-0.5 animate-spin text-sky-600 dark:text-sky-400" />
                        <div>
                            Sincronizando cierre con el Supervisor... No cierres el programa todavía.
                        </div>
                    </div>
                )}

                {syncStatus === 'synced' && (
                    <div
                        role="status"
                        aria-live="polite"
                        className="p-3 rounded-2xl space-y-2 border text-[11px] leading-snug font-semibold bg-emerald-50 dark:bg-emerald-950/25 border-emerald-200/70 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-300"
                    >
                        <div className="flex items-start gap-2.5">
                            <CheckCircle2 size={15} className="shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                            <div>Cierre enviado y confirmado en la nube para el Supervisor.</div>
                        </div>
                        {signalPending && (
                            <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-emerald-200/60 dark:border-emerald-800/40 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                                <span className="flex items-center gap-1.5">
                                    <BellRing size={12} className="shrink-0" />
                                    Aviso instantáneo al Supervisor pendiente.
                                </span>
                                {onRetrySignal && (
                                    <button
                                        type="button"
                                        onClick={onRetrySignal}
                                        className="shrink-0 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] transition-colors"
                                    >
                                        Reenviar aviso al Supervisor
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {syncStatus === 'failed' && (
                    <div
                        role="alert"
                        className="p-3 rounded-2xl space-y-2 border text-[11px] leading-snug font-semibold bg-amber-50 dark:bg-amber-950/30 border-amber-300/80 dark:border-amber-800/60 text-amber-900 dark:text-amber-200"
                    >
                        <div className="flex items-start gap-2.5">
                            <CloudOff size={15} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                            <div className="space-y-0.5">
                                <div>Cierre guardado en esta PC, pero no se pudo enviar al Supervisor aún.</div>
                                {syncError && (
                                    <div className="text-[10px] font-medium text-amber-700 dark:text-amber-300">
                                        {syncError}
                                    </div>
                                )}
                            </div>
                        </div>
                        {onRetrySync && (
                            <button
                                type="button"
                                onClick={onRetrySync}
                                className="w-full py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-black text-xs flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all"
                            >
                                <RefreshCw size={13} /> Reintentar envío ahora
                            </button>
                        )}
                    </div>
                )}

                {confirmCloseWhileSyncing && syncStatus === 'syncing' && (
                    <div className="p-3 rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/80 dark:bg-amber-950/20 text-[11px] space-y-2 text-amber-900 dark:text-amber-200">
                        <div className="font-semibold">
                            El cierre seguirá subiendo en segundo plano (visible en la barra superior). ¿Cerrar este resumen igual?
                        </div>
                        <div className="flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setConfirmCloseWhileSyncing(false)}
                                className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-[11px]"
                            >
                                Esperar
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setConfirmCloseWhileSyncing(false);
                                    onClose?.();
                                }}
                                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-[11px]"
                            >
                                Cerrar igual
                            </button>
                        </div>
                    </div>
                )}

                {/* Acciones principales */}
                <div className="space-y-2 pt-2">
                    <button
                        onClick={onPrint}
                        className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs shadow-md shadow-emerald-500/10 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                    >
                        <Printer size={15} /> Imprimir Ticket de Cierre
                    </button>

                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={onDownload}
                            className="py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 font-bold text-xs flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all"
                        >
                            <Download size={14} /> Descargar PDF
                        </button>
                        <button
                            onClick={onShare}
                            className="py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 font-bold text-xs flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all"
                        >
                            <Share2 size={14} /> Compartir Reporte
                        </button>
                    </div>

                    <button
                        onClick={handleRequestClose}
                        className="w-full py-2.5 text-center text-xs font-black text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors pt-2"
                    >
                        Entendido, Volver al Dashboard
                    </button>
                </div>
            </div>
        </div>
    );
}
