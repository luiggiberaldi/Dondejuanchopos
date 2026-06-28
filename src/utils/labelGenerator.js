/**
 * GENERADOR DE ETIQUETAS "ONE-CLICK"
 * Genera un PDF 58mm continuo con todas las etiquetas apiladas
 * una debajo de la otra en un solo ticket — sin páginas separadas.
 *
 * Migrado a dinero.js (deuda técnica detectada por guardrail ESLint):
 *   - `Math.round(priceUsdRaw * tasaCop)` → `round2(mulR(priceUsdRaw, tasaCop))` (COP entero via toLocaleString)
 *   - `priceUsdRaw.toFixed(2)` → `round2(priceUsdRaw)` + template
 *   - `priceUsdRaw * effectiveRate` → `mulR(priceUsdRaw, effectiveRate)`
 *   - `Math.ceil(priceBsRaw)` → `ceilR(priceBsRaw)` (política Bs a entero)
 */
import { round2, mulR, ceilR } from './dinero';

// Altura por etiqueta en mm
const LABEL_H = 40;
// Ancho del papel térmico en mm
const LABEL_W = 58;

export const generarEtiquetas = async (productos, effectiveRate, copEnabled, tasaCop) => {
    // Dynamic import for lazy loading jsPDF (no penaliza tiempo de carga inicial)
    const { default: jsPDF } = await import('jspdf');

    if (!productos || productos.length === 0) return;

    const marginX = 2;
    const marginY = 2;
    const printableWidth = LABEL_W - marginX * 2;
    const centerX = LABEL_W / 2;

    // Documento único: 58mm de ancho, alto = N etiquetas apiladas
    const totalHeight = LABEL_H * productos.length;

    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [LABEL_W, totalHeight],
    });

    productos.forEach((p, index) => {
        // Offset vertical base para esta etiqueta
        const offsetY = index * LABEL_H;

        // Línea separadora entre etiquetas (no antes de la primera)
        if (index > 0) {
            doc.setDrawColor(200, 200, 200);
            doc.setLineWidth(0.2);
            doc.setLineDashPattern([1, 1], 0);
            doc.line(marginX, offsetY, LABEL_W - marginX, offsetY);
            doc.setLineDashPattern([], 0);
        }

        let safeY = offsetY + marginY + 2;

        // --- 1. TITULO DEL PRODUCTO ---
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(0, 0, 0);

        const titleLines = doc.splitTextToSize(p.name.toUpperCase(), printableWidth - 2);
        const safeLines = titleLines.slice(0, 2); // Max 2 líneas
        doc.text(safeLines, centerX, safeY, { align: 'center', baseline: 'top' });

        const titleHeight = safeLines.length * (11 * 0.3527 * 1.2);
        safeY += titleHeight + 2;

        // --- 2. PRECIO PRINCIPAL (USD o COP) ---
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(26);

        const priceUsdRaw = p.priceUsdt || 0;
        const textUsd = copEnabled && tasaCop > 0
            ? `${(p.priceCop || round2(mulR(priceUsdRaw, tasaCop))).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} COP`
            : `$${round2(priceUsdRaw)}`;

        doc.text(textUsd, centerX, safeY, { align: 'center', baseline: 'top' });
        safeY += (26 * 0.3527 * 0.8) + 2;

        // --- 3. PRECIOS SECUNDARIOS (Bs / COP o USD) ---
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(12);

        const priceBsRaw = mulR(priceUsdRaw, effectiveRate);
        const textBs = `Bs ${ceilR(priceBsRaw).toLocaleString('es-VE')}`;

        doc.text(textBs, centerX, safeY, { align: 'center', baseline: 'top' });
        safeY += (12 * 0.3527 * 0.8) + 1;

        if (copEnabled && tasaCop > 0) {
            doc.setFontSize(10);
            const textSecondary = `USD ${round2(priceUsdRaw)}`;
            doc.text(textSecondary, centerX, safeY, { align: 'center', baseline: 'top' });
        }

        // --- 4. FOOTER (Fecha y Unidad) ---
        const footerY = offsetY + LABEL_H - marginY - 1;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(80);

        const fechaStr = new Date().toLocaleDateString();
        const infoExtra = p.barcode || (p.unit ? p.unit.toUpperCase() : 'UND');
        doc.text(`${infoExtra}  |  ${fechaStr}`, centerX, footerY, { align: 'center', baseline: 'bottom' });
    });

    // Auto-impresión
    doc.autoPrint();
    const blobUrl = doc.output('bloburl');
    const iframe = document.createElement('iframe');
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
    iframe.src = blobUrl;
    document.body.appendChild(iframe);

    iframe.onload = () => {
        try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        } catch (e) {
            console.error('Error printing from iframe:', e);
            window.open(blobUrl, '_blank');
        }
        setTimeout(() => {
            try { document.body.removeChild(iframe); }
            catch (_e) { /* iframe ya removido — no-op */ }
        }, 5000);
    };
};
