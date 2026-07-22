// tests/pricingMode.test.js — Modo de precio canónico (D1-D4 de precios_simplificados)
import { describe, it, expect } from 'vitest';
import { derivePricingMode } from '../src/hooks/useProductForm';
import { buildProductPayload } from '../src/utils/productProcessor';

const RATE = 800;

const baseForm = {
    name: 'cerveza zulia',
    barcode: '111',
    priceUsd: '1',
    priceBsManual: '',
    priceBsUsdRef: '',
    costUsd: '', costBs: '', stock: '10', category: 'cerveza', lowStockAlert: '5',
    sellByBox: false, boxUnits: '', boxBarcode: '', boxPriceUsd: '', boxPriceBs: '', boxPriceBsUsdRef: '',
    sellByHalfBox: false, halfBoxUnits: '', halfBoxBarcode: '', halfBoxPriceUsd: '', halfBoxPriceBs: '', halfBoxPriceBsUsdRef: '',
    purchaseByBoxCost: '', purchaseBoxUnits: '', purchaseBoxBcv: false,
    forceBcv: false,
    pricingMode: 'tasa_dia', boxPricingMode: 'inherit', halfBoxPricingMode: 'inherit',
};

describe('derivePricingMode — compatibilidad hacia atrás (D2)', () => {
    it('deriva los 4 modos de unidad desde campos guardados', () => {
        expect(derivePricingMode({ priceUsd: 1 }, 'unit')).toBe('tasa_dia');
        expect(derivePricingMode({ priceUsd: 1, forceBcv: true }, 'unit')).toBe('bcv');
        expect(derivePricingMode({ priceUsd: 1, priceBsUsdRef: 2 }, 'unit')).toBe('dual_usd');
        expect(derivePricingMode({ priceUsd: 1, priceBsManual: 1300 }, 'unit')).toBe('bs_fijo');
    });

    it('pricingMode guardado tiene prioridad sobre la derivación', () => {
        expect(derivePricingMode({ pricingMode: 'bcv', priceBsManual: 999 }, 'unit')).toBe('bcv');
    });

    it('box/halfBox sin regla propia → inherit; con campos propios → modo propio', () => {
        expect(derivePricingMode({ boxPriceUsd: 10 }, 'box')).toBe('inherit');
        expect(derivePricingMode({ boxPriceBs: 9000 }, 'box')).toBe('bs_fijo');
        expect(derivePricingMode({ boxPriceBsUsdRef: 12 }, 'box')).toBe('dual_usd');
        expect(derivePricingMode({ halfBoxPriceBs: 4500 }, 'halfBox')).toBe('bs_fijo');
        expect(derivePricingMode({}, 'halfBox')).toBe('inherit');
    });
});

describe('buildProductPayload — normalización por modo (D4, fix del hallazgo)', () => {
    it('FIX: modo bcv con priceBsManual sucio → priceBsManual null y forceBcv true', () => {
        const p = buildProductPayload({
            ...baseForm,
            pricingMode: 'bcv',
            priceBsManual: '820',      // basura congelada por el viejo efecto forceBcv
            priceBsUsdRef: '2',        // también debe limpiarse
        }, RATE);
        expect(p.pricingMode).toBe('bcv');
        expect(p.forceBcv).toBe(true);
        expect(p.priceBsManual).toBeNull();
        expect(p.priceBsUsdRef).toBeNull();
    });

    it('tasa_dia limpia ambos campos Bs y forceBcv queda false', () => {
        const p = buildProductPayload({ ...baseForm, priceBsManual: '900', priceBsUsdRef: '3' }, RATE);
        expect(p.pricingMode).toBe('tasa_dia');
        expect(p.forceBcv).toBe(false);
        expect(p.priceBsManual).toBeNull();
        expect(p.priceBsUsdRef).toBeNull();
    });

    it('dual_usd conserva priceBsUsdRef y limpia priceBsManual (la cerveza $1/$2)', () => {
        const p = buildProductPayload({
            ...baseForm, pricingMode: 'dual_usd', priceBsUsdRef: '2', priceBsManual: '999',
        }, RATE);
        expect(p.priceBsUsdRef).toBe(2);
        expect(p.priceBsManual).toBeNull();
        expect(p.forceBcv).toBe(false);
    });

    it('bs_fijo conserva priceBsManual y limpia priceBsUsdRef', () => {
        const p = buildProductPayload({
            ...baseForm, pricingMode: 'bs_fijo', priceBsManual: '1300', priceBsUsdRef: '9',
        }, RATE);
        expect(p.priceBsManual).toBe(1300);
        expect(p.priceBsUsdRef).toBeNull();
    });

    it('inherit en caja resuelve al modo de la unidad y normaliza sus campos', () => {
        const p = buildProductPayload({
            ...baseForm,
            pricingMode: 'dual_usd', priceBsUsdRef: '2',
            sellByBox: true, boxUnits: '36', boxPriceUsd: '30',
            boxPricingMode: 'inherit',
            boxPriceBs: '25000',       // no aplica en dual_usd → se limpia
            boxPriceBsUsdRef: '32',    // sí aplica
        }, RATE);
        expect(p.boxPricingMode).toBe('dual_usd');
        expect(p.boxPriceBs).toBeNull();
        expect(p.boxPriceBsUsdRef).toBe(32);
    });

    it('caja con regla propia distinta a la unidad se respeta', () => {
        const p = buildProductPayload({
            ...baseForm,
            pricingMode: 'tasa_dia',
            sellByBox: true, boxUnits: '36', boxPriceUsd: '30',
            boxPricingMode: 'bs_fijo', boxPriceBs: '25000',
        }, RATE);
        expect(p.pricingMode).toBe('tasa_dia');
        expect(p.boxPricingMode).toBe('bs_fijo');
        expect(p.boxPriceBs).toBe(25000);
    });

    it('llamada legacy sin pricingMode deriva de forceBcv (D2 en el payload)', () => {
        const legacy = { ...baseForm };
        delete legacy.pricingMode;
        delete legacy.boxPricingMode;
        delete legacy.halfBoxPricingMode;
        const p = buildProductPayload({ ...legacy, forceBcv: true, priceBsManual: '820' }, RATE);
        expect(p.pricingMode).toBe('bcv');
        expect(p.forceBcv).toBe(true);
        expect(p.priceBsManual).toBeNull(); // el fix aplica también por la vía legacy
    });

    it('priceUsdt sigue siendo espejo de priceUsd (invariante intacta)', () => {
        const p = buildProductPayload({ ...baseForm, priceUsd: '1.5' }, RATE);
        expect(p.priceUsdt).toBe(p.priceUsd);
        expect(p.priceUsd).toBe(1.5);
    });
});
