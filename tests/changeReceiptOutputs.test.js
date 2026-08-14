import { describe, expect, it, beforeEach } from 'vitest';
import { buildTicketHtml } from '../src/utils/ticketHtmlTemplate.js';
import { getPaperConfig } from '../src/utils/ticketConstants.js';
import { buildReceiptWhatsAppUrl } from '../src/components/Sales/ReceiptShareHelper.js';

const sale = {
    id: 'sale-ticket-1',
    saleNumber: 12,
    timestamp: '2026-08-14T10:30:00.000Z',
    customerName: 'Chaylin',
    customerDocument: 'V-123',
    rate: 40,
    totalUsd: 10,
    totalBs: 400,
    items: [{ id: 'p1', name: 'Producto', qty: 1, priceUsd: 10, priceBsManual: 400 }],
    payments: [{
        id: 'pay-1',
        methodId: 'efectivo_usd',
        methodLabel: 'Efectivo en Dólares',
        currency: 'USD',
        amountUsd: 15,
        amountInput: 15,
    }],
    changeRealUsd: 5,
    changeRealBs: 200,
    changeGiven: { usd: 3, bs: 0 },
    changeOwed: {
        amountUsd: 2,
        amountBs: 80,
        method: 'pago_movil',
        reference: 'REF-002',
        note: 'REF-002',
        status: 'PENDIENTE',
    },
};

beforeEach(() => {
    localStorage.setItem('receipt_currency_mode', 'mixed');
});

describe('salidas de vuelto en comprobantes', () => {
    it('ticket HTML conserva $3 entregados y $2 por fuera como filas distintas', () => {
        const html = buildTicketHtml(
            sale,
            sale.rate,
            getPaperConfig('80'),
            { name: 'Donde Juancho', rif: '', address: '', phone: '', instagram: '' },
        );

        expect(html).toContain('Vuelto Entregado:');
        expect(html).toContain('$3.00');
        expect(html).toContain('Vuelto Fuera (Pago Móvil):');
        expect(html).toContain('$2.00');
        expect(html).toContain('Ref: REF-002');
        expect(html).not.toContain('Equiv. Bs');
        expect(html).not.toContain('Bs 1.542,14');
        expect(html).not.toContain('Bs 2.313,21');
        expect(html).not.toContain('Vuelto Entregado:</td><td style="font-size:11px;font-weight:bold;text-align:right;width:45%;">$5.00');
    });

    it('WhatsApp conserva las dos salidas y la referencia externa', () => {
        const url = buildReceiptWhatsAppUrl(sale, sale.rate);
        const message = decodeURIComponent(url.split('text=')[1]);

        expect(message).toContain('VUELTO ENTREGADO: $3.00');
        expect(message).toContain('VUELTO POR FUERA (PAGO MÓVIL): $2.00');
        expect(message).toContain('Ref: REF-002');
        expect(message).not.toContain('Equiv. Bs');
        expect(message).not.toContain('Bs 1.542,14');
        expect(message).not.toContain('Bs 2.313,21');
        expect(message).not.toContain('VUELTO ENTREGADO: $5.00');
    });

    it('imprime un vuelto puro en Bs solo en Bs, nunca como USD equivalente', () => {
        const bsSale = {
            ...sale,
            rate: 40,
            totalUsd: 10,
            totalBs: 400,
            payments: [{
                id: 'pay-bs-1',
                methodId: 'efectivo_bs',
                methodLabel: 'Efectivo en Bs',
                currency: 'BS',
                amountInput: 600,
                amountBs: 600,
                amountUsd: 15,
            }],
            changeRealUsd: 5,
            changeRealBs: 200,
            changeGiven: { usd: 0, bs: 200 },
            changeOwed: null,
        };
        const html = buildTicketHtml(
            bsSale,
            bsSale.rate,
            getPaperConfig('80'),
            { name: 'Donde Juancho', rif: '', address: '', phone: '', instagram: '' },
        );
        expect(html).toContain('Vuelto Entregado:');
        expect(html).toContain('Bs 200,00');
        expect(html).not.toContain('$5.00');
        expect(html).not.toContain('Equiv. Bs');

        const url = buildReceiptWhatsAppUrl(bsSale, bsSale.rate);
        const message = decodeURIComponent(url.split('text=')[1]);
        expect(message).toContain('VUELTO ENTREGADO: Bs 200,00');
        expect(message).not.toContain('VUELTO ENTREGADO: $5.00');
    });

    it('conserva una mezcla física real sin convertirla en una segunda salida', () => {
        const mixedSale = {
            ...sale,
            rate: 40,
            changeRealUsd: 5,
            changeRealBs: 200,
            changeGiven: { usd: 1, bs: 120 },
            changeOwed: { amountUsd: 1, amountBs: 40, currency: 'USD', method: 'zelle' },
        };
        const html = buildTicketHtml(
            mixedSale,
            mixedSale.rate,
            getPaperConfig('80'),
            { name: 'Donde Juancho', rif: '', address: '', phone: '', instagram: '' },
        );
        expect(html).toContain('$1.00 + Bs 120,00');
        expect(html).toContain('Vuelto Fuera (Zelle):');
        expect(html).toContain('$1.00');
        expect(html).not.toContain('Equiv. Bs');
    });

    it('no imprime $0 para un destino legacy registrado solo en Bs', () => {
        const bsOnlySale = {
            ...sale,
            changeRealUsd: 5,
            changeRealBs: 200,
            changeGiven: { usd: 3, bs: 0 },
            changeOwed: null,
            changeVoucher: { amountUsd: 0, amountBs: 80, voucherCode: 'VCH-BS' },
        };

        const html = buildTicketHtml(
            bsOnlySale,
            bsOnlySale.rate,
            getPaperConfig('80'),
            { name: 'Donde Juancho', rif: '', address: '', phone: '', instagram: '' },
        );
        expect(html).toContain('Voucher (VCH-BS):');
        expect(html).toContain('Bs 80,00');
        expect(html).not.toContain('$0.00 (Bs 80.00)');

        const url = buildReceiptWhatsAppUrl(bsOnlySale, bsOnlySale.rate);
        const message = decodeURIComponent(url.split('text=')[1]);
        expect(message).toContain('VOUCHER EMITIDO: Bs 80,00');
        expect(message).not.toContain('VOUCHER EMITIDO: $0.00');
    });
});
