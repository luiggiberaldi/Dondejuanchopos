import { jsPDF } from 'jspdf';
import { formatBs, formatUsd } from './calculatorUtils';

/**
 * Genera y descarga un informe PDF ejecutivo de los consumos y liquidación de nómina de un empleado.
 * 
 * @param {Object} opts
 * @param {Object} opts.employee - Datos del empleado { nombre, cedula, cargo, salarioSemanalUsd, limiteConsumoPorc }
 * @param {Object} opts.summary - Balance y proyección { periodoId, startDate, endDate, salarioSemanalUsd, totalConsumosUsd, netoAPagarUsd, netoAPagarBs, settled, status }
 * @param {Array} opts.consumptions - Historial de consumos del empleado
 * @param {Array} opts.settlements - Historial de liquidaciones del empleado
 * @param {number} opts.bcvRate - Tasa de cambio BCV
 */
export async function generateEmployeePayrollPDF({
    employee,
    summary,
    consumptions = [],
    settlements = [],
    bcvRate = 0
}) {
    if (!employee) return;

    // Precargar la imagen del logo si está disponible
    let imgLogo = null;
    try {
        const img = new Image();
        img.src = './logo.png';
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
        imgLogo = img;
    } catch (_) {}

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentWidth = pageWidth - margin * 2;

    // Paleta de colores corporativa
    const COLOR_BRAND = [25, 50, 117];       // Azul marino marca
    const COLOR_ACCENT = [16, 185, 129];     // Esmeralda / Éxito
    const COLOR_WARNING = [217, 119, 6];     // Ámbar
    const COLOR_TEXT = [33, 37, 41];         // Texto principal
    const COLOR_MUTED = [108, 117, 125];     // Gris secundario
    const COLOR_BG_HEADER = [241, 245, 249]; // Slate-100
    const COLOR_BG_ZEBRA = [248, 250, 252];  // Slate-50
    const COLOR_LINE = [226, 232, 240];      // Slate-200

    // Obtener la tasa de cambio viva y modo de tasa del día
    let activeRate = Number(bcvRate) || 0;
    let rateLabel = 'Tasa del Día';

    try {
        const rateMode = localStorage.getItem('bodega_rate_mode');
        const customRate = parseFloat(localStorage.getItem('bodega_custom_rate') || '0');
        const lastEffective = parseFloat(localStorage.getItem('dj_last_effective_rate') || '0');
        const savedRates = JSON.parse(localStorage.getItem('monitor_rates_v12') || '{}');

        if (rateMode === 'manual' && customRate > 0) {
            activeRate = customRate;
            rateLabel = 'Tasa del Día (Manual)';
        } else if (activeRate > 0) {
            rateLabel = (rateMode === 'manual' || activeRate === customRate) ? 'Tasa del Día (Manual)' : 'Tasa Oficial BCV';
        } else if (lastEffective > 0) {
            activeRate = lastEffective;
            rateLabel = rateMode === 'manual' ? 'Tasa del Día (Manual)' : 'Tasa Oficial BCV';
        } else if (savedRates?.bcv?.price) {
            activeRate = Number(savedRates.bcv.price);
            rateLabel = 'Tasa Oficial BCV';
        }
    } catch (_) {}

    let y = margin;

    const drawFooter = () => {
        const footerY = pageHeight - 12;
        doc.setDrawColor(COLOR_LINE[0], COLOR_LINE[1], COLOR_LINE[2]);
        doc.setLineWidth(0.3);
        doc.line(margin, footerY - 2, margin + contentWidth, footerY - 2);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
        doc.text('Donde Juancho · Precios al Día POS · Sistema de Nómina y Consumos', margin, footerY + 2);

        const pageStr = `Página ${doc.internal.getNumberOfPages()}`;
        doc.text(pageStr, margin + contentWidth - doc.getTextWidth(pageStr), footerY + 2);
    };

    const checkPageBreak = (needed = 15) => {
        if (y + needed > pageHeight - 20) {
            drawFooter();
            doc.addPage();
            y = margin;
            drawHeader(true);
        }
    };

    const drawHeader = (isSubsequentPage = false) => {
        // Franja superior de marca
        doc.setFillColor(COLOR_BRAND[0], COLOR_BRAND[1], COLOR_BRAND[2]);
        doc.rect(margin, y, contentWidth, 2.5, 'F');
        y += 5;

        // Logo
        if (imgLogo) {
            try {
                doc.addImage(imgLogo, 'PNG', margin, y, 16, 16);
            } catch (_) {}
        }

        const headerTextX = imgLogo ? margin + 19 : margin;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(COLOR_BRAND[0], COLOR_BRAND[1], COLOR_BRAND[2]);
        doc.text('DONDE JUANCHO', headerTextX, y + 5);

        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2]);
        doc.text('ESTADO DE CUENTA Y CONSUMOS DE PERSONAL', headerTextX, y + 10);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
        const fechaImpresion = `Generado el: ${new Date().toLocaleString('es-VE')}`;
        doc.text(fechaImpresion, margin + contentWidth - doc.getTextWidth(fechaImpresion), y + 5);

        if (activeRate > 0) {
            const tasaStr = `${rateLabel}: ${Number(activeRate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs/USD`;
            doc.text(tasaStr, margin + contentWidth - doc.getTextWidth(tasaStr), y + 10);
        }

        y += 18;

        // Línea divisoria
        doc.setDrawColor(COLOR_LINE[0], COLOR_LINE[1], COLOR_LINE[2]);
        doc.setLineWidth(0.4);
        doc.line(margin, y, margin + contentWidth, y);
        y += 4;
    };

    // Primera página
    drawHeader(false);

    // ── 1. FICHA DEL EMPLEADO Y PERÍODO ──
    doc.setFillColor(COLOR_BG_HEADER[0], COLOR_BG_HEADER[1], COLOR_BG_HEADER[2]);
    doc.roundedRect(margin, y, contentWidth, 20, 2, 2, 'F');
    doc.setDrawColor(COLOR_LINE[0], COLOR_LINE[1], COLOR_LINE[2]);
    doc.roundedRect(margin, y, contentWidth, 20, 2, 2, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(COLOR_BRAND[0], COLOR_BRAND[1], COLOR_BRAND[2]);
    doc.text(`Empleado: ${employee.nombre || 'Personal'}`, margin + 4, y + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2]);
    doc.text(`Cédula: ${employee.cedula || 'N/A'}    |    Cargo: ${employee.cargo || 'Personal'}    |    Límite Consumo: ${employee.limiteConsumoPorc || 100}%`, margin + 4, y + 12);

    const periodoText = `Período Semanal: ${summary?.periodoId || 'Actual'} ${summary?.startDate ? `(${summary.startDate} al ${summary.endDate})` : ''}`;
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text(periodoText, margin + 4, y + 17);

    y += 24;

    // ── 2. TARJETAS KPI DE NÓMINA (Salario, Consumos, Neto) ──
    const cardWidth = (contentWidth - 6) / 3;
    const cardHeight = 16;

    const salarioUsd = Number(summary?.salarioSemanalUsd ?? employee.salarioSemanalUsd ?? 0);
    const consumosUsd = Number(summary?.totalConsumosUsd ?? 0);
    const netoUsd = Number(summary?.netoAPagarUsd ?? (salarioUsd - consumosUsd));
    const netoBs = Number(summary?.netoAPagarBs ?? (activeRate ? netoUsd * activeRate : 0));

    // Card 1: Salario Semanal
    doc.setFillColor(245, 247, 250);
    doc.roundedRect(margin, y, cardWidth, cardHeight, 2, 2, 'F');
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text('SALARIO BASE SEMANAL', margin + 3, y + 5);
    doc.setFontSize(11);
    doc.setTextColor(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2]);
    doc.text(formatUsd(salarioUsd), margin + 3, y + 12);

    // Card 2: Consumos en Tienda
    doc.setFillColor(254, 243, 199); // Ámbar suave
    doc.roundedRect(margin + cardWidth + 3, y, cardWidth, cardHeight, 2, 2, 'F');
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(COLOR_WARNING[0], COLOR_WARNING[1], COLOR_WARNING[2]);
    doc.text('TOTAL CONSUMIDO', margin + cardWidth + 6, y + 5);
    doc.setFontSize(11);
    doc.text(formatUsd(consumosUsd), margin + cardWidth + 6, y + 12);

    // Card 3: Saldo Neto a Cobrar
    doc.setFillColor(209, 250, 229); // Verde suave
    doc.roundedRect(margin + (cardWidth + 3) * 2, y, cardWidth, cardHeight, 2, 2, 'F');
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(COLOR_ACCENT[0], COLOR_ACCENT[1], COLOR_ACCENT[2]);
    doc.text('SALDO RESTANTE (NETO)', margin + (cardWidth + 3) * 2 + 3, y + 5);
    doc.setFontSize(11);
    doc.text(`${formatUsd(netoUsd)}`, margin + (cardWidth + 3) * 2 + 3, y + 12);

    y += cardHeight + 6;

    // ── 3. TABLA DE CONSUMOS DETALLADOS ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(COLOR_BRAND[0], COLOR_BRAND[1], COLOR_BRAND[2]);
    doc.text('DETALLE DE PRODUCTOS CONSUMIDOS EN EL PERÍODO', margin, y + 3);
    y += 6;

    // Encabezados de tabla
    const colX = {
        fecha: margin + 2,
        productos: margin + 30,
        estado: margin + 124,
        totalBs: margin + 144,
        totalUsd: margin + contentWidth - 2
    };

    const drawTableHead = () => {
        doc.setFillColor(COLOR_BRAND[0], COLOR_BRAND[1], COLOR_BRAND[2]);
        doc.rect(margin, y, contentWidth, 6.5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(255, 255, 255);
        doc.text('FECHA Y HORA', colX.fecha, y + 4.5);
        doc.text('ARTÍCULOS / PRODUCTOS', colX.productos, y + 4.5);
        doc.text('ESTADO', colX.estado, y + 4.5);
        doc.text('MONTO BS', colX.totalBs, y + 4.5);
        const usdHead = 'MONTO USD';
        doc.text(usdHead, colX.totalUsd - doc.getTextWidth(usdHead), y + 4.5);
        y += 7.5;
    };

    drawTableHead();

    if (!consumptions || consumptions.length === 0) {
        doc.setFillColor(COLOR_BG_ZEBRA[0], COLOR_BG_ZEBRA[1], COLOR_BG_ZEBRA[2]);
        doc.rect(margin, y, contentWidth, 8, 'F');
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
        doc.text('No se registraron consumos en este período.', margin + 4, y + 5.5);
        y += 10;
    } else {
        const maxProdsWidth = (colX.estado - colX.productos) - 4;

        consumptions.forEach((item, index) => {
            // Formatear todos los productos y cantidades completas sin truncar
            const itemsList = item.items || [];
            const prodsStr = itemsList.length > 0
                ? itemsList.map(line => `${line.qty ?? 1}x ${line.name || line.nombre || 'Artículo'}`).join(', ')
                : (item.descripcion || item.description || item.nota || 'Consumo general');

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            const prodLines = doc.splitTextToSize(prodsStr, maxProdsWidth);
            const lineCount = Math.max(1, prodLines.length);
            const rowHeight = Math.max(7, (lineCount * 3.6) + 3.2);

            if (y + rowHeight > pageHeight - 20) {
                drawFooter();
                doc.addPage();
                y = margin;
                drawHeader(true);
                drawTableHead();
            }

            const isZebra = index % 2 === 1;
            if (isZebra) {
                doc.setFillColor(COLOR_BG_ZEBRA[0], COLOR_BG_ZEBRA[1], COLOR_BG_ZEBRA[2]);
                doc.rect(margin, y, contentWidth, rowHeight, 'F');
            }

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2]);

            // Fecha
            const fechaStr = item.timestamp ? new Date(item.timestamp).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }) : 'N/A';
            doc.text(fechaStr, colX.fecha, y + 4.2);

            // Productos (texto multilínea completo sin recortes)
            doc.text(prodLines, colX.productos, y + 4.2);

            // Estado claro para nómina (CONSUMIDO / ANULADO / LIQUIDADO)
            const isAnulado = item.status === 'VOIDED';
            const isLiquidado = Boolean(item.settlementId);
            const estadoTexto = isAnulado ? 'ANULADO' : (isLiquidado ? 'LIQUIDADO' : 'CONSUMIDO');
            doc.setFont('helvetica', isAnulado ? 'italic' : 'bold');
            doc.setTextColor(isAnulado ? 220 : (isLiquidado ? 37 : 30), isAnulado ? 38 : (isLiquidado ? 99 : 130), isAnulado ? 38 : (isLiquidado ? 235 : 60));
            doc.text(estadoTexto, colX.estado, y + 4.2);

            // Monto Bs siempre actualizado a la tasa viva del día
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2]);
            const montoBsCalculado = activeRate > 0
                ? Number(item.totalUsd || 0) * activeRate
                : Number(item.totalBs || 0);
            const montoBsStr = montoBsCalculado > 0
                ? `${Number(montoBsCalculado).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs`
                : '-';
            doc.text(montoBsStr, colX.totalBs, y + 4.2);

            const usdStr = formatUsd(item.totalUsd || 0);
            doc.setFont('helvetica', 'bold');
            doc.text(usdStr, colX.totalUsd - doc.getTextWidth(usdStr), y + 4.2);

            y += rowHeight;
        });
    }

    // ── 4. RESUMEN DE LIQUIDACIÓN / PAGOS ──
    if (settlements && settlements.length > 0) {
        checkPageBreak(25);
        y += 4;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(COLOR_BRAND[0], COLOR_BRAND[1], COLOR_BRAND[2]);
        doc.text('HISTORIAL DE LIQUIDACIÓN / PAGO DE NÓMINA', margin, y + 3);
        y += 6;

        settlements.forEach(st => {
            checkPageBreak(14);
            doc.setFillColor(236, 253, 245); // Verde esmeralda claro
            doc.roundedRect(margin, y, contentWidth, 12, 2, 2, 'F');
            doc.setDrawColor(167, 243, 208);
            doc.roundedRect(margin, y, contentWidth, 12, 2, 2, 'S');

            const statusEspanol = st.status === 'PAID' ? 'PAGADA' : (st.status === 'VOIDED' ? 'ANULADA' : (st.status || 'PAGADA'));
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(COLOR_ACCENT[0], COLOR_ACCENT[1], COLOR_ACCENT[2]);
            doc.text(`LIQUIDACIÓN ${statusEspanol} · Pagado: ${formatUsd(st.netoAPagarUsd)} (${Number(st.netoAPagarBs || 0).toLocaleString('es-VE')} Bs)`, margin + 4, y + 5);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2]);
            const detallePago = `Fecha: ${st.paidAt ? new Date(st.paidAt).toLocaleString('es-VE') : 'N/A'}  |  Métodos: ${(st.payments || []).map(p => `${p.methodLabel || p.methodId} ($${p.amountUsd})`).join(', ') || 'Efectivo'}`;
            doc.text(detallePago, margin + 4, y + 9.5);
            y += 15;
        });
    }

    // ── 5. SECCIÓN DE FIRMAS DE CONFORMIDAD ──
    checkPageBreak(30);
    y = Math.max(y + 12, pageHeight - 38);

    const sigWidth = 65;
    const sig1X = margin + 15;
    const sig2X = margin + contentWidth - sigWidth - 15;

    // Firma Empleado
    doc.setDrawColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.setLineWidth(0.4);
    doc.line(sig1X, y, sig1X + sigWidth, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2]);
    const empName = employee.nombre || 'Empleado';
    doc.text(empName, sig1X + (sigWidth - doc.getTextWidth(empName)) / 2, y + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    const empRole = `Firma del Empleado · C.I. ${employee.cedula || 'N/A'}`;
    doc.text(empRole, sig1X + (sigWidth - doc.getTextWidth(empRole)) / 2, y + 8);

    // Firma Administración
    doc.line(sig2X, y, sig2X + sigWidth, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2]);
    const admName = 'Administración / Gerencia';
    doc.text(admName, sig2X + (sigWidth - doc.getTextWidth(admName)) / 2, y + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    const admRole = 'Donde Juancho POS';
    doc.text(admRole, sig2X + (sigWidth - doc.getTextWidth(admRole)) / 2, y + 8);

    // Pie de página final
    drawFooter();

    // Guardar / Descargar PDF
    const safeName = (employee.nombre || 'Empleado').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Consumos_${safeName}_${summary?.periodoId || 'Semanal'}.pdf`;
    doc.save(filename);
}
