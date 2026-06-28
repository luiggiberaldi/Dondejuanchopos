import React, { useState, useEffect, useMemo } from 'react';
import { useProductContext } from '../context/ProductContext';
import { useMonitorSync } from '../hooks/useMonitorSync';
import { storageService } from '../utils/storageService';
import { supabaseCloud } from '../config/supabaseCloud';
import { showToast } from '../components/Toast';
import { 
    TrendingUp, Package, Coins, Users, LogOut, 
    RefreshCw, Wifi, WifiOff, Clock, FileText, DollarSign,
    Wallet, CreditCard, Smartphone, Banknote, ArrowDownRight,
    ShieldCheck, Hash
} from 'lucide-react';
import { formatBs } from '../utils/calculatorUtils';
import { getLocalISODate } from '../utils/dateHelpers';
import { getPaymentLabel, FACTORY_PAYMENT_METHODS, toTitleCase } from '../config/paymentMethods';

// ── Helper: icon por método de pago ──
const PAYMENT_METHOD_ICONS = {
    efectivo_bs: Banknote,
    pago_movil: Smartphone,
    punto_venta: CreditCard,
    efectivo_usd: DollarSign,
    efectivo_cop: Coins,
    transferencia_cop: CreditCard,
    fiado: Clock,
    cashea: Clock,
};

function getMethodIcon(methodId) {
    return PAYMENT_METHOD_ICONS[methodId] || Wallet;
}

export default function OwnerMonitorView({ theme, toggleTheme, triggerHaptic }) {
    const pairedDeviceId = localStorage.getItem('pda_paired_device_id');
    const { products, effectiveRate: bcvRate } = useProductContext();
    const { isConnected, lastSync, loading: syncLoading } = useMonitorSync(pairedDeviceId);

    const [sales, setSales] = useState([]);
    const [activeCashier, setActiveCashier] = useState({ nombre: 'Ninguno', rol: '' });
    const [loadingData, setLoadingData] = useState(true);

    const today = getLocalISODate();

    // 1. Cargar datos locales (que son actualizados por useMonitorSync)
    const loadLocalData = async () => {
        try {
            const [savedSales, savedAuth] = await Promise.all([
                storageService.getItem('bodega_sales_v1', []),
                storageService.getItem('abasto-auth-storage', null)
            ]);

            setSales(savedSales);
            
            if (savedAuth && savedAuth.state && savedAuth.state.usuarioActivo) {
                setActiveCashier({
                    nombre: savedAuth.state.usuarioActivo.nombre || 'Cajero',
                    rol: savedAuth.state.usuarioActivo.rol || 'CAJERO'
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

    // 2. Filtrar ventas de hoy (no anuladas)
    const todaySales = useMemo(() => {
        return sales.filter(s => {
            if (s.status === 'ANULADA') return false;
            if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA') return false;
            const localDate = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : today;
            return localDate === today;
        });
    }, [sales, today]);

    // 3. Apertura de caja de hoy
    const todayApertura = useMemo(() => {
        return sales.find(s => {
            if (s.tipo !== 'APERTURA_CAJA') return false;
            const localDate = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : today;
            return localDate === today;
        }) || null;
    }, [sales, today]);

    // 4. Métricas generales
    const metrics = useMemo(() => {
        let usd = 0;
        let bs = 0;
        todaySales.forEach(s => {
            usd += s.totalUsd || 0;
            bs += s.totalBs || 0;
        });

        // Calcular ganancia estimada si los productos tienen costo
        let costSum = 0;
        todaySales.forEach(s => {
            if (!s.items) return;
            s.items.forEach(item => {
                const prod = products.find(p => p.id === item.productId || p.id === item.id);
                if (prod && prod.costPrice) {
                    costSum += prod.costPrice * item.qty;
                }
            });
        });

        const profitUsd = Math.max(0, usd - costSum);

        return {
            totalUsd: usd,
            totalBs: bs,
            profitUsd,
            count: todaySales.length
        };
    }, [todaySales, products]);

    // 5. Desglose por método de pago
    const paymentBreakdown = useMemo(() => {
        const breakdown = {};

        todaySales.forEach(sale => {
            // Ventas fiadas
            if (sale.tipo === 'VENTA_FIADA') {
                if (!breakdown['fiado']) {
                    breakdown['fiado'] = { totalUsd: 0, totalBs: 0, count: 0, label: 'Fiado (Por Cobrar)', currency: 'FIADO' };
                }
                breakdown['fiado'].totalUsd += sale.totalUsd || 0;
                breakdown['fiado'].totalBs += sale.totalBs || 0;
                breakdown['fiado'].count += 1;
                return; // No procesar pagos para fiado
            }

            // V2 sales with payments array
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
                // Legacy V1 sales
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

        // Sort by totalUsd desc
        return Object.entries(breakdown)
            .sort(([, a], [, b]) => b.totalUsd - a.totalUsd);
    }, [todaySales]);

    // 6. Productos Críticos (Stock <= 0)
    const criticalProducts = useMemo(() => {
        return products
            .filter(p => p.stock <= 0)
            .slice(0, 10);
    }, [products]);

    // 7. Ticket promedio
    const avgTicket = useMemo(() => {
        if (todaySales.length === 0) return 0;
        return metrics.totalUsd / todaySales.length;
    }, [metrics.totalUsd, todaySales.length]);

    // 8. Desvincular Monitor
    const handleDisconnect = async () => {
        if (!window.confirm('¿Seguro que deseas desvincular este dispositivo? Perderás el acceso en tiempo real.')) return;
        triggerHaptic?.();
        
        try {
            if (supabaseCloud && pairedDeviceId) {
                await supabaseCloud.rpc('unpair_monitor', { p_device_id: pairedDeviceId });
            }
        } catch (err) {
            console.warn('[OwnerMonitorView] Error al llamar unpair RPC:', err);
        }

        localStorage.removeItem('pda_paired_device_id');
        localStorage.removeItem('pda_pairing_mode');
        localStorage.removeItem('monitor_last_sync');
        localStorage.removeItem('business_name');
        localStorage.removeItem('business_rif');
        
        try {
            const { default: localforage } = await import('localforage');
            localforage.config({ name: 'BodegaApp', storeName: 'bodega_app_data' });
            await localforage.clear();
        } catch (e) {
            console.warn(e);
        }

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

    return (
        <div className="min-h-screen bg-slate-50 text-slate-700 font-sans pb-12 transition-colors duration-300">
            {/* Header del Monitor */}
            <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200 px-4 py-3 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white font-bold">
                        <ShieldCheck size={20} />
                    </div>
                    <div>
                        <h1 className="text-base font-black leading-tight text-slate-800">Panel de Supervisión</h1>
                        <p className="text-[10px] text-slate-400 font-medium">Monitoreo en vivo • {localStorage.getItem('business_name') || 'Mi Negocio'}</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Status Badge */}
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black tracking-wider uppercase shadow-sm transition-colors duration-300 ${
                        isConnected 
                            ? 'bg-emerald-50 border border-emerald-200/50 text-emerald-600' 
                            : 'bg-rose-50 border border-rose-200/50 text-rose-600 animate-pulse'
                    }`}>
                        {isConnected ? (
                            <>
                                <Wifi size={12} className="shrink-0" />
                                <span>En Vivo</span>
                            </>
                        ) : (
                            <>
                                <WifiOff size={12} className="shrink-0" />
                                <span>Desconectado</span>
                            </>
                        )}
                    </div>

                    <button 
                        onClick={handleDisconnect}
                        className="p-2.5 rounded-2xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 border border-slate-200 bg-white transition-colors"
                        title="Desvincular Dispositivo"
                    >
                        <LogOut size={16} />
                    </button>
                </div>
            </header>

            {/* Banner Offline */}
            {!isConnected && lastSync && (
                <div className="mx-4 mt-4 p-3.5 bg-amber-50 border border-amber-200/50 rounded-2xl flex gap-3 items-center text-amber-800 shadow-sm animate-fade-in">
                    <Clock size={18} className="shrink-0" />
                    <p className="text-xs font-semibold leading-relaxed">
                        Sin conexión a internet. Mostrando últimos datos sincronizados el {lastSync.toLocaleDateString()} a las {lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                    </p>
                </div>
            )}

            {/* Contenido Principal */}
            <main className="max-w-7xl mx-auto px-4 mt-6 space-y-6">
                {/* ── Fila 1: Tarjetas de Métricas ── */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    {/* Ventas Hoy USD */}
                    <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200/60 shadow-sm flex items-center justify-between">
                        <div className="space-y-0.5 min-w-0">
                            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400 block">Vendido (USD)</span>
                            <span className="text-lg sm:text-2xl font-black text-slate-800 tabular-nums truncate block">${metrics.totalUsd.toFixed(2)}</span>
                        </div>
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-500 shrink-0">
                            <DollarSign size={22} />
                        </div>
                    </div>

                    {/* Ventas Hoy Bs */}
                    <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200/60 shadow-sm flex items-center justify-between">
                        <div className="space-y-0.5 min-w-0">
                            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400 block">Vendido (Bs)</span>
                            <span className="text-lg sm:text-2xl font-black text-emerald-600 tabular-nums truncate block">{formatBs(metrics.totalBs)} Bs</span>
                        </div>
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-500 shrink-0">
                            <Coins size={22} />
                        </div>
                    </div>

                    {/* Margen Estimado */}
                    <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200/60 shadow-sm flex items-center justify-between">
                        <div className="space-y-0.5 min-w-0">
                            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400 block">Margen Neto</span>
                            <span className="text-lg sm:text-2xl font-black text-blue-600 tabular-nums truncate block">${metrics.profitUsd.toFixed(2)}</span>
                        </div>
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-500 shrink-0">
                            <TrendingUp size={22} />
                        </div>
                    </div>

                    {/* Transacciones y Cajero */}
                    <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200/60 shadow-sm flex items-center justify-between">
                        <div className="space-y-0.5 min-w-0">
                            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400 block">Cajero en Caja</span>
                            <span className="text-base sm:text-lg font-black text-slate-800 truncate max-w-[120px] sm:max-w-[150px] block">{activeCashier.nombre}</span>
                            <span className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase">{metrics.count} {metrics.count === 1 ? 'venta' : 'ventas'} hoy</span>
                        </div>
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 shrink-0">
                            <Users size={22} />
                        </div>
                    </div>
                </div>

                {/* ── Fila 2: Desglose por Método de Pago + Apertura ── */}
                <div className="bg-white rounded-3xl border border-slate-200/60 shadow-sm overflow-hidden">
                    <div className="p-5 sm:p-6 border-b border-slate-100">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                                <Wallet size={18} className="text-violet-500" />
                                Desglose Diario por Método de Pago
                            </h3>
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-50 px-3 py-1.5 rounded-xl">
                                {new Date().toLocaleDateString('es-VE', { weekday: 'short', day: 'numeric', month: 'short' })}
                            </span>
                        </div>
                    </div>

                    <div className="p-5 sm:p-6">
                        {/* Apertura de caja */}
                        <div className="mb-5 p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                            <div className="flex items-center gap-2 mb-3">
                                <div className="w-7 h-7 bg-amber-100 rounded-lg flex items-center justify-center">
                                    <ArrowDownRight size={14} className="text-amber-600" />
                                </div>
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Fondo de Apertura</span>
                            </div>
                            {todayApertura ? (
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    <div className="space-y-0.5">
                                        <span className="text-[9px] font-bold text-slate-400 uppercase block">USD Inicial</span>
                                        <span className="text-sm font-black text-slate-700 tabular-nums">${(todayApertura.openingUsd || 0).toFixed(2)}</span>
                                    </div>
                                    <div className="space-y-0.5">
                                        <span className="text-[9px] font-bold text-slate-400 uppercase block">Bs Inicial</span>
                                        <span className="text-sm font-black text-slate-700 tabular-nums">{formatBs(todayApertura.openingBs || 0)} Bs</span>
                                    </div>
                                    {(todayApertura.openingCop > 0) && (
                                        <div className="space-y-0.5">
                                            <span className="text-[9px] font-bold text-slate-400 uppercase block">COP Inicial</span>
                                            <span className="text-sm font-black text-slate-700 tabular-nums">{(todayApertura.openingCop || 0).toLocaleString()} COP</span>
                                        </div>
                                    )}
                                    <div className="space-y-0.5 col-span-2 sm:col-span-3">
                                        <span className="text-[9px] font-bold text-slate-400 uppercase block">Hora de apertura</span>
                                        <span className="text-xs font-bold text-slate-500">{formatTime(todayApertura.timestamp)}</span>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-xs text-slate-400 font-bold">La caja aún no ha sido abierta hoy.</p>
                            )}
                        </div>

                        {/* Tabla desglose */}
                        {paymentBreakdown.length === 0 ? (
                            <div className="py-8 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl">
                                <Wallet size={28} className="mx-auto text-slate-300 mb-2" />
                                <p className="text-xs font-black">Sin movimientos hoy</p>
                                <p className="text-[10px] text-slate-400 mt-1">El desglose aparecerá cuando se registren ventas.</p>
                            </div>
                        ) : (
                            <div className="space-y-2.5">
                                {paymentBreakdown.map(([methodId, data]) => {
                                    const IconComp = getMethodIcon(methodId);
                                    const pct = metrics.totalUsd > 0 
                                        ? Math.round((data.totalUsd / metrics.totalUsd) * 100) 
                                        : 0;

                                    return (
                                        <div key={methodId} className="flex items-center gap-3 p-3.5 bg-slate-50/70 border border-slate-100 rounded-2xl hover:bg-slate-50 transition-colors">
                                            <div className="w-9 h-9 bg-white border border-slate-200/60 rounded-xl flex items-center justify-center text-slate-500 shrink-0 shadow-sm">
                                                <IconComp size={16} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-xs font-black text-slate-700 truncate">{data.label}</span>
                                                    <span className="text-xs font-black text-slate-800 tabular-nums shrink-0">${data.totalUsd.toFixed(2)}</span>
                                                </div>
                                                <div className="flex items-center justify-between gap-2 mt-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[9px] font-bold text-slate-400">{data.count} {data.count === 1 ? 'transacción' : 'transacciones'}</span>
                                                        <span className="text-[9px] font-black text-violet-500 bg-violet-50 px-1.5 py-0.5 rounded-md">{pct}%</span>
                                                    </div>
                                                    <span className="text-[10px] font-bold text-slate-400 tabular-nums">{formatBs(data.totalBs)} Bs</span>
                                                </div>
                                                {/* Barra de progreso */}
                                                <div className="mt-1.5 h-1 bg-slate-200/60 rounded-full overflow-hidden">
                                                    <div 
                                                        className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all duration-500" 
                                                        style={{ width: `${Math.max(2, pct)}%` }} 
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Resumen total */}
                                <div className="mt-3 pt-3 border-t border-slate-200/60 flex items-center justify-between px-1">
                                    <div className="flex items-center gap-2">
                                        <Hash size={14} className="text-slate-400" />
                                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                            Total del día ({metrics.count} {metrics.count === 1 ? 'venta' : 'ventas'})
                                        </span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-sm font-black text-slate-800 tabular-nums">${metrics.totalUsd.toFixed(2)}</span>
                                        <span className="text-[10px] font-bold text-slate-400 ml-2">{formatBs(metrics.totalBs)} Bs</span>
                                    </div>
                                </div>

                                {/* Ticket promedio */}
                                <div className="flex items-center justify-between px-1 mt-1">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Ticket Promedio</span>
                                    <span className="text-xs font-black text-blue-600 tabular-nums">${avgTicket.toFixed(2)}</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Fila 3: Dashboard de Columnas ── */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Columna Izquierda: Listado de Ventas en Vivo */}
                    <div className="lg:col-span-2 space-y-4">
                        <div className="bg-white rounded-3xl border border-slate-200/60 p-6 shadow-sm">
                            <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-2">
                                <FileText size={18} className="text-slate-400" />
                                Ventas en Tiempo Real
                            </h3>
                            
                            {loadingData || syncLoading ? (
                                <div className="py-8 flex justify-center text-slate-400 gap-2 items-center">
                                    <RefreshCw className="animate-spin" size={18} />
                                    <span className="text-xs font-bold">Cargando transacciones...</span>
                                </div>
                            ) : todaySales.length === 0 ? (
                                <div className="py-12 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl">
                                    <Clock size={36} className="mx-auto text-slate-300 mb-2" />
                                    <p className="text-xs font-black">No se han registrado ventas hoy</p>
                                    <p className="text-[10px] text-slate-400 mt-1">Las ventas de la caja aparecerán aquí al instante.</p>
                                </div>
                            ) : (
                                <div className="space-y-3 max-h-[550px] overflow-y-auto pr-1">
                                    {todaySales.slice().reverse().map(sale => (
                                        <div 
                                            key={sale.id}
                                            className="p-4 border border-slate-100 hover:border-slate-200 rounded-2xl bg-slate-50/50 flex justify-between items-start transition-colors"
                                        >
                                            <div className="space-y-1 min-w-0 flex-1 pr-3">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-700">
                                                        #{sale.id.slice(-4).toUpperCase()}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400 font-bold">{formatTime(sale.timestamp)}</span>
                                                </div>
                                                <p className="text-xs font-black text-slate-700 mt-1.5 truncate">
                                                    {sale.items?.map(i => `${i.name} (x${i.qty})`).join(', ') || 'Venta de productos'}
                                                </p>
                                                <div className="flex gap-2 items-center mt-1">
                                                    <span className="text-[10px] font-black text-slate-400 uppercase">{sale.metodoPago || sale.paymentMethod || 'Efectivo'}</span>
                                                    {sale.clientName && (
                                                        <span className="text-[10px] text-slate-400 font-bold">• {sale.clientName}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-right space-y-0.5 shrink-0">
                                                <span className="text-sm font-black text-slate-800 block">${(sale.totalUsd || 0).toFixed(2)}</span>
                                                <span className="text-[10px] font-bold text-slate-400 block">{formatBs(sale.totalBs || 0)} Bs</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Columna Derecha: Stock Crítico */}
                    <div className="space-y-6">
                        {/* Productos Sin Stock */}
                        <div className="bg-white rounded-3xl border border-slate-200/60 p-6 shadow-sm">
                            <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-2">
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
                                        <div key={prod.id} className="flex justify-between items-center py-2 border-b border-slate-100 last:border-0">
                                            <div className="min-w-0 pr-2">
                                                <span className="text-xs font-bold text-slate-700 block truncate">{prod.name}</span>
                                                <span className="text-[10px] text-slate-400">Precio: ${prod.price?.toFixed(2)}</span>
                                            </div>
                                            <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-rose-50 text-rose-600 shrink-0">
                                                Agotado
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
