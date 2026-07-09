/**
 * GENERADOR DE ETIQUETAS "ONE-CLICK" (VERSIÓN CONTINUA ULTRA-COMPATIBLE)
 * Genera un único ticket de PDF de 58mm de ancho con todas las etiquetas apiladas
 * una debajo de la otra de forma continua en una sola hoja, ideal para papel térmico.
 * Utiliza centrado manual exacto y compensación de 4mm a la izquierda para la impresora.
 */
import { round2, mulR, ceilR } from './dinero';

// Dimensiones de la etiqueta individual en mm
const LABEL_W = 58;
const LABEL_H = 60; // 60mm de alto para forzar portrait continuo sin inversión de dimensiones

export const generarEtiquetas = async (productos, effectiveRate, copEnabled, tasaCop) => {
    // Importación dinámica de jsPDF para optimizar carga inicial
    const { default: jsPDF } = await import('jspdf');

    if (!productos || productos.length === 0) return;

    const marginX = 4.5; // Margen de seguridad horizontal en mm
    const marginY = 3.5; // Margen vertical en mm

    // Altura total de la hoja dinámica según la cantidad de productos
    const totalHeight = LABEL_H * productos.length;

    // Crear un único documento Portrait de 58mm de ancho por totalHeight de alto
    const doc = new jsPDF('p', 'mm', [LABEL_W, totalHeight]);

    const width = doc.internal.pageSize.getWidth();   // 58 mm
    const height = doc.internal.pageSize.getHeight(); // totalHeight mm
    const centerX = (width / 2) - 4;                  // 25 mm (Centro exacto ajustado para hardware de impresión)
    
    // Ancho imprimible dinámico para evitar desbordes al estar desplazado el eje central
    const maxHalfWidth = Math.min(centerX, width - centerX);
    const printableWidth = (maxHalfWidth - marginX) * 2;

    // Helper ergonómico para centrar texto de forma manual (evita bugs de alineación de jsPDF)
    const centrarTexto = (texto, y, fontSize, fontStyle = 'normal', color = [0, 0, 0]) => {
        doc.setFont('helvetica', fontStyle);
        doc.setFontSize(fontSize);
        doc.setTextColor(...color);
        const textWidth = doc.getTextWidth(texto);
        doc.text(texto, centerX - textWidth / 2, y);
    };

    // Helper ergonómico para centrar arrays de líneas del título
    const centrarLineas = (lineas, y, fontSize, lineHeight = 1.3) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(fontSize);
        doc.setTextColor(0, 0, 0);
        
        lineas.forEach((line, i) => {
            const textWidth = doc.getTextWidth(line);
            doc.text(line, centerX - textWidth / 2, y + i * (fontSize * 0.3527 * lineHeight));
        });
    };

    productos.forEach((p, index) => {
        // Offset vertical base para esta etiqueta individual en la tira continua
        const offsetY = index * LABEL_H;

        // Dibujar línea divisoria punteada entre etiquetas consecutivas para facilitar el corte manual
        if (index > 0) {
            doc.setDrawColor(200, 200, 200);
            doc.setLineWidth(0.35);
            doc.setLineDashPattern([2, 2], 0);
            doc.line(marginX, offsetY, width - marginX, offsetY);
            doc.setLineDashPattern([], 0);
        }

        let safeY = offsetY + marginY + 3;

        // --- 1. TITULO DEL PRODUCTO ---
        // Configurar fuente activa para que splitTextToSize calcule basándose en el tamaño real de renderizado
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        const titleLines = doc.splitTextToSize(p.name.toUpperCase(), printableWidth);
        
        centrarLineas(titleLines, safeY, 10);
        
        const titleHeight = titleLines.length * (10 * 0.3527 * 1.3);
        safeY += titleHeight + 3;

        // --- 2. PRECIO PRINCIPAL (USD o COP) ---
        const priceUsdRaw = p.priceUsdt || 0;
        const textUsd = copEnabled && tasaCop > 0
            ? `${(p.priceCop || round2(mulR(priceUsdRaw, tasaCop))).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} COP`
            : `$${round2(priceUsdRaw)}`;

        // Tamaño de fuente dinámico según longitud del precio para evitar desborde lateral
        let priceFontSize = 24;
        if (textUsd.length > 10) priceFontSize = 16;
        else if (textUsd.length > 7) priceFontSize = 20;

        centrarTexto(textUsd, safeY, priceFontSize, 'bold');
        
        const priceHeight = priceFontSize * 0.3527 * 0.8;
        safeY += priceHeight + 3;

        // --- 3. PRECIOS SECUNDARIOS (Bs / COP o USD) ---
        const priceBsRaw = mulR(priceUsdRaw, effectiveRate);
        const textBs = `Bs ${ceilR(priceBsRaw).toLocaleString('es-VE')}`;

        centrarTexto(textBs, safeY, 10.5, 'normal');
        
        const bsHeight = 10.5 * 0.3527 * 0.8;
        safeY += bsHeight + 2;

        if (copEnabled && tasaCop > 0) {
            const textSecondary = `USD ${round2(priceUsdRaw)}`;
            centrarTexto(textSecondary, safeY, 8.5, 'normal');
        }

        // --- 4. FOOTER (Fecha y Unidad/Código) ---
        const footerY = offsetY + LABEL_H - marginY - 2;
        
        const d = new Date();
        const fechaStr = `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(-2)}`;
        const infoExtra = p.barcode || (p.unit ? p.unit.toUpperCase() : 'UND');
        
        centrarTexto(`${infoExtra}  |  ${fechaStr}`, footerY, 6.5, 'normal', [80, 80, 80]);
    });

    // Disparar auto-impresión a través de iframe para flujo directo continuo y limpio
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
