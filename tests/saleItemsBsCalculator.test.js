import { describe, it, expect } from 'vitest';
import { getSaleCurrentBsTotal } from '../src/utils/saleItemsBsCalculator';

describe('saleItemsBsCalculator — getSaleCurrentBsTotal', () => {
    it('1. Caja de Cerveza en modo bs_fijo retorna el precio fijado en Bs (22.100 Bs)', () => {
        const saleItems = [{
            name: 'Cerveza Polar Light (Caja)',
            _mode: 'box',
            pricingMode: 'bs_fijo',
            boxPricingMode: 'bs_fijo',
            boxPriceBs: 22100,
            priceUsd: 25,
            qty: 1
        }];

        const result = getSaleCurrentBsTotal(saleItems, 870, 870, 10);
        expect(result.totalBs).toBe(22100);
        expect(result.isEstimated).toBe(false);
    });

    it('2. Producto unidad en modo tasa_dia calcula sobre effectiveRate con redondeo al paso (10 Bs)', () => {
        const saleItems = [{
            name: 'Cerveza Polar Light',
            _mode: 'unit',
            pricingMode: 'tasa_dia',
            priceUsd: 0.84,
            qty: 36
        }];

        // 0.84 * 870 = 730.8 -> roundBs(730.8, 10) = 730 Bs unidad -> 730 * 36 = 26280 Bs
        const result = getSaleCurrentBsTotal(saleItems, 870, 870, 10);
        expect(result.totalBs).toBe(26280);
        expect(result.isEstimated).toBe(false);
    });

    it('3. Producto en modo dual_usd utiliza priceBsUsdRef * effectiveRate', () => {
        const saleItems = [{
            name: 'Producto Dual',
            _mode: 'unit',
            pricingMode: 'dual_usd',
            priceBsUsdRef: 26,
            priceUsd: 25,
            qty: 1
        }];

        // 26 * 850 = 22100 Bs
        const result = getSaleCurrentBsTotal(saleItems, 850, 850, 10);
        expect(result.totalBs).toBe(22100);
        expect(result.isEstimated).toBe(false);
    });

    it('4. Fallback seguro si el ítem carece de metadata de pricing (crédito manual)', () => {
        const saleItems = [{
            name: 'Credito manual: Mario',
            priceUsd: 25,
            qty: 1
        }];

        // 25 * 870 = 21750 Bs
        const result = getSaleCurrentBsTotal(saleItems, 870, 870, 10);
        expect(result.totalBs).toBe(21750);
        expect(result.isEstimated).toBe(true);
    });

    it('5. Manejo de ítems vacíos o nulos sin lanzar excepción', () => {
        expect(getSaleCurrentBsTotal(null, 870, 870).totalBs).toBe(0);
        expect(getSaleCurrentBsTotal([], 870, 870).totalBs).toBe(0);
        expect(getSaleCurrentBsTotal([null], 870, 870).totalBs).toBe(0);
    });

    it('6. Múltiples ítems mixtos combinando bs_fijo y tasa_dia', () => {
        const saleItems = [
            {
                name: 'Caja Polar',
                _mode: 'box',
                pricingMode: 'bs_fijo',
                boxPricingMode: 'bs_fijo',
                boxPriceBs: 22100,
                qty: 1
            },
            {
                name: 'Refresco',
                _mode: 'unit',
                pricingMode: 'tasa_dia',
                priceUsd: 1.00,
                qty: 2
            }
        ];

        // Refresco: 1.00 * 870 = 870 -> roundBs(870, 10) = 870 * 2 = 1740 Bs
        // Total = 22100 + 1740 = 23840 Bs
        const result = getSaleCurrentBsTotal(saleItems, 870, 870, 10);
        expect(result.totalBs).toBe(23840);
    });

    it('7. Modo BCV utiliza bcvRate si es distinto de effectiveRate', () => {
        const saleItems = [{
            name: 'Producto BCV',
            _mode: 'unit',
            pricingMode: 'bcv',
            forceBcv: true,
            priceUsd: 25,
            qty: 1
        }];

        // 25 * 870 = 21750 Bs (incluso si effectiveRate es 880)
        const result = getSaleCurrentBsTotal(saleItems, 880, 870, 10);
        expect(result.totalBs).toBe(21750);
    });

    it('8. Cantidades con decimales (ventas por peso) se multiplican con precisión de dinero.js', () => {
        const saleItems = [{
            name: 'Queso por Kilo',
            _mode: 'unit',
            pricingMode: 'tasa_dia',
            priceUsd: 5.00,
            qty: 1.5
        }];

        // 5.00 * 800 = 4000 Bs/kg -> 4000 * 1.5 = 6000 Bs
        const result = getSaleCurrentBsTotal(saleItems, 800, 800, 10);
        expect(result.totalBs).toBe(6000);
    });

    it('9. Coincidencia por catálogo de productos (lookup de producto en sistema por nombre o ID)', () => {
        const saleItems = [{
            name: 'Cerveza Polar Light (Caja)',
            qty: 1,
            priceUsd: 25
        }];
        const productsCatalog = [{
            id: 'prod_123',
            name: 'Cerveza Polar Light',
            priceUsd: 0.84,
            sellByBox: true,
            boxUnits: 36,
            boxPriceUsd: 25,
            boxPricingMode: 'bs_fijo',
            boxPriceBs: 22100
        }];

        const result = getSaleCurrentBsTotal(saleItems, productsCatalog, 870, 870, 10);
        expect(result.totalBs).toBe(22100);
        expect(result.isEstimated).toBe(false);
    });
});
