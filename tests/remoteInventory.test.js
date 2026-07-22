// tests/remoteInventory.test.js — Aplicador de comandos remotos de inventario (D3/D4/D8)
import { describe, it, expect, beforeEach, vi } from 'vitest';

const _memoryStore = new Map();

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, defaultValue = null) => {
            if (_memoryStore.has(key)) return _memoryStore.get(key);
            return defaultValue;
        }),
        setItem: vi.fn(async (key, value) => {
            _memoryStore.set(key, JSON.parse(JSON.stringify(value)));
        }),
    },
}));

vi.mock('../src/services/auditService', () => ({
    logEvent: vi.fn(() => Promise.resolve()),
}));

import { applyInventoryCommand } from '../src/utils/remoteInventoryProcessor';
import { storageService } from '../src/utils/storageService';

const PRODUCTS_KEY = 'bodega_products_v1';

const baseProduct = {
    id: 'p1', name: 'Ron Santa Teresa', priceUsd: 10, priceUsdt: 10,
    priceBsManual: 8500, stock: 24, barcode: '111',
    sellByBox: true, boxUnits: 12, boxBarcode: '222', boxPriceUsd: 110, boxPriceBs: 90000,
    sellByHalfBox: false, image: 'https://bucket/foto.webp',
};

describe('applyInventoryCommand — comandos remotos de inventario', () => {
    beforeEach(async () => {
        _memoryStore.clear();
        localStorage.removeItem('allow_negative_stock');
        await storageService.setItem(PRODUCTS_KEY, [baseProduct]);
    });

    it('add válido agrega el producto normalizado (priceUsdt espejo, Bs manual)', async () => {
        const res = await applyInventoryCommand({
            action: 'add',
            data: { name: 'Cerveza Zulia', priceUsd: 1.5, priceBsManual: 1300, stock: 36, barcode: '333' },
        });
        expect(res.success).toBe(true);
        const products = await storageService.getItem(PRODUCTS_KEY);
        const added = products.find(p => p.name === 'Cerveza Zulia');
        expect(added).toBeTruthy();
        expect(added.priceUsdt).toBe(1.5);      // alias canónico siempre espejo
        expect(added.priceBsManual).toBe(1300); // Bs manual independiente
    });

    it('add con barcode duplicado (incluye boxBarcode ajeno) → failed sin tocar inventario', async () => {
        const res = await applyInventoryCommand({
            action: 'add',
            data: { name: 'Pirata', priceUsd: 2, barcode: '222' }, // choca con boxBarcode de p1
        });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/222/);
        const products = await storageService.getItem(PRODUCTS_KEY);
        expect(products.length).toBe(1);
    });

    it('edit inexistente → failed', async () => {
        const res = await applyInventoryCommand({
            action: 'edit', productId: 'nope', data: { name: 'X', priceUsd: 1 },
        });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/no encontrado/i);
    });

    it('edit sin image en el payload PRESERVA la imagen local (D8)', async () => {
        const res = await applyInventoryCommand({
            action: 'edit', productId: 'p1',
            data: { name: 'Ron Santa Teresa', priceUsd: 12, priceBsManual: 9800, barcode: '111', sellByBox: true, boxUnits: 12, boxBarcode: '222', stock: 24 },
        });
        expect(res.success).toBe(true);
        const [p] = await storageService.getItem(PRODUCTS_KEY);
        expect(p.priceUsd).toBe(12);
        expect(p.priceUsdt).toBe(12);
        expect(p.image).toBe('https://bucket/foto.webp'); // preservada
    });

    it('edit NUNCA pisa el stock de la caja (anti-pisado con cola del monitor)', async () => {
        // El monitor encoló la edición con stock viejo (24); la caja vendió y va en 7.
        const products = await storageService.getItem(PRODUCTS_KEY);
        await storageService.setItem(PRODUCTS_KEY, products.map(p => ({ ...p, stock: 7 })));
        const res = await applyInventoryCommand({
            action: 'edit', productId: 'p1',
            data: { name: 'Ron Santa Teresa', priceUsd: 12, barcode: '111', sellByBox: true, boxUnits: 12, boxBarcode: '222', stock: 24 },
        });
        expect(res.success).toBe(true);
        const [p] = await storageService.getItem(PRODUCTS_KEY);
        expect(p.stock).toBe(7);      // se mantiene el stock real de la caja
        expect(p.priceUsd).toBe(12);  // el resto de la edición sí aplica
    });

    it('edit con ½ Caja sin Caja → failed (regla de formatos)', async () => {
        const res = await applyInventoryCommand({
            action: 'edit', productId: 'p1',
            data: { name: 'Ron', priceUsd: 10, sellByBox: false, sellByHalfBox: true },
        });
        expect(res.success).toBe(false);
    });

    it('adjust_stock con delta negativo no baja de 0 (sin allow_negative_stock)', async () => {
        const res = await applyInventoryCommand({
            action: 'adjust_stock', productId: 'p1', data: { delta: -100 },
        });
        expect(res.success).toBe(true);
        const [p] = await storageService.getItem(PRODUCTS_KEY);
        expect(p.stock).toBe(0);
    });

    it('adjust_stock suma delta positivo', async () => {
        const res = await applyInventoryCommand({
            action: 'adjust_stock', productId: 'p1', data: { delta: 5 },
        });
        expect(res.success).toBe(true);
        const [p] = await storageService.getItem(PRODUCTS_KEY);
        expect(p.stock).toBe(29);
    });

    it('delete elimina y reporta el nombre', async () => {
        const res = await applyInventoryCommand({ action: 'delete', productId: 'p1' });
        expect(res.success).toBe(true);
        expect(res.productName).toBe('Ron Santa Teresa');
        const products = await storageService.getItem(PRODUCTS_KEY);
        expect(products.length).toBe(0);
    });

    it('acción desconocida → failed', async () => {
        const res = await applyInventoryCommand({ action: 'destroy_all', productId: 'p1' });
        expect(res.success).toBe(false);
    });

    it('normalizeProduct aplica D4: modo bcv limpia priceBsManual y deriva forceBcv', async () => {
        const res = await applyInventoryCommand({
            action: 'edit', productId: 'p1',
            data: { name: 'Ron Santa Teresa', priceUsd: 10, priceBsManual: 820, pricingMode: 'bcv', barcode: '111', sellByBox: true, boxUnits: 12, boxBarcode: '222' },
        });
        expect(res.success).toBe(true);
        const [p] = await storageService.getItem(PRODUCTS_KEY);
        expect(p.priceBsManual).toBeNull();  // basura limpiada por D4
        expect(p.forceBcv).toBe(true);       // derivado del modo
        expect(p.pricingMode).toBe('bcv');
    });

    it('normalizeProduct aplica D4: modo dual_usd conserva priceBsUsdRef y limpia priceBsManual', async () => {
        const res = await applyInventoryCommand({
            action: 'edit', productId: 'p1',
            data: { name: 'Ron Santa Teresa', priceUsd: 1, priceBsUsdRef: 2, priceBsManual: 999, pricingMode: 'dual_usd', barcode: '111', sellByBox: true, boxUnits: 12, boxBarcode: '222' },
        });
        expect(res.success).toBe(true);
        const [p] = await storageService.getItem(PRODUCTS_KEY);
        expect(p.priceBsUsdRef).toBe(2);
        expect(p.priceBsManual).toBeNull();
        expect(p.forceBcv).toBe(false);
    });
});
