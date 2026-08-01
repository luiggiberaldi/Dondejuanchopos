import React from 'react';
import { Lock, Sparkles, X, ArrowRight } from 'lucide-react';
import { useProductContext } from '../../context/ProductContext';
import { useAuthStore } from '../../hooks/store/useAuthStore';
import { formatBs } from '../../utils/calculatorUtils';

export default function BsCongeladoAlertBanner() {
    const { bsCongeladoAlert, dismissBsCongeladoAlert, openBsCongeladoWizard, rateMode } = useProductContext();
    const usuarioActivo = useAuthStore((s) => s.usuarioActivo);

    const isCajero = usuarioActivo?.rol === 'CAJERO';

    if (isCajero || rateMode !== 'manual' || !bsCongeladoAlert) return null;

    const { prevRate, newRate, count } = bsCongeladoAlert;

    return (
        <div className="fixed bottom-5 right-5 z-40 max-w-md w-full bg-slate-900 text-white border border-amber-500/40 rounded-2xl shadow-2xl p-4 animate-in slide-in-from-bottom-5 duration-300">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                        <Lock size={20} />
                    </div>
                    <div>
                        <div className="flex items-center gap-1.5 text-xs font-black uppercase text-amber-400">
                            <span>Tasa Actualizada</span>
                            <span>·</span>
                            <span className="flex items-center gap-1">
                                {formatBs(prevRate)} <ArrowRight size={10} /> {formatBs(newRate)} Bs
                            </span>
                        </div>
                        <p className="text-xs text-slate-300 font-medium mt-0.5">
                            Detectamos <strong className="text-white">{count} {count === 1 ? 'producto' : 'productos'}</strong> con precio en Bs Congelado.
                        </p>
                    </div>
                </div>
                <button
                    onClick={dismissBsCongeladoAlert}
                    className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                >
                    <X size={16} />
                </button>
            </div>

            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-800">
                <button
                    onClick={dismissBsCongeladoAlert}
                    className="flex-1 py-1.5 px-3 rounded-xl text-xs font-bold text-slate-400 hover:bg-slate-800 transition-colors cursor-pointer"
                >
                    Omitir por ahora
                </button>
                <button
                    onClick={() => {
                        dismissBsCongeladoAlert();
                        openBsCongeladoWizard();
                    }}
                    className="flex-1 py-1.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-black flex items-center justify-center gap-1.5 shadow-md transition-all active:scale-95 cursor-pointer"
                >
                    <Sparkles size={14} />
                    <span>Verificar Precios</span>
                </button>
            </div>
        </div>
    );
}
