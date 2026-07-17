import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Clock, Plus, Minus, ShoppingBag, CreditCard, ArrowUpRight } from 'lucide-react';
import { Modal } from '../Modal';
import ProductFormQuick from './ProductFormQuick';
import ProductFormWizard from './ProductFormWizard';
import { CurrencyService } from '../../services/CurrencyService';
import { mulR, divR, round2 } from '../../utils/dinero';
import { useProductContext } from '../../context/ProductContext';

export default function ProductFormModal({
    isOpen,
    onClose,
    isEditing,

    image, setImage,
    name, setName,
    barcode, setBarcode,
    category, setCategory,
    priceUsd, handlePriceUsdChange,
    priceBsManual, setPriceBsManual,
    costUsd, handleCostUsdChange,
    costBs, handleCostBsChange,
    stock, setStock,
    lowStockAlert, setLowStockAlert,

    sellByBox, setSellByBox,
    boxUnits, setBoxUnits,
    boxBarcode, setBoxBarcode,
    boxPriceUsd, setBoxPriceUsd,
    boxPriceBs, setBoxPriceBs,

    sellByHalfBox, setSellByHalfBox,
    halfBoxUnits, setHalfBoxUnits,
    halfBoxBarcode, setHalfBoxBarcode,
    halfBoxPriceUsd, setHalfBoxPriceUsd,
    halfBoxPriceBs, setHalfBoxPriceBs,

    purchaseByBoxCost, setPurchaseByBoxCost,
    purchaseBoxUnits, setPurchaseBoxUnits,
    purchaseBoxBcv, setPurchaseBoxBcv,
    setCostUsd, setCostBs,

    effectiveRate,
    forceBcv, setForceBcv,
    isFormShaking,
    handleImageUpload,
    handleSave,
    categories,
    productMovements,
    onOpenCategoryManager
}) {
    const { rates } = useProductContext();
    const [formMode, setFormMode] = useState('quick'); // 'quick' o 'wizard'
    const [wizardStep, setWizardStep] = useState(1);
    const [showMovements, setShowMovements] = useState(false);

    // Toggle estados de Auto-Tasa (independientes por formato)
    const [autoCalcUnit, setAutoCalcUnit] = useState(false);
    const [autoCalcBox, setAutoCalcBox] = useState(false);
    const [autoCalcHalfBox, setAutoCalcHalfBox] = useState(false);

    // Toggle estado de costo a tasa BCV y valor ingresado
    const [calcCostBcv, setCalcCostBcv] = useState(false);
    const [costBcvUsd, setCostBcvUsd] = useState('');

    // Toggle estado de cálculo de costo por caja
    const [calcCostByBox, setCalcCostByBox] = useState(false);

    // Resetear paso, modo y toggles al abrir/cerrar
    useEffect(() => {
        if (isOpen) {
            setWizardStep(1);
            setFormMode('quick');
            setAutoCalcUnit(false);
            setAutoCalcBox(false);
            setAutoCalcHalfBox(false);

            const bcvActiveState = !!purchaseBoxBcv;
            setCalcCostBcv(bcvActiveState);

            // Inicializar costBcvUsd si estamos en modo unidad y tiene tasa BCV activa
            if (bcvActiveState && costBs && !(purchaseByBoxCost && purchaseBoxUnits)) {
                const bcvRate = rates?.bcv?.price > 0 ? rates.bcv.price : effectiveRate;
                const currentBs = CurrencyService.safeParse(costBs);
                if (currentBs > 0 && bcvRate > 0) {
                    setCostBcvUsd((currentBs / bcvRate).toFixed(2));
                } else {
                    setCostBcvUsd('');
                }
            } else {
                setCostBcvUsd('');
            }

            if (purchaseByBoxCost && purchaseBoxUnits) {
                setCalcCostByBox(true);
                // Recalcular costo unitario de inmediato al abrir para reflejar tasas actuales
                handleBoxPurchaseCalc(purchaseByBoxCost, purchaseBoxUnits, bcvActiveState);
            } else {
                setCalcCostByBox(false);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // ½ Caja depende de Caja: si se desactiva Caja, se apaga ½ Caja para no
    // guardar un formato huérfano (media caja sin caja base).
    useEffect(() => {
        if (!sellByBox && sellByHalfBox) {
            setSellByHalfBox(false);
        }
    }, [sellByBox, sellByHalfBox, setSellByHalfBox]);

    // Forzar Auto-Tasa cuando forceBcv está activo
    useEffect(() => {
        if (forceBcv) {
            setAutoCalcUnit(true);
            const usd = CurrencyService.safeParse(priceUsd);
            const bcvRate = rates?.bcv?.price > 0 ? rates.bcv.price : effectiveRate;
            if (usd > 0 && bcvRate > 0) {
                setPriceBsManual(round2(mulR(usd, bcvRate)).toFixed(2));
            }
        }
    }, [forceBcv, priceUsd, rates?.bcv?.price, effectiveRate, setPriceBsManual]);

    if (!isOpen) return null;

    // Validación paso a paso para el asistente
    const canAdvance = () => {
        if (wizardStep === 1) {
            return name && name.trim().length >= 3;
        }
        if (wizardStep === 2) {
            if (sellByBox && !(parseInt(boxUnits, 10) > 0)) return false;
            if (sellByHalfBox && !(parseInt(halfBoxUnits, 10) > 0)) return false;
            return true;
        }
        if (wizardStep === 3) {
            return (Number(priceUsd) || 0) > 0;
        }
        return true;
    };

    // ── AUTO-TASA: Handlers únicos para conversión bidireccional ────────────
    // Fuente de verdad: viven aquí para que Quick y Wizard compartan el mismo estado.

    // Unidad
    const handleToggleAutoCalcUnit = () => {
        if (forceBcv) return;
        const next = !autoCalcUnit;
        setAutoCalcUnit(next);
        if (next && effectiveRate > 0) {
            const usd = CurrencyService.safeParse(priceUsd);
            if (usd > 0) {
                setPriceBsManual(Math.round(mulR(usd, effectiveRate)).toString());
            } else {
                const bs = CurrencyService.safeParse(priceBsManual);
                if (bs > 0) handlePriceUsdChange(divR(bs, effectiveRate).toFixed(2));
            }
        }
    };
    const handleUnitPriceUsdChange = (val) => {
        handlePriceUsdChange(val);
        const bcvRate = rates?.bcv?.price > 0 ? rates.bcv.price : effectiveRate;
        const activeRate = forceBcv ? bcvRate : effectiveRate;
        if (autoCalcUnit && activeRate > 0) {
            const p = CurrencyService.safeParse(val);
            setPriceBsManual(p > 0 ? (forceBcv ? round2(mulR(p, activeRate)).toFixed(2) : Math.round(mulR(p, activeRate)).toString()) : '');
        }
    };
    const handleUnitPriceBsChange = (val) => {
        if (forceBcv) return;
        setPriceBsManual(val);
        if (autoCalcUnit && effectiveRate > 0) {
            const p = CurrencyService.safeParse(val);
            handlePriceUsdChange(p > 0 ? divR(p, effectiveRate).toFixed(2) : '');
        }
    };

    // Caja
    const handleToggleAutoCalcBox = () => {
        const next = !autoCalcBox;
        setAutoCalcBox(next);
        if (next && effectiveRate > 0) {
            const usd = CurrencyService.safeParse(boxPriceUsd);
            if (usd > 0) {
                setBoxPriceBs(Math.round(mulR(usd, effectiveRate)).toString());
            } else {
                const bs = CurrencyService.safeParse(boxPriceBs);
                if (bs > 0) setBoxPriceUsd(divR(bs, effectiveRate).toFixed(2));
            }
        }
    };
    const handleBoxPriceUsdChange = (val) => {
        setBoxPriceUsd(val);
        if (autoCalcBox && effectiveRate > 0) {
            const p = CurrencyService.safeParse(val);
            setBoxPriceBs(p > 0 ? Math.round(mulR(p, effectiveRate)).toString() : '');
        }
    };
    const handleBoxPriceBsChange = (val) => {
        setBoxPriceBs(val);
        if (autoCalcBox && effectiveRate > 0) {
            const p = CurrencyService.safeParse(val);
            setBoxPriceUsd(p > 0 ? divR(p, effectiveRate).toFixed(2) : '');
        }
    };

    // Media Caja
    const handleToggleAutoCalcHalfBox = () => {
        const next = !autoCalcHalfBox;
        setAutoCalcHalfBox(next);
        if (next && effectiveRate > 0) {
            const usd = CurrencyService.safeParse(halfBoxPriceUsd);
            if (usd > 0) {
                setHalfBoxPriceBs(Math.round(mulR(usd, effectiveRate)).toString());
            } else {
                const bs = CurrencyService.safeParse(halfBoxPriceBs);
                if (bs > 0) setHalfBoxPriceUsd(divR(bs, effectiveRate).toFixed(2));
            }
        }
    };
    const handleHalfBoxPriceUsdChange = (val) => {
        setHalfBoxPriceUsd(val);
        if (autoCalcHalfBox && effectiveRate > 0) {
            const p = CurrencyService.safeParse(val);
            setHalfBoxPriceBs(p > 0 ? Math.round(mulR(p, effectiveRate)).toString() : '');
        }
    };
    const handleHalfBoxPriceBsChange = (val) => {
        setHalfBoxPriceBs(val);
        if (autoCalcHalfBox && effectiveRate > 0) {
            const p = CurrencyService.safeParse(val);
            setHalfBoxPriceUsd(p > 0 ? divR(p, effectiveRate).toFixed(2) : '');
        }
    };

    // Handlers para cálculo de costo a tasa BCV
    const handleToggleCalcCostBcv = () => {
        const next = !calcCostBcv;
        setCalcCostBcv(next);
        setPurchaseBoxBcv(next);
        if (next) {
            if (calcCostByBox) {
                const bcvRate = rates?.bcv?.price > 0 ? rates.bcv.price : effectiveRate;
                const parsedCost = CurrencyService.safeParse(purchaseByBoxCost);
                if (parsedCost > 0 && bcvRate > 0) {
                    const newCost = (parsedCost * effectiveRate) / bcvRate;
                    setPurchaseByBoxCost(newCost.toFixed(4));
                    handleBoxPurchaseCalc(newCost.toFixed(4), purchaseBoxUnits, true);
                } else {
                    handleBoxPurchaseCalc(purchaseByBoxCost, purchaseBoxUnits, true);
                }
            } else {
                const bcvRate = rates?.bcv?.price > 0 ? rates.bcv.price : effectiveRate;
                const currentBs = CurrencyService.safeParse(costBs);
                if (currentBs > 0 && bcvRate > 0) {
                    setCostBcvUsd((currentBs / bcvRate).toFixed(2));
                } else {
                    setCostBcvUsd('');
                }
            }
        } else {
            if (calcCostByBox) {
                const bcvRate = rates?.bcv?.price > 0 ? rates.bcv.price : effectiveRate;
                const parsedCost = CurrencyService.safeParse(purchaseByBoxCost);
                if (parsedCost > 0 && effectiveRate > 0) {
                    const newCost = (parsedCost * bcvRate) / effectiveRate;
                    setPurchaseByBoxCost(newCost.toFixed(4));
                    handleBoxPurchaseCalc(newCost.toFixed(4), purchaseBoxUnits, false);
                } else {
                    handleBoxPurchaseCalc(purchaseByBoxCost, purchaseBoxUnits, false);
                }
            }
        }
    };

    const handleCostBcvUsdChange = (val) => {
        setCostBcvUsd(val);
        const bcvRate = rates?.bcv?.price > 0 ? rates.bcv.price : effectiveRate;
        const parsed = CurrencyService.safeParse(val);
        if (!val || parsed <= 0) {
            setCostUsd('');
            setCostBs('');
        } else {
            const costBsVal = parsed * bcvRate;
            const costUsdVal = effectiveRate > 0 ? (costBsVal / effectiveRate) : 0;
            setCostBs(costBsVal.toFixed(2));
            setCostUsd(costUsdVal.toFixed(4));
        }
    };

    // Handlers para cálculo de costo por caja
    const handleToggleCalcCostByBox = () => {
        const next = !calcCostByBox;
        setCalcCostByBox(next);
        if (next) {
            handleBoxPurchaseCalc(purchaseByBoxCost, purchaseBoxUnits, calcCostBcv);
        } else {
            // Limpiar valores de caja y unitarios
            setPurchaseByBoxCost('');
            setPurchaseBoxUnits('');
            setPurchaseBoxBcv(false);
            setCostUsd('');
            setCostBs('');
        }
    };

    const handleBoxPurchaseCalc = (boxCost, boxUnits, bcvActive = calcCostBcv) => {
        const parsedCost = CurrencyService.safeParse(boxCost);
        const parsedUnits = parseInt(boxUnits, 10);
        setPurchaseBoxBcv(bcvActive);
        if (parsedCost > 0 && parsedUnits > 0) {
            if (bcvActive) {
                const bcvVal = rates?.bcv?.price > 0 ? rates.bcv.price : effectiveRate;
                const boxCostBs = parsedCost * bcvVal;
                const unitCostBs = boxCostBs / parsedUnits;
                const unitCostUsd = effectiveRate > 0 ? (unitCostBs / effectiveRate) : 0;
                setCostBs(unitCostBs.toFixed(2));
                setCostUsd(unitCostUsd.toFixed(4));
            } else {
                const unitCostUsd = parsedCost / parsedUnits;
                const unitCostBs = unitCostUsd * effectiveRate;
                setCostUsd(unitCostUsd.toFixed(4));
                setCostBs(unitCostBs.toFixed(2));
            }
        } else {
            setCostUsd('');
            setCostBs('');
        }
    };

    const commonProps = {
        image, setImage,
        name, setName,
        barcode, setBarcode,
        category, setCategory,
        priceUsd, handlePriceUsdChange,
        priceBsManual, setPriceBsManual,
        costUsd, handleCostUsdChange,
        costBs, handleCostBsChange,
        stock, setStock,
        lowStockAlert, setLowStockAlert,

        sellByBox, setSellByBox,
        boxUnits, setBoxUnits,
        boxBarcode, setBoxBarcode,
        boxPriceUsd, setBoxPriceUsd,
        boxPriceBs, setBoxPriceBs,

        sellByHalfBox, setSellByHalfBox,
        halfBoxUnits, setHalfBoxUnits,
        halfBoxBarcode, setHalfBoxBarcode,
        halfBoxPriceUsd, setHalfBoxPriceUsd,
        halfBoxPriceBs, setHalfBoxPriceBs,

        effectiveRate,
        handleImageUpload,
        categories,
        onOpenCategoryManager,

        // Auto-Tasa: toggles + handlers bidireccionales
        autoCalcUnit, handleToggleAutoCalcUnit, handleUnitPriceUsdChange, handleUnitPriceBsChange,
        autoCalcBox, handleToggleAutoCalcBox, handleBoxPriceUsdChange, handleBoxPriceBsChange,
        autoCalcHalfBox, handleToggleAutoCalcHalfBox, handleHalfBoxPriceUsdChange, handleHalfBoxPriceBsChange,

        // Costo BCV
        calcCostBcv, handleToggleCalcCostBcv,
        costBcvUsd, handleCostBcvUsdChange,
        bcvRate: rates?.bcv?.price > 0 ? rates.bcv.price : effectiveRate,
        hasBcvRate: !!(rates?.bcv?.price > 0),

        // Costo por caja
        calcCostByBox, handleToggleCalcCostByBox,
        purchaseByBoxCost, setPurchaseByBoxCost,
        purchaseBoxUnits, setPurchaseBoxUnits,
        handleBoxPurchaseCalc,
        forceBcv, setForceBcv,
    };

    return (
        <Modal 
            isOpen={isOpen} 
            onClose={onClose} 
            title={isEditing ? "Editar Producto" : "Nuevo Producto"}
            size="max-w-sm md:max-w-3xl"
            className={isFormShaking ? 'animate-shake border-red-500 shadow-xl shadow-red-500/20' : ''}
        >
            <div className="space-y-4">
                
                {/* TABS / CONMUTADOR DE MODO (Solo si no es edición) */}
                {!isEditing && (
                    <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl mb-4 text-xs font-bold select-none">
                        <button
                            type="button"
                            onClick={() => setFormMode('quick')}
                            className={`flex-1 py-2 rounded-lg transition-all ${
                                formMode === 'quick'
                                    ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm'
                                    : 'text-slate-400 hover:text-slate-650 dark:hover:text-slate-350'
                            }`}
                        >
                            Vista Rápida
                        </button>
                        <button
                            type="button"
                            onClick={() => setFormMode('wizard')}
                            className={`flex-1 py-2 rounded-lg transition-all ${
                                formMode === 'wizard'
                                    ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm'
                                    : 'text-slate-400 hover:text-slate-650 dark:hover:text-slate-350'
                            }`}
                        >
                            Con Asistente (Pasos)
                        </button>
                    </div>
                )}

                {/* INDICADOR DE PASOS (Solo en Asistente) */}
                {formMode === 'wizard' && (
                    <div className="flex items-center justify-between px-6 mb-4 select-none">
                        {[1, 2, 3, 4].map(step => {
                            const isActive = wizardStep === step;
                            const isCompleted = wizardStep > step;
                            return (
                                <React.Fragment key={step}>
                                    <div className="flex flex-col items-center">
                                        <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs transition-all ${
                                            isActive
                                                ? 'bg-emerald-500 text-white ring-4 ring-emerald-500/20'
                                                : isCompleted
                                                ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
                                                : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                                        }`}>
                                            {step}
                                        </div>
                                    </div>
                                    {step < 4 && (
                                        <div className={`flex-1 h-0.5 mx-2 transition-all ${
                                            wizardStep > step ? 'bg-emerald-300' : 'bg-slate-200 dark:bg-slate-700'
                                        }`} />
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </div>
                )}

                {/* RENDERING DE FORMULARIO SEGÚN MODO */}
                {formMode === 'quick' ? (
                    <ProductFormQuick {...commonProps} />
                ) : (
                    <ProductFormWizard wizardStep={wizardStep} {...commonProps} />
                )}

                {/* KARDEX LITE: Movimientos Recientes (Solo al editar) */}
                {isEditing && productMovements && (
                    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden mt-4">
                        <button 
                            type="button" 
                            onClick={() => setShowMovements(!showMovements)}
                            className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-50 dark:bg-slate-800/50 text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-350 transition-colors"
                        >
                            <span className="flex items-center gap-1.5">
                                <Clock size={13} className="text-brand" />
                                Movimientos Recientes
                                {productMovements.length > 0 && (
                                    <span className="bg-brand-light dark:bg-surface-800/30 text-brand-dark dark:text-brand text-[9px] font-black px-1.5 py-0.5 rounded-full">{productMovements.length}</span>
                                )}
                            </span>
                            {showMovements ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        {showMovements && (
                            <div className="bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800 max-h-56 overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-150">
                                {productMovements.length === 0 ? (
                                    <p className="text-xs text-slate-400 text-center py-6">Sin movimientos registrados</p>
                                ) : (
                                    productMovements.map(mov => {
                                        const date = new Date(mov.timestamp);
                                        const dateStr = date.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' });
                                        const timeStr = date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false });
                                        const isCobro = mov.tipo === 'COBRO_DEUDA';
                                        const isFiada = mov.tipo === 'VENTA_FIADA';
                                        const isEntrada = mov.tipo === 'AJUSTE_ENTRADA';
                                        const isSalida = mov.tipo === 'AJUSTE_SALIDA';
                                        const isAjuste = isEntrada || isSalida;
                                        return (
                                            <div key={mov.id} className="flex items-center gap-2.5 px-3 py-2">
                                                <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                                                    isEntrada ? 'bg-emerald-100 dark:bg-emerald-900/30'
                                                    : isSalida ? 'bg-rose-100 dark:bg-rose-900/30'
                                                    : isCobro ? 'bg-emerald-100 dark:bg-emerald-900/30' 
                                                    : isFiada ? 'bg-amber-100 dark:bg-amber-900/30' 
                                                    : 'bg-brand-light dark:bg-surface-800/30'}`}>
                                                    {isEntrada ? <Plus size={12} className="text-emerald-500" />
                                                    : isSalida ? <Minus size={12} className="text-rose-500" />
                                                    : isCobro ? <ArrowUpRight size={12} className="text-emerald-500" /> 
                                                    : isFiada ? <CreditCard size={12} className="text-amber-500" /> 
                                                    : <ShoppingBag size={12} className="text-brand" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                                                            {isEntrada ? 'Entrada manual' : isSalida ? 'Salida manual' : isFiada ? 'Fiado' : isCobro ? 'Cobro' : 'Venta'}
                                                            {mov.qty && <span className="text-slate-400 font-medium"> {isAjuste ? (isEntrada ? '+' : '-') : 'x'}{mov.qty}</span>}
                                                        </span>
                                                        <span className="text-[10px] text-slate-400">{dateStr} {timeStr}</span>
                                                    </div>
                                                    {mov.clienteName && (
                                                        <p className="text-[9px] text-slate-400 truncate">{mov.clienteName}</p>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* BOTONES DE ACCIÓN / NAVEGACIÓN */}
                {formMode === 'quick' ? (
                    <button 
                        onClick={handleSave} 
                        className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-4 rounded-2xl font-black uppercase tracking-wider shadow-lg shadow-emerald-500/20 active:scale-95 transition-all text-sm cursor-pointer"
                    >
                        {isEditing ? "Actualizar Producto" : "Guardar Producto"}
                    </button>
                ) : (
                    <div className="flex gap-3 pt-2">
                        {wizardStep > 1 && (
                            <button
                                type="button"
                                onClick={() => setWizardStep(prev => prev - 1)}
                                className="flex-1 py-4 rounded-2xl font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 active:scale-95 transition-all text-sm border border-slate-200 dark:border-slate-700 cursor-pointer"
                            >
                                Atrás
                            </button>
                        )}
                        {wizardStep < 4 ? (
                            <button
                                type="button"
                                disabled={!canAdvance()}
                                onClick={() => setWizardStep(prev => prev + 1)}
                                className="flex-[2] py-4 rounded-2xl font-black bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-200 dark:disabled:bg-slate-800 text-white disabled:text-slate-400 active:scale-95 transition-all text-sm shadow-lg shadow-emerald-500/10 cursor-pointer"
                            >
                                Siguiente
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={handleSave}
                                className="flex-[2] py-4 rounded-2xl font-black bg-emerald-650 hover:bg-emerald-700 text-white active:scale-95 transition-all text-sm shadow-lg shadow-emerald-650/25 cursor-pointer"
                            >
                                Guardar Producto
                            </button>
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
}
