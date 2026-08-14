import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { showToast } from '../../Toast';
import { useProductContext } from '../../../context/ProductContext';
import { round2, subR, mulR, divR, sumR } from '../../../utils/dinero';
import { calculateChangeAllocation, calculateChangeInputUpdate } from '../../../core/CheckoutPaymentEngine';
import { sniperLog } from '../../../utils/sniperPayDiagnostic';

// Hooks portados
import { usePaymentState } from './hooks/usePaymentState';
import { usePaymentCalculations } from './hooks/usePaymentCalculations';
import { useClientWallet } from './hooks/useClientWallet';

// Subcomponentes
import PaymentHeader from './components/PaymentHeader';
import PaymentLeftColumn from './components/PaymentLeftColumn';
import PaymentInputs from './components/PaymentInputs';
import PaymentFooter from './components/PaymentFooter';
import WalletSection from './components/WalletSection';

/**
 * CheckoutModalPOS — Modo de cobro profesional (estilo Listo POS, dos columnas).
 * Recibe exactamente los mismos props que CheckoutModal (modo básico) para ser
 * intercambiable sin cambios en SalesView.
 *
 * Props idénticos a CheckoutModal:
 *   onClose, cartTotalUsd, cartTotalBs, discountData, effectiveRate,
 *   customers, selectedCustomerId, setSelectedCustomerId,
 *   paymentMethods, onConfirmSale, onCreateCustomer, triggerHaptic,
 *   copEnabled, copPrimary, tasaCop, onUseSaldoFavor,
 *   currentFloatUsd, currentFloatBs
 *
 * Adicionalmente:
 *   onSwitchMode — callback para cambiar al modo básico desde el header
 */
export default function CheckoutModalPOS({
    onClose,
    cartSubtotalUsd,
    cartTotalUsd: originalTotalUsd,
    cartTotalBs: originalTotalBs,
    pricingErrors = [],
    discountData,
    effectiveRate,
    customers,
    selectedCustomerId,
    setSelectedCustomerId,
    paymentMethods,
    onConfirmSale,
    onCreateCustomer,
    triggerHaptic,
    copEnabled = false,
    copPrimary = false,
    tasaCop = 0,
    onUseSaldoFavor,
    currentFloatUsd = 0,
    currentFloatBs = 0,
    onSwitchMode,
}) {
    const { setCheckoutMode } = useProductContext();

    useEffect(() => {
        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = originalOverflow;
        };
    }, []);

    // Separar métodos por tipo para los inputs
    const metodosActivos = paymentMethods.filter(m => !m.disabled && m.enabled !== false);
    const metodosDivisa = metodosActivos.filter(m => m.currency === 'USD');
    const metodosBs = metodosActivos.filter(m => m.currency === 'BS').sort((a, b) => {
        const isCashA = a.label?.toLowerCase().includes('efectivo');
        const isCashB = b.label?.toLowerCase().includes('efectivo');
        if (isCashA && !isCashB) return -1;
        if (!isCashA && isCashB) return 1;
        return 0;
    });
    const metodosCop = copEnabled ? metodosActivos.filter(m => m.currency === 'COP') : [];

    // Re-mapeo: paymentMethods de bodega usan {id, label, currency} pero los hooks
    // de Listo POS esperan {id, nombre, tipo}. Normalizamos aquí.
    const metodosNormalizados = metodosActivos.map(m => ({
        ...m,
        nombre: m.label || m.nombre || m.id,
        tipo: m.currency === 'BS' ? 'BS' : m.currency === 'COP' ? 'COP' : 'DIVISA',
        icono: m.icon || m.icono || 'DollarSign',
    }));
    const metodosDivisaNorm = metodosNormalizados.filter(m => m.tipo === 'DIVISA');
    const metodosBsNorm = metodosNormalizados.filter(m => m.tipo === 'BS').sort((a, b) => {
        const isCashA = a.nombre.toLowerCase().includes('efectivo');
        const isCashB = b.nombre.toLowerCase().includes('efectivo');
        if (isCashA && !isCashB) return -1;
        if (!isCashA && isCashB) return 1;
        return 0;
    });
    const metodosCopNorm = copEnabled ? metodosNormalizados.filter(m => m.tipo === 'COP') : [];

    // ─── STATE ─────────────────────────────────────────────
    const {
        modo, setModo,
        clienteSeleccionado, setClienteSeleccionado,
        pagos, setPagos,
        referencias, setReferencias,
        pagoSaldoFavor, setPagoSaldoFavor,
        activeInputId, setActiveInputId,
        activeInputType, setActiveInputType,
        inputRefs,
        val,
    } = usePaymentState(null, metodosNormalizados, false);

    // Sync external selectedCustomerId con el estado interno
    useEffect(() => {
        if (selectedCustomerId !== undefined) {
            setClienteSeleccionado(selectedCustomerId || '');
        }
    }, [selectedCustomerId]);

    // Propagar cambio de cliente al exterior
    const handleSetCliente = useCallback((id) => {
        setClienteSeleccionado(id);
        setSelectedCustomerId(id);
    }, [setSelectedCustomerId]);

    // Cashea
    const casheaEnabled = localStorage.getItem('cashea_enabled') === 'true';
    const casheaMinAmount = parseFloat(localStorage.getItem('cashea_min_amount') || '0') || 0;
    const [casheaActive, setCasheaActive] = useState(false);
    const [casheaPercent, setCasheaPercent] = useState(60);

    // Vuelto distribución
    const [distVueltoUSD, setDistVueltoUSD] = useState('');
    const [distVueltoBS, setDistVueltoBS] = useState('');
    const [isChangeCredited, setIsChangeCredited] = useState(false);
    const [isTipDonated, setIsTipDonated] = useState(false);

    // FX19: estado de salidas de vuelto incompleto
    const [isChangeOwed, setIsChangeOwed] = useState(false);
    const [changeOwedMethod, setChangeOwedMethod] = useState('pago_movil');
    const [changeOwedNote, setChangeOwedNote] = useState('');
    const [isChangeVoucher, setIsChangeVoucher] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Un destino de vuelto confirmado no se conserva al cambiar de cliente.
    useEffect(() => {
        setIsChangeCredited(false);
    }, [clienteSeleccionado]);

    const tipCurrency = useMemo(() => {
        const activeInputMethods = metodosNormalizados.filter(m => val(m.id) > 0);
        if (activeInputMethods.length === 0) return 'USD';
        const firstUsd = activeInputMethods.find(m => m.currency === 'USD');
        if (firstUsd) return 'USD';
        const firstBs = activeInputMethods.find(m => m.currency === 'BS');
        if (firstBs) return 'BS';
        const firstCop = activeInputMethods.find(m => m.currency === 'COP');
        if (firstCop) return 'COP';
        return 'USD';
    }, [pagos, metodosNormalizados]);

    const toggleTipDonated = () => {
        triggerHaptic && triggerHaptic();
        setIsTipDonated(prev => !prev);
        setIsChangeCredited(false);
        setIsChangeOwed(false);
        setIsChangeVoucher(false);
    };

    // Detección de pago 100% Bolívares
    const isPureBsPayment = useMemo(() => {
        const activeInputMethods = metodosNormalizados.filter(m => val(m.id) > 0);
        if (activeInputMethods.length === 0) return false;
        return activeInputMethods.every(m => m.currency === 'BS');
    }, [pagos, metodosNormalizados]);

    const cartTotalUsd = originalTotalUsd;

    const casheaMeetsMinimum = casheaMinAmount <= 0 || cartTotalUsd >= casheaMinAmount;

    // Precios duales INDEPENDIENTES: el total en Bs es el precio Bs asignado (no se deriva
    // de USD×tasa). Evita el salto $15↔$16.25 y que el Bs arranque en 12.000 en vez de 13.000.
    const cartTotalBs = originalTotalBs;

    // ─── CÁLCULOS ──────────────────────────────────────────
    const {
        totalPagadoUSD,
        totalPagadoBS,
        totalPagadoGlobalUSD,
        faltaPorPagar,
        faltaPorPagarBS,
        faltaPorPagarUsdDirect,
        cambioUSD,
        cambioBS,
        changeTotalBs,
        paymentRegime,
        physicalCashReceived,
        paymentState,
        montoIGTF,
        totalConIGTF,
        totalConIGTFBS,
        tasaSegura,
        casheaAmountUsd,
    } = usePaymentCalculations({
        totalUSD: cartTotalUsd,
        totalBS: cartTotalBs,
        pagos,
        tasa: effectiveRate,
        metodosActivos: metodosNormalizados,
        val,
        pagoSaldoFavor,
        casheaActive,
        casheaPercent,
        copEnabled,
        tasaCop,
    });

    const currentChangeAllocation = useMemo(() => calculateChangeAllocation({
        totalChangeUsd: cambioUSD,
        totalChangeBs: changeTotalBs,
        physicalUsd: distVueltoUSD,
        physicalBs: distVueltoBS,
        rate: tasaSegura,
    }), [cambioUSD, changeTotalBs, distVueltoUSD, distVueltoBS, tasaSegura]);

    const clearChangeResolutionWhenComplete = (allocation) => {
        if (allocation.remainingBs <= 0.009) {
            setIsTipDonated(false);
            setIsChangeOwed(false);
            setIsChangeVoucher(false);
            setIsChangeCredited(false);
        }
    };

    const handleVueltoDistChange = (moneda, valor) => {
        const cleanVal = valor.replace(',', '.');
        if (cleanVal !== '' && !/^\d*\.?\d*$/.test(cleanVal)) return;

        if (cleanVal === '') {
            if (moneda === 'usd') setDistVueltoUSD('');
            else setDistVueltoBS('');
            return;
        }

        const targetBs = currentChangeAllocation.totalChangeBs;
        const update = calculateChangeInputUpdate({
            currency: moneda,
            requestedValue: cleanVal,
            currentUsd: distVueltoUSD,
            currentBs: distVueltoBS,
            totalChangeBs: targetBs,
            rate: tasaSegura,
        });

        // La edición de un campo conserva el otro. Solo se recorta el valor que
        // excede el vuelto disponible; nunca se recalcula $4 como $4.99 al
        // comenzar a escribir Bs 500.
        if (update.wasClamped) {
            if (moneda === 'usd') {
                showToast(`El máximo disponible en dólares es $${update.max.toFixed(2)}`, 'warning');
            } else {
                showToast(`El máximo disponible en bolívares es Bs ${update.max.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`, 'warning');
            }
        }

        // No reescribir el input que no se está editando. La versión anterior
        // normalizaba ambos estados en cada pulsación; eso podía reemplazar el
        // valor USD mientras el cajero todavía estaba escribiendo Bs (por ejemplo,
        // $4 + Bs 500 terminaba mostrando $4,99). El campo activo conserva el
        // texto introducido y solo se normaliza si realmente excede el vuelto.
        const requestedNumber = Number(cleanVal);
        const nextUsd = moneda === 'usd'
            ? (update.wasClamped ? update.usd : (Number.isFinite(requestedNumber) ? requestedNumber : 0))
            : Number(distVueltoUSD) || 0;
        const nextBs = moneda === 'bs'
            ? (update.wasClamped ? update.bs : (Number.isFinite(requestedNumber) ? requestedNumber : 0))
            : Number(distVueltoBS) || 0;

        if (moneda === 'usd') {
            setDistVueltoUSD(update.wasClamped ? (update.usd > 0 ? update.usd.toString() : '') : cleanVal);
        } else {
            setDistVueltoBS(update.wasClamped ? (update.bs > 0 ? update.bs.toString() : '') : cleanVal);
        }

        clearChangeResolutionWhenComplete(calculateChangeAllocation({
            totalChangeUsd: cambioUSD,
            totalChangeBs: targetBs,
            physicalUsd: nextUsd,
            physicalBs: nextBs,
            rate: tasaSegura,
        }));

    };

    const handleCreditChange = () => {
        if (!clienteSeleccionado) {
            showToast('Selecciona un cliente para abonar el vuelto a cuenta', 'warning');
            return;
        }

        setIsChangeCredited(prev => {
            const next = !prev;
            if (next) {
                setIsTipDonated(false);
                setIsChangeOwed(false);
                setIsChangeVoucher(false);
            }
            return next;
        });
    };

    // Limpiar vuelto cuando baja
    useEffect(() => {
        if (cambioUSD <= 0) {
            setDistVueltoUSD('');
            setDistVueltoBS('');
            setIsTipDonated(false);
            setIsChangeCredited(false);
        }
    }, [cambioUSD]);

    // ─── WALLET ─────────────────────────────────────────────
    const { proyeccion } = useClientWallet(
        clienteSeleccionado, customers, modo, cambioUSD,
        isChangeCredited, distVueltoUSD, distVueltoBS, tasaSegura, changeTotalBs
    );

    const selectedCustomer = customers.find(c => c.id === clienteSeleccionado);

    // ─── HANDLERS DE INPUT ──────────────────────────────────
    const llenarSaldo = (id, moneda) => {
        const actual = parseFloat(pagos[id] || 0);
        let valorFinal = 0;
        if (moneda === 'USD') valorFinal = round2(actual + faltaPorPagarUsdDirect);
        if (moneda === 'BS') valorFinal = round2(actual + faltaPorPagarBS);
        if (moneda === 'COP' && tasaCop > 0) valorFinal = round2(actual + (faltaPorPagar * tasaCop));
        setPagos(prev => ({ ...prev, [id]: valorFinal }));
    };

    const sumarBillete = (id, monto) => {
        const actual = parseFloat(pagos[id] || 0);
        const nuevo = round2(actual + monto);
        setPagos(prev => ({ ...prev, [id]: nuevo }));
    };

    const handleInputChange = (id, v) => {
        if (v === '' || /^\d*\.?\d*$/.test(v)) {
            setPagos(prev => ({ ...prev, [id]: v }));
        }
    };

    const handleRefChange = (id, v) => setReferencias(prev => ({ ...prev, [id]: v }));

    const handleInputKeyDown = (e, index) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
            e.preventDefault();
            const next = inputRefs.current[index + 1];
            if (next) next.focus({ preventScroll: true });
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = inputRefs.current[index - 1];
            if (prev) prev.focus({ preventScroll: true });
        }
    };

    // ─── PROCESAR PAGO ──────────────────────────────────────
    const procesarPago = async (imprimir = false) => {
        if (isSubmitting) return;
        sniperLog('1_PROCESAR_PAGO_CLICK', 'Boton PAGAR (LISTO) presionado', { modo, faltaPorPagar, clienteSeleccionado });
        try {
            // Validaciones
            if (modo === 'contado' && faltaPorPagar > 0.01) {
                sniperLog('1_ABORT', 'Abortado por faltaPorPagar > 0.01', { faltaPorPagar });
                showToast(`Faltan $${faltaPorPagar.toFixed(2)} por cobrar`, 'error');
                return;
            }
            if (modo === 'credito' && !clienteSeleccionado) {
                sniperLog('1_ABORT', 'Abortado por falta clienteSeleccionado en crédito');
                showToast('Selecciona un cliente para vender a crédito', 'warning');
                return;
            }
            if (parseFloat(pagoSaldoFavor || 0) > 0 && !clienteSeleccionado) {
                sniperLog('1_ABORT', 'Abortado por falta clienteSeleccionado en saldo a favor');
                showToast('Selecciona un cliente para usar saldo a favor', 'error');
                return;
            }
            if (casheaActive && !clienteSeleccionado) {
                sniperLog('1_ABORT', 'Abortado por falta clienteSeleccionado en Cashea');
                showToast('Selecciona un cliente para financiar con Cashea', 'warning');
                return;
            }
            if (isChangeCredited && !selectedCustomer) {
                sniperLog('1_ABORT', 'Abortado por cliente inválido para abono de vuelto', { clienteSeleccionado });
                showToast('Selecciona un cliente válido para abonar el vuelto a cuenta', 'warning');
                setIsChangeCredited(false);
                return;
            }

            // Verificar referencias
            for (const m of metodosNormalizados) {
                if (val(m.id) > 0 && m.requiereRef && (!referencias[m.id] || referencias[m.id].length < 4)) {
                    sniperLog('1_ABORT', `Abortado por falta de referencia requerida en ${m.nombre}`, { ref: referencias[m.id] });
                    showToast(`Ingresa la referencia para ${m.nombre}`, 'warning');
                    return;
                }
            }

            setIsSubmitting(true);
            const checkoutOperationId = crypto.randomUUID();

            // Construir pagos finales en formato que onConfirmSale espera
            const payments = metodosNormalizados
                .filter(m => val(m.id) > 0)
                .map(m => {
                    const amount = round2(val(m.id));
                    const currency = m.tipo === 'BS' ? 'BS' : m.tipo === 'COP' ? 'COP' : 'USD';
                    return {
                        id: crypto.randomUUID(),
                        methodId: m.id,
                        methodLabel: m.nombre,
                        currency,
                        amountInput: amount,
                        amountInputCurrency: currency,
                        amountUsd: currency === 'USD' ? amount
                            : currency === 'COP' ? (tasaCop > 0 ? divR(amount, tasaCop) : 0)
                            : (tasaSegura > 0 ? divR(amount, tasaSegura) : 0),
                        amountBs: currency === 'BS' ? amount
                            : currency === 'COP' ? (tasaCop > 0 && tasaSegura > 0 ? mulR(divR(amount, tasaCop), tasaSegura) : 0)
                            : (tasaSegura > 0 ? mulR(amount, tasaSegura) : 0),
                        isCash: m.isCash === true || m.id?.startsWith('efectivo_'),
                        referencia: referencias[m.id] || '',
                    };
                });

            // Añadir Cashea virtual
            if (casheaActive && casheaAmountUsd > 0) {
                payments.push({
                    id: crypto.randomUUID(),
                    methodId: 'cashea',
                    methodLabel: 'Cashea',
                    currency: 'USD',
                    amountInput: casheaAmountUsd,
                    amountInputCurrency: 'USD',
                    amountUsd: casheaAmountUsd,
                    amountBs: mulR(casheaAmountUsd, tasaSegura),
                    isCashea: true,
                    casheaPercent: 100 - casheaPercent,
                });
            }

            // Añadir saldo a favor
            if (parseFloat(pagoSaldoFavor) > 0) {
                payments.push({
                    id: crypto.randomUUID(),
                    methodId: 'saldo_favor',
                    methodLabel: 'Saldo a Favor',
                    currency: 'USD',
                    amountInput: round2(parseFloat(pagoSaldoFavor)),
                    amountInputCurrency: 'USD',
                    amountUsd: round2(parseFloat(pagoSaldoFavor)),
                    amountBs: mulR(parseFloat(pagoSaldoFavor), tasaSegura),
                    isSaldoFavor: true,
                });
            }

            // Solo el efectivo físico puede generar vuelto físico. Pagos digitales
            // sobregirados deben resolverse explícitamente (monedero/adeudo/voucher/donación).
            const cashPaidBs = physicalCashReceived.bs;
            const cashPaidUsdInBs = sumR([
                mulR(physicalCashReceived.usd, tasaSegura),
                tasaCop > 0 ? mulR(divR(physicalCashReceived.cop, tasaCop), tasaSegura) : 0,
            ]);
            const vueltoEnBs = cashPaidBs > cashPaidUsdInBs;

            // La distribución se concilia en Bs contra la autoridad del régimen.
            // Esto evita convertir Bs→USD→Bs y crear centavos ficticios.
            const changeAllocationAtSubmit = calculateChangeAllocation({
                totalChangeUsd: cambioUSD,
                totalChangeBs: changeTotalBs,
                physicalUsd: distVueltoUSD,
                physicalBs: distVueltoBS,
                rate: tasaSegura,
            });
            const cambioFaltanteCalculado = changeAllocationAtSubmit.remainingUsd;
            const cambioFaltanteBsCalculado = changeAllocationAtSubmit.remainingBs;

            // FX19 partial: si el usuario distribuyó cambio físico Y además donó el resto,
            // changeUsdGiven/changeBsGiven debe reflejar lo físicamente entregado (no 0).
            const hasPartialPhysical = changeAllocationAtSubmit.distributedBs > 0.009;
            const hasPhysicalCash = cashPaidBs > 0.009 || cashPaidUsdInBs > 0.009;
            const hasExplicitResolution = isTipDonated || isChangeOwed || isChangeVoucher || isChangeCredited;
            const defaultChangeUsd = hasPartialPhysical
                ? changeAllocationAtSubmit.givenUsd
                : (!hasExplicitResolution && hasPhysicalCash && !vueltoEnBs ? cambioUSD : 0);
            const defaultChangeBs = hasPartialPhysical
                ? changeAllocationAtSubmit.givenBs
                : (!hasExplicitResolution && hasPhysicalCash && vueltoEnBs ? changeTotalBs : 0);
            if (isChangeCredited && cambioFaltanteCalculado <= 0.009) {
                setIsChangeCredited(false);
                showToast('El vuelto ya fue distribuido; selecciona un destino solo para el faltante.', 'warning');
                setIsSubmitting(false);
                return;
            }
            const walletChangeUsd = isChangeCredited ? cambioFaltanteCalculado : 0;
            const walletChangeBs = isChangeCredited ? cambioFaltanteBsCalculado : 0;


            // FX19 partial: la donación es SOLO el faltante (cambioFaltanteCalculado),
            // no el total del cambio (cambioUSD). Si no hay físico distribuido, dona el 100%.
            const tipDonatedAmountUsd = hasPartialPhysical ? cambioFaltanteCalculado : cambioUSD;
            const tipDonatedObj = (isTipDonated && tipDonatedAmountUsd > 0.009) ? {
                amountUsd: tipDonatedAmountUsd,
                amountBs: hasPartialPhysical ? cambioFaltanteBsCalculado : changeTotalBs,
                currency: tipCurrency,
                partial: hasPartialPhysical,
                physicalGivenUsd: changeAllocationAtSubmit.givenUsd,
                physicalGivenBs: changeAllocationAtSubmit.givenBs,
            } : null;

            const changeDestinationCurrency = paymentRegime === 'PURE_BS' ? 'BS' : 'USD';

            // FX19-S2: Vuelto adeudado externo
            const changeOwedObj = (isChangeOwed && cambioFaltanteCalculado > 0.009) ? {
                amountUsd: cambioFaltanteCalculado,
                amountBs: cambioFaltanteBsCalculado,
                currency: changeDestinationCurrency,
                method: changeOwedMethod,
                note: changeOwedNote,
                resolvedAt: null,
            } : null;

            // FX19-S3: Voucher de cambio pendiente
            const changeVoucherObj = (isChangeVoucher && cambioFaltanteCalculado > 0.009) ? {
                amountUsd: cambioFaltanteCalculado,
                amountBs: cambioFaltanteBsCalculado,
                currency: changeDestinationCurrency,
                voucherCode: `VCH-${Date.now()}`,
                issuedAt: new Date().toISOString(),
            } : null;

            // Total a REGISTRAR: los totales del carrito provienen directamente de
            // FinancialEngine.buildCartTotals (que respeta precios duales y manuales en Bs).
            // Pasar originalTotalUsd y originalTotalBs tal cual garantiza consistencia matemática 100%.
            const result = await onConfirmSale(payments, {
                changeUsdGiven: defaultChangeUsd,
                changeBsGiven: defaultChangeBs,
                vueltoParaMonederoUsd: walletChangeUsd,
                vueltoParaMonederoBs: walletChangeBs,
                vueltoParaMonederoCurrency: changeDestinationCurrency,
                esCredito: modo === 'credito',
                clienteId: clienteSeleccionado || null,
                esCashea: casheaActive,
                vueltoCredito: isChangeCredited,
                tipDonated: tipDonatedObj,
                changeOwed: changeOwedObj,
                changeVoucher: changeVoucherObj,
                checkoutOperationId,
            }, {
                cartTotalUsd: originalTotalUsd,
                cartTotalBs: originalTotalBs,
                cartSubtotalUsd,
            });

            if (result?.success === false) {
                setIsSubmitting(false);
                return;
            }

            setIsSubmitting(false);
            triggerHaptic && triggerHaptic();
        } catch (err) {
            setIsSubmitting(false);
            console.error('Error al procesar pago POS:', err);
            showToast('Error al procesar el pago. Revisa la consola.', 'error');
        }
    };

    const deudaCliente = modo === 'credito' ? faltaPorPagar : 0;
    const hasChange = currentChangeAllocation.totalChangeBs > 0.009;
    const isVueltoValido = !hasChange
        || currentChangeAllocation.distributedBs <= currentChangeAllocation.totalChangeBs + 0.009;

    // El faltante se calcula en la moneda autoridad y sólo después se expresa en USD
    // para las cuentas del cliente y las opciones de resolución.
    const cambioFaltante = currentChangeAllocation.remainingUsd;
    const vueltoIncompleto = hasChange
        && !isChangeCredited
        && !isTipDonated
        && !isChangeOwed
        && !isChangeVoucher
        && currentChangeAllocation.remainingBs > 0.009;

    // GR-FX19-2: Exclusión mutua estricta entre opciones de salientes de vuelto (Donado, Pagar por fuera, Voucher)
    useEffect(() => {
        if (isChangeOwed) {
            if (isTipDonated) setIsTipDonated(false);
            if (isChangeVoucher) setIsChangeVoucher(false);
            if (isChangeCredited) setIsChangeCredited(false);
        }
    }, [isChangeOwed, isTipDonated, isChangeVoucher, isChangeCredited]);

    useEffect(() => {
        if (isTipDonated) {
            if (isChangeOwed) setIsChangeOwed(false);
            if (isChangeVoucher) setIsChangeVoucher(false);
            if (isChangeCredited) setIsChangeCredited(false);
        }
    }, [isTipDonated, isChangeOwed, isChangeVoucher, isChangeCredited]);

    useEffect(() => {
        if (isChangeVoucher) {
            if (isChangeOwed) setIsChangeOwed(false);
            if (isTipDonated) setIsTipDonated(false);
            if (isChangeCredited) setIsChangeCredited(false);
        }
    }, [isChangeVoucher, isChangeOwed, isTipDonated, isChangeCredited]);

    // Switch rápido al modo básico
    const handleSwitchToBasic = () => {
        setCheckoutMode('basic');
        if (onSwitchMode) onSwitchMode('basic');
    };

    // 🛡️ EFECTO: Si se activa Cashea, forzar el modo de pago a Contado (no se puede vender a crédito de la casa y con Cashea a la vez)
    useEffect(() => {
        if (casheaActive && modo === 'credito') {
            setModo('contado');
        }
    }, [casheaActive, modo, setModo]);

    return (
        <div className="fixed inset-0 bg-black/40 dark:bg-black/60 flex items-center justify-center z-50 p-2 sm:p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Modal de pago profesional"
                className="bg-white dark:bg-slate-950 w-full max-w-5xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[96vh] animate-in zoom-in-95 duration-200"
            >
                {/* Header */}
                <PaymentHeader
                    modo={modo}
                    setModo={setModo}
                    onClose={onClose}
                    onSwitchToBasic={handleSwitchToBasic}
                    tasa={effectiveRate}
                    casheaActive={casheaActive}
                />

                {/* Body — dos columnas */}
                <div className="flex flex-1 min-h-0 flex-col lg:flex-row overflow-hidden">
                    {/* Columna Izquierda */}
                    <PaymentLeftColumn
                        totalUSD={cartTotalUsd}
                        totalBS={cartTotalBs}
                        pricingErrors={pricingErrors}
                        discountData={discountData}
                        tasaSegura={tasaSegura}
                        clienteSeleccionado={clienteSeleccionado}
                        setClienteSeleccionado={handleSetCliente}
                        customers={customers}
                        onCreateCustomer={onCreateCustomer}
                        modo={modo}
                        proyeccion={proyeccion}
                        totalPagadoGlobalUSD={totalPagadoGlobalUSD}
                        faltaPorPagar={faltaPorPagar}
                        faltaPorPagarBS={faltaPorPagarBS}
                        cambioUSD={cambioUSD}
                        cambioBS={cambioBS}
                        changeTotalBs={changeTotalBs}
                        paymentRegime={paymentRegime}
                        distVueltoUSD={distVueltoUSD}
                        distVueltoBS={distVueltoBS}
                        handleVueltoDistChange={handleVueltoDistChange}
                        isChangeCredited={isChangeCredited}
                        handleCreditChange={handleCreditChange}
                        setIsChangeCredited={setIsChangeCredited}
                        setIsChangeVoucher={setIsChangeVoucher}
                        deudaCliente={deudaCliente}
                        isVueltoValido={isVueltoValido}
                        casheaEnabled={casheaEnabled}
                        casheaMeetsMinimum={casheaMeetsMinimum}
                        casheaActive={casheaActive}
                        setCasheaActive={setCasheaActive}
                        casheaPercent={casheaPercent}
                        setCasheaPercent={setCasheaPercent}
                        casheaAmountUsd={casheaAmountUsd}
                        effectiveRate={effectiveRate}
                        isTipDonated={isTipDonated}
                        toggleTipDonated={toggleTipDonated}
                        setIsTipDonated={setIsTipDonated}
                        tipCurrency={tipCurrency}
                        cambioFaltante={cambioFaltante}
                        isChangeOwed={isChangeOwed}
                        setIsChangeOwed={setIsChangeOwed}
                        changeOwedMethod={changeOwedMethod}
                        setChangeOwedMethod={setChangeOwedMethod}
                        changeOwedNote={changeOwedNote}
                        setChangeOwedNote={setChangeOwedNote}
                    />

                    {/* Columna Derecha — inputs */}
                    <div className="flex-1 min-h-0 flex flex-col bg-white dark:bg-slate-950 overflow-hidden">
                        <div className="flex-1 min-h-0 overflow-y-auto p-5 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
                            {/* Saldo a Favor */}
                            <WalletSection
                                cliente={selectedCustomer}
                                totalPagadoUSD={totalPagadoUSD}
                                tasaSegura={tasaSegura}
                                totalConIGTF={cartTotalUsd}
                                pagoSaldoFavor={pagoSaldoFavor}
                                setPagoSaldoFavor={setPagoSaldoFavor}
                            />

                            {/* Inputs de pago */}
                            <PaymentInputs
                                metodosDivisa={metodosDivisaNorm}
                                metodosBs={metodosBsNorm}
                                metodosCop={metodosCopNorm}
                                pagos={pagos}
                                handleInputChange={handleInputChange}
                                llenarSaldo={llenarSaldo}
                                referencias={referencias}
                                handleRefChange={handleRefChange}
                                inputRefs={inputRefs}
                                handleInputKeyDown={handleInputKeyDown}
                                tasa={tasaSegura}
                                sumarBillete={sumarBillete}
                                isTouch={false}
                                onFocusInput={(id) => { setActiveInputId(id); setActiveInputType('amount'); }}
                                activeInputId={activeInputId}
                                onFocusRef={(id) => { setActiveInputId(id); setActiveInputType('ref'); }}
                                copEnabled={copEnabled}
                            />
                        </div>

                        {/* Footer */}
                        <PaymentFooter
                            modo={modo}
                            faltaPorPagar={faltaPorPagar}
                            clienteSeleccionado={clienteSeleccionado}
                            totalPagadoGlobalUSD={totalPagadoGlobalUSD}
                            onProcesar={procesarPago}
                            vueltoIncompleto={vueltoIncompleto}
                            processing={isSubmitting}
                            blockedByPricing={pricingErrors.length > 0}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
