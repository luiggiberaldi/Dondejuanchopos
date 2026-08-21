import React from 'react';

export default function MonitorNominaTab({ FileText, Pencil, Plus, RotateCcw, Trash2, X, bcvRate, effectiveRate, formatPayrollUsd, generateEmployeePayrollPDF, handlePayrollDetail, handleVoidConsumptionSupervisor, payrollDetail, payrollDetailError, payrollDetailLoading, payrollEmployees, payrollProjection, payrollTotals, requestDeleteRemoteEmployee, setEditingEmployee, setPayrollDetail, setShowCreateEmployeeModal, showToast }) {
    return (
                    <div className="space-y-5 animate-in fade-in">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 rounded-3xl shadow-sm">
                            <div>
                                <h3 className="text-base sm:text-lg font-black text-slate-800 dark:text-white">Nómina &amp; Consumos</h3>
                                <p className="text-xs text-slate-400 mt-1">Proyección resumida sincronizada desde la caja principal. El historial se consulta bajo demanda.</p>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setEditingEmployee(null);
                                        setShowCreateEmployeeModal(true);
                                    }}
                                    className="px-4 py-2.5 rounded-2xl bg-brand text-white text-xs font-black flex items-center gap-2 hover:bg-brand-dark transition-all active:scale-95 shadow-md shadow-brand/20 cursor-pointer shrink-0"
                                >
                                    <Plus size={16} />
                                    <span>Crear Empleado</span>
                                </button>
                                <div className="text-right shrink-0 border-l border-slate-100 dark:border-slate-800 pl-3">
                                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">Período</span>
                                    <span className="text-sm font-black text-slate-700 dark:text-slate-200">{payrollProjection?.periodo?.id || 'Sin datos'}</span>
                                    <span className="text-[10px] font-bold text-slate-400 block">{payrollProjection?.periodo?.status || '—'}</span>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Nómina bruta</p>
                                <p className="text-xl font-black text-slate-800 dark:text-white mt-1">{formatPayrollUsd(payrollTotals.nominaTotalUsd)}</p>
                            </div>
                            <div className="rounded-2xl border border-amber-200/80 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 p-4">
                                <p className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">Consumos</p>
                                <p className="text-xl font-black text-amber-700 dark:text-amber-300 mt-1">{formatPayrollUsd(payrollTotals.consumosTotalUsd)}</p>
                            </div>
                            <div className="rounded-2xl border border-emerald-200/80 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/20 p-4">
                                <p className="text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Neto proyectado</p>
                                <p className="text-xl font-black text-emerald-700 dark:text-emerald-300 mt-1">{formatPayrollUsd(payrollTotals.netoTotalUsd)}</p>
                            </div>
                        </div>

                        <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                                <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">Resumen por empleado</h4>
                                <span className="text-[10px] font-bold text-slate-400">{payrollEmployees.length} registro(s)</span>
                            </div>
                            {payrollEmployees.length === 0 ? (
                                <div className="py-12 text-center text-xs font-bold text-slate-400">No hay proyección de nómina sincronizada.</div>
                            ) : (
                                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {payrollEmployees.map(employee => (
                                        <div key={employee.employeeId} className="p-3.5 sm:p-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors space-y-2.5 lg:space-y-0 lg:flex lg:items-center lg:gap-4">
                                            {/* Cabecera / Info del Empleado */}
                                            <div className="flex items-center justify-between gap-2.5 flex-1 min-w-0">
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-brand/10 dark:bg-brand/20 text-brand flex items-center justify-center font-black text-xs shrink-0">
                                                        {String(employee.employeeNombre || '?').slice(0, 1).toUpperCase()}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            <p className="text-xs sm:text-sm font-black text-slate-800 dark:text-white truncate">
                                                                {employee.employeeNombre || 'Empleado'}
                                                            </p>
                                                            <span className={`text-[8.5px] font-black uppercase px-2 py-0.5 rounded-full shrink-0 ${employee.settled ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300' : 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'}`}>
                                                                {employee.settled ? 'Liquidado' : 'Pendiente'}
                                                            </span>
                                                        </div>
                                                        <p className="text-[10.5px] text-slate-400 truncate mt-0.5">
                                                            {employee.cargo || 'Sin cargo'} · <span className="font-semibold text-slate-500 dark:text-slate-300">{employee.porcentajeConsumido || 0}% consumido</span>
                                                        </p>
                                                    </div>
                                                </div>

                                                {/* Acciones compactas en móvil */}
                                                <div className="flex lg:hidden items-center gap-1 shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setEditingEmployee({
                                                                id: employee.employeeId,
                                                                nombre: employee.employeeNombre,
                                                                cargo: employee.cargo,
                                                                salarioSemanalUsd: employee.salarioSemanalUsd,
                                                                limiteConsumoPorc: employee.limiteConsumoPorc,
                                                            });
                                                            setShowCreateEmployeeModal(true);
                                                        }}
                                                        className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-brand hover:border-brand/40 flex items-center justify-center transition-colors cursor-pointer"
                                                        title="Editar empleado"
                                                    >
                                                        <Pencil size={13} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => requestDeleteRemoteEmployee(employee)}
                                                        className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-rose-600 hover:border-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center justify-center transition-colors cursor-pointer"
                                                        title="Eliminar empleado"
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handlePayrollDetail(employee)}
                                                        className="h-8 px-2.5 rounded-lg bg-brand/10 hover:bg-brand text-brand hover:text-white text-[10px] font-black transition-all flex items-center gap-1 cursor-pointer"
                                                    >
                                                        <span>Detalle</span>
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Métricas Financieras (Pill compacto 3 columnas) */}
                                            <div className="grid grid-cols-3 gap-2 bg-slate-50/80 dark:bg-slate-800/40 px-3 py-2 rounded-xl border border-slate-100 dark:border-slate-800/80 text-center lg:text-right lg:min-w-[260px] shrink-0">
                                                <div>
                                                    <span className="text-[9px] font-bold uppercase text-slate-400 block">Salario</span>
                                                    <strong className="text-xs font-black text-slate-700 dark:text-slate-200 font-outfit tabular-nums">{formatPayrollUsd(employee.salarioSemanalUsd)}</strong>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] font-bold uppercase text-amber-500 block">Consumos</span>
                                                    <strong className="text-xs font-black text-amber-600 dark:text-amber-400 font-outfit tabular-nums">{formatPayrollUsd(employee.totalConsumosUsd)}</strong>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] font-black uppercase text-emerald-600 dark:text-emerald-400 block">Neto</span>
                                                    <strong className="text-xs font-black text-emerald-600 dark:text-emerald-400 font-outfit tabular-nums">{formatPayrollUsd(employee.netoAPagarUsd)}</strong>
                                                </div>
                                            </div>

                                            {/* Acciones en Desktop */}
                                            <div className="hidden lg:flex items-center gap-1.5 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setEditingEmployee({
                                                            id: employee.employeeId,
                                                            nombre: employee.employeeNombre,
                                                            cargo: employee.cargo,
                                                            salarioSemanalUsd: employee.salarioSemanalUsd,
                                                            limiteConsumoPorc: employee.limiteConsumoPorc,
                                                        });
                                                        setShowCreateEmployeeModal(true);
                                                    }}
                                                    className="h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-[10.5px] font-black text-slate-600 dark:text-slate-300 hover:border-brand/50 hover:text-brand transition-colors flex items-center gap-1.5 cursor-pointer"
                                                    title="Editar empleado"
                                                >
                                                    <Pencil size={13} />
                                                    <span>Editar</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handlePayrollDetail(employee)}
                                                    className="h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-[10.5px] font-black text-slate-600 dark:text-slate-300 hover:border-brand/50 hover:text-brand transition-colors cursor-pointer"
                                                >
                                                    Ver detalle
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => requestDeleteRemoteEmployee(employee)}
                                                    className="h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-rose-600 hover:border-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center justify-center transition-colors cursor-pointer"
                                                    title="Eliminar empleado definitivamente"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {payrollDetailLoading && <p className="text-center text-xs font-bold text-slate-400">Cargando detalle seguro...</p>}
                        {payrollDetailError && <p className="rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 p-3 text-xs font-bold text-amber-700 dark:text-amber-300">{payrollDetailError}</p>}
                        {payrollDetail && (() => {
                            const activeConsumptionsList = (payrollDetail.consumptions || []).filter(c => c.status !== 'VOIDED');
                            const dynamicTotalConsumosUsd = activeConsumptionsList.reduce((sum, c) => sum + Number(c.totalUsd || 0), 0);
                            const dynamicSalarioBaseUsd = Number(payrollDetail.employee?.salarioSemanalUsd || 0);
                            const dynamicNetoAPagarUsd = Math.max(0, dynamicSalarioBaseUsd - dynamicTotalConsumosUsd);

                            return (
                            <div className="rounded-3xl border border-brand/20 bg-brand-light/30 dark:bg-brand/5 p-4 sm:p-5 space-y-4">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div>
                                        <h4 className="text-sm font-black text-slate-800 dark:text-white">
                                            Detalle de {payrollDetail.employee?.employeeNombre || 'Empleado'} · Período {payrollDetail.periodoId}
                                        </h4>
                                        <p className="text-[11px] text-slate-400">
                                            {payrollDetail.employee?.cargo || 'Personal'} · {activeConsumptionsList.length} consumo(s) activo(s) · {payrollDetail.settlements?.length || 0} liquidación(es)
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                try {
                                                    await generateEmployeePayrollPDF({
                                                        employee: {
                                                            nombre: payrollDetail.employee?.employeeNombre || 'Empleado',
                                                            cargo: payrollDetail.employee?.cargo || 'Personal',
                                                            salarioSemanalUsd: dynamicSalarioBaseUsd,
                                                            limiteConsumoPorc: payrollDetail.employee?.limiteConsumoPorc || 100
                                                        },
                                                        summary: {
                                                            periodoId: payrollDetail.periodoId,
                                                            salarioSemanalUsd: dynamicSalarioBaseUsd,
                                                            totalConsumosUsd: dynamicTotalConsumosUsd,
                                                            netoAPagarUsd: dynamicNetoAPagarUsd,
                                                            netoAPagarBs: (effectiveRate || 0) * dynamicNetoAPagarUsd
                                                        },
                                                        consumptions: payrollDetail.consumptions,
                                                        settlements: payrollDetail.settlements,
                                                        bcvRate: effectiveRate
                                                    });
                                                    showToast('Reporte PDF descargado con éxito', 'success');
                                                } catch (err) {
                                                    console.error('Error generando PDF:', err);
                                                    showToast('No se pudo generar el PDF', 'error');
                                                }
                                            }}
                                            className="min-h-10 px-3.5 rounded-xl bg-brand text-white text-xs font-black flex items-center gap-1.5 active:scale-95 shadow-sm hover:bg-brand/90 transition-all"
                                        >
                                            <FileText size={15} />
                                            <span>Descargar PDF</span>
                                        </button>
                                        <button type="button" onClick={() => setPayrollDetail(null)} className="p-2 rounded-xl text-slate-400 hover:bg-white/70 dark:hover:bg-slate-800" aria-label="Cerrar detalle"><X size={16} /></button>
                                    </div>
                                </div>

                                {/* Resumen Financiero del Empleado */}
                                <div className="grid grid-cols-3 gap-2 text-center rounded-2xl bg-white dark:bg-slate-900 p-3 border border-slate-100 dark:border-slate-800">
                                    <div>
                                        <p className="text-[10px] uppercase font-bold text-slate-400">Salario Base</p>
                                        <strong className="text-xs sm:text-sm font-black text-slate-800 dark:text-white">{formatPayrollUsd(dynamicSalarioBaseUsd)}</strong>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase font-bold text-amber-500">Consumido</p>
                                        <strong className="text-xs sm:text-sm font-black text-amber-600">-{formatPayrollUsd(dynamicTotalConsumosUsd)}</strong>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase font-bold text-emerald-500">Saldo Restante</p>
                                        <strong className="text-xs sm:text-sm font-black text-emerald-600">{formatPayrollUsd(dynamicNetoAPagarUsd)}</strong>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    {payrollDetail.consumptions.map(item => (
                                        <div key={item.id} className="rounded-2xl bg-white/80 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800 p-3">
                                            <div className="flex items-center justify-between gap-2 text-xs">
                                                <strong>{new Date(item.timestamp || item.createdAt).toLocaleString('es-VE')}</strong>
                                                <strong className="text-slate-800 dark:text-white">{formatPayrollUsd(item.totalUsd)}</strong>
                                            </div>
                                            <p className="text-[11px] text-slate-500 mt-1">{(item.items || []).map(line => `${line.qty} × ${line.name}`).join(', ') || 'Sin líneas'}</p>
                                            <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${item.status === 'VOIDED' ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400' : (item.settlementId ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400' : 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400')}`}>
                                                    {item.status === 'VOIDED' ? 'ANULADO' : (item.settlementId ? 'LIQUIDADO' : 'CONSUMIDO')}
                                                </span>
                                                {item.status !== 'VOIDED' && !item.settlementId && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleVoidConsumptionSupervisor(item)}
                                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black text-rose-600 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 transition-colors"
                                                        title="Anular consumo y devolver stock en la caja"
                                                    >
                                                        <RotateCcw size={12} /> Anular
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {payrollDetail.settlements.map(item => (
                                        <div key={item.id} className="rounded-2xl bg-emerald-50/80 dark:bg-emerald-950/20 border border-emerald-200/70 dark:border-emerald-900/50 p-3 text-xs">
                                            <div className="flex items-center justify-between gap-2">
                                                <strong className="text-emerald-800 dark:text-emerald-300">Liquidación {item.status === 'PAID' ? 'PAGADA' : (item.status === 'VOIDED' ? 'ANULADA' : item.status)}</strong>
                                                <strong className="text-emerald-700 dark:text-emerald-300">{formatPayrollUsd(item.netoAPagarUsd)}</strong>
                                            </div>
                                            <p className="text-[11px] text-slate-500 mt-1">{item.paidAt ? new Date(item.paidAt).toLocaleString('es-VE') : 'Pendiente de pago'}</p>
                                        </div>
                                    ))}
                                    {payrollDetail.consumptions.length === 0 && payrollDetail.settlements.length === 0 && (
                                        <p className="py-4 text-center text-xs font-medium text-slate-400">
                                            Proyección calculada. Los tickets detallados se archivan al sincronizar caja.
                                        </p>
                                    )}
                                </div>
                            </div>
                            );
                        })()}
                    </div>
    );
}
