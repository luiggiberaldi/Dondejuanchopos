import { describe, test, expect } from 'vitest';
import { isFrozenMode, getFrozenFormats } from '../src/utils/frozenPrices';

describe('frozenPrices unit tests', () => {
    test('isFrozenMode detects manual/fixed Bs pricing modes', () => {
        expect(isFrozenMode('bs_fijo', 0, false, 0)).toBe(true);
        expect(isFrozenMode('bcv', 500, false, 0)).toBe(false);
        expect(isFrozenMode('tasa_dia', 500, false, 0)).toBe(false);
        expect(isFrozenMode('tasa_dia', 0, false, 0)).toBe(false);
        expect(isFrozenMode(undefined, 500, false, 0)).toBe(true);
    });

    test('getFrozenFormats returns unit format when pricingMode is bs_fijo', () => {
        const prod = {
            id: 'p1',
            name: 'Harina PAN',
            pricingMode: 'bs_fijo',
            priceBsManual: 45,
            priceUsd: 1
        };
        const formats = getFrozenFormats(prod);
        expect(formats).toHaveLength(1);
        expect(formats[0].type).toBe('unidad');
        expect(formats[0].currentBs).toBe(45);
    });

    test('getFrozenFormats includes caja when sellByBox is true and boxPricingMode is bs_fijo', () => {
        const prod = {
            id: 'p2',
            name: 'Refresco 2L',
            pricingMode: 'bcv',
            sellByBox: true,
            boxPricingMode: 'bs_fijo',
            boxPriceBsManual: 500,
            boxPriceUsd: 10
        };
        const formats = getFrozenFormats(prod);
        expect(formats).toHaveLength(1);
        expect(formats[0].type).toBe('caja');
        expect(formats[0].currentBs).toBe(500);
    });

    test('getFrozenFormats includes both caja and medioBulto when sellByBox & sellByHalfBox are true and frozen', () => {
        const prod = {
            id: 'p3',
            name: 'Galletas',
            pricingMode: 'bs_fijo',
            priceBsManual: 30,
            sellByBox: true,
            boxPricingMode: 'bs_fijo',
            boxPriceBsManual: 300,
            sellByHalfBox: true,
            halfBoxPricingMode: 'bs_fijo',
            halfBoxPriceBsManual: 150
        };
        const formats = getFrozenFormats(prod);
        expect(formats).toHaveLength(3);
        expect(formats.map(f => f.type)).toEqual(['unidad', 'caja', 'medioBulto']);
    });

    test('getFrozenFormats ignores sellByHalfBox if sellByBox is false', () => {
        const prod = {
            id: 'p4',
            name: 'Jabon',
            pricingMode: 'bcv',
            sellByBox: false,
            sellByHalfBox: true,
            halfBoxPricingMode: 'bs_fijo',
            halfBoxPriceBsManual: 100
        };
        const formats = getFrozenFormats(prod);
        expect(formats).toHaveLength(0);
    });

    test('getFrozenFormats inherits boxPricingMode when set to inherit', () => {
        const prod = {
            id: 'p5',
            name: 'Aceite',
            pricingMode: 'bs_fijo',
            priceBsManual: 120,
            sellByBox: true,
            boxPricingMode: 'inherit',
            boxPriceBsManual: 1200
        };
        const formats = getFrozenFormats(prod);
        expect(formats).toHaveLength(2);
        expect(formats.map(f => f.type)).toEqual(['unidad', 'caja']);
    });

    test('getFrozenFormats returns 0 formats for standard BCV product', () => {
        const prod = {
            id: 'p6',
            name: 'Arroz',
            pricingMode: 'bcv',
            priceUsd: 1.2
        };
        const formats = getFrozenFormats(prod);
        expect(formats).toHaveLength(0);
    });
});
