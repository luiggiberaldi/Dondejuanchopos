import { formatBs, formatVzlaPhone, formatCop } from './calculatorUtils';
import { round2, round3, mulR } from './dinero';
import { getChangeLedger, getChangeDisplayParts } from './changeLedger';

/**
 * dashboardActions.js — Acciones del dashboard (compartir venta por WhatsApp).
 *
 * Migrado a dinero.js (deuda técnica detectada por guardrail ESLint):
 *   - `parseFloat(v).toFixed(2)` → `round2(v)` + template string
 *   - `item.qty.toFixed(3)` (peso en kg) → `round3(item.qty)` + template string
 *   - `item.priceUsd * item.qty` → `mulR(item.priceUsd, item.qty)`
 *   - `(sale.totalUsd || 0) * sale.tasaCop` → `mulR(sale.totalUsd || 0, sale.tasaCop)`
 *   - `sale.fiadoUsd * bcvRate` → `mulR(sale.fiadoUsd, bcvRate)`
 */

export function shareSaleWhatsApp(sale, saleCustomer, bcvRate) {
    const changeLedger = getChangeLedger(sale, bcvRate);
    const isCop = sale.copEnabled && sale.tasaCop > 0;
    // Display de USD: round2 + template (no toFixed).
    const fmtUsd = (v) => isCop ? `USD ${round2(v)}` : `$${round2(v)}`;
    const formatChangeDisplayPart = ({ currency, amount }) => {
        if (currency === 'BS') return `Bs ${formatBs(amount)}`;
        if (currency === 'COP') return `COP ${formatCop(amount)}`;
        return fmtUsd(amount);
    };
    const formatPhysicalChange = (part) => getChangeDisplayParts(part, { physical: true })
        .map(formatChangeDisplayPart)
        .join(' + ') || '$0.00';
    const formatDestinationAmount = (part) => getChangeDisplayParts(part)
        .map(formatChangeDisplayPart)
        .join(' · ') || '$0.00';
    let text = `*COMPROBANTE DE VENTA | DONDE JUANCHO*\n`;
    text += `--------------------------------\n`;
    text += `*Orden:* #${sale.id.substring(0, 6).toUpperCase()}\n`;
    text += `Cliente: ${sale.customerName || 'Consumidor Final'}\n`;
    text += `Fecha: ${new Date(sale.timestamp).toLocaleString('es-VE')}\n`;
    text += `===================================\n\n`;
    text += `*DETALLE DE PRODUCTOS:*\n`;

    if (sale.items && sale.items.length > 0) {
        sale.items.forEach(item => {
            // Cantidad: peso usa 3 decimales (round3), unidad es entero.
            const qty = item.isWeight ? `${round3(item.qty)}Kg` : `${item.qty} Und`;
            // Subtotal línea: mulR para evitar drift.
            const lineTotal = mulR(item.priceUsd, item.qty);
            text += `- ${item.name}\n  ${qty} x ${fmtUsd(item.priceUsd)} = *${fmtUsd(lineTotal)}*\n`;
        });
        text += `\n===================================\n`;
    }

    text += `*TOTAL: ${fmtUsd(sale.totalUsd || 0)}*\n`;
    text += ` Ref: ${formatBs(sale.totalBs || 0)} Bs a ${formatBs(sale.rate || bcvRate)} Bs/${isCop ? 'USD' : '$'}\n`;
    if (isCop) {
        // COP: mulR para conversión (tasaCop puede ser grande, drift significativo).
        const totalCop = mulR(sale.totalUsd || 0, sale.tasaCop);
        text += ` COP: ${formatCop(totalCop)} COP\n`;
    }

    if (changeLedger.delivered.usd > 0.009 || changeLedger.delivered.bs > 0.009 || changeLedger.delivered.cop > 0.009) {
        text += `\n*VUELTO ENTREGADO:* ${formatPhysicalChange(changeLedger.delivered)}\n`;
    }
    if (changeLedger.wallet.usd > 0.009 || changeLedger.wallet.bs > 0.009) {
        text += `*ABONO A CUENTA:* ${formatDestinationAmount(changeLedger.wallet)}\n`;
    }
    if (changeLedger.owed.usd > 0.009 || changeLedger.owed.bs > 0.009) {
        const methodNames = {
            pago_movil: 'Pago Móvil',
            zelle: 'Zelle',
            transferencia: 'Transferencia',
            efectivo_externo: 'Efectivo Externo',
            otro: 'Otro'
        };
        const mName = methodNames[changeLedger.owed.method] || changeLedger.owed.method || 'Por Fuera';
        text += `*VUELTO POR FUERA (${mName.toUpperCase()}):* ${formatDestinationAmount(changeLedger.owed)}\n`;
        if (changeLedger.owed.reference) {
            text += `  Nota/Referencia: ${changeLedger.owed.reference}\n`;
        }
    }
    if (changeLedger.voucher.usd > 0.009 || changeLedger.voucher.bs > 0.009) {
        text += `*VOUCHER EMITIDO:* ${formatDestinationAmount(changeLedger.voucher)} (#${changeLedger.voucher.code || 'sin código'})\n`;
    }
    if (changeLedger.donated.usd > 0.009 || changeLedger.donated.bs > 0.009) {
        text += `*VUELTO CEDIDO/DONADO:* ${formatDestinationAmount(changeLedger.donated)}\n`;
    }

    if (sale.fiadoUsd > 0) {
        text += `\n*SALDO PENDIENTE (FIADO): ${fmtUsd(sale.fiadoUsd)}*\n`;
        if (bcvRate > 0) {
            // Equivalente en Bs: mulR.
            const fiadoBs = mulR(sale.fiadoUsd, bcvRate);
            text += ` Equivalente: ${formatBs(fiadoBs)} Bs (tasa actual)\n`;
        }
    }
    text += `\n===================================\n`;
    text += `*¡Gracias por su compra!*\n\n`;
    text += `_Este documento no constituye factura fiscal. Comprobante de control interno._`;

    const encoded = encodeURIComponent(text);

    // Buscar el cliente de la venta para abrir WhatsApp directo a su número
    const phone = formatVzlaPhone(saleCustomer?.phone);
    const waUrl = phone
        ? `https://wa.me/${phone}?text=${encoded}`
        : `https://wa.me/?text=${encoded}`;
    window.open(waUrl, '_blank');
}
