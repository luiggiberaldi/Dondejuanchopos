import { procesarImpactoCliente } from './financialLogic';
import { CurrencyService } from '../services/CurrencyService';
import { divR, mulR, round2 } from './dinero';

export function buildSupervisorCustomerTransaction({
    customer, type, amount, currency, bcvRate, tasaCop = 0, copEnabled = false,
    paymentMethod = null, actor = {}, commandId, recordId, timestamp = new Date().toISOString(),
    isExplicitHighAmount = false,
}) {
    if (!customer?.id) throw new Error('Cliente inválido.');
    if (!['ABONO', 'CREDITO'].includes(type)) throw new Error('Tipo de operación inválido.');
    if (!['USD', 'BS', 'COP'].includes(currency)) throw new Error('Moneda inválida.');
    const rawAmount = CurrencyService.safeParse(amount);
    const rate = CurrencyService.safeParse(bcvRate);
    const copRate = CurrencyService.safeParse(tasaCop);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) throw new Error('El monto debe ser mayor que cero.');
    if (rate <= 0) throw new Error('La tasa BCV no está configurada.');
    if (currency === 'COP' && (!copEnabled || copRate <= 0)) throw new Error('La tasa COP no está configurada.');
    if (type === 'ABONO' && !paymentMethod) throw new Error('Selecciona un método de pago.');
    if (!commandId || !recordId) throw new Error('No se pudo asignar un identificador al movimiento.');

    const amountUsd = round2(currency === 'BS' ? divR(rawAmount, rate)
        : currency === 'COP' ? divR(rawAmount, copRate) : rawAmount);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error('El equivalente en USD no es válido.');
    const before = procesarImpactoCliente(customer, {});
    const after = procesarImpactoCliente(before, type === 'ABONO'
        ? { costoTotal: 0, pagoReal: amountUsd, vueltoParaMonedero: amountUsd }
        : { esCredito: true, deudaGenerada: amountUsd });
    if ((amountUsd > 1000 || Number(after.deuda) > 2500 || Number(after.favor) > 300) && isExplicitHighAmount !== true) {
        throw new Error('El movimiento o saldo supera el límite de seguridad; requiere confirmación explícita.');
    }

    const isCredit = type === 'CREDITO';
    const name = String(customer.name || customer.nombre || 'Cliente');
    const record = {
        id: recordId,
        customerTransactionId: commandId,
        customerTransactionType: type,
        customerTransactionRawAmount: rawAmount,
        customerTransactionCurrency: currency,
        timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        usuarioId: actor.id || null,
        usuarioNombre: actor.nombre || 'Supervisor',
        usuarioRol: actor.rol || 'SUPERVISOR',
        actor: { id: actor.id || null, nombre: actor.nombre || 'Supervisor', rol: actor.rol || 'SUPERVISOR' },
        deviceId: actor.deviceId || null,
        tipo: isCredit ? 'VENTA_FIADA' : 'COBRO_DEUDA',
        status: 'COMPLETADA',
        clienteId: customer.id,
        clienteName: name,
        customerId: customer.id,
        customerName: name,
        rate,
        totalUsd: amountUsd,
        totalBs: currency === 'BS' ? rawAmount : mulR(amountUsd, rate),
        ...(currency === 'COP' ? { totalCop: rawAmount } : {}),
        ...(isCredit ? { fiadoUsd: amountUsd, vueltoParaMonedero: 0 } : {
            paymentMethod,
            payments: [{ methodId: paymentMethod, amount: rawAmount, currency, amountUsd,
                amountBs: currency === 'BS' ? rawAmount : mulR(amountUsd, rate), methodLabel: String(paymentMethod).replace('_', ' ') }],
            vueltoParaMonedero: amountUsd,
        }),
        items: [{ name: isCredit ? `Crédito manual: ${name}` : `Abono de deuda: ${name}`,
            qty: 1, priceUsd: amountUsd, costBs: 0 }],
    };

    return {
        action: 'register_customer_payment',
        commandId,
        operationId: commandId,
        customerId: customer.id,
        customerCode: customer.code || null,
        transactionType: type,
        currency,
        rawAmount,
        amountUsd,
        bcvRate: rate,
        tasaCop: currency === 'COP' ? copRate : null,
        paymentMethod,
        record,
        supervisorId: actor.id || null,
        supervisorName: actor.nombre || 'Supervisor',
        supervisorRole: actor.rol || 'SUPERVISOR',
        isExplicitHighAmount: isExplicitHighAmount === true,
    };
}

export function applySupervisorCustomerTransaction(customer, payload) {
    if (!customer || !payload || !['ABONO', 'CREDITO'].includes(payload.transactionType)) {
        throw new Error('Datos de transacción inválidos.');
    }
    const amount = Number(payload.amountUsd);
    if (!Number.isFinite(amount) || amount <= 0 || (amount > 1000 && payload.isExplicitHighAmount !== true)) {
        throw new Error('Monto de transacción inválido.');
    }
    const updated = procesarImpactoCliente(customer, payload.transactionType === 'ABONO'
        ? { costoTotal: 0, pagoReal: amount, vueltoParaMonedero: amount }
        : { esCredito: true, deudaGenerada: amount });
    if ((Number(updated.deuda) > 2500 || Number(updated.favor) > 300) && payload.isExplicitHighAmount !== true) {
        throw new Error('El saldo resultante supera el límite de seguridad.');
    }
    return updated;
}
