import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownRight, ArrowUpRight, Check, ChevronDown, X } from 'lucide-react';
import { formatBs, formatUsd } from '../../utils/calculatorUtils';
import { getActivePaymentMethods } from '../../config/paymentMethods';
import { buildSupervisorCustomerTransaction } from '../../utils/supervisorCustomerTransaction';

export default function SupervisorCustomerTransactionModal({ customer, type, bcvRate, tasaCop, copEnabled, supervisorUser, onClose, onSubmit }) {
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [paymentMethod, setPaymentMethod] = useState('');
    const [isPaymentMenuOpen, setIsPaymentMenuOpen] = useState(false);
    const [paymentMenuPosition, setPaymentMenuPosition] = useState(null);
    const paymentButtonRef = useRef(null);
    const [methods, setMethods] = useState([]);
    const [approvedHighAmount, setApprovedHighAmount] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [commandId, setCommandId] = useState(() => crypto.randomUUID());
    const [recordId, setRecordId] = useState(() => crypto.randomUUID());

    useEffect(() => { getActivePaymentMethods().then(setMethods).catch(() => setMethods([])); }, []);
    useEffect(() => {
        if (!isPaymentMenuOpen) return undefined;
        const closeOnEscape = event => { if (event.key === 'Escape') setIsPaymentMenuOpen(false); };
        const closeOnOutsideClick = event => {
            if (!paymentButtonRef.current?.contains(event.target)
                && !document.getElementById('supervisor-payment-method-list')?.contains(event.target)) {
                setIsPaymentMenuOpen(false);
            }
        };
        document.addEventListener('keydown', closeOnEscape);
        document.addEventListener('pointerdown', closeOnOutsideClick);
        return () => {
            document.removeEventListener('keydown', closeOnEscape);
            document.removeEventListener('pointerdown', closeOnOutsideClick);
        };
    }, [isPaymentMenuOpen]);

    const openPaymentMenu = () => {
        if (isPaymentMenuOpen) {
            setIsPaymentMenuOpen(false);
            return;
        }
        const rect = paymentButtonRef.current?.getBoundingClientRect();
        if (!rect) return;
        const maxHeight = Math.min(192, window.innerHeight - 24);
        const below = window.innerHeight - rect.bottom - 16;
        const above = rect.top - 16;
        const openBelow = below >= Math.min(maxHeight, 120) || below >= above;
        const width = Math.min(rect.width, window.innerWidth - 24);
        setPaymentMenuPosition({
            left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
            width,
            top: openBelow ? rect.bottom + 8 : Math.max(12, rect.top - Math.min(maxHeight, above) - 8),
            maxHeight: Math.max(96, Math.min(maxHeight, openBelow ? below : above)),
        });
        setIsPaymentMenuOpen(true);
    };
    const editAmount = value => {
        setAmount(value);
        setApprovedHighAmount(false);
        setCommandId(crypto.randomUUID());
        setRecordId(crypto.randomUUID());
    };

    const rate = Number(bcvRate) || 0;
    const copRate = Number(tasaCop) || 0;
    const selectedMethods = methods.filter(method => method.currency === currency && method.isEnabled !== false);
    const numericAmount = Number(amount);
    const amountUsd = currency === 'BS' ? (rate > 0 ? numericAmount / rate : 0)
        : currency === 'COP' ? (copRate > 0 ? numericAmount / copRate : 0) : numericAmount;
    const currentDebt = Number(customer.deuda) || 0;
    const currentFavor = Number(customer.favor) || 0;
    const predictedDebt = type === 'CREDITO' ? currentDebt + amountUsd : Math.max(0, currentDebt - amountUsd);
    const predictedFavor = currentFavor + (type === 'ABONO' ? Math.max(0, amountUsd - currentDebt) : 0);
    const needsHighApproval = amountUsd > 1000 || predictedDebt > 2500 || predictedFavor > 300;

    const submit = async event => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        try {
            const payload = buildSupervisorCustomerTransaction({
                customer, type, amount, currency, bcvRate: rate, tasaCop: copRate, copEnabled,
                paymentMethod: type === 'ABONO' ? paymentMethod : null,
                actor: { id: supervisorUser?.id, nombre: supervisorUser?.nombre || 'Supervisor', rol: supervisorUser?.rol || 'SUPERVISOR', deviceId: typeof localStorage !== 'undefined' ? localStorage.getItem('dj_device_id') : null },
                commandId,
                recordId,
                isExplicitHighAmount: approvedHighAmount,
            });
            await onSubmit(payload);
        } catch (submitError) {
            setError(submitError.message || 'No se pudo enviar el movimiento.');
            setBusy(false);
        }
    };

    const currencies = ['USD', 'BS', ...(copEnabled && copRate > 0 ? ['COP'] : [])];
    const expectedBalance = type === 'ABONO'
        ? `Deuda $${formatUsd(predictedDebt)} · Favor $${formatUsd(predictedFavor)}`
        : `Deuda $${formatUsd(predictedDebt)} · Favor $${formatUsd(currentFavor)}`;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-3 backdrop-blur-sm sm:p-5" role="presentation">
            <form onSubmit={submit} className="my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-md space-y-3 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl sm:space-y-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900" aria-label={type === 'ABONO' ? 'Registrar abono' : 'Agregar deuda'}>
                <header className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {type === 'ABONO' ? <ArrowUpRight className="text-emerald-600" /> : <ArrowDownRight className="text-rose-600" />}
                        <div><h2 className="font-black text-slate-900 dark:text-white">{type === 'ABONO' ? 'Recibir abono' : 'Agregar deuda'}</h2><p className="text-xs text-slate-500">{customer.name || customer.nombre} · {customer.code || 'S/C'}</p></div>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Cerrar" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"><X size={18} /></button>
                </header>
                <div className="flex gap-2" role="group" aria-label="Moneda">
                    {currencies.map(item => <button type="button" key={item} onClick={() => { setCurrency(item); editAmount(''); setPaymentMethod(''); }} className={`flex-1 rounded-xl border py-2 text-sm font-bold ${currency === item ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'border-slate-200 text-slate-500 dark:border-slate-700'}`}>{item}</button>)}
                </div>
                <label className="block space-y-1 text-xs font-bold text-slate-500">Monto ({currency})
                    <input inputMode="decimal" type="number" min="0.01" step="0.01" required value={amount} onChange={event => editAmount(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none transition-shadow focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                </label>
                {currency !== 'USD' && <p className="text-xs text-slate-500">Equivalente aproximado: ${formatUsd(amountUsd)} USD · Tasa {currency === 'BS' ? formatBs(rate) : formatBs(copRate)}</p>}
                {type === 'ABONO' && <div className="space-y-1 text-xs font-bold text-slate-500">
                    <span>Método de pago</span>
                    <div className="relative">
                        <button
                            type="button"
                            aria-haspopup="listbox"
                            aria-expanded={isPaymentMenuOpen}
                            aria-label="Método de pago"
                            ref={paymentButtonRef}
                            onClick={openPaymentMenu}
                            className="flex w-full items-center justify-between rounded-2xl border border-slate-300 bg-white px-3 py-3 text-left text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                            <span className={paymentMethod ? '' : 'text-slate-500'}>
                                {selectedMethods.find(method => method.id === paymentMethod)?.label || 'Seleccionar método'}
                            </span>
                            <ChevronDown size={16} className={`shrink-0 transition-transform ${isPaymentMenuOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isPaymentMenuOpen && paymentMenuPosition && createPortal(
                            <div
                                id="supervisor-payment-method-list"
                                role="listbox"
                                aria-label="Métodos de pago"
                                style={{ position: 'fixed', top: paymentMenuPosition.top, left: paymentMenuPosition.left, width: paymentMenuPosition.width, maxHeight: paymentMenuPosition.maxHeight }}
                                className="z-[120] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-800"
                            >
                                {selectedMethods.length === 0
                                    ? <p className="px-3 py-2 text-xs font-medium text-slate-500">No hay métodos activos en {currency}.</p>
                                    : selectedMethods.map(method => <button
                                        type="button"
                                        role="option"
                                        aria-selected={paymentMethod === method.id}
                                        key={method.id}
                                        onClick={() => { setPaymentMethod(method.id); setIsPaymentMenuOpen(false); }}
                                        className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition-colors hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-200"
                                    >
                                        <span>{method.label}</span>{paymentMethod === method.id && <Check size={16} className="shrink-0 text-indigo-600 dark:text-indigo-300" />}
                                    </button>)}
                            </div>,
                            document.body,
                        )}
                    </div>
                    <input type="hidden" required value={paymentMethod} />
                </div>}
                <div className="rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{expectedBalance}</div>
                {needsHighApproval && <label className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><input type="checkbox" checked={approvedHighAmount} onChange={event => setApprovedHighAmount(event.target.checked)} />Confirmo el importe, su equivalente y el saldo resultante.</label>}
                {error && <p role="alert" className="text-xs font-bold text-rose-600">{error}</p>}
                <footer className="flex gap-2"><button type="button" onClick={onClose} disabled={busy} className="flex-1 rounded-xl bg-slate-100 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">Cancelar</button><button type="submit" disabled={busy || !amount || (type === 'ABONO' && (!paymentMethod || !selectedMethods.some(method => method.id === paymentMethod))) || (needsHighApproval && !approvedHighAmount)} className={`flex-1 rounded-xl py-2.5 text-sm font-black text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${type === 'ABONO' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}>{busy ? 'Enviando…' : 'Enviar a caja'}</button></footer>
            </form>
        </div>
    );
}
