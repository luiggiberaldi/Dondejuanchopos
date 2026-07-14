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

    // Fracción de la venta cubierta por cada pago:
    //   - USD/COP se miden contra el total USD; BS se mide contra el total Bs (independiente).
    // Así un pago en Bs cubre su porción exacta del precio Bs asignado, sin pasar por la tasa.
    const fraccionPagada = useMemo(() => {
        const fracMetodos = sumR(metodosActivos.map(m => {
            const v = val(m.id);
            if (v <= 0) return 0;
            if (m.tipo === 'BS') return safeTotalBS > 0 ? divR(v, safeTotalBS) : 0;
            if (m.tipo === 'COP') return (safeTasaCop > 0 && safeTotalUSD > 0) ? divR(divR(v, safeTasaCop), safeTotalUSD) : 0;
            return safeTotalUSD > 0 ? divR(v, safeTotalUSD) : 0; // DIVISA
        }));
        const casheaFrac = safeTotalUSD > 0 ? divR(casheaAmountUsd, safeTotalUSD) : 0;
        const saldoFrac = safeTotalUSD > 0 ? divR(pagoSaldoFavorNum, safeTotalUSD) : 0;
        return fracMetodos + casheaFrac + saldoFrac;
    }, [pagos, metodosActivos, safeTotalBS, safeTotalUSD, safeTasaCop, casheaAmountUsd, pagoSaldoFavorNum]);

    // Total pagado (proyección de la fracción sobre cada total, para visualización).
    const totalPagadoUSD = useMemo(() => {
        return sumR(metodosActivos.map(m => {
            const v = val(m.id);
            if (m.tipo === 'DIVISA') return round2(v);
            if (m.tipo === 'COP' && safeTasaCop > 0) return divR(v, safeTasaCop);
            // BS: proyectar su fracción del total Bs al total USD (no usar la tasa directa).
            return safeTotalBS > 0 ? round2(mulR(divR(v, safeTotalBS), safeTotalUSD)) : 0;
        }));
    }, [pagos, metodosActivos, safeTotalBS, safeTotalUSD, safeTasaCop]);

    // Total pagado en BS (para visualización)
    const totalPagadoBS = useMemo(() => {
        return sumR(metodosActivos.map(m => {
            const v = val(m.id);
            if (m.tipo === 'BS') return round2(v);
            if (m.tipo === 'COP' && safeTasaCop > 0 && safeTotalUSD > 0)
                return round2(mulR(divR(divR(v, safeTasaCop), safeTotalUSD), safeTotalBS));
            // DIVISA: proyectar su fracción del total USD al total Bs.
            return safeTotalUSD > 0 ? round2(mulR(divR(v, safeTotalUSD), safeTotalBS)) : 0;
        }));
    }, [pagos, metodosActivos, safeTotalBS, safeTotalUSD, safeTasaCop]);

    // Total global con Cashea + saldo a favor (en USD, para visualización y registro)
    const totalPagadoGlobalUSD = useMemo(() => {
        return round2(totalPagadoUSD + casheaAmountUsd + pagoSaldoFavorNum);
    }, [totalPagadoUSD, casheaAmountUsd, pagoSaldoFavorNum]);

    // Restante y vuelto por FRACCIÓN de la venta (no por conversión de tasa), de modo que
    // el faltante en Bs sea el precio Bs restante real y el rayito lo llene en un solo toque.
    const fraccionRestante = Math.max(0, subR(1, fraccionPagada));
    const faltaPorPagar   = round2(mulR(fraccionRestante, safeTotalUSD));
    const faltaPorPagarBS = round2(mulR(fraccionRestante, safeTotalBS));
    const cambioUSD = Math.max(0, round2(mulR(Math.max(0, subR(fraccionPagada, 1)), safeTotalUSD)));

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
        cambioUSD,
        montoIGTF,
        totalConIGTF,
        totalConIGTFBS,
        tasaSegura,
        casheaAmountUsd,
    };
};
