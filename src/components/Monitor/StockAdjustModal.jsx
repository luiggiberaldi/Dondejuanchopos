/**
 * src/components/Monitor/StockAdjustModal.jsx
 *
 * Modal de ajuste rápido de stock (entradas de mercancía / salidas) del Monitor.
 * Extraído de OwnerMonitorView.jsx (refactor 2026-08-21).
 */
import { useState } from 'react';
import { PlusCircle, X } from 'lucide-react';

export default function StockAdjustModal({ product, onClose, onConfirm, triggerHaptic }) {
    const [mode, setMode] = useState('add'); // 'add', 'subtract', 'set'
    const [quantity, setQuantity] = useState('');

    if (!product) return null;

    const currentStock = Number(product.stock) || 0;
    const qtyNum = parseFloat(quantity) || 0;

    let targetStock = currentStock;
    let delta = 0;

    if (mode === 'add') {
        targetStock = currentStock + qtyNum;
        delta = qtyNum;
    } else if (mode === 'subtract') {
        targetStock = Math.max(0, currentStock - qtyNum);
        // La salida es relativa. La caja debe recibir todas las unidades
        // solicitadas y encargarse de limitar el resultado a cero usando su
        // stock real, que puede ser distinto al del monitor.
        delta = -qtyNum;
    } else if (mode === 'set') {
        targetStock = Math.max(0, qtyNum);
        delta = targetStock - currentStock;
    }

    const handleQuickAdd = (val) => {
        triggerHaptic?.();
        setQuantity(val.toString());
    };

    const handleSave = (e) => {
        e.preventDefault();
        if (delta === 0) {
            onClose();
            return;
        }
        triggerHaptic?.();
        onConfirm(product.id, delta, mode === 'set' ? { targetStock } : undefined);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200 space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center shrink-0">
                            <PlusCircle size={20} />
                        </div>
                        <div className="min-w-0">
                            <h3 className="font-black text-slate-800 dark:text-white text-sm truncate uppercase">
                                {product.name}
                            </h3>
                            <p className="text-[10px] text-slate-400 font-bold">
                                Stock Actual: <span className="text-slate-700 dark:text-slate-200 font-black">{currentStock} u</span>
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Selección de Tipo de Ajuste */}
                <div className="grid grid-cols-3 gap-1 bg-slate-100 dark:bg-slate-950 p-1 rounded-2xl">
                    <button
                        type="button"
                        onClick={() => { triggerHaptic?.(); setMode('add'); }}
                        className={`py-2 px-1 text-[10px] font-black uppercase rounded-xl transition-all ${
                            mode === 'add'
                                ? 'bg-emerald-500 text-white shadow-sm'
                                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                    >
                        ➕ Entrada
                    </button>
                    <button
                        type="button"
                        onClick={() => { triggerHaptic?.(); setMode('subtract'); }}
                        className={`py-2 px-1 text-[10px] font-black uppercase rounded-xl transition-all ${
                            mode === 'subtract'
                                ? 'bg-rose-500 text-white shadow-sm'
                                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                    >
                        ➖ Salida
                    </button>
                    <button
                        type="button"
                        onClick={() => { triggerHaptic?.(); setMode('set'); }}
                        className={`py-2 px-1 text-[10px] font-black uppercase rounded-xl transition-all ${
                            mode === 'set'
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                    >
                        ✏️ Fijar Exacto
                    </button>
                </div>

                {/* Input de Cantidad */}
                <form onSubmit={handleSave} className="space-y-3">
                    <div>
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1">
                            {mode === 'add' ? '¿Cuántas unidades llegaron?' : mode === 'subtract' ? '¿Cuántas unidades salen?' : 'Nuevo Stock total exacto:'}
                        </label>
                        <input
                            type="number"
                            inputMode="decimal"
                            step="any"
                            autoFocus
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                            onFocus={(e) => e.target.select()}
                            placeholder={mode === 'add' ? 'Ej: 40' : mode === 'subtract' ? 'Ej: 5' : `${currentStock}`}
                            className="w-full px-4 py-3 text-lg font-outfit font-black rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500 text-center"
                        />
                    </div>

                    {/* Botones de Acceso Rápido */}
                    <div className="space-y-1">
                        <span className="text-[8px] font-black text-slate-400 uppercase tracking-wider block">Sugeridos rápidos:</span>
                        <div className="flex flex-wrap gap-1.5">
                            {[5, 10, 20, 40, 50, 100].map((num) => (
                                <button
                                    key={num}
                                    type="button"
                                    onClick={() => handleQuickAdd(num)}
                                    className="px-2.5 py-1 text-xs font-outfit font-black rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-slate-700 transition-colors"
                                >
                                    {mode === 'subtract' ? `-${num}` : mode === 'add' ? `+${num}` : num}
                                </button>
                            ))}
                            {product.sellByBox && product.boxUnits > 0 && (
                                <button
                                    type="button"
                                    onClick={() => handleQuickAdd(product.boxUnits)}
                                    className="px-2.5 py-1 text-xs font-outfit font-black rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 hover:bg-blue-100 transition-colors"
                                >
                                    {mode === 'subtract' ? '-' : mode === 'add' ? '+' : ''}1 Caja ({product.boxUnits}u)
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Proyección / Vista Previa */}
                    <div className="bg-slate-50 dark:bg-slate-950/60 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Stock resultante:</span>
                        <span className="font-outfit font-black text-sm tabular-nums text-slate-800 dark:text-white">
                            {targetStock} u
                            {delta !== 0 && (
                                <span className={`ml-1.5 text-xs ${delta > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                    ({delta > 0 ? '+' : ''}{delta})
                                </span>
                            )}
                        </span>
                    </div>

                    {/* Botones de acción del Modal */}
                    <div className="flex gap-2 pt-1">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-2.5 rounded-2xl font-black text-xs uppercase text-slate-500 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={!quantity || qtyNum <= 0}
                            className="flex-1 py-2.5 rounded-2xl font-black text-xs uppercase text-white bg-emerald-500 hover:bg-emerald-400 shadow-lg shadow-emerald-500/25 transition-all active:scale-95 disabled:opacity-40"
                        >
                            Encolar Ajuste
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
