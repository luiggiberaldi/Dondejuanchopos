import { describe, it, expect, beforeEach, vi } from 'vitest';
import { processSaleTransaction } from '../checkoutProcessor';
import { processVoidSale } from '../voidSaleProcessor';
import { storageService } from '../storageService';

// Mock storageService to run in memory
vi.mock('../storageService', () => {
    let memoryStore = {};
    return {
        storageService: {
            getItem: vi.fn(async (key, defaultValue) => memoryStore[key] ?? defaultValue),
            setItem: vi.fn(async (key, value) => { memoryStore[key] = value; }),
            removeItem: vi.fn(async (key) => { delete memoryStore[key]; }),
            _resetMemory: () => { memoryStore = {}; }
        }
    };
});

// Mock withLock to execute callback directly
vi.mock('../withLock', () => ({
    withLock: vi.fn((key, cb) => cb())
}));

// Mock audit log
vi.mock('../../services/auditService', () => ({
    logEvent: vi.fn()
}));

// Mock AuthStore
vi.mock('../../hooks/store/useAuthStore', () => ({
    useAuthStore: {
        getState: () => ({ usuarioActivo: { nombre: 'Tester', rol: 'ADMIN' } })
    }
}));

describe('Modular Combo Stock Processing', () => {
    const mockProducts = [
        { id: 'p-polar', name: 'Polar Pilsen', stock: 20, priceUsd: 1 },
        { id: 'p-ice', name: 'Polar Ice', stock: 15, priceUsd: 1 },
        { id: 'p-tobo', name: 'Tobo Hielo', stock: 5, priceUsd: 2 },
        {
            id: 'c-tobo-fiesta',
            name: 'Tobo Fiesta',
            isCombo: true,
            isModular: true,
            priceUsd: 12,
            comboItems: [{ productId: 'p-tobo', qty: 1 }],
            modularGroups: [
                {
                    id: 'g-beers',
                    title: 'Cervezas a elección',
                    requiredQty: 10,
                    allowedProductIds: ['p-polar', 'p-ice']
                }
            ]
        }
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        storageService._resetMemory();
        localStorage.clear();
    });

    it('should deduct stock correctly for modular selections on sale', async () => {
        await storageService.setItem('bodega_products_v1', mockProducts);

        const cartItem = {
            id: 'c-tobo-fiesta_modular_1',
            _originalId: 'c-tobo-fiesta',
            name: 'Tobo Fiesta',
            priceUsd: 12,
            qty: 1,
            isModular: true,
            modularSelections: [
                { groupId: 'g-beers', productId: 'p-polar', qty: 6, productName: 'Polar Pilsen' },
                { groupId: 'g-beers', productId: 'p-ice', qty: 4, productName: 'Polar Ice' }
            ]
        };

        const result = await processSaleTransaction({
            cart: [cartItem],
            cartTotalUsd: 12,
            cartTotalBs: 480,
            cartSubtotalUsd: 12,
            payments: [{ methodId: 'efectivo_usd', amountUsd: 12, currency: 'USD' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: null,
            customers: [],
            products: mockProducts,
            effectiveRate: 40,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40
        });

        expect(result.success).toBe(true);

        const updatedProducts = result.updatedProducts;
        const polar = updatedProducts.find(p => p.id === 'p-polar');
        const ice = updatedProducts.find(p => p.id === 'p-ice');
        const tobo = updatedProducts.find(p => p.id === 'p-tobo');

        expect(polar.stock).toBe(14); // 20 - 6
        expect(ice.stock).toBe(11);   // 15 - 4
        expect(tobo.stock).toBe(4);   // 5 - 1
    });

    it('should restore stock correctly on void sale for modular selections', async () => {
        const sale = {
            id: 'sale-123',
            saleNumber: 1,
            status: 'COMPLETADA',
            totalUsd: 12,
            items: [
                {
                    id: 'c-tobo-fiesta_modular_1',
                    _originalId: 'c-tobo-fiesta',
                    name: 'Tobo Fiesta',
                    qty: 1,
                    priceUsd: 12,
                    isModular: true,
                    modularSelections: [
                        { groupId: 'g-beers', productId: 'p-polar', qty: 6, productName: 'Polar Pilsen' },
                        { groupId: 'g-beers', productId: 'p-ice', qty: 4, productName: 'Polar Ice' }
                    ]
                }
            ],
            payments: [{ methodId: 'efectivo_usd', amountUsd: 12 }]
        };

        // Products after sale
        const productsAfterSale = [
            { id: 'p-polar', name: 'Polar Pilsen', stock: 14, priceUsd: 1 },
            { id: 'p-ice', name: 'Polar Ice', stock: 11, priceUsd: 1 },
            { id: 'p-tobo', name: 'Tobo Hielo', stock: 4, priceUsd: 2 },
            { id: 'c-tobo-fiesta', name: 'Tobo Fiesta', isCombo: true, isModular: true, priceUsd: 12 }
        ];

        await storageService.setItem('bodega_sales_v1', [sale]);
        await storageService.setItem('bodega_products_v1', productsAfterSale);

        const result = await processVoidSale(sale, [sale], productsAfterSale);

        expect(result.updatedProducts).toBeDefined();
        const polar = result.updatedProducts.find(p => p.id === 'p-polar');
        const ice = result.updatedProducts.find(p => p.id === 'p-ice');
        const tobo = result.updatedProducts.find(p => p.id === 'p-tobo');

        expect(polar.stock).toBe(20); // 14 + 6
        expect(ice.stock).toBe(15);   // 11 + 4
        expect(tobo.stock).toBe(5);   // 4 + 1
    });
});
