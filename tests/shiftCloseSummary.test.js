import { describe, expect, it } from 'vitest';
import { getOpenShiftMovements } from '../src/utils/shiftScope';
import { buildShiftCloseSummary, shiftScopeRequiresClose } from '../src/utils/shiftCloseSummary';

const apertura = { id: 'ap1', tipo: 'APERTURA_CAJA', timestamp: '2026-11-21T08:00:00.000Z', openingUsd: 20 };
const venta = (id, usd, bs, ts = '2026-11-21T09:00:00.000Z') => ({
    id, tipo: 'VENTA', timestamp: ts, totalUsd: usd, totalBs: bs,
    items: [{ id: 'p1', name: 'Harina', qty: 2, priceUsd: usd / 2 }],
    payments: [{ methodId: 'efectivo_usd', amountUsd: usd }],
});

describe('Fase 0 — REGISTRO_CIERRE desde el scope fresco', () => {
    it('exige cierre cuando hay movimientos frescos aunque el estado React esté vacío', () => {
        const scope = getOpenShiftMovements([apertura, venta('v1', 10.1, 400)]);
        expect(shiftScopeRequiresClose(scope)).toBe(true);
    });

    it('un turno solo-apertura conserva el comportamiento actual: genera cierre', () => {
        const scope = getOpenShiftMovements([apertura]);
        expect(scope.movements.map(s => s.id)).toEqual(['ap1']);
        expect(shiftScopeRequiresClose(scope)).toBe(true);
        const summary = buildShiftCloseSummary(scope);
        expect(summary.todayTotalUsd).toBe(0);
        expect(summary.sales).toEqual([]);
    });

    it('huérfanos sin apertura vigente también obligan a crear el registro', () => {
        const scope = getOpenShiftMovements([venta('v1', 5, 200)]);
        expect(scope.orphans).toHaveLength(1);
        expect(shiftScopeRequiresClose(scope)).toBe(true);
    });

    it('sin movimientos abiertos no se crea registro', () => {
        const scope = getOpenShiftMovements([{ ...apertura, cajaCerrada: true }]);
        expect(shiftScopeRequiresClose(scope)).toBe(false);
    });

    it('suma con dinero.js sin errores de coma flotante', () => {
        const scope = getOpenShiftMovements([apertura, venta('v1', 0.1, 4.01), venta('v2', 0.2, 8.02)]);
        const summary = buildShiftCloseSummary(scope);
        expect(summary.todayTotalUsd).toBe(0.3);
        expect(summary.todayTotalBs).toBe(12.03);
        expect(summary.todayItemsSold).toBe(4);
        expect(summary.sales.map(s => s.id)).toEqual(['v1', 'v2']);
        expect(summary.cashFlow).toHaveLength(3);
    });
});
