import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    store: new Map(),
    setSales: vi.fn(),
    wizardProps: null,
    summaryModalProps: null,
    pushCriticalCloudSync: vi.fn(),
    enqueuePendingCloseSignal: vi.fn(),
    flushPendingCloseSignals: vi.fn(),
    hasPendingCloseSignal: vi.fn(),
    showToast: vi.fn(),
}));

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (k, def) => (mocks.store.has(k) ? mocks.store.get(k) : def)),
        setItem: vi.fn(async (k, v) => { mocks.store.set(k, v); }),
        removeItem: vi.fn(async (k) => { mocks.store.delete(k); }),
    },
}));

vi.mock('../src/utils/withLock', () => ({
    withLock: vi.fn(async (_name, fn) => fn()),
}));

vi.mock('../src/hooks/useCloudSync', () => ({
    pushCriticalCloudSync: (...args) => mocks.pushCriticalCloudSync(...args),
    hasCriticalCloudPushInFlight: () => false,
}));

vi.mock('../src/services/shiftCloseSignalService', () => ({
    enqueuePendingCloseSignal: (...args) => mocks.enqueuePendingCloseSignal(...args),
    flushPendingCloseSignals: (...args) => mocks.flushPendingCloseSignals(...args),
    hasPendingCloseSignal: (...args) => mocks.hasPendingCloseSignal(...args),
}));

vi.mock('../src/hooks/useDashboardData', () => ({
    useDashboardData: () => ({
        sales: [], // Estado React deliberadamente vacío / desfasado (H5)
        setSales: mocks.setSales,
        customers: [],
        setCustomers: vi.fn(),
        isLoadingLocal: false,
        refreshData: vi.fn(),
    }),
}));

vi.mock('../src/hooks/useDashboardMetrics', () => ({
    useDashboardMetrics: () => ({
        today: '2026-11-21',
        todaySales: [],
        todayTotalUsd: 0,
        todayTotalBs: 0,
        todayTotalCop: 0,
        todayItemsSold: 0,
        todayExpenses: 0,
        todayExpensesUsd: 0,
        todayProfit: 0,
        todayApertura: null,
        todayCashFlow: [],
        getRecentSales: () => [],
        weekData: [],
        lowStockProducts: [],
        totalDeudas: 0,
        topProducts: [],
        paymentBreakdown: [],
        todayTopProducts: [],
        shiftSales: [],
        shiftTotalUsd: 0,
        shiftTotalBs: 0,
        shiftTotalCop: 0,
        shiftItemsSold: 0,
        shiftExpensesUsd: 0,
        shiftProfit: 0,
        shiftApertura: null,
        shiftCashFlow: [], // Vacío en React aunque IndexedDB tenga ventas frescas
        shiftPaymentBreakdown: [],
        shiftTopProducts: [],
        hasShiftMovements: false,
        hasTodayMovements: false,
        isShiftOpen: false,
    }),
}));

vi.mock('../src/context/ProductContext', () => ({
    useProductContext: () => ({
        products: [{ id: 'p1', name: 'Harina', priceUsdt: 1.5, costUsd: 1.0 }],
        setProducts: vi.fn(),
        isLoadingProducts: false,
        effectiveRate: 40,
        copEnabled: false,
        copPrimary: false,
        tasaCop: 0,
        rateMode: 'bcv',
    }),
}));

vi.mock('../src/context/CartContext', () => ({
    useCart: () => ({ loadCart: vi.fn() }),
}));

vi.mock('../src/hooks/useSecurity', () => ({
    useSecurity: () => ({ deviceId: 'POS-DASH-TEST-1' }),
}));

vi.mock('../src/hooks/useAudit', () => ({
    useAudit: () => ({ log: vi.fn() }),
}));

vi.mock('../src/hooks/useNotifications', () => ({
    useNotifications: () => ({ notifyCierrePendiente: vi.fn(), requestPermission: vi.fn() }),
}));

vi.mock('../src/hooks/useReveal', () => ({
    useReveal: () => ({ current: null }),
}));

vi.mock('../src/hooks/useOfflineQueue', () => ({
    useOfflineQueue: () => ({ isOnline: true, pendingCount: 0 }),
}));

vi.mock('../src/hooks/useGastosInternos', () => ({
    useGastosInternos: () => ({
        isAddGastoOpen: false,
        setIsAddGastoOpen: vi.fn(),
        registrarGasto: vi.fn(),
        registrarAutoconsumo: vi.fn(),
        anularGasto: vi.fn(),
    }),
}));

vi.mock('../src/hooks/store/useAuthStore', () => {
    const state = {
        usuarioActivo: { id: 'u1', nombre: 'Cajero Prueba', rol: 'ADMIN' },
        blindModeEnabled: false,
        logout: vi.fn(),
        requireLogin: vi.fn(),
    };
    const hook = (selector) => (typeof selector === 'function' ? selector(state) : state);
    hook.getState = () => state;
    return { useAuthStore: hook };
});

vi.mock('../src/components/Toast', () => ({
    showToast: (...args) => mocks.showToast(...args),
}));

vi.mock('../src/components/Dashboard/CierreCajaWizard', () => ({
    default: (props) => {
        mocks.wizardProps = props;
        return null;
    },
}));

vi.mock('../src/components/Dashboard/CierreCajaSummaryModal', () => ({
    default: (props) => {
        mocks.summaryModalProps = props;
        return null;
    },
}));

vi.mock('../src/components/Dashboard/DashboardStats', () => ({ default: () => null }));
vi.mock('../src/components/Dashboard/DashboardPaymentBreakdown', () => ({ default: () => null }));
vi.mock('../src/components/Dashboard/SalesHistory', () => ({ default: () => null }));
vi.mock('../src/components/Dashboard/SalesChart', () => ({ default: () => null }));
vi.mock('../src/components/ConfirmModal', () => ({ default: () => null }));
vi.mock('../src/components/SyncStatus', () => ({ default: () => null }));
vi.mock('../src/components/Dashboard/DashboardModals', () => ({
    TicketClientModal: () => null,
    DeleteHistoryModal: () => null,
    RecycleOfferModal: () => null,
}));
vi.mock('../src/components/GastosInternos/GastosInternosModal', () => ({ default: () => null }));
vi.mock('../src/views/MonitorView', () => ({ default: () => null }));
vi.mock('../src/utils/ticketGenerator', () => ({ generateTicketPDF: vi.fn(), printThermalTicket: vi.fn() }));
vi.mock('../src/utils/dashboardActions', () => ({ shareSaleWhatsApp: vi.fn() }));
vi.mock('../src/utils/dailyCloseGenerator', () => ({ generateDailyClosePDF: vi.fn() }));

import DashboardView from '../src/views/DashboardView';

let root;
let host;

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    localStorage.setItem('dj_device_id', 'POS-DASH-TEST-1');
    mocks.store.clear();
    mocks.setSales.mockReset();
    mocks.wizardProps = null;
    mocks.summaryModalProps = null;
    mocks.pushCriticalCloudSync.mockReset().mockResolvedValue({ ok: true, reason: 'ok' });
    mocks.enqueuePendingCloseSignal.mockReset();
    mocks.flushPendingCloseSignals.mockReset().mockResolvedValue({ ok: true, pending: false, flushed: 1 });
    mocks.hasPendingCloseSignal.mockReset().mockReturnValue(false);
    mocks.showToast.mockReset();
});

afterEach(async () => {
    if (root) await act(async () => root.unmount());
    host?.remove();
    root = null;
    host = null;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

async function mountDashboard() {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
        root.render(createElement(DashboardView, {
            rates: { bcv: { price: 40 } },
            onRefreshRates: vi.fn(),
            loadingRates: false,
            triggerHaptic: vi.fn(),
            onNavigate: vi.fn(),
            theme: 'light',
            toggleTheme: vi.fn(),
            isActive: true,
        }));
    });
}

describe('Integración DashboardView — handleConfirmCashRecon (Fase 0 + 1 + 2B)', () => {
    it('construye REGISTRO_CIERRE desde IndexedDB fresco aunque React tenga shiftCashFlow vacío, encola señal y dispara pushCriticalCloudSync', async () => {
        mocks.store.set('bodega_sales_v1', [
            { id: 'ap_1', tipo: 'APERTURA_CAJA', timestamp: '2026-11-21T08:00:00.000Z', openingUsd: 10 },
            {
                id: 'v_1', tipo: 'VENTA', timestamp: '2026-11-21T09:00:00.000Z',
                totalUsd: 0.1, totalBs: 4.01,
                items: [{ id: 'p1', name: 'Harina', qty: 1, priceUsd: 0.1 }],
                payments: [{ methodId: 'efectivo_usd', amountUsd: 0.1 }],
            },
            {
                id: 'v_2', tipo: 'VENTA', timestamp: '2026-11-21T10:00:00.000Z',
                totalUsd: 0.2, totalBs: 8.02,
                items: [{ id: 'p1', name: 'Harina', qty: 2, priceUsd: 0.1 }],
                payments: [{ methodId: 'efectivo_usd', amountUsd: 0.2 }],
            },
        ]);

        let resolveFlush;
        mocks.flushPendingCloseSignals.mockImplementationOnce(
            () => new Promise((resolve) => { resolveFlush = resolve; }),
        );
        // Mientras el flush inmediato está en vuelo, hasPendingCloseSignal devuelve true,
        // pero el modal NO debe parpadear mostrando "Aviso pendiente" hasta que termine el flush.
        mocks.hasPendingCloseSignal.mockReturnValue(true);

        await mountDashboard();
        expect(mocks.wizardProps?.onConfirm).toBeTypeOf('function');

        await act(async () => {
            await mocks.wizardProps.onConfirm({ expectedUsd: 10.3, declaredUsd: 10.3, expectedBs: 0, declaredBs: 0 });
            await Promise.resolve();
            await Promise.resolve();
        });

        const persistedSales = mocks.store.get('bodega_sales_v1');
        const cierre = persistedSales.find((s) => s.tipo === 'REGISTRO_CIERRE');
        expect(cierre).toBeTruthy();
        expect(cierre.cierreNumber).toBe(1);
        expect(cierre.summary.todayTotalUsd).toBe(0.3);
        expect(cierre.summary.todayTotalBs).toBe(12.03);
        expect(cierre.summary.todayItemsSold).toBe(3);

        // Encoló la señal en awaiting_upload con el cierre recién creado
        expect(mocks.enqueuePendingCloseSignal).toHaveBeenCalledWith({
            deviceId: 'POS-DASH-TEST-1',
            registroCierre: cierre,
        });

        // Lanzó subida crítica pasando expectedCierreId
        expect(mocks.pushCriticalCloudSync).toHaveBeenCalledWith(
            'bodega_sales_v1',
            persistedSales,
            { expectedCierreId: cierre.cierreId },
        );

        // Modal abierto en estado synced y SIN parpadeo de signalPending mientras flushea
        expect(mocks.summaryModalProps.isOpen).toBe(true);
        expect(mocks.summaryModalProps.syncStatus).toBe('synced');
        expect(mocks.summaryModalProps.signalPending).toBe(false);
        expect(mocks.flushPendingCloseSignals).toHaveBeenCalledWith('POS-DASH-TEST-1', { immediate: true });

        // Al terminar el flush con éxito, limpia pending
        mocks.hasPendingCloseSignal.mockReturnValue(false);
        await act(async () => {
            resolveFlush({ ok: true, pending: false, flushed: 1 });
            await Promise.resolve();
        });
        expect(mocks.summaryModalProps.signalPending).toBe(false);
    });

    it('turno solo-apertura en IndexedDB genera REGISTRO_CIERRE aunque React esté vacío', async () => {
        mocks.store.set('bodega_sales_v1', [
            { id: 'ap_only', tipo: 'APERTURA_CAJA', timestamp: '2026-11-21T08:00:00.000Z', openingUsd: 25 },
        ]);

        await mountDashboard();
        await act(async () => {
            await mocks.wizardProps.onConfirm({ expectedUsd: 25, declaredUsd: 25, expectedBs: 0, declaredBs: 0 });
            await Promise.resolve();
        });

        const persistedSales = mocks.store.get('bodega_sales_v1');
        const cierre = persistedSales.find((s) => s.tipo === 'REGISTRO_CIERRE');
        expect(cierre).toBeTruthy();
        expect(cierre.summary.todayTotalUsd).toBe(0);
        expect(persistedSales.find((s) => s.id === 'ap_only').cajaCerrada).toBe(true);
    });
});
