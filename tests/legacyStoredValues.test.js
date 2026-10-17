// Regresión de la incidencia VTA-PROCESO-01 (venta histórica con totalUsd: -0):
// localforage persiste con structured clone y conserva -0, NaN y undefined en
// arrays. Reescribir la colección completa los volvía a encontrar en el commit
// transaccional y bloqueaba TODO cobro del equipo. Ahora se sanean al leer a su
// proyección JSON (con error que nombra clave[ruta]) y las escrituras rechazan
// introducir valores sin proyección JSON, también en claves pesadas.
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ db: new Map(), write: vi.fn(), audit: vi.fn(), push: vi.fn() }));
vi.mock('localforage', () => ({ default: {
    config: vi.fn(), getItem: async k => structuredClone(m.db.get(k) ?? null),
    setItem: (k, v) => m.write(k, v), removeItem: async k => m.db.delete(k),
    createInstance: () => ({ getItem: async () => null }),
} }));
vi.mock('../src/hooks/useCloudSync', () => ({ queueCloudSync: m.push, pushCloudSync: m.push }));
vi.mock('../src/services/auditService', () => ({ logEvent: m.audit }));
vi.mock('../src/hooks/store/useAuthStore', () => ({ useAuthStore: { getState: () => ({ usuarioActivo: { id: 'actor', nombre: 'Fixture', rol: 'ADMIN' } }) } }));
vi.mock('../src/utils/saleNumberAllocator', () => ({ allocateSaleNumber: async (_device, { localSales }) => ({ saleNumber: Math.max(0, ...localSales.map(s => Number(s.saleNumber) || 0)) + 1, provisional: true, note: 'fixture' }) }));

let core, checkout;
const P = 'bodega_products_v1', C = 'bodega_customers_v1', S = 'bodega_sales_v1', K = 'bodega_kardex_v1';
const product = { id: 'p', name: 'Fixture', stock: 10, priceUsd: 5, costUsd: 1, unit: 'unidad' };
const customer = { id: 'c', name: 'Fixture', deuda: 0, favor: 0 };

async function loadModules() {
    vi.resetModules();
    core = (await import('../src/utils/localStore')).localStore;
    await import('../src/utils/storageService'); // efecto secundario: se registra sobre localStore
    checkout = (await import('../src/utils/checkoutProcessor')).processSaleTransaction;
}

function saleInput() {
    return {
        cart: [{ ...product, qty: 1 }], cartTotalUsd: 5, cartTotalBs: 200, cartSubtotalUsd: 5,
        payments: [{ methodId: 'efectivo_usd', amountUsd: 5, currency: 'USD' }],
        changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0, vueltoParaMonederoUsd: 0 },
        selectedCustomerId: '', customers: [], products: [product],
        effectiveRate: 40, bcvRate: 40, tasaCop: 0, copEnabled: false,
        discountData: null, checkoutOperationId: 'checkout-legacy',
    };
}

beforeEach(async () => {
    localStorage.clear(); m.db.clear();
    m.audit.mockReset(); m.push.mockReset();
    m.write.mockReset().mockImplementation(async (k, v) => m.db.set(k, structuredClone(v)));
    m.db.set(P, [product]); m.db.set(C, [customer]); m.db.set(S, []); m.db.set(K, []);
    await loadModules();
});
afterEach(() => vi.restoreAllMocks());

it('una venta heredada con -0/NaN/undefined no bloquea el cobro y se sana al leer', async () => {
    m.db.set(S, [{
        id: 'legacy-poison', tipo: 'VENTA', saleNumber: 3,
        totalUsd: -0, bsVsUsdDiffBs: NaN, tags: [undefined],
        timestamp: '2026-01-01T00:00:00.000Z',
    }]);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const healed = await core.getItem(S);
    expect(Object.is(healed[0].totalUsd, -0)).toBe(false);
    expect(healed[0].totalUsd).toBe(0);
    expect(healed[0].bsVsUsdDiffBs).toBeNull();
    expect(healed[0].tags).toEqual([null]);

    const result = await checkout(saleInput());
    expect(result.success).toBe(true);

    const legacy = m.db.get(S).find(s => s.id === 'legacy-poison');
    expect(legacy.totalUsd).toBe(0);
    expect(legacy.bsVsUsdDiffBs).toBeNull();
    expect(legacy.tags).toEqual([null]);
    expect(errors.mock.calls.some(([msg]) => String(msg).includes('bodega_sales_v1') && String(msg).includes('totalUsd'))).toBe(true);
});

it('un valor heredado sin proyección JSON falla con la ruta, sin degradar en silencio', async () => {
    const circular = { id: 'circular', saleNumber: 1 };
    circular.self = circular;
    m.db.set(S, [circular]);
    await expect(core.getItem(S)).rejects.toMatchObject({ code: 'STORAGE_READ_FAILED' });
    await expect(core.getItem(S)).rejects.toThrow(/bodega_sales_v1\[0\]\.self/);
});

it('la escritura simple rechaza valores no representables también en claves pesadas', async () => {
    await expect(core.setItem(S, [{ id: 'x', totalUsd: NaN }])).rejects.toMatchObject({ code: 'STORAGE_WRITE_FAILED' });
    expect(m.db.get(S)).toEqual([]);
    await core.setItem(S, [{ id: 'x', totalUsd: -0 }]);
    expect(Object.is(m.db.get(S)[0].totalUsd, -0)).toBe(false);
    expect(m.db.get(S)[0].totalUsd).toBe(0);
});
