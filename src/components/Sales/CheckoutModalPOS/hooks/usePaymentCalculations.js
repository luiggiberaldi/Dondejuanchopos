import { useMemo } from 'react';
import { divR, mulR, round2, subR, sumR } from '../../../../utils/dinero';
import { calculatePaymentState } from '../../../../core/CheckoutPaymentEngine';

/**
 * Proyección de cobro del POS.
 * La autoridad de la liquidación vive en CheckoutPaymentEngine; este hook solo
 * transforma el estado editable de los inputs en el contrato del motor.
 */
export const usePaymentCalculations = ({
    totalUSD,
    totalBS,
    pagos,
    tasa,
    metodosActivos,
    val,
    pagoSaldoFavor,
    casheaActive = false,
    casheaPercent = 60,
    copEnabled = false,
    tasaCop = 0,
}) => {
    const tasaSegura = tasa > 0 ? tasa : 0;
    const safeTasaCop = tasaCop > 0 ? tasaCop : 0;
    const safeTotalUSD = totalUSD > 0 ? totalUSD : 0;
    const safeTotalBS = totalBS > 0 ? totalBS : 0;

    const pagoSaldoFavorNum = useMemo(() => {
        const value = Number(pagoSaldoFavor);
        return Number.isFinite(value) && value > 0 ? round2(value) : 0;
    }, [pagoSaldoFavor]);

    const casheaAmountUsd = useMemo(() => {
        if (!casheaActive) return 0;
        return round2(mulR(safeTotalUSD, (100 - casheaPercent) / 100));
    }, [casheaActive, safeTotalUSD, casheaPercent]);

    const paymentInputs = useMemo(() => metodosActivos.map((method) => {
        const currency = method.tipo === 'BS' ? 'BS' : method.tipo === 'COP' ? 'COP' : 'USD';
        const amountInput = round2(val(method.id));
        const amountUsd = currency === 'USD'
            ? amountInput
            : currency === 'COP' && safeTasaCop > 0
                ? divR(amountInput, safeTasaCop)
                : tasaSegura > 0
                    ? divR(amountInput, tasaSegura)
                    : 0;
        const amountBs = currency === 'BS'
            ? amountInput
            : tasaSegura > 0
                ? mulR(amountUsd, tasaSegura)
                : 0;

        return {
            methodId: method.id,
            currency,
            amountInput,
            amountUsd,
            amountBs,
            isCash: method.isCash === true || method.id?.startsWith('efectivo_'),
        };
    }), [metodosActivos, pagos, val, safeTasaCop, tasaSegura]);

    const state = useMemo(() => calculatePaymentState({
        cartTotalUsd: safeTotalUSD,
        cartTotalBs: safeTotalBS,
        payments: paymentInputs.filter((payment) => payment.amountInput > 0),
        rate: tasaSegura,
        tasaCop: safeTasaCop,
        activeMethods: metodosActivos,
        saldoFavorUsd: pagoSaldoFavorNum,
        casheaUsd: casheaAmountUsd,
    }), [safeTotalUSD, safeTotalBS, paymentInputs, tasaSegura, safeTasaCop, metodosActivos, pagoSaldoFavorNum, casheaAmountUsd, copEnabled]);

    const bsPaid = sumR(paymentInputs.filter((payment) => payment.currency === 'BS').map((payment) => payment.amountInput));
    const nonBsMethodsUsd = sumR(paymentInputs
        .filter((payment) => payment.currency !== 'BS')
        .map((payment) => payment.amountUsd));
    const faltaPorPagarUsdDirect = round2(Math.max(0, subR(
        safeTotalUSD,
        sumR([nonBsMethodsUsd, tasaSegura > 0 ? divR(bsPaid, tasaSegura) : 0, casheaAmountUsd, pagoSaldoFavorNum])
    )));

    return {
        totalPagadoUSD: state.paid.usd,
        totalPagadoBS: state.paid.bs,
        totalPagadoGlobalUSD: state.paid.usd,
        faltaPorPagar: state.remaining.usd,
        faltaPorPagarBS: state.remaining.bs,
        faltaPorPagarUsdDirect,
        cambioUSD: state.regime === 'PURE_BS' && tasaSegura > 0
            ? divR(state.change.bs, tasaSegura)
            : state.change.usd,
        cambioBS: state.change.bs,
        physicalCashReceived: state.physicalCashReceived,
        paymentState: state,
        montoIGTF: 0,
        totalConIGTF: safeTotalUSD,
        totalConIGTFBS: safeTotalBS,
        tasaSegura,
        casheaAmountUsd,
    };
};
