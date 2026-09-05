import React, { useState, useEffect, useMemo } from 'react';
import { useProductContext } from '../context/ProductContext';
import { useMonitorSync } from '../hooks/useMonitorSync';
import { useSupervisorCommandQueue } from '../hooks/useSupervisorCommandQueue';
import { useMonitorShiftMetrics } from '../hooks/useMonitorShiftMetrics';
import { useMonitorInventory } from '../hooks/useMonitorInventory';
import { useMonitorPayroll } from '../hooks/useMonitorPayroll';
import { storageService } from '../utils/storageService';
import { normalizeHistoricalSale } from '../utils/salesMerge';
import { supabaseCloud } from '../config/supabaseCloud';
import { showToast } from '../components/Toast';
import { calculateComboStock, getEffectiveCostUsd, calculatePricing } from '../utils/productProcessor';
import SupervisorRateModal from '../components/SupervisorRateModal';
import RemoteProductFormModal from '../components/Monitor/RemoteProductFormModal';
import RemoteEmployeeModal from '../components/Monitor/RemoteEmployeeModal';
import SupervisorPairingModal from '../components/Monitor/SupervisorPairingModal';
import MonitorKardexTab from '../components/Monitor/MonitorKardexTab';
import MonitorArticlesTab from '../components/Monitor/MonitorArticlesTab';
import MonitorHeader from '../components/Monitor/MonitorHeader';
import MonitorTabs from '../components/Monitor/MonitorTabs';
import MonitorCierresTab from '../components/Monitor/MonitorCierresTab';
import MonitorInventarioTab from '../components/Monitor/MonitorInventarioTab';
import MonitorCambiosTab from '../components/Monitor/MonitorCambiosTab';
import MonitorNominaTab from '../components/Monitor/MonitorNominaTab';
import MonitorGastosTab from '../components/Monitor/MonitorGastosTab';
import MonitorActivoTab from '../components/Monitor/MonitorActivoTab';
import MonitorOverlays from '../components/Monitor/MonitorOverlays';
import SaleDetailModal from '../components/Monitor/SaleDetailModal';
import StockAdjustModal from '../components/Monitor/StockAdjustModal';
import ComboFormModal from '../components/Products/ComboFormModal';
import UsersManager from '../components/Settings/UsersManager';
import BsCongeladoWizardModal from '../components/Products/BsCongeladoWizardModal';
import BsCongeladoAlertBanner from '../components/Products/BsCongeladoAlertBanner';
import {
    Package, Users, Download,
    RefreshCw, Clock, FileText, TrendingUp, Coins, DollarSign,
    Wallet, ArrowDownRight,
    ShieldCheck, Hash, AlertTriangle, Search, X, ChevronLeft, ChevronRight,
    MinusCircle, PlusCircle, Pencil, Trash2, Plus, UploadCloud, Sparkles, Gift, RotateCcw, Lock, Unlock, HandCoins,
    Wrench, Truck, User, Lightbulb, Box, Home, Receipt, BarChart3, ShoppingBag, SlidersHorizontal, BookOpen
} from 'lucide-react';
import {
    getEffectiveSaleTotalBs,
    getFormattedPaymentMethod,
    getFormattedSaleCode,
    getMethodIcon,
    getPaymentBadgeStyle,
    getSaleChangeDetails,
    formatPayrollUsd,
} from '../utils/monitorSaleFormat';
import { applyProjectedStock } from '../utils/supervisorStockProjection';
import { getSupervisorCommandDetails, isDuplicateProductIdFailure } from '../utils/monitorCommandDetails';

// Re-exports para compatibilidad con tests que importan helpers desde la vista.
export { applyProjectedStock } from '../utils/supervisorStockProjection';
export { getSaleChangeDetails, getEffectiveSaleTotalBs } from '../utils/monitorSaleFormat';
import { formatBs, formatCop } from '../utils/calculatorUtils';
import { mulR, round2 } from '../utils/dinero';
import { getChangeLedger, getChangeDisplayParts } from '../utils/changeLedger';
import { getLocalISODate, getDateRange } from '../utils/dateHelpers';
import { getPaymentLabel, toTitleCase } from '../config/paymentMethods';
import { findOpenApertura, getOpenShiftMovements } from '../utils/shiftScope';
import { FinancialEngine } from '../core/FinancialEngine';
import { calculateSupervisorChangeMetrics, calculateSupervisorOutflowMetrics } from '../utils/supervisorShiftMetrics';
import { generateEmployeePayrollPDF } from '../utils/employeePayrollPdfGenerator';
import { useAuthStore } from '../hooks/store/useAuthStore';
import {
    createSupervisorCommandId,
    normalizeSupervisorChanges,
} from '../utils/supervisorCommandModel';

const PENDING_KEY = 'dj_pending_inventory_changes_v1';

const MAIN_SUPERVISOR_TABS = [
    {
        id: 'caja',
        label: 'Caja',
        icon: Wallet,
        defaultSubTab: 'activo',
        subTabs: [
            { id: 'activo', label: 'Turno Activo', shortLabel: 'Turno', icon: Clock },
            { id: 'cierres', label: 'Historial de Cierres', shortLabel: 'Cierres', icon: Lock },
        ]
    },
    {
        id: 'finanzas',
        label: 'Finanzas',
        icon: TrendingUp,
        defaultSubTab: 'articulos',
        subTabs: [
            { id: 'articulos', label: 'Reportes por Artículo', shortLabel: 'Reportes', icon: BarChart3 },
            { id: 'deudas', label: 'Clientes y Cuentas por Cobrar', shortLabel: 'Clientes', icon: Users },
            { id: 'gastos', label: 'Gastos Internos', shortLabel: 'Gastos', icon: Receipt },
            { id: 'nomina', label: 'Nómina de Personal', shortLabel: 'Nómina', icon: Users },
        ]
    },
    {
        id: 'inventario_group',
        label: 'Inventario',
        icon: Package,
        defaultSubTab: 'inventario',
        subTabs: [
            { id: 'inventario', label: 'Catálogo de Stock', shortLabel: 'Stock', icon: Package },
            { id: 'kardex', label: 'Kardex Remoto', shortLabel: 'Kardex', icon: RotateCcw },
        ]
    },
    {
        id: 'control',
        label: 'Control',
        icon: ShieldCheck,
        defaultSubTab: 'cambios',
        hasBadge: true,
        subTabs: [
            { id: 'cambios', label: 'Historial de Cambios', shortLabel: 'Cambios', icon: SlidersHorizontal },
        ]
    },
];

export default function OwnerMonitorView({ theme, toggleTheme, triggerHaptic }) {
    const pairedDeviceId = localStorage.getItem('dj_paired_device_id');
    const { products, setProducts, effectiveRate, copEnabled, copPrimary, tasaCop, rates, categories, isBsWizardOpen, openBsCongeladoWizard, closeBsCongeladoWizard, bsCongeladoAlert, previousRate, bsRoundingStep, rateMode } = useProductContext();
    const bcvRate = rates?.bcv?.price || effectiveRate;
    const { isConnected, lastSync, loading: syncLoading, triggerRefresh, posLastSeen, isPosOnline, presenceError } = useMonitorSync(pairedDeviceId);

    const [sales, setSales] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [supplierInvoices, setSupplierInvoices] = useState([]);
    const [activeCashier, setActiveCashier] = useState({ nombre: 'Ninguno', rol: '' });
    const [loadingData, setLoadingData] = useState(true);
    const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
    const [showRateModal, setShowRateModal] = useState(false);
    const [selectedSaleDetail, setSelectedSaleDetail] = useState(null);
    const [showRemoteCloseModal, setShowRemoteCloseModal] = useState(false);
    const [closingRemote, setClosingRemote] = useState(false);
    const supervisorUser = useAuthStore(state => state.usuarioActivo);
    const queue = useSupervisorCommandQueue({
        pairedDeviceId,
        products,
        setProducts,
        supervisorUser,
        triggerHaptic,
        setSales,
        setSelectedSaleDetail,
    });
    const {
        allCloudCmds,
        cloudPendingCmds,
        cmdTabFilter,
        setCmdTabFilter,
        currentPageCambios,
        setCurrentPageCambios,
        ITEMS_PER_PAGE_CAMBIOS,
        showCloudPendingModal,
        setShowCloudPendingModal,
        showDiscardQueueModal,
        setShowDiscardQueueModal,
        cancellingCmdId,
        downloadingBackup,
        pendingChanges,
        setPendingChanges,
        inFlightChanges,
        uploading,
        recentlyConfirmedIds,
        pendingVoidSaleIds,
        setPendingVoidSaleIds,
        pendingVoidCommands,
        setPendingVoidCommands,
        persistPending,
        queueInventoryChange,
        pendingStockDelta,
        hasPendingFor,
        hasInventoryChanges,
        uploadPendingChanges,
        discardPendingChanges,
        discardSinglePendingChange,
        cancelSingleCloudCmd,
        cancelAllCloudCmds,
        handleDownloadRemoteBackup,
        totalControlChanges,
        wipeMonitorSession,
        fetchAllCloudCmds,
    } = queue;
    const shift = useMonitorShiftMetrics({
        sales,
        products,
        effectiveRate,
        bcvRate,
        pairedDeviceId,
        supervisorUser,
        copEnabled,
        tasaCop,
        activeCashier,
        triggerHaptic,
        setClosingRemote,
        setShowRemoteCloseModal,
    });
    const {
        selectedCierreId,
        setSelectedCierreId,
        exportingCierreId,
        setExportingCierreId,
        activeShiftApertura,
        shiftStatusInfo,
        activeShiftSales,
        activeShiftMetrics,
        activeShiftExpensesMetrics,
        activeShiftAutoconsumoMetrics,
        activeShiftOutflowMetrics,
        activeShiftSupplierMetrics,
        activeShiftPaymentBreakdown,
        activeShiftChangeMetrics,
        activeShiftGrossUsd,
        activeShiftExpectedCash,
        activeShiftTipTotals,
        activeShiftAvgTicket,
        registerCloses,
        handleDownloadCierrePDF,
        handleRemoteForceDailyClose,
        handleReopenRemoteShift,
    } = shift;
    const [viewTab, setViewTab] = useState('activo'); // 'activo' o 'cierres'

    // ── Estado de Reporte por Artículos ──
    const [artRange, setArtRange] = useState('week');
    const [artFrom, setArtFrom] = useState(() => getDateRange('week').from);
    const [artTo, setArtTo] = useState(() => getDateRange('week').to);

    // ── Edición remota de inventario (comandos supervisor → caja) ──
    const [showUsersModal, setShowUsersModal] = useState(false);
    const [showPairingModal, setShowPairingModal] = useState(false);
    const [showCreateEmployeeModal, setShowCreateEmployeeModal] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState(null);

    // ── Catálogo de usuarios sincronizados desde la caja principal ──
    const [syncedUsers, setSyncedUsers] = useState(() => {
        try {
            const raw = localStorage.getItem('bodega_users_catalog_v1');
            const arr = raw ? JSON.parse(raw) : null;
            if (Array.isArray(arr) && arr.length > 0) return arr;
        } catch {}
        return null;
    });

    useEffect(() => {
        const loadSyncedUsers = async () => {
            try {
                const raw = localStorage.getItem('bodega_users_catalog_v1');
                let arr = raw ? JSON.parse(raw) : null;
                if (!arr || !Array.isArray(arr) || arr.length === 0) {
                    const { storageService } = await import('../utils/storageService');
                    arr = await storageService.getItem('bodega_users_catalog_v1', null);
                }
                if (Array.isArray(arr) && arr.length > 0) {
                    setSyncedUsers(arr);
                }
            } catch (e) {
                console.warn('[OwnerMonitorView] Error cargando usuarios sincronizados:', e);
            }
        };

        loadSyncedUsers();

        const handleSync = () => {
            loadSyncedUsers();
        };

        window.addEventListener('app_storage_update', handleSync);
        window.addEventListener('storage', handleSync);
        return () => {
            window.removeEventListener('app_storage_update', handleSync);
            window.removeEventListener('storage', handleSync);
        };
    }, []);

    const storeUsuarios = useAuthStore(state => state.usuarios) || [];
    const usuarios = useMemo(() => {
        const list = syncedUsers && syncedUsers.length > 0 ? syncedUsers : storeUsuarios;
        return (list || []).map(u => ({
            ...u,
            rol: u.rol || (u.id === 1 ? 'ADMIN' : 'CAJERO'),
        }));
    }, [syncedUsers, storeUsuarios]);

    const [showMobileMenu, setShowMobileMenu] = useState(false);

    const activeMainTabId = useMemo(() => {
        const found = MAIN_SUPERVISOR_TABS.find(main => main.subTabs.some(sub => sub.id === viewTab));
        return found ? found.id : 'caja';
    }, [viewTab]);

    const currentMainTab = useMemo(() => {
        return MAIN_SUPERVISOR_TABS.find(main => main.id === activeMainTabId) || MAIN_SUPERVISOR_TABS[0];
    }, [activeMainTabId]);



    // 📄 Generar y Descargar PDF del Cierre Seleccionado
    // R3: Verificar el vínculo del monitor vía list_monitors
    const handleAutoRepairPairing = async () => {
        if (!supabaseCloud) return;
        triggerHaptic?.();
        showToast('Verificando vínculo con la caja en Supabase...', 'info');
        try {
            const monitorId = localStorage.getItem('dj_device_id');
            const { data: res, error } = await supabaseCloud.rpc('list_monitors', {
                p_requester_id: monitorId
            });

            if (error || !res?.success) {
                showToast('Este dispositivo no está autorizado en ninguna caja. Vuelve a emparejar con un código.', 'error');
                return;
            }
            showToast('Vínculo verificado. Si sigue sin conectar, vuelve a emparejar con un código.', 'info'    );
}
 catch (err) {
            console.error('[OwnerMonitor] Error al verificar vínculo:', err);
            showToast('Error al consultar estado de vinculación', 'error'    );
}

    };





    const inventory = useMonitorInventory({
        products,
        pendingChanges,
        inFlightChanges,
        recentlyConfirmedIds,
    });
    const {
        searchTermInventario,
        setSearchTermInventario,
        filterStockInventario,
        setFilterStockInventario,
        currentPageInventario,
        setCurrentPageInventario,
        totalPagesInventario,
        projectedProducts,
        filteredProducts,
        paginatedProducts,
        inventoryMetrics,
        stockAlertTab,
        setStockAlertTab,
        outOfStockProducts,
        lowStockProducts,
        activeStockAlertTab,
        showRemoteForm,
        setShowRemoteForm,
        remoteEditingProduct,
        setRemoteEditingProduct,
        showComboModal,
        setShowComboModal,
        editingCombo,
        setEditingCombo,
        remoteDeleteTarget,
        setRemoteDeleteTarget,
        stockAdjustProduct,
        setStockAdjustProduct,
    } = inventory;
    const payroll = useMonitorPayroll({
        pairedDeviceId,
        supabaseCloud,
        supervisorUser,
        triggerHaptic,
        setShowCreateEmployeeModal,
        setEditingEmployee,
        editingEmployee,
    });
    const {
        payrollProjection,
        setPayrollProjection,
        payrollDetail,
        setPayrollDetail,
        payrollDetailLoading,
        payrollDetailError,
        confirmVoidConsumptionTarget,
        setConfirmVoidConsumptionTarget,
        voidingConsumption,
        deleteEmployeeTarget,
        setDeleteEmployeeTarget,
        handlePayrollDetail,
        handleVoidConsumptionSupervisor,
        executeVoidConsumptionSupervisor,
        handleSaveRemoteEmployee,
        requestDeleteRemoteEmployee,
        executeDeleteRemoteEmployee,
        payrollEmployees,
        payrollTotals,
    } = payroll;

    const today = getLocalISODate();

    // 1. Cargar datos locales (que son actualizados por useMonitorSync)
    const loadLocalData = async () => {
        try {
            // R4: `abasto-auth-storage` y `abasto-device-session` NUNCA se sincronizan
            // (la primera está bloqueada por SEC-002 en pushCloudSync, _applyFromCloud
            // y applyDocToLocal). En el monitor contienen su PROPIA sesión, no la de la
            // caja, así que leerlas mostraba datos de operador vacíos o ajenos.
            // La fuente correcta es `bodega_users_catalog_v1`, que sí se sincroniza y
            // va saneada (sin `pin` ni `plainPin`) desde FX05.
            const [savedSales, savedPayrollProjection, savedCustomers, savedSuppliers, savedInvoices] = await Promise.all([
                storageService.getItem('bodega_sales_v1', []),
                storageService.getItem('bodega_employee_payroll_projection_v1', null),
                storageService.getItem('bodega_customers_v1', []),
                storageService.getItem('bodega_suppliers_v1', []),
                storageService.getItem('bodega_supplier_invoices_v1', []),
            ]);

            let salesList = Array.isArray(savedSales) ? savedSales : [];
            let needsPersist = false;
            salesList = salesList.map(s => {
                const norm = normalizeHistoricalSale(s);
                if (norm !== s) needsPersist = true;
                return norm;
            });
            if (needsPersist) {
                storageService.setItem('bodega_sales_v1', salesList).catch(console.error);
            }

            setSales(salesList);
            setPayrollProjection(savedPayrollProjection?.employees ? savedPayrollProjection : null);
            setCustomers(Array.isArray(savedCustomers) ? savedCustomers : []);
            setSuppliers(Array.isArray(savedSuppliers) ? savedSuppliers : []);
            setSupplierInvoices(Array.isArray(savedInvoices) ? savedInvoices : []);
            setActiveCashier({ nombre: 'Ninguno', rol: '' });
}
 catch (e) {
            console.error('[OwnerMonitorView] Error cargando datos locales:', e    );
}
 finally {
            setLoadingData(false    );
}

    };

    useEffect(() => {
        loadLocalData();

        // Escuchar actualizaciones del almacenamiento causadas por la sincronización en tiempo real o encolado de comandos
        const handleUpdate = (e) => {
            loadLocalData();
            if (!e?.detail?.key || e.detail.key === PENDING_KEY) {
                try {
                    const raw = localStorage.getItem(PENDING_KEY);
                    const arr = raw ? JSON.parse(raw) : [];
                    if (Array.isArray(arr)) setPendingChanges(normalizeSupervisorChanges(arr));
                } catch { /* cola corrupta: se ignora */ }
            }
        };

        window.addEventListener('app_storage_update', handleUpdate);
        window.addEventListener('storage', handleUpdate);
        return () => {
            window.removeEventListener('app_storage_update', handleUpdate);
            window.removeEventListener('storage', handleUpdate    );
}
;
    }, []);


    // ── Ventas para Reporte de Artículos según Rango Seleccionado ──
    const artSalesForStats = useMemo(() => {
        if (viewTab !== 'articulos') return [];

        if (artRange === 'currentShift') {
            if (activeShiftSales && activeShiftSales.length > 0) {
                return activeShiftSales.filter(s => s.status !== 'ANULADA');
            }
            const openMovements = getOpenShiftMovements(sales).movements;
            return openMovements.filter(s => s.status !== 'ANULADA' && (s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA')    );
}
        if (artRange === 'lastShift') {
            if (registerCloses && registerCloses.length > 0) {
                const latestCierre = registerCloses[0];
                return (latestCierre.sales || []).filter(s => s.status !== 'ANULADA' && (s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA'));
            }
            return [];
        }

        return (sales || []).filter(s => {
            if (s.status === 'ANULADA') return false;
            if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA') return false;
            const ts = s.timestamp || s.created_at || s.date;
            if (!ts) return false;
            let dateStr = '';
            if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ts.trim())) {
                dateStr = ts.trim();
            } else {
                const parsed = new Date(ts);
                dateStr = isNaN(parsed.getTime()) ? '' : getLocalISODate(parsed);
            }
            return dateStr >= artFrom && dateStr <= artTo;
        });
    }, [sales, artFrom, artTo, artRange, viewTab, activeShiftSales, registerCloses]);


    // ── COMPONENTES GENERALES ──

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
                    try {
                        await supabaseCloud.rpc('unpair_monitor', { p_device_id: pairedDeviceId });
                    } catch {
                        // La limpieza local continúa aunque la RPC de fallback no esté disponible.
                    }
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


    const monitorCtx = {
        ...queue,
        ...shift,
        ...inventory,
        ...payroll,
        AlertTriangle,
        ArrowDownRight,
        Box,
        Coins,
        ChevronLeft,
        ChevronRight,
        Clock,
        DollarSign,
        Download,
        FileText,
        HandCoins,
        Hash,
        ITEMS_PER_PAGE_CAMBIOS,
        Lightbulb,
        Lock,
        MinusCircle,
        Package,
        Pencil,
        Plus,
        PlusCircle,
        Receipt,
        RefreshCw,
        RotateCcw,
        Search,
        ShieldCheck,
        ShoppingBag,
        Sparkles,
        Trash2,
        Truck,
        Unlock,
        User,
        Users,
        Wallet,
        Wrench,
        X,
        activeCashier,
        activeShiftApertura,
        activeShiftAutoconsumoMetrics,
        activeShiftAvgTicket,
        activeShiftChangeMetrics,
        activeShiftExpectedCash,
        activeShiftExpensesMetrics,
        activeShiftGrossUsd,
        activeShiftMetrics,
        activeShiftPaymentBreakdown,
        activeShiftSales,
        activeShiftTipTotals,
        activeStockAlertTab,
        allCloudCmds,
        artRange,
        bcvRate,
        calculatePricing,
        cancelAllCloudCmds,
        cancelSingleCloudCmd,
        cancellingCmdId,
        categories,
        cloudPendingCmds,
        copEnabled,
        copPrimary,
        customers,
        currentPageCambios,
        currentPageInventario,
        discardSinglePendingChange,
        effectiveRate,
        exportingCierreId,
        filterStockInventario,
        filteredProducts,
        formatBs,
        formatCop,
        formatPayrollUsd,
        formatTime,
        from: artFrom,
        generateEmployeePayrollPDF,
        getEffectiveSaleTotalBs,
        getFormattedPaymentMethod,
        getFormattedSaleCode,
        getMethodIcon,
        getPaymentBadgeStyle,
        getPaymentLabel,
        getSaleChangeDetails,
        getSupervisorCommandDetails,
        handleDownloadCierrePDF,
        handlePayrollDetail,
        handleReopenRemoteShift,
        handleVoidConsumptionSupervisor,
        hasPendingFor,
        inventoryMetrics,
        isConnected,
        isDuplicateProductIdFailure,
        isShiftActive,
        loadingData,
        lowStockProducts,
        outOfStockProducts,
        paginatedProducts,
        pairedDeviceId,
        payrollDetail,
        payrollDetailError,
        payrollDetailLoading,
        payrollEmployees,
        payrollProjection,
        payrollTotals,
        pendingChanges,
        pendingStockDelta,
        products,
        queueInventoryChange,
        registerCloses,
        requestDeleteRemoteEmployee,
        sales,
        salesForStats: artSalesForStats,
        searchTermInventario,
        selectedCierreId,
        setArtFrom,
        setArtRange,
        setArtTo,
        setCmdTabFilter,
        setCurrentPageCambios,
        setCurrentPageInventario,
        setEditingCombo,
        setEditingEmployee,
        setFilterStockInventario,
        setPayrollDetail,
        setRemoteDeleteTarget,
        setRemoteEditingProduct,
        setSearchTermInventario,
        setSelectedCierreId,
        setSelectedSaleDetail,
        setShowCloudPendingModal,
        setShowComboModal,
        setShowCreateEmployeeModal,
        setShowDiscardQueueModal,
        setShowRemoteCloseModal,
        setShowRemoteForm,
        setStockAdjustProduct,
        setStockAlertTab,
        setViewTab,
        shiftStatusInfo,
        showToast,
        suppliers,
        supplierInvoices,
        tasaCop,
        to: artTo,
        toTitleCase,
        TrendingUp,
        totalPagesInventario,
        triggerHaptic,
        triggerRefresh,
        uploadPendingChanges,
        uploading,
        viewTab,
    };
    return (
        <div className={`min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-sans transition-colors duration-300 overflow-x-hidden ${hasInventoryChanges && viewTab === 'inventario' ? 'pb-48 sm:pb-36' : 'pb-16'}`}>
            <MonitorHeader
                mainTabs={MAIN_SUPERVISOR_TABS}
                activeMainTabId={activeMainTabId}
                currentMainTab={currentMainTab}
                viewTab={viewTab}
                setViewTab={setViewTab}
                isConnected={isConnected}
                lastSync={lastSync}
                isPosOnline={isPosOnline}
                posLastSeen={posLastSeen}
                presenceError={presenceError}
                syncLoading={syncLoading}
                downloadingBackup={downloadingBackup}
                totalControlChanges={totalControlChanges}
                triggerRefresh={triggerRefresh}
                triggerHaptic={triggerHaptic}
                showToast={showToast}
                showMobileMenu={showMobileMenu}
                setShowMobileMenu={setShowMobileMenu}
                setShowRateModal={setShowRateModal}
                setShowUsersModal={setShowUsersModal}
                setShowPairingModal={setShowPairingModal}
                setShowDisconnectConfirm={setShowDisconnectConfirm}
                handleDownloadRemoteBackup={handleDownloadRemoteBackup}
                handleAutoRepairPairing={handleAutoRepairPairing}
            >
                <MonitorTabs {...monitorCtx} />
            </MonitorHeader>
            <MonitorOverlays
            AlertTriangle={AlertTriangle}
            BsCongeladoAlertBanner={BsCongeladoAlertBanner}
            BsCongeladoWizardModal={BsCongeladoWizardModal}
            Clock={Clock}
            ComboFormModal={ComboFormModal}
            Lock={Lock}
            RefreshCw={RefreshCw}
            RemoteEmployeeModal={RemoteEmployeeModal}
            RemoteProductFormModal={RemoteProductFormModal}
            SaleDetailModal={SaleDetailModal}
            StockAdjustModal={StockAdjustModal}
            SupervisorPairingModal={SupervisorPairingModal}
            SupervisorRateModal={SupervisorRateModal}
            Trash2={Trash2}
            UploadCloud={UploadCloud}
            Users={Users}
            UsersManager={UsersManager}
            X={X}
            activeShiftMetrics={activeShiftMetrics}
            bcvRate={bcvRate}
            bsCongeladoAlert={bsCongeladoAlert}
            bsRoundingStep={bsRoundingStep}
            cancelAllCloudCmds={cancelAllCloudCmds}
            cancelSingleCloudCmd={cancelSingleCloudCmd}
            cancellingCmdId={cancellingCmdId}
            categories={categories}
            closeBsCongeladoWizard={closeBsCongeladoWizard}
            closingRemote={closingRemote}
            cloudPendingCmds={cloudPendingCmds}
            confirmVoidConsumptionTarget={confirmVoidConsumptionTarget}
            copEnabled={copEnabled}
            deleteEmployeeTarget={deleteEmployeeTarget}
            triggerHaptic={triggerHaptic}
            discardPendingChanges={discardPendingChanges}
            editingCombo={editingCombo}
            editingEmployee={editingEmployee}
            effectiveRate={effectiveRate}
            executeDeleteRemoteEmployee={executeDeleteRemoteEmployee}
            executeVoidConsumptionSupervisor={executeVoidConsumptionSupervisor}
            getSupervisorCommandDetails={getSupervisorCommandDetails}
            handleDisconnect={handleDisconnect}
            handleRemoteForceDailyClose={handleRemoteForceDailyClose}
            handleSaveRemoteEmployee={handleSaveRemoteEmployee}
            hasInventoryChanges={hasInventoryChanges}
            inFlightChanges={inFlightChanges}
            isBsWizardOpen={isBsWizardOpen}
            isConnected={isConnected}
            isPosOnline={isPosOnline}
            openBsCongeladoWizard={openBsCongeladoWizard}
            pairedDeviceId={pairedDeviceId}
            payrollDetail={payrollDetail}
            pendingChanges={pendingChanges}
            pendingVoidSaleIds={pendingVoidSaleIds}
            previousRate={previousRate}
            products={products}
            projectedProducts={projectedProducts}
            queueInventoryChange={queueInventoryChange}
            rates={rates}
            remoteDeleteTarget={remoteDeleteTarget}
            remoteEditingProduct={remoteEditingProduct}
            selectedSaleDetail={selectedSaleDetail}
            setConfirmVoidConsumptionTarget={setConfirmVoidConsumptionTarget}
            setDeleteEmployeeTarget={setDeleteEmployeeTarget}
            setEditingCombo={setEditingCombo}
            setEditingEmployee={setEditingEmployee}
            setPendingVoidCommands={setPendingVoidCommands}
            setPendingVoidSaleIds={setPendingVoidSaleIds}
            setRemoteDeleteTarget={setRemoteDeleteTarget}
            setRemoteEditingProduct={setRemoteEditingProduct}
            setSelectedSaleDetail={setSelectedSaleDetail}
            setShowCloudPendingModal={setShowCloudPendingModal}
            setShowComboModal={setShowComboModal}
            setShowCreateEmployeeModal={setShowCreateEmployeeModal}
            setShowDiscardQueueModal={setShowDiscardQueueModal}
            setShowDisconnectConfirm={setShowDisconnectConfirm}
            setShowPairingModal={setShowPairingModal}
            setShowRateModal={setShowRateModal}
            setShowRemoteCloseModal={setShowRemoteCloseModal}
            setShowRemoteForm={setShowRemoteForm}
            setShowUsersModal={setShowUsersModal}
            setStockAdjustProduct={setStockAdjustProduct}
            showCloudPendingModal={showCloudPendingModal}
            showComboModal={showComboModal}
            showCreateEmployeeModal={showCreateEmployeeModal}
            showDiscardQueueModal={showDiscardQueueModal}
            showDisconnectConfirm={showDisconnectConfirm}
            showPairingModal={showPairingModal}
            showRateModal={showRateModal}
            showRemoteCloseModal={showRemoteCloseModal}
            showRemoteForm={showRemoteForm}
            showToast={showToast}
            showUsersModal={showUsersModal}
            stockAdjustProduct={stockAdjustProduct}
            supervisorUser={supervisorUser}
            tasaCop={tasaCop}
            uploadPendingChanges={uploadPendingChanges}
            uploading={uploading}
            usuarios={usuarios}
            viewTab={viewTab}
            voidingConsumption={voidingConsumption}
            />
        </div>
    );
}
