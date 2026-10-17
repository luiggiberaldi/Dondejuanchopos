import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';

const m = vi.hoisted(() => ({ db: new Map() }));
vi.mock('localforage', () => ({
    default: {
        config: vi.fn(),
        getItem: async (key) => structuredClone(m.db.get(key) ?? null),
        setItem: async (k, v) => { m.db.set(k, structuredClone(v)); },
        removeItem: async (key) => { m.db.delete(key); },
        clear: async () => { m.db.clear(); },
        createInstance: () => ({ getItem: vi.fn().mockResolvedValue(null) }),
    }
}));
vi.mock('../src/hooks/useCloudSync', () => ({ queueCloudSync: vi.fn() }));
// Esta prueba aísla el commit IndexedDB/localStorage; la asignación de número
// remoto se cubre por separado en saleNumberAllocator.test.js.
vi.mock('../src/utils/saleNumberAllocator', () => ({
    allocateSaleNumber: vi.fn(async (_deviceId, { localSales = [] } = {}) => ({
        saleNumber: Math.max(0, ...localSales.map(sale => Number(sale.saleNumber) || 0)) + 1,
        provisional: true,
        source: 'fallback',
        note: 'offline fixture',
    })),
}));

describe('Checkout Quota Resolution Test', () => {
    let processSaleTransaction;

    beforeEach(async () => {
        vi.restoreAllMocks();
        localStorage.clear();
        m.db.clear();
        const mod1 = await import('../src/utils/checkoutProcessor');
        processSaleTransaction = mod1.processSaleTransaction;
    });

    it('processes Glup 2L checkout successfully with 1568 sales in IDB and dirty LS', async () => {
        // 1. Cargar snapshot real
        const data = JSON.parse(fs.readFileSync('backups_extracted/sync_snapshot_PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F_latest.json', 'utf8'));
        const products = data.collections.store.bodega_products_v1 || [];
        const customers = data.collections.store.bodega_customers_v1 || [];
        const sales = data.collections.store.bodega_sales_v1 || [];
        const kardex = data.collections.store.bodega_kardex_v1 || [];

        // Guardar colecciones completas en IDB
        m.db.set('bodega_products_v1', products);
        m.db.set('bodega_customers_v1', customers);
        m.db.set('bodega_sales_v1', sales);
        m.db.set('bodega_sales_mirror_v1', sales);
        m.db.set('bodega_kardex_v1', kardex);

        // 2. Simular claves residuales en localStorage (como las que saturaban la laptop)
        localStorage.setItem('bodega_storage_fallback_v1:bodega_sales_v1', JSON.stringify({ version: 1, key: 'bodega_sales_v1', kind: 'value', value: [{ dummy: 'old' }] }));
        localStorage.setItem('bodega_storage_fallback_v1:bodega_kardex_v1', JSON.stringify({ version: 1, key: 'bodega_kardex_v1', kind: 'value', value: [{ dummy: 'old' }] }));

        // 3. Carrito idéntico al video: Glup 2L ($1.43 / 1.400 Bs)
        const glup = products.find(p => p.name?.toLowerCase().includes('glup')) || {
            id: 'glup_2l_test',
            name: 'Glup negro y sabores 2lt',
            priceUsd: 1.43,
            stock: 15,
            _mode: 'unit'
        };

        const cart = [{
            ...glup,
            qty: 1,
            priceUsd: 1.43,
            _mode: 'unit'
        }];

        const effectiveRate = 980; // 980 Bs/$ como en el video
        const cartTotalUsd = 1.43;
        const cartTotalBs = 1400;

        const payments = [{
            methodId: 'efectivo_bs',
            currency: 'BS',
            amount: 1400,
            amountBs: 1400,
            amountUsd: 1.43,
            methodLabel: 'Efectivo Bolívares',
            isCash: true
        }];

        const changeBreakdown = {
            changeUsdGiven: 0,
            changeBsGiven: 0,
            tipDonated: null,
            changeOwed: null,
            changeVoucher: null,
            vueltoParaMonederoUsd: 0,
            vueltoParaMonederoBs: 0,
            vueltoParaMonederoCurrency: 'BS',
            checkoutOperationId: 'test_glup_checkout_' + Date.now()
        };

        const paymentMethods = [
            { id: 'efectivo_usd', label: 'Efectivo $', currency: 'USD', isCash: true, isEnabled: true },
            { id: 'efectivo_bs', label: 'Efectivo Bs', currency: 'BS', isCash: true, isEnabled: true },
            { id: 'pago_movil', label: 'Pago Móvil', currency: 'BS', isCash: false, isEnabled: true },
            { id: 'punto_de_venta', label: 'Punto de Venta', currency: 'BS', isCash: false, isEnabled: true },
        ];

        // 4. Procesar cobro
        const result = await processSaleTransaction({
            cart,
            cartTotalUsd,
            cartTotalBs,
            cartSubtotalUsd: cartTotalUsd,
            payments,
            changeBreakdown,
            selectedCustomerId: '',
            customers,
            products,
            effectiveRate,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: true,
            bcvRate: effectiveRate,
            paymentMethods,
            checkoutOperationId: changeBreakdown.checkoutOperationId
        });

        // 5. Verificaciones
        expect(result.success).toBe(true);
        expect(result.sale).toBeDefined();
        expect(result.sale.items[0].name).toContain('Glup');
        expect(result.updatedProducts).toBeDefined();

        // Verificar que la venta fue agregada al array de ventas en IDB
        const savedSales = m.db.get('bodega_sales_v1');
        expect(savedSales.length).toBe(sales.length + 1);
        expect(savedSales[0].id).toBe(result.sale.id);

        console.log('✅ Cobro completado con éxito. Venta asignada:', result.sale.saleNumber || result.sale.id);
    });
});
