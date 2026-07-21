import { describe, it, expect } from 'vitest';
import { FinancialEngine } from '../src/core/FinancialEngine.js';
import { buildProductPayload } from '../src/utils/productProcessor.js';

describe('Precio Diferenciado USD vs BS (priceBsUsdRef)', () => {
    it('1. Debería construir el payload con priceBsUsdRef correctamente', () => {
        const formData = {
            name: 'Caja de Cerveza Polar',
            barcode: '12345678',
            priceUsd: '25.00',
            priceBsUsdRef: '26.00',
            costUsd: '18.00',
            stock: 50,
            category: 'licores'
        };

        const payload = buildProductPayload(formData, 840);
        expect(payload.priceUsd).toBe(25);
        expect(payload.priceBsUsdRef).toBe(26);
    });

    it('2. Debería cobrar $25 si es total USD y cobrar $26 * Tasa si es total en Bs', () => {
        const cartItems = [
            {
                id: 'prod_cerveza',
                name: 'Caja de Cerveza Polar',
                priceUsd: 25,
                priceBsUsdRef: 26,
                qty: 1
            }
        ];

        const rate1 = 840;
        const totalsTasa840 = FinancialEngine.buildCartTotals(cartItems, null, rate1);

        // USD total: 25 * 1 = $25
        expect(totalsTasa840.subtotalUsd).toBe(25);
        // Bs total: 26 * 840 = 21,840 Bs
        expect(totalsTasa840.subtotalBs).toBe(21840);
    });

    it('3. Debería ajustar el total en Bs automáticamente cuando cambia la Tasa BCV sin editar el producto', () => {
        const cartItems = [
            {
                id: 'prod_cerveza',
                name: 'Caja de Cerveza Polar',
                priceUsd: 25,
                priceBsUsdRef: 26,
                qty: 2
            }
        ];

        // Tasa del día 1: 840 Bs/$
        const totalsDay1 = FinancialEngine.buildCartTotals(cartItems, null, 840);
        expect(totalsDay1.subtotalUsd).toBe(50); // $25 * 2
        expect(totalsDay1.subtotalBs).toBe(43680); // 2 * $26 * 840

        // Tasa del día 2 (subió el dólar a 850 Bs/$)
        const totalsDay2 = FinancialEngine.buildCartTotals(cartItems, null, 850);
        expect(totalsDay2.subtotalUsd).toBe(50); // $25 * 2 en USD
        expect(totalsDay2.subtotalBs).toBe(44200); // 2 * $26 * 850 en Bs
    });
});
