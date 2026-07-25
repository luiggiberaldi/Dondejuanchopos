import React from 'react';
import { Zap, Landmark, Banknote, Lock } from 'lucide-react';

// Selector único de modo de precio (D1/D7 del plan precios_simplificados).
// 4 tarjetas planas — reemplaza el viejo selector de 2 niveles
// ("Regla de Tasa" + "Estrategia") de Quick/Wizard.
const MODES = [
    {
        id: 'tasa_dia',
        icon: Zap,
        title: 'Tasa del Día',
        activeCls: 'border-purple-500 bg-purple-500/10 text-purple-700 dark:text-purple-300 ring-1 ring-purple-500/40',
        iconCls: 'text-purple-500',
        desc: (rate) => `Un precio en $, los Bs salen a la tasa activa (${rate} Bs)`,
    },
    {
        id: 'bcv',
        icon: Landmark,
        title: 'Siempre BCV',
        activeCls: 'border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/40',
        iconCls: 'text-blue-500',
        desc: (rate, bcv) => `Regulados/víveres: los Bs siempre a tasa BCV (${bcv} Bs)`,
    },
    {
        id: 'dual_usd',
        icon: Banknote,
        title: 'Dos Precios en $',
        activeCls: 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/40',
        iconCls: 'text-emerald-500',
        desc: () => 'Ej: $1 si paga en divisa, $2 (en Bs) si paga en bolívares — se ajusta solo con la tasa',
    },
    {
        id: 'bs_fijo',
        icon: Lock,
        title: 'Bs Congelado',
        activeCls: 'border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/40',
        iconCls: 'text-amber-500',
        desc: () => 'En Bs un monto fijo que NO se mueve con la tasa',
    },
];

export default function PricingModeSelector({ value, onChange, effectiveRate, bcvRate, compact = false }) {
    return (
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${compact ? 'gap-2' : 'gap-2.5'}`}>
            {MODES.map(m => {
                const Icon = m.icon;
                const active = value === m.id;
                return (
                    <button
                        key={m.id}
                        type="button"
                        onClick={() => onChange(m.id)}
                        className={`text-left rounded-2xl border-2 transition-all cursor-pointer ${compact ? 'p-2.5' : 'p-3'} ${
                            active
                                ? m.activeCls
                                : 'border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-850/60 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}
                    >
                        <span className={`flex items-center gap-2 font-black uppercase tracking-wider ${compact ? 'text-[10px]' : 'text-xs'}`}>
                            <Icon size={compact ? 14 : 16} className={active ? m.iconCls : 'text-slate-500 dark:text-slate-400'} />
                            {m.title}
                        </span>
                        {!compact && (
                            <span className="block text-[10px] font-bold mt-1.5 leading-tight text-slate-600 dark:text-slate-300">
                                {m.desc(effectiveRate, bcvRate || effectiveRate)}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
