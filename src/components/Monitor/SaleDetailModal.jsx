/**
 * src/components/Monitor/SaleDetailModal.jsx
 *
 * Detalle de venta del Monitor del Supervisor, con anulación remota vía comando.
 * Extraído de OwnerMonitorView.jsx (refactor 2026-08-21).
 */
import { useState } from 'react';
import { FileText, AlertTriangle, X, Trash2, RotateCcw } from 'lucide-react';
import { showToast } from '../Toast';
import { supabaseCloud } from '../../config/supabaseCloud';
import { createSupervisorCommandId } from '../../utils/supervisorCommandModel';
import { formatBs, formatCop } from '../../utils/calculatorUtils';
import { mulR } from '../../utils/dinero';
import { getChangeLedger, getChangeDisplayParts } from '../../utils/changeLedger';
import { getPaymentLabel } from '../../config/paymentMethods';
import { calculatePricing } from '../../utils/productProcessor';
import {
    getEffectiveSaleTotalBs,
    getFormattedPaymentMethod,
    getFormattedSaleCode,
    getPaymentBadgeStyle,
} from '../../utils/monitorSaleFormat';

export default function SaleDetailModal({ sale, onClose, bcvRate, pairedDeviceId, onVoidSaleSuccess, products = [], effectiveRate = 1, actor = null, pendingVoid = false }) {
    if (!sale) return null;

    const [showConfirmVoid, setShowConfirmVoid] = useState(false);
    const [voiding, setVoiding] = useState(false);

    const isVoided = sale.status === 'ANULADA';

    const formattedDate = sale.timestamp ? new Date(sale.timestamp).toLocaleString('es-VE', {
        dateStyle: 'medium',
        timeStyle: 'short'
    }) : '';

    const handleVoidSale = async () => {
        if (!sale || isVoided || pendingVoid || voiding) return;
        setVoiding(true);
        const commandId = createSupervisorCommandId();
        try {
            const monitorDeviceId = localStorage.getItem('dj_device_id') || 'monitor_web';
            if (supabaseCloud && pairedDeviceId) {
                const { error } = await supabaseCloud
                    .from('supervisor_commands')
                    .insert({
                        id: commandId,
                        primary_device_id: pairedDeviceId,
                        monitor_device_id: monitorDeviceId,
                        command_type: 'void_sale',
                        payload: {
                            commandId,
                            saleId: sale.id,
                            reason: 'Anulada por Supervisor desde Monitor',
                            supervisorId: actor?.id || null,
                            supervisorName: actor?.nombre || actor?.usuario || 'Supervisor',
                            supervisorRole: actor?.rol || 'SUPERVISOR',
                        },
                        status: 'pending'
                    });

                if (error) throw error;
                showToast('Anulación enviada; esperando confirmación de la caja.', 'success');
                if (onVoidSaleSuccess) onVoidSaleSuccess(sale.id, commandId);
            } else {
                showToast('Sin conexión con la caja principal', 'error');
            }
            setShowConfirmVoid(false);
        } catch (err) {
            console.error('[OwnerMonitor] Error al solicitar anulación:', err);
            showToast('No se pudo enviar la anulación. La venta queda sin cambios.', 'error');
        } finally {
            setVoiding(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col relative" onClick={e => e.stopPropagation()}>
                {/* Modal Header */}
                <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/40">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black shrink-0 ${
                            isVoided 
                                ? 'bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400'
                                : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                        }`}>
                            <FileText size={20} />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="text-sm font-black text-slate-800 dark:text-white">
                                    Venta {getFormattedSaleCode(sale)}
                                </h3>
                                {isVoided ? (
                                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-200/60 dark:border-rose-900/60 flex items-center gap-1">
                                        <AlertTriangle size={10} /> ANULADA
                                    </span>
                                ) : (
                                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${getPaymentBadgeStyle(sale)}`}>
                                        {getFormattedPaymentMethod(sale)}
                                    </span>
                                )}
                            </div>
                            <p className="text-[11px] text-slate-400 font-medium mt-0.5">{formattedDate}</p>
                        </div>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors shrink-0"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Modal Content */}
                <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
                    {/* Banner de Estado Anulada */}
                    {(isVoided || pendingVoid) && (
                        <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-900/50 rounded-2xl flex items-center gap-3 text-rose-800 dark:text-rose-300 text-xs font-semibold">
                            <AlertTriangle size={18} className="shrink-0 text-rose-600 dark:text-rose-400" />
                            <div>
                                <p className="font-extrabold">{pendingVoid && !isVoided ? 'Anulación pendiente de la caja' : 'Esta venta fue anulada'}</p>
                                <p className="text-[10.5px] opacity-80 mt-0.5">{pendingVoid && !isVoided ? 'La vista se restaurará automáticamente si la caja rechaza la operación.' : 'El stock de artículos fue restaurado y los saldos revertidos en la caja.'}</p>
                            </div>
                        </div>
                    )}

                    {/* Metadata Header */}
                    <div className="grid grid-cols-2 gap-3 p-3.5 bg-slate-50 dark:bg-slate-800/30 border border-slate-150 dark:border-slate-800 rounded-2xl text-xs">
                        <div>
                            <span className="text-[9.5px] font-black uppercase tracking-wider text-slate-400 block">Cajero</span>
                            <span className="font-bold text-slate-700 dark:text-slate-200 truncate block mt-0.5">
                                {sale.cajero || sale.usuarioNombre || sale.usuario || 'Cajero General'}
                            </span>
                        </div>
                        {sale.clientName && (
                            <div>
                                <span className="text-[9.5px] font-black uppercase tracking-wider text-slate-400 block">Cliente</span>
                                <span className="font-bold text-slate-700 dark:text-slate-200 truncate block mt-0.5">
                                    {sale.clientName}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Desglose de Artículos */}
                    <div className="space-y-2.5">
                        <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-slate-400 px-1">
                            <span>Artículos ({sale.items ? sale.items.reduce((s, i) => s + (i.qty || 1), 0) : 0})</span>
                            <span>Subtotal</span>
                        </div>
                        
                            {sale.items && sale.items.length > 0 ? (
                                sale.items.map((item, idx) => {
                                    const qty = item.qty || 1;
                                    const price = item.priceUsd ?? item.price ?? 0;
                                    const subtotalUsd = qty * price;
                                    const appliedRate = sale.rate || sale.bcvRate || effectiveRate || bcvRate || 1;
                                    const realBcv = sale.bcvRate || bcvRate || appliedRate;

                                    const cleanId = (item._originalId || item.id || '').replace(/_half|_box$/, '');
                                    const prod = products.find(p => p.id === cleanId || p.id === item.productId || p.id === item.id);
                                    const format = item._mode || (item.id && item.id.endsWith('_half') ? 'halfBox' : item.id && item.id.endsWith('_box') ? 'box' : 'unit');

                                    const subtotalBs = prod
                                        ? mulR(calculatePricing(prod, appliedRate, realBcv, format).unitPriceBs, qty)
                                        : (item.subtotalBs != null ? item.subtotalBs : mulR(subtotalUsd, appliedRate));
                                    
                                    return (
                                        <div key={idx} className="p-3 bg-slate-50/80 dark:bg-slate-800/20 border border-slate-100 dark:border-slate-800 rounded-2xl flex justify-between items-start gap-3">
                                            <div className="min-w-0 flex-1 space-y-1">
                                                <span className="text-xs font-black text-slate-800 dark:text-slate-100 block leading-snug break-words">
                                                    {item.name}
                                                </span>
                                                <div className="flex items-center gap-2 text-[10.5px] text-slate-400 font-semibold">
                                                    <span>Cant: <strong className="text-slate-700 dark:text-slate-300 font-bold">{qty}</strong></span>
                                                    <span>•</span>
                                                    <span>P.Unit: <strong className="font-outfit text-slate-700 dark:text-slate-300">${price.toFixed(2)}</strong></span>
                                                </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <span className="font-outfit text-xs font-black text-slate-800 dark:text-white block">${subtotalUsd.toFixed(2)}</span>
                                                <span className="font-outfit text-[9.5px] font-bold text-slate-400 block">{formatBs(subtotalBs)} Bs</span>
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="p-4 text-center text-xs text-slate-400 font-bold">Sin detalle de artículos</div>
                            )}
                        </div>
                    </div>

                    {/* Desglose de Pagos Recibidos */}
                    {Array.isArray(sale.payments) && sale.payments.length > 0 && (
                        <div className="space-y-1.5 p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-150 dark:border-slate-800 rounded-2xl text-xs">
                            <span className="text-[9.5px] font-black uppercase tracking-wider text-slate-400 block mb-1">
                                Forma(s) de Pago Recibida(s)
                            </span>
                            {sale.payments.map((p, idx) => {
                                const mId = (p.methodId || p.metodoPago || '').toLowerCase();
                                const label = p.methodLabel || getPaymentLabel(mId) || mId;
                                const isUsd = p.currency === 'USD' || mId.includes('usd');
                                const amtUsd = p.amountUsd || p.amountInput || 0;
                                const amtBs = p.amountBs || p.amountInput || 0;
                                return (
                                    <div key={idx} className="flex justify-between items-center text-xs">
                                        <span className="font-bold text-slate-700 dark:text-slate-200">
                                            • {label}
                                        </span>
                                        <span className="font-outfit font-black text-slate-800 dark:text-white">
                                            {isUsd ? `$${Number(amtUsd).toFixed(2)} USD` : `${formatBs(amtBs)} Bs`}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Resumen Total */}
                    <div className="p-4 bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40 rounded-2xl space-y-2">
                        <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-slate-600 dark:text-slate-300">Total Venta ($)</span>
                            <span className={`font-outfit text-base font-black ${isVoided ? 'line-through text-slate-400' : 'text-slate-800 dark:text-white'}`}>${(sale.totalUsd || 0).toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs pt-1 border-t border-emerald-200/40 dark:border-emerald-900/30">
                            <span className="font-bold text-slate-600 dark:text-slate-300">Total Venta (Bs)</span>
                            <span className={`font-outfit text-sm font-black ${isVoided ? 'line-through text-slate-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{formatBs(getEffectiveSaleTotalBs(sale, products, effectiveRate, bcvRate))} Bs</span>
                        </div>

                        {/* Libro de vuelto: todas las salidas se muestran, incluso cuando
                            una venta combina efectivo con un destino pendiente. */}
                        {(() => {
                            const ledger = getChangeLedger(sale, effectiveRate || bcvRate);
                            if (!ledger.hasChange) return null;
                            const formatPart = (part) => getChangeDisplayParts(
                                part,
                                { physical: part.kind === 'delivered' },
                            ).map(({ currency, amount }) => currency === 'BS'
                                ? `Bs ${formatBs(amount)}`
                                : currency === 'COP'
                                    ? `COP ${formatCop(amount)}`
                                    : `$${amount.toFixed(2)} USD`
                            ).join(' + ') || '—';
                            const labelFor = (part) => part.kind === 'owed'
                                ? `Vuelto por fuera (${part.method || 'otro'})`
                                : part.kind === 'wallet'
                                    ? 'Abono a cuenta'
                                    : part.kind === 'voucher'
                                        ? `Voucher (${part.code || 'sin código'})`
                                        : part.kind === 'donated'
                                            ? 'Vuelto cedido/donado'
                                            : 'Vuelto entregado';
                            return (
                                <div className="space-y-1">
                                    {ledger.parts.map((part) => (
                                        <div key={part.kind} className="flex items-center justify-between text-xs pt-2 border-t border-emerald-200/50 dark:border-emerald-900/40 text-amber-800 dark:text-amber-300">
                                            <span className="flex items-center gap-1 font-black uppercase tracking-wider text-[10px]"><RotateCcw size={12} /> {labelFor(part)}</span>
                                            <span className="font-outfit font-black text-sm text-amber-700 dark:text-amber-400">{formatPart(part)}</span>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}

                        {(sale.rate || sale.bcvRate || bcvRate) && (
                            <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                                <span>Tasa Aplicada</span>
                                <span>1 USD = {formatBs(sale.rate || sale.bcvRate || bcvRate)} Bs</span>
                            </div>
                        )}
                    </div>

                {/* Modal Footer */}
                <div className="p-4 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/30">
                    {isVoided ? (
                        <button
                            onClick={onClose}
                            className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-900 text-white dark:bg-slate-700 dark:hover:bg-slate-600 rounded-2xl font-black text-xs transition-colors shadow-sm cursor-pointer"
                        >
                            Cerrar Detalle
                        </button>
                    ) : (
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => setShowConfirmVoid(true)}
                                disabled={pendingVoid}
                                className="py-3 px-4 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 dark:text-rose-300 border border-rose-200 dark:border-rose-900/60 rounded-2xl font-black text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50"
                            >
                                <Trash2 size={14} /> Anular Venta
                            </button>
                            <button
                                onClick={onClose}
                                className="py-3 px-4 bg-slate-800 hover:bg-slate-900 text-white dark:bg-slate-700 dark:hover:bg-slate-600 rounded-2xl font-black text-xs transition-colors shadow-sm cursor-pointer active:scale-95"
                            >
                                Cerrar
                            </button>
                        </div>
                    )}
                </div>

                {/* Modal de Confirmación de Anulación Remota (Regla #15: Cero window.confirm) */}
                {showConfirmVoid && (
                    <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in zoom-in-95 duration-200">
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl max-w-sm w-full text-center space-y-4">
                            <div className="w-14 h-14 rounded-2xl bg-rose-100 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
                                <AlertTriangle size={28} />
                            </div>
                            <div>
                                <h4 className="text-base font-black text-slate-800 dark:text-white">¿Anular Venta {getFormattedSaleCode(sale)}?</h4>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed font-medium">
                                    Se enviará un comando remoto a la caja para restaurar el stock de los productos y revertir los movimientos contables.
                                </p>
                            </div>
                            <div className="grid grid-cols-2 gap-3 pt-2">
                                <button
                                    onClick={() => setShowConfirmVoid(false)}
                                    disabled={voiding}
                                    className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 rounded-xl font-bold text-xs transition-colors cursor-pointer"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleVoidSale}
                                    disabled={voiding}
                                    className="py-2.5 px-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-black text-xs transition-all shadow-md hover:shadow-rose-600/30 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                                >
                                    {voiding ? 'Enviando...' : 'Sí, Anular'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
