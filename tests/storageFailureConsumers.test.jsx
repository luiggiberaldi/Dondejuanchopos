import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';

const m = vi.hoisted(() => ({ get: vi.fn(), write: vi.fn(), sale: vi.fn(), transaction: vi.fn(), toast: vi.fn(), log: vi.fn(), modal: null, wallet: null }));
vi.mock('../src/utils/storageService', () => ({ storageService: { getItem: m.get, setItem: m.write } }));
vi.mock('../src/utils/checkoutProcessor', () => ({ processSaleTransaction: m.sale }));
vi.mock('../src/utils/customerTransactionProcessor', () => ({ processCustomerTransaction: m.transaction }));
vi.mock('../src/components/Toast', async importOriginal => ({
    ...(await importOriginal()),
    showToast: m.toast,
}));
vi.mock('../src/hooks/useSalesData', () => ({ SALES_KEY: 'bodega_sales_v1' }));
vi.mock('../src/utils/sniperPayDiagnostic', () => ({ sniperLog: vi.fn() }));
vi.mock('../src/hooks/store/useAuthStore', () => ({ useAuthStore: Object.assign(selector => selector({ requireLogin: true, usuarioActivo: { id: 'admin', rol: 'ADMIN' } }), { getState: () => ({ usuarioActivo: { id: 'admin', rol: 'ADMIN' } }) }) }));
vi.mock('../src/hooks/useReveal', () => ({ useReveal: () => null }));
vi.mock('../src/hooks/useAudit', () => ({ useAudit: () => ({ log: m.log }) }));
vi.mock('../src/context/ProductContext', () => ({ useProductContext: () => ({ products: [], effectiveRate: 100, tasaCop: 4000, copEnabled: false }) }));
vi.mock('../src/hooks/useSupplierManagement', () => ({ useSupplierManagement: () => ({ suppliers: [], invoices: [], hydrateSuppliers: () => {} }) }));
vi.mock('../src/config/paymentMethods', async original => ({ ...(await original()), getActivePaymentMethods: async () => [{ id: 'efectivo_usd', currency: 'USD', isEnabled: true }] }));
vi.mock('../src/components/Settings/EmployeesManager', () => ({ default: () => null }));
vi.mock('../src/components/Customers/TransactionModal', () => ({ default: function ModalProbe(props) {
    useEffect(() => { m.modal = props; });
    return createElement('div', { 'data-testid': 'transaction' }, props.transactionModal.isOpen ? props.transactionAmount : 'closed');
} }));

import { useCheckoutFlow } from '../src/hooks/useCheckoutFlow';
import { useWallet } from '../src/hooks/useWallet';
import CustomersView from '../src/views/CustomersView';
import { ToastProvider, useToast } from '../src/components/Toast';
let root, host;
beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks(); m.modal = null; m.wallet = null;
    m.get.mockImplementation(async (key, fallback) => key === 'bodega_sales_v1'
        ? [{ id: 'open-shift', tipo: 'APERTURA_CAJA', timestamp: '2026-10-16T00:00:00.000Z', cajaCerrada: false }]
        : fallback ?? []);
    m.write.mockResolvedValue(undefined);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount()); host.remove(); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

it('checkout conserva el carrito y no anuncia éxito tras excepción de persistencia', async () => {
    m.sale.mockRejectedValue(Object.assign(new Error('write failed'), { code: 'STORAGE_WRITE_FAILED' }));
    const success = { setProducts: vi.fn(), setSalesData: vi.fn(), setShowReceipt: vi.fn(), setShowCheckout: vi.fn(), setCart: vi.fn(), playCheckout: vi.fn(), setShowConfetti: vi.fn() };
    const flow = useCheckoutFlow({ ...success, cart: [{ id: 'p', qty: 1 }], playError: vi.fn() });
    const result = await flow.handleCheckout([], {}, { checkoutOperationId: 'op-retained' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('STORAGE_WRITE_FAILED');
    expect(result.error).toContain('VTA-GUARDADO-01');
    expect(result.diagnosticCode).toBe('VTA-GUARDADO-01');
    expect(result.error).toContain('Revisa el historial');
    expect(m.toast).toHaveBeenCalledWith(expect.stringContaining('VTA-GUARDADO-01'), 'error', 0);
    for (const callback of Object.values(success)) expect(callback).not.toHaveBeenCalled();
    expect(m.sale).toHaveBeenCalledTimes(1);
    expect(m.sale.mock.calls[0][0].checkoutOperationId).toBe('op-retained');
});

it('checkout explica si el entorno no tiene Web Locks y no permite una escritura insegura', async () => {
    m.sale.mockRejectedValue(Object.assign(new Error('Web Locks unavailable'), { code: 'STORAGE_LOCK_UNAVAILABLE' }));
    const flow = useCheckoutFlow({
        cart: [{ id: 'p', qty: 1 }],
        playError: vi.fn(),
        setCart: vi.fn(), setShowReceipt: vi.fn(), setShowCheckout: vi.fn(),
    });
    const result = await flow.handleCheckout([], {}, { checkoutOperationId: 'op-lock-unavailable' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTPS o localhost');
    expect(result.error).toContain('VTA-BLOQUEO-01');
    expect(result.diagnosticCode).toBe('VTA-BLOQUEO-01');
    expect(result.error).toContain('Revisa el historial');
    expect(m.toast).toHaveBeenCalledWith(expect.stringContaining('VTA-BLOQUEO-01'), 'error', 0);
    expect(m.sale).toHaveBeenCalledTimes(1);
});

function ToastProbe() {
    const toast = useToast();
    useEffect(() => {
        toast('No se confirmó la venta.\nCódigo de diagnóstico: VTA-GUARDADO-01 (STORAGE_WRITE_FAILED)', 'error', 0);
    }, [toast]);
    return null;
}

it('el toast visible conserva el código de diagnóstico legible en una captura', async () => {
    const view = render(createElement(ToastProvider, null, createElement(ToastProbe)));
    const alert = view.container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain('VTA-GUARDADO-01');
    expect(alert.textContent).toContain('STORAGE_WRITE_FAILED');
    expect(alert.querySelector('p').className).toContain('whitespace-pre-line');
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar notificación' }));
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    cleanup();
});

it('el padre de abonos conserva importe/modal tras rechazo del procesador', async () => {
    m.transaction.mockRejectedValue(Object.assign(new Error('sales not stored'), { code: 'STORAGE_WRITE_FAILED' }));
    await act(async () => root.render(createElement(CustomersView, { triggerHaptic: vi.fn(), isActive: true })));
    await act(async () => {
        m.modal.setTransactionModal({ isOpen: true, type: 'ABONO', customer: { id: 'c', name: 'Fixture', deuda: 20 } });
        m.modal.setTransactionAmount('10');
    });
    await act(async () => { await m.modal.handleTransaction(); });
    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(m.modal.transactionModal.isOpen).toBe(true);
    expect(m.modal.transactionAmount).toBe('10');
    expect(m.toast).toHaveBeenCalledWith(expect.stringContaining('Revisa el saldo y el historial'), 'error');
    expect(m.toast.mock.calls.some(([, level]) => level === 'success')).toBe(false);
    expect(m.log).not.toHaveBeenCalled();
});

function WalletProbe() {
    const wallet = useWallet();
    useEffect(() => { m.wallet = wallet; });
    return null;
}
it('billetera captura autoguardado fallido sin perder el borrador ni reintentar en bucle', async () => {
    await act(async () => root.render(createElement(WalletProbe)));
    m.write.mockRejectedValue(new Error('quota'));
    await act(async () => { m.wallet.addAccount('transfer', 'Fixture', 'USD', {}); });
    expect(m.wallet.accounts).toHaveLength(1);
    expect(m.wallet.saveError).toContain('No se guardaron');
    expect(m.toast).toHaveBeenCalledWith(m.wallet.saveError, 'error');
    const calls = m.write.mock.calls.length;
    await act(async () => { await Promise.resolve(); });
    expect(m.write).toHaveBeenCalledTimes(calls);
});
