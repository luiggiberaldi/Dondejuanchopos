import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { showToast } from '../../Toast';
import { useProductContext } from '../../../context/ProductContext';
import { round2, subR, mulR, divR } from '../../../utils/dinero';
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

    const handleVueltoDistChange = (moneda, valor) => {
        let cleanVal = valor.replace(',', '.');
        if (cleanVal !== '' && !/^\d*\.?\d*$/.test(cleanVal)) return;

        if (moneda === 'usd') {
            if (cleanVal === '') {
                setDistVueltoUSD('');
                return;
            }
            const valNum = parseFloat(cleanVal) || 0;
            const bsActualInUsd = parseFloat(distVueltoBS || 0) / tasaSegura;
            const maxUsdSeguro = round2(Math.max(0, subR(cambioUSD, bsActualInUsd)));

            let usdFinal = valNum;
            if (valNum > maxUsdSeguro + 0.009) {
                if (bsActualInUsd > 0) {
                    const nuevoBsPermitido = round2(Math.max(0, mulR(subR(cambioUSD, Math.min(valNum, cambioUSD)), tasaSegura)));
                    setDistVueltoBS(nuevoBsPermitido > 0 ? Math.round(nuevoBsPermitido).toString() : '');
                    usdFinal = Math.min(valNum, cambioUSD);
                } else {
                    usdFinal = cambioUSD;
                    showToast(`El vuelto total es de $${cambioUSD.toFixed(2)}`, 'warning');
                }
            }
            setDistVueltoUSD(round2(usdFinal).toString());

            const sumaFinal = round2(usdFinal + (parseFloat(distVueltoBS || 0) / tasaSegura));
            if (sumaFinal >= cambioUSD - 0.009) {
                setIsTipDonated(false);
                setIsChangeOwed(false);
                setIsChangeVoucher(false);
            }
        } else {
            if (cleanVal === '') {
                setDistVueltoBS('');
                return;
            }
            const valNumBs = parseFloat(cleanVal) || 0;
            const usdActual = parseFloat(distVueltoUSD || 0);
            const maxBsSeguro = round2(mulR(Math.max(0, subR(cambioUSD, usdActual)), tasaSegura));

            let bsFinal = valNumBs;
            if (valNumBs > maxBsSeguro + 1) {
                if (usdActual > 0) {
                    const nuevoUsdPermitido = round2(Math.max(0, subR(cambioUSD, valNumBs / tasaSegura)));
                    setDistVueltoUSD(nuevoUsdPermitido > 0 ? nuevoUsdPermitido.toString() : '');
                    const maxBsAbsoluto = round2(mulR(cambioUSD, tasaSegura));
                    bsFinal = Math.min(valNumBs, maxBsAbsoluto);
                } else {
                    const maxBsAbsoluto = round2(mulR(cambioUSD, tasaSegura));
                    bsFinal = maxBsAbsoluto;
                    showToast(`El vuelto total en bolívares es Bs ${Math.round(maxBsAbsoluto).toLocaleString('es-VE')}`, 'warning');
                }
            }
            setDistVueltoBS(Math.round(bsFinal).toString());

            const sumaFinal = round2((parseFloat(distVueltoUSD || 0)) + (bsFinal / tasaSegura));
            if (sumaFinal >= cambioUSD - 0.009) {
                setIsTipDonated(false);
                setIsChangeOwed(false);
                setIsChangeVoucher(false);
            }
        }
    };

    const handleCreditChange = () => {
        if (!clienteSeleccionado) {
            showToast('Selecciona un cliente para abonar el vuelto a cuenta', 'warning');
            return;
        }
        setIsChangeCredited(true);
        setIsTipDonated(false);
        setIsChangeOwed(false);
        setIsChangeVoucher(false);
    };

    // Limpiar vuelto cuando baja
    useEffect(() => {
        if (cambioUSD <= 0) {
            setDistVueltoUSD('');
            setDistVueltoBS('');
            setIsTipDonated(false);
        }
    }, [cambioUSD]);

    // ─── WALLET ─────────────────────────────────────────────
    const { proyeccion } = useClientWallet(
        clienteSeleccionado, customers, modo, cambioUSD,
        isChangeCredited, distVueltoUSD, distVueltoBS, tasaSegura
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
                            : currency === 'COP' ? (tasaCop > 0 ? amount / tasaCop : 0)
                            : (tasaSegura > 0 ? amount / tasaSegura : 0),
                        amountBs: currency === 'BS' ? amount
                            : currency === 'COP' ? (tasaCop > 0 && tasaSegura > 0 ? (amount / tasaCop) * tasaSegura : 0)
                            : (tasaSegura > 0 ? amount * tasaSegura : 0),
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
                    amountBs: casheaAmountUsd * tasaSegura,
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
                    amountInput: parseFloat(pagoSaldoFavor),
                    amountInputCurrency: 'USD',
                    amountUsd: parseFloat(pagoSaldoFavor),
                    amountBs: parseFloat(pagoSaldoFavor) * tasaSegura,
                    isSaldoFavor: true,
                });
            }

            // Solo el efectivo físico puede generar vuelto físico. Pagos digitales
            // sobregirados deben resolverse explícitamente (monedero/adeudo/voucher/donación).
            const cashPaidBs = physicalCashReceived.bs;
            const cashPaidUsdInBs = round2(mulR(physicalCashReceived.usd, tasaSegura)
                + (tasaCop > 0 ? mulR(divR(physicalCashReceived.cop, tasaCop), tasaSegura) : 0));
            const vueltoEnBs = cashPaidBs > cashPaidUsdInBs;

            // FX19 partial: calcular suma y faltante primero para usarlos en la lógica de donación
            const sumaVueltoAsignadoCalculada = parseFloat(distVueltoUSD || 0) + parseFloat(distVueltoBS || 0) / tasaSegura;
            const cambioFaltanteCalculado = round2(Math.max(0, subR(cambioUSD, sumaVueltoAsignadoCalculada)));

            // FX19 partial: si el usuario distribuyó cambio físico Y además donó el resto,
            // changeUsdGiven/changeBsGiven debe reflejar lo físicamente entregado (no 0).
            const hasPartialPhysical = sumaVueltoAsignadoCalculada > 0.01;
            const hasPhysicalCash = cashPaidBs > 0.009 || cashPaidUsdInBs > 0.009;
            const hasExplicitResolution = isTipDonated || isChangeOwed || isChangeVoucher || isChangeCredited;
            const defaultChangeUsd = hasPartialPhysical
                ? parseFloat(distVueltoUSD || 0)
                : (!hasExplicitResolution && hasPhysicalCash && !vueltoEnBs ? cambioUSD : 0);
            const defaultChangeBs = hasPartialPhysical
                ? parseFloat(distVueltoBS || 0)
                : (!hasExplicitResolution && hasPhysicalCash && vueltoEnBs ? cambioBS : 0);
            const walletChangeUsd = isChangeCredited ? cambioFaltanteCalculado : 0;


            // FX19 partial: la donación es SOLO el faltante (cambioFaltanteCalculado),
            // no el total del cambio (cambioUSD). Si no hay físico distribuido, dona el 100%.
            const tipDonatedAmountUsd = hasPartialPhysical ? cambioFaltanteCalculado : cambioUSD;
            const tipDonatedObj = (isTipDonated && cambioUSD > 0.009) ? {
                amountUsd: tipDonatedAmountUsd,
                amountBs: round2(mulR(tipDonatedAmountUsd, tasaSegura)),
                currency: tipCurrency,
                partial: hasPartialPhysical,
                physicalGivenUsd: parseFloat(distVueltoUSD || 0),
                physicalGivenBs: parseFloat(distVueltoBS || 0),
            } : null;

            // FX19-S2: Vuelto adeudado externo
            const changeOwedObj = (isChangeOwed && cambioFaltanteCalculado > 0.009) ? {
                amountUsd: cambioFaltanteCalculado,
                amountBs: round2(mulR(cambioFaltanteCalculado, tasaSegura)),
                method: changeOwedMethod,
                note: changeOwedNote,
                resolvedAt: null,
            } : null;

            // FX19-S3: Voucher de cambio pendiente
            const changeVoucherObj = (isChangeVoucher && cambioFaltanteCalculado > 0.009) ? {
                amountUsd: cambioFaltanteCalculado,
                amountBs: round2(mulR(cambioFaltanteCalculado, tasaSegura)),
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
    const isVueltoValido = cambioUSD < 0.001 || (
        parseFloat(distVueltoUSD || 0) + parseFloat(distVueltoBS || 0) / tasaSegura <= cambioUSD + 0.001
    );

    // Calcular si el vuelto físico asignado está incompleto (no iguala cambioUSD y no se abona a saldo a favor ni se dona a caja ni se adeuda/voucher)
    const sumaVueltoAsignado = parseFloat(distVueltoUSD || 0) + parseFloat(distVueltoBS || 0) / tasaSegura;
    const cambioFaltante = round2(Math.max(0, subR(cambioUSD, sumaVueltoAsignado)));
    const vueltoIncompleto = cambioUSD > 0.01
        && !isChangeCredited
        && !isTipDonated
        && !isChangeOwed
        && !isChangeVoucher
        && Math.abs(sumaVueltoAsignado - cambioUSD) > 0.01;

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
                        distVueltoUSD={distVueltoUSD}
                        distVueltoBS={distVueltoBS}
                        handleVueltoDistChange={handleVueltoDistChange}
                        isChangeCredited={isChangeCredited}
                        handleCreditChange={handleCreditChange}
                        setIsChangeCredited={setIsChangeCredited}
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
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
