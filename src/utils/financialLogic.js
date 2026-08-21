// FIN-015: Toda operación aritmética con dinero pasa por dinero.js (subR/sumR/round2).
import { round2, subR, sumR } from './dinero';

const safeCustomerAmount = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? round2(amount) : 0;
};

/**
 * Snapshot común para mostrar el estado de cuenta sin confundir `favor` con
 * `deuda`. Ambos campos son USD; `saldoFavor` se acepta solo como alias legacy.
 */
export function getCustomerBalanceSnapshot(customer) {
    const rawDeuda = Number(customer?.deuda);
    const deuda = Number.isFinite(rawDeuda) && rawDeuda > 0 ? round2(rawDeuda) : 0;
    const storedFavor = safeCustomerAmount(customer?.favor ?? customer?.saldoFavor);
    // Versiones antiguas representaban el favor como `deuda < 0`.
    const legacyFavor = Number.isFinite(rawDeuda) && rawDeuda < 0 ? round2(Math.abs(rawDeuda)) : 0;
    const favor = storedFavor > 0 ? storedFavor : legacyFavor;
    const casheaDeuda = safeCustomerAmount(customer?.casheaDeuda);

    return {
        deuda,
        favor,
        casheaDeuda,
        neto: subR(favor, deuda),
        tieneDeuda: deuda > 0.009,
        tieneFavor: favor > 0.009,
        tieneCasheaDeuda: casheaDeuda > 0.009,
    };
}

export function procesarImpactoCliente(clienteInicial, transaccion) {
    // CLONAR PARA INMUTABILIDAD y migrar en memoria el formato legacy
    // `deuda < 0` (saldo a favor) antes de aplicar la nueva operación.
    let cliente = { ...clienteInicial };
    const legacyDeuda = Number(cliente.deuda);
    if (Number.isFinite(legacyDeuda) && legacyDeuda < 0) {
        cliente.deuda = 0;
        cliente.favor = sumR(cliente.favor || 0, Math.abs(legacyDeuda));
    }

    // INPUTS INTERMEDIOS
    const { usaSaldoFavor = 0, esCredito = false, deudaGenerada = 0, vueltoParaMonedero = 0, esCashea = false } = transaccion;

    // 0. Q0: CONSUMO DE SALDO A FAVOR
    if (usaSaldoFavor > 0) {
        // FIN-015: subR garantiza 2 decimales en cada paso intermedio.
        const nuevoFavor = subR(cliente.favor || 0, usaSaldoFavor);
        cliente.favor = nuevoFavor > 0 ? nuevoFavor : 0;
    }

    // 1. Q1: GENERACIÓN DE DEUDA
    if (esCredito) {
        if (esCashea) {
            cliente.casheaDeuda = sumR(cliente.casheaDeuda || 0, deudaGenerada);
        } else {
            cliente.deuda = sumR(cliente.deuda || 0, deudaGenerada);
        }
    }

    // 2. Q2 & Q3: VUELTO (ABONO A DEUDA O MONEDERO)
    // El "vuelto" digital es lo que sobra que NO se entregó en efectivo.
    if (vueltoParaMonedero > 0) {
        const deudaActual = round2(cliente.deuda || 0);

        if (deudaActual > 0.001) {
            // PRIORITY: DEBT FIRST
            if (deudaActual >= vueltoParaMonedero) {
                // Paga parte de la deuda
                const restante = subR(deudaActual, vueltoParaMonedero);
                // Si el restante es <= 0.015 (diferencia de redondeo por tasa/céntimo), saldar a 0
                cliente.deuda = restante <= 0.015 ? 0 : restante;
                // Nada al favor real, todo se consumió en deuda
            } else {
                // Paga toda la deuda y sobra
                const sobra = subR(vueltoParaMonedero, deudaActual);
                cliente.deuda = 0;
                cliente.favor = sumR(cliente.favor || 0, sobra <= 0.015 ? 0 : sobra); // Q3
            }
        } else {
            // No deuda, todo a favor
            cliente.favor = sumR(cliente.favor || 0, vueltoParaMonedero);
        }
    }

    // 3. NORMALIZACIÓN ESTRICTA (The Golden Rule)
    const saldoNeto = subR(cliente.favor || 0, cliente.deuda || 0);

    if (saldoNeto >= 0) {
        cliente.favor = round2(saldoNeto);
        cliente.deuda = 0;
    } else {
        const debtVal = round2(Math.abs(saldoNeto));
        cliente.favor = 0;
        cliente.deuda = debtVal <= 0.015 ? 0 : debtVal;
    }

    return cliente;
}
