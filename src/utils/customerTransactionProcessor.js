import { storageService } from './storageService';
import { procesarImpactoCliente } from './financialLogic';
import { divR, mulR } from './dinero';
import { withLock } from './withLock';      // FIN-006: lock para escrituras de customer/sales.
import { deepFreeze } from './deepFreeze';  // FIN-008: deep-freeze antes de retornar.
import { CurrencyService } from '../services/CurrencyService'; // FIN-017-pattern: safeParse en vez de parseFloat.
import { logEvent } from '../services/auditService';
import { useAuthStore } from '../hooks/store/useAuthStore';

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
    copEnabled,
    activePaymentMethods = [],
    isFullPayment = false
}) {
    if (!customer?.id) return { error: 'Cliente inválido' };
    if (!['ABONO', 'CREDITO'].includes(type)) return { error: 'Tipo de operación inválido' };
    if (!['USD', 'BS', 'COP'].includes(currencyMode)) return { error: 'Moneda inválida' };

    if (Array.isArray(activePaymentMethods) && activePaymentMethods.length > 0) {
        const validMethod = activePaymentMethods.some(method => (
            method.id === paymentMethod
            && method.currency === currencyMode
            && method.isEnabled !== false
        ));
        if (!validMethod) return { error: 'Método de pago no disponible para esa moneda' };
    }

    // 1. Convert to float and USD. Toda operación de cuenta necesita una tasa
    // válida para dejar una equivalencia Bs auditable; nunca tratar Bs como USD
    // si la tasa falta.
    const rawAmount = CurrencyService.safeParse(transactionAmount);
    const safeBcvRate = CurrencyService.safeParse(bcvRate);
    const safeTasaCop = CurrencyService.safeParse(tasaCop);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
        return { error: 'Monto inválido' };
    }
    if (safeBcvRate <= 0) return { error: 'Tasa BCV no configurada' };
    let amountUsd = rawAmount;
    if (currencyMode === 'BS') amountUsd = divR(rawAmount, safeBcvRate);
    if (currencyMode === 'COP') {
        if (!copEnabled || safeTasaCop <= 0) return { error: 'Tasa COP no configurada' };
        amountUsd = divR(rawAmount, safeTasaCop);
    }

    // 2. Financial quadrant logic
    let transaccionOpts = {};
    let vueltoParaMonedero = 0; // FIN-012: para persistir en el sale record.
    if (type === 'ABONO') {
        const currentDeuda = Number(customer?.deuda) || 0;
        // Si el usuario indicó pago total o el monto cubre la deuda dentro de una tolerancia de 2 céntimos (redondeo de tasa)
        if (currentDeuda > 0 && (isFullPayment || Math.abs(amountUsd - currentDeuda) <= 0.02)) {
            amountUsd = currentDeuda;
        }
        transaccionOpts = { costoTotal: 0, pagoReal: amountUsd, vueltoParaMonedero: amountUsd };
        vueltoParaMonedero = amountUsd;
    } else if (type === 'CREDITO') {
        transaccionOpts = { esCredito: true, deudaGenerada: amountUsd };
    }

    const activeUser = useAuthStore.getState().usuarioActivo;
    const actorName = activeUser?.nombre || activeUser?.usuario || 'Sistema';
    const transactionTimestamp = new Date().toISOString();
    const deviceId = typeof localStorage !== 'undefined'
        ? localStorage.getItem('dj_device_id') || 'CAJA_PRINCIPAL'
        : 'CAJA_PRINCIPAL';

    // FIN-006: envolver TODO el read-modify-write en withLock para evitar race conditions.
    const result = await withLock('pos_write_lock', async () => {
        // 3. Update customer storage from the fresh snapshot. El parámetro
        // `customer` puede venir de una vista atrasada si hubo dos abonos
        // consecutivos; calcular sobre el snapshot dentro del lock evita perder
        // el primer movimiento.
        const customers = await storageService.getItem('bodega_customers_v1', []);
        const currentCustomer = customers.length === 0
            ? customer
            : customers.find(c => c.id === customer.id);
        if (!currentCustomer) return { error: 'El cliente ya no está disponible' };
        const updatedCustomer = procesarImpactoCliente(currentCustomer, transaccionOpts);
        const customerRecords = customers.length === 0 ? [customer] : customers;
        const newCustomers = customerRecords.map(c => c.id === customer.id ? updatedCustomer : c);
        await storageService.setItem('bodega_customers_v1', newCustomers);

        // 4. Update sales storage
        const sales = await storageService.getItem('bodega_sales_v1', []);
        const nextSaleNumber = sales.reduce((mx, s) => Math.max(mx, s.saleNumber || 0), 0) + 1;
        const totalEnBs = currencyMode === 'BS' ? rawAmount : mulR(amountUsd, safeBcvRate);
        const totalEnUsd = amountUsd;
        const totalEnCop = currencyMode === 'COP' ? rawAmount : mulR(amountUsd, safeTasaCop);

        if (type === 'ABONO') {
            const cobroRecord = {
                id: crypto.randomUUID(),
                timestamp: transactionTimestamp,
                createdAt: transactionTimestamp,
                updatedAt: transactionTimestamp,
                usuarioId: activeUser?.id || null,
                usuarioNombre: actorName,
                usuarioRol: activeUser?.rol || 'SYSTEM',
                actor: { id: activeUser?.id || null, nombre: actorName, rol: activeUser?.rol || 'SYSTEM' },
                deviceId,
                tipo: 'COBRO_DEUDA',
                saleNumber: nextSaleNumber,
                rate: safeBcvRate,
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
                    methodLabel: String(paymentMethod || '').replace('_', ' ')
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
                timestamp: transactionTimestamp,
                createdAt: transactionTimestamp,
                updatedAt: transactionTimestamp,
                usuarioId: activeUser?.id || null,
                usuarioNombre: actorName,
                usuarioRol: activeUser?.rol || 'SYSTEM',
                actor: { id: activeUser?.id || null, nombre: actorName, rol: activeUser?.rol || 'SYSTEM' },
                deviceId,
                tipo: 'VENTA_FIADA',
                saleNumber: nextSaleNumber,
                rate: safeBcvRate,
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

        const savedRecord = sales[0];
        logEvent(
            'VENTA',
            type === 'ABONO' ? 'COBRO_DEUDA_REGISTRADO' : 'VENTA_FIADA_REGISTRADA',
            `${type === 'ABONO' ? 'Abono' : 'Crédito'} de $${amountUsd} para ${customer.name}`,
            activeUser,
            { saleId: savedRecord?.id || null, saleNumber: nextSaleNumber, customerId: customer.id, deviceId }
        );

        // FIN-008: deep-freeze customers antes de retornar.
        deepFreeze(newCustomers);

        return { updatedCustomer, newCustomers };
    });

    return result;
}
