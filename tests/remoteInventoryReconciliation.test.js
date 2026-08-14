import { describe, expect, it } from 'vitest';
import { reconcileRemoteInventory } from '../src/utils/remoteInventoryReconciliation';

const tercio = { id: 'tercio', name: 'Tercio Polar', stock: 327, costUsd: 0.4 };

function movement(id, type, quantity, before, after, referenceId, operationId, createdAt) {
    return {
        id,
        producto_id: 'tercio',
        producto_nombre: 'Tercio Polar',
        tipo: type,
        cantidad: quantity,
        stock_antes: before,
        stock_despues: after,
        referencia_id: referenceId,
        referencia_tipo: type === 'DEVOLUCION' ? 'ANULACION' : 'VENTA',
        operation_id: operationId,
        created_at: createdAt,
    };
}

describe('reconcileRemoteInventory', () => {
    it('REMOTE-KDX-004: concilia Tercio Polar 327 → 326 → 327 sin falso positivo', () => {
        const result = reconcileRemoteInventory({
            products: [tercio],
            sales: [{ id: 'sale-1', tipo: 'VENTA', status: 'ANULADA', items: [{ id: 'tercio', qty: 1 }] }],
            kardex: [
                movement('initial', 'INICIAL', 327, 0, 327, null, null, '2026-08-12T10:00:00.000Z'),
                movement('sale-move', 'VENTA', -1, 327, 326, 'sale-1', 'sale-op-1', '2026-08-12T11:00:00.000Z'),
                movement('return-move', 'DEVOLUCION', 1, 326, 327, 'sale-1', 'void-op-1', '2026-08-12T12:00:00.000Z'),
            ],
            operations: [
                { operationId: 'sale-op-1', status: 'APPLIED_LOCAL', movementIds: ['sale-move'] },
                { operationId: 'void-op-1', status: 'APPLIED_LOCAL', movementIds: ['return-move'] },
            ],
        });

        expect(result).toMatchObject({ ok: true, status: 'OK' });
        expect(result.totals.discrepancies).toBe(0);
    });

    it('REMOTE-KDX-011: no exige Kardex para una Venta Libre legacy', () => {
        const result = reconcileRemoteInventory({
            sales: [{
                id: 'sale-free',
                tipo: 'VENTA',
                status: 'COMPLETADA',
                items: [{ id: 'legacy-amount', name: 'Venta Libre', qty: 1 }]
            }]
        });

        expect(result).toMatchObject({ ok: true, status: 'OK' });
        expect(result.totals.warnings).toBe(0);
    });

    it('REMOTE-KDX-009: detecta stock actual distinto al último Kardex', () => {
        const result = reconcileRemoteInventory({
            products: [{ ...tercio, stock: 325 }],
            kardex: [movement('initial', 'INICIAL', 327, 0, 327, null, null, '2026-08-12T10:00:00.000Z')],
        });

        expect(result.ok).toBe(false);
        expect(result.discrepancies).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'CURRENT_STOCK_MISMATCH' }),
        ]));
    });

    it('REMOTE-KDX-010: datos faltantes nunca producen estado OK', () => {
        const result = reconcileRemoteInventory({
            products: [tercio],
            kardex: [],
            missingDocIds: ['bodega_sales_v1', 'bodega_inventory_operations_v1'],
        });

        expect(result).toMatchObject({ ok: false, status: 'INCOMPLETE' });
        expect(result.warnings).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'REMOTE_DATA_INCOMPLETE' }),
        ]));
    });

    it('REMOTE-KDX-001: reporta transición inválida y operación aplicada sin movimiento', () => {
        const result = reconcileRemoteInventory({
            products: [tercio],
            kardex: [movement('bad', 'VENTA', -1, 327, 327, 'sale-2', 'op-2', '2026-08-12T11:00:00.000Z')],
            operations: [{ operationId: 'op-2', status: 'APPLIED_LOCAL', movementIds: ['missing-movement'] }],
        });

        expect(result.status).toBe('DISCREPANCIES');
        expect(result.discrepancies.map(item => item.code)).toEqual(expect.arrayContaining([
            'INVALID_STOCK_TRANSITION',
            'APPLIED_OPERATION_WITHOUT_MOVEMENT',
        ]));
    });

    it('REMOTE-KDX-008: deja operación pendiente como advertencia accionable', () => {
        const result = reconcileRemoteInventory({
            products: [tercio],
            kardex: [movement('initial', 'INICIAL', 327, 0, 327, null, null, '2026-08-12T10:00:00.000Z')],
            operations: [{ operationId: 'pending-1', status: 'FAILED_RETRYABLE', movementIds: [] }],
        });

        expect(result.status).toBe('REVIEW');
        expect(result.warnings).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'PENDING_OPERATION' }),
        ]));
    });
});
