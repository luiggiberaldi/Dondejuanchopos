import React, { useState, useEffect } from 'react';
import { Sparkles, X, TrendingUp } from 'lucide-react';
import { useProductContext } from '../context/ProductContext';
import { soundService } from '../utils/soundService';

export default function SupervisorRateNotification() {
    const [visible, setVisible] = useState(false);
    const [rateInfo, setRateInfo] = useState({ rateMode: '', customRate: 0 });
    const { rates } = useProductContext();

    useEffect(() => {
        const handleRateApplied = (e) => {
            const { rateMode, customRate } = e.detail || {};
            setRateInfo({ rateMode, customRate });
            setVisible(true);

            // 1. Reproducir sonido fuerte de alerta en la caja usando el soundService global
            soundService.playAlert();

            // 2. Vibración del dispositivo
            try {
                if (navigator.vibrate) {
                    navigator.vibrate([150, 100, 150]);
                }
            } catch (err) {}
        };

        window.addEventListener('supervisor_rate_applied', handleRateApplied);
        return () => {
            window.removeEventListener('supervisor_rate_applied', handleRateApplied);
        };
    }, []);

    if (!visible) return null;

    // Obtener valor numérico dinámico de la tasa
    const getRateValue = () => {
        if (rateInfo.rateMode === 'manual') return rateInfo.customRate;
        if (rateInfo.rateMode === 'bcv') return rates?.bcv?.price;
        if (rateInfo.rateMode === 'euro') return rates?.euro?.price;
        if (rateInfo.rateMode === 'usdt') return rates?.usdt?.price;
        return null;
    };

    // Formatear modo de tasa de forma legible
    const getModeLabel = (mode) => {
        if (mode === 'bcv') return 'Tasa BCV Oficial';
        if (mode === 'euro') return 'Tasa Euro Oficial';
        if (mode === 'usdt') return 'Tasa Paralelo / Binance';
        return 'Tasa Manual';
    };

    const rateVal = getRateValue();

    return (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[400] w-full max-w-sm px-4 animate-in fade-in slide-in-from-top-6 duration-300 pointer-events-auto">
            {/* Toda la tarjeta es cliqueable/táctil para cerrarla de forma inmediata */}
            <div 
                onPointerDown={() => setVisible(false)}
                className="bg-[#193275] dark:bg-slate-900 border border-white/10 text-white rounded-3xl p-4 shadow-2xl flex items-start gap-3 backdrop-blur-md relative overflow-hidden group cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-all"
                title="Toca en cualquier parte para cerrar"
            >
                {/* Glow de fondo */}
                <div className="absolute -top-12 -right-12 w-24 h-24 bg-emerald-500/10 rounded-full blur-xl group-hover:bg-emerald-500/20 transition-all duration-500" />
                
                {/* Icono de estado */}
                <div className="p-2.5 bg-emerald-500/20 dark:bg-emerald-500/10 text-emerald-400 rounded-2xl shrink-0">
                    <TrendingUp size={20} className="animate-pulse" />
                </div>
                
                {/* Contenido */}
                <div className="flex-1 space-y-1">
                    <p className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                        <Sparkles size={12} />
                        Tasa Actualizada
                    </p>
                    <h4 className="text-sm font-black tracking-tight leading-tight">
                        Tasa cambiada por Supervisor
                    </h4>
                    <p className="text-[11px] text-slate-300 font-medium">
                        {getModeLabel(rateInfo.rateMode)}
                        {rateVal && (
                            <span className="font-bold text-white block mt-0.5 text-xs">
                                Nuevo valor: {parseFloat(rateVal).toFixed(2)} Bs/$
                            </span>
                        )}
                    </p>
                </div>
                
                {/* Icono X (Cerrar visual) */}
                <div className="p-1 rounded-xl text-slate-400 group-hover:text-white transition-colors">
                    <X size={16} />
                </div>
            </div>
        </div>
    );
}
