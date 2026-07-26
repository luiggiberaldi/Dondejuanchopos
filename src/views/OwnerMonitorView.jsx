import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useProductContext } from '../context/ProductContext';
import { useMonitorSync } from '../hooks/useMonitorSync';
import { storageService } from '../utils/storageService';
import { supabaseCloud } from '../config/supabaseCloud';
import { showToast } from '../components/Toast';
import { calculateComboStock, getEffectiveCostUsd, calculatePricing } from '../utils/productProcessor';
import SupervisorRateModal from '../components/SupervisorRateModal';
import RemoteProductFormModal from '../components/Monitor/RemoteProductFormModal';
import SupervisorPairingModal from '../components/Monitor/SupervisorPairingModal';
import ComboFormModal from '../components/Products/ComboFormModal';
import UsersManager from '../components/Settings/UsersManager';
import {
    TrendingUp, Package, Coins, Users, LogOut, QrCode,
    RefreshCw, Wifi, WifiOff, Clock, FileText, DollarSign,
    Wallet, CreditCard, Smartphone, Banknote, ArrowDownRight,
    ShieldCheck, Hash, AlertTriangle, Search, X, ChevronLeft, ChevronRight,
    MinusCircle, PlusCircle, Pencil, Trash2, Plus, UploadCloud, Sparkles, Gift, RotateCcw, Target
} from 'lucide-react';
import { formatBs, formatCop } from '../utils/calculatorUtils';
import { getLocalISODate } from '../utils/dateHelpers';
import { getPaymentLabel, toTitleCase } from '../config/paymentMethods';

// Helper: icon por método de pago
const PAYMENT_METHOD_ICONS = {
    efectivo_bs: Banknote,
    pago_movil: Smartphone,
    punto_de_venta: CreditCard,
    efectivo_usd: DollarSign,
    zelle: Smartphone,
    binance: Wallet,
    efectivo_cop: Coins,
    transferencia_cop: CreditCard,
    fiado: Clock,
    cashea: Clock,
    vuelto_bs: RotateCcw,
    vuelto_usd: RotateCcw,
};

function getMethodIcon(methodId) {
    return PAYMENT_METHOD_ICONS[methodId] || Wallet;
}

function getFormattedPaymentMethod(sale) {
    if (!sale) return 'Efectivo (Bs)';

    if (Array.isArray(sale.payments) && sale.payments.length > 0) {
        return sale.payments.map(p => {
            const mId = (p.methodId || p.metodoPago || p.id || '').toLowerCase();
            let label = p.methodLabel || getPaymentLabel(mId);
            if (mId === 'efectivo_usd' || mId === 'efectivo usd') label = 'Efectivo ($)';
            else if (mId === 'efectivo_bs' || mId === 'efectivo bs' || mId === 'efectivo') label = 'Efectivo (Bs)';
            else if (mId === 'efectivo_cop' || mId === 'efectivo cop') label = 'Efectivo (COP)';
            return label;
        }).join(' + ');
    }

    const raw = (sale.metodoPago || sale.paymentMethod || 'efectivo_bs').toLowerCase();

    if (raw === 'efectivo_usd' || raw === 'efectivo usd' || raw === 'usd') return 'Efectivo ($)';
    if (raw === 'efectivo_bs' || raw === 'efectivo bs' || raw === 'efectivo' || raw === 'bs') return 'Efectivo (Bs)';
    if (raw === 'efectivo_cop' || raw === 'efectivo cop' || raw === 'cop') return 'Efectivo (COP)';

    return getPaymentLabel(raw) || toTitleCase(raw);
}

function getPaymentBadgeStyle(sale) {
    const formatted = getFormattedPaymentMethod(sale).toLowerCase();
    if (formatted.includes('+')) return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300';
    if (formatted.includes('dólares') || formatted.includes('($)')) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300';
    if (formatted.includes('pago móvil')) return 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-300';
    if (formatted.includes('punto')) return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-300';
    return 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300';
}

function getFormattedSaleCode(sale) {
    if (!sale) return '';
    if (sale.saleNumber != null && Number(sale.saleNumber) > 0) {
        return `#${String(sale.saleNumber).padStart(7, '0')}`;
    }
    return `#${sale.id ? sale.id.slice(-6).toUpperCase() : ''}`;
}

function SaleDetailModal({ sale, onClose, bcvRate, pairedDeviceId, onVoidSaleSuccess }) {
    if (!sale) return null;

    const [showConfirmVoid, setShowConfirmVoid] = useState(false);
    const [voiding, setVoiding] = useState(false);

    const isVoided = sale.status === 'ANULADA';

    const formattedDate = sale.timestamp ? new Date(sale.timestamp).toLocaleString('es-VE', {
        dateStyle: 'medium',
        timeStyle: 'short'
    }) : '';

    const handleVoidSale = async () => {
        if (!sale || isVoided || voiding) return;
        setVoiding(true);
        try {
            let monitorDeviceId = localStorage.getItem('dj_device_id') || 'monitor_web';
            if (supabaseCloud && pairedDeviceId) {
                const { error } = await supabaseCloud
                    .from('supervisor_commands')
                    .insert({
                        primary_device_id: pairedDeviceId,
                        monitor_device_id: monitorDeviceId,
                        command_type: 'void_sale',
                        payload: { saleId: sale.id, reason: 'Anulada por Supervisor desde Monitor' },
                        status: 'pending'
                    });

                if (error) throw error;
                showToast('Comando de anulación enviado a la caja', 'success');
                if (onVoidSaleSuccess) {
                    onVoidSaleSuccess(sale.id);
                }
            } else {
                showToast('Sin conexión con la caja principal', 'error');
            }
            setShowConfirmVoid(false);
        } catch (err) {
            console.error('[OwnerMonitor] Error al solicitar anulación:', err);
            showToast('No se pudo enviar el comando de anulación', 'error');
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
                    {isVoided && (
                        <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-900/50 rounded-2xl flex items-center gap-3 text-rose-800 dark:text-rose-300 text-xs font-semibold">
                            <AlertTriangle size={18} className="shrink-0 text-rose-600 dark:text-rose-400" />
                            <div>
                                <p className="font-extrabold">Esta venta fue anulada</p>
                                <p className="text-[10.5px] opacity-80 mt-0.5">El stock de artículos fue restaurado y los saldos revertidos en la caja.</p>
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
                        
                        <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
                            {sale.items && sale.items.length > 0 ? (
                                sale.items.map((item, idx) => {
                                    const qty = item.qty || 1;
                                    const price = item.priceUsd ?? item.price ?? 0;
                                    const subtotalUsd = qty * price;
                                    const subtotalBs = item.subtotalBs || (subtotalUsd * (sale.bcvRate || bcvRate || 1));
                                    
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

                    {/* Resumen Total */}
                    <div className="p-4 bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40 rounded-2xl space-y-2">
                        <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-slate-600 dark:text-slate-300">Total Venta ($)</span>
                            <span className={`font-outfit text-base font-black ${isVoided ? 'line-through text-slate-400' : 'text-slate-800 dark:text-white'}`}>${(sale.totalUsd || 0).toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs pt-1 border-t border-emerald-200/40 dark:border-emerald-900/30">
                            <span className="font-bold text-slate-600 dark:text-slate-300">Total Venta (Bs)</span>
                            <span className={`font-outfit text-sm font-black ${isVoided ? 'line-through text-slate-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{formatBs(sale.totalBs || 0)} Bs</span>
                        </div>
                        {(sale.bcvRate || bcvRate) && (
                            <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                                <span>Tasa Aplicada</span>
                                <span>1 USD = {formatBs(sale.bcvRate || bcvRate)} Bs</span>
                            </div>
                        )}
                    </div>
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
                                className="py-3 px-4 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 dark:text-rose-300 border border-rose-200 dark:border-rose-900/60 rounded-2xl font-black text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
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

const PENDING_KEY = 'dj_pending_inventory_changes_v1';

export default function OwnerMonitorView({ theme, toggleTheme, triggerHaptic }) {
    const pairedDeviceId = localStorage.getItem('dj_paired_device_id');
    const { products, setProducts, effectiveRate, copEnabled, tasaCop, rates, categories } = useProductContext();
    const bcvRate = rates?.bcv?.price || effectiveRate;
    const { isConnected, lastSync, loading: syncLoading, triggerRefresh, posLastSeen, isPosOnline } = useMonitorSync(pairedDeviceId);

    const [sales, setSales] = useState([]);
    const [activeCashier, setActiveCashier] = useState({ nombre: 'Ninguno', rol: '' });
    const [loadingData, setLoadingData] = useState(true);
    const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
    const [showRateModal, setShowRateModal] = useState(false);
    const [selectedSaleDetail, setSelectedSaleDetail] = useState(null);
    const [viewTab, setViewTab] = useState('activo'); // 'activo' o 'cierres'
    const [selectedCierreId, setSelectedCierreId] = useState(null);
    const [searchTermInventario, setSearchTermInventario] = useState('');
    const [filterStockInventario, setFilterStockInventario] = useState('todos'); // 'todos', 'bajo', 'agotado'

    // ── Edición remota de inventario (comandos supervisor → caja) ──
    const [showRemoteForm, setShowRemoteForm] = useState(false);
    const [remoteEditingProduct, setRemoteEditingProduct] = useState(null);
    const [showComboModal, setShowComboModal] = useState(false);
    const [editingCombo, setEditingCombo] = useState(null);
    const [remoteDeleteTarget, setRemoteDeleteTarget] = useState(null);
    const [stockAdjustProduct, setStockAdjustProduct] = useState(null);
    const [cloudPendingCmds, setCloudPendingCmds] = useState([]);
    const [allCloudCmds, setAllCloudCmds] = useState([]);
    const [cmdTabFilter, setCmdTabFilter] = useState('todos'); // 'todos', 'pending', 'applied', 'cancelled'
    const [currentPageCambios, setCurrentPageCambios] = useState(1);
    const ITEMS_PER_PAGE_CAMBIOS = 10;
    const [showCloudPendingModal, setShowCloudPendingModal] = useState(false);
    const [showUsersModal, setShowUsersModal] = useState(false);
    const [showPairingModal, setShowPairingModal] = useState(false);
    const [cancellingCmdId, setCancellingCmdId] = useState(null);
    const [pendingChanges, setPendingChanges] = useState(() => {
        try {
            const raw = localStorage.getItem(PENDING_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch { return []; }
    });
    const [uploading, setUploading] = useState(false);

    // 🎯 Sniper Auto-Repair: Detectar y conectar a la caja activa más reciente en Supabase
    const handleAutoRepairPairing = async () => {
        if (!supabaseCloud) return;
        triggerHaptic?.();
        showToast('🎯 Buscando caja activa en Supabase...', 'info');
        try {
            const { data, error } = await supabaseCloud
                .from('sync_documents')
                .select('device_id, updated_at')
                .eq('doc_id', 'bodega_sales_v1')
                .order('updated_at', { ascending: false })
                .limit(1);

            if (error) throw error;

            if (data && data[0]?.device_id) {
                const activeId = data[0].device_id;
                localStorage.setItem('dj_paired_device_id', activeId);
                showToast(`🎯 Conectado con éxito a la caja activa`, 'success');
                setTimeout(() => window.location.reload(), 600);
            } else {
                showToast('No se encontró ninguna caja con ventas recientes', 'error');
            }
        } catch (err) {
            console.error('[SniperAutoRepair] Error:', err);
            showToast('Error al buscar caja activa', 'error');
        }
    };

    // Consulta en tiempo real del historial completo de comandos (pendientes, aplicados y anulados)
    const fetchAllCloudCmds = useCallback(async () => {
        if (!supabaseCloud || !pairedDeviceId) return;
        try {
            const { data } = await supabaseCloud
                .from('supervisor_commands')
                .select('*')
                .eq('primary_device_id', pairedDeviceId)
                .order('created_at', { ascending: false })
                .limit(150);

            const all = data || [];
            setAllCloudCmds(all);
            setCloudPendingCmds(all.filter(c => c.status === 'pending'));
        } catch (err) {
            console.warn('[OwnerMonitor] Error al consultar historial de comandos:', err);
        }
    }, [pairedDeviceId]);

    useEffect(() => {
        fetchAllCloudCmds();
        if (!supabaseCloud || !pairedDeviceId) return;

        const myDeviceId = localStorage.getItem('dj_device_id');

        const channel = supabaseCloud
            .channel(`supervisor_cmds:${pairedDeviceId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'supervisor_commands',
                filter: `primary_device_id=eq.${pairedDeviceId}`
            }, (payload) => {
                fetchAllCloudCmds();

                // Notificar en tiempo real únicamente cuando OTRO supervisor inserte un comando nuevo (FP6)
                const newCmd = payload.new;
                if (payload.eventType === 'INSERT' && newCmd && newCmd.monitor_device_id !== myDeviceId) {
                    let actionText = 'realizó un cambio remoto';
                    if (newCmd.command_type === 'void_sale') actionText = 'anuló una venta';
                    else if (newCmd.command_type === 'rate_change') actionText = 'actualizó la tasa de cambio';
                    else if (newCmd.command_type === 'inventory_update') actionText = 'actualizó el inventario';
                    else if (newCmd.command_type === 'user_update') actionText = 'modificó la lista de usuarios';

                    showToast(`Otro supervisor ${actionText}`, 'info');
                }
            })
            .subscribe();

        return () => {
            supabaseCloud.removeChannel(channel).catch(() => {});
        };
    }, [pairedDeviceId, fetchAllCloudCmds]);

    const wipeMonitorSession = async () => {
        localStorage.removeItem('dj_pairing_code');
        localStorage.removeItem('dj_pairing_mode');
        localStorage.removeItem('dj_paired_device_id');
        localStorage.removeItem('monitor_last_sync');
        localStorage.removeItem('business_name');
        localStorage.removeItem('business_rif');
        localStorage.removeItem(PENDING_KEY);

        try {
            const { default: localforage } = await import('localforage');
            localforage.config({ name: 'BodegaApp', storeName: 'bodega_app_data' });
            await localforage.clear();
        } catch (e) {
            console.warn('[OwnerMonitorView] Error limpiando IndexedDB:', e);
        }
    };

    // Detección de revocación remota emitida por el heartbeat (F4, B4, FX4)
    useEffect(() => {
        const handleRevoked = async () => {
            showToast('El acceso de este dispositivo ha sido revocado', 'error');
            await wipeMonitorSession();
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        };

        window.addEventListener('monitor_revoked', handleRevoked);
        return () => window.removeEventListener('monitor_revoked', handleRevoked);
    }, []);

    const persistPending = useCallback((next) => {
        setPendingChanges(next);
        try { localStorage.setItem(PENDING_KEY, JSON.stringify(next)); } catch { /* storage lleno */ }
    }, []);

    // Fusión de cambios en cola con setPendingChanges(prev => ...) para evitar
    // closure stale cuando el usuario pulsa +/- rápidamente antes del re-render.
    const queueInventoryChange = useCallback((action, productId, data) => {
        setPendingChanges(prev => {
            const next = [...prev];
            const idxOf = (act) => next.findIndex(c => c.productId === productId && c.action === act);

            if (action === 'adjust_stock') {
                const i = idxOf('adjust_stock');
                if (i >= 0) {
                    const newDelta = (Number(next[i].data?.delta) || 0) + (Number(data?.delta) || 0);
                    if (newDelta === 0) next.splice(i, 1);
                    else next[i] = { ...next[i], data: { delta: newDelta }, queuedAt: new Date().toISOString() };
                } else {
                    next.push({ action, productId, data, queuedAt: new Date().toISOString() });
                }
            } else if (action === 'edit') {
                const addIdx = idxOf('add');
                if (addIdx >= 0) {
                    next[addIdx] = { ...next[addIdx], data: { ...data, id: productId }, queuedAt: new Date().toISOString() };
                } else {
                    const i = idxOf('edit');
                    if (i >= 0) next[i] = { ...next[i], data, queuedAt: new Date().toISOString() };
                    else next.push({ action, productId, data, queuedAt: new Date().toISOString() });
                }
            } else if (action === 'delete') {
                const hadAdd = idxOf('add') >= 0;
                for (let i = next.length - 1; i >= 0; i--) {
                    if (next[i].productId === productId) next.splice(i, 1);
                }
                if (!hadAdd) next.push({ action, productId, data: null, queuedAt: new Date().toISOString() });
            } else {
                next.push({ action, productId, data, queuedAt: new Date().toISOString() });
            }

            try { localStorage.setItem(PENDING_KEY, JSON.stringify(next)); } catch { /* storage lleno */ }
            return next;
        });
        // No mostramos toast flotante ruidoso en cada clic individual;
        // la UI responde instantáneamente y la barra flotante inferior muestra los cambios pendientes.
        return true;
    }, []);

    // Delta de stock pendiente por producto (para proyectar en la fila)
    const pendingStockDelta = (productId) =>
        pendingChanges.reduce((sum, c) =>
            c.productId === productId && c.action === 'adjust_stock' ? sum + (Number(c.data?.delta) || 0) : sum, 0);

    const hasPendingFor = (productId) => pendingChanges.some(c => c.productId === productId);

    // «Subir al sistema»: vacía la cola enviando los comandos individuales ya
    // fusionados. Reutiliza toda la infraestructura existente (dedup, catch-up,
    // validación y estado por comando en la caja). Los que fallen al insertar
    // permanecen en la cola.
    const uploadPendingChanges = async () => {
        if (!supabaseCloud || !pairedDeviceId) {
            showToast('Sin conexión con la caja', 'error');
            return;
        }
        if (pendingChanges.length === 0 || uploading) return;
        const monitorDeviceId = localStorage.getItem('dj_device_id') || 'monitor_web';

        const remaining = [];
        let sent = 0;
        for (const change of pendingChanges) {
            try {
                const commandType = change.action === 'user_update' ? 'user_update' : 'inventory_update';
                const payload = change.action === 'user_update'
                    ? (change.data || {})
                    : {
                        action: change.action,
                        productId: change.productId,
                        data: change.data,
                        issuedAt: change.queuedAt,
                    };

                const { error } = await supabaseCloud
                    .from('supervisor_commands')
                    .insert({
                        primary_device_id: pairedDeviceId,
                        monitor_device_id: monitorDeviceId,
                        command_type: commandType,
                        payload: payload,
                        status: 'pending'
                    });
                if (error) throw error;
                sent += 1;
            } catch (err) {
                console.error('[OwnerMonitor] Error al subir cambio:', err);
                remaining.push(change);
            }
        }
        if (sent > 0) {
            // Actualización optimista del estado local en el monitor para que la vista NO revierta el stock
            const updatedLocal = projectedProducts.map(p => {
                const { _rawStock, _stockDelta, _isQueuedDelete, _isQueuedEdit, _isQueuedNew, _isCombo, _effectiveCost, ...clean } = p;
                return clean;
            });
            if (setProducts) setProducts(updatedLocal);
            storageService.setItem('bodega_products_v1', updatedLocal).catch(() => {});
        }
        persistPending(remaining);
        setUploading(false);
        if (remaining.length === 0) {
            showToast(`${sent} cambio${sent !== 1 ? 's' : ''} enviado${sent !== 1 ? 's' : ''} a la caja`, 'success');
        } else {
            showToast(`${sent} enviados · ${remaining.length} fallaron y siguen en cola`, 'warning');
        }
    };

    const discardPendingChanges = () => {
        persistPending([]);
        showToast('Cambios pendientes descartados', 'info');
    };

    const cancelSingleCloudCmd = async (cmdId) => {
        setCancellingCmdId(cmdId);
        try {
            const { error } = await supabaseCloud
                .from('supervisor_commands')
                .update({ status: 'cancelled' })
                .eq('id', cmdId);

            if (error) throw error;
            setCloudPendingCmds(prev => prev.filter(c => c.id !== cmdId));
            showToast('Comando anulado en la nube', 'success');
        } catch (err) {
            console.error('[OwnerMonitor] Error al anular comando:', err);
            showToast('No se pudo anular el comando', 'error');
        } finally {
            setCancellingCmdId(null);
        }
    };

    const cancelAllCloudCmds = async () => {
        if (cloudPendingCmds.length === 0) return;
        try {
            const ids = cloudPendingCmds.map(c => c.id);
            const { error } = await supabaseCloud
                .from('supervisor_commands')
                .update({ status: 'cancelled' })
                .in('id', ids);

            if (error) throw error;
            setCloudPendingCmds([]);
            setShowCloudPendingModal(false);
            showToast('Todos los comandos pendientes fueron anulados', 'success');
        } catch (err) {
            console.error('[OwnerMonitor] Error al anular comandos:', err);
            showToast('Error al anular los comandos', 'error');
        }
    };

    // Proyección instantánea en memoria de los productos + cambios en cola
    const projectedProducts = useMemo(() => {
        if (!products) return [];

        const baseList = products.map(p => {
            const stockDelta = pendingChanges
                .filter(c => c.productId === p.id && c.action === 'adjust_stock')
                .reduce((sum, c) => sum + (Number(c.data?.delta) || 0), 0);

            const editChange = pendingChanges.find(c => c.productId === p.id && c.action === 'edit');
            const isDeleted = pendingChanges.some(c => c.productId === p.id && c.action === 'delete');

            let merged = { ...p };
            if (editChange?.data) {
                merged = { ...merged, ...editChange.data };
            }

            const baseStock = Number(merged.stock) || 0;
            return {
                ...merged,
                stock: Math.max(0, baseStock + stockDelta),
                _rawStock: baseStock,
                _stockDelta: stockDelta,
                _isQueuedDelete: isDeleted,
                _isQueuedEdit: !!editChange
            };
        });

        // Excluir de la vista los eliminados en cola
        const activeList = baseList.filter(p => !p._isQueuedDelete);

        // Agregar a la vista los creados en cola (nuevos)
        const addChanges = pendingChanges.filter(c => c.action === 'add');
        const newItems = addChanges.filter(c => c.data).map(addChange => ({
            ...addChange.data,
            id: addChange.productId || addChange.data.id || `temp_${Date.now()}`,
            name: addChange.data.name || 'Nuevo Producto',
            category: addChange.data.category || 'Varios',
            stock: Number(addChange.data.stock || 0),
            priceUsd: Number(addChange.data.priceUsd || addChange.data.price || 0),
            costUsd: Number(addChange.data.costUsd || addChange.data.costPrice || 0),
            _isQueuedNew: true
        }));

        const combinedList = [...newItems, ...activeList];

        // Recalcular stock dinámico y costo efectivo para combos basándonos en la proyección de sus insumos
        return combinedList.map(p => {
            const effCost = getEffectiveCostUsd(p, combinedList);
            if (p.isCombo || p.type === 'combo' || p.category === 'combo') {
                const dynamicStock = calculateComboStock(p, combinedList);
                return { ...p, stock: dynamicStock, _isCombo: true, _effectiveCost: effCost, costUsd: p.costUsd || effCost };
            }
            return { ...p, _effectiveCost: effCost, costUsd: p.costUsd || effCost };
        });
    }, [products, pendingChanges]);

    const filteredProducts = useMemo(() => {
        return projectedProducts.filter(p => {
            const matchesSearch = (p.name || '').toLowerCase().includes(searchTermInventario.toLowerCase()) || 
                                 (p.barcode && p.barcode.includes(searchTermInventario));
            
            if (!matchesSearch) return false;
            
            if (filterStockInventario === 'bajo') {
                return p.stock > 0 && p.stock <= (p.minStock || 5);
            }
            if (filterStockInventario === 'agotado') {
                return p.stock <= 0;
            }
            return true;
        });
    }, [projectedProducts, searchTermInventario, filterStockInventario]);

    const [currentPageInventario, setCurrentPageInventario] = useState(1);
    const ITEMS_PER_PAGE_INVENTARIO = 15;

    useEffect(() => {
        setCurrentPageInventario(1);
    }, [searchTermInventario, filterStockInventario]);

    const totalPagesInventario = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE_INVENTARIO);

    const paginatedProducts = useMemo(() => {
        const start = (currentPageInventario - 1) * ITEMS_PER_PAGE_INVENTARIO;
        return filteredProducts.slice(start, start + ITEMS_PER_PAGE_INVENTARIO);
    }, [filteredProducts, currentPageInventario]);

    const inventoryMetrics = useMemo(() => {
        if (!projectedProducts) {
            return { totalCost: 0, totalRetail: 0, totalQty: 0, lowStockCount: 0, outOfStockCount: 0, expectedProfit: 0, count: 0 };
        }
        let totalCost = 0;
        let totalRetail = 0;
        let totalQty = 0;
        let lowStockCount = 0;
        let outOfStockCount = 0;

        projectedProducts.forEach(p => {
            const stock = p.stock || 0;
            const cost = p._effectiveCost ?? (p.costUsd || p.costPrice || 0);
            const retail = p.priceUsd || 0;
            const minStock = p.minStock || 5;

            totalCost += cost * stock;
            totalRetail += retail * stock;
            totalQty += stock;

            if (stock <= 0) {
                outOfStockCount++;
            } else if (stock <= minStock) {
                lowStockCount++;
            }
        });

        const expectedProfit = Math.max(0, totalRetail - totalCost);

        return {
            totalCost,
            totalRetail,
            totalQty,
            lowStockCount,
            outOfStockCount,
            expectedProfit,
            count: projectedProducts.length
        };
    }, [projectedProducts]);

    const today = getLocalISODate();

    // 1. Cargar datos locales (que son actualizados por useMonitorSync)
    const loadLocalData = async () => {
        try {
            const [savedSales, savedAuth, savedSession] = await Promise.all([
                storageService.getItem('bodega_sales_v1', []),
                storageService.getItem('abasto-auth-storage', null),
                storageService.getItem('abasto-device-session', null)
            ]);

            setSales(savedSales);
            
            const activeUser = savedSession?.nombre || savedAuth?.state?.usuarioActivo?.nombre;
            if (activeUser) {
                setActiveCashier({
                    nombre: activeUser,
                    rol: savedSession?.rol || savedAuth?.state?.usuarioActivo?.rol || 'CAJERO'
                });
            } else {
                setActiveCashier({ nombre: 'Ninguno', rol: '' });
            }
        } catch (e) {
            console.error('[OwnerMonitorView] Error cargando datos locales:', e);
        } finally {
            setLoadingData(false);
        }
    };

    useEffect(() => {
        loadLocalData();

        // Escuchar actualizaciones del almacenamiento causadas por la sincronización en tiempo real
        const handleUpdate = () => {
            loadLocalData();
        };

        window.addEventListener('app_storage_update', handleUpdate);
        window.addEventListener('storage', handleUpdate);
        return () => {
            window.removeEventListener('app_storage_update', handleUpdate);
            window.removeEventListener('storage', handleUpdate);
        };
    }, []);

    // ── TURNO ACTIVO & ESTADO DE CAJA ──
    const [nowTick, setNowTick] = useState(() => Date.now());

    useEffect(() => {
        const timer = setInterval(() => setNowTick(Date.now()), 30000);
        return () => clearInterval(timer);
    }, []);

    // Apertura de caja del turno activo
    const activeShiftApertura = useMemo(() => {
        const aperturas = sales.filter(s => s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
        if (aperturas.length === 0) return null;
        return aperturas.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
    }, [sales]);

    // Estado global del turno (Abierta/Cerrada + Tiempo transcurrido)
    const shiftStatusInfo = useMemo(() => {
        let openTs = activeShiftApertura?.timestamp;

        if (!openTs) {
            const unclosed = sales.filter(s => !s.cajaCerrada && s.status !== 'ANULADA' && s.tipo !== 'REGISTRO_CIERRE');
            if (unclosed.length > 0) {
                const sorted = [...unclosed].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                openTs = sorted[0].timestamp;
            }
        }

        if (!openTs) {
            return { isOpen: false, openTime: null, formattedTime: '', elapsedLabel: 'Caja Cerrada' };
        }

        const openDate = new Date(openTs);
        const diffMs = Math.max(0, nowTick - openDate.getTime());
        const diffMins = Math.floor(diffMs / 60000);

        let elapsedLabel = '';
        if (diffMins < 1) {
            elapsedLabel = 'hace menos de 1m';
        } else if (diffMins < 60) {
            elapsedLabel = `hace ${diffMins}m`;
        } else if (diffMins < 1440) {
            const h = Math.floor(diffMins / 60);
            const m = diffMins % 60;
            elapsedLabel = m > 0 ? `hace ${h}h ${m}m` : `hace ${h}h`;
        } else {
            const d = Math.floor(diffMins / 1440);
            const h = Math.floor((diffMins % 1440) / 60);
            elapsedLabel = h > 0 ? `hace ${d}d ${h}h` : `hace ${d}d`;
        }

        const formattedTime = openDate.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true });

        return {
            isOpen: true,
            openTime: openDate,
            formattedTime,
            elapsedLabel
        };
    }, [sales, activeShiftApertura, nowTick]);

    // Filtrar ventas del turno activo (cajaCerrada !== true)
    const activeShiftSales = useMemo(() => {
        const filtered = sales.filter(s => {
            if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA') return false;
            if (s.cajaCerrada) return false;
            
            // Restringir a transacciones posteriores a la última apertura activa si existe
            if (activeShiftApertura) {
                return new Date(s.timestamp) >= new Date(activeShiftApertura.timestamp);
            }
            return true;
        });
        return filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }, [sales, activeShiftApertura]);

    // Métricas del turno activo
    const activeShiftMetrics = useMemo(() => {
        let usd = 0;
        let bs = 0;
        const validSales = activeShiftSales.filter(s => s.status !== 'ANULADA');
        validSales.forEach(s => {
            usd += s.totalUsd || 0;
            bs += s.totalBs || 0;
        });

        // Calcular ganancia estimada si los productos tienen costo
        let costSum = 0;
        validSales.forEach(s => {
            if (!s.items) return;
            s.items.forEach(item => {
                const prod = products.find(p => p.id === item.productId || p.id === item.id);
                if (prod && (prod.costUsd || prod.costPrice)) {
                    costSum += (prod.costUsd || prod.costPrice) * item.qty;
                }
            });
        });

        const profitUsd = Math.max(0, usd - costSum);

        return {
            totalUsd: usd,
            totalBs: bs,
            profitUsd,
            count: validSales.length
        };
    }, [activeShiftSales, products]);

    // Desglose por método de pago del turno activo (incluye vueltos desglosados en Bs y $)
    const activeShiftPaymentBreakdown = useMemo(() => {
        const breakdown = {};
        let totalVueltoBs = 0;
        let totalVueltoUsd = 0;

        // Incluye ventas, cobros de deuda, y pagos de proveedor en el flujo de caja
        const activeFlow = sales.filter(s => {
            if (s.status === 'ANULADA') return false;
            if (s.cajaCerrada) return false;
            if (s.tipo === 'APERTURA_CAJA' || s.tipo === 'REGISTRO_CIERRE') return false;
            
            // Restringir a transacciones posteriores a la última apertura activa si existe
            if (activeShiftApertura) {
                return new Date(s.timestamp) >= new Date(activeShiftApertura.timestamp);
            }
            return true;
        });

        activeFlow.forEach(sale => {
            if (sale.changeBs && Number(sale.changeBs) > 0) {
                totalVueltoBs += Number(sale.changeBs);
            }
            if (sale.changeUsd && Number(sale.changeUsd) > 0) {
                totalVueltoUsd += Number(sale.changeUsd);
            }

            if (sale.tipo === 'VENTA_FIADA') {
                if (!breakdown['fiado']) {
                    breakdown['fiado'] = { totalUsd: 0, totalBs: 0, count: 0, label: 'Fiado (Por Cobrar)', currency: 'FIADO' };
                }
                breakdown['fiado'].totalUsd += sale.totalUsd || 0;
                breakdown['fiado'].totalBs += sale.totalBs || 0;
                breakdown['fiado'].count += 1;
                return;
            }

            if (sale.payments && sale.payments.length > 0) {
                sale.payments.forEach(p => {
                    const methodId = p.methodId || 'efectivo_bs';
                    if (!breakdown[methodId]) {
                        const label = p.methodLabel || getPaymentLabel(methodId) || toTitleCase(methodId.replace(/_/g, ' '));
                        breakdown[methodId] = { totalUsd: 0, totalBs: 0, count: 0, label, currency: p.currency || 'BS' };
                    }
                    breakdown[methodId].totalUsd += p.amountUsd || 0;
                    breakdown[methodId].totalBs += p.amountBs || 0;
                    breakdown[methodId].count += 1;
                });
            } else {
                const methodId = sale.paymentMethod || sale.metodoPago || 'efectivo_bs';
                if (!breakdown[methodId]) {
                    const label = getPaymentLabel(methodId) || toTitleCase(methodId.replace(/_/g, ' '));
                    let currency = 'BS';
                    if (methodId.includes('usd') || methodId.includes('zelle') || methodId.includes('binance')) currency = 'USD';
                    else if (methodId.includes('cop')) currency = 'COP';
                    breakdown[methodId] = { totalUsd: 0, totalBs: 0, count: 0, label, currency };
                }
                breakdown[methodId].totalUsd += sale.totalUsd || 0;
                breakdown[methodId].totalBs += sale.totalBs || 0;
                breakdown[methodId].count += 1;
            }
        });

        const rate = effectiveRate || bcvRate || 1;

        if (totalVueltoBs > 0) {
            breakdown['vuelto_bs'] = {
                totalUsd: totalVueltoBs / rate,
                totalBs: totalVueltoBs,
                count: 0,
                label: 'Vuelto Entregado (en Bs)',
                currency: 'BS',
                isChange: true
            };
        }
        if (totalVueltoUsd > 0) {
            breakdown['vuelto_usd'] = {
                totalUsd: totalVueltoUsd,
                totalBs: totalVueltoUsd * rate,
                count: 0,
                label: 'Vuelto Entregado (en $)',
                currency: 'USD',
                isChange: true
            };
        }

        return Object.entries(breakdown)
            .filter(([, data]) => data.totalUsd > 0 || data.totalBs > 0 || data.count > 0)
            .sort(([, a], [, b]) => {
                if (a.isChange && !b.isChange) return 1;
                if (!a.isChange && b.isChange) return -1;
                return b.totalUsd - a.totalUsd;
            });
    }, [sales, activeShiftApertura, effectiveRate, bcvRate]);

    // Ticket promedio del turno activo
    const activeShiftAvgTicket = useMemo(() => {
        if (activeShiftSales.length === 0) return 0;
        return activeShiftMetrics.totalUsd / activeShiftSales.length;
    }, [activeShiftMetrics.totalUsd, activeShiftSales.length]);


    // ── HISTORIAL DE CIERRES DE CAJA ──

    // Reconstruir cierres agrupados por cierreId
    const registerCloses = useMemo(() => {
        const explicitCloses = sales.filter(s => s.tipo === 'REGISTRO_CIERRE');
        
        // Agrupar transacciones cerradas por cierreId
        const groups = {};
        sales.forEach(s => {
            if (s.cierreId && s.tipo !== 'REGISTRO_CIERRE') {
                const cId = s.cierreId;
                if (!groups[cId]) {
                    groups[cId] = {
                        cierreId: cId,
                        timestamp: new Date(cId).toISOString(),
                        sales: []
                    };
                }
                groups[cId].sales.push(s);
            }
        });

        // Formatear cada grupo combinando datos explícitos de arqueo si existen
        return Object.values(groups).map(g => {
            const explicit = explicitCloses.find(ec => ec.cierreId === g.cierreId);
            
            // Filtrar para métricas generales y de caja
            const salesForStats = g.sales.filter(s => s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA');
            const salesForCashFlow = g.sales.filter(s => s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA' || s.tipo === 'COBRO_DEUDA' || s.tipo === 'PAGO_PROVEEDOR');
            
            const totalUsd = salesForStats.reduce((sum, s) => sum + (s.totalUsd || 0), 0);
            const totalBs = salesForStats.reduce((sum, s) => sum + (s.totalBs || 0), 0);
            const totalItems = salesForStats.reduce((sum, s) => sum + (s.items ? s.items.reduce((is, it) => is + it.qty, 0) : 0), 0);
            
            // Reconstruir desglose de pagos del cierre
            const breakdown = {};
            salesForCashFlow.forEach(sale => {
                if (sale.tipo === 'VENTA_FIADA') {
                    if (!breakdown['fiado']) {
                        breakdown['fiado'] = { totalUsd: 0, totalBs: 0, count: 0, label: 'Fiado (Por Cobrar)', currency: 'FIADO' };
                    }
                    breakdown['fiado'].totalUsd += sale.totalUsd || 0;
                    breakdown['fiado'].totalBs += sale.totalBs || 0;
                    breakdown['fiado'].count += 1;
                    return;
                }
                if (sale.payments && sale.payments.length > 0) {
                    sale.payments.forEach(p => {
                        const mId = p.methodId || 'efectivo_bs';
                        if (!breakdown[mId]) {
                            breakdown[mId] = { totalUsd: 0, totalBs: 0, count: 0, label: p.methodLabel || getPaymentLabel(mId), currency: p.currency || 'BS' };
                        }
                        breakdown[mId].totalUsd += p.amountUsd || 0;
                        breakdown[mId].totalBs += p.amountBs || 0;
                        breakdown[mId].count += 1;
                    });
                } else {
                    const mId = sale.paymentMethod || sale.metodoPago || 'efectivo_bs';
                    if (!breakdown[mId]) {
                        breakdown[mId] = { totalUsd: 0, totalBs: 0, count: 0, label: getPaymentLabel(mId), currency: mId.includes('usd') ? 'USD' : 'BS' };
                    }
                    breakdown[mId].totalUsd += sale.totalUsd || 0;
                    breakdown[mId].totalBs += sale.totalBs || 0;
                    breakdown[mId].count += 1;
                }
            });

            const sortedBreakdown = Object.entries(breakdown)
                .sort(([, a], [, b]) => b.totalUsd - a.totalUsd);

            const apertura = g.sales.find(s => s.tipo === 'APERTURA_CAJA') || null;

            return {
                cierreId: g.cierreId,
                timestamp: g.timestamp,
                sales: salesForStats,
                totalUsd,
                totalBs,
                totalItems,
                paymentBreakdown: sortedBreakdown,
                apertura,
                reconData: explicit?.summary?.reconData || null,
                cashier: explicit?.summary?.cashier || { nombre: 'Cajero', rol: 'CAJERO' }
            };
        }).sort((a, b) => b.cierreId - a.cierreId);
    }, [sales]);

    // Establecer primer cierre por defecto si cambia la lista
    useEffect(() => {
        if (registerCloses.length > 0 && !selectedCierreId) {
            setSelectedCierreId(registerCloses[0].cierreId);
        }
    }, [registerCloses, selectedCierreId]);


    // ── COMPONENTES GENERALES ──

    // Productos Críticos (Stock <= 0)
    const criticalProducts = useMemo(() => {
        return products
            .filter(p => p.stock <= 0)
            .slice(0, 10);
    }, [products]);

    // Desvincular Monitor (FX5)
    const handleDisconnect = async () => {
        triggerHaptic?.();
        const myDeviceId = localStorage.getItem('dj_device_id');
        
        try {
            if (supabaseCloud && pairedDeviceId && myDeviceId) {
                const { data, error } = await supabaseCloud.rpc('revoke_monitor', {
                    p_requester_id: myDeviceId,
                    p_target_monitor_id: myDeviceId
                });
                if (error || (data && !data.success)) {
                    // Fallback a unpair_monitor si la RPC revoke_monitor no está disponible (D6)
                    await supabaseCloud.rpc('unpair_monitor', { p_device_id: pairedDeviceId }).catch(() => {});
                }
            }
        } catch (err) {
            console.warn('[OwnerMonitorView] Error al revocar vínculo local:', err);
        }

        await wipeMonitorSession();
        showToast('Dispositivo desvinculado con éxito', 'success');
        setTimeout(() => window.location.reload(), 1000);
    };

    // Formateadores
    const formatTime = (isoString) => {
        if (!isoString) return '';
        try {
            const date = new Date(isoString);
            return date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch {
            return '';
        }
    };

    // Determinar si la caja está actualmente inactiva (sin turno abierto)
    const isShiftActive = activeShiftApertura !== null || activeShiftSales.length > 0;

    return (
        <div className={`min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-sans transition-colors duration-300 overflow-x-hidden ${pendingChanges.length > 0 && viewTab === 'inventario' ? 'pb-48 sm:pb-36' : 'pb-16'}`}>
            {/* Header del Monitor (100% Responsivo) */}
            <header className="sticky top-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-3 sm:px-5 py-2.5 shadow-xs">
                <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-2.5">
                    {/* Fila Superior en Móvil / Izquierda en PC */}
                    <div className="flex items-center justify-between gap-3 min-w-0">
                        <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-2xl bg-emerald-500 flex items-center justify-center shadow-md shadow-emerald-500/20 text-white font-bold shrink-0">
                                <ShieldCheck size={18} className="sm:hidden" />
                                <ShieldCheck size={20} className="hidden sm:block" />
                            </div>
                            <div className="min-w-0">
                                <h1 className="text-xs sm:text-base font-black leading-tight text-slate-800 dark:text-white truncate">Panel de Supervisión</h1>
                                <p className="text-[9px] sm:text-[10.5px] text-slate-400 font-medium truncate">Monitoreo en vivo • {localStorage.getItem('business_name') || 'Mi Negocio'}</p>
                            </div>
                        </div>

                        {/* Botones de Acción en Móvil (Derecha en pantallas pequeñas) */}
                        <div className="flex md:hidden items-center gap-1 shrink-0">
                            <button 
                                onClick={async () => { 
                                    triggerHaptic?.(); 
                                    await triggerRefresh(); 
                                    showToast?.('Datos actualizados', 'success');
                                }}
                                disabled={syncLoading}
                                className="p-2 rounded-xl text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 transition-colors disabled:opacity-50"
                                title="Actualizar Datos"
                            >
                                <RefreshCw size={14} className={syncLoading ? "animate-spin text-emerald-500" : ""} />
                            </button>
                            <button 
                                onClick={() => { triggerHaptic?.(); setShowRateModal(true); }}
                                className="p-2 rounded-xl text-slate-400 hover:text-brand hover:bg-brand-light border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 transition-colors"
                                title="Cambiar Tasa Remota"
                            >
                                <TrendingUp size={14} />
                            </button>
                            <button 
                                onClick={() => { triggerHaptic?.(); setShowUsersModal(true); }}
                                className="p-2 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 transition-colors"
                                title="Usuarios y PINs"
                            >
                                <Users size={14} />
                            </button>
                            <button 
                                onClick={() => { triggerHaptic?.(); setShowPairingModal(true); }}
                                className="p-2 rounded-xl text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 transition-colors"
                                title="Conectar otro dispositivo supervisor"
                            >
                                <QrCode size={14} />
                            </button>
                            <button 
                                onClick={() => { triggerHaptic?.(); setShowDisconnectConfirm(true); }}
                                className="p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 transition-colors"
                                title="Desvincular Dispositivo"
                            >
                                <LogOut size={14} />
                            </button>
                        </div>
                    </div>

                    {/* Status Badges y Acciones en PC */}
                    <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar pb-0.5 md:pb-0">
                        {/* Status Badge del Supervisor */}
                        <div className={`flex items-center gap-1 sm:gap-1.5 px-2.5 py-1 rounded-full text-[9px] sm:text-[10px] font-black tracking-wider uppercase shadow-xs shrink-0 transition-colors duration-300 ${
                            isConnected 
                                ? 'bg-emerald-50 border border-emerald-200/50 text-emerald-600 dark:bg-emerald-950/20 dark:border-emerald-800/30 dark:text-emerald-400' 
                                : 'bg-rose-50 border border-rose-200/50 text-rose-600 dark:bg-rose-950/20 dark:border-rose-800/30 dark:text-rose-400 animate-pulse'
                        }`}>
                            {isConnected ? (
                                <>
                                    <Wifi size={11} className="shrink-0" />
                                    <span>En Vivo</span>
                                </>
                            ) : (
                                <>
                                    <WifiOff size={11} className="shrink-0" />
                                    <span>Offline</span>
                                </>
                            )}
                        </div>

                        {/* Status Badge de la Caja Principal (Online/Offline) con Sniper Auto-Repair */}
                        <div 
                            onClick={!isPosOnline ? handleAutoRepairPairing : undefined}
                            title={isPosOnline ? `Caja conectada (${posLastSeen ? posLastSeen.toLocaleTimeString() : ''})` : 'Haz clic para Auto-Conectar a la Caja Activa en Supabase'}
                            className={`flex items-center gap-1 sm:gap-1.5 px-2.5 py-1 rounded-full text-[9px] sm:text-[10px] font-black tracking-wider uppercase shadow-xs shrink-0 transition-colors duration-300 ${
                                !isPosOnline ? 'cursor-pointer hover:bg-amber-100 hover:scale-105' : ''
                            } ${
                                isPosOnline 
                                    ? 'bg-emerald-50 border border-emerald-200/60 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-800/50 dark:text-emerald-400' 
                                    : 'bg-amber-50 border border-amber-200/60 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800/50 dark:text-amber-400'
                            }`}
                        >
                            <span className={`w-2 h-2 rounded-full shrink-0 ${isPosOnline ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                            <span>Caja: {isPosOnline ? 'En Línea' : 'Offline'}</span>
                            {!isPosOnline && <Target size={11} className="text-amber-600 animate-pulse ml-0.5" />}
                        </div>

                        {!isPosOnline && (
                            <button
                                onClick={handleAutoRepairPairing}
                                className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-full text-[9px] font-black tracking-wider uppercase flex items-center gap-1 shadow-xs transition-transform active:scale-95 cursor-pointer shrink-0"
                                title="Auto-Conectar a la caja más reciente activa en la tienda"
                            >
                                <Target size={11} />
                                <span>Auto-Conectar Caja</span>
                            </button>
                        )}

                        {/* Status Badge del Estado del Turno (Abierta/Cerrada + Tiempo) */}
                        <div 
                            title={shiftStatusInfo.isOpen 
                                ? `Apertura de caja: ${shiftStatusInfo.formattedTime} (${shiftStatusInfo.elapsedLabel})` 
                                : 'La caja se encuentra cerrada en este momento'}
                            className={`flex items-center gap-1 sm:gap-1.5 px-2.5 py-1 rounded-full text-[9px] sm:text-[10px] font-black tracking-wider uppercase shadow-xs shrink-0 transition-colors duration-300 ${
                                shiftStatusInfo.isOpen 
                                    ? 'bg-emerald-50 border border-emerald-300/80 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800/60 dark:text-emerald-300' 
                                    : 'bg-slate-100 border border-slate-300/80 text-slate-600 dark:bg-slate-800/60 dark:border-slate-700/60 dark:text-slate-400'
                            }`}
                        >
                            <span className={`w-2 h-2 rounded-full shrink-0 ${shiftStatusInfo.isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                            <span>
                                {shiftStatusInfo.isOpen 
                                    ? `Abierta (${shiftStatusInfo.elapsedLabel})` 
                                    : 'Caja Cerrada'}
                            </span>
                        </div>

                        {/* Botones de Acción en PC */}
                        <div className="hidden md:flex items-center gap-1.5 ml-2 border-l border-slate-200 dark:border-slate-800 pl-2 shrink-0">
                            <button 
                                onClick={async () => { 
                                    triggerHaptic?.(); 
                                    await triggerRefresh(); 
                                    showToast?.('Datos actualizados', 'success');
                                }}
                                disabled={syncLoading}
                                className="p-2 rounded-xl text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-emerald-400 transition-colors disabled:opacity-50 cursor-pointer"
                                title="Actualizar Datos"
                            >
                                <RefreshCw size={15} className={syncLoading ? "animate-spin text-emerald-500" : ""} />
                            </button>

                            <button 
                                onClick={() => { triggerHaptic?.(); setShowRateModal(true); }}
                                className="p-2 rounded-xl text-slate-400 hover:text-brand hover:bg-brand-light border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-brand transition-colors cursor-pointer"
                                title="Cambiar Tasa Remota"
                            >
                                <TrendingUp size={15} />
                            </button>

                            <button 
                                onClick={() => { triggerHaptic?.(); setShowUsersModal(true); }}
                                className="p-2 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-blue-400 transition-colors flex items-center gap-1.5 cursor-pointer"
                                title="Gestión de Usuarios, Roles y PINs"
                            >
                                <Users size={15} />
                                <span className="hidden lg:inline text-xs font-black text-slate-600 dark:text-slate-300">Usuarios</span>
                            </button>

                            <button 
                                onClick={() => { triggerHaptic?.(); setShowPairingModal(true); }}
                                className="px-2.5 py-2 rounded-xl text-emerald-600 dark:text-emerald-400 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 dark:border-emerald-800/60 dark:bg-emerald-950/30 transition-colors flex items-center gap-1.5 cursor-pointer"
                                title="Vincular Celular u otro equipo Supervisor"
                            >
                                <QrCode size={15} />
                                <span className="hidden lg:inline text-xs font-black text-emerald-700 dark:text-emerald-300">+ Vincular Celular</span>
                            </button>

                            <button 
                                onClick={() => { triggerHaptic?.(); setShowDisconnectConfirm(true); }}
                                className="p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-rose-400 transition-colors cursor-pointer"
                                title="Desvincular Dispositivo"
                            >
                                <LogOut size={15} />
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Banner Offline */}
            {!isConnected && lastSync && (
                <div className="mx-4 mt-4 p-3.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 rounded-2xl flex gap-3 items-center text-amber-800 dark:text-amber-400 shadow-sm animate-fade-in">
                    <Clock size={18} className="shrink-0" />
                    <p className="text-xs font-semibold leading-relaxed">
                        Sin conexión a internet. Mostrando últimos datos sincronizados el {lastSync.toLocaleDateString()} a las {lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                    </p>
                </div>
            )}

            {/* Contenido Principal */}
            <main className="max-w-7xl mx-auto px-4 mt-6 space-y-6">
                {/* Selector de Pestañas (100% Responsivo) */}
                <div className="bg-slate-200/60 dark:bg-slate-900/60 p-1 rounded-2xl w-full sm:max-w-xl shadow-sm">
                    <div className="grid grid-cols-4 gap-1">
                        <button
                            onClick={() => { triggerHaptic?.(); setViewTab('activo'); }}
                            className={`py-2 px-1 text-center font-black rounded-xl transition-all text-[11px] sm:text-xs truncate ${
                                viewTab === 'activo' 
                                    ? 'bg-white dark:bg-slate-800 text-slate-850 dark:text-white shadow-sm' 
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                            }`}
                        >
                            <span className="sm:hidden">Turno</span>
                            <span className="hidden sm:inline">Turno Activo</span>
                        </button>
                        <button
                            onClick={() => { triggerHaptic?.(); setViewTab('cierres'); }}
                            className={`py-2 px-1 text-center font-black rounded-xl transition-all text-[11px] sm:text-xs truncate ${
                                viewTab === 'cierres' 
                                    ? 'bg-white dark:bg-slate-800 text-slate-850 dark:text-white shadow-sm' 
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                            }`}
                        >
                            <span className="sm:hidden">Cierres</span>
                            <span className="hidden sm:inline">Cierres</span>
                        </button>
                        <button
                            onClick={() => { triggerHaptic?.(); setViewTab('inventario'); }}
                            className={`py-2 px-1 text-center font-black rounded-xl transition-all text-[11px] sm:text-xs truncate ${
                                viewTab === 'inventario' 
                                    ? 'bg-white dark:bg-slate-800 text-slate-850 dark:text-white shadow-sm' 
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                            }`}
                        >
                            Inventario
                        </button>
                        <button
                            onClick={() => { triggerHaptic?.(); setViewTab('cambios'); }}
                            className={`relative py-2 px-1 text-center font-black rounded-xl transition-all text-[11px] sm:text-xs truncate ${
                                viewTab === 'cambios' 
                                    ? 'bg-white dark:bg-slate-800 text-slate-850 dark:text-white shadow-sm' 
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                            }`}
                        >
                            Cambios
                            {(pendingChanges.length > 0 || cloudPendingCmds.length > 0) && (
                                <span className="ml-1 px-1.5 py-0.2 rounded-full bg-amber-500 text-white text-[9px] font-black tabular-nums animate-pulse">
                                    {pendingChanges.length + cloudPendingCmds.length}
                                </span>
                            )}
                        </button>
                    </div>
                </div>

                {/* ── SECCIÓN 1: TURNO ACTIVO ── */}
                {viewTab === 'activo' && (
                    <div className="space-y-6">
                        {/* Banner de Estado de Apertura del Turno */}
                        <div className={`p-4 rounded-3xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm ${
                            shiftStatusInfo.isOpen
                                ? 'bg-emerald-50/90 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40 text-emerald-900 dark:text-emerald-300'
                                : 'bg-slate-100/90 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800/60 text-slate-700 dark:text-slate-300'
                        }`}>
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black shrink-0 ${
                                    shiftStatusInfo.isOpen
                                        ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                                        : 'bg-slate-400 text-white'
                                }`}>
                                    <Clock size={20} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h4 className="font-black text-sm sm:text-base">
                                            {shiftStatusInfo.isOpen ? 'Turno Activo en Curso' : 'Caja Actualmente Cerrada'}
                                        </h4>
                                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                                            shiftStatusInfo.isOpen
                                                ? 'bg-emerald-200/70 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300'
                                                : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                        }`}>
                                            {shiftStatusInfo.isOpen ? 'Abierta' : 'Cerrada'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
                                        {shiftStatusInfo.isOpen
                                            ? `Apertura realizada a las ${shiftStatusInfo.formattedTime} (${shiftStatusInfo.elapsedLabel})`
                                            : 'No hay un turno de ventas activo en este momento.'}
                                    </p>
                                </div>
                            </div>
                            {activeCashier?.nombre && activeCashier.nombre !== 'Ninguno' && (
                                <div className="text-left sm:text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-200/60 dark:border-slate-800">
                                    <span className="text-[9.5px] font-black uppercase text-slate-400 block">Cajero en Turno</span>
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{activeCashier.nombre}</span>
                                </div>
                            )}
                        </div>

                        {/* Fila 1: Tarjetas de Métricas de Turno Activo */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                            {/* Ventas Turno USD */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px]">
                                <div className="flex items-center justify-between w-full">
                                    <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Vendido Turno (USD)</span>
                                    <div className="w-7 h-7 sm:w-9 sm:h-9 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl flex items-center justify-center text-emerald-500 shrink-0">
                                        <DollarSign size={16} />
                                    </div>
                                </div>
                                <div className="mt-2.5 min-w-0">
                                    <span className="font-outfit text-base sm:text-xl lg:text-2xl font-black text-slate-800 dark:text-white tabular-nums block break-words leading-none">
                                        ${activeShiftMetrics.totalUsd.toFixed(2)}
                                    </span>
                                </div>
                            </div>

                            {/* Ventas Turno Bs */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px]">
                                <div className="flex items-center justify-between w-full">
                                    <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Vendido Turno (Bs)</span>
                                    <div className="w-7 h-7 sm:w-9 sm:h-9 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl flex items-center justify-center text-emerald-500 shrink-0">
                                        <Coins size={16} />
                                    </div>
                                </div>
                                <div className="mt-2.5 min-w-0">
                                    <span className="font-outfit text-base sm:text-xl lg:text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums block break-words leading-none">
                                        {formatBs(activeShiftMetrics.totalBs)} Bs
                                    </span>
                                    <span className="text-[9px] text-slate-400 block font-medium mt-1">
                                        Tasa: {bcvRate ? `${bcvRate.toFixed(2)} Bs/$` : 'N/D'}
                                    </span>
                                </div>
                            </div>

                            {/* Margen Estimado Turno */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px]">
                                <div className="flex items-center justify-between w-full">
                                    <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Ganancia Turno</span>
                                    <div className="w-7 h-7 sm:w-9 sm:h-9 bg-blue-50 dark:bg-blue-950/20 rounded-xl flex items-center justify-center text-blue-500 shrink-0">
                                        <TrendingUp size={16} />
                                    </div>
                                </div>
                                <div className="mt-2.5 min-w-0">
                                    <span className="font-outfit text-base sm:text-xl lg:text-2xl font-black text-blue-600 dark:text-blue-400 tabular-nums block break-words leading-none">
                                        ${activeShiftMetrics.profitUsd.toFixed(2)}
                                    </span>
                                </div>
                            </div>

                            {/* Cajero Activo */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px]">
                                <div className="flex items-center justify-between w-full">
                                    <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Cajero de Turno</span>
                                    <div className="w-7 h-7 sm:w-9 sm:h-9 bg-slate-50 dark:bg-slate-800/50 rounded-xl flex items-center justify-center text-slate-450 shrink-0">
                                        <Users size={16} />
                                    </div>
                                </div>
                                <div className="mt-2.5 min-w-0">
                                    <span className="text-sm sm:text-base lg:text-lg font-black text-slate-800 dark:text-white block truncate leading-none">
                                        {isShiftActive ? (
                                            activeCashier.nombre !== 'Ninguno' 
                                                ? activeCashier.nombre 
                                                : (activeShiftSales.find(s => s.cajero || s.usuarioNombre || s.usuario)?.cajero || activeShiftApertura?.cajero || 'Cajero General')
                                        ) : 'Ninguno'}
                                    </span>
                                    <span className="text-[9px] text-slate-400 block font-medium mt-1">
                                        {activeShiftMetrics.count} {activeShiftMetrics.count === 1 ? 'venta' : 'ventas'} en curso
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Si la caja no está activa */}
                        {!isShiftActive ? (
                            <div className="py-16 px-6 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm space-y-4 max-w-lg mx-auto flex flex-col items-center">
                                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 text-slate-450 rounded-full">
                                    <Clock size={42} />
                                </div>
                                <div className="space-y-1">
                                    <h4 className="text-sm font-black text-slate-800 dark:text-white">Caja Cerrada / Turno Inactivo</h4>
                                    <p className="text-xs text-slate-400 leading-relaxed px-4">
                                        No hay un turno de caja activo en este momento. Abre la caja en el dispositivo del punto de venta para comenzar a registrar movimientos en vivo.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {/* Desglose Diario por Método de Pago */}
                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm overflow-hidden">
                                    <div className="p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800/80">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                                                <Wallet size={18} className="text-violet-500" />
                                                Ingresos del Turno Activo
                                            </h3>
                                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl">
                                                En Curso
                                            </span>
                                        </div>
                                    </div>

                                    <div className="p-5 sm:p-6">
                                        {/* Apertura de caja */}
                                        <div className="mb-5 p-4 bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800/50 rounded-2xl">
                                            <div className="flex items-center gap-2 mb-3">
                                                <div className="w-7 h-7 bg-amber-100 dark:bg-amber-950/30 rounded-lg flex items-center justify-center">
                                                    <ArrowDownRight size={14} className="text-amber-600 dark:text-amber-400" />
                                                </div>
                                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Fondo de Apertura de Turno</span>
                                            </div>
                                            {activeShiftApertura ? (
                                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                                                    <div className="space-y-0.5">
                                                        <span className="text-[9px] font-bold text-slate-400 uppercase block">USD Inicial</span>
                                                        <span className="font-outfit text-sm font-black text-slate-700 dark:text-slate-200 tabular-nums">${(activeShiftApertura.openingUsd || 0).toFixed(2)}</span>
                                                    </div>
                                                    <div className="space-y-0.5">
                                                        <span className="text-[9px] font-bold text-slate-400 uppercase block">Bs Inicial</span>
                                                        <span className="font-outfit text-sm font-black text-slate-700 dark:text-slate-200 tabular-nums">{formatBs(activeShiftApertura.openingBs || 0)} Bs</span>
                                                    </div>
                                                    {activeShiftApertura.openingCop > 0 && (
                                                        <div className="space-y-0.5">
                                                            <span className="text-[9px] font-bold text-slate-400 uppercase block">COP Inicial</span>
                                                            <span className="font-outfit text-sm font-black text-slate-700 dark:text-slate-200 tabular-nums">{(activeShiftApertura.openingCop || 0).toLocaleString()} COP</span>
                                                        </div>
                                                    )}
                                                    <div className="space-y-0.5 col-span-2 sm:col-span-3">
                                                        <span className="text-[9px] font-bold text-slate-400 uppercase block">Hora de apertura</span>
                                                        <span className="text-xs font-bold text-slate-500">{formatTime(activeShiftApertura.timestamp)}</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <p className="text-xs text-slate-400 font-bold">Caja iniciada sin fondo declarado.</p>
                                            )}
                                        </div>

                                        {/* Tabla desglose */}
                                        {activeShiftPaymentBreakdown.length === 0 ? (
                                            <div className="py-8 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                                                <Wallet size={28} className="mx-auto text-slate-300 mb-2" />
                                                <p className="text-xs font-black">Sin transacciones registradas</p>
                                                <p className="text-[10px] text-slate-450 mt-1">El desglose por método de pago aparecerá aquí.</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-2.5">
                                                {activeShiftPaymentBreakdown.map(([methodId, data]) => {
                                                    const IconComp = getMethodIcon(methodId);
                                                    const pct = activeShiftMetrics.totalUsd > 0 && !data.isChange 
                                                        ? Math.round((data.totalUsd / activeShiftMetrics.totalUsd) * 100) 
                                                        : 0;

                                                    const isChangeRow = data.isChange;

                                                    return (
                                                        <div 
                                                            key={methodId} 
                                                            className={`flex items-center gap-3 p-3.5 rounded-2xl border transition-colors ${
                                                                isChangeRow 
                                                                    ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200/70 dark:border-amber-800/40' 
                                                                    : 'bg-slate-50/70 dark:bg-slate-800/20 border-slate-100 dark:border-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-800/30'
                                                            }`}
                                                        >
                                                            <div className={`w-9 h-9 border rounded-xl flex items-center justify-center shrink-0 shadow-sm ${
                                                                isChangeRow 
                                                                    ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400' 
                                                                    : 'bg-white dark:bg-slate-800 border-slate-200/60 dark:border-slate-700/60 text-slate-500 dark:text-slate-400'
                                                            }`}>
                                                                <IconComp size={16} />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className={`text-xs font-black truncate ${isChangeRow ? 'text-amber-800 dark:text-amber-300' : 'text-slate-700 dark:text-slate-200'}`}>
                                                                        {data.label}
                                                                    </span>
                                                                    <span className={`font-outfit text-xs font-black tabular-nums shrink-0 ${isChangeRow ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-white'}`}>
                                                                        {isChangeRow ? '− ' : ''}${data.totalUsd.toFixed(2)}
                                                                    </span>
                                                                </div>
                                                                <div className="flex items-center justify-between gap-2 mt-1">
                                                                    <div className="flex items-center gap-2">
                                                                        {data.count > 0 ? (
                                                                            <span className="text-[9px] font-bold text-slate-400">{data.count} {data.count === 1 ? 'transacción' : 'transacciones'}</span>
                                                                        ) : (
                                                                            <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Vuelto Otorgado</span>
                                                                        )}
                                                                        {!isChangeRow && <span className="text-[9px] font-black text-violet-500 bg-violet-50 dark:bg-violet-950/20 dark:text-violet-400 px-1.5 py-0.5 rounded-md">{pct}%</span>}
                                                                    </div>
                                                                    <span className={`font-outfit text-[10px] font-bold tabular-nums ${isChangeRow ? 'text-amber-600/80 dark:text-amber-400/80' : 'text-slate-400'}`}>
                                                                        {isChangeRow ? '− ' : ''}{formatBs(data.totalBs)} Bs
                                                                    </span>
                                                                </div>
                                                                {!isChangeRow && (
                                                                    <div className="mt-1.5 h-1 bg-slate-200/60 dark:bg-slate-800 rounded-full overflow-hidden">
                                                                        <div 
                                                                            className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all duration-500" 
                                                                            style={{ width: `${Math.max(2, pct)}%` }} 
                                                                        />
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}

                                                {/* Resumen total */}
                                                <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-800 flex items-center justify-between px-1">
                                                    <div className="flex items-center gap-2">
                                                        <Hash size={14} className="text-slate-400" />
                                                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                                            Total Acumulado ({activeShiftMetrics.count} {activeShiftMetrics.count === 1 ? 'venta' : 'ventas'})
                                                        </span>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="font-outfit text-sm font-black text-slate-850 dark:text-white tabular-nums">${activeShiftMetrics.totalUsd.toFixed(2)}</span>
                                                        <span className="font-outfit text-[10px] font-bold text-slate-400 ml-2">{formatBs(activeShiftMetrics.totalBs)} Bs</span>
                                                    </div>
                                                </div>

                                                {/* Ticket promedio */}
                                                <div className="flex items-center justify-between px-1 mt-1">
                                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Ticket Promedio</span>
                                                    <span className="font-outfit text-xs font-black text-blue-650 dark:text-blue-400 tabular-nums">${activeShiftAvgTicket.toFixed(2)}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Dashboard de Columnas */}
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                    {/* Columna Izquierda: Listado de Ventas en Vivo */}
                                    <div className="lg:col-span-2 space-y-4">
                                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-6 shadow-sm">
                                            <h3 className="text-sm font-black text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                                <FileText size={18} className="text-slate-400" />
                                                Ventas del Turno en Tiempo Real
                                            </h3>
                                            
                                            {loadingData || syncLoading ? (
                                                <div className="py-8 flex justify-center text-slate-400 gap-2 items-center">
                                                    <RefreshCw className="animate-spin" size={18} />
                                                    <span className="text-xs font-bold">Cargando transacciones...</span>
                                                </div>
                                            ) : activeShiftSales.length === 0 ? (
                                                <div className="py-12 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                                                    <Clock size={36} className="mx-auto text-slate-350 dark:text-slate-700 mb-2" />
                                                    <p className="text-xs font-black">No se han registrado ventas en este turno</p>
                                                    <p className="text-[10px] text-slate-400 mt-1">Las ventas de la caja activa aparecerán aquí al instante.</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-3 max-h-[550px] overflow-y-auto pr-1">
                                                    {activeShiftSales.map(sale => (
                                                        <div 
                                                            key={sale.id}
                                                            onClick={() => { triggerHaptic?.(); setSelectedSaleDetail(sale); }}
                                                            className="p-3.5 sm:p-4 border border-slate-100 dark:border-slate-800/80 hover:border-emerald-400/80 dark:hover:border-emerald-600/60 rounded-2xl bg-slate-50/50 dark:bg-slate-800/20 hover:bg-white dark:hover:bg-slate-800/50 flex flex-col sm:flex-row justify-between items-start gap-2.5 transition-all duration-200 cursor-pointer active:scale-[0.99] shadow-sm hover:shadow-md group"
                                                        >
                                                            <div className="space-y-1.5 min-w-0 flex-1 w-full">
                                                                <div className="flex items-center justify-between sm:justify-start gap-2">
                                                                    {sale.status === 'ANULADA' ? (
                                                                        <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-200/60 dark:border-rose-900/60 flex items-center gap-1">
                                                                            <AlertTriangle size={10} /> {getFormattedSaleCode(sale)} • ANULADA
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400">
                                                                            {getFormattedSaleCode(sale)}
                                                                        </span>
                                                                    )}
                                                                    <span className="text-[10px] text-slate-400 font-bold">{formatTime(sale.timestamp)}</span>
                                                                    <div className="sm:hidden text-right">
                                                                        <span className="font-outfit text-sm font-black text-slate-800 dark:text-white">${(sale.totalUsd || 0).toFixed(2)}</span>
                                                                    </div>
                                                                </div>
                                                                <p className="text-xs font-black text-slate-800 dark:text-slate-100 leading-snug break-words pr-1">
                                                                    {sale.items?.map(i => `${i.name} (x${i.qty})`).join(', ') || 'Venta de productos'}
                                                                </p>
                                                                <div className="flex items-center justify-between pt-1">
                                                                    <div className="flex gap-2 items-center flex-wrap">
                                                                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${getPaymentBadgeStyle(sale)}`}>
                                                                            {getFormattedPaymentMethod(sale)}
                                                                        </span>
                                                                        {sale.clientName && (
                                                                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">• {sale.clientName}</span>
                                                                        )}
                                                                    </div>
                                                                    <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                                                                        Ver detalle <ChevronRight size={12} />
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <div className="hidden sm:block text-right space-y-0.5 shrink-0">
                                                                <span className="font-outfit text-sm font-black text-slate-800 dark:text-white block">${(sale.totalUsd || 0).toFixed(2)}</span>
                                                                <span className="font-outfit text-[10px] font-bold text-slate-400 block">{formatBs(sale.totalBs || 0)} Bs</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Columna Derecha: Stock Crítico */}
                                    <div className="space-y-6">
                                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-6 shadow-sm">
                                            <h3 className="text-sm font-black text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                                <Package size={18} className="text-rose-500" />
                                                Stock Crítico (Agotados)
                                            </h3>

                                            {criticalProducts.length === 0 ? (
                                                <div className="py-6 text-center text-slate-400">
                                                    <p className="text-xs font-black text-emerald-600">¡Todo en orden!</p>
                                                    <p className="text-[10px] text-slate-400 mt-0.5">No hay productos sin inventario.</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-3">
                                                    {criticalProducts.map(prod => (
                                                        <div key={prod.id} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                                                            <div className="min-w-0 pr-2">
                                                                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block truncate">{prod.name}</span>
                                                                <span className="font-outfit text-[10px] text-slate-400">Precio: ${(prod.priceUsd ?? prod.price ?? 0).toFixed(2)}</span>
                                                            </div>
                                                            <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-rose-50 dark:bg-rose-950/20 text-rose-600 shrink-0">
                                                                Agotado
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ── SECCIÓN 2: CIERRES DE CAJA (HISTORIAL + DETALLE ARQUEO) ── */}
                {viewTab === 'cierres' && (
                    <div>
                        {registerCloses.length === 0 ? (
                            <div className="py-16 px-6 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm space-y-4 max-w-lg mx-auto flex flex-col items-center">
                                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 text-slate-450 rounded-full">
                                    <ShieldCheck size={42} />
                                </div>
                                <div className="space-y-1">
                                    <h4 className="text-sm font-black text-slate-800 dark:text-white">Sin cierres registrados</h4>
                                    <p className="text-xs text-slate-400 leading-relaxed px-4">
                                        Cuando el cajero complete un cierre de caja en el dispositivo principal, aparecerá el arqueo detallado, reporte contable y discrepancias aquí.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* Selector / Lista de Cierres */}
                                <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-3xl p-5 shadow-sm h-fit space-y-4">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Historial de Cierres</span>
                                    <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                                        {registerCloses.map(c => {
                                            const dateObj = new Date(c.cierreId);
                                            const isSelected = selectedCierreId === c.cierreId || (!selectedCierreId && registerCloses[0].cierreId === c.cierreId);
                                            return (
                                                <button
                                                    key={c.cierreId}
                                                    onClick={() => setSelectedCierreId(c.cierreId)}
                                                    className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                                                        isSelected 
                                                            ? 'bg-emerald-500/10 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-400' 
                                                            : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/40 dark:hover:bg-slate-800/80 border-slate-200/65 dark:border-slate-800/60 text-slate-600 dark:text-slate-300'
                                                    }`}
                                                >
                                                    <div className="min-w-0 flex-1">
                                                        <span className="text-xs font-black block truncate">
                                                            Cierre #{c.cierreNumber || String(c.cierreId).slice(-4)}
                                                        </span>
                                                        <span className="text-[9px] text-slate-400 font-bold block mt-0.5">
                                                            {dateObj.toLocaleDateString()} • {dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                    <span className="font-outfit text-xs font-black tabular-nums shrink-0">${c.totalUsd.toFixed(2)}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Zona de Resumen del Cierre Seleccionado */}
                                <div className="lg:col-span-2 space-y-6">
                                    {(() => {
                                        const activeC = registerCloses.find(c => c.cierreId === selectedCierreId) || registerCloses[0];
                                        if (!activeC) return null;

                                        const expectedUsd = activeC.reconData?.expectedUsd ?? activeC.totalUsd;
                                        // Declarados
                                        const declaredUsd = activeC.reconData?.cashUsd ?? null;
                                        const declaredBs = activeC.reconData?.cashBs ?? null;
                                        const declaredCop = activeC.reconData?.cashCop ?? null;
                                        
                                        const diffUsd = declaredUsd !== null ? declaredUsd - expectedUsd : null;
                                        const isCuadrado = declaredUsd === null || Math.abs(diffUsd) <= 0.50;

                                        return (
                                            <div className="space-y-6 animate-fade-in">
                                                {/* Resumen Principal */}
                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                                        <span className="text-[9px] font-black uppercase text-slate-400">Total USD</span>
                                                        <strong className="font-outfit text-base sm:text-lg font-black text-slate-800 dark:text-white block mt-1">${activeC.totalUsd.toFixed(2)}</strong>
                                                    </div>
                                                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                                        <span className="text-[9px] font-black uppercase text-slate-400">Total Bs</span>
                                                        <strong className="font-outfit text-base sm:text-lg font-black text-emerald-600 dark:text-emerald-400 block mt-1">{formatBs(activeC.totalBs)} Bs</strong>
                                                    </div>
                                                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                                        <span className="text-[9px] font-black uppercase text-slate-400">Cajero</span>
                                                        <strong className="text-xs font-black text-slate-700 dark:text-slate-200 block truncate mt-1">{activeC.cashier?.nombre || 'Cajero'}</strong>
                                                    </div>
                                                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                                        <span className="text-[9px] font-black uppercase text-slate-400">Arqueo Físico</span>
                                                        <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md inline-block mt-1 ${
                                                            declaredUsd === null 
                                                                ? 'bg-slate-100 dark:bg-slate-800 text-slate-500' 
                                                                : isCuadrado 
                                                                    ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400' 
                                                                    : 'bg-amber-100 dark:bg-amber-955/30 text-amber-700 dark:text-amber-400 animate-pulse'
                                                        }`}>
                                                            {declaredUsd === null ? 'Sin Declarar' : isCuadrado ? 'Cuadrado' : 'Diferencia'}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Arqueo Detallado de Efectivo */}
                                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-5 shadow-sm">
                                                    <h3 className="text-xs font-black text-slate-800 dark:text-white mb-4 uppercase tracking-wider">Cuadre de Efectivo</h3>
                                                    
                                                    {declaredUsd === null ? (
                                                        <div className="py-6 px-4 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-100 dark:border-amber-900/30 rounded-2xl text-center">
                                                            <AlertTriangle size={24} className="text-amber-500 mx-auto mb-1.5" />
                                                            <p className="text-xs font-black text-amber-800 dark:text-amber-400">Cierre simplificado sin arqueo</p>
                                                            <p className="text-[10px] text-slate-500 mt-0.5">El cajero completó el cierre de caja sin declarar el saldo físico.</p>
                                                        </div>
                                                    ) : (
                                                        <div className="border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden text-xs">
                                                            <div className="grid grid-cols-4 gap-2 px-4 py-2 bg-slate-50 dark:bg-slate-850/50 text-[10px] font-black text-slate-400 uppercase border-b border-slate-150 dark:border-slate-800">
                                                                <span>Moneda</span>
                                                                <span className="text-center">Esperado</span>
                                                                <span className="text-center">Declarado</span>
                                                                <span className="text-right">Diferencia</span>
                                                            </div>

                                                            {/* USD Row */}
                                                            <div className="grid grid-cols-4 gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800 items-center">
                                                                <span className="font-bold text-slate-700 dark:text-slate-200">Dólares ($)</span>
                                                                <span className="font-outfit font-mono text-slate-400 text-center">${expectedUsd.toFixed(2)}</span>
                                                                <span className="font-outfit font-mono font-black text-slate-700 dark:text-white text-center">${declaredUsd.toFixed(2)}</span>
                                                                <span className={`font-outfit font-mono font-black text-right ${
                                                                    diffUsd === 0 ? 'text-slate-400' : diffUsd > 0 ? 'text-emerald-600' : 'text-rose-600'
                                                                }`}>
                                                                    {diffUsd > 0 ? '+' : ''}{diffUsd.toFixed(2)}
                                                                </span>
                                                            </div>

                                                            {/* Bs Row */}
                                                            <div className="grid grid-cols-4 gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800 items-center">
                                                                <span className="font-bold text-slate-700 dark:text-slate-200">Bolívares (Bs)</span>
                                                                <span className="font-outfit font-mono text-slate-400 text-center">{formatBs(activeC.reconData?.expectedBs || 0)}</span>
                                                                <span className="font-outfit font-mono font-black text-slate-700 dark:text-white text-center">{formatBs(declaredBs)}</span>
                                                                <span className={`font-outfit font-mono font-black text-right ${
                                                                    (declaredBs - (activeC.reconData?.expectedBs || 0)) === 0 
                                                                        ? 'text-slate-400' 
                                                                        : (declaredBs - (activeC.reconData?.expectedBs || 0)) > 0 
                                                                            ? 'text-emerald-600' 
                                                                            : 'text-rose-600'
                                                                }`}>
                                                                    {(declaredBs - (activeC.reconData?.expectedBs || 0)) > 0 ? '+' : ''}
                                                                    {formatBs(declaredBs - (activeC.reconData?.expectedBs || 0))}
                                                                </span>
                                                            </div>

                                                            {/* COP Row si aplica */}
                                                            {activeC.reconData?.expectedCop > 0 && (
                                                                <div className="grid grid-cols-4 gap-2 px-4 py-3 items-center">
                                                                    <span className="font-bold text-slate-700 dark:text-slate-200">Pesos (COP)</span>
                                                                    <span className="font-outfit font-mono text-slate-400 text-center">{(activeC.reconData.expectedCop).toLocaleString()}</span>
                                                                    <span className="font-outfit font-mono font-black text-slate-700 dark:text-white text-center">{(declaredCop).toLocaleString()}</span>
                                                                    <span className={`font-outfit font-mono font-black text-right ${
                                                                        (declaredCop - activeC.reconData.expectedCop) === 0 
                                                                            ? 'text-slate-400' 
                                                                            : (declaredCop - activeC.reconData.expectedCop) > 0 
                                                                                ? 'text-emerald-600' 
                                                                                : 'text-rose-600'
                                                                    }`}>
                                                                        {(declaredCop - activeC.reconData.expectedCop) > 0 ? '+' : ''}
                                                                        {(declaredCop - activeC.reconData.expectedCop).toLocaleString()}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Desglose de Métodos de Pago */}
                                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-5 shadow-sm">
                                                    <h3 className="text-xs font-black text-slate-800 dark:text-white mb-4 uppercase tracking-wider">Desglose de Ingresos</h3>
                                                    <div className="space-y-2.5">
                                                        {activeC.paymentBreakdown.map(([methodId, data]) => {
                                                            const IconComp = getMethodIcon(methodId);
                                                            const pct = activeC.totalUsd > 0 ? Math.round((data.totalUsd / activeC.totalUsd) * 100) : 0;
                                                            return (
                                                                <div key={methodId} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800 rounded-2xl">
                                                                    <div className="w-8 h-8 bg-white dark:bg-slate-800 border border-slate-150 dark:border-slate-700 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
                                                                        <IconComp size={14} />
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="flex items-center justify-between text-xs">
                                                                            <span className="font-black text-slate-700 dark:text-slate-200">{data.label}</span>
                                                                            <span className="font-outfit font-black text-slate-800 dark:text-white">${data.totalUsd.toFixed(2)}</span>
                                                                        </div>
                                                                        <div className="flex items-center justify-between text-[10px] text-slate-400 mt-0.5">
                                                                            <span>{data.count} tx • {pct}%</span>
                                                                            <span className="font-outfit">{formatBs(data.totalBs)} Bs</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>

                                                {/* Ventas del Cierre */}
                                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-6 shadow-sm">
                                                    <h3 className="text-xs font-black text-slate-800 dark:text-white mb-4 uppercase tracking-wider">Ventas Cerradas en este Turno</h3>
                                                    <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                                                        {activeC.sales.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map(sale => (
                                                            <div 
                                                                key={sale.id}
                                                                onClick={() => { triggerHaptic?.(); setSelectedSaleDetail(sale); }}
                                                                className="p-3.5 border border-slate-100 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-800/20 hover:bg-white dark:hover:bg-slate-800/50 flex flex-col sm:flex-row justify-between items-start gap-2.5 transition-all duration-200 cursor-pointer active:scale-[0.99] shadow-sm hover:shadow-md group"
                                                            >
                                                                <div className="min-w-0 flex-1 w-full space-y-1">
                                                                    <div className="flex items-center justify-between sm:justify-start gap-2">
                                                                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/40">
                                                                            {getFormattedSaleCode(sale)}
                                                                        </span>
                                                                        <span className="text-[9px] text-slate-400 font-bold">{formatTime(sale.timestamp)}</span>
                                                                        <div className="sm:hidden text-right">
                                                                            <span className="font-outfit font-black text-slate-850 dark:text-white">${(sale.totalUsd || 0).toFixed(2)}</span>
                                                                        </div>
                                                                    </div>
                                                                    <p className="font-black text-slate-800 dark:text-slate-100 leading-snug break-words pr-1 text-xs">
                                                                        {sale.items?.map(i => `${i.name} (x${i.qty})`).join(', ') || 'Venta de productos'}
                                                                    </p>
                                                                    <div className="flex items-center justify-between pt-1">
                                                                        <div className="flex gap-2 items-center flex-wrap">
                                                                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md ${getPaymentBadgeStyle(sale)}`}>
                                                                                {getFormattedPaymentMethod(sale)}
                                                                            </span>
                                                                            {sale.clientName && (
                                                                                <span className="text-[9px] text-slate-500 dark:text-slate-400 font-bold">• {sale.clientName}</span>
                                                                            )}
                                                                        </div>
                                                                        <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                                                                            Ver detalle <ChevronRight size={11} />
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                                <div className="hidden sm:block text-right shrink-0 space-y-0.5">
                                                                    <span className="font-outfit font-black text-slate-850 dark:text-white block">${(sale.totalUsd || 0).toFixed(2)}</span>
                                                                    <span className="font-outfit text-[9px] text-slate-400 block">{formatBs(sale.totalBs || 0)} Bs</span>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ── SECCIÓN 3: INVENTARIO EN TIEMPO REAL ── */}
                {viewTab === 'inventario' && (
                    <div className="space-y-6 animate-fade-in">
                        {/* Fila de Resumen de Inventario */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                            {/* Total Productos */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Total Artículos</span>
                                <div className="flex items-end justify-between mt-1">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-slate-800 dark:text-white tabular-nums leading-none">
                                        {inventoryMetrics.count}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-bold">{inventoryMetrics.totalQty} unds</span>
                                </div>
                            </div>

                            {/* Valorización Costo */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Valor Inventario (Costo)</span>
                                <div className="flex items-end justify-between mt-1">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-slate-800 dark:text-white tabular-nums leading-none">
                                        ${inventoryMetrics.totalCost.toFixed(2)}
                                    </span>
                                </div>
                            </div>

                            {/* Valorización Venta */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Valor Estimado (Venta)</span>
                                <div className="flex items-end justify-between mt-1">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-slate-800 dark:text-white tabular-nums leading-none">
                                        ${inventoryMetrics.totalRetail.toFixed(2)}
                                    </span>
                                </div>
                            </div>

                            {/* Ganancia Potencial */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Ganancia en Stock</span>
                                <div className="flex items-end justify-between mt-1">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-blue-600 dark:text-blue-400 tabular-nums leading-none">
                                        ${inventoryMetrics.expectedProfit.toFixed(2)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Banner de Comandos Subidos Pendientes de Aplicar por la Caja */}
                        {cloudPendingCmds.length > 0 && (
                            <div className="bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-purple-500/10 border border-amber-300/70 dark:border-amber-700/60 p-3.5 sm:p-4 rounded-3xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-xs animate-fade-in">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-black shrink-0">
                                        <Clock size={20} className="animate-pulse" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h4 className="text-xs sm:text-sm font-black text-slate-800 dark:text-white">
                                                {cloudPendingCmds.length} cambio{cloudPendingCmds.length !== 1 ? 's' : ''} subido{cloudPendingCmds.length !== 1 ? 's' : ''} a la nube
                                            </h4>
                                            <span className="text-[9.5px] font-black uppercase px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200">
                                                En espera de la caja
                                            </span>
                                        </div>
                                        <p className="text-[10.5px] text-slate-500 dark:text-slate-400 font-medium mt-0.5 truncate">
                                            Se aplicarán automáticamente apenas la caja principal se conecte. Puedes anularlos si lo deseas.
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        onClick={() => { triggerHaptic?.(); setShowCloudPendingModal(true); }}
                                        className="flex-1 sm:flex-none px-3.5 py-2.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-black text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-2xs cursor-pointer"
                                    >
                                        Ver lista ({cloudPendingCmds.length})
                                    </button>
                                    <button
                                        onClick={() => { triggerHaptic?.(); cancelAllCloudCmds(); }}
                                        className="flex-1 sm:flex-none px-3.5 py-2.5 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-black uppercase tracking-wider shadow-md shadow-rose-500/25 transition-all active:scale-95 cursor-pointer"
                                    >
                                        Anular Todos 🚫
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Barra de Filtro y Búsqueda */}
                        <div className="bg-white dark:bg-slate-900 p-3.5 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col md:flex-row gap-3 sm:gap-4 items-stretch md:items-center justify-between">
                            {/* Top row on mobile: Botones de Acción (Producto / Combo) + Input de Búsqueda */}
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        onClick={() => { triggerHaptic?.(); setRemoteEditingProduct(null); setShowRemoteForm(true); }}
                                        className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2.5 rounded-2xl bg-brand hover:bg-brand-dark text-white text-[10px] sm:text-xs font-black uppercase tracking-wider shadow-md shadow-brand/20 transition-all active:scale-95 cursor-pointer"
                                        title="Crear un nuevo producto individual"
                                    >
                                        <Plus size={14} strokeWidth={3} /> Producto
                                    </button>
                                    <button
                                        onClick={() => { triggerHaptic?.(); setEditingCombo(null); setShowComboModal(true); }}
                                        className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2.5 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-[10px] sm:text-xs font-black uppercase tracking-wider shadow-md shadow-purple-500/25 transition-all active:scale-95 cursor-pointer"
                                        title="Crear un nuevo combo promocional o modular"
                                    >
                                        <Sparkles size={14} /> Combo
                                    </button>
                                </div>
                                {/* Input de Búsqueda */}
                                <div className="relative flex-1">
                                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-450">
                                        <Search size={14} />
                                    </span>
                                    <input
                                        type="text"
                                        placeholder="Buscar producto por nombre o código..."
                                        value={searchTermInventario}
                                        onChange={(e) => setSearchTermInventario(e.target.value)}
                                        className="w-full pl-10 pr-8 py-2.5 text-xs rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500/70 transition-colors"
                                    />
                                    {searchTermInventario && (
                                        <button 
                                            onClick={() => setSearchTermInventario('')}
                                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-650"
                                        >
                                            <X size={14} />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Filtro de Segmentación de Stock - Scrollable horizontalmente en móvil */}
                            <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-2xl border border-slate-200/60 dark:border-slate-850 overflow-x-auto w-full md:w-auto shrink-0 shadow-inner custom-scrollbar">
                                <button
                                    onClick={() => { triggerHaptic?.(); setFilterStockInventario('todos'); }}
                                    className={`px-3 py-1.5 text-[10px] sm:text-xs font-black rounded-xl transition-all whitespace-nowrap ${
                                        filterStockInventario === 'todos'
                                            ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm'
                                            : 'text-slate-450 hover:text-slate-650 dark:hover:text-slate-350'
                                    }`}
                                >
                                    Todos ({inventoryMetrics.count})
                                </button>
                                <button
                                    onClick={() => { triggerHaptic?.(); setFilterStockInventario('bajo'); }}
                                    className={`px-3 py-1.5 text-[10px] sm:text-xs font-black rounded-xl transition-all flex items-center gap-1 whitespace-nowrap ${
                                        filterStockInventario === 'bajo'
                                            ? 'bg-amber-500 text-white shadow-sm'
                                            : 'text-amber-600 dark:text-amber-400 hover:text-amber-700'
                                    }`}
                                >
                                    Bajo Stock ({inventoryMetrics.lowStockCount})
                                </button>
                                <button
                                    onClick={() => { triggerHaptic?.(); setFilterStockInventario('agotado'); }}
                                    className={`px-3 py-1.5 text-[10px] sm:text-xs font-black rounded-xl transition-all flex items-center gap-1 whitespace-nowrap ${
                                        filterStockInventario === 'agotado'
                                            ? 'bg-rose-500 text-white shadow-sm'
                                            : 'text-rose-600 dark:text-rose-400 hover:text-rose-700'
                                    }`}
                                >
                                    Agotados ({inventoryMetrics.outOfStockCount})
                                </button>
                            </div>
                        </div>

                        {/* Listado de Productos (Fichas separadas e independientes con borde y margen claro) */}
                        <div>
                            {filteredProducts.length === 0 ? (
                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 py-16 text-center text-slate-400 flex flex-col items-center justify-center space-y-3 shadow-sm">
                                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 text-slate-300 dark:text-slate-600 rounded-full">
                                        <Package size={36} />
                                    </div>
                                    <div className="space-y-0.5">
                                        <p className="text-xs font-black text-slate-700 dark:text-slate-200">No se encontraron productos</p>
                                        <p className="text-[10px] text-slate-450">Intenta buscando con otro término o cambiando los filtros.</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-3.5 sm:space-y-4">
                                    {paginatedProducts.map((p) => {
                                        const stock = p.stock || 0;
                                        const minStock = p.minStock || 5;
                                        const isAgotado = stock <= 0;
                                        const isBajo = !isAgotado && stock <= minStock;
                                        const itemCost = p._effectiveCost ?? (p.costUsd || p.costPrice || 0);
                                        const profitUsd = Math.max(0, p.priceUsd - itemCost);
                                        const profitPct = p.priceUsd > 0 ? Math.round((profitUsd / p.priceUsd) * 100) : 0;
                                        const isComboProd = p.isCombo || p.type === 'combo' || p._isCombo;

                                        return (
                                            <div
                                                key={p.id}
                                                className="bg-white dark:bg-slate-900 rounded-3xl border-2 border-slate-200/90 dark:border-slate-800 p-4 sm:p-5 shadow-sm hover:shadow-md hover:border-brand/40 dark:hover:border-brand/40 transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative overflow-hidden group pl-5 sm:pl-6"
                                            >
                                                {/* Borde acentuado izquierdo para inicio de ficha claro */}
                                                <div className={`absolute top-0 left-0 bottom-0 w-2 ${
                                                    isAgotado
                                                        ? 'bg-rose-500'
                                                        : isBajo
                                                            ? 'bg-amber-500'
                                                            : 'bg-emerald-500'
                                                }`} />

                                                {/* Izquierda: Info de Producto */}
                                                <div className="flex-1 min-w-0 space-y-1.5">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <h4 className="text-sm sm:text-base font-black text-slate-900 dark:text-white uppercase leading-snug tracking-tight">{p.name}</h4>
                                                        <span className={`text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-lg shadow-2xs ${
                                                            isAgotado
                                                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                                                                : isBajo
                                                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                                                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                                        }`}>
                                                            {isAgotado ? 'Agotado' : isBajo ? 'Bajo Stock' : 'Disponible'}
                                                        </span>
                                                        {p.sellByBox && (
                                                            <span className="text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                                                📦 Caja{p.boxUnits ? ` ×${p.boxUnits}` : ''}
                                                            </span>
                                                        )}
                                                        {p.sellByHalfBox && (
                                                            <span className="text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                                                                ½ Caja{p.halfBoxUnits ? ` ×${p.halfBoxUnits}` : ''}
                                                            </span>
                                                        )}
                                                        {p._isQueuedNew && (
                                                            <span className="text-[9.5px] font-black uppercase px-2 py-0.5 rounded-lg bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-200 border border-purple-300">
                                                                Nuevo en cola
                                                            </span>
                                                        )}
                                                        {p._isQueuedEdit && !p._isQueuedNew && (
                                                            <span className="text-[9.5px] font-black uppercase px-2 py-0.5 rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-200 border border-amber-300">
                                                                Editado en cola
                                                            </span>
                                                        )}
                                                        {hasPendingFor(p.id) && pendingStockDelta(p.id) === 0 && !p._isQueuedEdit && !p._isQueuedNew && (
                                                            <span className="text-[9.5px] font-black uppercase px-2 py-0.5 rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-200 border border-amber-300 animate-pulse">
                                                                Cambio pendiente
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 font-bold flex-wrap">
                                                        {p.barcode && (
                                                            <span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md text-[11px]">
                                                                <Hash size={12} className="text-slate-400" /> {p.barcode}
                                                            </span>
                                                        )}
                                                        <span>Categoría: <strong className="text-slate-700 dark:text-slate-200">{
                                                            (categories || []).find(c => c.id === p.category)?.label || toTitleCase(p.category || 'Varios')
                                                        }</strong></span>
                                                    </div>
                                                </div>

                                                {/* Derecha: Valores y Stock (Responsivo: apilado en móvil, horizontal en desktop) */}
                                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between lg:justify-end gap-3 sm:gap-5 pt-3 lg:pt-0 border-t border-slate-100 dark:border-slate-800 lg:border-t-0 shrink-0">
                                                    {/* Costo, Venta, Margen */}
                                                    <div className="grid grid-cols-3 gap-3 sm:gap-5 text-left sm:text-right bg-slate-50 dark:bg-slate-950/80 p-3 lg:p-2.5 rounded-2xl border border-slate-200/60 dark:border-slate-800">
                                                        {/* Costo */}
                                                        <div>
                                                            <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-black tracking-wider block mb-0.5">Costo</span>
                                                            <span className="font-outfit text-sm sm:text-base font-black text-slate-700 dark:text-slate-200 tabular-nums">${itemCost.toFixed(2)}</span>
                                                        </div>
                                                        {/* Venta */}
                                                        <div>
                                                            <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-black tracking-wider block mb-0.5">Venta (USD/Bs)</span>
                                                            <span className="font-outfit text-base sm:text-lg font-black text-emerald-600 dark:text-emerald-400 tabular-nums block">${p.priceUsd.toFixed(2)}</span>
                                                            <span className="font-outfit text-xs font-bold text-slate-600 dark:text-slate-300 block tabular-nums leading-tight mt-0.5">
                                                                {(() => {
                                                                    const { unitPriceBs } = calculatePricing(p, effectiveRate, bcvRate);
                                                                    return unitPriceBs > 0 ? `${formatBs(unitPriceBs)} Bs` : 'N/D';
                                                                })()}
                                                            </span>
                                                        </div>
                                                        {/* Ganancia */}
                                                        <div>
                                                            <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-black tracking-wider block mb-0.5">Ganancia</span>
                                                            <span className="font-outfit text-sm sm:text-base font-black text-blue-600 dark:text-blue-400 tabular-nums block">${profitUsd.toFixed(2)}</span>
                                                            <span className="text-[10px] text-blue-500 dark:text-blue-300 block font-extrabold leading-none mt-0.5">+{profitPct}%</span>
                                                        </div>
                                                    </div>

                                                    {/* Controles de Stock y Acciones */}
                                                    <div className="flex items-center justify-between sm:justify-end gap-3">
                                                        {/* Botones +/- y Badge de Stock */}
                                                        {isComboProd ? (
                                                            <div 
                                                                title="El stock de los combos es dinámico y se calcula automáticamente en función del stock disponible de sus insumos componentes."
                                                                className="relative px-3 py-2 rounded-2xl border border-purple-200/80 bg-purple-50/80 dark:bg-purple-950/50 dark:border-purple-900/60 text-purple-700 dark:text-purple-300 shadow-2xs flex items-center gap-2 cursor-help"
                                                            >
                                                                <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                                                                <div>
                                                                    <span className="text-[9px] uppercase font-black block leading-none mb-0.5 opacity-90">
                                                                        Combo • Auto
                                                                    </span>
                                                                    <span className="font-outfit text-sm font-black tabular-nums leading-none">
                                                                        {stock} u <span className="text-[9px] font-bold opacity-75">(Dinámico)</span>
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-1.5">
                                                                <button
                                                                    onClick={() => { triggerHaptic?.(); queueInventoryChange('adjust_stock', p.id, { delta: -1 }); }}
                                                                    title="Restar 1 unidad (en cola)"
                                                                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-rose-600 hover:border-rose-300 dark:hover:text-rose-400 shadow-2xs transition-all active:scale-90 cursor-pointer"
                                                                >
                                                                    <MinusCircle size={16} />
                                                                </button>
                                                                <button
                                                                    onClick={() => { triggerHaptic?.(); setStockAdjustProduct(p); }}
                                                                    title="Toca para ingresar stock (+40, -10) o fijar cantidad exacta"
                                                                    className={`relative min-w-[85px] sm:min-w-[95px] text-center py-2 px-2.5 rounded-2xl border-2 transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-xs ${
                                                                        isAgotado
                                                                            ? 'bg-rose-50 border-rose-300 text-rose-700 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300 hover:border-rose-400'
                                                                            : isBajo
                                                                                ? 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300 hover:border-amber-400'
                                                                                : 'bg-white border-slate-200 text-slate-800 dark:bg-slate-850 dark:border-slate-700 dark:text-slate-100 hover:border-emerald-400 hover:bg-emerald-50/30'
                                                                    }`}
                                                                >
                                                                    <span className="text-[9px] uppercase font-black block leading-none mb-1 text-slate-500 dark:text-slate-400 flex items-center justify-center gap-0.5">
                                                                        Stock <Pencil size={8} />
                                                                    </span>
                                                                    <span className="font-outfit text-sm font-black tabular-nums leading-none">
                                                                        {p.isWeight ? `${stock.toFixed(3)} Kg` : `${stock} u`}
                                                                    </span>
                                                                    {p.sellByBox && p.boxUnits > 0 && !p.isWeight && (
                                                                        <span className="text-[8px] font-bold block leading-none mt-1 text-slate-500 dark:text-slate-400 truncate">
                                                                            ≈ {(stock / p.boxUnits).toFixed(1)} cj
                                                                        </span>
                                                                    )}
                                                                    {pendingStockDelta(p.id) !== 0 && (
                                                                        <span className={`absolute -top-2 -right-2 px-2 py-0.5 rounded-full text-[9px] font-black text-white shadow-md ${pendingStockDelta(p.id) > 0 ? 'bg-emerald-600' : 'bg-rose-600'}`}>
                                                                            {pendingStockDelta(p.id) > 0 ? '+' : ''}{pendingStockDelta(p.id)}
                                                                        </span>
                                                                    )}
                                                                </button>
                                                                <button
                                                                    onClick={() => { triggerHaptic?.(); queueInventoryChange('adjust_stock', p.id, { delta: 1 }); }}
                                                                    title="Sumar 1 unidad (en cola)"
                                                                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-emerald-600 hover:border-emerald-300 dark:hover:text-emerald-400 shadow-2xs transition-all active:scale-90 cursor-pointer"
                                                                >
                                                                    <PlusCircle size={16} />
                                                                </button>
                                                            </div>
                                                        )}

                                                        {/* Botones Editar / Eliminar horizontales */}
                                                        <div className="flex items-center gap-2 ml-1">
                                                            {isComboProd ? (
                                                                <button
                                                                    onClick={() => { triggerHaptic?.(); setEditingCombo(p); setShowComboModal(true); }}
                                                                    title="Editar combo (en cola)"
                                                                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 flex items-center justify-center text-purple-600 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/60 shadow-2xs transition-all active:scale-90 cursor-pointer"
                                                                >
                                                                    <Pencil size={15} />
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    onClick={() => { triggerHaptic?.(); setRemoteEditingProduct(p); setShowRemoteForm(true); }}
                                                                    title="Editar producto (en cola)"
                                                                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-brand hover:border-brand/40 shadow-2xs transition-all active:scale-90 cursor-pointer"
                                                                >
                                                                    <Pencil size={15} />
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => { triggerHaptic?.(); setRemoteDeleteTarget(p); }}
                                                                title="Eliminar (en cola)"
                                                                className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-rose-600 hover:border-rose-300 dark:hover:text-rose-400 shadow-2xs transition-all active:scale-90 cursor-pointer"
                                                            >
                                                                <Trash2 size={15} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Controles de Paginación */}
                        {totalPagesInventario > 1 && (
                            <div className="flex items-center justify-between bg-white dark:bg-slate-900 px-4 py-3 sm:px-6 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm mt-4">
                                <button
                                    onClick={() => {
                                        if (currentPageInventario > 1) {
                                            triggerHaptic?.();
                                            setCurrentPageInventario(prev => prev - 1);
                                        }
                                    }}
                                    disabled={currentPageInventario === 1}
                                    className="p-2 rounded-xl text-slate-500 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-slate-800 dark:hover:text-emerald-450 border border-slate-200 dark:border-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors duration-150"
                                >
                                    <ChevronLeft size={16} />
                                </button>

                                <span className="text-xs font-black text-slate-500 dark:text-slate-400">
                                    Página {currentPageInventario} de {totalPagesInventario}
                                    <span className="text-[10px] text-slate-450 font-medium ml-2">
                                        ({filteredProducts.length} productos)
                                    </span>
                                </span>

                                <button
                                    onClick={() => {
                                        if (currentPageInventario < totalPagesInventario) {
                                            triggerHaptic?.();
                                            setCurrentPageInventario(prev => prev + 1);
                                        }
                                    }}
                                    disabled={currentPageInventario === totalPagesInventario}
                                    className="p-2 rounded-xl text-slate-500 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-slate-800 dark:hover:text-emerald-450 border border-slate-200 dark:border-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors duration-150"
                                >
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* ── SECCIÓN 4: HISTORIAL Y GESTIÓN DEDICADA DE CAMBIOS ── */}
                {viewTab === 'cambios' && (
                    <div className="space-y-6 animate-fade-in">
                        {/* Tarjetas resumen de estado de cambios */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                            {/* Cola Local (Sin Subir) */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Cola Local (Sin Subir)</span>
                                <div className="flex items-end justify-between mt-2">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-blue-600 dark:text-blue-400 tabular-nums leading-none">
                                        {pendingChanges.length}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-bold">En navegador</span>
                                </div>
                            </div>

                            {/* Pendientes en Nube */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">En Espera en Nube</span>
                                <div className="flex items-end justify-between mt-2">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-amber-500 tabular-nums leading-none">
                                        {cloudPendingCmds.length}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-bold">Espera a la caja</span>
                                </div>
                            </div>

                            {/* Aplicados en Caja */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Aplicados por la Caja</span>
                                <div className="flex items-end justify-between mt-2">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums leading-none">
                                        {allCloudCmds.filter(c => c.status === 'applied').length}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-bold">Completados</span>
                                </div>
                            </div>

                            {/* Anulados */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Anulados / Cancelados</span>
                                <div className="flex items-end justify-between mt-2">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-rose-500 tabular-nums leading-none">
                                        {allCloudCmds.filter(c => c.status === 'cancelled').length}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-bold">Cancelados</span>
                                </div>
                            </div>
                        </div>

                        {/* Barra de Filtros de Cambios y Acciones Masivas */}
                        <div className="bg-white dark:bg-slate-900 p-3.5 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                            <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-2xl border border-slate-200/60 dark:border-slate-800 overflow-x-auto custom-scrollbar">
                                <button
                                    onClick={() => { setCmdTabFilter('todos'); setCurrentPageCambios(1); }}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                                        cmdTabFilter === 'todos' ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                                    }`}
                                >
                                    Todos ({pendingChanges.length + allCloudCmds.length})
                                </button>
                                <button
                                    onClick={() => { setCmdTabFilter('pending'); setCurrentPageCambios(1); }}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                                        cmdTabFilter === 'pending' ? 'bg-amber-500 text-white shadow-xs' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                                    }`}
                                >
                                    Pendientes ({pendingChanges.length + cloudPendingCmds.length})
                                </button>
                                <button
                                    onClick={() => { setCmdTabFilter('applied'); setCurrentPageCambios(1); }}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                                        cmdTabFilter === 'applied' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                                    }`}
                                >
                                    Aplicados ({allCloudCmds.filter(c => c.status === 'applied').length})
                                </button>
                                <button
                                    onClick={() => { setCmdTabFilter('cancelled'); setCurrentPageCambios(1); }}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                                        cmdTabFilter === 'cancelled' ? 'bg-rose-500 text-white shadow-xs' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                                    }`}
                                >
                                    Anulados ({allCloudCmds.filter(c => c.status === 'cancelled').length})
                                </button>
                            </div>

                            {/* Acciones globales */}
                            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                                {pendingChanges.length > 0 && (
                                    <button
                                        onClick={uploadPendingChanges}
                                        disabled={uploading || !isConnected}
                                        className="flex-1 sm:flex-none px-4 py-2 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-black uppercase tracking-wider shadow-md shadow-emerald-500/25 transition-all cursor-pointer disabled:opacity-40"
                                    >
                                        Subir Cola Local ({pendingChanges.length})
                                    </button>
                                )}
                                {cloudPendingCmds.length > 0 && (
                                    <button
                                        onClick={cancelAllCloudCmds}
                                        className="flex-1 sm:flex-none px-4 py-2 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-black uppercase tracking-wider shadow-md shadow-rose-500/25 transition-all cursor-pointer"
                                    >
                                        Anular Nube 🚫
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Construcción de Lista Paginada */}
                        {(() => {
                            const rawCmdList = [
                                ...(cmdTabFilter === 'todos' || cmdTabFilter === 'pending' 
                                    ? pendingChanges.map((c, i) => ({ isLocal: true, data: c, key: `local-${i}` })) 
                                    : []),
                                ...allCloudCmds
                                    .filter(cmd => {
                                        if (cmdTabFilter === 'pending') return cmd.status === 'pending';
                                        if (cmdTabFilter === 'applied') return cmd.status === 'applied';
                                        if (cmdTabFilter === 'cancelled') return cmd.status === 'cancelled';
                                        return true;
                                    })
                                    .map(cmd => ({ isLocal: false, data: cmd, key: `cloud-${cmd.id}` }))
                            ];

                            const totalPagesCambios = Math.max(1, Math.ceil(rawCmdList.length / ITEMS_PER_PAGE_CAMBIOS));
                            const safePage = Math.min(currentPageCambios, totalPagesCambios);
                            const paginatedItems = rawCmdList.slice(
                                (safePage - 1) * ITEMS_PER_PAGE_CAMBIOS,
                                safePage * ITEMS_PER_PAGE_CAMBIOS
                            );

                            return (
                                <div className="space-y-4">
                                    <div className="space-y-3">
                                        {paginatedItems.map(item => {
                                            if (item.isLocal) {
                                                const change = item.data;
                                                const targetProd = (products || []).find(p => p.id === change.productId);
                                                const prodName = targetProd ? targetProd.name : (change.data?.name || 'Artículo / Configuración');
                                                let actionLabel = 'Modificación de Inventario';
                                                if (change.action === 'adjust_stock') actionLabel = `Ajuste de Stock (${change.data?.delta > 0 ? '+' : ''}${change.data?.delta})`;
                                                else if (change.action === 'edit') actionLabel = 'Edición de Producto / Combo';
                                                else if (change.action === 'add') actionLabel = 'Nuevo Producto / Combo';
                                                else if (change.action === 'delete') actionLabel = 'Eliminación de Producto';

                                                return (
                                                    <div key={item.key} className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-blue-200 dark:border-blue-900/60 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                                                        <div className="min-w-0 space-y-1">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-lg bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                                                    EN COLA LOCAL (Sin Subir)
                                                                </span>
                                                                <span className="text-[10px] text-slate-400 font-bold">
                                                                    Encolado a las {new Date(change.queuedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                </span>
                                                            </div>
                                                            <h4 className="text-sm sm:text-base font-black text-slate-800 dark:text-white truncate">{prodName}</h4>
                                                            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{actionLabel}</p>
                                                        </div>
                                                        <div className="flex items-center gap-2 shrink-0">
                                                            <button
                                                                onClick={uploadPendingChanges}
                                                                disabled={uploading || !isConnected}
                                                                className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black uppercase tracking-wider shadow-xs transition-colors cursor-pointer disabled:opacity-40"
                                                            >
                                                                Subir ahora ☁️
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            }

                                            const cmd = item.data;
                                            const payload = cmd.payload || {};
                                            const action = payload.action || cmd.command_type;
                                            const prodId = payload.productId;
                                            const targetProd = (products || []).find(p => p.id === prodId);
                                            const prodName = targetProd ? targetProd.name : (payload.data?.name || 'Artículo / Configuración');
                                            const createdTime = new Date(cmd.created_at || payload.issuedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                            const appliedTime = cmd.applied_at ? new Date(cmd.applied_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

                                            let actionLabel = 'Modificación de Inventario';
                                            if (action === 'adjust_stock') {
                                                const delta = payload.data?.delta || 0;
                                                actionLabel = `Ajuste de Stock (${delta > 0 ? '+' : ''}${delta})`;
                                            } else if (action === 'edit') actionLabel = 'Edición de Producto / Combo';
                                            else if (action === 'add') actionLabel = 'Nuevo Producto / Combo';
                                            else if (action === 'delete') actionLabel = 'Eliminación de Producto';
                                            else if (cmd.command_type === 'rate_change') actionLabel = 'Cambio de Tasa de Cambio';

                                            let statusBadge = null;
                                            if (cmd.status === 'pending') {
                                                statusBadge = (
                                                    <span className="text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800 animate-pulse">
                                                        EN ESPERA EN NUBE
                                                    </span>
                                                );
                                            } else if (cmd.status === 'applied') {
                                                statusBadge = (
                                                    <span className="text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                                        APLICADO EN CAJA EL {new Date(cmd.applied_at).toLocaleDateString()}
                                                    </span>
                                                );
                                            } else if (cmd.status === 'cancelled') {
                                                statusBadge = (
                                                    <span className="text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-lg bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                                                        ANULADO
                                                    </span>
                                                );
                                            }

                                            return (
                                                <div key={item.key} className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                                                    <div className="min-w-0 space-y-1">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            {statusBadge}
                                                            <span className="text-[10px] text-slate-400 font-bold">Enviado: {createdTime}</span>
                                                            {appliedTime && (
                                                                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">· Aplicado a las {appliedTime}</span>
                                                            )}
                                                        </div>
                                                        <h4 className="text-sm sm:text-base font-black text-slate-800 dark:text-white truncate">{prodName}</h4>
                                                        <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{actionLabel}</p>
                                                    </div>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        {cmd.status === 'pending' && (
                                                            <button
                                                                onClick={() => cancelSingleCloudCmd(cmd.id)}
                                                                disabled={cancellingCmdId === cmd.id}
                                                                className="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-xs font-black uppercase transition-colors shrink-0 disabled:opacity-40 cursor-pointer"
                                                            >
                                                                {cancellingCmdId === cmd.id ? 'Anulando...' : 'Anular 🚫'}
                                                            </button>
                                                        )}
                                                        {cmd.status === 'applied' && (
                                                            <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                                                <ShieldCheck size={16} /> Aplicado por la caja
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {rawCmdList.length === 0 && (
                                            <div className="py-12 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl">
                                                <Clock size={32} className="mx-auto text-slate-300 mb-2" />
                                                <p className="text-xs font-black">Sin historial de cambios registrados</p>
                                                <p className="text-[10px] text-slate-450 mt-1">Las modificaciones de inventario y precios aparecerán aquí.</p>
                                            </div>
                                        )}
                                    </div>

                                    {/* Controles de Paginación para Cambios */}
                                    {totalPagesCambios > 1 && (
                                        <div className="flex items-center justify-between bg-white dark:bg-slate-900 px-4 py-3 sm:px-6 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm mt-4">
                                            <button
                                                onClick={() => {
                                                    if (safePage > 1) {
                                                        triggerHaptic?.();
                                                        setCurrentPageCambios(prev => Math.max(1, prev - 1));
                                                    }
                                                }}
                                                disabled={safePage === 1}
                                                className="p-2 rounded-xl text-slate-500 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-slate-800 dark:hover:text-emerald-450 border border-slate-200 dark:border-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors duration-150 cursor-pointer"
                                            >
                                                <ChevronLeft size={16} />
                                            </button>

                                            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                                                Página <span className="font-black text-slate-800 dark:text-white">{safePage}</span> de <span className="font-black text-slate-800 dark:text-white">{totalPagesCambios}</span>
                                                <span className="text-slate-400 text-[10px] ml-2 font-medium">({rawCmdList.length} registros)</span>
                                            </span>

                                            <button
                                                onClick={() => {
                                                    if (safePage < totalPagesCambios) {
                                                        triggerHaptic?.();
                                                        setCurrentPageCambios(prev => Math.min(totalPagesCambios, prev + 1));
                                                    }
                                                }}
                                                disabled={safePage === totalPagesCambios}
                                                className="p-2 rounded-xl text-slate-500 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-slate-800 dark:hover:text-emerald-450 border border-slate-200 dark:border-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors duration-150 cursor-pointer"
                                            >
                                                <ChevronRight size={16} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                )}
            </main>

            {/* Modal de Confirmación de Desvinculación */}
            {showDisconnectConfirm && (
                <div className="fixed inset-0 z-[999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-sm w-full shadow-2xl space-y-5 animate-scale-in">
                        <div className="w-12 h-12 bg-rose-50 dark:bg-rose-950/20 rounded-2xl flex items-center justify-center text-rose-500 mx-auto">
                            <LogOut size={22} />
                        </div>
                        <div className="space-y-1.5 text-center">
                            <h4 className="text-base font-black text-slate-800 dark:text-white">Desvincular Supervisor</h4>
                            <p className="text-xs font-semibold text-slate-500 leading-relaxed">
                                ¿Estás seguro de que deseas desvincular este dispositivo? Se perderá el acceso en tiempo real a las transacciones de esta caja.
                            </p>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => { triggerHaptic?.(); setShowDisconnectConfirm(false); }}
                                className="flex-1 py-3 px-4 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-350 font-black text-xs rounded-2xl border border-slate-200 dark:border-slate-700 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => { 
                                    setShowDisconnectConfirm(false);
                                    handleDisconnect();
                                }}
                                className="flex-1 py-3 px-4 bg-rose-500 hover:bg-rose-600 text-white font-black text-xs rounded-2xl shadow-lg shadow-rose-500/20 transition-colors"
                            >
                                Desvincular
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Modal de Cambio de Tasa */}
            <SupervisorRateModal
                isOpen={showRateModal}
                onClose={() => setShowRateModal(false)}
                rates={rates}
                primaryDeviceId={pairedDeviceId}
                triggerHaptic={triggerHaptic}
            />

            {/* Formulario remoto de producto (encola add/edit) */}
            <RemoteProductFormModal
                isOpen={showRemoteForm}
                onClose={() => { setShowRemoteForm(false); setRemoteEditingProduct(null); }}
                editingProduct={remoteEditingProduct}
                onSubmit={(action, productId, data) => queueInventoryChange(action, productId, data)}
                effectiveRate={effectiveRate}
                bcvRate={bcvRate}
            />

            {/* Formulario/Wizard remoto de combos */}
            <ComboFormModal
                isOpen={showComboModal}
                onClose={() => { setShowComboModal(false); setEditingCombo(null); }}
                products={projectedProducts}
                categories={categories}
                effectiveRate={effectiveRate}
                bcvRate={bcvRate}
                copEnabled={copEnabled}
                tasaCop={tasaCop}
                onSave={(comboData) => {
                    const finalData = editingCombo ? { ...comboData, baseUpdatedAt: editingCombo.updatedAt } : comboData;
                    queueInventoryChange(editingCombo ? 'edit' : 'add', comboData.id, finalData);
                    setShowComboModal(false);
                    setEditingCombo(null);
                    showToast(editingCombo ? 'Cambio de combo encolado' : 'Combo encolado para enviar a la caja', 'success');
                }}
                editingCombo={editingCombo}
            />

            {/* Confirmación de eliminación remota */}
            {remoteDeleteTarget && (
                <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-sm w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-rose-50 dark:bg-rose-950/30 rounded-2xl flex items-center justify-center shrink-0">
                                <Trash2 size={18} className="text-rose-500" />
                            </div>
                            <div>
                                <h3 className="font-black text-slate-800 dark:text-white text-sm">¿Eliminar producto?</h3>
                                <p className="text-[10px] text-slate-400 font-bold">Se encolará para enviar a la caja</p>
                            </div>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                            «<span className="font-black text-slate-700 dark:text-slate-200">{remoteDeleteTarget.name}</span>» será eliminado del inventario de la caja al subir los cambios.
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setRemoteDeleteTarget(null)}
                                className="flex-1 py-2.5 rounded-2xl font-black text-xs uppercase text-slate-500 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => { triggerHaptic?.(); queueInventoryChange('delete', remoteDeleteTarget.id, null); setRemoteDeleteTarget(null); }}
                                className="flex-1 py-2.5 rounded-2xl font-black text-xs uppercase text-white bg-rose-500 hover:bg-rose-600 shadow-lg shadow-rose-500/25 transition-colors"
                            >
                                Encolar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de Gestión / Anulación de Comandos Pendientes en la Nube */}
            {showCloudPendingModal && (
                <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowCloudPendingModal(false)}>
                    <div className="bg-white dark:bg-slate-900 w-full sm:max-w-lg rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/40">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400 font-black shrink-0">
                                    <Clock size={20} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black text-slate-800 dark:text-white">Comandos en Espera ({cloudPendingCmds.length})</h3>
                                    <p className="text-[10px] text-slate-400 font-medium mt-0.5">Subidos a la nube · Pendientes por aplicar en la caja</p>
                                </div>
                            </div>
                            <button onClick={() => setShowCloudPendingModal(false)} className="p-2 rounded-2xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-4 space-y-3 overflow-y-auto flex-1 custom-scrollbar">
                            {cloudPendingCmds.length === 0 ? (
                                <div className="py-8 text-center text-slate-400">
                                    <CheckCircle size={32} className="mx-auto mb-2 text-emerald-500 opacity-60" />
                                    <p className="text-xs font-bold">No hay cambios pendientes en la nube</p>
                                </div>
                            ) : (
                                cloudPendingCmds.map(cmd => {
                                    const payload = cmd.payload || {};
                                    const action = payload.action || cmd.command_type;
                                    const prodId = payload.productId;
                                    const targetProd = (products || []).find(p => p.id === prodId);
                                    const prodName = targetProd ? targetProd.name : (payload.data?.name || 'Artículo / Configuración');
                                    const formattedTime = new Date(cmd.created_at || payload.issuedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                                    let actionLabel = 'Modificación de Inventario';
                                    let actionColor = 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300';
                                    if (action === 'adjust_stock') {
                                        const delta = payload.data?.delta || 0;
                                        actionLabel = `Ajuste de Stock (${delta > 0 ? '+' : ''}${delta})`;
                                        actionColor = delta > 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300';
                                    } else if (action === 'edit') {
                                        actionLabel = 'Edición de Producto / Combo';
                                        actionColor = 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300';
                                    } else if (action === 'add') {
                                        actionLabel = 'Nuevo Producto / Combo';
                                        actionColor = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300';
                                    } else if (action === 'delete') {
                                        actionLabel = 'Eliminación de Producto';
                                        actionColor = 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300';
                                    } else if (cmd.command_type === 'rate_change') {
                                        actionLabel = 'Cambio de Tasa de Cambio';
                                        actionColor = 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300';
                                    }

                                    return (
                                        <div key={cmd.id} className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className={`text-[9.5px] font-black uppercase px-2 py-0.5 rounded-md ${actionColor}`}>
                                                        {actionLabel}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400 font-bold">{formattedTime}</span>
                                                </div>
                                                <p className="text-xs font-black text-slate-800 dark:text-white truncate mt-1">
                                                    {prodName}
                                                </p>
                                            </div>

                                            <button
                                                onClick={() => cancelSingleCloudCmd(cmd.id)}
                                                disabled={cancellingCmdId === cmd.id}
                                                className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 text-[10.5px] font-black uppercase transition-colors shrink-0 disabled:opacity-40"
                                            >
                                                {cancellingCmdId === cmd.id ? 'Anulando...' : 'Anular 🚫'}
                                            </button>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {cloudPendingCmds.length > 0 && (
                            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 flex gap-2">
                                <button onClick={() => setShowCloudPendingModal(false)} className="flex-1 py-2.5 rounded-2xl font-black text-xs uppercase text-slate-500 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                                    Cerrar
                                </button>
                                <button onClick={cancelAllCloudCmds} className="flex-1 py-2.5 rounded-2xl font-black text-xs uppercase text-white bg-rose-500 hover:bg-rose-600 shadow-md shadow-rose-500/20 transition-colors">
                                    Anular Todos ({cloudPendingCmds.length})
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Barra flotante «Subir al sistema» — ultra compacta y de 1 sola fila */}
            {pendingChanges.length > 0 && viewTab === 'inventario' && (
                <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[250] w-[94%] sm:w-full max-w-lg px-2 sm:px-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                    <div className="bg-[#193275] dark:bg-slate-900 border border-white/20 text-white rounded-2xl p-2.5 sm:p-3 shadow-2xl backdrop-blur-md flex items-center justify-between gap-2">
                        {/* Texto descriptivo */}
                        <div className="flex items-center gap-2 min-w-0 pl-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping shrink-0" />
                            <div className="min-w-0">
                                <p className="text-xs font-black leading-tight truncate">
                                    {pendingChanges.length} cambio{pendingChanges.length !== 1 ? 's' : ''} en cola
                                </p>
                                <p className="text-[9.5px] text-slate-300 font-medium leading-none mt-0.5 hidden sm:block truncate">
                                    Aún no se han enviado a la caja
                                </p>
                            </div>
                        </div>

                        {/* Botones de Acción */}
                        <div className="flex items-center gap-1.5 shrink-0">
                            <button
                                onClick={() => { triggerHaptic?.(); discardPendingChanges(); }}
                                disabled={uploading}
                                title="Descartar cambios"
                                className="px-2.5 py-1.5 rounded-xl text-[10px] font-black uppercase text-slate-300 hover:text-white bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-40"
                            >
                                Descartar
                            </button>
                            <button
                                onClick={() => { triggerHaptic?.(); uploadPendingChanges(); }}
                                disabled={uploading || !isConnected}
                                className="flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-[11px] font-black uppercase tracking-wider shadow-md shadow-emerald-500/30 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {uploading ? <RefreshCw size={13} className="animate-spin" /> : <UploadCloud size={13} />}
                                <span>{uploading ? 'Subiendo...' : 'Subir al sistema'}</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Modal de Ajuste Rápido de Stock (+40, -10, Entrada/Salida) */}
            {stockAdjustProduct && (
                <StockAdjustModal
                    product={stockAdjustProduct}
                    onClose={() => setStockAdjustProduct(null)}
                    onConfirm={(productId, delta) => queueInventoryChange('adjust_stock', productId, { delta })}
                    triggerHaptic={triggerHaptic}
                />
            )}

            {/* Modal de Detalle Completo de Venta */}
            {selectedSaleDetail && (
                <SaleDetailModal
                    sale={selectedSaleDetail}
                    onClose={() => setSelectedSaleDetail(null)}
                    bcvRate={bcvRate}
                    pairedDeviceId={pairedDeviceId}
                    onVoidSaleSuccess={(saleId) => {
                        setSelectedSaleDetail(prev => prev ? { ...prev, status: 'ANULADA' } : null);
                        setSales(prevSales => {
                            const updated = prevSales.map(s => s.id === saleId ? { ...s, status: 'ANULADA' } : s);
                            storageService.setItem('bodega_sales_v1', updated).catch(() => {});
                            return updated;
                        });
                    }}
                />
            )}

            {/* Modal de Vinculación de Dispositivos */}
            {showPairingModal && (
                <SupervisorPairingModal
                    onClose={() => setShowPairingModal(false)}
                    pairedDeviceId={pairedDeviceId}
                    triggerHaptic={triggerHaptic}
                />
            )}

            {/* Modal de Gestión de Usuarios y PINs */}
            {showUsersModal && (
                <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fade-in" onClick={() => setShowUsersModal(false)}>
                    <div className="bg-white dark:bg-slate-900 w-full sm:max-w-2xl rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/40">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-800/60 flex items-center justify-center text-blue-600 dark:text-blue-400 font-black shrink-0">
                                    <Users size={20} />
                                </div>
                                <div>
                                    <h3 className="text-base font-black text-slate-800 dark:text-white">Usuarios, Roles y PINs</h3>
                                    <p className="text-xs text-slate-400 font-medium mt-0.5">Consulta y gestiona los PINs de acceso de tu equipo</p>
                                </div>
                            </div>
                            <button onClick={() => setShowUsersModal(false)} className="p-2 rounded-2xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-4 sm:p-6 overflow-y-auto flex-1 custom-scrollbar space-y-4">
                            {!isPosOnline && (
                                <div className="p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/40 rounded-2xl flex items-center gap-3 text-amber-800 dark:text-amber-300 text-xs font-semibold shadow-xs">
                                    <AlertTriangle size={20} className="shrink-0 text-amber-600 dark:text-amber-400" />
                                    <div>
                                        <p className="font-black text-amber-900 dark:text-amber-200 leading-tight">Caja Principal Desconectada</p>
                                        <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium mt-0.5">Mostrando catálogo de usuarios de la última sincronización. Los cambios se enviarán y aplicarán en la caja automáticamente apenas vuelva a estar en línea.</p>
                                    </div>
                                </div>
                            )}
                            <UsersManager triggerHaptic={triggerHaptic} />
                        </div>

                        {/* Footer con botón "Subir al Sistema" si hay cambios pendientes */}
                        {pendingChanges.length > 0 && (
                            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-900 text-white flex items-center justify-between gap-3 animate-in slide-in-from-bottom-2 duration-200">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-black text-xs shrink-0 border border-amber-500/30">
                                        {pendingChanges.length}
                                    </div>
                                    <p className="text-xs font-black truncate">
                                        {pendingChanges.length} cambio{pendingChanges.length !== 1 ? 's' : ''} pendiente{pendingChanges.length !== 1 ? 's' : ''} por subir
                                    </p>
                                </div>
                                <button
                                    onClick={() => { triggerHaptic?.(); uploadPendingChanges(); }}
                                    disabled={uploading || !isConnected}
                                    className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-[11px] font-black uppercase tracking-wider shadow-md shadow-emerald-500/30 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
                                >
                                    {uploading ? <RefreshCw size={13} className="animate-spin" /> : <UploadCloud size={13} />}
                                    <span>{uploading ? 'Subiendo...' : 'Subir al sistema'}</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── SUBCOMPONENTE: Modal de Ajuste Rápido de Stock (Entradas de mercancía / Salidas) ──
function StockAdjustModal({ product, onClose, onConfirm, triggerHaptic }) {
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
        delta = -Math.min(currentStock, qtyNum);
    } else if (mode === 'set') {
        targetStock = Math.max(0, qtyNum);
        delta = targetStock - currentStock;
    }

    const handleQuickAdd = (val) => {
        triggerHaptic?.();
        setMode('add');
        setQuantity(val.toString());
    };

    const handleSave = (e) => {
        e.preventDefault();
        if (delta === 0) {
            onClose();
            return;
        }
        triggerHaptic?.();
        onConfirm(product.id, delta);
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
                <div className="grid grid-cols-3 gap-1.5 bg-slate-100 dark:bg-slate-950 p-1 rounded-2xl">
                    <button
                        type="button"
                        onClick={() => { triggerHaptic?.(); setMode('add'); }}
                        className={`py-2 text-[10px] font-black uppercase rounded-xl transition-all ${
                            mode === 'add'
                                ? 'bg-emerald-500 text-white shadow-sm'
                                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                    >
                        ➕ Entrada (+40)
                    </button>
                    <button
                        type="button"
                        onClick={() => { triggerHaptic?.(); setMode('subtract'); }}
                        className={`py-2 text-[10px] font-black uppercase rounded-xl transition-all ${
                            mode === 'subtract'
                                ? 'bg-rose-500 text-white shadow-sm'
                                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                    >
                        ➖ Salida (-10)
                    </button>
                    <button
                        type="button"
                        onClick={() => { triggerHaptic?.(); setMode('set'); }}
                        className={`py-2 text-[10px] font-black uppercase rounded-xl transition-all ${
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
                                    +{num}
                                </button>
                            ))}
                            {product.sellByBox && product.boxUnits > 0 && (
                                <button
                                    type="button"
                                    onClick={() => handleQuickAdd(product.boxUnits)}
                                    className="px-2.5 py-1 text-xs font-outfit font-black rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 hover:bg-blue-100 transition-colors"
                                >
                                    +1 Caja ({product.boxUnits}u)
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
