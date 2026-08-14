import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    store: new Map(),
    throwOnce: new Set()
}));

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, defaultValue = null) => (
            state.store.has(key) ? state.store.get(key) : defaultValue
        )),
        setItem: vi.fn(async (key, value) => {
            if (state.throwOnce.has(key)) {
                state.throwOnce.delete(key);
                throw new Error(`fallo de persistencia: ${key}`);
            }
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
    pushCloudSync: vi.fn(async () => true)
}));

vi.mock('../src/services/auditService', () => ({
    logEvent: vi.fn()
}));

import {
    applyInventoryOperation,
    applyInventoryOperationUnlocked,
    getInventoryOperations,
    recoverPendingInventoryOperations
} from '../src/services/inventoryOperationService';
import { storageService } from '../src/utils/storageService';

const PRODUCTS_KEY = 'bodega_products_v1';
const KARDEX_KEY = 'bodega_kardex_v1';
const OPS_KEY = 'bodega_inventory_operations_v1';

function product(stock = 10) {
    return {
        id: 'p1',
        name: 'Producto prueba',
        barcode: 'sku-1',
        unit: 'unidad',
        costUsd: 2,
        stock
    };
}

async function seed(stock = 10) {
    await storageService.setItem(PRODUCTS_KEY, [product(stock)]);
    await storageService.setItem(KARDEX_KEY, []);
    await storageService.setItem(OPS_KEY, []);
}

describe('inventoryOperationService', () => {
    beforeEach(async () => {
        state.store.clear();
        state.throwOnce.clear();
        localStorage.clear();
        await seed();
    });

    it('aplica stock y Kardex con snapshots físicos consistentes', async () => {
        const result = await applyInventoryOperation({
            operationId: 'sale-1',
            referenceId: 'sale-1',
            referenceType: 'VENTA',
            source: 'POS_CHECKOUT',
            tipo: 'VENTA',
            subtipo: 'POS_CHECKOUT',
            deductions: [{ productoId: 'p1', cantidad: -2, origen: 'VENTA' }]
        });

        expect(result.success).toBe(true);
        expect(result.transitions[0]).toMatchObject({
            stockAntes: 10,
            stockDespues: 8,
            cantidad: -2,
            cantidadSolicitada: -2
        });
        expect(state.store.get(PRODUCTS_KEY)[0].stock).toBe(8);
        expect(state.store.get(KARDEX_KEY)).toHaveLength(1);
        expect(state.store.get(KARDEX_KEY)[0]).toMatchObject({
            cantidad: -2,
            stock_antes: 10,
            stock_despues: 8,
            referencia_id: 'sale-1'
        });
        expect(state.store.get(OPS_KEY)[0].status).toBe('APPLIED_LOCAL');
    });

    it('repetir la misma operación es idempotente y no duplica stock ni movimientos', async () => {
        const operation = {
            operationId: 'sale-idempotent',
            referenceId: 'sale-idempotent',
            referenceType: 'VENTA',
            tipo: 'VENTA',
            deductions: [{ productoId: 'p1', cantidad: -2, origen: 'VENTA' }]
        };

        const first = await applyInventoryOperation(operation);
        const second = await applyInventoryOperation(operation);

        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
        expect(second.movementIds).toEqual(first.movementIds);
        expect(state.store.get(PRODUCTS_KEY)[0].stock).toBe(8);
        expect(state.store.get(KARDEX_KEY)).toHaveLength(1);
    });

    it('registra la cantidad aplicada al hacer clamp y deja la solicitud auditable', async () => {
        const result = await applyInventoryOperation({
            operationId: 'sale-clamped',
            referenceType: 'VENTA',
            tipo: 'VENTA',
            deductions: [{ productoId: 'p1', cantidad: -99, origen: 'VENTA' }]
        });

        expect(result.success).toBe(true);
        expect(state.store.get(PRODUCTS_KEY)[0].stock).toBe(0);
        expect(state.store.get(KARDEX_KEY)[0]).toMatchObject({
            cantidad: -10,
            stock_antes: 10,
            stock_despues: 0,
            metadata: expect.objectContaining({
                requestedQuantity: -99,
                appliedQuantity: -10,
                unappliedQuantity: -89,
                clamped: true
            })
        });
    });

    it('queda recuperable si falla la escritura del Kardex después del catálogo', async () => {
        state.throwOnce.add(KARDEX_KEY);
        const operation = {
            operationId: 'sale-recoverable',
            referenceType: 'VENTA',
            tipo: 'VENTA',
            deductions: [{ productoId: 'p1', cantidad: -2, origen: 'VENTA' }]
        };

        const failed = await applyInventoryOperationUnlocked(operation);
        expect(failed.success).toBe(false);
        expect(failed.pending).toBe(true);
        // La escritura del Kardex falló: el servicio restaura el catálogo y
        // deja únicamente la operación outbox para reintentar de forma segura.
        expect(state.store.get(PRODUCTS_KEY)[0].stock).toBe(10);
        expect(state.store.get(OPS_KEY)[0].status).toBe('FAILED_RETRYABLE');

        const recovered = await recoverPendingInventoryOperations();
        expect(recovered[0].success).toBe(true);
        expect(state.store.get(PRODUCTS_KEY)[0].stock).toBe(8);
        expect(state.store.get(KARDEX_KEY)).toHaveLength(1);
        expect(state.store.get(OPS_KEY)[0].status).toBe('APPLIED_LOCAL');
    });

    it('conserva una operación fallida por SKU ausente y la recupera cuando aparece', async () => {
        const failed = await applyInventoryOperationUnlocked({
            operationId: 'sale-missing-product',
            referenceType: 'VENTA',
            tipo: 'VENTA',
            deductions: [{ productoId: 'p-missing', cantidad: -2, origen: 'VENTA' }]
        });

        expect(failed.success).toBe(false);
        expect(failed.pending).toBe(true);
        expect(state.store.get(OPS_KEY)[0]).toMatchObject({
            operationId: 'sale-missing-product',
            status: 'FAILED_RETRYABLE',
            deductions: [expect.objectContaining({ productoId: 'p-missing' })]
        });

        await storageService.setItem(PRODUCTS_KEY, [product(), { ...product(), id: 'p-missing', stock: 10 }]);
        const recovered = await recoverPendingInventoryOperations();

        expect(recovered[0].success).toBe(true);
        expect(state.store.get(PRODUCTS_KEY).find(item => item.id === 'p-missing').stock).toBe(8);
        expect(state.store.get(KARDEX_KEY)[0]).toMatchObject({
            producto_id: 'p-missing',
            stock_antes: 10,
            stock_despues: 8
        });
    });

    it('repara un registro APPLIED al que le falta el movimiento Kardex', async () => {
        const operation = {
            operationId: 'sale-repair-kardex',
            referenceType: 'VENTA',
            tipo: 'VENTA',
            deductions: [{ productoId: 'p1', cantidad: -2, origen: 'VENTA' }]
        };
        await applyInventoryOperation(operation);
        state.store.set(KARDEX_KEY, []);

        const repaired = await applyInventoryOperation(operation);

        expect(repaired.success).toBe(true);
        expect(state.store.get(PRODUCTS_KEY)[0].stock).toBe(8);
        expect(state.store.get(KARDEX_KEY)).toHaveLength(1);
        expect((await getInventoryOperations())[0].status).toBe('APPLIED_LOCAL');
    });
});
