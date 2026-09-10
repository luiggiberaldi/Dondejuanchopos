import React, { useState, useEffect } from 'react';
import { X, ArrowDownRight, ArrowUpRight, CheckCircle2, Save, ArrowLeft, User, CreditCard, ShieldCheck } from 'lucide-react';
import { procesarImpactoCliente } from '../../utils/financialLogic';
import { round2, mulR } from '../../utils/dinero';
import { formatUsd, formatBs, formatCop } from '../../utils/calculatorUtils';
import CustomSelect from '../CustomSelect';

export default function TransactionModal({
    transactionModal,
    setTransactionModal,
    transactionAmount,
    setTransactionAmount,
    currencyMode,
    setCurrencyMode,
    paymentMethod,
    setPaymentMethod,
    activePaymentMethods = [],
    bcvRate,
    tasaCop,
    copEnabled,
    copPrimary,
    handleTransaction
}) {
    if (!transactionModal.isOpen || !transactionModal.customer) return null;

    const [isFullPayment, setIsFullPayment] = useState(false);
    const [showConfirmation, setShowConfirmation] = useState(false);

    // Resetear confirmación al cambiar de cliente, tipo o visibilidad
    useEffect(() => {
        setShowConfirmation(false);
    }, [transactionModal.isOpen, transactionModal.customer?.id, transactionModal.type]);

    // Calcular preview del saldo resultante en tiempo real
    const rawAmt = parseFloat(transactionAmount) || 0;
    let amtUsd = rawAmt;
    if (currencyMode === 'BS' && bcvRate > 0) amtUsd = rawAmt / bcvRate;
    if (currencyMode === 'COP' && tasaCop > 0) amtUsd = rawAmt / tasaCop;
    const currentCustomer = transactionModal.customer;

    let appliedUsd = amtUsd;
    if (transactionModal.type === 'ABONO') {
        const currentDeuda = Number(currentCustomer?.deuda) || 0;
        if (currentDeuda > 0 && (isFullPayment || Math.abs(amtUsd - currentDeuda) <= 0.02)) {
            appliedUsd = currentDeuda;
        }
    }

    let previewCustomer = null;
    if (rawAmt > 0) {
        const opts = transactionModal.type === 'ABONO'
            ? { costoTotal: 0, pagoReal: appliedUsd, vueltoParaMonedero: appliedUsd }
            : { esCredito: true, deudaGenerada: appliedUsd };
        previewCustomer = procesarImpactoCliente(currentCustomer, opts);
    }

    // Saldo actual legible
    const saldoActualUsd = (currentCustomer.favor || 0) - (currentCustomer.deuda || 0);
    const saldoPreviewUsd = previewCustomer ? (previewCustomer.favor || 0) - (previewCustomer.deuda || 0) : saldoActualUsd;

    const formatSaldo = (val) => {
        const isCopP = copEnabled && copPrimary && tasaCop > 0;
        if (val > 0.001) return { text: isCopP ? `+${formatCop(val * tasaCop)} COP` : `+$${formatUsd(val)}`, label: 'a favor', color: isCopP ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/30' };
        if (val < -0.001) return { text: isCopP ? `-${formatCop(Math.abs(val) * tasaCop)} COP` : `-$${formatUsd(Math.abs(val))}`, label: 'debe', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/30' };
        return { text: isCopP ? '0 COP' : '$0.00', label: 'al dia', color: 'text-slate-500', bg: 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700' };
    };

    const saldoActual = formatSaldo(saldoActualUsd);
    const saldoPreview = formatSaldo(saldoPreviewUsd);

    const displayAmount = currencyMode === 'BS'
        ? `Bs ${formatBs(rawAmt)}`
        : currencyMode === 'COP'
        ? `${formatBs(rawAmt)} COP`
        : `$${formatUsd(rawAmt)}`;

    const equivUsdText = currencyMode !== 'USD' && bcvRate > 0 ? `$${formatUsd(appliedUsd)} USD` : null;
    const equivBsText = currencyMode !== 'BS' && bcvRate > 0 ? `Bs ${formatBs(round2(mulR(appliedUsd, bcvRate)))}` : null;
    const equivCopText = currencyMode !== 'COP' && copEnabled && tasaCop > 0 ? `${formatBs(round2(mulR(appliedUsd, tasaCop)))} COP` : null;

    const safeMethods = Array.isArray(activePaymentMethods) ? activePaymentMethods : [];
    const filteredMethods = safeMethods.filter(m => m.currency === currencyMode);
    const selectedMethodObj = filteredMethods.find(m => m.id === paymentMethod)
        || safeMethods.find(m => m.id === paymentMethod)
        || filteredMethods[0]
        || { label: paymentMethod || 'Efectivo' };
    const SelectedMethodIcon = selectedMethodObj?.Icon || CreditCard;

    // ── VISTA DE CONFIRMACIÓN CON RESUMEN ──
    if (showConfirmation) {
        return (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-t-3xl sm:rounded-3xl shadow-xl overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200 border border-slate-100 dark:border-slate-800">
                    <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/70 dark:bg-slate-800/40">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setShowConfirmation(false)}
                                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                                title="Volver a editar"
                            >
                                <ArrowLeft size={18} />
                            </button>
                            <div>
                                <h3 className="text-base font-black text-slate-800 dark:text-white leading-tight">
                                    Confirmar {transactionModal.type === 'ABONO' ? 'Abono' : 'Nueva Deuda'}
                                </h3>
                                <p className="text-[10px] font-bold text-slate-400">Revisa el resumen de la operación</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setShowConfirmation(false);
                                setTransactionModal({ isOpen: false, type: null, customer: null });
                            }}
                            className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    <div className="p-5 space-y-3.5 max-h-[70vh] overflow-y-auto">
                        {/* Cliente */}
                        <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800">
                            <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center font-black text-sm shrink-0">
                                {currentCustomer.name?.charAt(0).toUpperCase() || 'C'}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-black text-slate-800 dark:text-white truncate">
                                    {currentCustomer.name}
                                </p>
                                <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold">
                                    {currentCustomer.code && <span>{currentCustomer.code}</span>}
                                    {currentCustomer.documentId && <span>· C.I: {currentCustomer.documentId}</span>}
                                </div>
                            </div>
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                                transactionModal.type === 'ABONO'
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                                    : 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                            }`}>
                                {transactionModal.type === 'ABONO' ? 'ABONO' : 'DEUDA'}
                            </span>
                        </div>

                        {/* Monto Principal con Equivalencias */}
                        <div className="p-4 rounded-2xl bg-gradient-to-b from-slate-50 to-white dark:from-slate-800/40 dark:to-slate-900 border border-slate-200/80 dark:border-slate-800 text-center shadow-xs">
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                                {transactionModal.type === 'ABONO' ? 'Monto que abonará el cliente' : 'Monto que se cargará a la cuenta'}
                            </p>
                            <div className={`text-3xl font-black tracking-tight ${
                                transactionModal.type === 'ABONO' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                            }`}>
                                {displayAmount}
                            </div>
                            <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/60 flex flex-wrap items-center justify-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
                                {equivUsdText && <span className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-md">{equivUsdText}</span>}
                                {equivBsText && <span className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-md">{equivBsText}</span>}
                                {equivCopText && <span className="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-md">{equivCopText}</span>}
                            </div>
                            {bcvRate > 0 && (
                                <p className="text-[9px] text-slate-400 mt-1.5 font-medium">Tasa BCV de referencia: {formatBs(bcvRate)} Bs/$</p>
                            )}
                        </div>

                        {/* Método de Pago */}
                        {transactionModal.type === 'ABONO' && (
                            <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-800">
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Método de Pago:</span>
                                <div className="flex items-center gap-1.5 font-bold text-sm text-slate-800 dark:text-white">
                                    <SelectedMethodIcon size={16} className="text-brand shrink-0" />
                                    <span>{selectedMethodObj.label}</span>
                                </div>
                            </div>
                        )}

                        {/* Impacto en Cuenta */}
                        <div className={`p-3.5 rounded-xl border ${saldoPreview.bg} space-y-2`}>
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                Balance de la Cuenta
                            </p>
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <span className="text-[10px] font-bold text-slate-400 block">Saldo Actual</span>
                                    <span className={`text-sm font-black ${saldoActual.color}`}>
                                        {saldoActual.text}
                                    </span>
                                </div>
                                <div className="text-slate-300 dark:text-slate-600 font-bold text-lg">→</div>
                                <div className="text-right">
                                    <span className="text-[10px] font-bold text-slate-400 block">Nuevo Saldo</span>
                                    <span className={`text-base font-black ${saldoPreview.color}`}>
                                        {saldoPreview.text}
                                    </span>
                                </div>
                            </div>
                            {bcvRate > 0 && (
                                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 text-right border-t border-black/5 dark:border-white/5 pt-1.5 mt-1">
                                    Ref. local nuevo saldo: {saldoPreviewUsd >= 0 ? '+' : '-'}{formatBs(Math.abs(saldoPreviewUsd) * bcvRate)} Bs
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 flex gap-2.5">
                        <button
                            type="button"
                            onClick={() => setShowConfirmation(false)}
                            className="flex-1 py-3 px-3 text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-bold rounded-xl active:scale-95 transition-all text-xs border border-slate-200 dark:border-slate-700"
                        >
                            Modificar
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setShowConfirmation(false);
                                handleTransaction(isFullPayment);
                            }}
                            className={`flex-[1.5] py-3 px-3 text-white font-black rounded-xl active:scale-95 transition-all text-xs flex justify-center items-center gap-1.5 shadow-md ${
                                transactionModal.type === 'ABONO'
                                    ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20'
                                    : 'bg-red-600 hover:bg-red-700 shadow-red-500/20'
                            }`}
                        >
                            <CheckCircle2 size={16} />
                            {transactionModal.type === 'ABONO' ? 'Confirmar Abono' : 'Confirmar Deuda'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-t-3xl sm:rounded-3xl shadow-xl overflow-visible animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200">
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                    <h3 className="text-xl font-black text-slate-800 dark:text-white">Ajustar Cuenta</h3>
                    <button onClick={() => setTransactionModal({ isOpen: false, type: null, customer: null })} className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {/* Cliente + Saldo Actual */}
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                            <strong className="text-slate-900 dark:text-white">{currentCustomer.name}</strong>
                        </p>
                        <span className={`text-sm font-black ${saldoActual.color}`}>{saldoActual.text} <span className="text-[10px] font-bold opacity-70">({saldoActual.label})</span></span>
                    </div>

                    {/* Tipo de operacion */}
                    <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                        <button
                            type="button"
                            onClick={() => { setTransactionModal(m => ({ ...m, type: 'CREDITO' })); setTransactionAmount(''); }}
                            className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${transactionModal.type === 'CREDITO' ? 'bg-white dark:bg-slate-900 shadow-sm text-red-500' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        >
                            <ArrowDownRight size={16} /> Agregar Deuda
                        </button>
                        <button
                            type="button"
                            onClick={() => { setTransactionModal(m => ({ ...m, type: 'ABONO' })); setTransactionAmount(''); }}
                            className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${transactionModal.type === 'ABONO' ? 'bg-white dark:bg-slate-900 shadow-sm text-emerald-500' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        >
                            <ArrowUpRight size={16} /> Recibir Abono
                        </button>
                    </div>

                    {/* Moneda */}
                    <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                        <button
                            type="button"
                            onClick={() => { setCurrencyMode('USD'); setTransactionAmount(''); setPaymentMethod('efectivo_usd'); }}
                            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${currencyMode === 'USD' ? 'bg-white dark:bg-slate-900 shadow-sm text-emerald-500' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        >
                            USD
                        </button>
                        <button
                            type="button"
                            onClick={() => { setCurrencyMode('BS'); setTransactionAmount(''); setPaymentMethod('efectivo_bs'); }}
                            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${currencyMode === 'BS' ? 'bg-white dark:bg-slate-900 shadow-sm text-brand' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        >
                            Bs
                        </button>
                        {copEnabled && (
                            <button
                                type="button"
                                onClick={() => { setCurrencyMode('COP'); setTransactionAmount(''); setPaymentMethod('efectivo_cop'); }}
                                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${currencyMode === 'COP' ? 'bg-white dark:bg-slate-900 shadow-sm text-amber-500' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                            >
                                COP
                            </button>
                        )}
                    </div>

                    {/* Input de monto */}
                    <div>
                        <div className="relative">
                            <span className={`absolute left-4 top-1/2 -translate-y-1/2 font-black text-lg ${currencyMode === 'BS' ? 'text-brand' : 'text-emerald-500'}`}>
                                {currencyMode === 'BS' ? 'Bs' : '$'}
                            </span>
                            <input
                                type="number"
                                value={transactionAmount}
                                onChange={(e) => {
                                    setTransactionAmount(e.target.value);
                                    setIsFullPayment(false);
                                }}
                                placeholder="0.00"
                                className={`w-full form-input bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-4 ${currencyMode === 'BS' ? 'pl-12' : 'pl-10'} text-2xl font-black text-slate-800 dark:text-white focus:ring-2 focus:ring-brand/50 transition-all`}
                                autoFocus
                            />
                        </div>
                        {/* Boton Pagar Total — solo cuando hay deuda y es ABONO */}
                        {transactionModal.type === 'ABONO' && (currentCustomer.deuda || 0) > 0.01 && (
                            <button
                                type="button"
                                onClick={() => {
                                    setIsFullPayment(true);
                                    const deudaUsd = currentCustomer.deuda || 0;
                                    if (currencyMode === 'BS' && bcvRate > 0) {
                                        const debtBsToUse = round2(mulR(deudaUsd, bcvRate));
                                        setTransactionAmount(debtBsToUse.toFixed(2));
                                    } else if (currencyMode === 'COP' && tasaCop > 0) {
                                        setTransactionAmount(round2(mulR(deudaUsd, tasaCop)).toFixed(2));
                                    } else {
                                        setTransactionAmount(round2(deudaUsd).toFixed(2));
                                    }
                                }}
                                className="mt-2 w-full py-2 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-all active:scale-95 flex items-center justify-center gap-1.5"
                            >
                                <CheckCircle2 size={14} />
                                Pagar Total: {currencyMode === 'BS' && bcvRate > 0
                                    ? `Bs ${formatBs(round2(mulR(currentCustomer.deuda || 0, bcvRate)))}`
                                    : currencyMode === 'COP' && tasaCop > 0
                                    ? `${formatBs(round2(mulR(currentCustomer.deuda || 0, tasaCop)))} COP`
                                    : `USD ${formatUsd(currentCustomer.deuda || 0)}`
                                }
                            </button>
                        )}
                        {/* Conversion info */}
                        {currencyMode === 'BS' && transactionAmount && bcvRate > 0 && (
                            <div className="bg-brand-light/50 dark:bg-surface-800/10 border border-surface-200 dark:border-surface-800/30 rounded-lg p-2 mt-3 flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-500">Equivale a:</span>
                                <span className="text-sm font-black text-brand-dark dark:text-brand">
                                    ${(parseFloat(transactionAmount) / bcvRate).toFixed(2)} USD
                                </span>
                            </div>
                        )}
                        {currencyMode === 'USD' && transactionAmount && bcvRate > 0 && (
                            <div className="bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30 rounded-lg p-2 mt-3 flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-500">Equivale a:</span>
                                <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                                    {formatBs(parseFloat(transactionAmount) * bcvRate)} Bs
                                    {copEnabled && tasaCop > 0 && ` · ${formatCop(parseFloat(transactionAmount) * tasaCop)} COP`}
                                </span>
                            </div>
                        )}
                        {currencyMode === 'COP' && transactionAmount && tasaCop > 0 && (
                            <div className="bg-amber-50/50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 rounded-lg p-2 mt-3 flex flex-col gap-1">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-slate-500">Equivale a:</span>
                                    <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                                        ${(parseFloat(transactionAmount) / tasaCop).toFixed(2)} USD
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-slate-500">Ref local:</span>
                                    <span className="text-xs font-black text-brand-dark dark:text-brand">
                                        {formatBs((parseFloat(transactionAmount) / tasaCop) * bcvRate)} Bs
                                    </span>
                                </div>
                            </div>
                        )}
                        <p className="text-[10px] font-medium text-slate-400 mt-2 text-center flex items-center justify-center gap-2">
                            <span>Tasa BCV: {formatBs(bcvRate)} Bs/$</span>
                            {copEnabled && <span>• Tasa COP: {formatBs(tasaCop)} COP/$</span>}
                        </p>
                    </div>

                    {/* Metodo de pago (solo para abonos) */}
                    {transactionModal.type === 'ABONO' && (() => {
                        const filteredMethods = activePaymentMethods.filter(m => m.currency === currencyMode);
                        return (
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Metodo de Pago</label>
                             <CustomSelect
                                value={filteredMethods.some(m => m.id === paymentMethod) ? paymentMethod : (filteredMethods[0]?.id || '')}
                                onChange={setPaymentMethod}
                                options={filteredMethods.map(method => {
                                    return {
                                        value: method.id,
                                        label: method.label,
                                        icon: method.Icon // Componente Lucide de alta calidad
                                    };
                                })}
                            />
                        </div>
                        );
                    })()}

                    {/* PREVIEW del saldo resultante */}
                    {rawAmt > 0 && previewCustomer && (
                        <div className={`border rounded-xl p-3 ${saldoPreview.bg} transition-all`}>
                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">Cuenta despues de esta operacion</p>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-slate-400 line-through">{saldoActual.text}</span>
                                    <span className="text-slate-300 dark:text-slate-600">→</span>
                                </div>
                                <span className={`text-lg font-black ${saldoPreview.color}`}>
                                    {saldoPreview.text}
                                </span>
                            </div>
                            {bcvRate > 0 && (
                                <p className="text-[10px] font-bold text-slate-400 mt-1 text-right">
                                    {copEnabled && copPrimary && tasaCop > 0
                                        ? <>{saldoPreviewUsd >= 0 ? '+' : '-'}${formatUsd(Math.abs(saldoPreviewUsd))} · {formatBs(Math.abs(saldoPreviewUsd) * bcvRate)} Bs</>
                                        : <>{saldoPreviewUsd >= 0 ? '+' : '-'}{formatBs(Math.abs(saldoPreviewUsd) * bcvRate)} Bs
                                    {copEnabled && tasaCop > 0 && ` · ${formatCop(Math.abs(saldoPreviewUsd) * tasaCop)} COP`}</>}
                                </p>
                            )}
                        </div>
                    )}

                </div>

                <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                    <button
                        type="button"
                        onClick={() => setShowConfirmation(true)}
                        disabled={!transactionAmount || parseFloat(transactionAmount) <= 0}
                        className={`w-full py-3.5 text-white font-bold rounded-xl active:scale-95 transition-all text-sm flex justify-center items-center gap-2 ${transactionModal.type === 'ABONO'
                            ? 'bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50'
                            : 'bg-red-500 hover:bg-red-600 disabled:bg-red-500/50'
                            }`}
                    >
                        <Save size={18} />
                        {transactionModal.type === 'ABONO'
                            ? `Abonar ${currencyMode === 'BS' ? 'Bs' : currencyMode === 'COP' ? 'COP' : '$'}${transactionAmount || '0.00'}`
                            : `Cargar Deuda ${currencyMode === 'BS' ? 'Bs' : currencyMode === 'COP' ? 'COP' : '$'}${transactionAmount || '0.00'}`
                        }
                    </button>
                </div>
            </div>
        </div>
    );
}
