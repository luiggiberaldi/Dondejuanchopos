import { describe, test, expect, beforeEach, vi } from 'vitest';
import localforage from 'localforage';
import { storageService } from '../src/utils/storageService';
import { mergeSalesArrays } from '../src/utils/salesMerge';

vi.mock('localforage', () => {
    let store = {};
    return {
        default: {
            config: vi.fn(),
            getItem: vi.fn(async (key) => store[key] || null),
            setItem: vi.fn(async (key, val) => { store[key] = val; return val; }),
            removeItem: vi.fn(async (key) => { delete store[key]; }),
            _reset: () => { store = {}; }
        }
    };
});

describe('Arnés de Reconciliación y Blindaje de Ventas', () => {
    beforeEach(() => {
        localStorage.clear();
        localforage._reset();
        vi.clearAllMocks();
    });

    test('Reconcilia y resucita una venta huérfana a partir de una operación de inventario', async () => {
        const orphanOp = {
            operationId: 'sale_orphan-uuid-999',
            referenceId: 'orphan-uuid-999',
            referenceType: 'VENTA',
            tipo: 'VENTA',
            source: 'POS_CHECKOUT',
            occurredAt: '2026-09-05T01:17:00.000Z',
            actorName: 'Chailin',
            actorId: 2,
            metadata: {
                saleId: 'orphan-uuid-999',
                saleNumber: 777
            },
            transitions: [
                {
                    productoId: 'prod-polar-1',
                    productoNombre: 'Cerveza Polar Negrita',
                    cantidad: -3,
                    cantidadSolicitada: -3,
                    costoUnitario: 0.70,
                    unidad: 'unidad',
                    origen: 'VENTA'
                }
            ]
        };

        await localforage.setItem('bodega_inventory_operations_v1', [orphanOp]);
        await localforage.setItem('bodega_sales_v1', []);

        // Simular la reconciliación
        const invOps = await storageService.getItem('bodega_inventory_operations_v1', []);
        const salesList = await storageService.getItem('bodega_sales_v1', []);
        const knownIds = new Set(salesList.map(s => s.id));

        for (const op of invOps) {
            const sId = op.metadata?.saleId || op.referenceId;
            if (sId && !knownIds.has(sId)) {
                salesList.push({
                    id: sId,
                    saleNumber: op.metadata?.saleNumber || 1,
                    tipo: 'VENTA',
                    status: 'COMPLETADA',
                    timestamp: op.occurredAt,
                    cajaCerrada: true,
                    items: (op.transitions || []).map(t => ({
                        id: t.productoId,
                        name: t.productoNombre,
                        qty: Math.abs(t.cantidad)
                    })),
                    inventoryOperationId: op.operationId
                });
            }
        }

        expect(salesList).toHaveLength(1);
        expect(salesList[0].id).toBe('orphan-uuid-999');
        expect(salesList[0].saleNumber).toBe(777);
        expect(salesList[0].items[0].name).toBe('Cerveza Polar Negrita');
        expect(salesList[0].items[0].qty).toBe(3);
    });

    test('Recupera venta pendiente desde el Write-Ahead Log (WAL) Journal', async () => {
        const walEntry = {
            journalId: 'wal_sale-uuid-wal',
            saleId: 'sale-uuid-wal',
            saleNumber: 888,
            timestamp: '2026-09-05T01:25:00.000Z',
            totalUsd: 15.00,
            saleSnapshot: {
                id: 'sale-uuid-wal',
                saleNumber: 888,
                totalUsd: 15.00,
                status: 'COMPLETADA',
                items: [{ id: 'p1', name: 'Item WAL', qty: 2 }]
            }
        };

        await localforage.setItem('bodega_sales_journal_v1', [walEntry]);
        await localforage.setItem('bodega_sales_v1', []);

        const journal = await storageService.getItem('bodega_sales_journal_v1', []);
        const sales = await storageService.getItem('bodega_sales_v1', []);
        const known = new Set(sales.map(s => s.id));

        for (const j of journal) {
            if (j.saleId && !known.has(j.saleId) && j.saleSnapshot) {
                sales.push(j.saleSnapshot);
            }
        }

        expect(sales).toHaveLength(1);
        expect(sales[0].id).toBe('sale-uuid-wal');
        expect(sales[0].totalUsd).toBe(15.00);
        expect(sales[0].items[0].name).toBe('Item WAL');
    });
});
