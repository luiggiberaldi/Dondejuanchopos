import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

// jsPDF genera el PDF real en memoria; solo se impide la descarga del archivo.
const m = vi.hoisted(() => ({ docs: [], save: vi.fn() }));
vi.mock('jspdf', async importOriginal => {
    const real = await importOriginal();
    return { ...real, jsPDF: class extends real.jsPDF {
        constructor(...args) {
            super(...args);
            this.save = m.save;
            m.docs.push(this);
        }
    } };
});
import { generateTicketPDF } from '../src/utils/ticketGenerator';
import { buildTicketHtml } from '../src/utils/ticketHtmlTemplate';
import { getPaperConfig } from '../src/utils/ticketConstants';

const fixture = () => ({
    id: 'receipt-fixture', saleNumber: 42, timestamp: '2026-09-13T12:00:00.000Z',
    currency: 'BS', rate: 100, totalBs: 100, totalUsd: 0,
    items: [{ id: 'p', name: 'Producto <prueba>', qty: 1, priceUsd: 0, costBs: 100 }],
    payments: [{ methodId: 'efectivo_bs', methodLabel: 'Efectivo Bs', currency: 'BS', amount: 100, amountBs: 100, amountUsd: 1 }],
});
beforeEach(() => {
    localStorage.clear(); m.docs.length = 0; m.save.mockClear();
    // El logo no forma parte del defecto: simular su ausencia sin cargar recursos.
    vi.stubGlobal('Image', class { constructor() { throw new Error('logo no disponible en prueba'); } });
});
afterEach(() => vi.unstubAllGlobals());

describe('H11: comprobantes de productos sin precio USD', () => {
    it.each(['58', '80'])('genera HTML para papel %s sin mutar la venta', width => {
        const sale = fixture(); const before = structuredClone(sale);
        const html = buildTicketHtml(sale, 100, getPaperConfig(width), { name: 'Local de prueba', rif: '', address: '', phone: '', instagram: '' });
        expect(html).toContain('Bs 100,00');
        expect(html).toContain('Producto &lt;prueba&gt;');
        expect(html).not.toContain('NaN');
        expect(sale).toEqual(before);
    });
    it.each(['58', '80'])('genera PDF real en memoria para papel %s', async width => {
        localStorage.setItem('printer_paper_width', width);
        const sale = fixture(); const before = structuredClone(sale);
        await generateTicketPDF(sale, 100);
        expect(m.docs).toHaveLength(1);
        expect(m.docs[0].output()).toMatch(/^%PDF-/);
        expect(m.docs[0].output()).toContain('100,00 Bs');
        expect(m.save).toHaveBeenCalledExactlyOnceWith('ticket_0000042.pdf');
        expect(sale).toEqual(before);
    });
    it('permite reimpresión de la misma venta sin alterar identidad ni importes', async () => {
        const sale = fixture(); const before = structuredClone(sale);
        await generateTicketPDF(sale, 100);
        await generateTicketPDF(sale, 100);
        expect(m.save).toHaveBeenCalledTimes(2);
        expect(m.save.mock.calls.every(([name]) => name === 'ticket_0000042.pdf')).toBe(true);
        expect(sale).toEqual(before);
    });
});
