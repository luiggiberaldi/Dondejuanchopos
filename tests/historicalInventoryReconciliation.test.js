import { describe, expect, it } from 'vitest';
import {
    buildHistoricalInventoryCsv,
    buildHistoricalInventoryDryRun,
    PRODUCT_ALERT_CODES,
} from '../src/utils/historicalInventoryReconciliation';

const products = [
    { id: 'p1', name: 'Polar Light', stock: 8, costUsd: 1 },
    { id: 'p2', name: 'Polar Negrita', stock: 10, costUsd: 1 },
    { id: 'combo', name: 'Combo Cervezas', stock: 2, isCombo: true },
];

function movement({ id, productId, type, quantity, before, after, referenceId = null }) {
    return {
        id,
        producto_id: productId,
        producto_nombre: products.find(product => product.id === productId)?.name || productId,
        tipo: type,
        cantidad: quantity,
        stock_antes: before,
        stock_despues: after,
        referencia_id: referenceId,
        created_at: `2026-08-13T10:0${id.length}.000Z`,
    };
}

describe('historicalInventoryReconciliation', () => {
    it('detecta componentes modulares ausentes, stock desalineado y propone dry-run sin mutar', () => {
        const sale = {
            id: 'sale-1',
            saleNumber: 1,
            tipo: 'VENTA',
            status: 'COMPLETADA',
            items: [{ id: 'line-combo', _originalId: 'combo', isCombo: true, qty: 1 }],
            inventoryDeductions: [{ productoId: 'p1', cantidad: -2, origen: 'MODULAR' }],
        };
        const kardex = [
            movement({ id: 'initial-p1', productId: 'p1', type: 'INICIAL', quantity: 10, before: 0, after: 10 }),
            movement({ id: 'sale-parent', productId: 'combo', type: 'VENTA', quantity: -1, before: 3, after: 2, referenceId: 'sale-1' }),
        ];
        const originalProducts = structuredClone(products);
        const originalSale = structuredClone(sale);

        const report = buildHistoricalInventoryDryRun({
            products,
            sales: [sale],
            kardex,
            operations: [],
            missingDocIds: ['bodega_kardex_snapshots_v1'],
        });

        const polar = report.products.find(product => product.productoId === 'p1');
        const combo = report.products.find(product => product.productoId === 'combo');

        expect(report.dryRun).toBe(true);
        expect(report.mutatesData).toBe(false);
        expect(report.status).toBe('INCOMPLETE');
        expect(report.summary.salesWithoutKardex).toBe(0);
        expect(report.summary.modularMissingProducts).toBe(1);
        expect(polar.alertas).toEqual(expect.arrayContaining([
            PRODUCT_ALERT_CODES.MODULAR_NOT_REFLECTED,
            PRODUCT_ALERT_CODES.SALE_NOT_REFLECTED,
        ]));
        expect(polar.accionDryRun).toBe('REVISAR_COMPOSICION_HISTORICA');
        expect(combo.alertas).toContain(PRODUCT_ALERT_CODES.PARENT_IN_KARDEX);
        expect(products).toEqual(originalProducts);
        expect(sale).toEqual(originalSale);
    });

    it('detecta venta libre como virtual y reporta una anulación que no queda en cero', () => {
        const report = buildHistoricalInventoryDryRun({
            products: [{ id: 'p1', name: 'Producto', stock: 5 }],
            sales: [
                {
                    id: 'sale-free',
                    tipo: 'VENTA',
                    status: 'COMPLETADA',
                    items: [{ id: 'legacy-id', name: 'Venta Libre', qty: 1 }],
                },
                {
                    id: 'sale-void',
                    tipo: 'VENTA',
                    status: 'ANULADA',
                    items: [{ id: 'p1', name: 'Producto', qty: 2 }],
                    inventoryDeductions: [{ productoId: 'p1', cantidad: -2, origen: 'VENTA' }],
                },
            ],
            kardex: [
                movement({ id: 'initial', productId: 'p1', type: 'INICIAL', quantity: 5, before: 0, after: 5 }),
                movement({ id: 'sale', productId: 'p1', type: 'VENTA', quantity: -2, before: 5, after: 3, referenceId: 'sale-void' }),
                movement({ id: 'return', productId: 'p1', type: 'DEVOLUCION', quantity: 1, before: 3, after: 4, referenceId: 'sale-void' }),
            ],
        });

        expect(report.summary.virtualSales).toBe(1);
        expect(report.summary.salesWithoutKardex).toBe(0);
        expect(report.summary.voidsWithNetDifference).toBe(1);
        expect(report.saleFindings).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'VOID_WITH_NET_PHYSICAL_DIFFERENCE' }),
        ]));
    });

    it('genera CSV con encabezados y propuestas sin aplicar ajustes', () => {
        const report = buildHistoricalInventoryDryRun({ products: [{ id: 'p1', name: 'Producto', stock: 1 }] });
        const csv = buildHistoricalInventoryCsv(report);

        expect(csv).toContain('Producto ID');
        expect(csv).toContain('Acción dry-run');
        expect(csv.split('\n')).toHaveLength(2);
        expect(report.repairPlan[0]).toMatchObject({ modo: 'DRY_RUN', mutaDatos: false });
    });
});
