import React from 'react';
import { Eye } from 'lucide-react';
import { mulR } from '../../utils/dinero';
import { CurrencyService } from '../../services/CurrencyService';

// Vista previa del cobro (D7): línea siempre visible bajo los campos de precio
// que muestra EXACTAMENTE qué saldrá en el ticket según el modo elegido.
export default function PricePreviewLine({ mode, usd, bsManual, bsUsdRef, effectiveRate, bcvRate }) {
    const u = CurrencyService.safeParse(usd);
    if (!(u > 0)) return null;

    const fmt = (n) => Math.round(n).toLocaleString('es-VE');
    let text = null;

    if (mode === 'tasa_dia' && effectiveRate > 0) {
        text = `Cobrarás: $${u.toFixed(2)} · ${fmt(mulR(u, effectiveRate))} Bs (tasa ${effectiveRate})`;
    } else if (mode === 'bcv') {
        const rb = bcvRate > 0 ? bcvRate : effectiveRate;
        if (rb > 0) text = `Cobrarás: $${u.toFixed(2)} · ${fmt(mulR(u, rb))} Bs (BCV ${rb})`;
    } else if (mode === 'dual_usd') {
        const ref = CurrencyService.safeParse(bsUsdRef);
        if (ref > 0 && effectiveRate > 0) {
            text = `Cobrarás: $${u.toFixed(2)} en divisas · ${fmt(mulR(ref, effectiveRate))} Bs en bolívares (= $${ref.toFixed(2)} × tasa ${effectiveRate})`;
        }
    } else if (mode === 'bs_fijo') {
        const bs = CurrencyService.safeParse(bsManual);
        if (bs > 0) text = `Cobrarás: $${u.toFixed(2)} · ${fmt(bs)} Bs (fijo, no cambia con la tasa)`;
    }

    if (!text) return null;

    return (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/50">
            <Eye size={11} className="text-slate-400 shrink-0" />
            <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 leading-tight">{text}</span>
        </div>
    );
}
