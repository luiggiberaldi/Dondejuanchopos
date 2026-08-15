import { describe, it, expect } from 'vitest';
import { calculateReportsData } from '../src/utils/reportsProcessor';

describe('Reports Shift Filter (Turno Actual y Último Turno)', () => {
    const products = [
        { id: 'p1', name: 'Polar Pilsen 330ml', priceUsd: 1.5, costUsd: 1.0, category: 'Cervezas' },
        { id: 'p2', name: 'Harina PAN 1kg', priceUsd: 1.2, costUsd: 0.9, category: 'Víveres' },
    ];

    const sampleSales = [
        // Cierre anterior (Cierre #1)
        {
            id: 'cierre-1',
            tipo: 'REGISTRO_CIERRE',
            cierreId: '2026-08-10T22:00:00.000Z',
            timestamp: '2026-08-10T22:00:00.000Z',
            cajaCerrada: true,
        },
        {
            id: 's-old-1',
            tipo: 'VENTA',
            timestamp: '2026-08-10T20:00:00.000Z',
            cierreId: '2026-08-10T22:00:00.000Z',
            cajaCerrada: true,
            totalUsd: 15,
            totalBs: 540,
            items: [{ id: 'p1', name: 'Polar Pilsen 330ml', qty: 10, priceUsd: 1.5 }],
            payments: [{ methodId: 'efectivo_usd', amountUsd: 15, currency: 'USD' }],
        },
        // Cierre más reciente (Cierre #2 - Último Turno)
        {
            id: 'apertura-2',
            tipo: 'APERTURA_CAJA',
            timestamp: '2026-08-12T08:00:00.000Z',
            cierreId: '2026-08-12T20:00:00.000Z',
            cajaCerrada: true,
            openingUsd: 50,
        },
        {
            id: 's-last-1',
            tipo: 'VENTA',
            timestamp: '2026-08-12T10:00:00.000Z',
            cierreId: '2026-08-12T20:00:00.000Z',
            cajaCerrada: true,
            totalUsd: 30,
            totalBs: 1080,
            items: [{ id: 'p1', name: 'Polar Pilsen 330ml', qty: 20, priceUsd: 1.5 }],
            payments: [{ methodId: 'efectivo_usd', amountUsd: 30, currency: 'USD' }],
        },
        {
            id: 's-last-2',
            tipo: 'VENTA',
            timestamp: '2026-08-12T14:30:00.000Z',
            cierreId: '2026-08-12T20:00:00.000Z',
            cajaCerrada: true,
            totalUsd: 12,
            totalBs: 432,
            items: [{ id: 'p2', name: 'Harina PAN 1kg', qty: 10, priceUsd: 1.2 }],
            payments: [{ methodId: 'efectivo_usd', amountUsd: 12, currency: 'USD' }],
        },
        {
            id: 'cierre-2',
            tipo: 'REGISTRO_CIERRE',
            cierreId: '2026-08-12T20:00:00.000Z',
            timestamp: '2026-08-12T20:00:00.000Z',
            cajaCerrada: true,
        },
        // Turno Activo (Caja Abierta)
        {
            id: 'apertura-activa',
            tipo: 'APERTURA_CAJA',
            timestamp: '2026-08-14T08:00:00.000Z',
            cajaCerrada: false,
            openingUsd: 60,
        },
        {
            id: 's-active-1',
            tipo: 'VENTA',
            timestamp: '2026-08-14T09:30:00.000Z',
            cajaCerrada: false,
            totalUsd: 45,
            totalBs: 1620,
            items: [{ id: 'p1', name: 'Polar Pilsen 330ml', qty: 30, priceUsd: 1.5 }],
            payments: [{ methodId: 'efectivo_usd', amountUsd: 45, currency: 'USD' }],
        },
        {
            id: 's-active-2',
            tipo: 'VENTA_FIADA',
            timestamp: '2026-08-14T11:00:00.000Z',
            cajaCerrada: false,
            totalUsd: 24,
            totalBs: 864,
            fiadoUsd: 24,
            items: [{ id: 'p2', name: 'Harina PAN 1kg', qty: 20, priceUsd: 1.2 }],
            payments: [],
        },
        {
            id: 's-active-anulada',
            tipo: 'VENTA',
            status: 'ANULADA',
            timestamp: '2026-08-14T11:30:00.000Z',
            cajaCerrada: false,
            totalUsd: 15,
            items: [{ id: 'p1', name: 'Polar Pilsen 330ml', qty: 10, priceUsd: 1.5 }],
        },
    ];

    it('filtra correctamente las ventas del Turno Actual (shiftMode: currentShift)', () => {
        const report = calculateReportsData(sampleSales, '', '', 36.0, products, 'currentShift');

        // Solo s-active-1 y s-active-2 deben incluirse (ignora s-active-anulada y ventas de turnos cerrados)
        expect(report.salesForStats).toHaveLength(2);
        expect(report.totalUsd).toBe(69); // 45 + 24
        expect(report.totalItems).toBe(50); // 30 + 20
        expect(report.topProducts).toHaveLength(2);
    });

    it('filtra correctamente las ventas del Último Turno cerrado (shiftMode: lastShift)', () => {
        const report = calculateReportsData(sampleSales, '', '', 36.0, products, 'lastShift');

        // Solo s-last-1 y s-last-2 del Cierre #2 deben incluirse
        expect(report.salesForStats).toHaveLength(2);
        expect(report.totalUsd).toBe(42); // 30 + 12
        expect(report.totalItems).toBe(30); // 20 + 10
    });

    it('mantiene retrocompatibilidad con filtrado por rango de fechas (sin shiftMode)', () => {
        const report = calculateReportsData(sampleSales, '2026-08-10', '2026-08-12', 36.0, products, null);

        // Ventas del 10 al 12 (s-old-1, s-last-1, s-last-2 = 15 + 30 + 12 = 57)
        expect(report.salesForStats).toHaveLength(3);
        expect(report.totalUsd).toBe(57);
    });
});
