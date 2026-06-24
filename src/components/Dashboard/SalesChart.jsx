import React from 'react';
import { BarChart3 } from 'lucide-react';
import { formatBs, formatCop } from '../../utils/calculatorUtils';

/**
 * Gráfica de barras: Ventas de los últimos 7 días.
 * Pure CSS — cero dependencias externas.
 */
function SalesChart({ weekData, onDayClick, selectedDate, copEnabled, copPrimary, tasaCop, bcvRate }) {
    if (!weekData || weekData.length === 0) return null;

    const maxVal = Math.max(...weekData.map(d => d.total), 1);
    const weekTotal = weekData.reduce((s, d) => s + d.total, 0);
    const isCop = copEnabled && tasaCop > 0;

    const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

    const fmtBarLabel = (usd) => {
        if (copEnabled && copPrimary && tasaCop > 0) return `${formatCop(usd * tasaCop)}`;
        return `$${usd.toFixed(0)}`;
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm mb-5">
            <h3 className="text-xs font-bold text-slate-400 uppercase mb-4 flex items-center gap-1">
                <BarChart3 size={12} /> Ventas · Últimos 7 días
            </h3>

            <div className="flex items-end justify-between gap-1 h-28">
                {weekData.map((day, i) => {
                    const pct = maxVal > 0 ? (day.total / maxVal) * 100 : 0;
                    const isToday = i === weekData.length - 1;
                    const dayName = DAYS[new Date(day.date + 'T00:00:00').getDay()];

                    const isSelected = selectedDate === day.date;

                    return (
                        <div
                            key={day.date}
                            onClick={() => onDayClick && onDayClick(day.date)}
                            className={`flex-1 flex flex-col items-center gap-1 cursor-pointer group ${isSelected ? 'scale-110 transform transition-transform' : ''}`}
                        >
                            {/* Amount label */}
                            <span className={`text-[9px] font-bold ${day.total > 0 ? 'text-slate-500 dark:text-slate-400' : 'text-transparent'}`}>
                                {fmtBarLabel(day.total)}
                            </span>

                            {/* Bar */}
                            <div className="w-full flex justify-center">
                                <div
                                    className={`w-full max-w-[28px] rounded-t-lg transition-all duration-300 ease-out group-hover:opacity-80 ${
                                        isSelected
                                            ? 'bg-gradient-to-t from-brand to-brand-dark shadow-md shadow-primary/30'
                                        : isToday
                                            ? 'bg-gradient-to-t from-emerald-500 to-emerald-400 shadow-md shadow-emerald-500/20'
                                        : day.total > 0
                                            ? 'bg-gradient-to-t from-slate-300 to-slate-200 dark:from-slate-700 dark:to-slate-600'
                                            : 'bg-slate-100 dark:bg-slate-800'
                                    }`}
                                    style={{
                                        height: `${Math.max(pct, 4)}%`,
                                        minHeight: '4px',
                                    }}
                                />
                            </div>

                            {/* Day label */}
                            <span className={`text-[10px] font-bold ${
                                isSelected ? 'text-brand-dark dark:text-brand'
                                : isToday ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-slate-400'
                            }`}>
                                {isToday ? 'Hoy' : dayName}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* Summary row */}
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-400 font-medium">
                        Total semana
                    </span>
                    <span className={`text-xs font-black ${copEnabled && copPrimary ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'}`}>
                        {copEnabled && copPrimary
                            ? `${formatCop(weekTotal * tasaCop)} COP`
                            : `$${weekTotal.toFixed(2)}`}
                    </span>
                </div>
                {isCop && (
                    <div className="flex justify-end gap-2 mt-0.5">
                        {copPrimary
                            ? <span className="text-[10px] text-slate-400 font-medium">${weekTotal.toFixed(2)}</span>
                            : <span className="text-[10px] text-slate-400 font-medium">{formatCop(weekTotal * tasaCop)} COP</span>}
                        {bcvRate > 0 && <span className="text-[10px] text-slate-400 font-medium">{formatBs(weekTotal * bcvRate)} Bs</span>}
                    </div>
                )}
            </div>
        </div>
    );
}

export default React.memo(SalesChart);
