import React, { memo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { round2 } from '../../../../utils/dinero';

/**
 * TransactionSummary — Resumen del total a pagar en la columna izquierda.
 */
const TransactionSummary = ({ totalUSD, totalBS, discountData, tasaSegura, pricingErrors = [] }) => {
    return (
        <div className="p-4 pb-3 shrink-0 bg-white dark:bg-slate-950 z-20 shadow-sm">
            <div className="text-center p-3 bg-slate-900 dark:bg-slate-800 text-white rounded-2xl shadow-lg relative overflow-hidden">
                <p className="text-white/50 text-[9px] font-bold uppercase tracking-wider mb-0.5">Total a Pagar</p>

                <div className="flex flex-col items-center">
                    <div className="text-3xl font-extrabold tracking-tight text-white">
                        ${totalUSD.toFixed(2)}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                        <div className="text-[11px] font-bold text-emerald-400">
                            Bs {round2(totalBS).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                        </div>
                    </div>
                </div>

                {discountData?.active && (
                    <div className="mt-2 pt-2 border-t border-white/10 flex justify-between items-center text-[10px]">
                        <span className="text-white/50 uppercase tracking-wide">Descuento</span>
                        <span className="text-emerald-400 font-black">
                            -{discountData.type === 'percentage' ? `${discountData.value}%` : `$${discountData.amountUsd?.toFixed(2)}`}
                        </span>
                    </div>
                )}
            </div>

            {pricingErrors.length > 0 && (
                <div
                    role="alert"
                    className="mt-2 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-left text-[11px] font-bold text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
                >
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    <span>Hay un formato sin precio Bs válido. Corrige la configuración antes de cobrar.</span>
                </div>
            )}
        </div>
    );
};

export default memo(TransactionSummary);
