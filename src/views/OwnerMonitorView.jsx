import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useProductContext } from '../context/ProductContext';
import { useMonitorSync } from '../hooks/useMonitorSync';
import { storageService } from '../utils/storageService';
import { supabaseCloud } from '../config/supabaseCloud';
import { showToast } from '../components/Toast';
import { calculateComboStock, getEffectiveCostUsd } from '../utils/productProcessor';
import SupervisorRateModal from '../components/SupervisorRateModal';
import RemoteProductFormModal from '../components/Monitor/RemoteProductFormModal';
import {
    TrendingUp, Package, Coins, Users, LogOut,
    RefreshCw, Wifi, WifiOff, Clock, FileText, DollarSign,
    Wallet, CreditCard, Smartphone, Banknote, ArrowDownRight,
    ShieldCheck, Hash, AlertTriangle, Search, X, ChevronLeft, ChevronRight,
    MinusCircle, PlusCircle, Pencil, Trash2, Plus, UploadCloud
} from 'lucide-react';
import { formatBs, formatCop } from '../utils/calculatorUtils';
import { getLocalISODate } from '../utils/dateHelpers';
import { getPaymentLabel, toTitleCase } from '../config/paymentMethods';

// Helper: icon por método de pago
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

const PENDING_KEY = 'dj_pending_inventory_changes_v1';

export default function OwnerMonitorView({ theme, toggleTheme, triggerHaptic }) {
    const pairedDeviceId = localStorage.getItem('dj_paired_device_id');
    const { products, effectiveRate: bcvRate, copEnabled, tasaCop, rates } = useProductContext();
    const { isConnected, lastSync, loading: syncLoading, triggerRefresh } = useMonitorSync(pairedDeviceId);

    const [sales, setSales] = useState([]);
    const [activeCashier, setActiveCashier] = useState({ nombre: 'Ninguno', rol: '' });
    const [loadingData, setLoadingData] = useState(true);
    const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
    const [showRateModal, setShowRateModal] = useState(false);
    const [viewTab, setViewTab] = useState('activo'); // 'activo' o 'cierres'
    const [selectedCierreId, setSelectedCierreId] = useState(null);
    const [searchTermInventario, setSearchTermInventario] = useState('');
    const [filterStockInventario, setFilterStockInventario] = useState('todos'); // 'todos', 'bajo', 'agotado'

    // ── Edición remota de inventario (comandos supervisor → caja) ──
    const [showRemoteForm, setShowRemoteForm] = useState(false);
    const [remoteEditingProduct, setRemoteEditingProduct] = useState(null);
    const [remoteDeleteTarget, setRemoteDeleteTarget] = useState(null);
    const [stockAdjustProduct, setStockAdjustProduct] = useState(null);
    const [pendingChanges, setPendingChanges] = useState(() => {
        try {
            const raw = localStorage.getItem(PENDING_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch { return []; }
    });
    const [uploading, setUploading] = useState(false);

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
        setUploading(true);
        const monitorDeviceId = localStorage.getItem('dj_device_id') || 'monitor_web';
        const remaining = [];
        let sent = 0;
        for (const change of pendingChanges) {
            try {
                const { error } = await supabaseCloud
                    .from('supervisor_commands')
                    .insert({
                        primary_device_id: pairedDeviceId,
                        monitor_device_id: monitorDeviceId,
                        command_type: 'inventory_update',
                        payload: {
                            action: change.action,
                            productId: change.productId,
                            data: change.data,
                            issuedAt: change.queuedAt,
                        },
                        status: 'pending'
                    });
                if (error) throw error;
                sent += 1;
            } catch (err) {
                console.error('[OwnerMonitor] Error al subir cambio:', err);
                remaining.push(change);
            }
        }
        persistPending(remaining);
        setUploading(false);
        if (remaining.length === 0) {
            showToast(`${sent} cambio${sent !== 1 ? 's' : ''} enviado${sent !== 1 ? 's' : ''} a la caja — se reflejarán al sincronizar`, 'success');
        } else {
            showToast(`${sent} enviados · ${remaining.length} fallaron y siguen en cola`, 'warning');
        }
    };

    const discardPendingChanges = () => {
        persistPending([]);
        showToast('Cambios pendientes descartados', 'info');
    };

    // Proyección instantánea en memoria de los productos + cambios en cola
    const projectedProducts = useMemo(() => {
        if (!products) return [];

        let list = products.map(p => {
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
            merged.stock = Math.max(0, baseStock + stockDelta);
            merged._rawStock = baseStock;
            merged._stockDelta = stockDelta;
            merged._isQueuedDelete = isDeleted;
            merged._isQueuedEdit = !!editChange;

            return merged;
        });

        // Excluir de la vista los eliminados en cola
        list = list.filter(p => !p._isQueuedDelete);

        // Agregar a la vista los creados en cola (nuevos)
        const addChanges = pendingChanges.filter(c => c.action === 'add');
        for (const addChange of addChanges) {
            if (addChange.data) {
                list.unshift({
                    ...addChange.data,
                    id: addChange.productId || addChange.data.id || `temp_${Date.now()}`,
                    name: addChange.data.name || 'Nuevo Producto',
                    category: addChange.data.category || 'Varios',
                    stock: Number(addChange.data.stock || 0),
                    priceUsd: Number(addChange.data.priceUsd || addChange.data.price || 0),
                    costUsd: Number(addChange.data.costUsd || addChange.data.costPrice || 0),
                    _isQueuedNew: true
                });
            }
        }

        // Recalcular stock dinámico y costo efectivo para combos basándonos en la proyección de sus insumos
        list = list.map(p => {
            const effCost = getEffectiveCostUsd(p, list);
            if (p.isCombo || p.type === 'combo' || p.category === 'combo') {
                const dynamicStock = calculateComboStock(p, list);
                return { ...p, stock: dynamicStock, _isCombo: true, _effectiveCost: effCost, costUsd: p.costUsd || effCost };
            }
            return { ...p, _effectiveCost: effCost, costUsd: p.costUsd || effCost };
        });

        return list;
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

    // ── TURNO ACTIVO ──
    
    // Apertura de caja del turno activo
    const activeShiftApertura = useMemo(() => {
        const aperturas = sales.filter(s => s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
        if (aperturas.length === 0) return null;
        return aperturas.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
    }, [sales]);

    // Filtrar ventas del turno activo (cajaCerrada !== true)
    const activeShiftSales = useMemo(() => {
        return sales.filter(s => {
            if (s.status === 'ANULADA') return false;
            if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA') return false;
            if (s.cajaCerrada) return false;
            
            // Restringir a transacciones posteriores a la última apertura activa si existe
            if (activeShiftApertura) {
                return new Date(s.timestamp) >= new Date(activeShiftApertura.timestamp);
            }
            return true;
        });
    }, [sales, activeShiftApertura]);

    // Métricas del turno activo
    const activeShiftMetrics = useMemo(() => {
        let usd = 0;
        let bs = 0;
        activeShiftSales.forEach(s => {
            usd += s.totalUsd || 0;
            bs += s.totalBs || 0;
        });

        // Calcular ganancia estimada si los productos tienen costo
        let costSum = 0;
        activeShiftSales.forEach(s => {
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
            count: activeShiftSales.length
        };
    }, [activeShiftSales, products]);

    // Desglose por método de pago del turno activo
    const activeShiftPaymentBreakdown = useMemo(() => {
        const breakdown = {};
        // Incluye ventas, cobros de deuda, y pagos de proveedor en el flujo de caja
        const activeFlow = sales.filter(s => {
            if (s.status === 'ANULADA') return false;
            if (s.cajaCerrada) return false;
            
            // Restringir a transacciones posteriores a la última apertura activa si existe
            if (activeShiftApertura) {
                return new Date(s.timestamp) >= new Date(activeShiftApertura.timestamp);
            }
            return true;
        });

        activeFlow.forEach(sale => {
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

        return Object.entries(breakdown)
            .sort(([, a], [, b]) => b.totalUsd - a.totalUsd);
    }, [sales, activeShiftApertura]);

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

    // Desvincular Monitor
    const handleDisconnect = async () => {
        triggerHaptic?.();
        
        try {
            if (supabaseCloud && pairedDeviceId) {
                await supabaseCloud.rpc('unpair_monitor', { p_device_id: pairedDeviceId });
            }
        } catch (err) {
            console.warn('[OwnerMonitorView] Error al llamar unpair RPC:', err);
        }

        localStorage.removeItem('dj_paired_device_id');
        localStorage.removeItem('dj_pairing_mode');
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

    // Determinar si la caja está actualmente inactiva (sin turno abierto)
    const isShiftActive = activeShiftApertura !== null || activeShiftSales.length > 0;

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-sans pb-12 transition-colors duration-300 overflow-x-hidden">
            {/* Header del Monitor */}
            <header className="sticky top-0 z-50 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-3 sm:px-4 py-2.5 sm:py-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 shadow-sm">
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-2xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white font-bold shrink-0">
                        <ShieldCheck size={18} className="sm:hidden" />
                        <ShieldCheck size={20} className="hidden sm:block" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-xs sm:text-base font-black leading-tight text-slate-800 dark:text-white truncate">Panel de Supervisión</h1>
                        <p className="text-[9px] sm:text-[10px] text-slate-400 font-medium truncate">Monitoreo en vivo • {localStorage.getItem('business_name') || 'Mi Negocio'}</p>
                    </div>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-3 shrink-0 ml-auto sm:ml-0">
                    {/* Status Badge */}
                    <div className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-[9px] sm:text-[10px] font-black tracking-wider uppercase shadow-sm transition-colors duration-300 ${
                        isConnected 
                            ? 'bg-emerald-50 border border-emerald-200/50 text-emerald-600 dark:bg-emerald-950/20 dark:border-emerald-800/30 dark:text-emerald-400' 
                            : 'bg-rose-50 border border-rose-200/50 text-rose-600 dark:bg-rose-950/20 dark:border-rose-800/30 dark:text-rose-400 animate-pulse'
                    }`}>
                        {isConnected ? (
                            <>
                                <Wifi size={11} className="shrink-0" />
                                <span className="hidden sm:inline">En Vivo</span>
                            </>
                        ) : (
                            <>
                                <WifiOff size={11} className="shrink-0" />
                                <span className="hidden sm:inline">Desconectado</span>
                            </>
                        )}
                    </div>

                    <button 
                        onClick={async () => { 
                            triggerHaptic?.(); 
                            await triggerRefresh(); 
                            showToast?.('Datos actualizados', 'success');
                        }}
                        disabled={syncLoading}
                        className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-emerald-400 transition-colors disabled:opacity-50"
                        title="Actualizar Datos"
                    >
                        <RefreshCw size={15} className={syncLoading ? "animate-spin text-emerald-500" : ""} />
                    </button>

                    <button 
                        onClick={() => { triggerHaptic?.(); setShowRateModal(true); }}
                        className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl text-slate-400 hover:text-brand hover:bg-brand-light border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-brand transition-colors"
                        title="Cambiar Tasa Remota"
                    >
                        <TrendingUp size={15} />
                    </button>

                    <button 
                        onClick={() => { triggerHaptic?.(); setShowDisconnectConfirm(true); }}
                        className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-rose-400 transition-colors"
                        title="Desvincular Dispositivo"
                    >
                        <LogOut size={15} />
                    </button>
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
                <div className="bg-slate-200/60 dark:bg-slate-900/60 p-1 rounded-2xl w-full sm:max-w-md shadow-sm">
                    <div className="grid grid-cols-3 gap-1">
                        <button
                            onClick={() => { triggerHaptic?.(); setViewTab('activo'); }}
                            className={`py-2 px-1 text-center font-black rounded-xl transition-all text-[11px] sm:text-xs truncate ${
                                viewTab === 'activo' 
                                    ? 'bg-white dark:bg-slate-800 text-slate-850 dark:text-white shadow-sm' 
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                            }`}
                        >
                            <span className="sm:hidden">Turno Activo</span>
                            <span className="hidden sm:inline">Turno Activo (En Vivo)</span>
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
                            <span className="hidden sm:inline">Cierres de Caja</span>
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
                    </div>
                </div>

                {/* ── SECCIÓN 1: TURNO ACTIVO ── */}
                {viewTab === 'activo' && (
                    <div className="space-y-6">
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
                                                    const pct = activeShiftMetrics.totalUsd > 0 
                                                        ? Math.round((data.totalUsd / activeShiftMetrics.totalUsd) * 100) 
                                                        : 0;

                                                    return (
                                                        <div key={methodId} className="flex items-center gap-3 p-3.5 bg-slate-50/70 dark:bg-slate-800/20 border border-slate-100 dark:border-slate-800/40 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                                                            <div className="w-9 h-9 bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0 shadow-sm">
                                                                <IconComp size={16} />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="text-xs font-black text-slate-700 dark:text-slate-200 truncate">{data.label}</span>
                                                                    <span className="font-outfit text-xs font-black text-slate-800 dark:text-white tabular-nums shrink-0">${data.totalUsd.toFixed(2)}</span>
                                                                </div>
                                                                <div className="flex items-center justify-between gap-2 mt-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-[9px] font-bold text-slate-400">{data.count} {data.count === 1 ? 'transacción' : 'transacciones'}</span>
                                                                        <span className="text-[9px] font-black text-violet-500 bg-violet-50 dark:bg-violet-950/20 dark:text-violet-400 px-1.5 py-0.5 rounded-md">{pct}%</span>
                                                                    </div>
                                                                    <span className="font-outfit text-[10px] font-bold text-slate-400 tabular-nums">{formatBs(data.totalBs)} Bs</span>
                                                                </div>
                                                                <div className="mt-1.5 h-1 bg-slate-200/60 dark:bg-slate-800 rounded-full overflow-hidden">
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
                                                    {activeShiftSales.slice().reverse().map(sale => (
                                                        <div 
                                                            key={sale.id}
                                                            className="p-4 border border-slate-100 dark:border-slate-800/80 hover:border-slate-200 rounded-2xl bg-slate-50/50 dark:bg-slate-800/20 flex justify-between items-start transition-colors"
                                                        >
                                                            <div className="space-y-1 min-w-0 flex-1 pr-3">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400">
                                                                        #{sale.id.slice(-4).toUpperCase()}
                                                                    </span>
                                                                    <span className="text-[10px] text-slate-400 font-bold">{formatTime(sale.timestamp)}</span>
                                                                </div>
                                                                <p className="text-xs font-black text-slate-700 dark:text-slate-200 mt-1.5 truncate">
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
                                                        {activeC.sales.slice().reverse().map(sale => (
                                                            <div key={sale.id} className="p-3.5 border border-slate-100 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-800/20 flex justify-between items-center text-xs">
                                                                    <div className="min-w-0 flex-1 pr-2">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/40">
                                                                                #{sale.id.slice(-4).toUpperCase()}
                                                                            </span>
                                                                            <span className="text-[9px] text-slate-400 font-bold">{formatTime(sale.timestamp)}</span>
                                                                        </div>
                                                                        <p className="font-black text-slate-700 dark:text-slate-250 truncate mt-1">
                                                                            {sale.items?.map(i => `${i.name} (x${i.qty})`).join(', ') || 'Venta de productos'}
                                                                        </p>
                                                                    </div>
                                                                    <div className="text-right shrink-0">
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

                        {/* Barra de Filtro y Búsqueda */}
                        <div className="bg-white dark:bg-slate-900 p-3.5 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col md:flex-row gap-3 sm:gap-4 items-stretch md:items-center justify-between">
                            {/* Top row on mobile: Nuevo button + Search input */}
                            <div className="flex items-center gap-2.5 flex-1">
                                <button
                                    onClick={() => { triggerHaptic?.(); setRemoteEditingProduct(null); setShowRemoteForm(true); }}
                                    className="shrink-0 flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2.5 rounded-2xl bg-brand hover:bg-brand-dark text-white text-[10px] sm:text-xs font-black uppercase tracking-wider shadow-lg shadow-brand/25 transition-all active:scale-95"
                                >
                                    <Plus size={14} strokeWidth={3} /> Nuevo
                                </button>
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

                        {/* Listado de Productos */}
                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm overflow-hidden">
                            {filteredProducts.length === 0 ? (
                                <div className="py-16 text-center text-slate-400 flex flex-col items-center justify-center space-y-3">
                                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 text-slate-300 dark:text-slate-600 rounded-full">
                                        <Package size={36} />
                                    </div>
                                    <div className="space-y-0.5">
                                        <p className="text-xs font-black text-slate-700 dark:text-slate-200">No se encontraron productos</p>
                                        <p className="text-[10px] text-slate-450">Intenta buscando con otro término o cambiando los filtros.</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                                    {paginatedProducts.map((p) => {
                                        const stock = p.stock || 0;
                                        const minStock = p.minStock || 5;
                                        const isAgotado = stock <= 0;
                                        const isBajo = !isAgotado && stock <= minStock;
                                        const itemCost = p._effectiveCost ?? (p.costUsd || p.costPrice || 0);
                                        const profitUsd = Math.max(0, p.priceUsd - itemCost);
                                        const profitPct = p.priceUsd > 0 ? Math.round((profitUsd / p.priceUsd) * 100) : 0;

                                        return (
                                            <div key={p.id} className="p-3.5 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/10 transition-colors">
                                                {/* Izquierda: Info de Producto */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <h4 className="text-xs sm:text-sm font-black text-slate-800 dark:text-white uppercase leading-tight">{p.name}</h4>
                                                        <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full ${
                                                            isAgotado
                                                                ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400'
                                                                : isBajo
                                                                    ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400'
                                                                    : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400'
                                                        }`}>
                                                            {isAgotado ? 'Agotado' : isBajo ? 'Bajo Stock' : 'Disponible'}
                                                        </span>
                                                        {p.sellByBox && (
                                                            <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                                                                📦 Caja{p.boxUnits ? ` ×${p.boxUnits}` : ''}
                                                            </span>
                                                        )}
                                                        {p.sellByHalfBox && (
                                                            <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 dark:bg-purple-950/30 dark:text-purple-400">
                                                                ½ Caja{p.halfBoxUnits ? ` ×${p.halfBoxUnits}` : ''}
                                                            </span>
                                                        )}
                                                        {p._isQueuedNew && (
                                                            <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300">
                                                                Nuevo en cola
                                                            </span>
                                                        )}
                                                        {p._isQueuedEdit && !p._isQueuedNew && (
                                                            <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                                                                Editado en cola
                                                            </span>
                                                        )}
                                                        {hasPendingFor(p.id) && pendingStockDelta(p.id) === 0 && !p._isQueuedEdit && !p._isQueuedNew && (
                                                            <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400 animate-pulse">
                                                                Cambio pendiente
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-1 font-medium flex-wrap">
                                                        {p.barcode && (
                                                            <span className="flex items-center gap-1">
                                                                <Hash size={10} /> {p.barcode}
                                                            </span>
                                                        )}
                                                        <span>Categoría: {toTitleCase(p.category || 'Varios')}</span>
                                                    </div>
                                                </div>

                                                {/* Derecha: Valores y Stock (Responsivo: apilado en móvil, horizontal en desktop) */}
                                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between lg:justify-end gap-3 sm:gap-5 pt-2 lg:pt-0 border-t border-slate-100 dark:border-slate-800/60 lg:border-t-0 shrink-0">
                                                    {/* Costo, Venta, Margen */}
                                                    <div className="grid grid-cols-3 gap-2 sm:gap-4 text-left sm:text-right bg-slate-50/60 dark:bg-slate-950/40 lg:bg-transparent p-2.5 lg:p-0 rounded-2xl">
                                                        {/* Costo */}
                                                        <div>
                                                            <span className="text-[8px] text-slate-400 uppercase font-black block">Costo</span>
                                                            <span className="font-outfit text-xs font-black text-slate-500 tabular-nums">${itemCost.toFixed(2)}</span>
                                                        </div>
                                                        {/* Venta */}
                                                        <div>
                                                            <span className="text-[8px] text-slate-400 uppercase font-black block">Venta (USD/Bs)</span>
                                                            <span className="font-outfit text-xs font-black text-slate-800 dark:text-white tabular-nums block">${p.priceUsd.toFixed(2)}</span>
                                                            <span className="font-outfit text-[8px] text-slate-400 block tabular-nums leading-none mt-0.5">
                                                                {p.priceBsManual > 0
                                                                    ? `${formatBs(p.priceBsManual)} Bs`
                                                                    : bcvRate ? `${formatBs(p.priceUsd * bcvRate)} Bs` : 'N/D'}
                                                            </span>
                                                        </div>
                                                        {/* Ganancia */}
                                                        <div>
                                                            <span className="text-[8px] text-slate-400 uppercase font-black block">Ganancia</span>
                                                            <span className="font-outfit text-xs font-black text-blue-600 dark:text-blue-400 tabular-nums block">${profitUsd.toFixed(2)}</span>
                                                            <span className="text-[8px] text-slate-400 block font-medium leading-none mt-0.5">{profitPct}%</span>
                                                        </div>
                                                    </div>

                                                    {/* Controles de Stock y Acciones */}
                                                    <div className="flex items-center justify-between sm:justify-end gap-2.5">
                                                        {/* Botones +/- y Badge de Stock */}
                                                        {p.isCombo || p.type === 'combo' || p._isCombo ? (
                                                            <div 
                                                                title="El stock de los combos es dinámico y se calcula automáticamente en función del stock disponible de sus insumos componentes."
                                                                className="relative w-24 sm:w-28 text-center py-1.5 px-2 rounded-2xl border border-blue-200/80 bg-blue-50/60 dark:bg-blue-950/30 dark:border-blue-900/50 text-blue-700 dark:text-blue-300 shadow-sm cursor-help"
                                                            >
                                                                <span className="text-[8px] uppercase font-black block leading-none mb-0.5 opacity-80">
                                                                    Combo • Auto
                                                                </span>
                                                                <span className="font-outfit text-xs font-black tabular-nums leading-none">
                                                                    {stock} u
                                                                </span>
                                                                <span className="text-[7px] font-bold block leading-none mt-0.5 opacity-70">
                                                                    (Dinámico)
                                                                </span>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-1.5">
                                                                <button
                                                                    onClick={() => { triggerHaptic?.(); queueInventoryChange('adjust_stock', p.id, { delta: -1 }); }}
                                                                    title="Restar 1 unidad (en cola)"
                                                                    className="w-8 h-8 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 hover:text-rose-500 hover:border-rose-200 transition-colors active:scale-90"
                                                                >
                                                                    <MinusCircle size={14} />
                                                                </button>
                                                                <button
                                                                    onClick={() => { triggerHaptic?.(); setStockAdjustProduct(p); }}
                                                                    title="Toca para ingresar stock (+40, -10) o fijar cantidad exacta"
                                                                    className={`relative w-20 text-center py-1.5 px-2 rounded-2xl border transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-sm ${
                                                                        isAgotado
                                                                            ? 'bg-rose-50/50 border-rose-150/70 text-rose-700 dark:bg-rose-950/20 dark:border-rose-900/30 dark:text-rose-455 hover:border-rose-400'
                                                                            : isBajo
                                                                                ? 'bg-amber-50/50 border-amber-150/70 text-amber-700 dark:bg-amber-950/20 dark:border-amber-900/30 dark:text-amber-455 hover:border-amber-400'
                                                                                : 'bg-slate-50 border-slate-150/70 text-slate-700 dark:bg-slate-850/60 dark:border-slate-800 dark:text-slate-300 hover:border-emerald-400 hover:bg-emerald-50/20'
                                                                    }`}
                                                                >
                                                                    <span className="text-[8px] uppercase font-black block leading-none mb-0.5 text-slate-400 flex items-center justify-center gap-0.5">
                                                                        Stock <Pencil size={7} />
                                                                    </span>
                                                                    <span className="font-outfit text-xs font-black tabular-nums leading-none">
                                                                        {p.isWeight ? `${stock.toFixed(3)} Kg` : `${stock} u`}
                                                                    </span>
                                                                    {p.sellByBox && p.boxUnits > 0 && !p.isWeight && (
                                                                        <span className="text-[7px] font-bold block leading-none mt-0.5 opacity-70 truncate">
                                                                            ≈ {(stock / p.boxUnits).toFixed(1)} cj
                                                                        </span>
                                                                    )}
                                                                    {pendingStockDelta(p.id) !== 0 && (
                                                                        <span className={`absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-full text-[8px] font-black text-white shadow ${pendingStockDelta(p.id) > 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}>
                                                                            {pendingStockDelta(p.id) > 0 ? '+' : ''}{pendingStockDelta(p.id)}
                                                                        </span>
                                                                    )}
                                                                </button>
                                                                <button
                                                                    onClick={() => { triggerHaptic?.(); queueInventoryChange('adjust_stock', p.id, { delta: 1 }); }}
                                                                    title="Sumar 1 unidad (en cola)"
                                                                    className="w-8 h-8 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 hover:text-emerald-500 hover:border-emerald-200 transition-colors active:scale-90"
                                                                >
                                                                    <PlusCircle size={14} />
                                                                </button>
                                                            </div>
                                                        )}

                                                        {/* Botones Editar / Eliminar horizontales */}
                                                        <div className="flex items-center gap-1.5 ml-1">
                                                            <button
                                                                onClick={() => { triggerHaptic?.(); setRemoteEditingProduct(p); setShowRemoteForm(true); }}
                                                                disabled={p.isCombo}
                                                                title={p.isCombo ? 'Los combos se editan desde la caja' : 'Editar (en cola)'}
                                                                className="w-8 h-8 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 hover:text-brand hover:border-brand/40 transition-colors disabled:opacity-30 active:scale-90"
                                                            >
                                                                <Pencil size={13} />
                                                            </button>
                                                            <button
                                                                onClick={() => { triggerHaptic?.(); setRemoteDeleteTarget(p); }}
                                                                title="Eliminar (en cola)"
                                                                className="w-8 h-8 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 hover:text-rose-500 hover:border-rose-200 transition-colors active:scale-90"
                                                            >
                                                                <Trash2 size={13} />
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
                effectiveRate={bcvRate}
                bcvRate={rates?.bcv?.price || bcvRate}
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

            {/* Barra flotante «Subir al sistema» — responsiva sin recortes */}
            {pendingChanges.length > 0 && viewTab === 'inventario' && (
                <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[250] w-[95%] sm:w-full max-w-lg px-2 sm:px-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                    <div className="bg-[#193275] dark:bg-slate-900 border border-white/15 text-white rounded-3xl p-3 sm:p-3.5 shadow-2xl backdrop-blur-md flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3">
                        {/* Texto descriptivo */}
                        <div className="flex items-center justify-between sm:justify-start gap-2 min-w-0 px-1 sm:px-0">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping shrink-0" />
                                <div className="min-w-0">
                                    <p className="text-xs font-black leading-tight truncate">
                                        {pendingChanges.length} cambio{pendingChanges.length !== 1 ? 's' : ''} en cola
                                    </p>
                                    <p className="text-[10px] text-slate-300 font-medium leading-none mt-0.5 truncate">
                                        Aún no se han enviado a la caja
                                    </p>
                                </div>
                            </div>

                            {/* Botón descartar para móvil en la parte superior derecha */}
                            <button
                                onClick={() => { triggerHaptic?.(); discardPendingChanges(); }}
                                disabled={uploading}
                                title="Descartar cambios"
                                className="sm:hidden px-2.5 py-1 rounded-xl text-[10px] font-black uppercase text-slate-300 hover:text-white bg-white/10 transition-colors disabled:opacity-40 shrink-0"
                            >
                                Descartar
                            </button>
                        </div>

                        {/* Botones de Acción */}
                        <div className="flex items-center gap-2 shrink-0">
                            {/* Descartar en Desktop */}
                            <button
                                onClick={() => { triggerHaptic?.(); discardPendingChanges(); }}
                                disabled={uploading}
                                className="hidden sm:block px-3 py-2 rounded-2xl text-[10px] font-black uppercase text-slate-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
                            >
                                Descartar
                            </button>
                            {/* Botón Principal: Subir al sistema */}
                            <button
                                onClick={() => { triggerHaptic?.(); uploadPendingChanges(); }}
                                disabled={uploading || !isConnected}
                                className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 sm:py-2 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-black uppercase tracking-wider shadow-lg shadow-emerald-500/30 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {uploading ? <RefreshCw size={14} className="animate-spin" /> : <UploadCloud size={14} />}
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
