import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
const m = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), toast: vi.fn(), context: null }));
vi.mock('../src/utils/storageService', () => ({ storageService: { getItem: m.read, setItem: m.write, removeItem: vi.fn() } }));
vi.mock('../src/hooks/useCloudSync', () => ({ pushLocalSync: vi.fn(), queueCloudSync: vi.fn() }));
vi.mock('../src/services/inventoryOperationService', () => ({ recoverPendingInventoryOperations: vi.fn() }));
vi.mock('../src/services/employeeService', () => ({ recoverPendingEmployeeOperations: vi.fn() }));
vi.mock('../src/components/Toast', () => ({ showToast: m.toast }));
import { ProductProvider, useProductContext } from '../src/context/ProductContext';
function Probe() { const context = useProductContext(); useEffect(() => { m.context = context; }); return null; }
let root, host;
beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks(); vi.useFakeTimers(); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    m.read.mockImplementation(async (key, fallback) => key === 'bodega_products_v1' ? [{ id: 'p', name: 'Original', stock: 3, priceUsd: 1 }] : fallback);
    m.write.mockResolvedValue(undefined);
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });
it('autoguardado espera ambas escrituras y conserva el borrador si una falla', async () => {
    await act(async () => root.render(createElement(ProductProvider, { rates: { bcv: { price: 100 } } }, createElement(Probe))));
    // Los imports dinámicos iniciales se resuelven antes de aplicar la edición.
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(m.context.isLoadingProducts).toBe(false);
    let release;
    const held = new Promise(resolve => { release = resolve; });
    m.write.mockImplementation((key) => key === 'bodega_products_v1' ? held : Promise.reject(new Error('category write failed')));
    await act(async () => { m.context.setProducts(previous => previous.map(p => ({ ...p, name: 'Borrador' }))); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(m.toast.mock.calls.some(([, level]) => level === 'error')).toBe(false);
    // La escritura principal sigue en vuelo aunque la de categorías haya fallado.
    await act(async () => {
        window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_products_v1' } }));
        release(); await held;
        await vi.advanceTimersByTimeAsync(60);
    });
    expect(m.toast).toHaveBeenCalledWith(expect.stringContaining('No se guardaron todos'), 'error');
    expect(m.context.products[0].name).toBe('Borrador');
});
