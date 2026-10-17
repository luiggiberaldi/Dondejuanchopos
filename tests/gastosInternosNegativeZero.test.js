// Tarea 2 — PLAN_FIXES_NORMALIZACION_VALORES_TRANSACCIONALES_2026-10-17.md
// Regresión de la causa raíz del cero negativo: un Gasto Interno en Bolívares
// (p. ej. 350 Bs de agua potable) hacía totalEnUsd = 0 y `totalUsd: -totalEnUsd`
// producía -0. Ese -0 viajaba a bodega_sales_v1 y el guardián transaccional
// bloqueaba TODO cobro del equipo (VTA-PROCESO-01).
import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';

const m = vi.hoisted(() => ({ db: new Map(), write: vi.fn(), audit: vi.fn(), captured: null }));
vi.mock('localforage', () => ({ default: {
    config: vi.fn(),
    getItem: async k => structuredClone(m.db.get(k) ?? null),
    setItem: (k, v) => m.write(k, v),
    removeItem: async k => m.db.delete(k),
    createInstance: () => ({ getItem: async () => null }),
} }));
vi.mock('../src/components/Toast', () => ({ showToast: vi.fn() }));
vi.mock('../src/hooks/store/useAuthStore', () => ({ useAuthStore: { getState: () => ({ usuarioActivo: { id: 1, nombre: 'Fixture', rol: 'ADMIN' } }) } }));
vi.mock('../src/services/auditService', () => ({ logEvent: vi.fn() }));
vi.mock('../src/services/inventoryOperationService', () => ({
    applyInventoryOperationUnlocked: async () => ({ success: true, updatedProducts: [] }),
}));

const S = 'bodega_sales_v1';
let core, useGastos, api, root, host;

const props = {
    bcvRate: 36.5, tasaCop: 0, copEnabled: false,
    triggerHaptic: vi.fn(), auditLog: m.audit,
    sales: [], setSales: list => { m.captured = list; },
};

function Harness() {
    const result = useGastos(props);
    useEffect(() => { api = result; });
    return null;
}

beforeEach(async () => {
    localStorage.clear(); m.db.clear(); m.captured = null;
    m.audit.mockReset(); m.write.mockReset().mockImplementation(async (k, v) => { m.db.set(k, structuredClone(v)); });
    m.db.set(S, []);
    vi.resetModules();
    core = (await import('../src/utils/localStore')).localStore;
    await import('../src/utils/storageService'); // efecto secundario: se registra sobre localStore
    useGastos = (await import('../src/hooks/useGastosInternos')).useGastosInternos;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root.render(createElement(Harness)));
});

afterEach(async () => {
    await act(async () => root.unmount()); host.remove();
    vi.restoreAllMocks();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

it('gasto de 350 Bs: totalBs -350, ningún -0, y persiste sin TypeError transaccional', async () => {
    let ok;
    await act(async () => {
        ok = await api.registrarGasto({
            description: 'Agua potable', category: 'insumos',
            amountUsd: 0, amountBs: 350, methodId: 'efectivo_bs', currency: 'BS', note: '',
        });
    });
    expect(ok).toBe(true);

    const gasto = m.captured[0];
    expect(gasto.tipo).toBe('GASTO_INTERNO');
    expect(gasto.totalBs).toBe(-350);
    expect(gasto.totalUsd).toBe(0);
    expect(Object.is(gasto.totalUsd, -0)).toBe(false);
    expect(gasto.items[0].priceUsd).toBe(0);
    expect(Object.is(gasto.items[0].priceUsd, -0)).toBe(false);
    expect(gasto.items[0].costBs).toBe(-350);
    expect(gasto.payments[0].amountBs).toBe(-350);
    expect(gasto.payments[0].amountUsd).toBe(0);
    expect(Object.is(gasto.payments[0].amountUsd, -0)).toBe(false);

    // El registro debe cruzar localStore.transaction sin
    // TypeError: Valor transaccional no representable.
    await expect(core.transaction(async tx => {
        await tx.setItem(S, [gasto]);
        return { success: true };
    })).resolves.toEqual({ success: true });
    const persisted = m.db.get(S)[0];
    expect(persisted.totalUsd).toBe(0);
    expect(Object.is(persisted.totalUsd, -0)).toBe(false);
});

it('gasto en USD simétrico: totalBs 0 sin -0 (espejo del caso en Bs)', async () => {
    let ok;
    await act(async () => {
        ok = await api.registrarGasto({
            description: 'Insumo', category: 'insumos',
            amountUsd: 2, amountBs: 0, methodId: 'efectivo_usd', currency: 'USD', note: '',
        });
    });
    expect(ok).toBe(true);

    const gasto = m.captured[0];
    expect(gasto.totalUsd).toBe(-2);
    expect(gasto.totalBs).toBe(0);
    expect(Object.is(gasto.totalBs, -0)).toBe(false);
    expect(gasto.items[0].costBs).toBe(0);
    expect(Object.is(gasto.items[0].costBs, -0)).toBe(false);
});

it('autoconsumo con valoración 0 no produce -Math.abs(0) = -0', async () => {
    let ok;
    await act(async () => {
        ok = await api.registrarAutoconsumo({
            description: 'Retiro sin valoración', valoracion: 'venta', note: '',
            items: [{ id: 'p1', name: 'Agua', qty: 1, costUsd: 0, priceUsd: 0 }],
            totalUsd: 0, totalBs: 0,
        });
    });
    expect(ok).toBe(true);

    const gasto = m.captured[0];
    expect(gasto.isAutoconsumo).toBe(true);
    expect(gasto.totalUsd).toBe(0);
    expect(Object.is(gasto.totalUsd, -0)).toBe(false);
    expect(gasto.totalBs).toBe(0);
    expect(Object.is(gasto.totalBs, -0)).toBe(false);
    expect(gasto.payments[0].amountUsd).toBe(0);
    expect(Object.is(gasto.payments[0].amountUsd, -0)).toBe(false);
    expect(gasto.payments[0].amountBs).toBe(0);
    expect(Object.is(gasto.payments[0].amountBs, -0)).toBe(false);
});
