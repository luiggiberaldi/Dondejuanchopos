import React, { useState, useEffect, useMemo } from 'react';
import { useProductContext } from '../context/ProductContext';
import { useMonitorSync } from '../hooks/useMonitorSync';
import { storageService } from '../utils/storageService';
import { supabaseCloud } from '../config/supabaseCloud';
import { showToast } from '../components/Toast';
import { 
    TrendingUp, Package, AlertTriangle, Coins, Users, LogOut, 
    RefreshCw, Wifi, WifiOff, Clock, FileText, ArrowRight, DollarSign 
} from 'lucide-react';
import { formatBs } from '../utils/calculatorUtils';
import { getLocalISODate } from '../utils/dateHelpers';

export default function OwnerMonitorView({ theme, toggleTheme, triggerHaptic }) {
    const pairedDeviceId = localStorage.getItem('pda_paired_device_id');
    const { products, effectiveRate: bcvRate } = useProductContext();
    const { isConnected, lastSync, loading: syncLoading } = useMonitorSync(pairedDeviceId);

    const [sales, setSales] = useState([]);
    const [auditLogs, setAuditLogs] = useState([]);
    const [activeCashier, setActiveCashier] = useState({ nombre: 'Ninguno', rol: '' });
    const [loadingData, setLoadingData] = useState(true);

    const today = getLocalISODate();

    // 1. Cargar datos locales (que son actualizados por useMonitorSync)
    const loadLocalData = async () => {
        try {
            const [savedSales, savedLogs, savedAuth] = await Promise.all([
                storageService.getItem('bodega_sales_v1', []),
                storageService.getItem('abasto_audit_log_v1', []),
                storageService.getItem('abasto-auth-storage', null)
            ]);

            setSales(savedSales);
            setAuditLogs(savedLogs.slice(-15).reverse()); // Últimos 15 logs
            
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

    // 2. Cálculos de Métricas
    const todaySales = useMemo(() => {
        return sales.filter(s => {
            if (s.status === 'ANULADA') return false;
            if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA') return false;
            const localDate = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : today;
            return localDate === today;
        });
    }, [sales, today]);

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

    // 3. Productos Críticos (Stock <= 0)
    const criticalProducts = useMemo(() => {
        return products
            .filter(p => p.stock <= 0)
            .slice(0, 10); // Mostrar máximo 10
    }, [products]);

    // 4. Desvincular Monitor
    const handleDisconnect = async () => {
        if (!window.confirm('¿Seguro que deseas desvincular este dispositivo? Perderás el acceso en tiempo real.')) return;
        triggerHaptic?.();
        
        try {
            // Llamar al RPC en Supabase para notificar la desvinculación
            if (supabaseCloud && pairedDeviceId) {
                await supabaseCloud.rpc('unpair_monitor', { p_device_id: pairedDeviceId });
            }
        } catch (err) {
            console.warn('[OwnerMonitorView] Error al llamar unpair RPC:', err);
        }

        // Limpiar caché local
        localStorage.removeItem('pda_paired_device_id');
        localStorage.removeItem('pda_pairing_mode');
        localStorage.removeItem('monitor_last_sync');
        localStorage.removeItem('business_name');
        localStorage.removeItem('business_rif');
        
        // Limpiar IndexedDB para no dejar datos del negocio anterior
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
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-sans pb-12 transition-colors duration-300">
            {/* Header del Monitor */}
            <header className="sticky top-0 z-50 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-700/50 px-4 py-3 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white font-bold">
                        M
                    </div>
                    <div>
                        <h1 className="text-base font-black leading-tight text-slate-800 dark:text-white">Panel de Supervisión</h1>
                        <p className="text-[10px] text-slate-400 font-medium">Monitoreo en vivo • {localStorage.getItem('business_name') || 'Mi Negocio'}</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Status Badge */}
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black tracking-wider uppercase shadow-sm transition-colors duration-300 ${
                        isConnected 
                            ? 'bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/30 text-emerald-600 dark:text-emerald-400' 
                            : 'bg-rose-50 dark:bg-rose-950/20 border border-rose-200/50 dark:border-rose-800/30 text-rose-600 dark:text-rose-400 animate-pulse'
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
                        className="p-2.5 rounded-2xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/10 border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800 transition-colors"
                        title="Desvincular Dispositivo"
                    >
                        <LogOut size={16} />
                    </button>
                </div>
            </header>

            {/* Banner Offline */}
            {!isConnected && lastSync && (
                <div className="mx-4 mt-4 p-3.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30 rounded-2xl flex gap-3 items-center text-amber-800 dark:text-amber-400 shadow-sm animate-fade-in">
                    <Clock size={18} className="shrink-0" />
                    <p className="text-xs font-semibold leading-relaxed">
                        Sin conexión a internet. Mostrando últimos datos sincronizados el {lastSync.toLocaleDateString()} a las {lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                    </p>
                </div>
            )}

            {/* Contenido Principal */}
            <main className="max-w-7xl mx-auto px-4 mt-6 space-y-6">
                {/* Fila de Tarjetas de Métricas */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Ventas Hoy USD */}
                    <div className="bg-white dark:bg-slate-800 p-5 rounded-3xl border border-slate-200/60 dark:border-slate-700/40 shadow-sm flex items-center justify-between">
                        <div className="space-y-1">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Vendido Hoy (USD)</span>
                            <span className="text-2xl font-black text-slate-800 dark:text-white tabular-nums">${metrics.totalUsd.toFixed(2)}</span>
                            <span className="text-[10px] text-slate-400 block font-medium">Equivalente a tasa oficial</span>
                        </div>
                        <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-950/30 rounded-2xl flex items-center justify-center text-emerald-500">
                            <DollarSign size={24} />
                        </div>
                    </div>

                    {/* Ventas Hoy Bs */}
                    <div className="bg-white dark:bg-slate-800 p-5 rounded-3xl border border-slate-200/60 dark:border-slate-700/40 shadow-sm flex items-center justify-between">
                        <div className="space-y-1">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Vendido Hoy (Bs)</span>
                            <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">{formatBs(metrics.totalBs)} Bs</span>
                            <span className="text-[10px] text-slate-400 block font-medium">Tasa BCV: {bcvRate ? `${bcvRate.toFixed(2)} Bs/$` : 'N/D'}</span>
                        </div>
                        <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-950/30 rounded-2xl flex items-center justify-center text-emerald-500">
                            <Coins size={24} />
                        </div>
                    </div>

                    {/* Margen Estimado */}
                    <div className="bg-white dark:bg-slate-800 p-5 rounded-3xl border border-slate-200/60 dark:border-slate-700/40 shadow-sm flex items-center justify-between">
                        <div className="space-y-1">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Margen Neto Estimado</span>
                            <span className="text-2xl font-black text-blue-600 dark:text-blue-400 tabular-nums">${metrics.profitUsd.toFixed(2)}</span>
                            <span className="text-[10px] text-slate-400 block font-medium">Descontando costo de compra</span>
                        </div>
                        <div className="w-12 h-12 bg-blue-50 dark:bg-blue-950/30 rounded-2xl flex items-center justify-center text-blue-500">
                            <TrendingUp size={24} />
                        </div>
                    </div>

                    {/* Transacciones y Cajero */}
                    <div className="bg-white dark:bg-slate-800 p-5 rounded-3xl border border-slate-200/60 dark:border-slate-700/40 shadow-sm flex items-center justify-between">
                        <div className="space-y-1">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Cajero en Caja</span>
                            <span className="text-lg font-black text-slate-800 dark:text-white truncate max-w-[150px] block">{activeCashier.nombre}</span>
                            <span className="text-[10px] font-black text-slate-400 uppercase">{metrics.count} {metrics.count === 1 ? 'venta hoy' : 'ventas hoy'}</span>
                        </div>
                        <div className="w-12 h-12 bg-slate-50 dark:bg-slate-700/30 rounded-2xl flex items-center justify-center text-slate-400">
                            <Users size={24} />
                        </div>
                    </div>
                </div>

                {/* Dashboard Principal de Columnas */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Columna Izquierda: Listado de Ventas en Vivo */}
                    <div className="lg:col-span-2 space-y-4">
                        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200/60 dark:border-slate-700/40 p-6 shadow-sm">
                            <h3 className="text-sm font-black text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                <FileText size={18} className="text-slate-400" />
                                Ventas en Tiempo Real
                            </h3>
                            
                            {loadingData || syncLoading ? (
                                <div className="py-8 flex justify-center text-slate-400 gap-2 items-center">
                                    <RefreshCw className="animate-spin" size={18} />
                                    <span className="text-xs font-bold">Cargando transacciones...</span>
                                </div>
                            ) : todaySales.length === 0 ? (
                                <div className="py-12 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">
                                    <Clock size={36} className="mx-auto text-slate-300 mb-2" />
                                    <p className="text-xs font-black">No se han registrado ventas hoy</p>
                                    <p className="text-[10px] text-slate-400 mt-1">Las ventas de la caja aparecerán aquí al instante.</p>
                                </div>
                            ) : (
                                <div className="space-y-3 max-h-[550px] overflow-y-auto pr-1">
                                    {todaySales.slice().reverse().map(sale => (
                                        <div 
                                            key={sale.id}
                                            className="p-4 border border-slate-100 dark:border-slate-700/50 hover:border-slate-200 dark:hover:border-slate-700 rounded-2xl bg-slate-50/50 dark:bg-slate-900/30 flex justify-between items-start transition-colors"
                                        >
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400">
                                                        #{sale.id.slice(-4).toUpperCase()}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400 font-bold">{formatTime(sale.timestamp)}</span>
                                                </div>
                                                <p className="text-xs font-black text-slate-700 dark:text-slate-200 mt-1.5">
                                                    {sale.items?.map(i => `${i.name} (x${i.qty})`).join(', ') || 'Venta de productos'}
                                                </p>
                                                <div className="flex gap-2 items-center mt-1">
                                                    <span className="text-[10px] font-black text-slate-400 uppercase">{sale.metodoPago || 'Efectivo'}</span>
                                                    {sale.clientName && (
                                                        <span className="text-[10px] text-slate-400 font-bold">• Cliente: {sale.clientName}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-right space-y-0.5">
                                                <span className="text-sm font-black text-slate-800 dark:text-white block">${(sale.totalUsd || 0).toFixed(2)}</span>
                                                <span className="text-[10px] font-bold text-slate-400 block">{formatBs(sale.totalBs || 0)} Bs</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Columna Derecha: Inventario Crítico y Bitácora */}
                    <div className="space-y-6">
                        {/* Productos Sin Stock */}
                        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200/60 dark:border-slate-700/40 p-6 shadow-sm">
                            <h3 className="text-sm font-black text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                <Package size={18} className="text-rose-500" />
                                Stock Crítico (Agotados)
                            </h3>

                            {criticalProducts.length === 0 ? (
                                <div className="py-6 text-center text-slate-400">
                                    <p className="text-xs font-black text-emerald-600 dark:text-emerald-400">¡Todo en orden!</p>
                                    <p className="text-[10px] text-slate-400 mt-0.5">No hay productos sin inventario.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {criticalProducts.map(prod => (
                                        <div key={prod.id} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-700/50 last:border-0">
                                            <div className="min-w-0 pr-2">
                                                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block truncate">{prod.name}</span>
                                                <span className="text-[10px] text-slate-400">Precio: ${prod.price?.toFixed(2)}</span>
                                            </div>
                                            <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 shrink-0">
                                                Agotado
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Registro de Auditoría (Bitácora) */}
                        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200/60 dark:border-slate-700/40 p-6 shadow-sm">
                            <h3 className="text-sm font-black text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                <AlertTriangle size={18} className="text-amber-500" />
                                Bitácora de Acciones
                            </h3>

                            {auditLogs.length === 0 ? (
                                <div className="py-8 text-center text-slate-400">
                                    <p className="text-xs font-black">Sin actividad registrada</p>
                                </div>
                            ) : (
                                <div className="space-y-3.5 max-h-[300px] overflow-y-auto pr-1">
                                    {auditLogs.map(log => (
                                        <div key={log.id} className="text-[11px] leading-normal border-l-2 border-slate-200 dark:border-slate-700 pl-3 space-y-0.5">
                                            <div className="flex justify-between text-slate-400 font-bold">
                                                <span>{log.user || 'Sistema'}</span>
                                                <span>{formatTime(log.timestamp)}</span>
                                            </div>
                                            <p className="text-slate-600 dark:text-slate-300 font-medium">{log.details}</p>
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
