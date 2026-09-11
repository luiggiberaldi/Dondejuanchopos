import { describe, it, expect } from 'vitest';
import { FinancialEngine } from '../src/core/FinancialEngine.js';
import { getOpenShiftMovements, findOpenApertura } from '../src/utils/shiftScope.js';

describe('Historical Cierres & Active Shift Reconciliation Guard', () => {
    const apertura = {
        id: 'apertura_1789057800000',
        tipo: 'APERTURA_CAJA',
        openingBs: 9980,
        openingUsd: 33,
        openingCop: 0,
        cajero: 'Luis Medina',
        cajeroId: 2,
        timestamp: '2026-09-10T16:11:00.000Z',
        createdAt: '2026-09-10T16:11:00.000Z',
        cajaCerrada: false
    };

    const venta785 = {
        id: '5403d7ca-02fb-4ff5-b65e-aaaa7efb3f4f',
        saleNumber: 785,
        tipo: 'VENTA',
        status: 'COMPLETADA',
        timestamp: '2026-09-10T16:46:42.668Z',
        createdAt: '2026-09-10T16:46:42.668Z',
        cajaCerrada: false,
        deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
        totalBs: 5550,
        totalUsd: 5.95,
        rate: 932.77,
        items: [{ id: 'prod_juancho_1783994743_5', name: 'Polar Light Lata Grande', qty: 6, priceUsd: 0.9916666, subtotalBs: 5550 }],
        payments: [{ isCash: false, amountBs: 5550, amountUsd: 5.95, currency: 'BS', methodId: 'pago_movil', methodLabel: 'Pago Móvil' }]
    };

    const gastoTeipe = {
        id: 'gasto_teipe_1789067070525',
        tipo: 'GASTO_INTERNO',
        status: 'COMPLETADA',
        timestamp: '2026-09-10T19:04:30.525Z',
        cajaCerrada: false,
        motivo: 'Compra de teipe',
        montoBs: 1700,
        montoUsd: 1.83,
        totalBs: 1700,
        totalUsd: 1.83,
        moneda: 'BS',
        paymentMethod: 'efectivo_bs',
        afectaCaja: true
    };

    const venta786 = {
        id: '34bbf3f7-f655-4a08-936e-e7255e5aa408',
        saleNumber: 786,
        tipo: 'VENTA',
        status: 'COMPLETADA',
        timestamp: '2026-09-10T19:24:57.320Z',
        cajaCerrada: false,
        totalBs: 660,
        totalUsd: 0.71,
        rate: 930,
        items: [{ id: 'prod_juancho_1783994743_12', name: 'Glup negro y sabores 1 Litro', qty: 1, priceUsd: 0.71, subtotalBs: 660 }],
        payments: [{ isCash: false, amountBs: 660, amountUsd: 0.71, currency: 'BS', methodId: 'punto_venta', methodLabel: 'Punto de Venta' }]
    };

    const venta787 = {
        id: 'sale_manual_100926_787',
        saleNumber: 787,
        tipo: 'VENTA',
        status: 'COMPLETADA',
        timestamp: '2026-09-10T19:35:00.000Z',
        cajaCerrada: false,
        totalBs: 880,
        totalUsd: 0.95,
        rate: 930,
        items: [{ id: 'prod_juancho_1783994743_67', name: 'Lucky Strike', qty: 4, priceUsd: 0.2375, subtotalBs: 880 }],
        payments: [{ isCash: false, amountBs: 880, amountUsd: 0.95, currency: 'BS', methodId: 'punto_venta', methodLabel: 'Punto de Venta' }]
    };

    const venta788 = {
        id: 'sale_manual_100926_788',
        saleNumber: 788,
        tipo: 'VENTA',
        status: 'COMPLETADA',
        timestamp: '2026-09-10T19:40:00.000Z',
        cajaCerrada: false,
        totalBs: 440,
        totalUsd: 0.47,
        rate: 930,
        items: [{ id: 'prod_juancho_1783994743_44', name: 'Chupetas bom Bon bum', qty: 2, priceUsd: 0.235, subtotalBs: 440 }],
        payments: [{ isCash: false, amountBs: 440, amountUsd: 0.47, currency: 'BS', methodId: 'punto_venta', methodLabel: 'Punto de Venta' }]
    };

    const venta789 = {
        id: 'sale_manual_100926_789',
        saleNumber: 789,
        tipo: 'VENTA',
        status: 'COMPLETADA',
        timestamp: '2026-09-10T19:45:00.000Z',
        cajaCerrada: false,
        totalBs: 1210,
        totalUsd: 1.30,
        rate: 930,
        items: [{ id: 'prod_juancho_1783994743_47', name: 'Cheese Trees 50gr', qty: 1, priceUsd: 1.30, subtotalBs: 1210 }],
        payments: [{ isCash: false, amountBs: 1210, amountUsd: 1.30, currency: 'BS', methodId: 'punto_venta', methodLabel: 'Punto de Venta' }]
    };

    const venta790 = {
        id: 'sale_manual_100926_790',
        saleNumber: 790,
        tipo: 'VENTA',
        status: 'COMPLETADA',
        timestamp: '2026-09-10T19:50:00.000Z',
        cajaCerrada: false,
        totalBs: 200,
        totalUsd: 0.22,
        rate: 930,
        items: [{ id: '927aba63-5c89-4f26-a75e-a4e37cdcc931', name: 'Gomitas super héroe', qty: 2, priceUsd: 0.11, subtotalBs: 200 }],
        payments: [{ isCash: false, amountBs: 200, amountUsd: 0.22, currency: 'BS', methodId: 'punto_venta', methodLabel: 'Punto de Venta' }]
    };

    const venta791 = {
        id: 'sale_manual_100926_791',
        saleNumber: 791,
        tipo: 'VENTA',
        status: 'COMPLETADA',
        timestamp: '2026-09-10T19:55:00.000Z',
        cajaCerrada: false,
        totalBs: 6280,
        totalUsd: 6.75,
        rate: 930,
        items: [{ id: 'prod_juancho_1783994743_17', name: 'Solera Lata pequeña', qty: 6, priceUsd: 1.125, subtotalBs: 6280 }],
        payments: [{ isCash: false, amountBs: 6280, amountUsd: 6.75, currency: 'BS', methodId: 'punto_venta', methodLabel: 'Punto de Venta' }]
    };

    const venta792 = {
        id: 'sale_manual_100926_792',
        saleNumber: 792,
        tipo: 'VENTA',
        status: 'COMPLETADA',
        timestamp: '2026-09-10T20:00:00.000Z',
        cajaCerrada: false,
        totalBs: 130,
        totalUsd: 0.14,
        rate: 930,
        items: [{ id: 'prod_juancho_1783994743_64', name: 'Vicerroy', qty: 1, priceUsd: 0.14, subtotalBs: 130 }],
        payments: [{ isCash: true, amountBs: 130, amountUsd: 0.14, currency: 'BS', methodId: 'efectivo_bs', methodLabel: 'Efectivo Bs' }]
    };

    const mockCierres = Array.from({ length: 40 }, (_, idx) => ({
        id: 'cierre_test_' + (idx + 1),
        tipo: 'REGISTRO_CIERRE',
        cierreNumber: idx + 1,
        cajaCerrada: true,
        timestamp: new Date(Date.now() - (41 - idx) * 86400000).toISOString(),
        summary: { cierreNumber: idx + 1, todayTotalBs: 1000 * (idx + 1) }
    }));

    const fullSalesArray = [
        apertura,
        venta785,
        gastoTeipe,
        venta786,
        venta787,
        venta788,
        venta789,
        venta790,
        venta791,
        venta792,
        ...mockCierres
    ];

    it('should find active shift apertura correctly despite 40 historical cierres', () => {
        const foundApertura = findOpenApertura(fullSalesArray);
        expect(foundApertura).toBeDefined();
        expect(foundApertura.id).toBe('apertura_1789057800000');
        expect(foundApertura.openingBs).toBe(9980);
        expect(foundApertura.openingUsd).toBe(33);
    });

    it('should calculate active movements containing 8 sales and 1 expense', () => {
        const { movements, orphans } = getOpenShiftMovements(fullSalesArray);
        expect(orphans.length).toBe(0);
        expect(movements.length).toBe(10);
    });

    it('should compute exact cash drawer matching the store notebook (8.410 Bs and 33 USD)', () => {
        const { movements } = getOpenShiftMovements(fullSalesArray);
        const breakdown = FinancialEngine.calculatePaymentBreakdown(movements);
        const expectedCash = FinancialEngine.computeExpectedCash(breakdown);

        expect(expectedCash.bs).toBe(8410);
        expect(expectedCash.usd).toBe(33);
    });

    it('should sum total sales to 15.350 Bs across exactly 8 sales', () => {
        const { movements } = getOpenShiftMovements(fullSalesArray);
        const salesOnly = movements.filter(m => m.tipo === 'VENTA');
        expect(salesOnly.length).toBe(8);

        const totalBs = salesOnly.reduce((sum, s) => sum + s.totalBs, 0);
        expect(totalBs).toBe(15350);
    });

    it('should verify payment methods breakdown: PM=5550 Bs, PTO=9670 Bs, Efectivo=130 Bs', () => {
        const { movements } = getOpenShiftMovements(fullSalesArray);
        const breakdown = FinancialEngine.calculatePaymentBreakdown(movements);

        expect(breakdown['pago_movil']?.total).toBe(5550);
        expect(breakdown['punto_venta']?.total).toBe(9670);
        // Net flow in efectivo_bs = 130 (viceroy) - 1700 (teipe) = -1570
        expect(breakdown['efectivo_bs']?.total).toBe(-1570);
        // And expected cash = 9980 float + (-1570 net cash flow) = 8410
        const expectedCash = FinancialEngine.computeExpectedCash(breakdown);
        expect(expectedCash.bs).toBe(8410);
    });

    it('should verify live Supabase Doc 60 has 40 cierres and active drawer equals 8410 Bs / $33 USD', async () => {
        const fs = await import('fs');
        const envContent = fs.readFileSync('.env', 'utf8');
        const env = {};
        envContent.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const idx = trimmed.indexOf('=');
            if (idx > -1) {
                let val = trimmed.substring(idx + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
                env[trimmed.substring(0, idx).trim()] = val;
            }
        });
        const url = env.VITE_SUPABASE_URL || env.VITE_SUPABASE_CLOUD_URL;
        const key = env.SUPABASE_SERVICE_KEY || env.VITE_SUPABASE_ANON_KEY;

        const res = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data`, {
            headers: { apikey: key, Authorization: `Bearer ${key}` }
        });
        const doc = await res.json();
        const liveSales = doc[0]?.data?.payload || [];

        const liveCierres = liveSales.filter(s => s.tipo === 'REGISTRO_CIERRE');
        expect(liveCierres.length).toBe(40);

        const liveApertura = findOpenApertura(liveSales);
        expect(liveApertura).toBeDefined();
        expect(liveApertura.openingBs).toBe(9980);
        expect(liveApertura.openingUsd).toBe(33);

        const { movements, orphans } = getOpenShiftMovements(liveSales);
        expect(orphans.length).toBe(0);

        const breakdown = FinancialEngine.calculatePaymentBreakdown(movements);
        const liveExpected = FinancialEngine.computeExpectedCash(breakdown);
        expect(liveExpected.bs).toBe(8410);
        expect(liveExpected.usd).toBe(33);

        const liveSalesOnly = movements.filter(s => s.tipo === 'VENTA');
        expect(liveSalesOnly.length).toBe(8);
        const liveTotalBs = liveSalesOnly.reduce((sum, s) => sum + s.totalBs, 0);
        expect(liveTotalBs).toBe(15350);
    });
});