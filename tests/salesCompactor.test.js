import { describe, expect, it, vi } from 'vitest';
import {
    archiveSalesPayload,
    compactSalesPayload,
    isArchivedSalesPayload,
    salesPayloadByteLength,
} from '../src/utils/salesCompactor';

const oldTimestamp = '2026-01-01T12:00:00.000Z';

function sale(id, overrides = {}) {
    return {
        id,
        tipo: 'VENTA',
        timestamp: oldTimestamp,
        saleNumber: 12,
        totalUsd: 8,
        totalBs: 3200,
        cajaCerrada: true,
        cierreId: 'close-12',
        payments: [{ methodId: 'cash', amountUsd: 8 }],
        items: [{ id: 'product-1', name: 'Producto', qty: 2, priceUsd: 4, extra: 'detalle' }],
        inventoryDeductionsApplied: [{ productoId: 'product-1', cantidad: -2 }],
        ...overrides,
    };
}

describe('salesCompactor', () => {
    it('conserva todo el payload por defecto y no muta el historial local', () => {
        const local = [sale('old'), sale('open', { cajaCerrada: false, cierreId: null })];
        const original = structuredClone(local);
        const result = compactSalesPayload(local);

        expect(local).toEqual(original);
        expect(result).toEqual(original);
    });

    it('does not archive or strip fields by default, even when the payload exceeds the threshold', () => {
        const local = [sale('old', { items: Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, name: 'Detalle'.repeat(20), qty: 1 })) })];
        const [payload] = compactSalesPayload(local, 1);
        expect(payload).toEqual(local[0]);
        expect(payload.items).toHaveLength(20);
        expect(payload.isArchived).toBeUndefined();
    });

    it('archives only old closed business sales when explicitly enabled and oversized', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'));
        try {
            const source = [
                sale('old'),
                sale('recent', { timestamp: '2026-09-30T12:00:00.000Z' }),
                sale('open', { cajaCerrada: false, cierreId: null }),
                sale('no-close', { cierreId: null }),
                sale('unrecognized', { tipo: 'MOVIMIENTO_CLIENTE' }),
                sale('closing', { tipo: 'REGISTRO_CIERRE' }),
            ];
            const original = structuredClone(source);
            const archiveCandidates = source.map(entry => ({ ...entry }));
            const archived = compactSalesPayload(archiveCandidates, 1, { allowArchiving: true });
            const old = archived.find(entry => entry.id === 'old');

            expect(old).toMatchObject({ id: 'old', totalUsd: 8, totalBs: 3200, itemCount: 2, isArchived: true, archiveVersion: 1 });
            expect(old.items).toBeUndefined();
            expect(archived.find(entry => entry.id === 'recent').items).toBeDefined();
            expect(archived.find(entry => entry.id === 'open').items).toBeDefined();
            expect(archived.find(entry => entry.id === 'no-close').items).toBeDefined();
            expect(archived.find(entry => entry.id === 'unrecognized').items).toBeDefined();
            expect(archived.find(entry => entry.id === 'closing')).toEqual(original.find(entry => entry.id === 'closing'));
            expect(source).toEqual(original);
            expect(salesPayloadByteLength(archived)).toBeLessThan(salesPayloadByteLength(original));
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps a prior archive marker idempotent and preserves its item count', () => {
        const marker = { ...sale('already-archived'), items: undefined, itemCount: 17, isArchived: true, archiveVersion: 1 };
        const [result] = archiveSalesPayload([marker], Date.now());
        expect(isArchivedSalesPayload(result)).toBe(true);
        expect(result.itemCount).toBe(17);
    });

    it('does not compact closures or sales without a trustworthy timestamp', () => {
        const entries = [
            sale('closing', { tipo: 'REGISTRO_CIERRE' }),
            sale('unknown-time', { timestamp: 'not-a-date' }),
        ];
        expect(archiveSalesPayload(entries, Date.now())).toEqual(entries);
    });
});
