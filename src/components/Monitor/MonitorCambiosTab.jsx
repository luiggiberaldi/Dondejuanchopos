import React from 'react';

export default function MonitorCambiosTab({ ChevronLeft, ChevronRight, Clock, ITEMS_PER_PAGE_CAMBIOS, ShieldCheck, Trash2, allCloudCmds, cancelAllCloudCmds, cancelSingleCloudCmd, cancellingCmdId, cloudPendingCmds, cmdTabFilter, currentPageCambios, discardSinglePendingChange, getSupervisorCommandDetails, isConnected, isDuplicateProductIdFailure, pendingChanges, products, queueInventoryChange, setCmdTabFilter, setCurrentPageCambios, setShowDiscardQueueModal, showToast, triggerHaptic, triggerRefresh, uploadPendingChanges, uploading }) {
    return (
                    <div className="space-y-6 animate-fade-in">
                        {/* Tarjetas resumen de estado de cambios */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                            {/* Cola Local (Sin Subir) */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Cola Local (Sin Subir)</span>
                                <div className="flex items-end justify-between mt-2">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-blue-600 dark:text-blue-400 tabular-nums leading-none">
                                        {pendingChanges.length}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-bold">En navegador</span>
                                </div>
                            </div>

                            {/* Pendientes en Nube */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">En Espera en Nube</span>
                                <div className="flex items-end justify-between mt-2">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-amber-500 tabular-nums leading-none">
                                        {cloudPendingCmds.length}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-bold">Espera a la caja</span>
                                </div>
                            </div>

                            {/* Aplicados en Caja */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Aplicados por la Caja</span>
                                <div className="flex items-end justify-between mt-2">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums leading-none">
                                        {allCloudCmds.filter(c => c.status === 'applied').length}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-bold">Completados</span>
                                </div>
                            </div>

                            {/* Anulados */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Anulados / Cancelados</span>
                                <div className="flex items-end justify-between mt-2">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-rose-500 tabular-nums leading-none">
                                        {allCloudCmds.filter(c => c.status === 'cancelled').length}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-bold">Cancelados</span>
                                </div>
                            </div>
                        </div>

                        {/* Barra de Filtros de Cambios y Acciones Masivas */}
                        <div className="bg-white dark:bg-slate-900 p-3.5 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                            <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-2xl border border-slate-200/60 dark:border-slate-800 overflow-x-auto scrollbar-hide gap-1 max-w-full">
                                <button
                                    onClick={() => { setCmdTabFilter('todos'); setCurrentPageCambios(1); }}
                                    className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-black transition-all shrink-0 min-h-[36px] ${
                                        cmdTabFilter === 'todos' ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                                    }`}
                                >
                                    Todos ({pendingChanges.length + allCloudCmds.length})
                                </button>
                                <button
                                    onClick={() => { setCmdTabFilter('pending'); setCurrentPageCambios(1); }}
                                    className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-black transition-all shrink-0 min-h-[36px] ${
                                        cmdTabFilter === 'pending' ? 'bg-amber-500 text-white shadow-xs' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                                    }`}
                                >
                                    Pendientes ({pendingChanges.length + cloudPendingCmds.length})
                                </button>
                                <button
                                    onClick={() => { setCmdTabFilter('applied'); setCurrentPageCambios(1); }}
                                    className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-black transition-all shrink-0 min-h-[36px] ${
                                        cmdTabFilter === 'applied' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                                    }`}
                                >
                                    Aplicados ({allCloudCmds.filter(c => c.status === 'applied').length})
                                </button>
                                <button
                                    onClick={() => { setCmdTabFilter('cancelled'); setCurrentPageCambios(1); }}
                                    className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-black transition-all shrink-0 min-h-[36px] ${
                                        cmdTabFilter === 'cancelled' ? 'bg-rose-500 text-white shadow-xs' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                                    }`}
                                >
                                    Anulados ({allCloudCmds.filter(c => c.status === 'cancelled').length})
                                </button>
                                <button
                                    onClick={() => { setCmdTabFilter('failed'); setCurrentPageCambios(1); }}
                                    className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-black transition-all shrink-0 min-h-[36px] ${
                                        cmdTabFilter === 'failed' ? 'bg-orange-500 text-white shadow-xs' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                                    }`}
                                >
                                    Rechazados ({allCloudCmds.filter(c => c.status === 'failed').length})
                                </button>
                            </div>

                            {/* Acciones globales */}
                            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                                {pendingChanges.length > 0 && (
                                    <>
                                        <button
                                            onClick={() => { triggerHaptic?.(); setShowDiscardQueueModal(true); }}
                                            className="flex-1 sm:flex-none px-3.5 py-2 rounded-2xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 text-xs font-black uppercase tracking-wider shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1.5"
                                        >
                                            <Trash2 size={13} />
                                            <span>Cancelar Cola ({pendingChanges.length})</span>
                                        </button>
                                        <button
                                            onClick={uploadPendingChanges}
                                            disabled={uploading || !isConnected}
                                            className="flex-1 sm:flex-none px-4 py-2 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-black uppercase tracking-wider shadow-md shadow-emerald-500/25 transition-all cursor-pointer disabled:opacity-40"
                                        >
                                            Subir Cola Local ({pendingChanges.length})
                                        </button>
                                    </>
                                )}
                                {cloudPendingCmds.length > 0 && (
                                    <button
                                        onClick={cancelAllCloudCmds}
                                        className="flex-1 sm:flex-none px-4 py-2 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-black uppercase tracking-wider shadow-md shadow-rose-500/25 transition-all cursor-pointer"
                                    >
                                        Anular Nube 🚫
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Construcción de Lista Paginada */}
                        {(() => {
                            const rawCmdList = [
                                ...(cmdTabFilter === 'todos' || cmdTabFilter === 'pending' 
                                    ? pendingChanges.map((c, i) => ({ isLocal: true, data: c, localIndex: i, key: `local-${i}` })) 
                                    : []),
                                ...allCloudCmds
                                    .filter(cmd => {
                                        if (cmdTabFilter === 'pending') return cmd.status === 'pending';
                                        if (cmdTabFilter === 'applied') return cmd.status === 'applied';
                                        if (cmdTabFilter === 'cancelled') return cmd.status === 'cancelled';
                                        if (cmdTabFilter === 'failed') return cmd.status === 'failed';
                                        return true;
                                    })
                                    .map(cmd => ({ isLocal: false, data: cmd, key: `cloud-${cmd.id}` }))
                            ];

                            const totalPagesCambios = Math.max(1, Math.ceil(rawCmdList.length / ITEMS_PER_PAGE_CAMBIOS));
                            const safePage = Math.min(currentPageCambios, totalPagesCambios);
                            const paginatedItems = rawCmdList.slice(
                                (safePage - 1) * ITEMS_PER_PAGE_CAMBIOS,
                                safePage * ITEMS_PER_PAGE_CAMBIOS
                            );

                            return (
                                <div className="space-y-4">
                                    <div className="space-y-3">
                                        {paginatedItems.map(item => {
                                            const info = getSupervisorCommandDetails(item, products);

                                            if (item.isLocal) {
                                                const change = item.data;
                                                return (
                                                    <div key={item.key} className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-blue-200 dark:border-blue-900/60 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                                                        <div className="min-w-0 space-y-1.5 flex-1">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-lg bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                                                    EN COLA LOCAL (Sin Subir)
                                                                </span>
                                                                <span className="text-[10px] text-slate-400 font-bold">
                                                                    Encolado a las {new Date(change.queuedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <h4 className="text-sm sm:text-base font-black text-slate-800 dark:text-white truncate">{info.title}</h4>
                                                                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${info.actionColor}`}>
                                                                    {info.actionLabel}
                                                                </span>
                                                            </div>
                                                            {info.details.length > 0 && (
                                                                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                                                                    {info.details.map((det, dIdx) => (
                                                                        <span key={dIdx} className="text-[10.5px] font-bold px-2 py-0.5 rounded-lg bg-slate-100/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-slate-200/50 dark:border-slate-700/50">
                                                                            {det}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2 shrink-0">
                                                            <button
                                                                onClick={() => { triggerHaptic?.(); discardSinglePendingChange(item.localIndex); }}
                                                                className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-rose-950/40 text-slate-600 hover:text-rose-600 dark:text-slate-300 dark:hover:text-rose-400 border border-slate-200/80 dark:border-slate-700 hover:border-rose-200 dark:hover:border-rose-800 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                                                                title="Descartar este cambio de la cola local"
                                                            >
                                                                <Trash2 size={13} />
                                                                <span>Descartar</span>
                                                            </button>
                                                            <button
                                                                onClick={uploadPendingChanges}
                                                                disabled={uploading || !isConnected}
                                                                className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black uppercase tracking-wider shadow-xs transition-colors cursor-pointer disabled:opacity-40"
                                                            >
                                                                Subir ahora ☁️
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            }

                                            const cmd = item.data;
                                            const payload = cmd.payload || {};
                                            const createdTime = new Date(cmd.created_at || payload.issuedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                            const appliedTime = cmd.applied_at ? new Date(cmd.applied_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

                                            let statusBadge = null;
                                            if (cmd.status === 'pending') {
                                                statusBadge = (
                                                    <span className="text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800 animate-pulse">
                                                        EN ESPERA EN NUBE
                                                    </span>
                                                );
                                            } else if (cmd.status === 'applied') {
                                                statusBadge = (
                                                    <span className="text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                                        APLICADO EN CAJA EL {new Date(cmd.applied_at).toLocaleDateString()}
                                                    </span>
                                                );
                                            } else if (cmd.status === 'cancelled') {
                                                statusBadge = (
                                                    <span className="text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-lg bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                                                        ANULADO
                                                    </span>
                                                );
                                            } else if (cmd.status === 'failed') {
                                                statusBadge = (
                                                    <span className="text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-lg bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
                                                        RECHAZADO POR LA CAJA
                                                    </span>
                                                );
                                            }

                                            return (
                                                <div key={item.key} className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                                                    <div className="min-w-0 space-y-1.5 flex-1">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            {statusBadge}
                                                            <span className="text-[10px] text-slate-400 font-bold">Enviado: {createdTime}</span>
                                                            {appliedTime && (
                                                                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">· Aplicado a las {appliedTime}</span>
                                                            )}
                                                            {info.author && (
                                                                <span className="text-[10px] text-slate-400 font-medium ml-auto">Por: {info.author}</span>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <h4 className="text-sm sm:text-base font-black text-slate-800 dark:text-white truncate">{info.title}</h4>
                                                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${info.actionColor}`}>
                                                                {info.actionLabel}
                                                            </span>
                                                        </div>
                                                        {info.details.length > 0 && (
                                                            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                                                                {info.details.map((det, dIdx) => (
                                                                    <span key={dIdx} className="text-[10.5px] font-bold px-2 py-0.5 rounded-lg bg-slate-100/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-slate-200/50 dark:border-slate-700/50">
                                                                        {det}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {cmd.status === 'failed' && cmd.error_reason && (
                                                            <p className="text-[11px] font-bold text-orange-600 dark:text-orange-400 pt-1">⚠️ {cmd.error_reason}</p>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        {cmd.status === 'pending' && (
                                                            <button
                                                                onClick={() => cancelSingleCloudCmd(cmd.id)}
                                                                disabled={cancellingCmdId === cmd.id}
                                                                className="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-xs font-black uppercase transition-colors shrink-0 disabled:opacity-40 cursor-pointer"
                                                            >
                                                                {cancellingCmdId === cmd.id ? 'Anulando...' : 'Anular 🚫'}
                                                            </button>
                                                        )}
                                                        {cmd.status === 'failed' && cmd.command_type === 'inventory_update' && !isDuplicateProductIdFailure(cmd) && (
                                                            <button
                                                                onClick={() => {
                                                                    const p = cmd.payload || {};
                                                                    queueInventoryChange(p.action, p.productId, p.data);
                                                                    showToast('Cambio devuelto a la cola local', 'info');
                                                                }}
                                                                className="px-3.5 py-2 rounded-xl bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/40 text-orange-600 dark:text-orange-300 border border-orange-200 dark:border-orange-800 text-xs font-black uppercase transition-colors shrink-0 cursor-pointer"
                                                            >
                                                                Reintentar ↺
                                                            </button>
                                                        )}
                                                        {cmd.status === 'failed' && cmd.command_type === 'inventory_update' && isDuplicateProductIdFailure(cmd) && (
                                                            <button
                                                                onClick={async () => {
                                                                    showToast('El producto ya existe en la caja. Actualizando catálogo...', 'info');
                                                                    await triggerRefresh();
                                                                }}
                                                                className="px-3.5 py-2 rounded-xl bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 text-xs font-black uppercase transition-colors shrink-0 cursor-pointer"
                                                            >
                                                                Actualizar catálogo
                                                            </button>
                                                        )}
                                                        {cmd.status === 'applied' && (
                                                            <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                                                <ShieldCheck size={16} /> Aplicado por la caja
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {rawCmdList.length === 0 && (
                                            <div className="py-12 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl">
                                                <Clock size={32} className="mx-auto text-slate-300 mb-2" />
                                                <p className="text-xs font-black">Sin historial de cambios registrados</p>
                                                <p className="text-[10px] text-slate-450 mt-1">Las modificaciones de inventario y precios aparecerán aquí.</p>
                                            </div>
                                        )}
                                    </div>

                                    {/* Controles de Paginación para Cambios */}
                                    {totalPagesCambios > 1 && (
                                        <div className="flex items-center justify-between bg-white dark:bg-slate-900 px-4 py-3 sm:px-6 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm mt-4">
                                            <button
                                                onClick={() => {
                                                    if (safePage > 1) {
                                                        triggerHaptic?.();
                                                        setCurrentPageCambios(prev => Math.max(1, prev - 1));
                                                    }
                                                }}
                                                disabled={safePage === 1}
                                                className="p-2 rounded-xl text-slate-500 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-slate-800 dark:hover:text-emerald-450 border border-slate-200 dark:border-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors duration-150 cursor-pointer"
                                            >
                                                <ChevronLeft size={16} />
                                            </button>

                                            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                                                Página <span className="font-black text-slate-800 dark:text-white">{safePage}</span> de <span className="font-black text-slate-800 dark:text-white">{totalPagesCambios}</span>
                                                <span className="text-slate-400 text-[10px] ml-2 font-medium">({rawCmdList.length} registros)</span>
                                            </span>

                                            <button
                                                onClick={() => {
                                                    if (safePage < totalPagesCambios) {
                                                        triggerHaptic?.();
                                                        setCurrentPageCambios(prev => Math.min(totalPagesCambios, prev + 1));
                                                    }
                                                }}
                                                disabled={safePage === totalPagesCambios}
                                                className="p-2 rounded-xl text-slate-500 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-slate-800 dark:hover:text-emerald-450 border border-slate-200 dark:border-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors duration-150 cursor-pointer"
                                            >
                                                <ChevronRight size={16} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
    );
}
