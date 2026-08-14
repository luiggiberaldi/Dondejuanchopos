import { formatBs, formatCop, formatUsd } from '../../utils/calculatorUtils';
import { mulR } from '../../utils/dinero';
import { getChangeLedger, getChangeDisplayParts } from '../../utils/changeLedger';
import { calculatePricing } from '../../utils/productProcessor';

/**
 * Builds a WhatsApp-ready receipt URL for sharing a sale.
 * @param {object} receipt - The sale/receipt object
 * @returns {string} WhatsApp URL with pre-filled message
 */
export function buildReceiptWhatsAppUrl(receipt, currentRate) {
    const r = receipt;
    const changeLedger = getChangeLedger(r, currentRate || r.rate);
    const isCop = r.copEnabled && r.tasaCop > 0;
    const fmtUsd = (v) => isCop ? `USD ${formatUsd(v)}` : `$${formatUsd(v)}`;
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
    const fecha = new Date(r.timestamp).toLocaleDateString('es-VE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
    const saleNum = r.id?.slice(-6).toUpperCase() ?? '------';
    const sep = '================================';
    const sep2 = '--------------------------------';

    const receiptCurrencyMode = localStorage.getItem('receipt_currency_mode') || 'bs';

    // Items
    const itemsLines = (r.items ?? []).map(item => {
        const qty = item.isWeight
            ? `${parseFloat(item.qty).toFixed(3)} kg`
            : `${item.qty} und`;
        const subUsd = (item.priceUsd * item.qty).toFixed(2);
        const unitPriceUsd = parseFloat(item.priceUsd).toFixed(2);
        const { unitPriceBs } = calculatePricing(item, r.rate || 1, r.bcvRate || r.rate || 1);
        const priceBs = unitPriceBs;
        const subBs = mulR(unitPriceBs, item.qty);

        const comboBreakdown = item.modularSelections || item.selectedModularItems || item.comboItems;
        let comboSubText = '';
        if (comboBreakdown && comboBreakdown.length > 0) {
            comboSubText = '\n' + comboBreakdown.map(sub => `   └ ${sub.qty || sub.quantity || 1}x ${sub.productName || sub.name || sub.productId}`).join('\n');
        }

        if (receiptCurrencyMode === 'usd') {
            const subStr = isCop ? `USD ${subUsd}` : `$${subUsd}`;
            const unitStr = isCop ? `USD ${unitPriceUsd}` : `$${unitPriceUsd}`;
            return `- ${item.name}${comboSubText}\n  ${qty} x ${unitStr} = ${subStr}`;
        }
        
        if (receiptCurrencyMode === 'bs') {
            const subStr = `Bs ${formatBs(subBs)}`;
            const unitStr = `Bs ${formatBs(priceBs)}`;
            return `- ${item.name}${comboSubText}\n  ${qty} x ${unitStr} = ${subStr}`;
        }

        // mixto
        const subStr = isCop ? `USD ${subUsd}` : `$${subUsd}`;
        const unitStr = isCop ? `USD ${unitPriceUsd}` : `$${unitPriceUsd}`;
        let line = `- ${item.name}${comboSubText}\n  ${qty} x ${unitStr} = ${subStr}`;
        if (isCop) {
            const copSub = (item.priceUsd * item.qty * r.tasaCop).toLocaleString('es-CO', { maximumFractionDigits: 0 });
            line += ` (${copSub} COP)`;
        }
        return line;
    }).join('\n');

    // Pagos
    const paymentsLines = (r.payments ?? []).map(p => {
        const pIsCop = p.currency === 'COP';
        const isBs = p.currency === 'BS';
        const val = pIsCop
            ? `COP ${(p.amountInput ?? p.amountUsd * (r.tasaCop || 1)).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
            : isBs
            ? `Bs ${formatBs(p.amountBs ?? p.amountUsd * r.rate)}`
            : `USD ${parseFloat(p.amountUsd).toFixed(2)}`;
        return `  ${p.methodLabel}: ${val}`;
    }).join('\n');

    // Totales
    const totalBs = r.totalBs ?? (r.totalUsd * r.rate);
    const totalUsdStr = fmtUsd(r.totalUsd || 0);
    const totalBsStr = `Bs ${formatBs(totalBs)}`;
    const totalCopStr = isCop ? `  /  COP ${(r.totalCop || (r.totalUsd * r.tasaCop)).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';

    let totalLine = '';
    if (receiptCurrencyMode === 'usd') {
        totalLine = `TOTAL: ${totalUsdStr}`;
    } else if (receiptCurrencyMode === 'bs') {
        totalLine = `TOTAL: ${totalBsStr}`;
    } else {
        totalLine = `TOTAL: ${totalUsdStr}  /  ${totalBsStr}${totalCopStr}`;
    }

    // Vuelto: cada componente se imprime una sola vez y en la moneda física
    // registrada. Los equivalentes contables no se presentan como otra salida.
    const changeParts = [];
    if (changeLedger.delivered.usd > 0.009 || changeLedger.delivered.bs > 0.009 || changeLedger.delivered.cop > 0.009) {
        changeParts.push(`VUELTO ENTREGADO: ${formatPhysicalChange(changeLedger.delivered)}`);
    }
    if (changeLedger.wallet.usd > 0.009 || changeLedger.wallet.bs > 0.009) {
        changeParts.push(`ABONO A CUENTA: ${formatDestinationAmount(changeLedger.wallet)}`);
    }
    if (changeLedger.owed.usd > 0.009 || changeLedger.owed.bs > 0.009) {
        const methodNames = { pago_movil: 'PAGO MÓVIL', zelle: 'ZELLE', transferencia: 'TRANSFERENCIA', efectivo_externo: 'EFECTIVO EXTERNO', otro: 'OTRO' };
        const method = methodNames[changeLedger.owed.method] || String(changeLedger.owed.method || 'POR FUERA').toUpperCase();
        const note = changeLedger.owed.reference ? ` · Ref: ${changeLedger.owed.reference}` : '';
        changeParts.push(`VUELTO POR FUERA (${method}): ${formatDestinationAmount(changeLedger.owed)}${note}`);
    }
    if (changeLedger.voucher.usd > 0.009 || changeLedger.voucher.bs > 0.009) {
        changeParts.push(`VOUCHER EMITIDO: ${formatDestinationAmount(changeLedger.voucher)} (#${changeLedger.voucher.code || 'sin código'})`);
    }
    if (changeLedger.donated.usd > 0.009 || changeLedger.donated.bs > 0.009) {
        changeParts.push(`VUELTO CEDIDO/DONADO: ${formatDestinationAmount(changeLedger.donated)}`);
    }
    const changeLines = changeParts.length > 0 ? `\n${changeParts.join('\n')}` : '';

    // Fiado
    const fiadoRate = currentRate || r.rate || 1;
    const fiadoLine = r.fiadoUsd > 0.005
        ? receiptCurrencyMode === 'usd'
            ? `\nPENDIENTE (fiado): ${fmtUsd(r.fiadoUsd)}`
            : receiptCurrencyMode === 'bs'
            ? `\nPENDIENTE (fiado): Bs ${formatBs(r.fiadoUsd * fiadoRate)}`
            : `\nPENDIENTE (fiado): ${fmtUsd(r.fiadoUsd)} / Bs ${formatBs(r.fiadoUsd * fiadoRate)}`
        : '';

    // Cliente
    let clienteStrContent = '';
    if (r.customerName && r.customerName !== 'Consumidor Final') {
        clienteStrContent += `Cliente: ${r.customerName}\n`;
        if (r.customerDocument) {
            clienteStrContent += `Documento: ${r.customerDocument}\n`;
        }
    }
    const clienteLine = clienteStrContent;

    const bName = localStorage.getItem('business_name');
    const bRif = localStorage.getItem('business_rif');

    let headerBlocks = [];
    if (bName) {
        headerBlocks.push(`*${bName.toUpperCase()}*`);
        if (bRif) headerBlocks.push(`RIF: ${bRif}`);
        headerBlocks.push(sep2);
        headerBlocks.push(`COMPROBANTE DE VENTA`);
    } else {
        headerBlocks.push(`COMPROBANTE DE VENTA | DONDE JUANCHO`);
    }

    // Se conservan estos aliases vacíos para mantener la composición histórica
    // del mensaje; todos los destinos ya están incluidos en changeLines.
    const changeOwedLine = '';
    const changeVoucherLine = '';
    const tipDonatedLine = '';

    const text = [
        ...headerBlocks,
        sep2,
        `Orden: #${saleNum}`,
        `${clienteLine}Fecha: ${fecha}`,
        sep,
        ``,
        `DETALLE DE PRODUCTOS:`,
        itemsLines,
        ``,
        sep,
        totalLine,
        paymentsLines ? `\nPAGOS:\n${paymentsLines}` : '',
        changeLines,
        changeOwedLine,
        changeVoucherLine,
        tipDonatedLine,
        fiadoLine,
        sep,
        r.tasaCop > 0 ? `Tasa COP: ${r.tasaCop.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` : '',
        `Gracias por su compra!`,
        ``,
        `_Este documento no constituye factura fiscal. Comprobante de control interno._`,
        `Donde Juancho - Sistema POS`,
    ].filter(Boolean).join('\n');

    const formatVzlaPhone = (phone) => {
        if (!phone) return null;
        const digits = phone.replace(/\D/g, '');
        if (digits.startsWith('58')) return digits;
        if (digits.startsWith('0')) return '58' + digits.slice(1);
        return '58' + digits;
    };

    const phone = formatVzlaPhone(r.customerPhone);
    return phone
        ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
        : `https://wa.me/?text=${encodeURIComponent(text)}`;
}
