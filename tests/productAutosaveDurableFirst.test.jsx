import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regresión Causa #2 (CASO-SYNC-PRECIOS-CERVEZAS-SUPERVISOR-23102026):
// el autoguardado de ProductContext escribía con clausuras stale capturadas
// antes del heal del comando del supervisor y revertía precios/auditoría.
// Fix B: merge durable-first cuando durable.updatedAt es estrictamente más
// nuevo, y lastOperationId siempre desde durable (recibo de comando).
const m = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), toast: vi.fn(), context: null }));
vi.mock('../src/utils/storageService', () => ({ storageService: { getItem: m.read, setItem: m.write, removeItem: vi.fn() } }));
vi.mock('../src/hooks/useCloudSync', () => ({ pushLocalSync: vi.fn(), queueCloudSync: vi.fn() }));
vi.mock('../src/services/inventoryOperationService', () => ({ recoverPendingInventoryOperations: vi.fn() }));
vi.mock('../src/services/employeeService', () => ({ recoverPendingEmployeeOperations: vi.fn() }));
vi.mock('../src/components/Toast', () => ({ showToast: m.toast }));
import { ProductProvider, useProductContext } from '../src/context/ProductContext';

// Huella forense real del caso (producto Zulia): precios y updatedAt viejos
// (2026-10-10) junto a stockUpdatedAt fresco = firma del autoguardado.
const STALE = {
    id: 'p1', name: 'Zulia', stock: 5,
    priceUsd: 3.5, priceUsdt: 3.5, boxPriceBs: 25480, boxPriceBsManual: 25480,
    updatedAt: '2026-10-10T00:34:13.091Z',
    updatedByName: 'cliente', updatedByRole: 'CAJA',
    lastOperationId: 'cmd-1',
    stockUpdatedAt: '2026-10-24T01:51:16.000Z',
};
// Estado reparado por el comando del supervisor (heal escrito en IndexedDB).
const HEALED = {
    ...STALE,
    stock: 4,
    priceUsd: 3.8, priceUsdt: 3.8, boxPriceBs: 27230, boxPriceBsManual: 27230,
    updatedAt: '2026-10-24T22:33:28.805Z',
    updatedByName: 'mon_o7v9vj2u8v_mxiv7cky', updatedByRole: 'SUPERVISOR',
    lastOperationId: 'cmd-2',
    stockUpdatedAt: '2026-10-24T22:33:28.805Z',
};

function Probe() { const context = useProductContext(); useEffect(() => { m.context = context; }); return null; }
let root, host, durable;

beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks(); vi.useFakeTimers(); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    durable = [];
    m.read.mockImplementation(async (key, fallback) => (key === 'bodega_products_v1' ? durable : fallback));
    m.write.mockResolvedValue(undefined);
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

async function mount() {
    await act(async () => root.render(createElement(ProductProvider, { rates: { bcv: { price: 100 } } }, createElement(Probe))));
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(m.context.isLoadingProducts).toBe(false);
}
function lastProductsWrite() {
    const calls = m.write.mock.calls.filter(([key]) => key === 'bodega_products_v1');
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][1];
}

it('la clausura stale no revierte el heal: durable más nuevo manda completo (Fix B, Causa #2)', async () => {
    durable = [structuredClone(STALE)];
    await mount();
    // El heal del comando ya escribió IndexedDB, pero la memoria React quedó
    // stale (gap persistProductsSnapshot → dispatch). Se dispara el autoguardado
    // con la clausura vieja — exactamente la escritura culpable del caso.
    durable = [structuredClone(HEALED)];
    await act(async () => { m.context.setProducts([structuredClone(STALE)]); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });

    const written = lastProductsWrite()[0];
    expect(written).toMatchObject({
        priceUsd: 3.8, priceUsdt: 3.8, boxPriceBs: 27230, boxPriceBsManual: 27230,
        updatedAt: '2026-10-24T22:33:28.805Z',
        updatedByName: 'mon_o7v9vj2u8v_mxiv7cky', updatedByRole: 'SUPERVISOR',
        lastOperationId: 'cmd-2', stock: 4,
    });
    expect(written.priceUsd).not.toBe(3.5);
    expect(written.updatedAt).not.toBe('2026-10-10T00:34:13.091Z');
});

it('con marcas iguales la memoria gana: solo durable ESTRICTAMENTE más nuevo invierte la prioridad', async () => {
    durable = [{ ...structuredClone(STALE), name: 'DURABLE' }];
    await mount();
    await act(async () => { m.context.setProducts([{ ...structuredClone(STALE), name: 'MEM' }]); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(lastProductsWrite()[0].name).toBe('MEM');
});

it('lastOperationId se preserva desde durable aunque la memoria sea más nueva (Fix B3)', async () => {
    durable = [structuredClone(HEALED)];
    await mount();
    // Edición local posterior (updatedAt más nuevo) que arrastra un recibo viejo:
    // sin protección, el autoguardado destruía el recibo del comando aplicado y
    // el Monitor dejaba el cambio «en confirmación» para siempre.
    const memoryRow = { ...structuredClone(HEALED), name: 'Zulia Editada', lastOperationId: 'cmd-1', updatedAt: '2026-10-24T22:50:00.000Z' };
    await act(async () => { m.context.setProducts([memoryRow]); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });

    const written = lastProductsWrite()[0];
    expect(written.name).toBe('Zulia Editada');
    expect(written.priceUsd).toBe(3.8);
    expect(written.lastOperationId).toBe('cmd-2');
});
