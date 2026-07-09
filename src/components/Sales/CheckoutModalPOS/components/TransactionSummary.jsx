import React, { memo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { round2 } from '../../../../utils/dinero';

/**
 * TransactionSummary — Resumen del total a pagar en la columna izquierda.
 */
const TransactionSummary = ({ totalUSD, totalBS, discountData, tasaSegura }) => {
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
        </div>
    );
};

export default memo(TransactionSummary);
