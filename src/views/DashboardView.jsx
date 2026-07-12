// v1.2.0: Rebrand al design system "Precios al Día" — shadow-tone-sm en cards, font-display en totales, text-accent para Bs (BCV-derived), reveal-on-scroll.
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { processVoidSale } from '../utils/voidSaleProcessor';
import { storageService } from '../utils/storageService';
import { showToast } from '../components/Toast';
import { BarChart3, TrendingUp, Package, AlertTriangle, ShoppingCart, Store, Users, Settings, LogOut } from 'lucide-react';
import { formatBs, formatCop } from '../utils/calculatorUtils';
import DashboardStats from '../components/Dashboard/DashboardStats';
import DashboardPaymentBreakdown from '../components/Dashboard/DashboardPaymentBreakdown';
import SalesHistory from '../components/Dashboard/SalesHistory';
import SalesChart from '../components/Dashboard/SalesChart';
import ConfirmModal from '../components/ConfirmModal';
import CierreCajaWizard from '../components/Dashboard/CierreCajaWizard';
import CierreCajaSummaryModal from '../components/Dashboard/CierreCajaSummaryModal';
import { generateTicketPDF, printThermalTicket } from '../utils/ticketGenerator';
import { shareSaleWhatsApp } from '../utils/dashboardActions';
import { generateDailyClosePDF } from '../utils/dailyCloseGenerator';
import { useNotifications } from '../hooks/useNotifications';
import SyncStatus from '../components/SyncStatus';
import { useProductContext } from '../context/ProductContext';
import { useCart } from '../context/CartContext';
import { useSecurity } from '../hooks/useSecurity';
import { useAudit } from '../hooks/useAudit';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { getLocalISODate } from '../utils/dateHelpers';
import Skeleton from '../components/Skeleton';
import { useDashboardData } from '../hooks/useDashboardData';
import { useDashboardMetrics } from '../hooks/useDashboardMetrics';
import { TicketClientModal, DeleteHistoryModal, RecycleOfferModal } from '../components/Dashboard/DashboardModals';
import { useReveal } from '../hooks/useReveal';
import MonitorView from './MonitorView';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

const SALES_KEY = 'bodega_sales_v1';
export default function DashboardView({ rates, triggerHaptic, onNavigate, theme, toggleTheme, isActive }) {
    const { notifyCierrePendiente, requestPermission } = useNotifications();
    const { deviceId } = useSecurity();
    const isAdmin = true;
    const isCajero = useAuthStore(s => s.requireLogin && s.usuarioActivo?.rol === 'CAJERO');
    const { log: auditLog } = useAudit();
    const { products, setProducts, isLoadingProducts, effectiveRate: bcvRate, copEnabled, copPrimary, tasaCop } = useProductContext();
    const { loadCart } = useCart();
    
    // Auth actions
    const logout = useAuthStore(s => s.logout);
    const requireLogin = useAuthStore(s => s.requireLogin);
    const usuarioActivo = useAuthStore(s => s.usuarioActivo);

    // Data loading
    const { sales, setSales, customers, setCustomers, isLoadingLocal, refreshData } = useDashboardData(isActive, requestPermission);
    const isLoading = isLoadingProducts || isLoadingLocal;

    // UI state
    const [showMonitor, setShowMonitor] = useState(false);
    const { isOnline } = useOfflineQueue();
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [voidSaleTarget, setVoidSaleTarget] = useState(null);
    const [isCashReconOpen, setIsCashReconOpen] = useState(false);
    const [ticketPendingSale, setTicketPendingSale] = useState(null);
    const [ticketClientName, setTicketClientName] = useState('');
    const [ticketClientPhone, setTicketClientPhone] = useState('');
    const [ticketClientDocument, setTicketClientDocument] = useState('');
    const [recycleOffer, setRecycleOffer] = useState(null);
    const [pullDistance, setPullDistance] = useState(0);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isScrolled, setIsScrolled] = useState(false);
    const [selectedChartDate, setSelectedChartDate] = useState(null);
    const [showTopDeudas, setShowTopDeudas] = useState(false);
    const [showCierreSummary, setShowCierreSummary] = useState(false);
    const [cierreSummaryData, setCierreSummaryData] = useState(null);
    const touchStartY = useRef(0);
    const scrollRef = useRef(null);
    // v1.2.0: reveal-on-scroll para cards de stats y secciones principales.
    const revealRef = useReveal();
    // Combina scrollRef (pull-to-refresh) + revealRef (IntersectionObserver) en un solo nodo.
    const setRootRef = (node) => {
        scrollRef.current = node;
        revealRef.current = node;
    };

    // Escuchar el scroll del contenedor <main> abuelo
    useEffect(() => {
        const mainEl = document.querySelector('main');
        const handleScroll = (e) => {
            if (mainEl) {
                setIsScrolled(mainEl.scrollTop > 10);
            }
        };
        if (mainEl) {
            mainEl.addEventListener('scroll', handleScroll);
        }
        return () => {
            if (mainEl) {
                mainEl.removeEventListener('scroll', handleScroll);
            }
        };
    }, []);

    // Saneamiento de ventas para corregir de forma retroactiva precios erróneos (COP asignados como USD por bug heredado)
    useEffect(() => {
        try {
            const rawSales = localStorage.getItem('bodega_sales_v1');
            const rawProducts = localStorage.getItem('bodega_products_v1');
            if (!rawSales || !rawProducts) return;
            const sales = JSON.parse(rawSales);
            const products = JSON.parse(rawProducts);
            let changed = false;

            const fixedSales = sales.map(sale => {
                if (!sale.items) return sale;
                let saleChanged = false;
                const fixedItems = sale.items.map(item => {
                    const prod = products.find(p => p.id === item.id || p.name === item.name);
                    if (prod && item.priceUsd > 50 && prod.priceUsdt && parseFloat(prod.priceUsdt) < 20) {
                        saleChanged = true;
                        changed = true;
                        return {
                            ...item,
                            priceUsd: parseFloat(prod.priceUsdt)
                        };
                    }
                    return item;
                });

                if (saleChanged) {
                    const totalUsd = fixedItems.reduce((sum, i) => sum + (i.priceUsd * i.qty), 0);
                    const totalBs = sale.rate ? totalUsd * sale.rate : sale.totalBs;
                    return {
                        ...sale,
                        items: fixedItems,
                        totalUsd: parseFloat(totalUsd.toFixed(2)),
                        totalBs: parseFloat(totalBs.toFixed(2))
                    };
                }
                return sale;
            });

            if (changed) {
                localStorage.setItem('bodega_sales_v1', JSON.stringify(fixedSales));
                window.location.reload();
            }
        } catch (e) {
            console.error('Error al sanear ventas:', e);
        }
    }, []);

    // Reloj digital y fecha en tiempo real
    const [currentTime, setCurrentTime] = useState(new Date());
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const timeString = currentTime.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true });
    const dateString = currentTime.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' });
    const formattedDate = dateString.charAt(0).toUpperCase() + dateString.slice(1);

    // Metrics
    const {
        today, todaySales, todayCashFlow, todayApertura,
        todayTotalBs, todayTotalUsd, todayTotalCop, todayItemsSold,
        todayExpenses, todayExpensesUsd, todayProfit,
        getRecentSales, weekData, lowStockProducts,
        totalDeudas, topProducts, paymentBreakdown, todayTopProducts,
    } = useDashboardMetrics(sales, customers, products, bcvRate);

    const recentSales = useMemo(() => getRecentSales(selectedChartDate), [getRecentSales, selectedChartDate]);

    // Limpiar filtro de fecha al salir de la pestaña de Inicio
    useEffect(() => {
        if (!isActive) {
            setSelectedChartDate(null);
        }
    }, [isActive]);

    // Notificar cierre de caja pendiente (>7pm con ventas o cobros sin cerrar)
    useEffect(() => {
        if (todayCashFlow.length > 0) {
            const ventasHoy = todayCashFlow.filter(s => s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA');
            const deudasHoy = todayCashFlow.filter(s => s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA');
            notifyCierrePendiente({
                salesCount: ventasHoy.length || todayCashFlow.length,
                totalUsd: todayTotalUsd,
                totalBs: todayTotalBs,
                totalDeudas,
                deudasCount: deudasHoy.length,
            });
        }
    }, [todayCashFlow.length, notifyCierrePendiente, todayTotalUsd, todayTotalBs, totalDeudas]);

    // ── Funciones de Historial Avanzado ──
    const handleVoidSale = async (sale) => {
        setVoidSaleTarget(sale);
    };

    const confirmVoidSale = async () => {
        const sale = voidSaleTarget;
        if (!sale) return;
        setVoidSaleTarget(null);

        try {
            const { updatedSales, updatedProducts, updatedCustomers } = await processVoidSale(sale, sales, products);
            setSales(updatedSales);
            setProducts(updatedProducts);
            setCustomers(updatedCustomers);
            showToast('Venta anulada con éxito', 'success');
            setRecycleOffer(sale);
            
            // Notificar a toda la app para refrescar métricas
            window.dispatchEvent(new CustomEvent('sales-updated'));
        } catch (error) {
            console.error('Error anulando venta:', error);
            showToast('Hubo un problema anulando la venta', 'error');
        }
    };

    const handleShareWhatsApp = (sale) => {
        const saleCustomer = sale.customerId ? customers.find(c => c.id === sale.customerId) : null;
        shareSaleWhatsApp(sale, saleCustomer, bcvRate);
    };

    const handleDownloadPDF = (sale) => {
        triggerHaptic();
        generateTicketPDF(sale, bcvRate);
    };

    const handlePrintTicket = (sale) => {
        triggerHaptic();
        printThermalTicket(sale, bcvRate);
    };

    // ── Registrar cliente para ticket ──
    const handleRegisterClientForTicket = async () => {
        if (!ticketClientName.trim() || !ticketPendingSale) return;

        const newCustomer = {
            id: crypto.randomUUID(),
            name: ticketClientName.trim(),
            documentId: ticketClientDocument.trim() || '',
            phone: ticketClientPhone.trim() || '',
            deuda: 0,
            favor: 0,
            createdAt: new Date().toISOString(),
        };

        const updatedCustomers = [...customers, newCustomer];
        setCustomers(updatedCustomers);
        await storageService.setItem('bodega_customers_v1', updatedCustomers);

        const updatedSale = {
            ...ticketPendingSale,
            customerId: newCustomer.id,
            customerName: newCustomer.name,
            customerPhone: newCustomer.phone,
        };
        const updatedSales = sales.map(s => s.id === updatedSale.id ? updatedSale : s);
        setSales(updatedSales);
        await storageService.setItem(SALES_KEY, updatedSales);

        setTicketPendingSale(null);
        setTicketClientName('');
        setTicketClientPhone('');
        setTicketClientDocument('');
        handleShareWhatsApp(updatedSale);
    };

    // Handler: Cierre de Caja
    const handleDailyClose = () => {
        triggerHaptic && triggerHaptic();
        if (todayCashFlow.length === 0 && todaySales.length === 0) {
            showToast('No hay movimientos hoy para cerrar caja', 'error');
            return;
        }
        setIsCashReconOpen(true);
    };

    const handleConfirmCashRecon = async (reconData) => {
        let summaryObj = null;
        const activeUser = useAuthStore.getState().usuarioActivo;

        if (todayCashFlow.length > 0 || todaySales.length > 0) {
            const allTodayForReport = sales.filter(s => {
                const saleLocalDay = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : getLocalISODate(new Date());
                return saleLocalDay === today && !s.cajaCerrada && s.tipo !== 'APERTURA_CAJA';
            });
            const salesForPDF = todayCashFlow.filter(s => s.tipo !== 'APERTURA_CAJA');

            summaryObj = {
                sales: salesForPDF,
                allSales: allTodayForReport,
                bcvRate,
                paymentBreakdown,
                topProducts: todayTopProducts,
                todayTotalUsd,
                todayTotalBs,
                todayProfit,
                todayItemsSold,
                reconData,
                apertura: todayApertura,
                copEnabled,
                tasaCop,
            };
            setCierreSummaryData(summaryObj);
        }

        const currentCierreId = new Date().getTime();
        const existingCloses = sales.filter(s => s.tipo === 'REGISTRO_CIERRE');
        const cierreNumber = existingCloses.reduce((mx, s) => Math.max(mx, s.cierreNumber || 0), 0) + 1;
        const validTiposParaCerrar = ['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA', 'COBRO_DEUDA', 'PAGO_PROVEEDOR', 'APERTURA_CAJA'];
        
        // Registrar el cierre formalmente en el log de transacciones para sincronización con el supervisor
        let registroCierre = null;
        if (summaryObj) {
            registroCierre = {
                id: `cierre_${currentCierreId}`,
                tipo: 'REGISTRO_CIERRE',
                cierreId: currentCierreId,
                cierreNumber: cierreNumber,
                timestamp: new Date().toISOString(),
                cajaCerrada: true,
                summary: {
                    todayTotalUsd,
                    todayTotalBs,
                    todayProfit,
                    todayItemsSold,
                    reconData,
                    copEnabled,
                    tasaCop,
                    cashier: {
                        nombre: activeUser?.nombre || 'Cajero',
                        rol: activeUser?.rol || 'CAJERO'
                    }
                }
            };
        }

        const updatedSales = sales.map(s => {
            if (!s.cajaCerrada && validTiposParaCerrar.includes(s.tipo || 'VENTA')) {
                return { ...s, cajaCerrada: true, cierreId: currentCierreId };
            }
            return s;
        });

        if (registroCierre) {
            updatedSales.push(registroCierre);
        }

        await storageService.setItem(SALES_KEY, updatedSales);
        setSales(updatedSales);
        setIsCashReconOpen(false);

        if (summaryObj) {
            setShowCierreSummary(true);
        } else {
            showToast('Cierre de caja completado (Sin movimientos)', 'success');
        }

        auditLog('VENTA', 'CIERRE_CAJA', 'Cierre de caja completado');
    };

    if (isLoading) {
        return (
            <div className="flex-1 p-3 sm:p-6 space-y-4">
                <Skeleton className="h-14 w-40 rounded-2xl" />
                <div className="grid grid-cols-3 gap-3">
                    <Skeleton className="h-24 rounded-2xl" />
                    <Skeleton className="h-24 rounded-2xl" />
                    <Skeleton className="h-24 rounded-2xl" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Skeleton className="h-32 rounded-3xl" />
                    <Skeleton className="h-32 rounded-3xl" />
                </div>
                <Skeleton className="h-48 rounded-3xl" />
                <Skeleton className="h-24 rounded-2xl" />
            </div>
        );
    }

    // Pull-to-refresh handlers
    const handleTouchStart = (e) => {
        // No iniciar pull-to-refresh si el toque viene del botón de logout
        if (e.target.closest('[data-logout-btn]')) return;
        if (scrollRef.current?.scrollTop === 0) {
            touchStartY.current = e.touches[0].clientY;
        }
    };
    const handleTouchMove = (e) => {
        if (scrollRef.current?.scrollTop > 0) return;
        const diff = e.touches[0].clientY - touchStartY.current;
        if (diff > 0) setPullDistance(Math.min(diff * 0.4, 80));
    };
    const handleTouchEnd = async () => {
        if (pullDistance > 60) {
            setIsRefreshing(true);
            await refreshData(setProducts);
            setIsRefreshing(false);
        }
        setPullDistance(0);
    };

    return (
        <div
            ref={setRootRef}
            className="flex flex-col bg-surface-50 dark:bg-surface-950 p-3 sm:p-5 lg:p-6 xl:p-8"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            {/* Pull-to-refresh indicator */}
            {(pullDistance > 0 || isRefreshing) && (
                <div className="flex justify-center pb-3 transition-all" style={{ height: pullDistance > 0 ? pullDistance : 40 }}>
                    <div className={`w-6 h-6 rounded-full border-2 border-slate-300 dark:border-slate-700 border-t-brand ${isRefreshing || pullDistance > 60 ? 'animate-spin-slow' : ''}`}
                        style={{ opacity: Math.min(pullDistance / 60, 1), transform: `rotate(${pullDistance * 4}deg)` }}
                    />
                </div>
            )}

            {/* Header / Top Bar adaptativo */}
            <div className={`sticky top-0 z-20 flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-3 md:mb-5 py-1.5 md:pb-3 md:pt-2 transition-all duration-200 -mx-3 sm:-mx-5 lg:-mx-6 xl:-mx-8 px-3 sm:px-5 lg:px-6 xl:px-8 bg-surface-50/95 dark:bg-surface-950/95 backdrop-blur-md border-b ${isScrolled ? 'border-slate-200/80 dark:border-slate-800/80 shadow-md' : 'border-slate-100 dark:border-slate-800/60'}`}>
                {/* Lado Izquierdo: Logo (centrado en móviles con el doble de tamaño, alineado a la izquierda en PC) */}
                <div className="w-full flex justify-center md:w-auto md:justify-start relative items-center">
                    {/* Botón de Cerrar Sesión — izquierda absoluta en móvil (oculto en PC) */}
                    {requireLogin && usuarioActivo && (
                        <button
                            data-logout-btn
                            onPointerDown={(e) => {
                                e.stopPropagation();
                                triggerHaptic && triggerHaptic();
                                logout();
                            }}
                            className="absolute left-0 top-1/2 -translate-y-1/2 z-30 md:hidden w-10 h-10 rounded-xl bg-slate-100/70 dark:bg-slate-800/60 border border-slate-200/50 dark:border-slate-700/50 flex items-center justify-center text-slate-500 dark:text-slate-400 shadow-sm active:scale-90 hover:bg-slate-200/50 dark:hover:bg-slate-800/80 transition-all cursor-pointer"
                            title={`Cerrar sesión (${usuarioActivo.nombre})`}
                        >
                            <LogOut size={16} strokeWidth={2.5} className="text-slate-500 dark:text-slate-350 translate-x-[0.5px]" />
                        </button>
                    )}

                    <div className="flex items-center justify-center gap-3">
                        <img 
                            src={theme === 'dark' ? './logodark.png' : './logo.png'} 
                            alt="Donde Juancho" 
                            className="h-14 md:h-[150px] w-auto object-contain drop-shadow-sm md:-my-[38px] md:translate-y-[4px]" 
                        />
                    </div>
                    {/* Estatus Sync a la derecha absoluta en móvil, relativo normal en PC */}
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 md:relative md:right-auto md:top-auto md:translate-y-0 md:hidden">
                        <SyncStatus />
                    </div>
                </div>

                {/* Centro en PC: Menú de Navegación Compacto (Acciones Rápidas) */}
                <div className="hidden md:flex items-center justify-center gap-2 bg-slate-100/80 dark:bg-slate-900/50 p-1.5 rounded-2xl border border-slate-200/30 dark:border-slate-800/30">
                    <button 
                        onClick={() => { if (onNavigate) { triggerHaptic(); onNavigate('ventas'); } }} 
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 font-bold text-sm transition-all hover:scale-[1.02] active:scale-95 cursor-pointer"
                    >
                        <ShoppingCart size={18} />
                        <span>Vender</span>
                    </button>
                    <button 
                        onClick={() => { if (onNavigate) { triggerHaptic(); onNavigate('catalogo'); } }} 
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 font-bold text-sm transition-all hover:scale-[1.02] active:scale-95 cursor-pointer"
                    >
                        <Store size={18} />
                        <span>Inventario</span>
                    </button>
                    <button 
                        onClick={() => { if (onNavigate) { triggerHaptic(); onNavigate('clientes'); } }} 
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 font-bold text-sm transition-all hover:scale-[1.02] active:scale-95 cursor-pointer"
                    >
                        <Users size={18} />
                        <span>Clientes</span>
                    </button>
                    <button 
                        onClick={() => { triggerHaptic(); setShowMonitor(true); }} 
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 font-bold text-sm transition-all hover:scale-[1.02] active:scale-95 cursor-pointer"
                    >
                        <TrendingUp size={18} />
                        <span>Monitor</span>
                    </button>
                </div>

                {/* Lado Derecho en PC: Reloj, fecha y Sincronización */}
                <div className="hidden md:flex items-center justify-end gap-4">
                    {/* Botón de Cerrar Sesión en PC (izquierda de hora y fecha) */}
                    {requireLogin && usuarioActivo && (
                        <button
                            onClick={() => { triggerHaptic && triggerHaptic(); logout(); }}
                            className="flex items-center justify-center p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors active:scale-95 cursor-pointer"
                            title={`Cerrar sesión (${usuarioActivo.nombre})`}
                        >
                            <LogOut size={18} strokeWidth={2} />
                        </button>
                    )}

                    <div className="flex flex-col items-end gap-0.5">
                        <span className="text-lg font-display font-black text-slate-800 dark:text-white leading-none">
                            {timeString}
                        </span>
                        <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider leading-none">
                            {formattedDate}
                        </span>
                    </div>
                    <div className="h-6 w-[1px] bg-slate-200 dark:bg-slate-800" />
                    <SyncStatus />
                </div>
            </div>

            {/* Acciones Rápidas en Móvil (Ocultas en PC) */}
            <div className="grid grid-cols-4 gap-2 mb-5 md:hidden">
                <button 
                    onClick={() => { if (onNavigate) { triggerHaptic(); onNavigate('ventas'); } }} 
                    className="bg-brand hover:bg-brand-dark text-white dark:text-slate-950 rounded-xl p-2.5 flex flex-col items-center justify-center gap-1 shadow-tone-sm transition-all cursor-pointer"
                >
                    <ShoppingCart size={18} />
                    <span className="text-[10px] font-bold">Vender</span>
                </button>
                <button 
                    onClick={() => { if (onNavigate) { triggerHaptic(); onNavigate('catalogo'); } }} 
                    className="bg-brand hover:bg-brand-dark text-white dark:text-slate-950 rounded-xl p-2.5 flex flex-col items-center justify-center gap-1 shadow-tone-sm transition-all cursor-pointer"
                >
                    <Store size={18} />
                    <span className="text-[10px] font-bold">Inventario</span>
                </button>
                <button 
                    onClick={() => { if (onNavigate) { triggerHaptic(); onNavigate('clientes'); } }} 
                    className="bg-brand hover:bg-brand-dark text-white dark:text-slate-950 rounded-xl p-2.5 flex flex-col items-center justify-center gap-1 shadow-tone-sm transition-all cursor-pointer"
                >
                    <Users size={18} />
                    <span className="text-[10px] font-bold">Clientes</span>
                </button>
                <button 
                    onClick={() => { triggerHaptic(); setShowMonitor(true); }} 
                    className="bg-brand hover:bg-brand-dark text-white dark:text-slate-950 rounded-xl p-2.5 flex flex-col items-center justify-center gap-1 shadow-tone-sm transition-all cursor-pointer"
                >
                    <TrendingUp size={18} />
                    <span className="text-[10px] font-bold">Monitor</span>
                </button>
            </div>

            {/* ── CAJERO: vista simplificada — v1.2.0: reveal + shadow-tone-sm + font-display en totales ── */}
            {isCajero ? (
                <div className="grid grid-cols-2 gap-3 mb-5">
                    <div className="reveal card !p-4 !rounded-2xl relative overflow-hidden">
                        <div className="absolute -right-4 -top-4 w-16 h-16 bg-brand-light dark:bg-surface-800/10 rounded-full blur-2xl" />
                        <div className="w-9 h-9 bg-brand-light dark:bg-surface-800/30 rounded-xl flex items-center justify-center mb-2">
                            <ShoppingCart size={18} className="text-brand" />
                        </div>
                        <p className="font-outfit text-4xl font-semibold text-surface-700 dark:text-surface-100 leading-none">{todaySales.length}</p>
                        <p className="text-[11px] text-surface-400 mt-1">{todaySales.length === 1 ? 'venta hoy' : 'ventas hoy'}</p>
                    </div>
                    <div className="reveal card !p-4 !rounded-2xl relative overflow-hidden">
                        <div className="absolute -right-4 -top-4 w-16 h-16 bg-emerald-50 dark:bg-emerald-900/10 rounded-full blur-2xl" />
                        <div className="w-9 h-9 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center mb-2">
                            <Package size={18} className="text-emerald-500" />
                        </div>
                        <p className="font-outfit text-4xl font-semibold text-surface-700 dark:text-surface-100 leading-none">{todayItemsSold}</p>
                        <p className="text-[11px] text-surface-400 mt-1">{todayItemsSold === 1 ? 'artículo vendido' : 'artículos vendidos'}</p>
                    </div>
                </div>
            ) : (
            /* ── ADMIN: layout completo ── */
            <div className={`${(lowStockProducts.length > 0 || topProducts.length > 0) ? 'lg:grid lg:grid-cols-[1fr_300px] xl:grid-cols-[1fr_340px] lg:gap-6 lg:items-start' : ''}`}>

            {/* LEFT: Stats + Payment + Chart */}
            <div>
            {/* Stats Cards */}
            <DashboardStats
                deviceId={deviceId}
                todayTotalUsd={todayTotalUsd}
                todayTotalBs={todayTotalBs}
                todayTotalCop={todayTotalCop}
                todaySales={todaySales}
                todayItemsSold={todayItemsSold}
                todayExpenses={todayExpenses}
                todayExpensesUsd={todayExpensesUsd}
                todayProfit={todayProfit}
                bcvRate={bcvRate}
                todayCashFlow={todayCashFlow}
                totalDeudas={totalDeudas}
                showTopDeudas={showTopDeudas}
                setShowTopDeudas={setShowTopDeudas}
                triggerHaptic={triggerHaptic}
                onDailyClose={handleDailyClose}
                copEnabled={copEnabled}
                copPrimary={copPrimary}
                tasaCop={tasaCop}
                onTasaClick={() => setShowMonitor(true)}
            />

            {/* Pago por Metodo */}
            <DashboardPaymentBreakdown
                paymentBreakdown={paymentBreakdown}
                todayTotalBs={todayTotalBs}
                bcvRate={bcvRate}
                copEnabled={copEnabled}
                copPrimary={copPrimary}
                tasaCop={tasaCop}
            />

            {/* Gráfica semanal */}
            <SalesChart
                weekData={weekData}
                selectedDate={selectedChartDate}
                copEnabled={copEnabled}
                copPrimary={copPrimary}
                tasaCop={tasaCop}
                bcvRate={bcvRate}
                onDayClick={(date) => {
                    triggerHaptic();
                    setSelectedChartDate(prev => prev === date ? null : date);
                    setTimeout(() => {
                        window.scrollBy({ top: 150, behavior: 'smooth' });
                    }, 50);
                }}
            />

            </div>{/* end LEFT column */}

            {/* RIGHT: Low stock + Top products */}
            <div>
            {/* Bajo Stock — v1.2.0: reveal + shadow-tone-sm */}
            {lowStockProducts.length > 0 && (
                <div className="bg-surface dark:bg-surface-100 rounded-2xl p-4 border border-amber-200 dark:border-amber-800/30 shadow-tone-sm mb-5">
                    <h3 className="text-xs font-bold text-amber-500 uppercase mb-3 flex items-center gap-1">
                        <AlertTriangle size={12} /> Bajo Stock ({lowStockProducts.length})
                    </h3>
                    <div className="space-y-2">
                        {lowStockProducts.map(p => (
                            <div key={p.id} className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden">
                                    {p.image ? <img src={p.image} className="w-full h-full object-contain" /> : <Package size={14} className="text-slate-400" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{p.name}</p>
                                </div>
                                <span className={`text-xs font-black px-2 py-0.5 rounded-full ${(p.stock ?? 0) === 0 ? 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400' : 'bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400'
                                    }`}>
                                    {p.stock ?? 0} {p.unit === 'kg' ? 'kg' : p.unit === 'litro' ? 'lt' : 'ud'}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Top Productos — v1.2.0: reveal + shadow-tone-sm, text-accent para Bs (BCV-derived) */}
            {topProducts.length > 0 && (
                <div className="bg-surface dark:bg-surface-100 rounded-2xl p-4 border border-surface-200 dark:border-surface-700 shadow-tone-sm mb-5">
                    <h3 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-1">
                        <TrendingUp size={12} /> Más Vendidos
                    </h3>
                    <div className="space-y-2">
                        {topProducts.map((p, i) => (
                            <div key={p.name} className="flex items-center gap-3">
                                <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black ${i === 0 ? 'bg-amber-100 text-amber-600' : i === 1 ? 'bg-slate-200 text-slate-500' : 'bg-orange-50 text-orange-400'
                                    }`}>{i + 1}</span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{p.name}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{p.qty} vendidos</p>
                                    <p className={`text-[10px] ${copEnabled && copPrimary ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>
                                        {copEnabled && copPrimary && tasaCop > 0
                                            ? `${formatCop(p.revenue * tasaCop)} COP`
                                            : `$${p.revenue.toFixed(2)}`}
                                    </p>
                                    {/* v1.2.0: Bs (BCV-derived) destacado con text-accent-600 */}
                                    {copEnabled && tasaCop > 0
                                        ? <p className="text-[10px] text-accent-600 dark:text-accent-400">
                                            {copPrimary
                                                ? `$${p.revenue.toFixed(2)} · ${formatBs(p.revenue * bcvRate)} Bs`
                                                : `${formatCop(p.revenue * tasaCop)} COP · ${formatBs(p.revenue * bcvRate)} Bs`}
                                          </p>
                                        : <p className="text-[10px] text-accent-600 dark:text-accent-400">{formatBs(p.revenue * bcvRate)} Bs</p>
                                    }
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            </div>{/* end RIGHT column */}
            </div>/* end two-col grid */
            )}{/* end isCajero conditional */}

            <SalesHistory
                sales={sales}
                recentSales={recentSales}
                bcvRate={bcvRate}
                selectedDate={selectedChartDate}
                selectedChartDate={selectedChartDate}
                onClearDateFilter={() => setSelectedChartDate(null)}
                totalSalesCount={sales.filter(s => s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA').length}
                isAdmin={!isCajero}
                onVoidSale={handleVoidSale}
                onShareWhatsApp={handleShareWhatsApp}
                onDownloadPDF={handleDownloadPDF}
                onOpenDeleteModal={() => setIsDeleteModalOpen(true)}
                onRequestClientForTicket={(sale) => {
                    triggerHaptic && triggerHaptic();
                    setTicketPendingSale(sale);
                }}
                onRecycleSale={(sale) => {
                    triggerHaptic && triggerHaptic();
                    loadCart(sale.items);
                    if (onNavigate) onNavigate('ventas');
                }}
                onPrintTicket={handlePrintTicket}
                copEnabled={copEnabled}
                copPrimary={copPrimary}
                tasaCop={tasaCop}
            />

            {/* Empty state */}
            {sales.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-300 dark:text-slate-700 py-10 space-y-3">
                    <BarChart3 size={64} strokeWidth={1} />
                    <p className="text-sm font-medium">Sin datos aún</p>
                    <p className="text-xs text-slate-400">Las estadísticas aparecerán cuando hagas tu primera venta</p>
                </div>
            )}

            {/* Modals */}
            <TicketClientModal
                ticketPendingSale={ticketPendingSale}
                ticketClientName={ticketClientName}
                ticketClientPhone={ticketClientPhone}
                ticketClientDocument={ticketClientDocument}
                setTicketClientName={setTicketClientName}
                setTicketClientPhone={setTicketClientPhone}
                setTicketClientDocument={setTicketClientDocument}
                onClose={() => { setTicketPendingSale(null); setTicketClientName(''); setTicketClientPhone(''); setTicketClientDocument(''); }}
                onRegister={handleRegisterClientForTicket}
            />

            <DeleteHistoryModal
                isOpen={isDeleteModalOpen}
                deleteConfirmText={deleteConfirmText}
                setDeleteConfirmText={setDeleteConfirmText}
                onClose={() => { setIsDeleteModalOpen(false); setDeleteConfirmText(''); }}
                onConfirm={async () => {
                    if (deleteConfirmText.trim().toUpperCase() === 'BORRAR') {
                        await storageService.setItem(SALES_KEY, []);
                        setIsDeleteModalOpen(false);
                        setDeleteConfirmText('');
                        window.location.reload();
                    }
                }}
            />

            <RecycleOfferModal
                recycleOffer={recycleOffer}
                onClose={() => setRecycleOffer(null)}
                onRecycle={() => {
                    loadCart(recycleOffer.items);
                    setRecycleOffer(null);
                    if (onNavigate) onNavigate('ventas');
                }}
            />

            {/* Modal Confirmación: Anular Venta */}
            <ConfirmModal
                isOpen={!!voidSaleTarget}
                onClose={() => setVoidSaleTarget(null)}
                onConfirm={confirmVoidSale}
                title={`Anular venta #${voidSaleTarget?.id?.substring(0, 6).toUpperCase() || ''}`}
                message={`Esta acción:\n• Marcará la venta como ANULADA\n• Devolverá el stock a la bodega\n• Revertirá deudas o saldos a favor\n\nEsta acción no se puede deshacer.`}
                confirmText="Sí, anular"
                variant="danger"
            />
            <CierreCajaWizard
                isOpen={isCashReconOpen}
                onClose={() => setIsCashReconOpen(false)}
                onConfirm={handleConfirmCashRecon}
                todaySales={todaySales}
                todayTotalUsd={todayTotalUsd}
                todayTotalBs={todayTotalBs}
                todayTotalCop={todayTotalCop}
                todayProfit={todayProfit}
                todayItemsSold={todayItemsSold}
                todayExpensesUsd={todayExpensesUsd}
                paymentBreakdown={paymentBreakdown}
                todayTopProducts={todayTopProducts}
                bcvRate={bcvRate}
                copEnabled={copEnabled}
                copPrimary={copPrimary}
                tasaCop={tasaCop}
            />
            <CierreCajaSummaryModal
                isOpen={showCierreSummary}
                onClose={() => setShowCierreSummary(false)}
                summaryData={cierreSummaryData}
                onPrint={() => {
                    generateDailyClosePDF({ ...cierreSummaryData, action: 'print' });
                }}
                onDownload={() => {
                    generateDailyClosePDF({ ...cierreSummaryData, action: 'download' });
                }}
                onShare={() => {
                    generateDailyClosePDF({ ...cierreSummaryData, action: 'share' });
                }}
            />
            {showMonitor && (
                <div className="fixed inset-0 z-[150] bg-[#080E1C] flex flex-col">
                    <MonitorView
                        rates={rates}
                        loading={false}
                        isOffline={!isOnline}
                        onRefresh={() => refreshData(setProducts)}
                        toggleTheme={toggleTheme}
                        theme={theme}
                        addLog={console.log}
                        triggerHaptic={triggerHaptic}
                        onClose={() => setShowMonitor(false)}
                    />
                </div>
            )}
        </div>
    );
}
