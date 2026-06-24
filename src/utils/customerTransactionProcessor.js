import { storageService } from './storageService';
import { procesarImpactoCliente } from './financialLogic';
import { divR, mulR } from './dinero';
import { withLock } from './withLock';      // FIN-006: lock para escrituras de customer/sales.
import { deepFreeze } from './deepFreeze';  // FIN-008: deep-freeze antes de retornar.
import { CurrencyService } from '../services/CurrencyService'; // FIN-017-pattern: safeParse en vez de parseFloat.

/**
 * Procesa la lógica de abonar o endeudar a un cliente desde el TransactionModal.
 * Guarda en `bodega_customers_v1` y añade un registro en `bodega_sales_v1`.
 *
 * FIN-006: Toda escritura a sales/customers ahora va dentro de withLock('pos_write_lock').
 * FIN-012: cobroRecord/fiadoRecord guardan vueltoParaMonedero para revertir al anular.
 */
export async function processCustomerTransaction({
    transactionAmount,
    currencyMode,
    type,
    customer,
    paymentMethod,
    bcvRate,
    tasaCop,
    copEnabled
}) {
    // 1. Convert to float and USD
    const rawAmount = CurrencyService.safeParse(transactionAmount);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
        return { error: 'Monto inválido' };
    }
    let amountUsd = rawAmount;
    if (currencyMode === 'BS' && bcvRate > 0) amountUsd = divR(rawAmount, bcvRate);
    if (currencyMode === 'COP') {
        if (!tasaCop || tasaCop <= 0) return { error: 'Tasa COP no configurada' };
        amountUsd = divR(rawAmount, tasaCop);
    }

    // 2. Financial quadrant logic
    let transaccionOpts = {};
    let vueltoParaMonedero = 0; // FIN-012: para persistir en el sale record.
    if (type === 'ABONO') {
        transaccionOpts = { costoTotal: 0, pagoReal: amountUsd, vueltoParaMonedero: amountUsd };
        vueltoParaMonedero = amountUsd;
    } else if (type === 'CREDITO') {
        transaccionOpts = { esCredito: true, deudaGenerada: amountUsd };
    }

    // FIN-006: envolver TODO el read-modify-write en withLock para evitar race conditions.
    const result = await withLock('pos_write_lock', async () => {
        const updatedCustomer = procesarImpactoCliente(customer, transaccionOpts);

        // 3. Update customer storage
        const customers = await storageService.getItem('bodega_customers_v1', []);
        const newCustomers = customers.map(c => c.id === customer.id ? updatedCustomer : c);
        await storageService.setItem('bodega_customers_v1', newCustomers);

        // 4. Update sales storage
        const sales = await storageService.getItem('bodega_sales_v1', []);
        const nextSaleNumber = sales.reduce((mx, s) => Math.max(mx, s.saleNumber || 0), 0) + 1;
        const totalEnBs = currencyMode === 'BS' ? rawAmount : mulR(amountUsd, bcvRate);
        const totalEnUsd = amountUsd;
        const totalEnCop = currencyMode === 'COP' ? rawAmount : mulR(amountUsd, tasaCop);

        if (type === 'ABONO') {
            const cobroRecord = {
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                tipo: 'COBRO_DEUDA',
                saleNumber: nextSaleNumber,
                rate: bcvRate,
                status: 'COMPLETADA',
                clienteId: customer.id,
                clienteName: customer.name,
                totalBs: totalEnBs,
                totalUsd: totalEnUsd,
                ...(copEnabled && { totalCop: totalEnCop }),
                paymentMethod: paymentMethod, // Legacy keep just in case
                payments: [{
                    methodId: paymentMethod,
                    amount: currencyMode === 'USD' ? totalEnUsd : (currencyMode === 'COP' ? totalEnCop : totalEnBs),
                    currency: currencyMode,
                    amountUsd: totalEnUsd,
                    amountBs: totalEnBs,
                    methodLabel: paymentMethod.replace('_', ' ')
                }],
                // FIN-012: persistir vueltoParaMonedero para revertir correctamente al anular.
                vueltoParaMonedero: vueltoParaMonedero,
                customerId: customer.id,
                customerName: customer.name,
                items: [{ name: `Abono de deuda: ${customer.name}`, qty: 1, priceUsd: totalEnUsd, costBs: 0 }]
            };
            sales.unshift(cobroRecord);
        } else if (type === 'CREDITO') {
            const fiadoRecord = {
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                tipo: 'VENTA_FIADA',
                saleNumber: nextSaleNumber,
                rate: bcvRate,
                status: 'COMPLETADA',
                clienteId: customer.id,
                clienteName: customer.name,
                totalBs: totalEnBs,
                totalUsd: totalEnUsd,
                ...(copEnabled && { totalCop: totalEnCop }),
                fiadoUsd: totalEnUsd,
                vueltoParaMonedero: 0,
                customerId: customer.id,
                customerName: customer.name,
                items: [{ name: `Credito manual: ${customer.name}`, qty: 1, priceUsd: totalEnUsd, costBs: 0 }]
            };
            sales.unshift(fiadoRecord);
        }

        await storageService.setItem('bodega_sales_v1', sales);

        // FIN-008: deep-freeze customers antes de retornar.
        deepFreeze(newCustomers);

        return { updatedCustomer, newCustomers };
    });

    return result;
}
