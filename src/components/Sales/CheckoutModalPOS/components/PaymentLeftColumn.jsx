import React, { memo, useState } from 'react';
import { Banknote, CreditCard, HandCoins, CheckCircle, Smartphone, HeartHandshake, DollarSign, Building2, Handshake, Cog, ChevronDown, Check } from 'lucide-react';
import { round2, subR, mulR } from '../../../../utils/dinero';
import TransactionSummary from './TransactionSummary';
import CheckoutCustomerPicker from '../../CheckoutCustomerPicker';
import CasheaIcon from '../../../CasheaIcon';

/**
 * PaymentLeftColumn — Columna izquierda del modo POS.
 * Contiene: resumen de totales, selector de cliente, estado de pago (falta/vuelto/crédito), Cashea.
 */
const PaymentLeftColumn = ({
    totalUSD,
    totalBS,
    pricingErrors = [],
    discountData,
    tasaSegura,
    clienteSeleccionado,
    setClienteSeleccionado,
    customers,
    onCreateCustomer,
    modo,
    proyeccion,
    totalPagadoGlobalUSD,
    faltaPorPagar,
    faltaPorPagarBS,
    cambioUSD,
    distVueltoUSD,
    distVueltoBS,
    handleVueltoDistChange,
    isChangeCredited,
    handleCreditChange,
    setIsChangeCredited,
    deudaCliente,
    isVueltoValido,
    casheaActive,
    setCasheaActive,
    casheaPercent,
    setCasheaPercent,
    casheaAmountUsd,
    casheaEnabled,
    casheaMeetsMinimum,
    effectiveRate,
    isTipDonated,
    toggleTipDonated,
    tipCurrency,
    // FX19
    cambioFaltante = 0,
    isChangeOwed = false,
    setIsChangeOwed = () => {},
    changeOwedMethod = 'pago_movil',
    setChangeOwedMethod = () => {},
    changeOwedNote = '',
    setChangeOwedNote = () => {},
}) => {
    const isPending = modo === 'contado' && faltaPorPagar > 0.01;
    const isPaid = modo === 'contado' && faltaPorPagar <= 0.01;
    const isCredit = modo === 'credito';

    // FX19: mostrar banner cuando hay vuelto sin asignar y no se han usado otras salidas
    const hasIncompleteChange = cambioFaltante > 0.009 && !isChangeCredited;

    const [isMethodDropdownOpen, setIsMethodDropdownOpen] = useState(false);

    const PAYMENT_METHODS = [
        { id: 'pago_movil', label: 'Pago Móvil', icon: Smartphone, iconColor: 'text-emerald-600 dark:text-emerald-400' },
        { id: 'zelle', label: 'Zelle', icon: DollarSign, iconColor: 'text-green-600 dark:text-green-400' },
        { id: 'transferencia', label: 'Transferencia', icon: Building2, iconColor: 'text-blue-600 dark:text-blue-400' },
        { id: 'efectivo_externo', label: 'Efectivo Externo', icon: Handshake, iconColor: 'text-amber-600 dark:text-amber-400' },
        { id: 'otro', label: 'Otro', icon: Cog, iconColor: 'text-slate-500' },
    ];

    const selectedMethodObj = PAYMENT_METHODS.find(m => m.id === changeOwedMethod) || PAYMENT_METHODS[0];
    const SelectedIcon = selectedMethodObj.icon;

    return (
        <div className="w-full lg:w-[38%] max-h-[45%] lg:max-h-none bg-slate-50 dark:bg-slate-900 border-b lg:border-b-0 lg:border-r border-slate-100 dark:border-slate-800 flex flex-col overflow-hidden">

            {/* Resumen del total */}
            <TransactionSummary
                totalUSD={totalUSD}
                totalBS={totalBS}
                pricingErrors={pricingErrors}
                discountData={discountData}
                tasaSegura={tasaSegura}
            />

            {/* Contenido scrollable */}
            <div className="flex-1 overflow-y-auto px-4 pb-4 pt-2 space-y-3">

                {/* Selector de cliente */}
                <CheckoutCustomerPicker
                    customers={customers}
                    selectedCustomerId={clienteSeleccionado}
                    setSelectedCustomerId={setClienteSeleccionado}
                    effectiveRate={effectiveRate}
                    onCreateCustomer={onCreateCustomer}
                />

                {/* Panel Cashea */}
                {casheaEnabled && casheaMeetsMinimum && clienteSeleccionado && (
                    <div className="p-3 bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/40 rounded-xl space-y-2 animate-in fade-in duration-300">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <CasheaIcon size={18} />
                                <span className="font-bold text-sm text-purple-900 dark:text-purple-300 uppercase tracking-wide">Cashea</span>
                            </div>
                            <button
                                onClick={() => setCasheaActive(!casheaActive)}
                                type="button"
                                aria-label="Activar Cashea"
                                aria-pressed={casheaActive}
                                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                                    casheaActive ? 'bg-purple-600' : 'bg-slate-200 dark:bg-slate-700'
                                }`}
                            >
                                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${casheaActive ? 'translate-x-4' : 'translate-x-0'}`} />
                            </button>
                        </div>
                        {casheaActive && (
                            <div className="space-y-2 animate-in slide-in-from-top-1 duration-200">
                                <div className="grid grid-cols-3 gap-1">
                                    {[60, 50, 40, 30, 20, 10].map(pct => (
                                        <button
                                            key={pct}
                                            onClick={() => setCasheaPercent(pct)}
                                             className={`min-h-[44px] py-1 text-xs font-black rounded-lg transition-all ${
                                                casheaPercent === pct
                                                    ? 'bg-purple-600 text-white shadow-md'
                                                    : 'bg-white dark:bg-slate-800 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-900/40 hover:bg-purple-100'
                                            }`}
                                        >{pct}%</button>
                                    ))}
                                </div>
                                <div className="p-2.5 bg-white dark:bg-slate-900 border border-purple-100 dark:border-purple-900/20 rounded-lg space-y-1 text-[11px]">
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Paga Hoy (Inicial):</span>
                                        <span className="font-black text-slate-800 dark:text-white">${(totalUSD - casheaAmountUsd).toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Financiado Cashea:</span>
                                        <span className="font-black text-purple-600 dark:text-purple-400">${casheaAmountUsd.toFixed(2)}</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Estado: Falta por pagar / Vuelto / Crédito */}
                <div className="space-y-1.5">
                    <div className="flex justify-between items-center px-1 text-[11px]">
                        <span className="text-slate-500 font-bold uppercase tracking-wide">Monto Pagado:</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-extrabold">${totalPagadoGlobalUSD.toFixed(2)}</span>
                    </div>

                    {/* Falta por pagar */}
                    {isPending && (
                        <div className="flex flex-col justify-center items-center text-center p-5 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm transition-all">
                            <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-slate-400">Falta por Pagar</p>
                            <p className="text-4xl lg:text-5xl font-black text-slate-800 dark:text-white my-2">${faltaPorPagar.toFixed(2)}</p>
                            <div className="text-lg font-black text-[#01696f] dark:text-[#1ce2ee]">
                                Bs {faltaPorPagarBS.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                            </div>
                        </div>
                    )}

                    {/* Vuelto */}
                    {isPaid && cambioUSD > 0.009 && (
                        <div className={`flex flex-col justify-center items-center text-center p-3.5 rounded-2xl border-2 shadow-sm transition-all ${
                            isTipDonated
                                ? 'border-emerald-500 bg-emerald-100/90 dark:bg-emerald-950/60 ring-2 ring-emerald-400/50'
                                : 'border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-950/20'
                        }`}>
                            <p className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
                                {isTipDonated ? 'Vuelto Dejado en Caja (Propina)' : 'Vuelto Total'}
                            </p>
                            <p className="text-3xl sm:text-4xl font-black text-emerald-700 dark:text-emerald-400 my-0.5">
                                ${cambioUSD.toFixed(2)}
                            </p>
                            <div className="text-xs font-black text-emerald-600 dark:text-emerald-300">
                                Bs {round2(cambioUSD * tasaSegura).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                            </div>

                            {/* Paso 1: Distribución de vuelto en efectivo */}
                            <div className="w-full mt-2.5 pt-2.5 border-t border-emerald-200/60 dark:border-emerald-800/30 flex gap-2">
                                <div className="flex-1">
                                    <label className="text-[9px] font-black text-emerald-700 dark:text-emerald-500 uppercase block mb-1">En $ USD</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            value={distVueltoUSD}
                                            onChange={e => handleVueltoDistChange('usd', e.target.value)}
                                            onFocus={e => {
                                                e.target.select();
                                                if (e.target.value === '0' || parseFloat(e.target.value) === 0) {
                                                    handleVueltoDistChange('usd', '');
                                                }
                                            }}
                                            placeholder="0.00"
                                            className="w-full py-1.5 pl-2 pr-12 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 font-bold text-xs text-slate-800 dark:text-white outline-none focus:ring-1 focus:ring-emerald-500"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const restUsd = round2(Math.max(0, subR(cambioUSD, (parseFloat(distVueltoBS || 0) / tasaSegura))));
                                                handleVueltoDistChange('usd', restUsd.toString());
                                            }}
                                            className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] font-black bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded hover:bg-emerald-200 active:scale-95 transition-all"
                                        >
                                            Todo
                                        </button>
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <label className="text-[9px] font-black text-emerald-700 dark:text-emerald-500 uppercase block mb-1">En Bs</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            value={distVueltoBS}
                                            onChange={e => handleVueltoDistChange('bs', e.target.value)}
                                            onFocus={e => {
                                                e.target.select();
                                                if (e.target.value === '0' || parseFloat(e.target.value) === 0) {
                                                    handleVueltoDistChange('bs', '');
                                                }
                                            }}
                                            placeholder="0"
                                            className="w-full py-1.5 pl-2 pr-12 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 font-bold text-xs text-slate-800 dark:text-white outline-none focus:ring-1 focus:ring-emerald-500"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const restBs = round2(Math.max(0, mulR(subR(cambioUSD, parseFloat(distVueltoUSD || 0)), tasaSegura)));
                                                handleVueltoDistChange('bs', Math.round(restBs).toString());
                                            }}
                                            className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] font-black bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded hover:bg-emerald-200 active:scale-95 transition-all"
                                        >
                                            Todo
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Paso 2: Opciones de Resolución si hay vuelto incompleto */}
                            {hasIncompleteChange && (
                                <div className="w-full mt-2.5 p-2.5 bg-amber-50/90 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 rounded-xl flex flex-col gap-2 text-left animate-in fade-in duration-200 shadow-sm">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-black text-amber-900 dark:text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                                            {cambioFaltante >= cambioUSD - 0.009
                                                ? `Vuelto no entregado: $${cambioFaltante.toFixed(2)}`
                                                : `Faltan $${cambioFaltante.toFixed(2)} por entregar`}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2 mt-0.5">
                                        {/* Donar / Ceder */}
                                        <button
                                            type="button"
                                            onClick={toggleTipDonated}
                                            aria-pressed={isTipDonated}
                                            className={`p-2 rounded-xl text-[10px] font-extrabold flex items-center justify-center gap-1.5 text-center transition-all cursor-pointer ${
                                                isTipDonated
                                                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 border border-emerald-500 ring-2 ring-emerald-400/50'
                                                    : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-amber-200/80 dark:border-amber-800/60 hover:bg-emerald-50 dark:hover:bg-slate-800 shadow-sm'
                                            }`}
                                        >
                                            <HeartHandshake size={15} className={isTipDonated ? 'text-white animate-bounce' : 'text-emerald-600 dark:text-emerald-400'} />
                                            <span>
                                                {cambioFaltante >= cambioUSD - 0.009
                                                    ? `Cliente deja el cambio ($${cambioUSD.toFixed(2)})`
                                                    : `Ceder resto ($${cambioFaltante.toFixed(2)})`}
                                            </span>
                                            {isTipDonated && <CheckCircle size={13} className="text-white ml-auto shrink-0" />}
                                        </button>

                                        {/* Pagar por fuera */}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setIsChangeOwed(prev => {
                                                    const next = !prev;
                                                    if (next && toggleTipDonated && isTipDonated) {
                                                        toggleTipDonated();
                                                    }
                                                    return next;
                                                });
                                                setIsChangeVoucher(false);
                                            }}
                                            aria-pressed={isChangeOwed}
                                            className={`min-h-[44px] p-2 rounded-xl text-[10px] font-extrabold flex items-center justify-center gap-1.5 text-center transition-all cursor-pointer ${
                                                isChangeOwed
                                                    ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30 border border-amber-500 ring-2 ring-amber-400/50'
                                                    : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-amber-200/80 dark:border-amber-800/60 hover:bg-amber-100/50 dark:hover:bg-slate-800 shadow-sm'
                                            }`}
                                        >
                                            <Smartphone size={15} className={isChangeOwed ? 'text-white' : 'text-amber-600 dark:text-amber-400'} />
                                            <span>Pagar por fuera</span>
                                            {isChangeOwed && <CheckCircle size={13} className="text-white ml-auto shrink-0" />}
                                        </button>
                                        {/* Monedero y voucher son salidas contables explícitas del mismo faltante. */}
                                        <button
                                            type="button"
                                            onClick={handleCreditChange}
                                            aria-pressed={isChangeCredited}
                                            disabled={!clienteSeleccionado}
                                            className={`min-h-[44px] p-2 rounded-xl text-[10px] font-extrabold flex items-center justify-center gap-1.5 text-center transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                                                isChangeCredited
                                                    ? 'bg-sky-600 text-white shadow-md ring-2 ring-sky-400/50'
                                                    : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-sky-200 dark:border-sky-800/60 hover:bg-sky-50 dark:hover:bg-slate-800'
                                            }`}
                                        >
                                            <DollarSign size={15} className={isChangeCredited ? 'text-white' : 'text-sky-600'} />
                                            <span>Abonar a cuenta</span>
                                            {isChangeCredited && <CheckCircle size={13} className="text-white ml-auto shrink-0" />}
                                        </button>
                                        {/* Voucher reservado: la lógica se conserva para una futura activación,
                                            pero no se ofrece en caja mientras el proceso no esté operativo. */}
                                    </div>

                                    {/* Selector de Método y Nota si Pagar por Fuera está activo */}
                                    {isChangeOwed && (
                                        <div className="mt-1.5 pt-1.5 border-t border-amber-200/80 dark:border-amber-800/40 space-y-1.5 animate-in fade-in duration-150">
                                            <div className="relative">
                                                <button
                                                    type="button"
                                                    onClick={() => setIsMethodDropdownOpen(prev => !prev)}
                                                    className="w-full flex items-center justify-between text-xs px-2.5 py-1.5 rounded-xl border border-amber-300 dark:border-amber-700/80 bg-white dark:bg-slate-900 text-slate-800 dark:text-white font-bold shadow-sm hover:border-amber-400 transition-all outline-none cursor-pointer"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <SelectedIcon size={15} className={selectedMethodObj.iconColor} />
                                                        <span>{selectedMethodObj.label}</span>
                                                    </div>
                                                    <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${isMethodDropdownOpen ? 'rotate-180' : ''}`} />
                                                </button>

                                                {isMethodDropdownOpen && (
                                                    <>
                                                        <div 
                                                            className="fixed inset-0 z-20" 
                                                            onClick={() => setIsMethodDropdownOpen(false)} 
                                                        />
                                                        <div className="absolute left-0 right-0 bottom-full mb-1.5 bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-700 rounded-xl shadow-2xl z-30 py-1 max-h-48 overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
                                                            {PAYMENT_METHODS.map(method => {
                                                                const IconComp = method.icon;
                                                                const isSelected = changeOwedMethod === method.id;
                                                                return (
                                                                    <button
                                                                        key={method.id}
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setChangeOwedMethod(method.id);
                                                                            setIsMethodDropdownOpen(false);
                                                                        }}
                                                                        className={`w-full flex items-center justify-between px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                                                                            isSelected 
                                                                                ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-950 dark:text-amber-200 font-bold' 
                                                                                : 'text-slate-700 dark:text-slate-300 hover:bg-amber-100/50 dark:hover:bg-slate-800'
                                                                        }`}
                                                                    >
                                                                        <div className="flex items-center gap-2.5">
                                                                            <IconComp size={15} className={method.iconColor} />
                                                                            <span>{method.label}</span>
                                                                        </div>
                                                                        {isSelected && <Check size={14} className="text-amber-600 dark:text-amber-400" />}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </>
                                                )}
                                            </div>

                                            <input
                                                type="text"
                                                value={changeOwedNote}
                                                onChange={e => setChangeOwedNote(e.target.value)}
                                                placeholder="Nota/Referencia opcional..."
                                                className="w-full py-1.5 px-2.5 rounded-xl border border-amber-300 dark:border-amber-700/80 bg-white dark:bg-slate-900 text-xs font-medium text-slate-800 dark:text-white placeholder-slate-400 outline-none focus:ring-1 focus:ring-amber-500 shadow-sm"
                                            />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Pagado exacto */}
                    {isPaid && cambioUSD <= 0.009 && (
                        <div className="flex flex-col justify-center items-center text-center p-5 rounded-xl border-2 border-emerald-300 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-950/20 shadow-sm transition-all">
                            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">✓ Pago Completo</p>
                            <p className="text-xs text-emerald-600/70 mt-1">Sin vuelto</p>
                        </div>
                    )}

                    {/* Queda Debiendo (Crédito) */}
                    {isCredit && (
                        <div className="flex flex-col justify-center items-center text-center p-5 rounded-xl border-2 border-amber-200 dark:border-amber-800/30 bg-amber-50 dark:bg-amber-950/10 shadow-sm transition-all">
                            <p className="text-[10px] font-extrabold uppercase tracking-widest text-amber-700 dark:text-amber-500">Queda Debiendo</p>
                            <p className="text-4xl lg:text-5xl font-black text-amber-700 dark:text-amber-400 my-2">${deudaCliente.toFixed(2)}</p>
                            <div className="text-lg font-black text-amber-600 dark:text-amber-300">
                                Bs {round2(deudaCliente * tasaSegura).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default memo(PaymentLeftColumn);
