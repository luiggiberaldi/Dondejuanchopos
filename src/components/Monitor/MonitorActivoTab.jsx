import React from 'react';
import { BookOpen } from 'lucide-react';

export default function MonitorActivoTab({ AlertTriangle, ArrowDownRight, ChevronRight, Clock, Coins, DollarSign, FileText, HandCoins, Hash, Lock, Package, RefreshCw, RotateCcw, ShoppingBag, TrendingUp, Users, Wallet, activeCashier, activeShiftApertura, activeShiftAutoconsumoMetrics, activeShiftAvgTicket, activeShiftChangeMetrics, activeShiftExpectedCash, activeShiftExpensesMetrics, activeShiftGrossUsd, activeShiftMetrics, activeShiftPaymentBreakdown, activeShiftSales, activeShiftTipTotals, activeStockAlertTab, bcvRate, customers, effectiveRate, formatBs, formatCop, formatTime, getEffectiveSaleTotalBs, getFormattedPaymentMethod, getFormattedSaleCode, getMethodIcon, getPaymentBadgeStyle, getSaleChangeDetails, isShiftActive, loadingData, lowStockProducts, outOfStockProducts, payrollEmployees, payrollTotals, products, setSelectedSaleDetail, setShowRemoteCloseModal, setStockAlertTab, setViewTab, shiftStatusInfo, syncLoading, triggerHaptic }) {
    return (
                    <div className="space-y-6">
                        {/* Banner de Estado de Apertura del Turno (Estructura Ultra-Óptima 2 Filas) */}
                        <div className={`p-3 sm:p-3.5 rounded-2xl border flex flex-col gap-2 shadow-sm ${
                            shiftStatusInfo.isOpen
                                ? 'bg-emerald-50/90 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40 text-emerald-900 dark:text-emerald-300'
                                : 'bg-slate-100/90 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800/60 text-slate-700 dark:text-slate-300'
                        }`}>
                            {/* Fila 1: Estado del Turno + Hora/Duración (Izquierda) | Tasa Activa (Derecha) */}
                            <div className="flex items-center justify-between gap-2 w-full">
                                <div className="flex items-center gap-2 min-w-0">
                                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${shiftStatusInfo.isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                        <span className="font-black text-xs sm:text-sm leading-none shrink-0">
                                            {shiftStatusInfo.isOpen ? 'Turno Activo' : 'Caja Cerrada'}
                                        </span>
                                        {shiftStatusInfo.isOpen && (
                                            <span className="text-[11px] text-slate-600 dark:text-slate-400 font-medium leading-none truncate">
                                                · {shiftStatusInfo.formattedTime} ({shiftStatusInfo.elapsedLabel})
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Tasa Activa Compacta */}
                                <div className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-900 border border-emerald-500/30 shadow-2xs shrink-0">
                                    <span className="text-[8.5px] font-black uppercase text-slate-400">Tasa:</span>
                                    <span className="text-[11px] font-black text-emerald-600 dark:text-emerald-400 font-outfit leading-none">
                                        {effectiveRate ? `${effectiveRate.toFixed(2)} Bs/$` : 'N/D'}
                                    </span>
                                </div>
                            </div>

                            {/* Fila 2: Cajero en turno (Izquierda) + Botón de Cierre Remoto (Derecha) */}
                            {shiftStatusInfo.isOpen && (
                                <div className="flex items-center justify-between gap-2 w-full pt-1.5 border-t border-emerald-200/40 dark:border-emerald-800/30">
                                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                                        Cajero: <strong className="text-slate-700 dark:text-slate-200 font-bold">{activeCashier?.nombre && activeCashier.nombre !== 'Ninguno' ? activeCashier.nombre : 'En Turno'}</strong>
                                    </span>
                                    <button
                                        onClick={() => { triggerHaptic?.(); setShowRemoteCloseModal(true); }}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-black text-xs shadow-xs transition-all active:scale-95 cursor-pointer shrink-0"
                                    >
                                        <Lock size={13} />
                                        <span>Cerrar Caja Remotamente</span>
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Banner de Efectivo Esperado en Gaveta (Cuadre Teórico de Caja en Vivo) */}
                        <div className="bg-white dark:bg-slate-900 border border-emerald-500/30 dark:border-emerald-800/60 p-3.5 sm:p-4 rounded-2xl shadow-sm flex flex-col gap-2.5">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-black shrink-0">
                                        <Wallet size={18} />
                                    </div>
                                    <div>
                                        <h4 className="font-black text-xs sm:text-sm text-slate-800 dark:text-white leading-tight">
                                            Efectivo Esperado en Gaveta
                                        </h4>
                                        <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium leading-none mt-0.5">
                                            Saldo físico teórico que debe existir en billetes para el cuadre de caja
                                        </p>
                                    </div>
                                </div>
                                <span className="text-[9px] font-black uppercase text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-800">
                                    Arqueo en Vivo
                                </span>
                            </div>

                            {/* Cajas de Saldo Físico Teórico */}
                            <div className="grid grid-cols-2 gap-2.5 pt-1">
                                {/* Efectivo Esperado en Bs */}
                                <div className="bg-emerald-50/70 dark:bg-emerald-950/30 p-2.5 sm:p-3 rounded-xl border border-emerald-200/80 dark:border-emerald-800/40 flex flex-col justify-between">
                                    <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                                        En Billetes Bs
                                    </span>
                                    <span className="font-outfit text-base sm:text-lg lg:text-xl font-black text-emerald-700 dark:text-emerald-400 tabular-nums leading-tight mt-1">
                                        {formatBs(activeShiftExpectedCash.expectedBs)} Bs
                                    </span>
                                    <span className="text-[8.5px] text-emerald-600/80 dark:text-emerald-400/70 font-bold block mt-1">
                                        Apertura + Cobros Bs - Vueltos
                                    </span>
                                </div>

                                {/* Efectivo Esperado en USD ($) */}
                                <div className="bg-blue-50/70 dark:bg-blue-950/30 p-2.5 sm:p-3 rounded-xl border border-blue-200/80 dark:border-blue-800/40 flex flex-col justify-between">
                                    <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-blue-800 dark:text-blue-300">
                                        En Billetes ($)
                                    </span>
                                    <span className="font-outfit text-base sm:text-lg lg:text-xl font-black text-blue-700 dark:text-blue-400 tabular-nums leading-tight mt-1">
                                        ${activeShiftExpectedCash.expectedUsd.toFixed(2)}
                                    </span>
                                    <span className="text-[8.5px] text-blue-600/80 dark:text-blue-400/70 font-bold block mt-1">
                                        Apertura + Cobros $ - Vueltos
                                    </span>
                                </div>
                            </div>

                            {activeShiftTipTotals.tipCount > 0 && (
                                <div className="mt-2.5 p-3 bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-300/80 dark:border-emerald-800/60 rounded-xl flex items-center justify-between shadow-xs">
                                    <div className="flex items-center gap-2">
                                        <HandCoins size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                                        <div>
                                            <span className="text-[10px] sm:text-xs font-black text-emerald-800 dark:text-emerald-300 uppercase tracking-wide block leading-tight">
                                                Cambios Dejados en Caja ({activeShiftTipTotals.tipCount} {activeShiftTipTotals.tipCount === 1 ? 'venta' : 'ventas'})
                                            </span>
                                            <span className="text-[9px] text-emerald-600/80 dark:text-emerald-400/80 font-semibold block">
                                                Propina retenida en efectivo sin salir de gaveta
                                            </span>
                                        </div>
                                    </div>
                                    <div className="text-right font-outfit font-black text-xs sm:text-sm text-emerald-700 dark:text-emerald-300">
                                        {activeShiftTipTotals.tipUsd > 0 && <span>${activeShiftTipTotals.tipUsd.toFixed(2)} USD</span>}
                                        {activeShiftTipTotals.tipUsd > 0 && activeShiftTipTotals.tipBs > 0 && <span className="mx-1">/</span>}
                                        {activeShiftTipTotals.tipBs > 0 && <span>{formatBs(activeShiftTipTotals.tipBs)} Bs</span>}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Fila 1: Tarjetas de Métricas de Turno Activo */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                            {/* Ventas Turno USD */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px]">
                                <div className="flex items-center justify-between w-full">
                                    <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Vendido Turno (USD)</span>
                                    <div className="w-7 h-7 sm:w-9 sm:h-9 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl flex items-center justify-center text-emerald-500 shrink-0">
                                        <DollarSign size={16} />
                                    </div>
                                </div>
                                <div className="mt-2.5 min-w-0">
                                    <span className="font-outfit text-base sm:text-xl lg:text-2xl font-black text-slate-800 dark:text-white tabular-nums block break-words leading-none">
                                        ${activeShiftMetrics.totalUsd.toFixed(2)}
                                    </span>
                                </div>
                            </div>

                            {/* Ventas Turno Bs */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px]">
                                <div className="flex items-center justify-between w-full">
                                    <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Vendido Turno (Bs)</span>
                                    <div className="w-7 h-7 sm:w-9 sm:h-9 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl flex items-center justify-center text-emerald-500 shrink-0">
                                        <Coins size={16} />
                                    </div>
                                </div>
                                <div className="mt-2.5 min-w-0">
                                    <span className="font-outfit text-base sm:text-xl lg:text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums block break-words leading-none">
                                        {formatBs(activeShiftMetrics.totalBs)} Bs
                                    </span>
                                    <span className="text-[9px] text-slate-400 block font-medium mt-1">
                                        Acumulado tickets Bs
                                    </span>
                                </div>
                            </div>

                            {/* Margen Estimado Turno */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px]">
                                <div className="flex items-center justify-between w-full">
                                    <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Ganancia Turno</span>
                                    <div className="w-7 h-7 sm:w-9 sm:h-9 bg-blue-50 dark:bg-blue-950/20 rounded-xl flex items-center justify-center text-blue-500 shrink-0">
                                        <TrendingUp size={16} />
                                    </div>
                                </div>
                                <div className="mt-2.5 min-w-0">
                                    <span className="font-outfit text-base sm:text-xl lg:text-2xl font-black text-blue-600 dark:text-blue-400 tabular-nums block break-words leading-none">
                                        ${activeShiftMetrics.profitUsd.toFixed(2)}
                                    </span>
                                </div>
                            </div>

                            {/* Cajero Activo */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px]">
                                <div className="flex items-center justify-between w-full">
                                    <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Cajero de Turno</span>
                                    <div className="w-7 h-7 sm:w-9 sm:h-9 bg-slate-50 dark:bg-slate-800/50 rounded-xl flex items-center justify-center text-slate-450 shrink-0">
                                        <Users size={16} />
                                    </div>
                                </div>
                                <div className="mt-2.5 min-w-0">
                                    <span className="text-sm sm:text-base lg:text-lg font-black text-slate-800 dark:text-white block truncate leading-none">
                                        {isShiftActive ? (
                                            activeCashier.nombre !== 'Ninguno' 
                                                ? activeCashier.nombre 
                                                : (activeShiftSales.find(s => s.cajero || s.usuarioNombre || s.usuario)?.cajero || activeShiftApertura?.cajero || 'Cajero General')
                                        ) : 'Ninguno'}
                                    </span>
                                    <span className="text-[9px] text-slate-400 block font-medium mt-1">
                                        {activeShiftMetrics.count} {activeShiftMetrics.count === 1 ? 'venta' : 'ventas'} en curso
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Fila 2: Egresos, Consumo Interno, Nómina, Deudas y Vueltos (Solo fichas con registros) */}
                        {(() => {
                            const totalFiadoCustomers = (customers || []).reduce((acc, c) => acc + (Number(c.deuda) || 0), 0);
                            const debtorsCount = (customers || []).filter(c => (Number(c.deuda) || 0) > 0.01).length;
                            const showDeudas = totalFiadoCustomers > 0.01;

                            const showGastos = (activeShiftExpensesMetrics.count > 0 || Math.abs(activeShiftExpensesMetrics.totalUsd || 0) > 0.001 || Math.abs(activeShiftExpensesMetrics.totalBs || 0) > 0.001);
                            const showConsumoInterno = (activeShiftAutoconsumoMetrics.count > 0 || (activeShiftAutoconsumoMetrics.totalUnits || 0) > 0);
                            const showConsumoEmpleados = (Number(payrollTotals.consumosTotalUsd || 0) > 0.001);
                            const showVueltosEntregados = (activeShiftChangeMetrics.count > 0 || Math.abs(activeShiftChangeMetrics.totalUsd || 0) > 0.001 || Math.abs(activeShiftChangeMetrics.totalBs || 0) > 0.001);
                            const showVueltosCaja = (activeShiftTipTotals.tipCount > 0 || (activeShiftTipTotals.tipUsd || 0) > 0.001 || (activeShiftTipTotals.tipBs || 0) > 0.001);

                            const totalVisible = [showDeudas, showGastos, showConsumoInterno, showConsumoEmpleados, showVueltosEntregados, showVueltosCaja].filter(Boolean).length;

                            if (totalVisible === 0) return null;

                            return (
                                <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 sm:gap-4 mt-3 sm:mt-4 animate-in fade-in duration-200">
                                    {/* Cuentas por Cobrar / Fiados Activos */}
                                    {showDeudas && (
                                        <div 
                                            onClick={() => { triggerHaptic?.(); setViewTab('deudas'); }}
                                            className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-red-200/70 dark:border-red-900/40 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px] cursor-pointer hover:border-red-400 transition-all group"
                                        >
                                            <div className="flex items-center justify-between w-full">
                                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-red-500 dark:text-red-400 flex items-center gap-1">
                                                    Fiados por cobrar <span className="text-[8px] opacity-75 group-hover:translate-x-0.5 transition-transform">➔</span>
                                                </span>
                                                <div className="w-7 h-7 sm:w-9 sm:h-9 bg-red-50 dark:bg-red-950/20 rounded-xl flex items-center justify-center text-red-500 shrink-0">
                                                    <BookOpen size={16} />
                                                </div>
                                            </div>
                                            <div className="mt-2.5 min-w-0">
                                                <span className="font-outfit text-base sm:text-xl lg:text-2xl font-black text-red-600 dark:text-red-400 tabular-nums block break-words leading-none">
                                                    ${totalFiadoCustomers.toFixed(2)}
                                                </span>
                                                <span className="text-[9px] text-slate-400 block font-medium mt-1">
                                                    {debtorsCount} {debtorsCount === 1 ? 'cliente' : 'clientes'} con deuda
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Gastos de Caja (Dinero) */}
                                    {showGastos && (
                                        <div 
                                            onClick={() => { triggerHaptic?.(); setViewTab('gastos'); }}
                                            className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-rose-200/60 dark:border-rose-900/40 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px] cursor-pointer hover:border-rose-400 transition-all group"
                                        >
                                            <div className="flex items-center justify-between w-full">
                                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-rose-500 dark:text-rose-400 flex items-center gap-1">
                                                    Gastos de caja <span className="text-[8px] opacity-75 group-hover:translate-x-0.5 transition-transform">➔</span>
                                                </span>
                                                <div className="w-7 h-7 sm:w-9 sm:h-9 bg-rose-50 dark:bg-rose-950/20 rounded-xl flex items-center justify-center text-rose-500 shrink-0">
                                                    <TrendingUp size={16} className="rotate-180" />
                                                </div>
                                            </div>
                                            <div className="mt-2.5 min-w-0">
                                                <span className="font-outfit text-base sm:text-xl lg:text-2xl font-black text-rose-600 dark:text-rose-400 tabular-nums block break-words leading-none">
                                                    {activeShiftExpensesMetrics.totalUsd > 0 ? `-$${activeShiftExpensesMetrics.totalUsd.toFixed(2)}` : `-${formatBs(activeShiftExpensesMetrics.totalBs)} Bs`}
                                                </span>
                                                <span className="text-[9px] text-slate-400 block font-medium mt-1">
                                                    {activeShiftExpensesMetrics.count} {activeShiftExpensesMetrics.count === 1 ? 'egreso' : 'egresos'}
                                                    {activeShiftExpensesMetrics.totalUsd > 0 && activeShiftExpensesMetrics.totalBs > 0 ? ` (-${formatBs(activeShiftExpensesMetrics.totalBs)} Bs)` : ''}
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Consumo Interno (Autoconsumo / Mercancía) */}
                                    {showConsumoInterno && (
                                        <div 
                                            onClick={() => { triggerHaptic?.(); setViewTab('gastos'); }}
                                            className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-purple-200/70 dark:border-purple-900/40 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px] cursor-pointer hover:border-purple-400 transition-all group"
                                        >
                                            <div className="flex items-center justify-between w-full">
                                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-purple-500 dark:text-purple-400 flex items-center gap-1">
                                                    Consumo interno <span className="text-[8px] opacity-75 group-hover:translate-x-0.5 transition-transform">➔</span>
                                                </span>
                                                <div className="w-7 h-7 sm:w-9 sm:h-9 bg-purple-50 dark:bg-purple-950/20 rounded-xl flex items-center justify-center text-purple-500 shrink-0">
                                                    <ShoppingBag size={16} />
                                                </div>
                                            </div>
                                            <div className="mt-2.5 min-w-0">
                                                <span className="font-outfit text-base sm:text-xl lg:text-2xl font-black text-purple-600 dark:text-purple-400 tabular-nums block break-words leading-none">
                                                    {activeShiftAutoconsumoMetrics.totalUnits} {activeShiftAutoconsumoMetrics.totalUnits === 1 ? 'artículo' : 'artículos'}
                                                </span>
                                                <span className="text-[9px] text-slate-400 block font-medium mt-1">
                                                    {activeShiftAutoconsumoMetrics.count} {activeShiftAutoconsumoMetrics.count === 1 ? 'retiro' : 'retiros'} de mercancía
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Consumo de Empleados */}
                                    {showConsumoEmpleados && (
                                        <div 
                                            onClick={() => { triggerHaptic?.(); setViewTab('nomina'); }}
                                            className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-indigo-200/70 dark:border-indigo-900/40 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px] cursor-pointer hover:border-indigo-400 transition-all group"
                                        >
                                            <div className="flex items-center justify-between w-full">
                                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-indigo-500 dark:text-indigo-400 flex items-center gap-1">
                                                    Consumo empleados <span className="text-[8px] opacity-75 group-hover:translate-x-0.5 transition-transform">➔</span>
                                                </span>
                                                <div className="w-7 h-7 sm:w-9 sm:h-9 bg-indigo-50 dark:bg-indigo-950/20 rounded-xl flex items-center justify-center text-indigo-500 shrink-0">
                                                    <Users size={16} />
                                                </div>
                                            </div>
                                            <div className="mt-2.5 min-w-0">
                                                <span className="font-outfit text-base sm:text-xl lg:text-2xl font-black text-indigo-600 dark:text-indigo-400 tabular-nums block break-words leading-none">
                                                    -${Number(payrollTotals.consumosTotalUsd || 0).toFixed(2)}
                                                </span>
                                                <span className="text-[9px] text-slate-400 block font-medium mt-1">
                                                    {payrollEmployees.length} {payrollEmployees.length === 1 ? 'empleado' : 'empleados'} (Ver nómina)
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Vueltos entregados */}
                                    {showVueltosEntregados && (
                                        <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-amber-200/70 dark:border-amber-900/40 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px]">
                                            <div className="flex items-center justify-between w-full">
                                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">Vueltos entregados</span>
                                                <div className="w-7 h-7 sm:w-9 sm:h-9 bg-amber-50 dark:bg-amber-950/20 rounded-xl flex items-center justify-center text-amber-500 shrink-0">
                                                    <RotateCcw size={16} />
                                                </div>
                                            </div>
                                            <div className="mt-2.5 min-w-0">
                                                <span className="font-outfit text-base sm:text-xl lg:text-2xl font-black text-amber-600 dark:text-amber-400 tabular-nums block break-words leading-none">
                                                    -${activeShiftChangeMetrics.totalUsd.toFixed(2)}
                                                </span>
                                                <span className="text-[9px] text-slate-400 block font-medium mt-1">
                                                    {activeShiftChangeMetrics.count} {activeShiftChangeMetrics.count === 1 ? 'venta' : 'ventas'} (-{formatBs(activeShiftChangeMetrics.totalBs)} Bs)
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Vueltos dejados en caja */}
                                    {showVueltosCaja && (
                                        <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-emerald-200/70 dark:border-emerald-900/40 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px]">
                                            <div className="flex items-center justify-between w-full">
                                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Vueltos dejados en caja</span>
                                                <div className="w-7 h-7 sm:w-9 sm:h-9 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl flex items-center justify-center text-emerald-500 shrink-0">
                                                    <HandCoins size={16} />
                                                </div>
                                            </div>
                                            <div className="mt-2.5 min-w-0">
                                                <span className="font-outfit text-base sm:text-xl lg:text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums block break-words leading-none">
                                                    ${activeShiftTipTotals.tipUsd.toFixed(2)}
                                                </span>
                                                <span className="text-[9px] text-slate-400 block font-medium mt-1">
                                                    {formatBs(activeShiftTipTotals.tipBs)} Bs · {activeShiftTipTotals.tipCount} {activeShiftTipTotals.tipCount === 1 ? 'venta' : 'ventas'}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {/* Si la caja no está activa */}
                        {!isShiftActive ? (
                            <div className="py-16 px-6 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm space-y-4 max-w-lg mx-auto flex flex-col items-center">
                                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 text-slate-450 rounded-full">
                                    <Clock size={42} />
                                </div>
                                <div className="space-y-1">
                                    <h4 className="text-sm font-black text-slate-800 dark:text-white">Caja Cerrada / Turno Inactivo</h4>
                                    <p className="text-xs text-slate-400 leading-relaxed px-4">
                                        No hay un turno de caja activo en este momento. Abre la caja en el dispositivo del punto de venta para comenzar a registrar movimientos en vivo.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {/* Desglose Diario por Método de Pago */}
                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm overflow-hidden">
                                    <div className="p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800/80">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                                                <Wallet size={18} className="text-violet-500" />
                                                Ingresos del Turno Activo
                                            </h3>
                                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl">
                                                En Curso
                                            </span>
                                        </div>
                                    </div>

                                    <div className="p-5 sm:p-6">
                                        {/* Apertura de caja */}
                                        <div className="mb-5 p-4 bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800/50 rounded-2xl">
                                            <div className="flex items-center gap-2 mb-3">
                                                <div className="w-7 h-7 bg-amber-100 dark:bg-amber-950/30 rounded-lg flex items-center justify-center">
                                                    <ArrowDownRight size={14} className="text-amber-600 dark:text-amber-400" />
                                                </div>
                                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Fondo de Apertura de Turno</span>
                                            </div>
                                            {activeShiftApertura ? (
                                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                                                    <div className="space-y-0.5">
                                                        <span className="text-[9px] font-bold text-slate-400 uppercase block">USD Inicial</span>
                                                        <span className="font-outfit text-sm font-black text-slate-700 dark:text-slate-200 tabular-nums">${(activeShiftApertura.openingUsd || 0).toFixed(2)}</span>
                                                    </div>
                                                    <div className="space-y-0.5">
                                                        <span className="text-[9px] font-bold text-slate-400 uppercase block">Bs Inicial</span>
                                                        <span className="font-outfit text-sm font-black text-slate-700 dark:text-slate-200 tabular-nums">{formatBs(activeShiftApertura.openingBs || 0)} Bs</span>
                                                    </div>
                                                    {activeShiftApertura.openingCop > 0 && (
                                                        <div className="space-y-0.5">
                                                            <span className="text-[9px] font-bold text-slate-400 uppercase block">COP Inicial</span>
                                                            <span className="font-outfit text-sm font-black text-slate-700 dark:text-slate-200 tabular-nums">{(activeShiftApertura.openingCop || 0).toLocaleString()} COP</span>
                                                        </div>
                                                    )}
                                                    <div className="space-y-0.5 col-span-2 sm:col-span-3">
                                                        <span className="text-[9px] font-bold text-slate-400 uppercase block">Hora de apertura</span>
                                                        <span className="text-xs font-bold text-slate-500">{formatTime(activeShiftApertura.timestamp)}</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <p className="text-xs text-slate-400 font-bold">Caja iniciada sin fondo declarado.</p>
                                            )}
                                        </div>

                                        {/* Tabla desglose */}
                                        {activeShiftPaymentBreakdown.length === 0 ? (
                                            <div className="py-8 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                                                <Wallet size={28} className="mx-auto text-slate-300 mb-2" />
                                                <p className="text-xs font-black">Sin transacciones registradas</p>
                                                <p className="text-[10px] text-slate-450 mt-1">El desglose por método de pago aparecerá aquí.</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-2.5">
                                                {activeShiftPaymentBreakdown.map(([methodId, data]) => {
                                                    const IconComp = getMethodIcon(methodId);
                                                    // El vuelto sale de la gaveta (se pinta en ámbar y con signo −).
                                                    // La propina se queda en ella, así que conserva el estilo neutro.
                                                    const isChangeRow = data.isChange;
                                                    // Ninguno de los dos es un cobro: quedan fuera del reparto porcentual.
                                                    const isOutOfPct = data.isChange || data.isTip;
                                                    const pct = activeShiftGrossUsd > 0 && !isOutOfPct
                                                        ? Math.round((data.totalUsd / activeShiftGrossUsd) * 100)
                                                        : 0;

                                                    return (
                                                        <div 
                                                            key={methodId} 
                                                            className={`flex items-center gap-3 p-3.5 rounded-2xl border transition-colors ${
                                                                isChangeRow 
                                                                    ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200/70 dark:border-amber-800/40' 
                                                                    : 'bg-slate-50/70 dark:bg-slate-800/20 border-slate-100 dark:border-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-800/30'
                                                            }`}
                                                        >
                                                            <div className={`w-9 h-9 border rounded-xl flex items-center justify-center shrink-0 shadow-sm ${
                                                                isChangeRow 
                                                                    ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400' 
                                                                    : 'bg-white dark:bg-slate-800 border-slate-200/60 dark:border-slate-700/60 text-slate-500 dark:text-slate-400'
                                                            }`}>
                                                                <IconComp size={16} />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className={`text-xs font-black truncate ${isChangeRow ? 'text-amber-800 dark:text-amber-300' : 'text-slate-700 dark:text-slate-200'}`}>
                                                                        {data.label}
                                                                    </span>
                                                                    <span className={`font-outfit text-xs font-black tabular-nums shrink-0 ${isChangeRow ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-white'}`}>
                                                                        {isChangeRow
                                                                            ? (() => {
                                                                                const amount = [
                                                                                    data.totalUsd > 0.009 ? `$${data.totalUsd.toFixed(2)}` : '',
                                                                                    data.totalBs > 0.009 ? `Bs ${formatBs(data.totalBs)}` : '',
                                                                                    data.totalCop > 0.009 ? `COP ${formatCop(data.totalCop)}` : '',
                                                                                ].filter(Boolean).join(' · ');
                                                                                return amount ? `− ${amount}` : '—';
                                                                            })()
                                                                            : `$${data.totalUsd.toFixed(2)}`}
                                                                    </span>
                                                                </div>
                                                                <div className="flex items-center justify-between gap-2 mt-1">
                                                                    <div className="flex items-center gap-2">
                                                                        {data.count > 0 ? (
                                                                            <span className="text-[9px] font-bold text-slate-400">{data.count} {data.count === 1 ? 'transacción' : 'transacciones'}</span>
                                                                        ) : (
                                                                            <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Vuelto Otorgado</span>
                                                                        )}
                                                                        {!isOutOfPct && <span className="text-[9px] font-black text-violet-500 bg-violet-50 dark:bg-violet-950/20 dark:text-violet-400 px-1.5 py-0.5 rounded-md">{pct}%</span>}
                                                                    </div>
                                                                    <span className={`font-outfit text-[10px] font-bold tabular-nums ${isChangeRow ? 'text-amber-600/80 dark:text-amber-400/80' : 'text-slate-400'}`}>
                                                                        {isChangeRow
                                                                            ? data.totalBs > 0.009
                                                                                ? `− ${formatBs(data.totalBs)} Bs`
                                                                            : data.totalUsd > 0.009
                                                                                ? `− $${data.totalUsd.toFixed(2)}`
                                                                                : data.totalCop > 0.009
                                                                                    ? `− COP ${formatCop(data.totalCop)}`
                                                                                    : '—'
                                                                            : `${formatBs(data.totalBs)} Bs`}
                                                                    </span>
                                                                </div>
                                                                {!isOutOfPct && (
                                                                    <div className="mt-1.5 h-1 bg-slate-200/60 dark:bg-slate-800 rounded-full overflow-hidden">
                                                                        <div
                                                                            className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all duration-500"
                                                                            style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
                                                                        />
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}

                                                {/* Resumen total */}
                                                <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-800 flex items-center justify-between px-1">
                                                    <div className="flex items-center gap-2">
                                                        <Hash size={14} className="text-slate-400" />
                                                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                                            Total Acumulado ({activeShiftMetrics.count} {activeShiftMetrics.count === 1 ? 'venta' : 'ventas'})
                                                        </span>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="font-outfit text-sm font-black text-slate-850 dark:text-white tabular-nums">${activeShiftMetrics.totalUsd.toFixed(2)}</span>
                                                        <span className="font-outfit text-[10px] font-bold text-slate-400 ml-2">{formatBs(activeShiftMetrics.totalBs)} Bs</span>
                                                    </div>
                                                </div>

                                                {/* Ticket promedio */}
                                                <div className="flex items-center justify-between px-1 mt-1">
                                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Ticket Promedio</span>
                                                    <span className="font-outfit text-xs font-black text-blue-650 dark:text-blue-400 tabular-nums">${activeShiftAvgTicket.toFixed(2)}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Dashboard de Columnas */}
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                    {/* Columna Izquierda: Listado de Ventas en Vivo */}
                                    <div className="lg:col-span-2 space-y-4">
                                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-6 shadow-sm">
                                            <h3 className="text-sm font-black text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                                <FileText size={18} className="text-slate-400" />
                                                Ventas del Turno en Tiempo Real
                                            </h3>
                                            
                                            {loadingData || syncLoading ? (
                                                <div className="py-8 flex justify-center text-slate-400 gap-2 items-center">
                                                    <RefreshCw className="animate-spin" size={18} />
                                                    <span className="text-xs font-bold">Cargando transacciones...</span>
                                                </div>
                                            ) : activeShiftSales.length === 0 ? (
                                                <div className="py-12 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                                                    <Clock size={36} className="mx-auto text-slate-350 dark:text-slate-700 mb-2" />
                                                    <p className="text-xs font-black">No se han registrado ventas en este turno</p>
                                                    <p className="text-[10px] text-slate-400 mt-1">Las ventas de la caja emparejada aparecerán aquí al instante.</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-3 max-h-[550px] overflow-y-auto pr-1">
                                                    {activeShiftSales.map(sale => (
                                                        <div 
                                                            key={sale.id}
                                                            onClick={() => { triggerHaptic?.(); setSelectedSaleDetail(sale); }}
                                                            className="p-3.5 sm:p-4 border border-slate-100 dark:border-slate-800/80 hover:border-emerald-400/80 dark:hover:border-emerald-600/60 rounded-2xl bg-slate-50/50 dark:bg-slate-800/20 hover:bg-white dark:hover:bg-slate-800/50 flex flex-col sm:flex-row justify-between items-start gap-2.5 transition-all duration-200 cursor-pointer active:scale-[0.99] shadow-sm hover:shadow-md group"
                                                        >
                                                            <div className="space-y-1.5 min-w-0 flex-1 w-full">
                                                                <div className="flex items-center justify-between sm:justify-start gap-2">
                                                                    {sale.status === 'ANULADA' ? (
                                                                        <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-200/60 dark:border-rose-900/60 flex items-center gap-1">
                                                                            <AlertTriangle size={10} /> {getFormattedSaleCode(sale)} • ANULADA
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400">
                                                                            {getFormattedSaleCode(sale)}
                                                                        </span>
                                                                    )}
                                                                    <span className="text-[10px] text-slate-400 font-bold">{formatTime(sale.timestamp)}</span>
                                                                    <div className="sm:hidden text-right">
                                                                        <span className="font-outfit text-sm font-black text-slate-800 dark:text-white">${(sale.totalUsd || 0).toFixed(2)}</span>
                                                                    </div>
                                                                </div>
                                                                <p className="text-xs font-black text-slate-800 dark:text-slate-100 leading-snug break-words pr-1">
                                                                    {sale.items?.map(i => `${i.name} (x${i.qty})`).join(', ') || 'Venta de productos'}
                                                                </p>
                                                                <div className="flex items-center justify-between pt-1">
                                                                    <div className="flex gap-2 items-center flex-wrap">
                                                                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${getPaymentBadgeStyle(sale)}`}>
                                                                            {getFormattedPaymentMethod(sale)}
                                                                        </span>
                                                                        {(() => {
                                                                            const { changeUsd, changeBs, hasChange } = getSaleChangeDetails(sale);
                                                                            if (!hasChange) return null;
                                                                            return (
                                                                                <span className="text-[9.5px] font-black uppercase px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 flex items-center gap-1 shadow-xs">
                                                                                    <RotateCcw size={10} />
                                                                                    Vuelto: {changeUsd > 0 ? `$${changeUsd.toFixed(2)}` : `${formatBs(changeBs)} Bs`}
                                                                                </span>
                                                                            );
                                                                        })()}
                                                                        {sale.clientName && (
                                                                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">• {sale.clientName}</span>
                                                                        )}
                                                                    </div>
                                                                    <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                                                                        Ver detalle <ChevronRight size={12} />
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <div className="hidden sm:block text-right space-y-0.5 shrink-0">
                                                                <span className="font-outfit text-sm font-black text-slate-800 dark:text-white block">${(sale.totalUsd || 0).toFixed(2)}</span>
                                                                <span className="font-outfit text-[10px] font-bold text-slate-400 block">{formatBs(getEffectiveSaleTotalBs(sale, products, effectiveRate, bcvRate))} Bs</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Columna Derecha: Tarjeta Unificada de Alertas de Stock */}
                                    <div className="space-y-6">
                                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-4 sm:p-5 shadow-sm space-y-4">
                                            {/* Sub-pestañitas de Selección en la Cabecera */}
                                            <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-2xl border border-slate-200/60 dark:border-slate-800">
                                                <button
                                                    onClick={() => { triggerHaptic?.(); setStockAlertTab('agotados'); }}
                                                    className={`flex-1 py-2 px-2 rounded-xl text-[11px] sm:text-xs font-black transition-all flex items-center justify-center gap-1.5 whitespace-nowrap ${
                                                        activeStockAlertTab === 'agotados'
                                                            ? 'bg-white dark:bg-slate-800 text-slate-850 dark:text-white shadow-xs'
                                                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                                    }`}
                                                >
                                                    <Package size={14} className={activeStockAlertTab === 'agotados' ? "text-rose-500" : "text-slate-400"} />
                                                    <span>Agotados</span>
                                                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                                                        outOfStockProducts.length > 0
                                                            ? 'bg-rose-500 text-white'
                                                            : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                                                    }`}>
                                                        {outOfStockProducts.length}
                                                    </span>
                                                </button>

                                                <button
                                                    onClick={() => { triggerHaptic?.(); setStockAlertTab('critico'); }}
                                                    className={`flex-1 py-2 px-2 rounded-xl text-[11px] sm:text-xs font-black transition-all flex items-center justify-center gap-1.5 whitespace-nowrap ${
                                                        activeStockAlertTab === 'critico'
                                                            ? 'bg-white dark:bg-slate-800 text-slate-850 dark:text-white shadow-xs'
                                                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                                    }`}
                                                >
                                                    <AlertTriangle size={14} className={activeStockAlertTab === 'critico' ? "text-amber-500" : "text-slate-400"} />
                                                    <span>Stock Crítico</span>
                                                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                                                        lowStockProducts.length > 0
                                                            ? 'bg-amber-500 text-white'
                                                            : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                                                    }`}>
                                                        {lowStockProducts.length}
                                                    </span>
                                                </button>
                                            </div>

                                            {/* Contenido de la Sub-pestaña Seleccionada */}
                                            {activeStockAlertTab === 'agotados' ? (
                                                outOfStockProducts.length === 0 ? (
                                                    <div className="py-6 text-center text-slate-400">
                                                        <p className="text-xs font-black text-emerald-600">¡Sin productos agotados!</p>
                                                        <p className="text-[10px] text-slate-400 mt-0.5">Todos los artículos tienen existencias.</p>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-2 max-h-60 overflow-y-auto scrollbar-hide pr-1">
                                                        {outOfStockProducts.map(prod => {
                                                            const stock = Number(prod.stock) || 0;
                                                            const isNegative = stock < 0;
                                                            return (
                                                                <div key={prod.id} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800/80 last:border-0">
                                                                    <div className="min-w-0 pr-2">
                                                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block truncate">{prod.name}</span>
                                                                        <span className="font-outfit text-[10px] text-slate-400">Precio: ${(prod.priceUsd ?? prod.price ?? 0).toFixed(2)}</span>
                                                                    </div>
                                                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg shrink-0 ${
                                                                        isNegative
                                                                            ? 'bg-rose-600 text-white shadow-xs animate-pulse'
                                                                            : 'bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400'
                                                                    }`}>
                                                                        {isNegative ? `Negativo (${stock} u)` : 'Agotado (0 u)'}
                                                                    </span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )
                                            ) : (
                                                lowStockProducts.length === 0 ? (
                                                    <div className="py-6 text-center text-slate-400">
                                                        <p className="text-xs font-black text-emerald-600">¡Niveles de stock óptimos!</p>
                                                        <p className="text-[10px] text-slate-400 mt-0.5">No hay productos en nivel crítico.</p>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-2 max-h-60 overflow-y-auto scrollbar-hide pr-1">
                                                        {lowStockProducts.map(prod => (
                                                            <div key={prod.id} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800/80 last:border-0">
                                                                <div className="min-w-0 pr-2">
                                                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block truncate">{prod.name}</span>
                                                                    <span className="font-outfit text-[10px] text-slate-400">Precio: ${(prod.priceUsd ?? prod.price ?? 0).toFixed(2)}</span>
                                                                </div>
                                                                <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 shrink-0">
                                                                    Quedan {prod.stock} uds.
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
    );
}
