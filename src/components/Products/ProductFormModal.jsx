import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Clock, Plus, Minus, ShoppingBag, CreditCard, ArrowUpRight } from 'lucide-react';
import { Modal } from '../Modal';
import ProductFormQuick from './ProductFormQuick';
import ProductFormWizard from './ProductFormWizard';

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

    effectiveRate,
    isFormShaking,
    handleImageUpload,
    handleSave,
    categories,
    productMovements
}) {
    const [formMode, setFormMode] = useState('quick'); // 'quick' o 'wizard'
    const [wizardStep, setWizardStep] = useState(1);
    const [showMovements, setShowMovements] = useState(false);

    // Resetear paso y modo al abrir/cerrar
    useEffect(() => {
        if (isOpen) {
            setWizardStep(1);
            setFormMode('quick');
        }
    }, [isOpen]);

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
        categories
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
