import React from 'react';

export default function MonitorGastosTab({ Box, Clock, Lightbulb, Package, Receipt, ShoppingBag, Truck, User, Wrench, activeShiftAutoconsumoMetrics, activeShiftExpensesMetrics, formatBs, formatCop, getPaymentLabel }) {
    return (
                    <div className="space-y-6 animate-in fade-in">
                        {/* ── SUBSECCIÓN 1: EGRESOS DE CAJA CHICA (DINERO) ── */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 rounded-3xl shadow-sm">
                            <div>
                                <h3 className="text-base sm:text-lg font-black text-slate-800 dark:text-white flex items-center gap-2 flex-wrap">
                                    <span>Gastos de Caja Chica (Dinero)</span>
                                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 font-bold border border-rose-200 dark:border-rose-900/50">
                                        {activeShiftExpensesMetrics.count} {activeShiftExpensesMetrics.count === 1 ? 'egreso' : 'egresos'}
                                    </span>
                                </h3>
                                <p className="text-xs text-slate-400 font-medium mt-0.5">
                                    Dinero en efectivo o transferencia retirado de caja física durante el turno activo.
                                </p>
                            </div>

                            {/* Tarjetas Totales Dinero */}
                            <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
                                <div className="flex-1 sm:flex-initial bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-900/40 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-2xl text-right">
                                    <span className="text-[9px] font-black uppercase text-rose-500 tracking-wider block">Total USD</span>
                                    <span className="text-base sm:text-xl font-black text-rose-600 dark:text-rose-400 font-outfit tabular-nums">
                                        -${activeShiftExpensesMetrics.totalUsd.toFixed(2)}
                                    </span>
                                </div>
                                <div className="flex-1 sm:flex-initial bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-2xl text-right">
                                    <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block">Total Bs</span>
                                    <span className="text-base sm:text-xl font-black text-slate-700 dark:text-slate-200 font-outfit tabular-nums">
                                        -{formatBs(activeShiftExpensesMetrics.totalBs)} Bs
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Lista de Transacciones de Gastos de Caja */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-4 sm:p-6 shadow-sm">
                            <div className="flex items-center justify-between mb-4">
                                <h4 className="text-xs sm:text-sm font-black text-slate-800 dark:text-white uppercase tracking-wider">
                                    Detalle de Egresos de Caja
                                </h4>
                                <span className="text-[11px] sm:text-xs text-slate-400 font-medium">
                                    {activeShiftExpensesMetrics.gastosList.length} {activeShiftExpensesMetrics.gastosList.length === 1 ? 'egreso' : 'egresos'}
                                </span>
                            </div>

                            {activeShiftExpensesMetrics.gastosList.length === 0 ? (
                                <div className="py-8 text-center text-slate-400 space-y-2">
                                    <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-xl">
                                        <Receipt size={22} className="text-slate-400" />
                                    </div>
                                    <p className="text-xs font-bold">No hay egresos de caja registrados en el turno activo</p>
                                </div>
                            ) : (
                                <>
                                    {/* Vista Móvil */}
                                    <div className="space-y-3 md:hidden">
                                        {activeShiftExpensesMetrics.gastosList.map((gasto) => {
                                            const catObj = [
                                                { id: 'insumos', label: 'Insumos', icon: Box, color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40' },
                                                { id: 'servicios', label: 'Servicios', icon: Lightbulb, color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950/40' },
                                                { id: 'transporte', label: 'Transporte', icon: Truck, color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/40' },
                                                { id: 'personal', label: 'Personal', icon: User, color: 'text-purple-600 bg-purple-50 dark:bg-purple-950/40' },
                                                { id: 'mantenimiento', label: 'Mantenimiento', icon: Wrench, color: 'text-slate-700 bg-slate-100 dark:bg-slate-800' },
                                                { id: 'otros', label: 'Otros', icon: Receipt, color: 'text-rose-600 bg-rose-50 dark:bg-rose-950/40' },
                                            ].find(c => c.id === gasto.category) || { label: gasto.category || 'Otros', icon: Receipt, color: 'text-rose-600 bg-rose-50 dark:bg-rose-950/40' };

                                            const IconCat = catObj.icon;
                                            const date = gasto.timestamp ? new Date(gasto.timestamp) : new Date();
                                            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                                            const payment = Array.isArray(gasto.payments) && gasto.payments[0] ? gasto.payments[0] : null;
                                            const curr = gasto.currency || payment?.currency || (
                                                (gasto.paymentMethod && (gasto.paymentMethod.includes('usd') || gasto.paymentMethod.includes('zelle') || gasto.paymentMethod.includes('binance') || gasto.paymentMethod === 'dolares')) ? 'USD' :
                                                (gasto.paymentMethod && gasto.paymentMethod.includes('cop')) ? 'COP' : 'BS'
                                            );
                                            const isUsd = curr === 'USD';
                                            const isCop = curr === 'COP';
                                            const amountUsd = Math.abs(payment?.amountUsd ? payment.amountUsd : (gasto.totalUsd || 0));
                                            const amountBs = Math.abs(payment?.amountBs ? payment.amountBs : (gasto.totalBs || 0));
                                            const amountCop = Math.abs(payment?.amountCop ? payment.amountCop : (gasto.totalCop || 0));

                                            return (
                                                <div 
                                                    key={gasto.id} 
                                                    className="p-3.5 bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 rounded-2xl space-y-2.5"
                                                >
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-200/60 dark:border-slate-700/60">
                                                            <IconCat size={12} className={catObj.color.split(' ')[0]} />
                                                            <span>{catObj.label}</span>
                                                        </span>
                                                        <span className="text-[10px] font-mono font-medium text-slate-400">
                                                            {timeStr}
                                                        </span>
                                                    </div>

                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0 flex-1">
                                                            <h5 className="text-xs font-bold text-slate-800 dark:text-white leading-snug break-words">
                                                                {gasto.description || 'Gasto Interno'}
                                                            </h5>
                                                            {gasto.note && (
                                                                <p className="text-[10px] text-slate-400 font-normal italic mt-0.5 break-words">
                                                                    "{gasto.note}"
                                                                </p>
                                                            )}
                                                        </div>

                                                        <div className="text-right shrink-0">
                                                            {isUsd && (
                                                                <span className="text-xs sm:text-sm font-black font-outfit text-rose-600 dark:text-rose-400 block leading-tight">
                                                                    -${amountUsd.toFixed(2)}
                                                                </span>
                                                            )}
                                                            {isCop && (
                                                                <span className="text-xs sm:text-sm font-black font-outfit text-amber-600 dark:text-amber-400 block leading-tight">
                                                                    -{formatCop(amountCop)} COP
                                                                </span>
                                                            )}
                                                            {!isUsd && !isCop && (
                                                                <span className="text-xs sm:text-sm font-black font-outfit text-slate-700 dark:text-slate-200 block leading-tight">
                                                                    -{formatBs(amountBs)} Bs
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="pt-2 border-t border-slate-200/40 dark:border-slate-800/60 flex items-center justify-between text-[9.5px]">
                                                        <span className="font-bold text-slate-400 uppercase">Método:</span>
                                                        <span className="font-bold uppercase text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 px-2 py-0.5 rounded-md border border-slate-200/50 dark:border-slate-700/50">
                                                            {getPaymentLabel(gasto.paymentMethod) || (gasto.paymentMethod || 'Efectivo').replace(/_/g, ' ')}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Vista Escritorio */}
                                    <div className="hidden md:block overflow-x-auto">
                                        <table className="w-full text-left text-xs">
                                            <thead>
                                                <tr className="border-b border-slate-100 dark:border-slate-800 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                                    <th className="pb-3 px-2">Hora</th>
                                                    <th className="pb-3 px-2">Categoría</th>
                                                    <th className="pb-3 px-2">Descripción</th>
                                                    <th className="pb-3 px-2">Método</th>
                                                    <th className="pb-3 px-2 text-right">Monto (USD)</th>
                                                    <th className="pb-3 px-2 text-right">Monto (Bs)</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                                                {activeShiftExpensesMetrics.gastosList.map((gasto) => {
                                                    const catObj = [
                                                        { id: 'insumos', label: 'Insumos', icon: Box, color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40' },
                                                        { id: 'servicios', label: 'Servicios', icon: Lightbulb, color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950/40' },
                                                        { id: 'transporte', label: 'Transporte', icon: Truck, color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/40' },
                                                        { id: 'personal', label: 'Personal', icon: User, color: 'text-purple-600 bg-purple-50 dark:bg-purple-950/40' },
                                                        { id: 'mantenimiento', label: 'Mantenimiento', icon: Wrench, color: 'text-slate-700 bg-slate-100 dark:bg-slate-800' },
                                                        { id: 'otros', label: 'Otros', icon: Receipt, color: 'text-rose-600 bg-rose-50 dark:bg-rose-950/40' },
                                                    ].find(c => c.id === gasto.category) || { label: gasto.category || 'Otros', icon: Receipt, color: 'text-rose-600 bg-rose-50 dark:bg-rose-950/40' };

                                                    const IconCat = catObj.icon;
                                                    const date = gasto.timestamp ? new Date(gasto.timestamp) : new Date();
                                                    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                                                    const payment = Array.isArray(gasto.payments) && gasto.payments[0] ? gasto.payments[0] : null;
                                                    const curr = gasto.currency || payment?.currency || (
                                                        (gasto.paymentMethod && (gasto.paymentMethod.includes('usd') || gasto.paymentMethod.includes('zelle') || gasto.paymentMethod.includes('binance') || gasto.paymentMethod === 'dolares')) ? 'USD' :
                                                        (gasto.paymentMethod && gasto.paymentMethod.includes('cop')) ? 'COP' : 'BS'
                                                    );
                                                    const isUsd = curr === 'USD';
                                                    const isCop = curr === 'COP';
                                                    const amountUsd = Math.abs(payment?.amountUsd ? payment.amountUsd : (gasto.totalUsd || 0));
                                                    const amountBs = Math.abs(payment?.amountBs ? payment.amountBs : (gasto.totalBs || 0));
                                                    const amountCop = Math.abs(payment?.amountCop ? payment.amountCop : (gasto.totalCop || 0));

                                                    return (
                                                        <tr key={gasto.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                                                            <td className="py-3 px-2 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                                                                {timeStr}
                                                            </td>
                                                            <td className="py-3 px-2 whitespace-nowrap">
                                                                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/90 border border-slate-200/60 dark:border-slate-700/60 px-2.5 py-1 rounded-xl">
                                                                    <IconCat size={13} className={catObj.color.split(' ')[0]} />
                                                                    <span>{catObj.label}</span>
                                                                </span>
                                                            </td>
                                                            <td className="py-3 px-2">
                                                                <div className="font-bold text-slate-800 dark:text-white">
                                                                    {gasto.description || 'Gasto Interno'}
                                                                </div>
                                                                {gasto.note && (
                                                                    <div className="text-[10px] text-slate-400 font-normal italic mt-0.5">
                                                                        "{gasto.note}"
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td className="py-3 px-2 whitespace-nowrap">
                                                                <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded-md">
                                                                    {getPaymentLabel(gasto.paymentMethod) || (gasto.paymentMethod || 'Efectivo').replace(/_/g, ' ')}
                                                                </span>
                                                            </td>
                                                            <td className="py-3 px-2 text-right font-black font-outfit text-rose-600 dark:text-rose-400 tabular-nums">
                                                                {isUsd ? `-$${amountUsd.toFixed(2)}` : '—'}
                                                            </td>
                                                            <td className="py-3 px-2 text-right font-bold text-slate-600 dark:text-slate-300 tabular-nums">
                                                                {!isUsd && !isCop ? `-${formatBs(amountBs)} Bs` : (isCop ? `-${formatCop(amountCop)} COP` : '—')}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* ── SUBSECCIÓN 2: CONSUMO INTERNO / AUTOCONSUMO (MERCANCÍA / ARTÍCULOS) ── */}
                        <div className="bg-white dark:bg-slate-900 border border-purple-200/80 dark:border-purple-900/40 rounded-3xl p-4 sm:p-6 shadow-sm space-y-4">
                            {/* Cabecera Responsiva */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-purple-100 dark:border-purple-950/60">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-2xl bg-purple-100 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                                        <ShoppingBag size={20} />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h4 className="text-sm sm:text-base font-black text-slate-800 dark:text-white">
                                                Consumo Interno (Retiro de Mercancía)
                                            </h4>
                                            <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                                                {activeShiftAutoconsumoMetrics.totalUnits} {activeShiftAutoconsumoMetrics.totalUnits === 1 ? 'artículo' : 'artículos'}
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-slate-400 font-medium mt-0.5">
                                            Salidas físicas de inventario para uso de la tienda o dueño · No afecta caja
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between sm:justify-end gap-2 bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200/70 dark:border-purple-900/40 px-3.5 py-2 rounded-2xl shrink-0">
                                    <span className="text-[10px] font-black uppercase text-purple-600 dark:text-purple-400 tracking-wider">Total Retirado:</span>
                                    <span className="text-sm sm:text-base font-black text-purple-700 dark:text-purple-300 font-outfit tabular-nums">
                                        {activeShiftAutoconsumoMetrics.totalUnits} art.
                                    </span>
                                </div>
                            </div>

                            {activeShiftAutoconsumoMetrics.list.length === 0 ? (
                                <div className="py-8 text-center text-slate-400 space-y-2">
                                    <div className="w-12 h-12 rounded-full bg-purple-50 dark:bg-purple-950/30 flex items-center justify-center mx-auto text-xl">
                                        <ShoppingBag size={22} className="text-purple-400" />
                                    </div>
                                    <p className="text-xs font-bold">No hay retiros de mercancía en el turno activo</p>
                                </div>
                            ) : (
                                <div className="space-y-2.5">
                                    {activeShiftAutoconsumoMetrics.list.map((auto) => {
                                        const date = auto.timestamp ? new Date(auto.timestamp) : new Date();
                                        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                        const items = Array.isArray(auto.items) ? auto.items : [];
                                        const totalUnits = items.reduce((s, it) => s + (Number(it.qty) || 0), 0) || 1;

                                        return (
                                            <div 
                                                key={auto.id}
                                                className="p-3 sm:p-4 bg-purple-50/20 dark:bg-purple-950/10 hover:bg-purple-50/40 dark:hover:bg-purple-950/20 border border-purple-100/80 dark:border-purple-900/30 rounded-2xl transition-all space-y-2"
                                            >
                                                {/* Fila 1: Descripción + Hora */}
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                                        <span className="w-7 h-7 rounded-lg bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300 flex items-center justify-center shrink-0">
                                                            <Package size={14} />
                                                        </span>
                                                        <span className="text-xs sm:text-sm font-black text-slate-800 dark:text-white truncate">
                                                            {auto.description || (items.length > 0 ? items.map(i => `${i.qty}u ${i.name}`).join(', ') : 'Retiro de inventario')}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-1 text-[10px] font-mono font-bold text-slate-400 bg-white dark:bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-200/60 dark:border-slate-700/60 shrink-0">
                                                        <Clock size={11} className="text-slate-400" />
                                                        <span>{timeStr}</span>
                                                    </div>
                                                </div>

                                                {/* Fila 2: Usuario + Badge de artículos + Etiqueta de Stock */}
                                                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-purple-100/50 dark:border-purple-950/40 text-[10.5px]">
                                                    <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold truncate">
                                                        <User size={12} className="text-slate-400 shrink-0" />
                                                        <span>{auto.usuarioNombre || auto.actor?.nombre || 'Administrador'}</span>
                                                        <span className="text-slate-300 dark:text-slate-600">•</span>
                                                        <span className="text-purple-600 dark:text-purple-400 font-bold">Salida de Stock (Sin impacto en caja)</span>
                                                    </div>

                                                    <span className="inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-xl bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 shrink-0">
                                                        <Package size={13} className="text-purple-600 dark:text-purple-400" />
                                                        <span>{totalUnits} {totalUnits === 1 ? 'artículo' : 'artículos'}</span>
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
    );
}
