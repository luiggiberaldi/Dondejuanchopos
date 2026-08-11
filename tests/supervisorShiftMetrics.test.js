import { describe, expect, it } from 'vitest';
import {
    calculateSupervisorChangeMetrics,
    calculateSupervisorOutflowMetrics,
} from '../src/utils/supervisorShiftMetrics';

describe('Supervisor shift metrics', () => {
    it('separa gastos internos de pagos a proveedores', () => {
        const result = calculateSupervisorOutflowMetrics([
            { tipo: 'GASTO_INTERNO', totalUsd: -12, totalBs: -480 },
            { tipo: 'PAGO_PROVEEDOR', totalUsd: -35, totalBs: -1400 },
            { tipo: 'GASTO_INTERNO', status: 'ANULADA', totalUsd: -99, totalBs: -3960 },
        ]);

        expect(result.expenses).toMatchObject({ totalUsd: 12, totalBs: 480, count: 1 });
        expect(result.supplierPayments).toMatchObject({ totalUsd: 35, totalBs: 1400, count: 1 });
    });

    it('acumula vueltos entregados y cuenta las ventas que los generaron', () => {
        const result = calculateSupervisorChangeMetrics([
            { tipo: 'VENTA', changeUsd: 2, changeBs: 0 },
            { tipo: 'VENTA', changeGiven: { usd: 0, bs: 120 } },
            { tipo: 'VENTA', status: 'ANULADA', changeUsd: 99 },
        ]);

        expect(result).toMatchObject({ totalUsd: 2, totalBs: 120, count: 2 });
    });
});
