import { describe, it, expect } from 'vitest';
import { findOpenApertura, getOpenShiftMovements, TIPOS_CIERRE } from '../src/utils/shiftScope';
import { FinancialEngine } from '../src/core/FinancialEngine';
import { calculateReportsData } from '../src/utils/reportsProcessor';

describe('CC1: shiftScope (Alcance único del turno)', () => {
  it('incluye transacciones antes y después de medianoche dentro del mismo turno', () => {
    const sales = [
      { id: '1', tipo: 'APERTURA_CAJA', timestamp: '2026-07-25T18:00:00.000Z', cajaCerrada: false, openingUsd: 50 },
      { id: '2', tipo: 'VENTA', timestamp: '2026-07-25T20:00:00.000Z', totalUsd: 100, cajaCerrada: false },
      { id: '3', tipo: 'VENTA', timestamp: '2026-07-26T01:30:00.000Z', totalUsd: 40, cajaCerrada: false }
    ];

    const { movements, apertura, orphans } = getOpenShiftMovements(sales);

    expect(apertura).toBeDefined();
    expect(apertura.id).toBe('1');
    expect(orphans).toHaveLength(0);
    expect(movements).toHaveLength(3);
    expect(movements.map(m => m.id)).toEqual(['1', '2', '3']);
  });

  it('GASTO_INTERNO con afectaCaja: true descuenta el efectivo esperado en FinancialEngine', () => {
    const sales = [
      { id: '1', tipo: 'APERTURA_CAJA', timestamp: '2026-07-26T08:00:00.000Z', cajaCerrada: false, openingUsd: 100 },
      { id: '2', tipo: 'VENTA', timestamp: '2026-07-26T09:00:00.000Z', totalUsd: 50, cajaCerrada: false, payments: [{ methodId: 'efectivo_usd', amountUsd: 50, currency: 'USD' }] },
      {
        id: '3',
        tipo: 'GASTO_INTERNO',
        timestamp: '2026-07-26T10:00:00.000Z',
        afectaCaja: true,
        cajaCerrada: false,
        totalUsd: -20,
        totalBs: 0,
        paymentMethod: 'efectivo_usd',
        payments: [{ methodId: 'efectivo_usd', amountUsd: -20, currency: 'USD' }]
      }
    ];

    const { movements } = getOpenShiftMovements(sales);
    const breakdown = FinancialEngine.calculatePaymentBreakdown(movements);
    const expectedCash = FinancialEngine.computeExpectedCash(breakdown);

    // 100 apertura + 50 venta - 20 gasto = 130 efectivo esperado
    expect(expectedCash.usd).toBe(130);
  });

  it('GASTO_INTERNO con afectaCaja: false (autoconsumo) entra en movements pero no altera el desglose de efectivo', () => {
    const sales = [
      { id: '1', tipo: 'APERTURA_CAJA', timestamp: '2026-07-26T08:00:00.000Z', cajaCerrada: false, openingUsd: 100 },
      {
        id: '2',
        tipo: 'GASTO_INTERNO',
        timestamp: '2026-07-26T11:00:00.000Z',
        isAutoconsumo: true,
        afectaCaja: false,
        cajaCerrada: false,
        totalUsd: -15
      }
    ];

    const { movements } = getOpenShiftMovements(sales);
    expect(movements.map(m => m.id)).toContain('2');

    const breakdown = FinancialEngine.calculatePaymentBreakdown(movements);
    const expectedCash = FinancialEngine.computeExpectedCash(breakdown);
    expect(expectedCash.usd).toBe(100);
  });

  it('separa adecuadamente movimientos huérfanos anteriores a la apertura vigente', () => {
    const sales = [
      { id: 'old_1', tipo: 'VENTA', timestamp: '2026-07-24T12:00:00.000Z', totalUsd: 30, cajaCerrada: false },
      { id: 'ap_1', tipo: 'APERTURA_CAJA', timestamp: '2026-07-25T08:00:00.000Z', cajaCerrada: false },
      { id: 'new_1', tipo: 'VENTA', timestamp: '2026-07-25T09:00:00.000Z', totalUsd: 50, cajaCerrada: false }
    ];

    const { movements, orphans } = getOpenShiftMovements(sales);

    expect(orphans.map(o => o.id)).toEqual(['old_1']);
    expect(movements.map(m => m.id)).toEqual(['ap_1', 'new_1']);
  });

  it('F6: dashboard en vivo y reporte histórico producen exactamente el mismo desglose de caja', () => {
    const sales = [
      { id: '1', tipo: 'APERTURA_CAJA', timestamp: '2026-07-26T08:00:00.000Z', openingUsd: 100, cajaCerrada: false },
      { id: '2', tipo: 'VENTA', timestamp: '2026-07-26T09:00:00.000Z', totalUsd: 50, cajaCerrada: false, payments: [{ methodId: 'efectivo_usd', amountUsd: 50, currency: 'USD' }] },
      { id: '3', tipo: 'GASTO_INTERNO', timestamp: '2026-07-26T10:00:00.000Z', afectaCaja: true, cajaCerrada: false, totalUsd: -20, payments: [{ methodId: 'efectivo_usd', amountUsd: -20, currency: 'USD' }] }
    ];

    const { movements } = getOpenShiftMovements(sales);
    const liveBreakdown = FinancialEngine.calculatePaymentBreakdown(movements);

    const reportData = calculateReportsData(sales, '2026-07-26', '2026-07-26', 45, []);
    const historicalBreakdown = reportData.paymentBreakdown;

    expect(FinancialEngine.computeExpectedCash(liveBreakdown)).toEqual(FinancialEngine.computeExpectedCash(historicalBreakdown));
  });
});
