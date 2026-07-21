import { useMemo } from 'react';
import { round2, divR, mulR, subR, sumR } from '../../../../utils/dinero';
import { FINANCIAL_EPSILON } from '../../../../utils/securityConstants';
import { CurrencyService } from '../../../../services/CurrencyService';

/**
 * usePaymentCalculations — Portado de Listo POS ModalPago.
 * Usa directamente las utilidades de bodega (dinero.js, CurrencyService)
 * en lugar del FinancialController de Listo POS.
 * Añade soporte COP cuando copEnabled=true.
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
    const tasaSegura = tasa > 0 ? tasa : 1;
    const safeTasaCop = tasaCop > 0 ? tasaCop : 0;
    // Totales duales INDEPENDIENTES de la venta (USD y Bs no se derivan uno del otro).
    const safeTotalUSD = totalUSD > 0 ? totalUSD : 0;
    const safeTotalBS = totalBS > 0 ? totalBS : 0;

    // Saldo a favor (USD)
    const pagoSaldoFavorNum = useMemo(() => {
        const v = parseFloat(pagoSaldoFavor);
        return isNaN(v) || v < 0 ? 0 : v;
    }, [pagoSaldoFavor]);

    // Monto financiado por Cashea
    const casheaAmountUsd = useMemo(() => {
        if (!casheaActive) return 0;
        return round2(mulR(totalUSD, (100 - casheaPercent) / 100));
    }, [casheaActive, totalUSD, casheaPercent]);

    // ── Modelo de precios duales con DOS REGÍMENES ────────────────────────────
    // El total de la venta es $15 Y Bs 13.000, valores INDEPENDIENTES (el Bs es el
    // precio manual asignado, no 15×tasa). La reconciliación depende de si entra o no
    // dinero en moneda extranjera (USD/COP/Cashea/saldo):
    //
    //   • Régimen Bs (nada extranjero pagado): manda el bolívar. Falta = Bs manual
    //     restante; su equivalente USD se proyecta con la tasa efectiva del carrito
    //     (13.000/15), de modo que pagar 13.000 Bs completa la venta sin generar vuelto.
    //   • Régimen USD (hay pago extranjero): manda el dólar. Falta USD = $15 − pagado$
    //     (nominal); Falta Bs = faltaUSD × tasa BCV. Así $10 deja $5 / Bs 4.000.
    // Suma de pagos en Bs (efectivo Bs, pago móvil, etc.)
    const bsPaid = useMemo(() => sumR(metodosActivos.map(m => (m.tipo === 'BS' ? round2(val(m.id)) : 0))), [pagos, metodosActivos]);

    // Suma de pagos en moneda extranjera, expresada en USD (sin Cashea/saldo)
    const nonBsMethodsUsd = useMemo(() => sumR(metodosActivos.map(m => {
        const v = val(m.id);
        if (v <= 0) return 0;
        if (m.tipo === 'DIVISA') return round2(v);
        if (m.tipo === 'COP') return safeTasaCop > 0 ? divR(v, safeTasaCop) : 0;
        return 0; // BS se cuenta aparte
    })), [pagos, metodosActivos, safeTasaCop]);

    const nonBsPaidUsd = round2(nonBsMethodsUsd + casheaAmountUsd + pagoSaldoFavorNum);
    const hasNonBs = nonBsPaidUsd > 0.001;

    const {
        totalPagadoUSD, totalPagadoBS, totalPagadoGlobalUSD,
        faltaPorPagar, faltaPorPagarBS, cambioUSD,
    } = useMemo(() => {
        if (!hasNonBs) {
            // Régimen Bs: el bolívar es la referencia (precio manual).
            const faltaBs = round2(Math.max(0, subR(safeTotalBS, bsPaid)));
            const ratioRest = safeTotalBS > 0 ? divR(faltaBs, safeTotalBS) : 0;
            const faltaUsd = round2(mulR(safeTotalUSD, ratioRest));
            const sobranteBs = round2(Math.max(0, subR(bsPaid, safeTotalBS)));
            const ratioSobra = safeTotalBS > 0 ? divR(sobranteBs, safeTotalBS) : 0;
            const pagadoUsd = round2(mulR(safeTotalUSD, safeTotalBS > 0 ? divR(bsPaid, safeTotalBS) : 0));
            return {
                totalPagadoUSD: pagadoUsd,
                totalPagadoBS: bsPaid,
                totalPagadoGlobalUSD: pagadoUsd,
                faltaPorPagar: faltaUsd,
                faltaPorPagarBS: faltaBs,
                cambioUSD: round2(mulR(safeTotalUSD, ratioSobra)),
            };
        }
        // Régimen USD: el dólar es la referencia; el Bs restante va a tasa BCV.
        const bsPaidUsd = tasaSegura > 0 ? divR(bsPaid, tasaSegura) : 0;
        const pagadoUsdMetodos = round2(nonBsMethodsUsd + bsPaidUsd);
        const pagadoGlobal = round2(pagadoUsdMetodos + casheaAmountUsd + pagoSaldoFavorNum);
        const faltaUsd = round2(Math.max(0, subR(safeTotalUSD, pagadoGlobal)));
        return {
            totalPagadoUSD: pagadoUsdMetodos,
            totalPagadoBS: round2(mulR(pagadoGlobal, tasaSegura)),
            totalPagadoGlobalUSD: pagadoGlobal,
            faltaPorPagar: faltaUsd,
            faltaPorPagarBS: round2(mulR(faltaUsd, tasaSegura)),
            cambioUSD: round2(Math.max(0, subR(pagadoGlobal, safeTotalUSD))),
        };
    }, [hasNonBs, bsPaid, nonBsMethodsUsd, safeTotalUSD, safeTotalBS, tasaSegura, casheaAmountUsd, pagoSaldoFavorNum]);

    // Falta directo en USD (siempre asume régimen USD para el llenado directo de divisas)
    const faltaPorPagarUsdDirect = useMemo(() => {
        const bsPaidUsd = tasaSegura > 0 ? divR(bsPaid, tasaSegura) : 0;
        const pagadoGlobal = round2(nonBsMethodsUsd + bsPaidUsd + casheaAmountUsd + pagoSaldoFavorNum);
        return round2(Math.max(0, subR(safeTotalUSD, pagadoGlobal)));
    }, [bsPaid, nonBsMethodsUsd, safeTotalUSD, tasaSegura, casheaAmountUsd, pagoSaldoFavorNum]);

    // IGTF — simplificado (la bodega no usa FinancialController de Listo POS)
    const montoIGTF = 0; // La bodega calcula IGTF en useCheckoutCalculations; en POS mode no se recalcula aquí
    const totalConIGTF = totalUSD;
    const totalConIGTFBS = totalBS;

    return {
        totalPagadoUSD,
        totalPagadoBS,
        totalPagadoGlobalUSD,
        faltaPorPagar,
        faltaPorPagarBS,
        faltaPorPagarUsdDirect,
        cambioUSD,
        montoIGTF,
        totalConIGTF,
        totalConIGTFBS,
        tasaSegura,
        casheaAmountUsd,
    };
};
