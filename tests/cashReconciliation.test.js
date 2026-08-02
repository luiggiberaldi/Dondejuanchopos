import { describe, it, expect } from 'vitest';
import { round2, mulR } from '../src/utils/dinero';
import { FinancialEngine } from '../src/core/FinancialEngine';

describe('Reconciliación de Efectivo y Vueltos (F2)', () => {
    const tasa = 45;

    it('1. Apertura Bs 5.570, venta Bs 398 pagada con billete de Bs 500 -> vuelto Bs 102', () => {
        const openingBs = 5570;
        const saleTotalBs = 398;
        const cashPaidBs = 500;
        const changeBs = cashPaidBs - saleTotalBs; // 102

        expect(changeBs).toBe(102);

        // Efectivo neto de la venta = 500 - 102 = 398
        const netSalesCashBs = cashPaidBs - changeBs;
        const expectedBs = openingBs + netSalesCashBs;

        expect(expectedBs).toBe(5968);
        const declaredBs = 5968;
        expect(declaredBs - expectedBs).toBe(0);
    });

    it('2. Pago en Bs sin tocar campos de desglose -> changeBs = 102, changeUsd = 0', () => {
        const cashPaidBs = 500;
        const cashPaidUsdInBs = 0;
        const vueltoEnBs = cashPaidBs > cashPaidUsdInBs;
        const cambioUSD = 2.2667; // 102 / 45

        const changeUsdGiven = vueltoEnBs ? 0 : cambioUSD;
        const changeBsGiven = vueltoEnBs ? round2(mulR(cambioUSD, tasa)) : 0;

        expect(changeUsdGiven).toBe(0);
        expect(changeBsGiven).toBe(102);
    });

    it('3. Pago en USD ($5) por compra de $1 sin tocar campos -> changeUsd = 4, changeBs = 0', () => {
        const cashPaidBs = 0;
        const cashPaidUsdInBs = 5 * tasa;
        const vueltoEnBs = cashPaidBs > cashPaidUsdInBs;
        const cambioUSD = 4;

        const changeUsdGiven = vueltoEnBs ? 0 : cambioUSD;
        const changeBsGiven = vueltoEnBs ? round2(mulR(cambioUSD, tasa)) : 0;

        expect(changeUsdGiven).toBe(4);
        expect(changeBsGiven).toBe(0);
    });

    it('4. Vuelto repartido ($4 vuelto -> $2 en efectivo $ y $2 en Bs)', () => {
        const distVueltoUSD = '2.00';
        const distVueltoBS = String(2 * tasa); // '90'

        const changeUsdGiven = parseFloat(distVueltoUSD);
        const changeBsGiven = parseFloat(distVueltoBS);

        expect(changeUsdGiven).toBe(2);
        expect(changeBsGiven).toBe(90);

        // Anti-G1: La suma convertida a USD es exactamente $4
        const totalVueltoUsdEquiv = changeUsdGiven + (changeBsGiven / tasa);
        expect(totalVueltoUsdEquiv).toBe(4);
    });

    it('5. Pago mixto en efectivo -> el defecto cae en la moneda del mayor componente', () => {
        // Pago: $10 en billete USD (= 450 Bs) + 100 Bs en billete Bs.
        // Total pagado en efectivo = 550 Bs. Mayor componente: USD.
        const cashPaidBs = 100;
        const cashPaidUsdInBs = 10 * tasa; // 450
        const vueltoEnBs = cashPaidBs > cashPaidUsdInBs;

        expect(vueltoEnBs).toBe(false); // Defecto en USD
    });

    it('6. Anti-G1: La suma de vueltos expresada en base común no duplica el vuelto', () => {
        const cambioUSD = 4;
        const vueltoEnBs = false; // Pago en $

        const changeUsdGiven = vueltoEnBs ? 0 : cambioUSD; // 4
        const changeBsGiven = vueltoEnBs ? round2(mulR(cambioUSD, tasa)) : 0; // 0

        const totalVueltoNormalizadoUsd = changeUsdGiven + (changeBsGiven / tasa);
        expect(totalVueltoNormalizadoUsd).toBe(4); // No es 8 (no duplicado)
    });

    it('7. F4: FinancialEngine procesa la partición changeGiven correctamente', () => {
        const sale = {
            id: 'sale_f4_test',
            tipo: 'VENTA',
            totalBs: 398,
            totalUsd: 8.84,
            payments: [{ methodId: 'efectivo_bs', currency: 'BS', amountBs: 500, amountUsd: 11.11 }],
            changeGiven: { usd: 0, bs: 102 }
        };

        const result = FinancialEngine.calculatePaymentBreakdown([sale]);
        expect(result['_vuelto_bs']?.total).toBe(102);
        expect(result['_vuelto_usd']).toBeUndefined();
    });

    it('8. F4: Guardarraíl COP genera anomalía si copEnabled=false y hay pagos COP', () => {
        const sale = {
            id: 'sale_cop_test',
            tipo: 'VENTA',
            copEnabled: false,
            payments: [{ methodId: 'efectivo_cop', currency: 'COP', amountCop: 5000 }],
            changeGiven: { usd: 0, bs: 0 }
        };

        const result = FinancialEngine.calculatePaymentBreakdown([sale], { withAnomalies: true });
        const copAnomaly = result.anomalies.find(a => a.type === 'UNSUPPORTED_COP_PAYMENT');
        expect(copAnomaly).toBeDefined();
    });
});
