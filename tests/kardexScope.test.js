import { describe, it, expect } from 'vitest';
import {
    calculateMovingWeightedAverage,
    filterKardex,
    filterKardexByLocalDate,
    calculateStockAtDate,
    calculateInventoryValue,
    detectKardexDiscrepancies
} from '../src/utils/kardexScope';
import { getLocalISODate } from '../src/utils/dateHelpers';

describe('Pruebas del Módulo Kardex (kardexScope.js)', () => {

    describe('Cálculo de Promedio Ponderado Móvil', () => {
        it('debe calcular el costo promedio ponderado correctamente al recibir inventario nuevo', () => {
            // 10 unidades a $1.00 + 10 unidades a $2.00 = 20 unidades a $1.50
            const newCost = calculateMovingWeightedAverage(10, 1.00, 10, 2.00);
            expect(newCost).toBe(1.5);
        });

        it('debe mantener el costo anterior si la cantidad ingresada es 0', () => {
            const cost = calculateMovingWeightedAverage(15, 2.50, 0, 3.00);
            expect(cost).toBe(2.5);
        });

        it('debe retornar el costo nuevo si el stock anterior era 0', () => {
            const cost = calculateMovingWeightedAverage(0, 0, 50, 4.25);
            expect(cost).toBe(4.25);
        });
    });

    describe('Filtrado de Movimientos de Kardex', () => {
        const mockMoves = [
            { id: '1', producto_id: 'p1', producto_nombre: 'Harina Pan', tipo: 'INICIAL', cantidad: 50, stock_despues: 50, created_at: '2026-07-01T10:00:00.000Z', usuario_nombre: 'Admin' },
            { id: '2', producto_id: 'p1', producto_nombre: 'Harina Pan', tipo: 'VENTA', cantidad: -5, stock_despues: 45, created_at: '2026-07-02T14:00:00.000Z', usuario_nombre: 'Cajero1' },
            { id: '3', producto_id: 'p2', producto_nombre: 'Arroz Primor', tipo: 'COMPRA', cantidad: 20, stock_despues: 20, created_at: '2026-07-03T09:00:00.000Z', usuario_nombre: 'Admin' },
            { id: '4', producto_id: 'p1', producto_nombre: 'Harina Pan', tipo: 'AJUSTE', cantidad: -2, stock_despues: 43, created_at: '2026-07-04T16:00:00.000Z', usuario_nombre: 'Supervisor' }
        ];

        it('debe filtrar por productoId', () => {
            const result = filterKardex(mockMoves, { productoId: 'p1' });
            expect(result).toHaveLength(3);
            expect(result.every(m => m.producto_id === 'p1')).toBe(true);
        });

        it('debe filtrar por tipo de movimiento', () => {
            const result = filterKardex(mockMoves, { tipo: 'VENTA' });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('2');
        });

        it('debe filtrar por texto de búsqueda (query)', () => {
            const result = filterKardex(mockMoves, { query: 'Arroz' });
            expect(result).toHaveLength(1);
            expect(result[0].producto_nombre).toBe('Arroz Primor');
        });

        it('debe filtrar por rango de fechas', () => {
            const result = filterKardex(mockMoves, {
                desdeIso: '2026-07-02T00:00:00.000Z',
                hastaIso: '2026-07-03T23:59:59.000Z'
            });
            expect(result).toHaveLength(2);
        });

        it('debe aplicar fecha exacta y rango inclusivo por día local', () => {
            const localDay = '2026-07-02';
            const moves = [
                { id: 'local-start', producto_nombre: 'Tercio Polar', tipo: 'VENTA', created_at: new Date(2026, 6, 2, 23, 30).toISOString() },
                { id: 'next-local-day', producto_nombre: 'Tercio Polar', tipo: 'VENTA', created_at: new Date(2026, 6, 3, 0, 30).toISOString() },
                { id: 'outside', producto_nombre: 'Tercio Polar', tipo: 'VENTA', created_at: new Date(2026, 6, 3, 12, 0).toISOString() },
            ];

            const exact = filterKardexByLocalDate(moves, { fechaExacta: localDay });
            const range = filterKardexByLocalDate(moves, { fechaDesde: localDay, fechaHasta: localDay });

            expect(exact.map(move => move.id)).toEqual(['local-start']);
            expect(range.map(move => move.id)).toEqual(['local-start']);
        });

        it('debe identificar la fecha exacta usando el día local', () => {
            const targetDate = getLocalISODate(new Date('2026-07-02T12:00:00.000Z'));
            const moves = [
                { id: 'same-day', created_at: '2026-07-02T13:00:00.000Z' },
                { id: 'next-day', created_at: '2026-07-03T13:00:00.000Z' }
            ];

            const result = moves.filter(m => (
                getLocalISODate(new Date(m.created_at || m.timestamp)) === targetDate
            ));

            expect(result.map(m => m.id)).toEqual(['same-day']);
        });
    });

    describe('Reconstrucción de Stock a una Fecha Específica', () => {
        const mockMoves = [
            { id: '1', producto_id: 'p1', stock_despues: 100, created_at: '2026-07-01T10:00:00.000Z' },
            { id: '2', producto_id: 'p1', stock_despues: 80, created_at: '2026-07-05T10:00:00.000Z' },
            { id: '3', producto_id: 'p1', stock_despues: 75, created_at: '2026-07-10T10:00:00.000Z' }
        ];

        it('debe retornar el stock correcto a una fecha intermedia', () => {
            const stockAtJuly6 = calculateStockAtDate(mockMoves, 'p1', '2026-07-06T12:00:00.000Z');
            expect(stockAtJuly6).toBe(80);
        });

        it('debe retornar 0 si la fecha solicitada es anterior al primer movimiento', () => {
            const stockAtJune = calculateStockAtDate(mockMoves, 'p1', '2026-06-01T00:00:00.000Z');
            expect(stockAtJune).toBe(0);
        });
    });

    describe('Valorización de Inventario', () => {
        it('debe calcular el valor total del inventario correctamente', () => {
            const products = [
                { id: 'p1', stock: 10, costUsd: 2.00 }, // $20.00
                { id: 'p2', stock: 5, costUsd: 4.00 }   // $20.00
            ];
            const val = calculateInventoryValue(products);
            expect(val.totalValorizadoUsd).toBe(40.00);
            expect(val.totalUnidades).toBe(15);
            expect(val.totalProductos).toBe(2);
        });
    });

    describe('Detección de Discrepancias', () => {
        it('debe detectar alertas si existen productos con stock negativo', () => {
            const products = [
                { id: 'p1', name: 'Maltin 1.5L', stock: -3 },
                { id: 'p2', name: 'Pepsi 2L', stock: 10 }
            ];
            const alerts = detectKardexDiscrepancies([], products);
            expect(alerts).toHaveLength(1);
            expect(alerts[0].tipoAlerta).toBe('STOCK_NEGATIVO');
            expect(alerts[0].productoId).toBe('p1');
        });
    });
});
