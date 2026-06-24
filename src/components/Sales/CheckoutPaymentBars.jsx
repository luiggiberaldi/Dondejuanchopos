import React from 'react';
import { Zap } from 'lucide-react';
import { formatBs } from '../../utils/calculatorUtils';
import { PAYMENT_ICONS, ICON_COMPONENTS } from '../../config/paymentMethods';

const SECTION_STYLES = {
    USD: {
        bg: 'bg-emerald-50/50 dark:bg-emerald-950/20',
        border: 'border-emerald-100 dark:border-emerald-900/50',
        title: 'text-emerald-800 dark:text-emerald-300',
        titleBg: 'bg-emerald-100 dark:bg-emerald-900/50',
        inputBorder: 'border-emerald-200 dark:border-emerald-800 focus:border-emerald-500 focus:ring-emerald-500/20',
        inputActive: 'border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30',
        btnBg: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 active:bg-emerald-300',
    },
    BS: {
        bg: 'bg-brand-light/50 dark:bg-surface-950/20',
        border: 'border-surface-200 dark:border-surface-800/50',
        title: 'text-surface-800 dark:text-brand',
        titleBg: 'bg-brand-light dark:bg-surface-800/50',
        inputBorder: 'border-surface-300 dark:border-surface-700 focus:border-brand focus:ring-brand/20',
        inputActive: 'border-brand dark:border-brand-dark bg-brand-light dark:bg-surface-950/30',
        btnBg: 'bg-brand-light dark:bg-surface-800/40 text-brand-dark dark:text-brand hover:bg-brand-light active:bg-brand-light',
    },
    COP: {
        bg: 'bg-amber-50/50 dark:bg-amber-950/20',
        border: 'border-amber-100 dark:border-amber-900/50',
        title: 'text-amber-800 dark:text-amber-300',
        titleBg: 'bg-amber-100 dark:bg-amber-900/50',
        inputBorder: 'border-amber-200 dark:border-amber-800 focus:border-amber-500 focus:ring-amber-500/20',
        inputActive: 'border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30',
        btnBg: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 active:bg-amber-300',
    },
};

function PaymentBar({ method, styles, barValues, effectiveRate, tasaCop, onBarChange, onFillBar }) {
    const val = barValues[method.id] || '';
    const hasValue = parseFloat(val) > 0;
    const equivUsd = method.currency === 'BS' && hasValue
        ? (parseFloat(val) / effectiveRate).toFixed(2)
        : method.currency === 'COP' && hasValue
        ? (parseFloat(val) / tasaCop).toFixed(2)
        : null;

    const MIcon = method.Icon || PAYMENT_ICONS[method.id] || ICON_COMPONENTS[method.icon];

    return (
        <div className="mb-3 last:mb-0">
            <div className="flex items-center gap-2 mb-1 ml-0.5">
                {MIcon ? <MIcon size={16} className={hasValue ? '' : 'text-slate-400'} /> : <span className="text-base">{method.icon}</span>}
                <span className={`text-[11px] font-bold uppercase tracking-wide ${hasValue ? styles.title : 'text-slate-400 dark:text-slate-500'}`}>
                    {method.label}
                </span>
            </div>
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <input
                        type="text"
                        inputMode="decimal"
                        value={val}
                        onChange={e => onBarChange(method.id, e.target.value)}
                        placeholder="0.00"
                        className={`w-full py-3 px-4 pr-14 rounded-xl border-2 text-lg font-bold outline-none transition-all ${hasValue
                            ? styles.inputActive
                            : `bg-white dark:bg-slate-900 ${styles.inputBorder}`
                            } text-slate-800 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-700 focus:ring-4`}
                    />
                    <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black px-2 py-0.5 rounded-md border ${hasValue
                        ? `${styles.titleBg} ${styles.title} ${styles.border}`
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                        }`}>
                        {method.currency === 'USD' ? 'USD' : method.currency === 'COP' ? 'COP' : 'Bs'}
                    </span>
                </div>
                <button
                    onClick={() => onFillBar(method.id, method.currency)}
                    className={`shrink-0 py-3 px-3.5 rounded-xl font-black text-xs transition-all active:scale-95 flex items-center gap-1 ${styles.btnBg}`}
                >
                    <Zap size={14} fill="currentColor" /> Total
                </button>
            </div>
            {equivUsd && (
                <p className="text-[11px] font-bold text-brand dark:text-brand mt-1 ml-1">
                    ≈ USD {equivUsd}
                </p>
            )}
        </div>
    );
}

export default function CheckoutPaymentBars({
    paymentMethods,
    barValues,
    effectiveRate,
    tasaCop,
    copEnabled,
    onBarChange,
    onFillBar,
}) {
    const methodsUsd = paymentMethods.filter(m => m.currency === 'USD');
    const methodsBs = paymentMethods.filter(m => m.currency === 'BS');
    const methodsCop = paymentMethods.filter(m => m.currency === 'COP');

    const barProps = { barValues, effectiveRate, tasaCop, onBarChange, onFillBar };

    return (
        <>
            {/* USD Section */}
            {methodsUsd.length > 0 && (
                <div className={`mx-3 mb-3 rounded-2xl border ${SECTION_STYLES.USD.bg} ${SECTION_STYLES.USD.border} p-3`}>
                    <h3 className={`text-[11px] font-black uppercase tracking-widest mb-3 flex items-center gap-2 ${SECTION_STYLES.USD.title}`}>
                        <span className={`p-1 rounded-lg ${SECTION_STYLES.USD.titleBg}`}>💲</span>
                        Dólares ($)
                    </h3>
                    {methodsUsd.map(m => <PaymentBar key={m.id} method={m} styles={SECTION_STYLES.USD} {...barProps} />)}
                </div>
            )}

            {/* BS Section */}
            {methodsBs.length > 0 && (
                <div className={`mx-3 mb-3 rounded-2xl border ${SECTION_STYLES.BS.bg} ${SECTION_STYLES.BS.border} p-3`}>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className={`text-[11px] font-black uppercase tracking-widest flex items-center gap-2 ${SECTION_STYLES.BS.title}`}>
                            <span className={`p-1 rounded-lg ${SECTION_STYLES.BS.titleBg}`}>💵</span>
                            Bolívares (Bs)
                        </h3>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${SECTION_STYLES.BS.titleBg} ${SECTION_STYLES.BS.title}`}>
                            Tasa: {formatBs(effectiveRate)}
                        </span>
                    </div>
                    {methodsBs.map(m => <PaymentBar key={m.id} method={m} styles={SECTION_STYLES.BS} {...barProps} />)}
                </div>
            )}

            {/* COP Section */}
            {copEnabled && methodsCop.length > 0 && (
                <div className={`mx-3 mb-3 rounded-2xl border ${SECTION_STYLES.COP.bg} ${SECTION_STYLES.COP.border} p-3`}>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className={`text-[11px] font-black uppercase tracking-widest flex items-center gap-2 ${SECTION_STYLES.COP.title}`}>
                            <span className={`p-1 rounded-lg ${SECTION_STYLES.COP.titleBg}`}>🟡</span>
                            Pesos (COP)
                        </h3>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${SECTION_STYLES.COP.titleBg} ${SECTION_STYLES.COP.title}`}>
                            Tasa: {formatBs(tasaCop)}
                        </span>
                    </div>
                    {methodsCop.map(m => <PaymentBar key={m.id} method={m} styles={SECTION_STYLES.COP} {...barProps} />)}
                </div>
            )}
        </>
    );
}
