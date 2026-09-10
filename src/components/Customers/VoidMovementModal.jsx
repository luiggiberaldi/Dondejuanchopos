import React, { useState } from 'react';
import { X, RotateCcw, AlertTriangle, ArrowRight, User, Calendar, ShoppingBag, Loader2, Lock, CheckCircle2 } from 'lucide-react';
import { round2, mulR, subR, sumR } from '../../utils/dinero';
import { formatUsd, formatBs, formatCop } from '../../utils/calculatorUtils';

export default function VoidMovementModal({
    isOpen,
    movement,
    customer,
    onClose,
    onConfirm,
    bcvRate,
    tasaCop,
    copEnabled,
    copPrimary
}) {
    const [isProcessing, setIsProcessing] = useState(false);

    if (!isOpen || !movement || !customer) return null;

    const isCobro = movement.tipo === 'COBRO_DEUDA';
    const isFiada = movement.tipo === 'VENTA_FIADA';
    const isCashea = movement.tipo === 'VENTA_CASHEA';
    const isManualCredit = isFiada && (!movement.items || movement.items.some(i => String(i.name || '').toLowerCase().includes('credito manual')));
    const hasPhysicalProducts = !isCobro && !isManualCredit && Array.isArray(movement.items) && movement.items.length > 0;

    // Tipo de movimiento
    let movementTitle = 'Venta';
    let movementBadgeClass = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
    if (isCobro) {
        movementTitle = 'Abono de Deuda';
        movementBadgeClass = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400';
    } else if (isManualCredit) {
        movementTitle = 'Crédito Manual';
        movementBadgeClass = 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400';
    } else if (isFiada) {
        movementTitle = 'Venta Fiada';
        movementBadgeClass = 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400';
    } else if (isCashea) {
        movementTitle = 'Venta Cashea';
        movementBadgeClass = 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400';
    }

    const movementAmountUsd = round2(movement.totalUsd || movement.fiadoUsd || movement.vueltoParaMonedero || 0);
    const movementAmountBs = round2(movement.totalBs || mulR(movementAmountUsd, bcvRate));

    // Fecha y hora
    const date = movement.timestamp ? new Date(movement.timestamp) : new Date();
    const dateStr = date.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false });

    // Simulación del saldo resultante tras la reversión
    const curDeuda = Number(customer.deuda) || 0;
    const curFavor = Number(customer.favor) || 0;
    const curSaldoNeto = curFavor - curDeuda;

    let simNewDeuda = curDeuda;
    let simNewFavor = curFavor;

    if (isCobro) {
        const walletDebt = Number(movement.vueltoParaMonederoDebtUsd) || (movement.vueltoParaMonederoDebtUsd == null && curDeuda === 0 ? movementAmountUsd : 0);
        const walletFavor = Number(movement.vueltoParaMonederoFavorUsd) || 0;
        
        if (movement.vueltoParaMonederoDebtUsd != null || movement.vueltoParaMonederoFavorUsd != null) {
            simNewDeuda = sumR(simNewDeuda, walletDebt);
            simNewFavor = subR(simNewFavor, walletFavor);
        } else {
            simNewDeuda = sumR(simNewDeuda, movementAmountUsd);
            if (simNewFavor >= movementAmountUsd) {
                simNewFavor = subR(simNewFavor, movementAmountUsd);
                simNewDeuda = curDeuda;
            }
        }
    } else if (isFiada) {
        const fiadoAmt = round2(movement.fiadoUsd || movementAmountUsd);
        if (simNewDeuda >= fiadoAmt) {
            simNewDeuda = subR(simNewDeuda, fiadoAmt);
        } else {
            const excess = subR(fiadoAmt, simNewDeuda);
            simNewDeuda = 0;
            simNewFavor = sumR(simNewFavor, excess);
        }
    } else if (isCashea) {
        // Cashea no modifica favor/deuda regular
    }

    // Regla de Oro
    if (simNewFavor < 0) {
        simNewDeuda = sumR(simNewDeuda, Math.abs(simNewFavor));
        simNewFavor = 0;
    }
    if (simNewDeuda < 0) simNewDeuda = 0;
    const simSaldoNeto = subR(simNewFavor, simNewDeuda);
    let finalPreviewUsd = simSaldoNeto;
    if (Math.abs(simSaldoNeto) <= 0.015) finalPreviewUsd = 0;

    const formatSaldo = (val) => {
        const isCopP = copEnabled && copPrimary && tasaCop > 0;
        if (val > 0.001) return { text: isCopP ? `+${formatCop(val * tasaCop)} COP` : `+$${formatUsd(val)}`, label: 'a favor', color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40' };
        if (val < -0.001) return { text: isCopP ? `-${formatCop(Math.abs(val) * tasaCop)} COP` : `-$${formatUsd(Math.abs(val))}`, label: 'debe', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800/40' };
        return { text: isCopP ? '0 COP' : '$0.00', label: 'al dia', color: 'text-slate-500', bg: 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700' };
    };

    const saldoActual = formatSaldo(curSaldoNeto);
    const saldoPreview = formatSaldo(finalPreviewUsd);

    const handleConfirmClick = async () => {
        if (isProcessing) return;
        setIsProcessing(true);
        try {
            await onConfirm(movement);
            onClose();
        } catch (err) {
            console.error('[VoidMovementModal] Error al revertir:', err);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200 border border-slate-100 dark:border-slate-800"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-red-500/[0.04] dark:bg-red-500/[0.08]">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                            <RotateCcw size={16} />
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-slate-800 dark:text-white leading-tight">
                                Revertir Movimiento
                            </h3>
                            <p className="text-[10px] font-bold text-slate-400">Deshacer operación registrada</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isProcessing}
                        className="p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors disabled:opacity-50"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 space-y-3.5 max-h-[72vh] overflow-y-auto">
                    {/* Tarjeta del Movimiento a Revertir */}
                    <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${movementBadgeClass}`}>
                                {movementTitle}
                            </span>
                            <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                                <Calendar size={10} /> {dateStr} · {timeStr}
                            </span>
                        </div>

                        <div className="flex items-baseline justify-between pt-1">
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Monto Registrado</p>
                                <p className="text-xl font-black text-slate-800 dark:text-white leading-none mt-0.5">
                                    {isCobro ? '+' : ''}${formatUsd(movementAmountUsd)}
                                </p>
                            </div>
                            {bcvRate > 0 && (
                                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 text-right">
                                    {formatBs(movementAmountBs)} Bs
                                </p>
                            )}
                        </div>

                        {movement.items && movement.items.length > 0 && (
                            <p className="text-[10px] text-slate-400 truncate border-t border-slate-200/50 dark:border-slate-700/50 pt-1.5 mt-1">
                                {movement.items.map(i => i.name).join(', ')}
                            </p>
                        )}
                    </div>

                    {/* Cliente Afectado */}
                    <div className="flex items-center gap-2.5 px-3 py-2 bg-slate-50/50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-800">
                        <User size={14} className="text-slate-400 shrink-0" />
                        <span className="text-xs font-black text-slate-700 dark:text-slate-200 truncate">
                            {customer.name}
                        </span>
                        {customer.code && (
                            <span className="text-[10px] font-mono font-bold text-slate-400 ml-auto shrink-0">
                                {customer.code}
                            </span>
                        )}
                    </div>

                    {/* Simulación del Impacto en el Balance */}
                    <div className={`p-3.5 rounded-2xl border ${saldoPreview.bg} space-y-2`}>
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                            Impacto en la Cuenta del Cliente
                        </p>
                        <div className="flex items-center justify-between gap-2">
                            <div>
                                <span className="text-[10px] font-bold text-slate-400 block">Saldo Actual</span>
                                <span className={`text-sm font-black ${saldoActual.color}`}>
                                    {saldoActual.text}
                                </span>
                            </div>
                            <ArrowRight size={16} className="text-slate-300 dark:text-slate-600 shrink-0" />
                            <div className="text-right">
                                <span className="text-[10px] font-bold text-slate-400 block">Nuevo Saldo</span>
                                <span className={`text-base font-black ${saldoPreview.color}`}>
                                    {saldoPreview.text}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Notas Contextuales de la Reversión */}
                    <div className="space-y-2 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        {isCobro && (
                            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-500/[0.06] border border-amber-200/60 dark:border-amber-900/40 text-amber-800 dark:text-amber-300 text-[10px]">
                                <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-600" />
                                <span>Al revertir este abono, la deuda de <strong>${formatUsd(movementAmountUsd)}</strong> volverá a cargarse a la cuenta del cliente.</span>
                            </div>
                        )}

                        {isManualCredit && (
                            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-blue-500/[0.06] border border-blue-200/60 dark:border-blue-900/40 text-blue-800 dark:text-blue-300 text-[10px]">
                                <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-blue-600" />
                                <span>Se anulará el crédito manual y se descontará la deuda generada al cliente.</span>
                            </div>
                        )}

                        {hasPhysicalProducts && (
                            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-blue-500/[0.06] border border-blue-200/60 dark:border-blue-900/40 text-blue-800 dark:text-blue-300 text-[10px]">
                                <ShoppingBag size={14} className="shrink-0 mt-0.5 text-blue-600" />
                                <span>Se devolverán automáticamente los productos de la venta al inventario de la bodega.</span>
                            </div>
                        )}

                        {movement.cajaCerrada && (
                            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-purple-500/[0.06] border border-purple-200/60 dark:border-purple-900/40 text-purple-800 dark:text-purple-300 text-[10px]">
                                <Lock size={14} className="shrink-0 mt-0.5 text-purple-600" />
                                <span>Este movimiento pertenece a una caja ya cerrada. Se ajustará el saldo del cliente, pero el arqueo cerrado se mantendrá intacto.</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 flex gap-2.5">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isProcessing}
                        className="flex-1 py-3 px-3 text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-bold rounded-xl active:scale-95 transition-all text-xs border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirmClick}
                        disabled={isProcessing}
                        className="flex-[1.6] py-3 px-3 bg-red-600 hover:bg-red-700 active:scale-95 text-white font-black rounded-xl transition-all text-xs flex justify-center items-center gap-1.5 shadow-md shadow-red-500/20 disabled:opacity-50"
                    >
                        {isProcessing ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                <span>Revirtiendo...</span>
                            </>
                        ) : (
                            <>
                                <RotateCcw size={15} />
                                <span>Confirmar Reversión</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
