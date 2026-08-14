import { describe, expect, it } from 'vitest';
import {
    aggregatePhysicalDeductions,
    buildStockTransition,
    expandCartToPhysicalDeductions,
    getPhysicalQuantity,
    isValidStockTransition
} from '../src/utils/inventoryMovementModel';

describe('inventoryMovementModel', () => {
    it('convierte cajas a unidades físicas y conserva cantidades de peso', () => {
        expect(getPhysicalQuantity({ qty: 2, _mode: 'box', boxUnits: 12 })).toBe(24);
        expect(getPhysicalQuantity({ qty: 1.25, isWeight: true })).toBe(1.25);
    });

    it('expande combo y modular a componentes, omitiendo el padre físico', () => {
        const products = [
            { id: 'harina', name: 'Harina', stock: 20 },
            { id: 'refresco', name: 'Refresco', stock: 20 },
            {
                id: 'combo',
                name: 'Combo',
                isCombo: true,
                comboItems: [{ productId: 'harina', qty: 2 }]
            },
            { id: 'modular', name: 'Modular', isModular: true }
        ];
        const cart = [
            { id: 'line-combo', _originalId: 'combo', qty: 2 },
            {
                id: 'line-modular',
                _originalId: 'modular',
                qty: 1,
                isModular: true,
                modularSelections: [
                    { productId: 'refresco', qty: 3 },
                    { productId: 'refresco', qty: 1 }
                ]
            },
            { id: 'line-deferred', _originalId: 'harina', qty: 99, isDeferredConsumption: true }
        ];

        const expanded = expandCartToPhysicalDeductions(cart, products);
        const grouped = aggregatePhysicalDeductions(expanded.deductions);

        expect(grouped).toEqual(expect.arrayContaining([
            expect.objectContaining({ productoId: 'harina', cantidad: -4 }),
            expect.objectContaining({ productoId: 'refresco', cantidad: -4 })
        ]));
        expect(grouped.some(item => item.productoId === 'combo')).toBe(false);
        expect(expanded.anomalies).toHaveLength(0);
    });

    it('resuelve IDs sintéticos de caja/media caja al producto físico canónico', () => {
        const result = expandCartToPhysicalDeductions(
            [{ id: 'solera_half', name: 'Cerveza Solera (½ Caja)', _mode: 'halfBox', qty: 1 }],
            [{ id: 'solera', name: 'Cerveza Solera', stock: 100 }]
        );

        expect(result.anomalies).toEqual([]);
        expect(result.deductions).toEqual([
            expect.objectContaining({ productoId: 'solera', cantidad: -1 })
        ]);
    });

    it('omite una venta libre porque no representa un SKU físico', () => {
        const result = expandCartToPhysicalDeductions(
            [{ id: 'custom_123', name: 'Venta Libre', qty: 1, priceUsd: 5 }],
            []
        );

        expect(result).toEqual({ deductions: [], anomalies: [] });
    });

    it('marca combos sin componentes como anomalía y no crea salida del padre', () => {
        const result = expandCartToPhysicalDeductions(
            [{ id: 'line', _originalId: 'combo', qty: 1 }],
            [{ id: 'combo', name: 'Combo incompleto', isCombo: true, comboItems: [] }]
        );

        expect(result.deductions).toEqual([]);
        expect(result.anomalies[0].tipo).toBe('COMBO_SIN_COMPONENTES');
    });

    it('aplica clamp sin inventar unidades y mantiene la invariante matemática', () => {
        const transition = buildStockTransition(3, -10, { allowNegative: false });

        expect(transition).toMatchObject({
            stockAntes: 3,
            stockDespues: 0,
            cantidadAplicada: -3,
            cantidadSolicitada: -10,
            cantidadNoAplicada: -7,
            clamped: true,
            negativeStockUsed: false
        });
        expect(isValidStockTransition(transition)).toBe(true);
    });

    it('permite saldo negativo solo cuando el guardarraíl está habilitado', () => {
        const transition = buildStockTransition(3, -10, { allowNegative: true });

        expect(transition.stockDespues).toBe(-7);
        expect(transition.cantidadAplicada).toBe(-10);
        expect(transition.negativeStockUsed).toBe(true);
        expect(isValidStockTransition(transition)).toBe(true);
    });
});
