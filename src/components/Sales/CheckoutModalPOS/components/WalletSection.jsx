import React from 'react';
import { Wallet } from 'lucide-react';

/**
 * WalletSection — Sección de saldo a favor del cliente.
 * Solo se muestra si el cliente tiene saldo a favor.
 */
export default function WalletSection({
    cliente,
    totalPagadoUSD,
    tasaSegura,
    totalConIGTF,
    pagoSaldoFavor,
    setPagoSaldoFavor,
}) {
    const saldoDisponible = parseFloat(cliente?.favor) || 0;
    if (saldoDisponible <= 0.01) return null;

    const pagadoOtros = totalPagadoUSD;
    const faltaSinSaldo = Math.max(0, totalConIGTF - pagadoOtros);
    const maxUsable = Math.min(saldoDisponible, faltaSinSaldo);

    const handleUsarTodo = () => {
        const aUsar = maxUsable;
        setPagoSaldoFavor(aUsar.toFixed(2));
    };

    return (
        <div className="mb-5 p-4 bg-brand-light dark:bg-brand/10 border border-brand/20 dark:border-brand/30 rounded-xl flex flex-col sm:flex-row items-center gap-4 animate-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-3 flex-1">
                <div className="bg-brand/10 dark:bg-brand/20 p-2.5 rounded-full text-brand">
                    <Wallet size={20} />
                </div>
                <div>
                    <h4 className="font-bold text-brand/90 dark:text-brand text-xs uppercase tracking-wide">Monedero</h4>
                    <div className="text-xl font-black text-brand">${saldoDisponible.toFixed(2)}</div>
                </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative flex-1">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-brand/60 font-bold text-sm">$</span>
                    <input
                        type="number"
                        value={pagoSaldoFavor}
                        onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (e.target.value === '') {
                                setPagoSaldoFavor('');
                            } else if (v >= 0 && v <= maxUsable) {
                                setPagoSaldoFavor(e.target.value);
                            } else if (v > maxUsable) {
                                setPagoSaldoFavor(maxUsable.toFixed(2));
                            }
                        }}
                        placeholder="0.00"
                        aria-label="Monto a usar del monedero"
                        max={maxUsable}
                        className="w-full pl-7 pr-3 py-2 rounded-lg border-2 border-brand/30 dark:border-brand/40 focus:border-brand outline-none font-bold text-brand/90 dark:text-brand text-right bg-white dark:bg-slate-900"
                    />
                </div>
                <button
                    type="button"
                    onClick={handleUsarTodo}
                    aria-label="Usar todo el saldo permitido del monedero"
                    className="min-h-11 px-3 py-2 bg-brand hover:bg-brand/90 text-white font-bold text-xs rounded-lg transition-colors whitespace-nowrap active:scale-95"
                >
                    ⚡ Todo
                </button>
            </div>
        </div>
    );
}
