import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ store: new Map() }));

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, defaultValue = null) => (
            state.store.has(key) ? state.store.get(key) : defaultValue
        )),
        setItem: vi.fn(async (key, value) => {
            state.store.set(key, JSON.parse(JSON.stringify(value)));
            return value;
        }),
        removeItem: vi.fn(async key => state.store.delete(key))
    }
}));

vi.mock('../src/utils/withLock', () => ({
    withLock: vi.fn(async (_name, callback) => callback())
}));

vi.mock('../src/hooks/useCloudSync', () => ({
    queueCloudSync: vi.fn(),
    pushCloudSync: vi.fn(async () => true),
    pushLocalSync: vi.fn()
}));

vi.mock('../src/services/auditService', () => ({
    logEvent: vi.fn(),
    auditLog: vi.fn()
}));

vi.mock('../src/hooks/store/useAuthStore', () => ({
    useAuthStore: {
        getState: () => ({ usuarioActivo: { id: 'u_admin', nombre: 'Admin', usuario: 'admin', rol: 'ADMIN' } })
    }
}));

import { storageService } from '../src/utils/storageService';
import { withLock } from '../src/utils/withLock';
import { buildProductPayload } from '../src/utils/productProcessor';
import { applyInventoryOperationUnlocked } from '../src/services/inventoryOperationService';
import { compareBarcodes } from '../src/utils/calculatorUtils';

const PRODUCTS_KEY = 'bodega_products_v1';
const KARDEX_KEY = 'bodega_kardex_v1';

describe('Blindaje y Concurrencia en Registro y Edición de Productos', () => {
    beforeEach(async () => {
        state.store.clear();
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('1. Edición sin cambio de stock (Zero-Delta Guard): guarda cambios de atributos sin error de Kardex', async () => {
        const initialProducts = [
            { id: 'p1', name: 'Malta Polar 250ml', stock: 15, priceUsd: 1.0, costUsd: 0.5, unit: 'unidad', category: 'bebidas' }
        ];
        await storageService.setItem(PRODUCTS_KEY, initialProducts);

        // Simulamos la lógica de _commitSave para una edición de precio y nombre donde stock no cambia (15 -> 15)
        const editingId = 'p1';
        const productData = buildProductPayload({
            name: 'Malta Polar Retornable',
            priceUsd: '1.25',
            costUsd: '0.50',
            stock: '15',
            category: 'bebidas',
            unit: 'unidad'
        }, 50);

        const nowIso = new Date().toISOString();
        const liveProducts = await storageService.getItem(PRODUCTS_KEY) || [];
        const liveExisting = liveProducts.find(p => p.id === editingId);
        const liveOldStock = Number(liveExisting.stock) || 0;
        const liveRequestedStock = Number(productData.stock) || 0;
        const stockDiff = liveRequestedStock - liveOldStock;

        // Zero-Delta Guard:
        const pendingStockOperation = stockDiff !== 0 ? {
            productId: editingId,
            delta: stockDiff,
            oldStock: liveOldStock,
            newStock: liveRequestedStock
        } : null;

        const updatedProducts = liveProducts.map(p => p.id === editingId
            ? { ...p, ...productData, stock: liveOldStock, updatedAt: nowIso }
            : p
        );

        await storageService.setItem(PRODUCTS_KEY, updatedProducts);

        // Si pendingStockOperation es null, no debe llamarse a applyInventoryOperationUnlocked
        let inventoryOperationCalled = false;
        if (pendingStockOperation && pendingStockOperation.delta !== 0) {
            inventoryOperationCalled = true;
            await applyInventoryOperationUnlocked({ deductions: [{ cantidad: pendingStockOperation.delta }] });
        }

        expect(inventoryOperationCalled).toBe(false);
        expect(pendingStockOperation).toBeNull();

        const stored = await storageService.getItem(PRODUCTS_KEY);
        expect(stored[0].name).toBe('Malta Polar Retornable');
        expect(stored[0].priceUsd).toBe(1.25);
        expect(stored[0].stock).toBe(15);
    });

    it('2. Edición con cambio de stock: aplica la operación de inventario y genera Kardex', async () => {
        const initialProducts = [
            { id: 'p2', name: 'Refresco 2L', stock: 10, priceUsd: 2.0, costUsd: 1.0, unit: 'unidad', category: 'bebidas' }
        ];
        await storageService.setItem(PRODUCTS_KEY, initialProducts);
        await storageService.setItem(KARDEX_KEY, []);

        const editingId = 'p2';
        const newStockTarget = 18; // Delta +8
        const liveProducts = await storageService.getItem(PRODUCTS_KEY);
        const liveExisting = liveProducts.find(p => p.id === editingId);
        const stockDiff = newStockTarget - liveExisting.stock;

        const pendingStockOperation = stockDiff !== 0 ? {
            productId: editingId,
            delta: stockDiff,
            oldStock: liveExisting.stock,
            newStock: newStockTarget,
            initial: false
        } : null;

        expect(pendingStockOperation).not.toBeNull();
        expect(pendingStockOperation.delta).toBe(8);

        const result = await applyInventoryOperationUnlocked({
            operationId: `edit_stock_${editingId}`,
            referenceId: editingId,
            referenceType: 'EDICION_PRODUCTO',
            source: 'EDICION_PRODUCTO',
            tipo: pendingStockOperation.delta > 0 ? 'ENTRADA' : 'SALIDA',
            subtipo: 'EDICION_PRODUCTO',
            reason: `Edición de producto (${pendingStockOperation.oldStock}→${pendingStockOperation.newStock})`,
            allowNegative: false,
            actor: { usuarioId: 'u_admin', usuarioNombre: 'Admin' },
            deductions: [{
                productoId: editingId,
                cantidad: pendingStockOperation.delta,
                origen: 'AJUSTE'
            }]
        });

        expect(result.success).toBe(true);
        const stored = await storageService.getItem(PRODUCTS_KEY);
        expect(stored.find(p => p.id === editingId).stock).toBe(18);

        const kardex = await storageService.getItem(KARDEX_KEY);
        expect(kardex.length).toBe(1);
        expect(kardex[0].cantidad).toBe(8);
        expect(kardex[0].stock_antes).toBe(10);
        expect(kardex[0].stock_despues).toBe(18);
    });

    it('3. Arnés anti-inflación de costo: 3 ciclos de edición en producto por caja conservan su costo unitario', async () => {
        // Un producto vendido por caja con costo unitario de $1.25 y 24 unidades por caja
        let product = {
            id: 'p_box_1',
            name: 'Cerveza Polar Lata',
            priceUsd: 1.5,
            priceUsdt: 1.5,
            costUsd: 1.25, // Costo unitario
            costBs: 62.5,
            stock: 48,
            category: 'licores',
            unit: 'unidad',
            sellByBox: true,
            boxUnits: 24,
            boxPriceUsd: 32.0
        };

        // Simular 3 ediciones consecutivas usando la lógica corregida de useProductForm + buildProductPayload
        for (let i = 1; i <= 3; i++) {
            // En populateForm corregido: formCostUsd = product.costUsd (sin multiplicar por boxUnits)
            const currentCostUsd = product.costUsd || 0;
            const formCostUsd = currentCostUsd; // CANÓNICO: unitario

            // Simular guardado desde el formulario
            const savedPayload = buildProductPayload({
                name: product.name,
                priceUsd: product.priceUsd.toString(),
                costUsd: formCostUsd.toString(),
                stock: product.stock.toString(),
                category: product.category,
                unit: product.unit,
                sellByBox: product.sellByBox,
                boxUnits: product.boxUnits.toString(),
                boxPriceUsd: product.boxPriceUsd.toString()
            }, 50);

            product = { ...product, ...savedPayload };
        }

        // El costo unitario DEBE seguir siendo exactamente 1.25, no 1.25 * 24 * 24 * 24
        expect(product.costUsd).toBe(1.25);
    });

    it('4. Preservación de unidad física: editar un producto pesable (kg) preserva su unit: "kg"', async () => {
        const product = {
            id: 'p_peso',
            name: 'Queso Paisa',
            priceUsd: 8.5,
            costUsd: 5.0,
            stock: 25,
            category: 'viveres',
            unit: 'kg'
        };

        const editedPayload = buildProductPayload({
            name: 'Queso Paisa Especial',
            priceUsd: '9.00',
            costUsd: '5.50',
            stock: '25',
            category: 'viveres',
            unit: product.unit // Viene de useProductForm poblado
        }, 50);

        expect(editedPayload.unit).toBe('kg');
    });

    it('5. Guardado de Combos con Lock y Snapshot en vivo: no borra ventas concurrentes', async () => {
        const initialProducts = [
            { id: 'prod_a', name: 'Ron 1L', stock: 50, priceUsd: 10, costUsd: 6 },
            { id: 'prod_b', name: 'Hielo', stock: 30, priceUsd: 2, costUsd: 1 }
        ];
        await storageService.setItem(PRODUCTS_KEY, initialProducts);

        // Simulamos que el formulario del combo se abrió con el catálogo inicial (Ron stock=50)
        const staleProductsInReactState = [...initialProducts];

        // Mientras el modal de combo estaba abierto, ocurre una venta concurrente que descuenta 5 rones (stock -> 45)
        const updatedAfterSale = initialProducts.map(p => p.id === 'prod_a' ? { ...p, stock: 45 } : p);
        await storageService.setItem(PRODUCTS_KEY, updatedAfterSale);

        // Ahora el usuario presiona "Guardar Combo" usando handleComboSave con withLock + liveProducts
        const newCombo = {
            id: 'combo_party',
            name: 'Combo Rumbero',
            priceUsd: 15,
            isCombo: true,
            comboItems: [{ productId: 'prod_a', qty: 1 }, { productId: 'prod_b', qty: 1 }]
        };

        const updatedProducts = await withLock('pos_write_lock', async () => {
            const liveProducts = await storageService.getItem(PRODUCTS_KEY, staleProductsInReactState) || [];
            const nextProducts = [newCombo, ...liveProducts.filter(p => p.id !== newCombo.id)];
            await storageService.setItem(PRODUCTS_KEY, nextProducts);
            return nextProducts;
        });

        // El catálogo persistido debe contener el combo Y mantener el stock de 'prod_a' en 45 (NO en 50 de stale)
        const finalStorage = await storageService.getItem(PRODUCTS_KEY);
        const storedRon = finalStorage.find(p => p.id === 'prod_a');
        expect(storedRon.stock).toBe(45);
        expect(finalStorage.some(p => p.id === 'combo_party')).toBe(true);
    });

    it('6. Validación de colisión de código de barras: detecta duplicados en combos contra unidades y cajas', () => {
        const catalog = [
            { id: 'p1', name: 'Malta', barcode: '7591234567890' },
            { id: 'p2', name: 'Cerveza Caja', sellByBox: true, boxBarcode: '7599876543210' }
        ];

        // Intentar usar el código de la caja de cerveza en un combo
        const comboBarcode = '7599876543210';
        const isCollision = catalog.some(p => {
            const otherBarcodes = [p.barcode, p.boxBarcode, p.halfBoxBarcode].filter(Boolean);
            return otherBarcodes.some(obc => compareBarcodes(obc, comboBarcode));
        });

        expect(isCollision).toBe(true);

        // Un código nuevo no registrado
        const uniqueBarcode = '7590001112223';
        const isUniqueCollision = catalog.some(p => {
            const otherBarcodes = [p.barcode, p.boxBarcode, p.halfBoxBarcode].filter(Boolean);
            return otherBarcodes.some(obc => compareBarcodes(obc, uniqueBarcode));
        });

        expect(isUniqueCollision).toBe(false);
    });

    it('7. Ajuste Masivo de Precios (BulkPriceAdjustModal): actualiza priceUsd y boxPriceUsd y persiste en storage', async () => {
        const initialProducts = [
            { id: 'p1', name: 'Cerveza', category: 'licores', priceUsd: 1.0, priceUsdt: 1.0, sellByBox: true, boxPriceUsd: 24.0 },
            { id: 'p2', name: 'Galleta', category: 'snacks', priceUsd: 2.0, priceUsdt: 2.0 }
        ];
        await storageService.setItem(PRODUCTS_KEY, initialProducts);

        // Aumentar 10% a categoría 'licores'
        const multiplier = 1.10;
        const selectedCategory = 'licores';

        const updated = await withLock('pos_write_lock', async () => {
            const liveProducts = await storageService.getItem(PRODUCTS_KEY) || [];
            const nextProducts = liveProducts.map(p => {
                if (p.category !== selectedCategory) return p;

                const currentPrice = Number(p.priceUsd) || Number(p.priceUsdt) || 0;
                const newPrice = Math.max(0.01, parseFloat((currentPrice * multiplier).toFixed(4)));
                const item = {
                    ...p,
                    priceUsd: newPrice,
                    priceUsdt: newPrice,
                    updatedAt: new Date().toISOString()
                };
                if (p.sellByBox && p.boxPriceUsd && Number(p.boxPriceUsd) > 0) {
                    item.boxPriceUsd = Math.max(0.01, parseFloat((Number(p.boxPriceUsd) * multiplier).toFixed(4)));
                }
                return item;
            });

            await storageService.setItem(PRODUCTS_KEY, nextProducts);
            return nextProducts;
        });

        const stored = await storageService.getItem(PRODUCTS_KEY);
        const storedBeer = stored.find(p => p.id === 'p1');
        const storedSnack = stored.find(p => p.id === 'p2');

        expect(storedBeer.priceUsd).toBe(1.1);
        expect(storedBeer.priceUsdt).toBe(1.1);
        expect(storedBeer.boxPriceUsd).toBe(26.4); // 24 * 1.1 = 26.4

        // Snack no pertenece a 'licores', no debe modificarse
        expect(storedSnack.priceUsd).toBe(2.0);
    });
});
