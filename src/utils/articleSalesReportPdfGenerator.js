import { jsPDF } from 'jspdf';
import { formatBs, formatUsd } from './calculatorUtils';

/**
 * Genera y descarga un informe en PDF de Ventas por Artículo y Categoría.
 * Layout corporativo limpio con logo oficial sin solapamiento de textos.
 * 
 * @param {Object} opts
 * @param {Object} opts.reportData - Resultado de calculateArticleSalesReport ({ rows, totals, categorySummary })
 * @param {string} opts.from - Fecha inicio ISO (YYYY-MM-DD)
 * @param {string} opts.to - Fecha fin ISO (YYYY-MM-DD)
 * @param {Object} opts.filters - Filtros aplicados ({ selectedCategories, selectedProductIds, search })
 * @param {number} opts.bcvRate - Tasa de cambio BCV
 */
export async function generateArticleSalesReportPDF({
    reportData,
    from,
    to,
    filters = {},
    bcvRate = 0,
}) {
    let { rows = [], totals = {}, categorySummary = [] } = reportData || {};

    // Si hay artículos seleccionados específicamente, filtrar y recalcular totales
    if (filters.selectedArticleIds && filters.selectedArticleIds.length > 0) {
        const selectedSet = new Set(filters.selectedArticleIds);
        rows = rows.filter(r => selectedSet.has(r.id) || selectedSet.has(r.sku));

        const totalQty = rows.reduce((acc, r) => acc + (r.qty || 0), 0);
        const totalRevenueUsd = rows.reduce((acc, r) => acc + (r.revenueUsd || 0), 0);

        // Recalcular participación % para los seleccionados
        rows = rows.map(r => ({
            ...r,
            share: totalRevenueUsd > 0 ? ((r.revenueUsd / totalRevenueUsd) * 100).toFixed(1) : '0.0'
        }));

        totals = {
            itemCount: rows.length,
            totalQty,
            totalRevenueUsd,
        };
    }

    // Recalcular el resumen por categoría estrictamente sobre los artículos activos
    const catMap = new Map();
    rows.forEach(r => {
        const cat = r.category || 'Sin Categoría';
        if (!catMap.has(cat)) {
            catMap.set(cat, { category: cat, qty: 0, revenueUsd: 0 });
        }
        const entry = catMap.get(cat);
        entry.qty += r.qty || 0;
        entry.revenueUsd += r.revenueUsd || 0;
    });
    categorySummary = Array.from(catMap.values()).sort((a, b) => b.revenueUsd - a.revenueUsd);

    // 1. Precargar la imagen del logo en base64 o local
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

    // Paleta de colores
    const COLOR_BRAND = [25, 50, 117];       // #193275 Azul marca
    const COLOR_TEXT = [33, 37, 41];         // #212529 Texto principal
    const COLOR_MUTED = [108, 117, 125];     // #6C757D Muted
    const COLOR_BG_HEADER = [241, 245, 249]; // #F1F5F9 Slate-100
    const COLOR_BG_ZEBRA = [248, 250, 252];  // #F8FAFC Slate-50
    const COLOR_LINE = [226, 232, 240];      // #E2E8F0 Slate-200

    let y = margin;

    // Helper de paginación
    const checkPageBreak = (needed = 12) => {
        if (y + needed > pageHeight - 18) {
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

        let logoW = 0;
        let logoH = 0;

        // Logo oficial o texto de fallback
        if (imgLogo) {
            const originalW = imgLogo.naturalWidth || imgLogo.width || 1;
            const originalH = imgLogo.naturalHeight || imgLogo.height || 1;
            const aspectRatio = originalW / originalH;
            
            // Limitar dimensiones del logo para que encaje limpiamente
            logoH = 16;
            logoW = logoH * aspectRatio;
            if (logoW > 45) {
                logoW = 45;
                logoH = logoW / aspectRatio;
            }

            doc.addImage(imgLogo, 'PNG', margin, y, logoW, logoH);
        } else {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(14);
            doc.setTextColor(COLOR_BRAND[0], COLOR_BRAND[1], COLOR_BRAND[2]);
            doc.text('Donde Juancho POS', margin, y + 8);
            logoW = 40;
            logoH = 10;
        }

        // Posición X donde comienza el texto a la derecha del logo
        const textStartX = margin + logoW + 5;

        // Título Principal a la derecha del logo (sin superposición)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(COLOR_BRAND[0], COLOR_BRAND[1], COLOR_BRAND[2]);
        doc.text('REPORTE DE VENTAS POR ARTÍCULO Y CATEGORÍA', textStartX, y + 5);

        // Subtítulo de Metadatos y Filtros
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);

        const rangeStr = from === to ? `Fecha: ${from}` : `Período: ${from} al ${to}`;
        const catStr = filters.selectedCategories?.length > 0
            ? `Categorías: ${filters.selectedCategories.join(', ')}`
            : 'Categorías: Todas';
        const selectionStr = filters.selectedArticleIds?.length > 0
            ? `Selección: ${filters.selectedArticleIds.length} art. seleccionados`
            : null;
        const rateStr = bcvRate > 0 ? `Tasa Aplicada: ${bcvRate.toFixed(2)} Bs/$` : '';

        const metaLine1 = selectionStr ? `${rangeStr}   |   ${selectionStr}` : `${rangeStr}   |   ${catStr}`;
        doc.text(metaLine1, textStartX, y + 10);
        if (rateStr) {
            doc.text(rateStr, textStartX, y + 14);
        }

        // Emisión y fecha en esquina superior derecha
        const nowStr = new Date().toLocaleString('es-VE');
        doc.setFontSize(7.5);
        doc.text(`Emitido: ${nowStr}`, pageWidth - margin, y + 4, { align: 'right' });

        // Ajustar 'y' dinámicamente debajo de toda la cabecera
        const headerHeight = Math.max(logoH + 3, 16);
        y += headerHeight + 3;

        // Línea divisoria
        doc.setDrawColor(COLOR_LINE[0], COLOR_LINE[1], COLOR_LINE[2]);
        doc.setLineWidth(0.4);
        doc.line(margin, y, pageWidth - margin, y);
        y += 5;
    };

    const drawFooter = () => {
        const totalPages = doc.internal.getNumberOfPages();
        const currentPage = doc.internal.getCurrentPageInfo().pageNumber;

        doc.setDrawColor(COLOR_LINE[0], COLOR_LINE[1], COLOR_LINE[2]);
        doc.setLineWidth(0.3);
        doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
        doc.text('Donde Juancho POS — Sistema de Gestión Comercial', margin, pageHeight - 7);
        doc.text(`Página ${currentPage} de ${totalPages}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
    };

    // 1. Dibujar Encabezado Inicial
    drawHeader(false);

    // 2. Dibujar Tarjeta Resumen
    doc.setFillColor(COLOR_BG_HEADER[0], COLOR_BG_HEADER[1], COLOR_BG_HEADER[2]);
    doc.roundedRect(margin, y, contentWidth, 18, 2, 2, 'F');

    const colWidth = contentWidth / 4;
    const metrics = [
        { label: 'ARTÍCULOS DISTINTOS', val: `${totals.itemCount || 0}` },
        { label: 'UNIDADES VENDIDAS', val: `${totals.totalQty || 0} uds.` },
        { label: 'TOTAL RECAUDADO ($)', val: `$${formatUsd(totals.totalRevenueUsd || 0)}` },
        { label: 'TOTAL RECAUDADO (Bs)', val: `Bs. ${formatBs((totals.totalRevenueUsd || 0) * (bcvRate || 1))}` },
    ];

    metrics.forEach((m, idx) => {
        const xPos = margin + idx * colWidth + colWidth / 2;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
        doc.text(m.label, xPos, y + 6, { align: 'center' });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(COLOR_BRAND[0], COLOR_BRAND[1], COLOR_BRAND[2]);
        doc.text(m.val, xPos, y + 13, { align: 'center' });
    });

    y += 24;

    // 3. Resumen Rápido por Categorías (Solo si la selección abarca más de 1 categoría)
    if (categorySummary.length > 1) {
        checkPageBreak(30);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2]);
        doc.text('RESUMEN POR CATEGORÍA', margin, y);
        y += 4;

        // Tabla de Categorías
        const catCols = [
            { header: 'Categoría', width: 90, align: 'left' },
            { header: 'Uds. Vendidas', width: 45, align: 'right' },
            { header: 'Total ($)', width: 45, align: 'right' },
        ];

        doc.setFillColor(COLOR_BRAND[0], COLOR_BRAND[1], COLOR_BRAND[2]);
        doc.rect(margin, y, contentWidth, 6, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(255, 255, 255);

        let currX = margin + 3;
        catCols.forEach(c => {
            const alignX = c.align === 'right' ? currX + c.width - 6 : currX;
            doc.text(c.header, alignX, y + 4.2, { align: c.align });
            currX += c.width;
        });

        y += 6;

        categorySummary.forEach((cat, i) => {
            checkPageBreak(6);
            if (i % 2 === 1) {
                doc.setFillColor(COLOR_BG_ZEBRA[0], COLOR_BG_ZEBRA[1], COLOR_BG_ZEBRA[2]);
                doc.rect(margin, y, contentWidth, 5.5, 'F');
            }
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2]);

            doc.text(cat.category, margin + 3, y + 4);
            doc.text(`${cat.qty} uds.`, margin + 90 + 45 - 6, y + 4, { align: 'right' });
            doc.text(`$${formatUsd(cat.revenueUsd)}`, margin + 90 + 45 + 45 - 6, y + 4, { align: 'right' });

            y += 5.5;
        });

        y += 6;
    }

    // 4. Tabla Detallada por Artículos con Desglose de Empaque
    checkPageBreak(30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2]);
    doc.text('DETALLE INDIVIDUAL DE ARTÍCULOS', margin, y);
    y += 5;

    // Configuración de columnas
    const tableCols = [
        { header: '#', width: 8, align: 'center' },
        { header: 'Código / SKU', width: 26, align: 'left' },
        { header: 'Producto', width: 52, align: 'left' },
        { header: 'Categoría', width: 30, align: 'left' },
        { header: 'Cant. Vendida (Empaque)', width: 32, align: 'right' },
        { header: 'P. Prom ($)', width: 19, align: 'right' },
        { header: 'Total ($)', width: 20, align: 'right' },
    ];

    // Encabezado Tabla Principal
    doc.setFillColor(COLOR_BRAND[0], COLOR_BRAND[1], COLOR_BRAND[2]);
    doc.rect(margin, y, contentWidth, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);

    let xCursor = margin;
    tableCols.forEach(col => {
        let posX = xCursor;
        if (col.align === 'right') posX = xCursor + col.width - 2;
        if (col.align === 'center') posX = xCursor + col.width / 2;
        doc.text(col.header, posX, y + 4.8, { align: col.align });
        xCursor += col.width;
    });

    y += 7;

    // Filas de Artículos
    if (rows.length === 0) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(9);
        doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
        doc.text('No se encontraron registros de ventas para el filtro seleccionado.', pageWidth / 2, y + 8, { align: 'center' });
        y += 15;
    } else {
        rows.forEach((row, index) => {
            const hasPack = row.packInfo && row.packInfo.hasPack;
            const rowHeight = hasPack ? 9.5 : 6.5;

            checkPageBreak(rowHeight);

            if (index % 2 === 1) {
                doc.setFillColor(COLOR_BG_ZEBRA[0], COLOR_BG_ZEBRA[1], COLOR_BG_ZEBRA[2]);
                doc.rect(margin, y, contentWidth, rowHeight, 'F');
            }

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2]);

            let colX = margin;

            // #
            doc.text(`${index + 1}`, colX + tableCols[0].width / 2, y + 4.2, { align: 'center' });
            colX += tableCols[0].width;

            // SKU
            const skuText = doc.splitTextToSize(row.sku || 'N/A', tableCols[1].width - 2);
            doc.text(skuText[0] || 'N/A', colX + 1, y + 4.2);
            colX += tableCols[1].width;

            // Producto
            const prodText = doc.splitTextToSize(row.name || '', tableCols[2].width - 2);
            doc.text(prodText[0] || '', colX + 1, y + 4.2);
            colX += tableCols[2].width;

            // Categoría
            const catText = doc.splitTextToSize(row.category || '', tableCols[3].width - 2);
            doc.text(catText[0] || '', colX + 1, y + 4.2);
            colX += tableCols[3].width;

            // Cantidad + Desglose de empaque (ej. 1348 uds \n (37.44 cajas))
            doc.setFont('helvetica', 'bold');
            doc.text(`${row.qty} uds.`, colX + tableCols[4].width - 2, y + 4.2, { align: 'right' });

            if (hasPack) {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7);
                doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
                doc.text(row.packInfo.text, colX + tableCols[4].width - 2, y + 7.8, { align: 'right' });
                // Reset font size
                doc.setFontSize(8);
                doc.setTextColor(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2]);
            }
            colX += tableCols[4].width;

            // Precio Promedio
            doc.setFont('helvetica', 'normal');
            doc.text(`$${formatUsd(row.avgPriceUsd)}`, colX + tableCols[5].width - 2, y + 4.2, { align: 'right' });
            colX += tableCols[5].width;

            // Total USD
            doc.setFont('helvetica', 'bold');
            doc.text(`$${formatUsd(row.revenueUsd)}`, colX + tableCols[6].width - 2, y + 4.2, { align: 'right' });

            y += rowHeight;
        });

        // Fila Gran Total al final
        checkPageBreak(8);
        doc.setFillColor(COLOR_BG_HEADER[0], COLOR_BG_HEADER[1], COLOR_BG_HEADER[2]);
        doc.rect(margin, y, contentWidth, 7, 'F');
        doc.setDrawColor(COLOR_BRAND[0], COLOR_BRAND[1], COLOR_BRAND[2]);
        doc.setLineWidth(0.4);
        doc.line(margin, y, pageWidth - margin, y);
        doc.line(margin, y + 7, pageWidth - margin, y + 7);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(COLOR_BRAND[0], COLOR_BRAND[1], COLOR_BRAND[2]);

        doc.text('TOTAL GENERAL', margin + 3, y + 4.8);
        doc.text(`${totals.totalQty || 0} uds.`, margin + 118 + 32 - 2, y + 4.8, { align: 'right' });
        doc.text(`$${formatUsd(totals.totalRevenueUsd || 0)}`, pageWidth - margin - 2, y + 4.8, { align: 'right' });

        y += 10;
    }

    // Pie de página
    drawFooter();

    // Guardar/Descargar PDF
    const filename = `Reporte_Ventas_Articulos_${from}_al_${to}.pdf`;
    doc.save(filename);
}
