import React from 'react';

export default function MonitorCierresTab({ AlertTriangle, ChevronRight, Download, RotateCcw, ShieldCheck, Unlock, exportingCierreId, formatBs, formatTime, getFormattedPaymentMethod, getFormattedSaleCode, getMethodIcon, getPaymentBadgeStyle, getSaleChangeDetails, handleDownloadCierrePDF, handleReopenRemoteShift, registerCloses, selectedCierreId, setSelectedCierreId, setSelectedSaleDetail, shiftStatusInfo, triggerHaptic }) {
    return (
                    <div>
                        {registerCloses.length === 0 ? (
                            <div className="py-16 px-6 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm space-y-4 max-w-lg mx-auto flex flex-col items-center">
                                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 text-slate-450 rounded-full">
                                    <ShieldCheck size={42} />
                                </div>
                                <div className="space-y-1">
                                    <h4 className="text-sm font-black text-slate-800 dark:text-white">Sin cierres registrados</h4>
                                    <p className="text-xs text-slate-400 leading-relaxed px-4">
                                        Cuando el cajero complete un cierre de caja en el dispositivo principal, aparecerá el arqueo detallado, reporte contable y discrepancias aquí.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* Selector / Lista de Cierres */}
                                <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-3xl p-5 shadow-sm h-fit space-y-4">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Historial de Cierres</span>
                                    <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                                        {registerCloses.map(c => {
                                            const dateObj = new Date(c.timestamp || c.cierreId);
                                            const isValidDate = !isNaN(dateObj.getTime());
                                            const isSelected = selectedCierreId === c.cierreId || (!selectedCierreId && registerCloses[0].cierreId === c.cierreId);
                                            const isExportingThis = exportingCierreId === c.cierreId;
                                            return (
                                                <div
                                                    key={c.cierreId}
                                                    onClick={() => setSelectedCierreId(c.cierreId)}
                                                    className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 cursor-pointer ${
                                                        isSelected 
                                                            ? 'bg-emerald-500/10 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-400' 
                                                            : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/40 dark:hover:bg-slate-800/80 border-slate-200/65 dark:border-slate-800/60 text-slate-600 dark:text-slate-300'
                                                    }`}
                                                >
                                                    <div className="min-w-0 flex-1">
                                                        <span className="text-xs font-black block truncate">
                                                            Cierre #{c.cierreNumber || String(c.cierreId).slice(-4)}
                                                        </span>
                                                        <span className="text-[9px] text-slate-400 font-bold block mt-0.5">
                                                            {isValidDate ? `${dateObj.toLocaleDateString()} • ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Fecha no disponible'}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <span className="font-outfit text-xs font-black tabular-nums">${c.totalUsd.toFixed(2)}</span>
                                                        <button
                                                            onClick={(e) => handleDownloadCierrePDF(c, e)}
                                                            disabled={isExportingThis}
                                                            className="p-1.5 rounded-xl text-slate-400 hover:text-emerald-600 hover:bg-emerald-100/60 dark:hover:bg-emerald-950/50 transition-colors disabled:opacity-50 active:scale-95"
                                                            title="Descargar PDF de este Cierre"
                                                        >
                                                            <Download size={14} className={isExportingThis ? "animate-spin text-emerald-500" : ""} />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Zona de Resumen del Cierre Seleccionado */}
                                <div className="lg:col-span-2 space-y-6">
                                    {(() => {
                                        const activeC = registerCloses.find(c => c.cierreId === selectedCierreId) || registerCloses[0];
                                        if (!activeC) return null;

                                        const expectedUsd = activeC.reconData?.expectedUsd ?? activeC.reconData?.expectedCashUsd ?? activeC.totalUsd ?? 0;
                                        const expectedBs = activeC.reconData?.expectedBs ?? activeC.reconData?.expectedCashBs ?? 0;
                                        const expectedCop = activeC.reconData?.expectedCop ?? 0;

                                        // Declarados (compatibilidad total con declared* y cash*)
                                        const declaredUsd = activeC.reconData?.declaredUsd ?? activeC.reconData?.cashUsd ?? null;
                                        const declaredBs = activeC.reconData?.declaredBs ?? activeC.reconData?.cashBs ?? null;
                                        const declaredCop = activeC.reconData?.declaredCop ?? activeC.reconData?.cashCop ?? null;

                                        const diffUsd = activeC.reconData?.diffUsd ?? (declaredUsd !== null ? declaredUsd - expectedUsd : null);
                                        const diffBs = activeC.reconData?.diffBs ?? (declaredBs !== null ? declaredBs - expectedBs : null);
                                        const diffCop = activeC.reconData?.diffCop ?? (declaredCop !== null ? declaredCop - expectedCop : null);

                                        const isCuadrado = declaredUsd === null || (
                                            Math.abs(diffUsd ?? 0) <= 0.50 &&
                                            Math.abs(diffBs ?? 0) <= Math.max(expectedBs * 0.02, 5) &&
                                            (expectedCop === 0 || Math.abs(diffCop ?? 0) <= Math.max(expectedCop * 0.02, 500))
                                        );
                                        const isExportingActive = exportingCierreId === activeC.cierreId;
                                        const activeCloseDate = new Date(activeC.timestamp || activeC.cierreId);
                                        const isValidActiveDate = !isNaN(activeCloseDate.getTime());

                                        return (
                                            <div className="space-y-6 animate-fade-in">
                                                {/* Header & Botón de Descarga PDF */}
                                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 p-4 rounded-3xl shadow-sm">
                                                    <div>
                                                        <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                                                            <span>Cierre #{activeC.cierreNumber || String(activeC.cierreId).slice(-4)}</span>
                                                            <span className="text-xs text-slate-400 font-medium">
                                                                ({isValidActiveDate ? `${activeCloseDate.toLocaleDateString()} • ${activeCloseDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Fecha no disponible'})
                                                            </span>
                                                        </h3>
                                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Cajero: {activeC.cashier?.nombre || 'Cajero'}</p>
                                                    </div>

                                                    <button
                                                        onClick={(e) => handleDownloadCierrePDF(activeC, e)}
                                                        disabled={isExportingActive}
                                                        className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold rounded-2xl shadow-sm transition-all flex items-center justify-center gap-2 shrink-0 cursor-pointer disabled:opacity-50"
                                                    >
                                                        <Download size={15} className={isExportingActive ? "animate-spin" : ""} />
                                                        <span>{isExportingActive ? 'Generando PDF...' : 'Descargar PDF del Cierre'}</span>
                                                    </button>
                                                </div>

                                                {/* Resumen Principal */}
                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                                        <span className="text-[9px] font-black uppercase text-slate-400">Total USD</span>
                                                        <strong className="font-outfit text-base sm:text-lg font-black text-slate-800 dark:text-white block mt-1">${activeC.totalUsd.toFixed(2)}</strong>
                                                    </div>
                                                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                                        <span className="text-[9px] font-black uppercase text-slate-400">Total Bs</span>
                                                        <strong className="font-outfit text-base sm:text-lg font-black text-emerald-600 dark:text-emerald-400 block mt-1">{formatBs(activeC.totalBs)} Bs</strong>
                                                    </div>
                                                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                                        <span className="text-[9px] font-black uppercase text-slate-400">Cajero</span>
                                                        <strong className="text-xs font-black text-slate-700 dark:text-slate-200 block truncate mt-1">{activeC.cashier?.nombre || 'Cajero'}</strong>
                                                    </div>
                                                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                                        <span className="text-[9px] font-black uppercase text-slate-400">Arqueo Físico</span>
                                                        <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md inline-block mt-1 ${
                                                            declaredUsd === null 
                                                                ? 'bg-slate-100 dark:bg-slate-800 text-slate-500' 
                                                                : isCuadrado 
                                                                    ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400' 
                                                                    : 'bg-amber-100 dark:bg-amber-955/30 text-amber-700 dark:text-amber-400 animate-pulse'
                                                        }`}>
                                                            {declaredUsd === null ? 'Sin Declarar' : isCuadrado ? 'Cuadrado' : 'Diferencia'}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Botón de Acción Remota: Reabrir / Restaurar Turno (Solo visible si la caja está cerrada) */}
                                                {!shiftStatusInfo.isOpen && (
                                                    <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 p-4 rounded-2xl">
                                                        <div>
                                                            <h4 className="text-xs font-black text-amber-900 dark:text-amber-400">¿Cierre accidental o error de turno?</h4>
                                                            <p className="text-[10px] text-amber-700 dark:text-amber-500 font-medium">Reabre este turno en la caja para continuar registrando ventas en él.</p>
                                                        </div>
                                                        <button
                                                            onClick={() => handleReopenRemoteShift(activeC.cierreId)}
                                                            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white text-xs font-bold rounded-xl shadow-sm transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
                                                        >
                                                            <Unlock size={14} />
                                                            Reabrir Turno
                                                        </button>
                                                    </div>
                                                )}

                                                {/* Arqueo Detallado de Efectivo */}
                                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-5 shadow-sm">
                                                    <h3 className="text-xs font-black text-slate-800 dark:text-white mb-4 uppercase tracking-wider">Cuadre de Efectivo</h3>
                                                    
                                                    {declaredUsd === null ? (
                                                        <div className="py-6 px-4 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-100 dark:border-amber-900/30 rounded-2xl text-center">
                                                            <AlertTriangle size={24} className="text-amber-500 mx-auto mb-1.5" />
                                                            <p className="text-xs font-black text-amber-800 dark:text-amber-400">Cierre sin arqueo físico registrado</p>
                                                            <p className="text-[10px] text-slate-500 mt-0.5">El cierre se completó sin declaración física de efectivo en gaveta.</p>
                                                        </div>
                                                    ) : (
                                                        <div className="border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden text-xs">
                                                            <div className="grid grid-cols-4 gap-2 px-4 py-2 bg-slate-50 dark:bg-slate-850/50 text-[10px] font-black text-slate-400 uppercase border-b border-slate-150 dark:border-slate-800">
                                                                <span>Moneda</span>
                                                                <span className="text-center">Esperado</span>
                                                                <span className="text-center">Declarado</span>
                                                                <span className="text-right">Diferencia</span>
                                                            </div>

                                                            {/* USD Row */}
                                                            <div className="grid grid-cols-4 gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800 items-center">
                                                                <span className="font-bold text-slate-700 dark:text-slate-200">Dólares ($)</span>
                                                                <span className="font-outfit font-mono text-slate-400 text-center">${expectedUsd.toFixed(2)}</span>
                                                                <span className="font-outfit font-mono font-black text-slate-700 dark:text-white text-center">${(declaredUsd || 0).toFixed(2)}</span>
                                                                <span className={`font-outfit font-mono font-black text-right ${
                                                                    Math.abs(diffUsd ?? 0) <= 0.01 ? 'text-slate-400' : (diffUsd ?? 0) > 0 ? 'text-emerald-600' : 'text-rose-600'
                                                                }`}>
                                                                    {(diffUsd ?? 0) > 0.009 ? '+' : ''}{(diffUsd ?? 0) < -0.009 ? '-' : ''}${Math.abs(diffUsd ?? 0).toFixed(2)}
                                                                </span>
                                                            </div>

                                                            {/* Bs Row */}
                                                            <div className="grid grid-cols-4 gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800 items-center">
                                                                <span className="font-bold text-slate-700 dark:text-slate-200">Bolívares (Bs)</span>
                                                                <span className="font-outfit font-mono text-slate-400 text-center">{formatBs(expectedBs)} Bs</span>
                                                                <span className="font-outfit font-mono font-black text-slate-700 dark:text-white text-center">{formatBs(declaredBs || 0)} Bs</span>
                                                                <span className={`font-outfit font-mono font-black text-right ${
                                                                    Math.abs(diffBs ?? 0) <= 0.05 
                                                                        ? 'text-slate-400' 
                                                                        : (diffBs ?? 0) > 0 
                                                                            ? 'text-emerald-600' 
                                                                            : 'text-rose-600'
                                                                }`}>
                                                                    {(diffBs ?? 0) > 0.05 ? '+' : ''}
                                                                    {formatBs(diffBs ?? 0)} Bs
                                                                </span>
                                                            </div>

                                                            {/* COP Row si aplica */}
                                                            {(expectedCop > 0 || (declaredCop !== null && declaredCop > 0)) && (
                                                                <div className="grid grid-cols-4 gap-2 px-4 py-3 items-center">
                                                                    <span className="font-bold text-slate-700 dark:text-slate-200">Pesos (COP)</span>
                                                                    <span className="font-outfit font-mono text-slate-400 text-center">{Math.round(expectedCop).toLocaleString('es-CO')} COP</span>
                                                                    <span className="font-outfit font-mono font-black text-slate-700 dark:text-white text-center">{Math.round(declaredCop || 0).toLocaleString('es-CO')} COP</span>
                                                                    <span className={`font-outfit font-mono font-black text-right ${
                                                                        Math.abs(diffCop ?? 0) <= 50 
                                                                            ? 'text-slate-400' 
                                                                            : (diffCop ?? 0) > 0 
                                                                                ? 'text-emerald-600' 
                                                                                : 'text-rose-600'
                                                                    }`}>
                                                                        {(diffCop ?? 0) > 50 ? '+' : ''}
                                                                        {Math.round(diffCop ?? 0).toLocaleString('es-CO')} COP
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Desglose de Métodos de Pago */}
                                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-5 shadow-sm">
                                                    <h3 className="text-xs font-black text-slate-800 dark:text-white mb-4 uppercase tracking-wider">Desglose de Ingresos</h3>
                                                    <div className="space-y-2.5">
                                                        {activeC.paymentBreakdown.map(([methodId, data]) => {
                                                            const IconComp = getMethodIcon(methodId);
                                                            const pct = activeC.totalUsd > 0 ? Math.round((data.totalUsd / activeC.totalUsd) * 100) : 0;
                                                            return (
                                                                <div key={methodId} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800 rounded-2xl">
                                                                    <div className="w-8 h-8 bg-white dark:bg-slate-800 border border-slate-150 dark:border-slate-700 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
                                                                        <IconComp size={14} />
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="flex items-center justify-between text-xs">
                                                                            <span className="font-black text-slate-700 dark:text-slate-200">{data.label}</span>
                                                                            <span className="font-outfit font-black text-slate-800 dark:text-white">${data.totalUsd.toFixed(2)}</span>
                                                                        </div>
                                                                        <div className="flex items-center justify-between text-[10px] text-slate-400 mt-0.5">
                                                                            <span>{data.count} tx • {pct}%</span>
                                                                            <span className="font-outfit">{formatBs(data.totalBs)} Bs</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>

                                                {/* Ventas del Cierre */}
                                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-6 shadow-sm">
                                                    <h3 className="text-xs font-black text-slate-800 dark:text-white mb-4 uppercase tracking-wider">Ventas Cerradas en este Turno</h3>
                                                    <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                                                        {activeC.sales.slice().sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map(sale => {
                                                            const isVoided = sale.status === 'ANULADA';
                                                            return (
                                                                <div 
                                                                    key={sale.id}
                                                                    onClick={() => { triggerHaptic?.(); setSelectedSaleDetail(sale); }}
                                                                    className={`p-3.5 border rounded-2xl flex flex-col sm:flex-row justify-between items-start gap-2.5 transition-all duration-200 cursor-pointer active:scale-[0.99] shadow-sm hover:shadow-md group ${
                                                                        isVoided 
                                                                            ? 'border-rose-200/80 dark:border-rose-900/50 bg-rose-50/40 dark:bg-rose-950/20 opacity-80 hover:bg-rose-50/80 dark:hover:bg-rose-950/40' 
                                                                            : 'border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 hover:bg-white dark:hover:bg-slate-800/50'
                                                                    }`}
                                                                >
                                                                    <div className="min-w-0 flex-1 w-full space-y-1">
                                                                        <div className="flex items-center justify-between sm:justify-start gap-2">
                                                                            {isVoided ? (
                                                                                <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-900/60 flex items-center gap-1">
                                                                                    <AlertTriangle size={9} /> {getFormattedSaleCode(sale)} • ANULADA
                                                                                </span>
                                                                            ) : (
                                                                                <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/40">
                                                                                    {getFormattedSaleCode(sale)}
                                                                                </span>
                                                                            )}
                                                                            <span className="text-[9px] text-slate-400 font-bold">{formatTime(sale.timestamp)}</span>
                                                                            <div className="sm:hidden text-right">
                                                                                <span className={`font-outfit font-black ${isVoided ? 'text-rose-600 dark:text-rose-400 line-through' : 'text-slate-850 dark:text-white'}`}>
                                                                                    ${(sale.totalUsd || 0).toFixed(2)}
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                        <p className={`font-black leading-snug break-words pr-1 text-xs ${isVoided ? 'text-slate-600 dark:text-slate-400 line-through' : 'text-slate-850 dark:text-slate-100'}`}>
                                                                            {sale.items?.map(i => `${i.name} (x${i.qty})`).join(', ') || 'Venta de productos'}
                                                                        </p>
                                                                        <div className="flex items-center justify-between pt-1">
                                                                            <div className="flex gap-2 items-center flex-wrap">
                                                                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md ${isVoided ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-200/60' : getPaymentBadgeStyle(sale)}`}>
                                                                                    {isVoided ? 'ANULADA' : getFormattedPaymentMethod(sale)}
                                                                                </span>
                                                                                {!isVoided && (() => {
                                                                                     const { changeUsd, changeBs, hasChange } = getSaleChangeDetails(sale);
                                                                                     if (!hasChange) return null;
                                                                                     return (
                                                                                         <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 flex items-center gap-1 shadow-xs">
                                                                                             <RotateCcw size={9} />
                                                                                             Vuelto: {changeUsd > 0 ? `$${changeUsd.toFixed(2)}` : `${formatBs(changeBs)} Bs`}
                                                                                         </span>
                                                                                     );
                                                                                 })()}
                                                                                {sale.clientName && (
                                                                                    <span className="text-[9px] text-slate-500 dark:text-slate-400 font-bold">• {sale.clientName}</span>
                                                                                )}
                                                                            </div>
                                                                            <span className={`text-[9px] font-black flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform ${isVoided ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                                                                Ver detalle <ChevronRight size={11} />
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="hidden sm:block text-right shrink-0 space-y-0.5">
                                                                        <span className={`font-outfit font-black block ${isVoided ? 'text-rose-600 dark:text-rose-400 line-through' : 'text-slate-850 dark:text-white'}`}>
                                                                            ${(sale.totalUsd || 0).toFixed(2)}
                                                                        </span>
                                                                        <span className={`font-outfit text-[9px] block ${isVoided ? 'text-rose-400/80 line-through' : 'text-slate-400'}`}>
                                                                            {formatBs(sale.totalBs || 0)} Bs
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>
                        )}
                    </div>
    );
}
