import React, { useRef, useState, useEffect } from 'react';
import { Camera, X, AlertTriangle, Package, Tag, Barcode, Eye, ShoppingBag, Zap, Boxes, Landmark, Banknote, Lock, DollarSign } from 'lucide-react';
import CustomSelect from '../CustomSelect';

export default function ProductFormWizard({
    wizardStep,
    image, setImage,
    name, setName,
    barcode, setBarcode,
    category, setCategory,
    priceUsd, handlePriceUsdChange,
    priceBsManual, setPriceBsManual,
    priceBsUsdRef, setPriceBsUsdRef,
    costUsd, handleCostUsdChange,
    costBs, handleCostBsChange,
    stock, setStock,
    lowStockAlert, setLowStockAlert,

    sellByBox, setSellByBox,
    boxUnits, setBoxUnits,
    boxBarcode, setBoxBarcode,
    boxPriceUsd, setBoxPriceUsd,
    boxPriceBs, setBoxPriceBs,
    boxPriceBsUsdRef, setBoxPriceBsUsdRef,

    sellByHalfBox, setSellByHalfBox,
    halfBoxUnits, setHalfBoxUnits,
    halfBoxBarcode, setHalfBoxBarcode,
    halfBoxPriceUsd, setHalfBoxPriceUsd,
    halfBoxPriceBs, setHalfBoxPriceBs,

    effectiveRate,
    handleImageUpload,
    categories,
    onOpenCategoryManager,
    // Auto-Tasa
    autoCalcUnit, handleToggleAutoCalcUnit, handleUnitPriceUsdChange, handleUnitPriceBsChange,
    autoCalcBox, handleToggleAutoCalcBox, handleBoxPriceUsdChange, handleBoxPriceBsChange,
    autoCalcHalfBox, handleToggleAutoCalcHalfBox, handleHalfBoxPriceUsdChange, handleHalfBoxPriceBsChange,
    // Costo BCV
    calcCostBcv, handleToggleCalcCostBcv,
    costBcvUsd, handleCostBcvUsdChange,
    bcvRate, hasBcvRate,

    // Costo por caja
    calcCostByBox, handleToggleCalcCostByBox,
    purchaseByBoxCost, setPurchaseByBoxCost,
    purchaseBoxUnits, setPurchaseBoxUnits,
    handleBoxPurchaseCalc,
    forceBcv, setForceBcv,
}) {
    const fileInputRef = useRef(null);
    const [isPriceUsdFocused, setIsPriceUsdFocused] = useState(false);
    const [tempBsInput, setTempBsInput] = useState('');

    const [priceMode, setPriceMode] = useState(() => {
        if (priceBsUsdRef && Number(priceBsUsdRef) > 0) return 'diferenciado';
        if (priceBsManual && Number(priceBsManual) > 0) return 'fijo_bs';
        return 'standard';
    });

    useEffect(() => {
        if (priceBsUsdRef && Number(priceBsUsdRef) > 0) {
            setPriceMode('diferenciado');
        }
    }, [priceBsUsdRef]);

    // Estado local para el stock por cajas
    const [localBoxes, setLocalBoxes] = useState('');

    // Sincronizar el input de cajas con el stock de unidades
    useEffect(() => {
        if (sellByBox) {
            const units = Number(stock) || 0;
            const bUnits = parseInt(boxUnits, 10) || 1;
            const expectedBoxes = units / bUnits;
            if (Number(localBoxes) !== expectedBoxes) {
                setLocalBoxes(expectedBoxes > 0 ? expectedBoxes.toString() : '');
            }
        } else {
            setLocalBoxes('');
        }
    }, [stock, boxUnits, sellByBox]);

    const handleBoxesChange = (val) => {
        setLocalBoxes(val);
        const parsed = parseFloat(val);
        const bUnits = parseInt(boxUnits, 10) || 1;
        if (!val || isNaN(parsed)) {
            setStock('');
        } else {
            setStock(Math.round(parsed * bUnits).toString());
        }
    };

    // Auto-calcular sugerencia de unidades para 1/2 caja cuando cambian las de la caja
    useEffect(() => {
        if (sellByHalfBox && !halfBoxUnits && boxUnits) {
            const calculated = Math.floor(parseInt(boxUnits, 10) / 2);
            if (calculated > 0) {
                setHalfBoxUnits(calculated.toString());
            }
        }
    }, [boxUnits, sellByHalfBox]);

    const parsedPrice = Number(priceUsd) || 0;
    const boxUnitsCount = (sellByBox && parseInt(boxUnits, 10) > 0) ? parseInt(boxUnits, 10) : 1;
    const parsedCost = sellByBox ? ((Number(costUsd) || 0) / boxUnitsCount) : (Number(costUsd) || 0);

    // Margin calculations
    const mainMarginPct = parsedCost > 0 ? ((parsedPrice - parsedCost) / parsedCost * 100) : null;
    const mainMarginUsd = parsedPrice - parsedCost;

    return (
        <div className="space-y-4">
            {/* ─── STEP 1: IDENTIDAD DEL PRODUCTO ─── */}
            {wizardStep === 1 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
                        <span className="text-xs font-black text-[#193275] dark:text-brand uppercase tracking-widest block mb-1">Paso 1 de 4</span>
                        <h4 className="text-sm font-black text-slate-800 dark:text-white">Identidad del Producto</h4>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Sube una foto y define el nombre y la categoría.</p>
                    </div>

                    {/* Grid de Identidad: Foto + Datos Básicos */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                        {/* Foto */}
                        <div className="md:col-span-4 select-none flex flex-col">
                            <label className="text-xs font-bold text-slate-400 ml-1 mb-1.5 block uppercase">Foto del Producto</label>
                            <div 
                                onClick={() => fileInputRef.current?.click()} 
                                className="flex-1 min-h-[144px] md:min-h-0 bg-slate-50 dark:bg-slate-800 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-500 transition-colors relative overflow-hidden"
                            >
                                {image ? <img src={image} className="w-full h-full object-contain p-1" alt="Product preview" /> : (
                                    <>
                                        <Camera size={24} className="text-slate-400 mb-1" />
                                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Subir foto local</span>
                                    </>
                                )}
                                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                                {image && (
                                    <button 
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setImage(''); }} 
                                        className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-black text-white rounded-full transition-colors"
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Nombre y Categoría */}
                        <div className="md:col-span-8 flex flex-col justify-between space-y-4">
                            {/* Nombre */}
                            <div>
                                <label className="text-xs font-bold text-slate-400 ml-1 mb-1.5 block uppercase">Nombre del Artículo</label>
                                <input 
                                    value={name} 
                                    onChange={e => setName(e.target.value)} 
                                    placeholder="Ej: Ron Santa Teresa Gran Reserva 750ml"
                                    className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-[#193275]/40 text-sm" 
                                />
                            </div>

                            {/* Categoría */}
                            <div>
                                <label className="text-xs font-bold text-slate-400 ml-1 mb-1 block uppercase">Categoría</label>
                                <div className="flex gap-2">
                                    <div className="flex-1">
                                        <CustomSelect
                                            value={category}
                                            onChange={setCategory}
                                            options={categories.filter(c => c.id !== 'todos').map(c => ({ value: c.id, label: c.label }))}
                                            openDirection="up"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={onOpenCategoryManager}
                                        className="px-3 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-300 dark:hover:bg-slate-750 transition-colors shrink-0 text-xs font-bold active:scale-95"
                                        title="Crear nueva categoría"
                                    >
                                        + Nueva
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── STEP 2: FORMATOS DE VENTA Y CONTROL ─── */}
            {wizardStep === 2 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
                        <span className="text-xs font-black text-[#193275] dark:text-brand uppercase tracking-widest block mb-1">Paso 2 de 4</span>
                        <h4 className="text-sm font-black text-slate-800 dark:text-white">Formatos de Venta</h4>
                        <p className="text-[10px] text-slate-400 mt-0.5">Define si el artículo se venderá también por Caja y Media Caja con códigos propios.</p>
                    </div>

                    {/* Formato 1: Unidad */}
                    <div className="bg-slate-50/50 dark:bg-slate-850/30 p-4 rounded-xl border border-slate-100 dark:border-slate-800 space-y-2">
                        <div className="text-xs font-black text-[#193275] dark:text-brand uppercase tracking-wider flex items-center gap-1">
                            <Tag size={12} className="text-emerald-500" /> Unidad (Fijo)
                        </div>
                        <div className="relative">
                            <label className="text-[9px] font-bold text-slate-400 ml-1 mb-0.5 block">CÓDIGO DE BARRAS DE UNIDAD</label>
                            <input 
                                value={barcode} 
                                onChange={e => setBarcode(e.target.value)} 
                                placeholder="Escanear código (sep. con comas)..."
                                className="w-full bg-white dark:bg-slate-900 p-2.5 pl-8 rounded-xl font-bold text-xs text-slate-700 dark:text-white outline-none border border-slate-200 dark:border-slate-800" 
                            />
                            <Barcode size={14} className="absolute left-2.5 bottom-3.5 text-slate-400" />
                        </div>
                    </div>

                    {/* Formato 2: Caja */}
                    <div className="bg-slate-50/50 dark:bg-slate-850/30 p-4 rounded-xl border border-slate-100 dark:border-slate-800 space-y-3">
                        <label className="flex items-center gap-3 cursor-pointer select-none">
                            <div className={`w-10 h-5.5 rounded-full relative transition-colors duration-200 shrink-0 ${sellByBox ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-650'}`}
                                onClick={() => {
                                    const next = !sellByBox;
                                    setSellByBox(next);
                                    if (!next) setSellByHalfBox(false);
                                }}>
                                <div className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform duration-200 ${sellByBox ? 'translate-x-[20px]' : 'translate-x-0.5'}`} />
                            </div>
                            <div onClick={() => {
                                const next = !sellByBox;
                                setSellByBox(next);
                                if (!next) setSellByHalfBox(false);
                            }}>
                                <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1">
                                    <Package size={12} /> Habilitar venta por Caja
                                </span>
                            </div>
                        </label>
                        {sellByBox && (
                            <div className="grid grid-cols-2 gap-3 pt-1 animate-in fade-in slide-in-from-top-1">
                                <div>
                                    <label className="text-[9px] font-bold text-slate-400 ml-1 mb-0.5 block">UNIDADES POR CAJA</label>
                                    <input 
                                        type="number" 
                                        value={boxUnits} 
                                        onChange={e => setBoxUnits(e.target.value)} 
                                        placeholder="Ej: 36"
                                        className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-bold text-xs text-slate-700 dark:text-white outline-none border border-slate-200 dark:border-slate-800" 
                                    />
                                </div>
                                <div className="relative">
                                    <label className="text-[9px] font-bold text-slate-400 ml-1 mb-0.5 block">CÓD. BARRAS CAJA</label>
                                    <input 
                                        type="text" 
                                        value={boxBarcode} 
                                        onChange={e => setBoxBarcode(e.target.value)} 
                                        placeholder="Código caja (sep. con comas)..."
                                        className="w-full bg-white dark:bg-slate-900 p-2.5 pl-8 rounded-xl font-bold text-xs text-slate-700 dark:text-white outline-none border border-slate-200 dark:border-slate-800" 
                                    />
                                    <Barcode size={14} className="absolute left-2.5 bottom-3.5 text-slate-400" />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Formato 3: ½ Caja */}
                    <div className="bg-slate-50/50 dark:bg-slate-850/30 p-4 rounded-xl border border-slate-100 dark:border-slate-800 space-y-3">
                        <label className={`flex items-center gap-3 select-none transition-all duration-200 ${sellByBox ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}>
                            <div className={`w-10 h-5.5 rounded-full relative transition-colors duration-200 shrink-0 ${sellByHalfBox && sellByBox ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-650'}`}
                                onClick={() => {
                                    if (sellByBox) setSellByHalfBox(!sellByHalfBox);
                                }}>
                                <div className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform duration-200 ${sellByHalfBox && sellByBox ? 'translate-x-[20px]' : 'translate-x-0.5'}`} />
                            </div>
                            <div onClick={() => {
                                if (sellByBox) setSellByHalfBox(!sellByHalfBox);
                            }}>
                                <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1">
                                    <Package size={12} /> Habilitar venta por ½ Caja
                                </span>
                            </div>
                        </label>
                        {sellByHalfBox && (
                            <div className="grid grid-cols-2 gap-3 pt-1 animate-in fade-in slide-in-from-top-1">
                                <div>
                                    <label className="text-[9px] font-bold text-slate-400 ml-1 mb-0.5 block">UNIDADES EN ½ CAJA</label>
                                    <input 
                                        type="number" 
                                        value={halfBoxUnits} 
                                        onChange={e => setHalfBoxUnits(e.target.value)} 
                                        placeholder={boxUnits ? Math.floor(parseInt(boxUnits, 10) / 2).toString() : "18"}
                                        className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-bold text-xs text-slate-700 dark:text-white outline-none border border-slate-200 dark:border-slate-800" 
                                    />
                                </div>
                                <div className="relative">
                                    <label className="text-[9px] font-bold text-slate-400 ml-1 mb-0.5 block">CÓD. BARRAS ½ CAJA</label>
                                    <input 
                                        type="text" 
                                        value={halfBoxBarcode} 
                                        onChange={e => setHalfBoxBarcode(e.target.value)} 
                                        placeholder="Código media (sep. con comas)..."
                                        className="w-full bg-white dark:bg-slate-900 p-2.5 pl-8 rounded-xl font-bold text-xs text-slate-700 dark:text-white outline-none border border-slate-200 dark:border-slate-800" 
                                    />
                                    <Barcode size={14} className="absolute left-2.5 bottom-3.5 text-slate-400" />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ─── STEP 3: COSTOS Y PRECIOS DUALES ─── */}
            {wizardStep === 3 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
                        <span className="text-xs font-black text-[#193275] dark:text-brand uppercase tracking-widest block mb-1">Paso 3 de 4</span>
                        <h4 className="text-sm font-black text-slate-800 dark:text-white">Costos y Ganancias</h4>
                        <p className="text-[10px] text-slate-400 mt-0.5">Asigna precios en USD y en Bs independientes para cada formato.</p>
                    </div>

                    {/* Costos */}
                    <div className="bg-blue-500/5 dark:bg-blue-500/10 p-4 rounded-2xl border border-blue-500/20 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-black text-[#193275] dark:text-brand uppercase tracking-wider flex items-center gap-1.5 ml-1">
                                <Banknote size={14} className="text-blue-500" /> Costo de Adquisición
                            </span>
                            <button
                                type="button"
                                onClick={handleToggleCalcCostBcv}
                                title={calcCostBcv ? 'Tasa BCV activa: ingresas USD BCV y se calcula el costo real' : 'Activar cálculo en base a tasa oficial BCV'}
                                className={`flex items-center gap-1.5 text-[9px] font-black px-2.5 py-1 rounded-lg transition-all duration-200 active:scale-95 border ${
                                    calcCostBcv
                                        ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30 border-transparent'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-650 dark:hover:text-slate-300 border-slate-200 dark:border-slate-700'
                                }`}>
                                <Zap size={10} className={calcCostBcv ? 'fill-white' : ''} /> Tasa BCV
                            </button>
                        </div>

                        {/* Tabs Toggle: Unidad / Caja */}
                        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-[10px] font-black select-none gap-1 border border-slate-200/50 dark:border-slate-700/50">
                            <button
                                type="button"
                                onClick={() => { if (calcCostByBox) handleToggleCalcCostByBox(); }}
                                className={`flex-1 py-1.5 rounded-md transition-all flex items-center justify-center gap-1.5 ${
                                    !calcCostByBox
                                        ? 'bg-white dark:bg-slate-700 text-slate-850 dark:text-white shadow-sm'
                                        : 'text-slate-400 hover:text-slate-650 dark:hover:text-slate-350'
                                }`}
                            >
                                <Package size={12} className={!calcCostByBox ? 'text-blue-500 dark:text-blue-400' : 'text-slate-400'} /> Por Unidad
                            </button>
                            <button
                                type="button"
                                onClick={() => { if (!calcCostByBox) handleToggleCalcCostByBox(); }}
                                className={`flex-1 py-1.5 rounded-md transition-all flex items-center justify-center gap-1.5 ${
                                    calcCostByBox
                                        ? 'bg-white dark:bg-slate-700 text-slate-850 dark:text-white shadow-sm'
                                        : 'text-slate-400 hover:text-slate-650 dark:hover:text-slate-350'
                                }`}
                            >
                                <Boxes size={12} className={calcCostByBox ? 'text-blue-500 dark:text-blue-400' : 'text-slate-400'} /> Por Caja
                            </button>
                        </div>

                        {/* Sub-sección BCV (condicional) */}
                        {calcCostBcv && (
                            <div className="bg-blue-100/30 dark:bg-blue-900/10 p-2.5 rounded-xl border border-blue-200/30 space-y-1 animate-in fade-in slide-in-from-top-1 duration-150">
                                <div className="flex justify-between items-center text-[10px] text-blue-600 dark:text-blue-400 font-bold px-1">
                                    <span>Tasa Oficial BCV:</span>
                                    <span>{bcvRate.toFixed(2)} Bs/$</span>
                                </div>
                                {!hasBcvRate && (
                                    <div className="text-[9px] text-amber-500 font-bold px-1">
                                        ⚠️ Tasa BCV no disponible. Usando tasa de tienda.
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Inputs y Resultados condicionados por Modo */}
                        {calcCostByBox ? (
                            /* MODO CAJA */
                            <div className="space-y-3.5 animate-in fade-in duration-150">
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1 block pl-1">
                                            {calcCostBcv ? "Costo Caja (BCV)" : "Costo Caja"}
                                        </label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">$</span>
                                            <input
                                                type="number"
                                                inputMode="decimal"
                                                value={purchaseByBoxCost}
                                                onChange={e => {
                                                    setPurchaseByBoxCost(e.target.value);
                                                    handleBoxPurchaseCalc(e.target.value, purchaseBoxUnits);
                                                }}
                                                placeholder="0.00"
                                                className={`w-full p-2.5 pl-7 rounded-xl font-bold outline-none border transition-all text-xs ${
                                                    calcCostBcv
                                                        ? 'bg-blue-50/40 dark:bg-blue-950/10 text-blue-700 dark:text-blue-300 border-blue-200/50 dark:border-blue-800/40 focus:ring-2 focus:ring-blue-500/40'
                                                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-white border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-blue-500/40'
                                                }`}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1 block pl-1">
                                            Uds / Caja
                                        </label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">×</span>
                                            <input
                                                type="number"
                                                inputMode="numeric"
                                                value={purchaseBoxUnits}
                                                onChange={e => {
                                                    setPurchaseBoxUnits(e.target.value);
                                                    handleBoxPurchaseCalc(purchaseByBoxCost, e.target.value);
                                                }}
                                                placeholder="Uds"
                                                className="w-full bg-white dark:bg-slate-900 p-2.5 pl-7 rounded-xl font-bold text-slate-700 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-blue-500/40 outline-none text-xs"
                                            />
                                        </div>
                                    </div>
                                </div>
                                {costUsd > 0 && (
                                    <div className="bg-emerald-500/10 dark:bg-emerald-500/15 p-2.5 rounded-xl border border-emerald-500/20 text-center animate-in fade-in slide-in-from-top-1 duration-200">
                                        <span className="text-[10px] text-emerald-650 dark:text-emerald-400 font-bold block mb-0.5">
                                            ✓ Costo Unitario Calculado
                                        </span>
                                        <div className="text-xs font-black text-emerald-700 dark:text-emerald-300">
                                            ${Number(costUsd).toFixed(2)} USD <span className="text-slate-400 dark:text-slate-500 font-medium">|</span> {Number(costBs).toFixed(2)} Bs
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            /* MODO UNIDAD */
                            <div className="space-y-3.5 animate-in fade-in duration-150">
                                {calcCostBcv ? (
                                    /* Modo Unidad CON BCV */
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1 block pl-1">
                                            Costo Unidad (BCV)
                                        </label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-blue-400">$</span>
                                            <input
                                                type="number"
                                                inputMode="decimal"
                                                value={costBcvUsd}
                                                onChange={e => handleCostBcvUsdChange(e.target.value)}
                                                placeholder="0.00"
                                                className="w-full bg-blue-50/40 dark:bg-blue-950/10 p-2.5 pl-7 rounded-xl font-bold text-blue-700 dark:text-blue-300 outline-none border border-blue-200/50 dark:border-blue-800/40 focus:ring-2 focus:ring-blue-500/40 transition-all text-xs"
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    /* Modo Unidad SIN BCV */
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1 block pl-1">
                                                Costo USD
                                            </label>
                                            <div className="relative">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">$</span>
                                                <input 
                                                    type="number" 
                                                    inputMode="decimal" 
                                                    value={costUsd} 
                                                    onChange={e => handleCostUsdChange(e.target.value)} 
                                                    placeholder="0.00"
                                                    className="w-full bg-white dark:bg-slate-900 p-2.5 pl-7 rounded-xl font-bold text-slate-700 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-blue-500/40 outline-none text-xs"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1 block pl-1">
                                                Costo Bs
                                            </label>
                                            <div className="relative">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">Bs</span>
                                                <input 
                                                    type="number" 
                                                    inputMode="decimal" 
                                                    value={costBs} 
                                                    onChange={e => handleCostBsChange(e.target.value)} 
                                                    placeholder="0.00"
                                                    className="w-full bg-white dark:bg-slate-900 p-2.5 pl-8 rounded-xl font-bold text-slate-700 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-blue-500/40 outline-none text-xs"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {calcCostBcv && costUsd > 0 && (
                                    <div className="bg-emerald-500/10 dark:bg-emerald-500/15 p-2.5 rounded-xl border border-emerald-500/20 text-center animate-in fade-in slide-in-from-top-1 duration-200">
                                        <span className="text-[10px] text-emerald-650 dark:text-emerald-400 font-bold block mb-0.5">
                                            ✓ Costo Real Calculado
                                        </span>
                                        <div className="text-xs font-black text-emerald-700 dark:text-emerald-300">
                                            ${Number(costUsd).toFixed(2)} USD <span className="text-slate-400 dark:text-slate-500 font-medium">|</span> {Number(costBs).toFixed(2)} Bs
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Precios Unidad */}
                    <div className="bg-emerald-500/5 dark:bg-emerald-500/10 p-3.5 rounded-2xl border border-emerald-500/20 space-y-3">
                        <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-wider ml-1 block">
                            Regla de Tasa y Precio Venta Unidad
                        </span>

                        {/* Selector Principal de Regla de Tasa de Cobro */}
                        <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl">
                            <button
                                type="button"
                                onClick={() => {
                                    setForceBcv(false);
                                    if (priceMode === 'fijo_bs') {
                                        setPriceMode('standard');
                                        if (setPriceBsManual) setPriceBsManual('');
                                    }
                                }}
                                className={`py-2 px-1.5 rounded-lg text-[10px] font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer text-center ${
                                    !forceBcv && priceMode !== 'fijo_bs'
                                        ? 'bg-purple-600 text-white shadow-sm shadow-purple-500/20'
                                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                }`}
                            >
                                <Zap size={13} className={!forceBcv && priceMode !== 'fijo_bs' ? 'fill-white text-white' : 'text-purple-500'} />
                                <span className="truncate">Tasa del Día ({effectiveRate} Bs)</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    setForceBcv(true);
                                    if (priceMode === 'fijo_bs') {
                                        setPriceMode('standard');
                                        if (setPriceBsManual) setPriceBsManual('');
                                    }
                                    if (setPriceBsUsdRef) setPriceBsUsdRef('');
                                }}
                                className={`py-2 px-1.5 rounded-lg text-[10px] font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer text-center ${
                                    forceBcv
                                        ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                }`}
                            >
                                <Landmark size={13} className={forceBcv ? 'text-white' : 'text-blue-500'} />
                                <span className="truncate">Tasa BCV ({bcvRate || effectiveRate} Bs)</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    setForceBcv(false);
                                    setPriceMode('fijo_bs');
                                    if (setPriceBsUsdRef) setPriceBsUsdRef('');
                                }}
                                className={`py-2 px-1.5 rounded-lg text-[10px] font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer text-center ${
                                    !forceBcv && priceMode === 'fijo_bs'
                                        ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-500/20'
                                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                }`}
                            >
                                <Lock size={12} className={!forceBcv && priceMode === 'fijo_bs' ? 'text-white' : 'text-emerald-500'} />
                                <span className="truncate">Precio Fijo Bs</span>
                            </button>
                        </div>

                        {/* Sub-selector de Estrategia para Tasa del Día */}
                        {!forceBcv && priceMode !== 'fijo_bs' && (
                            <div className="flex bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl gap-1">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPriceMode('standard');
                                        if (setPriceBsUsdRef) setPriceBsUsdRef('');
                                        if (setPriceBsManual) setPriceBsManual('');
                                    }}
                                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                        priceMode === 'standard'
                                            ? 'bg-white dark:bg-slate-700 text-[#193275] dark:text-brand shadow-sm'
                                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                    }`}
                                >
                                    <DollarSign size={13} className={priceMode === 'standard' ? 'text-emerald-500' : 'text-slate-400'} /> Precio Único USD
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPriceMode('diferenciado');
                                        if (setPriceBsManual) setPriceBsManual('');
                                    }}
                                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                        priceMode === 'diferenciado'
                                            ? 'bg-purple-600 text-white shadow-sm shadow-purple-500/20'
                                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                    }`}
                                >
                                    <Zap size={13} className={priceMode === 'diferenciado' ? 'fill-white text-white' : 'text-purple-500'} /> Diferenciado ($ / Bs)
                                </button>
                            </div>
                        )}

                        {/* Banner informativo de Tasa BCV Oficial */}
                        {forceBcv && (
                            <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 text-xs font-medium text-blue-700 dark:text-blue-300 flex items-center gap-2">
                                <Landmark size={16} className="shrink-0 text-blue-600 dark:text-blue-400" />
                                <span>
                                    <strong>Producto Regulado (Víveres):</strong> Se calculará en Bolívares a la Tasa BCV Oficial vigente ({bcvRate || effectiveRate} Bs/$).
                                </span>
                            </div>
                        )}

                        {/* Fila de Inputs de Precios según modo activo */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                            {priceMode === 'standard' && (
                                <>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 flex items-center justify-between">
                                            <span className="flex items-center gap-1"><DollarSign size={11} className="text-emerald-500" /> PRECIO USD ($)</span>
                                            {effectiveRate > 0 && parsedPrice > 0 && (
                                                <span className="text-[8px] text-emerald-600 font-bold">Ref: {Math.round(parsedPrice * (forceBcv ? (bcvRate || effectiveRate) : effectiveRate))} Bs</span>
                                            )}
                                        </label>
                                        <input 
                                            type="number" 
                                            inputMode="decimal" 
                                            value={isPriceUsdFocused ? priceUsd : (priceUsd && !isNaN(priceUsd) && Number(priceUsd) > 0 ? Number(priceUsd).toFixed(2) : priceUsd)} 
                                            onFocus={() => setIsPriceUsdFocused(true)}
                                            onBlur={() => setIsPriceUsdFocused(false)}
                                            onChange={e => {
                                                setTempBsInput('');
                                                handleUnitPriceUsdChange(e.target.value);
                                            }} 
                                            placeholder="25.00"
                                            className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-black text-xs text-[#193275] dark:text-brand outline-none border border-slate-200 dark:border-slate-850" 
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-purple-600 dark:text-purple-400 ml-1 mb-1 flex items-center justify-between">
                                            <span>INGRESAR EN BS (CALCULA USD)</span>
                                        </label>
                                        <input 
                                            type="number" 
                                            inputMode="decimal" 
                                            value={tempBsInput} 
                                            onChange={e => {
                                                const val = e.target.value;
                                                setTempBsInput(val);
                                                const num = parseFloat(val);
                                                const activeRate = forceBcv ? (bcvRate || effectiveRate) : effectiveRate;
                                                if (!isNaN(num) && num > 0 && activeRate > 0) {
                                                    const calculatedUsd = num / activeRate;
                                                    handleUnitPriceUsdChange(calculatedUsd.toString());
                                                } else if (val === '') {
                                                    handleUnitPriceUsdChange('');
                                                }
                                            }} 
                                            placeholder="Ej: 650"
                                            className="w-full bg-purple-50/40 dark:bg-purple-950/20 p-2.5 rounded-xl font-black text-xs text-purple-700 dark:text-purple-300 outline-none border border-purple-200 dark:border-purple-800" 
                                        />
                                        <span className="text-[8px] text-purple-500 font-medium block mt-0.5 ml-1">Escribe en Bs y calcula USD automático</span>
                                    </div>
                                </>
                            )}

                            {priceMode === 'diferenciado' && (
                                <>
                                    <div>
                                        <label className="text-[10px] font-black text-slate-500 dark:text-slate-300 ml-1 mb-1 flex items-center gap-1">
                                            <Banknote size={12} className="text-emerald-500" /> PAGO DIVISA USD ($)
                                        </label>
                                        <input 
                                            type="number" 
                                            inputMode="decimal" 
                                            value={priceUsd} 
                                            onChange={e => handleUnitPriceUsdChange(e.target.value)} 
                                            placeholder="25.00"
                                            className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-black text-xs text-[#193275] dark:text-brand outline-none border border-slate-200 dark:border-slate-850" 
                                        />
                                        <span className="text-[8px] text-slate-400 font-medium block mt-0.5 ml-1">En billetes efectivo/divisas</span>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-purple-600 dark:text-purple-400 ml-1 mb-1 flex items-center gap-1">
                                            <Zap size={12} className="text-purple-500 fill-purple-500/20" /> PRECIO REF. BS ($)
                                        </label>
                                        <input 
                                            type="number" 
                                            inputMode="decimal" 
                                            value={priceBsUsdRef} 
                                            onChange={e => setPriceBsUsdRef && setPriceBsUsdRef(e.target.value)} 
                                            placeholder="26.00"
                                            className="w-full bg-purple-50/50 dark:bg-purple-950/30 p-2.5 rounded-xl font-black text-xs text-purple-700 dark:text-purple-300 outline-none border border-purple-200 dark:border-purple-800" 
                                        />
                                        {effectiveRate > 0 && Number(priceBsUsdRef) > 0 && (
                                            <span className="text-[8px] text-purple-600 dark:text-purple-400 font-bold block mt-0.5 ml-1">
                                                = {Math.round(Number(priceBsUsdRef) * effectiveRate).toLocaleString('es-VE')} Bs al cobro en Bs
                                            </span>
                                        )}
                                    </div>
                                </>
                            )}

                            {priceMode === 'fijo_bs' && (
                                <>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block">PRECIO USD ($)</label>
                                        <input 
                                            type="number" 
                                            inputMode="decimal" 
                                            value={priceUsd} 
                                            onChange={e => handleUnitPriceUsdChange(e.target.value)} 
                                            placeholder="25.00"
                                            className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-black text-xs text-[#193275] dark:text-brand outline-none border border-slate-200 dark:border-slate-850" 
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 ml-1 mb-1 block">PRECIO BS (FIJO)</label>
                                        <input 
                                            type="number" 
                                            inputMode="decimal" 
                                            value={priceBsManual} 
                                            onChange={e => handleUnitPriceBsChange(e.target.value)} 
                                            placeholder="650.00"
                                            className="w-full bg-emerald-50/50 dark:bg-emerald-950/20 p-2.5 rounded-xl font-black text-xs text-emerald-600 dark:text-emerald-400 outline-none border border-emerald-300 dark:border-emerald-700" 
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Precios Caja */}
                    {sellByBox && (
                        <div className="bg-emerald-500/5 dark:bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 animate-in fade-in slide-in-from-top-1">
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[9px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest ml-1">Precio de Venta Caja ({boxUnits} uds)</span>
                                <button
                                    type="button"
                                    onClick={handleToggleAutoCalcBox}
                                    disabled={forceBcv}
                                    title={forceBcv ? 'Forzado a tasa BCV (Auto-Tasa obligatorio)' : (autoCalcBox ? 'Auto-Tasa activo' : 'Activar cálculo automático USD ⇔ Bs')}
                                    className={`flex items-center gap-1 text-[9px] font-black px-2.5 py-1 rounded-lg transition-all ${
                                        forceBcv
                                            ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30 cursor-not-allowed opacity-80'
                                            : autoCalcBox
                                                ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30 active:scale-95'
                                                : 'bg-white/70 dark:bg-slate-800 text-slate-400 hover:text-slate-655 dark:hover:text-slate-350 border border-emerald-200 dark:border-slate-700 active:scale-95'
                                    }`}
                                >
                                    <Zap size={10} className={(autoCalcBox || forceBcv) ? 'fill-white' : ''} /> Auto-Tasa
                                </button>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <input type="number" inputMode="decimal" value={boxPriceUsd} onChange={e => handleBoxPriceUsdChange(e.target.value)} placeholder="Precio USD ($)"
                                    className="w-full bg-white dark:bg-slate-900 p-2 rounded-xl font-black text-xs text-slate-750 dark:text-blue-500 outline-none border border-slate-200 dark:border-slate-800" />
                                <div>
                                    <input type="number" inputMode="decimal" value={boxPriceBs} onChange={e => handleBoxPriceBsChange(e.target.value)} placeholder="Precio Bs (Manual)"
                                        disabled={forceBcv}
                                        className={`w-full p-2 rounded-xl font-black text-xs outline-none border transition-all duration-200 ${
                                            forceBcv
                                                ? 'text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-700 bg-blue-50/30 dark:bg-blue-900/10 cursor-not-allowed'
                                                : autoCalcBox
                                                    ? 'text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/10'
                                                    : 'text-slate-750 dark:text-blue-500 border-slate-200 dark:border-slate-800'
                                        }`} />
                                    {effectiveRate > 0 && Number(boxPriceUsd) > 0 && (
                                        <span className="text-[8px] text-slate-400 font-medium block mt-0.5 ml-1">Ref: {Math.round(Number(boxPriceUsd) * (forceBcv ? (bcvRate || effectiveRate) : effectiveRate))} Bs</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {sellByHalfBox && (
                        <div className="bg-emerald-500/5 dark:bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 animate-in fade-in slide-in-from-top-1">
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[9px] font-black text-purple-600 dark:text-purple-400 uppercase tracking-widest ml-1">Precio de Venta ½ Caja ({halfBoxUnits} uds)</span>
                                <button
                                    type="button"
                                    onClick={handleToggleAutoCalcHalfBox}
                                    disabled={forceBcv}
                                    title={forceBcv ? 'Forzado a tasa BCV (Auto-Tasa obligatorio)' : (autoCalcHalfBox ? 'Auto-Tasa activo' : 'Activar cálculo automático USD ⇔ Bs')}
                                    className={`flex items-center gap-1 text-[9px] font-black px-2.5 py-1 rounded-lg transition-all ${
                                        forceBcv
                                            ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30 cursor-not-allowed opacity-80'
                                            : autoCalcHalfBox
                                                ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30 active:scale-95'
                                                : 'bg-white/70 dark:bg-slate-800 text-slate-400 hover:text-slate-655 dark:hover:text-slate-350 border border-purple-200 dark:border-slate-700 active:scale-95'
                                    }`}
                                >
                                    <Zap size={10} className={(autoCalcHalfBox || forceBcv) ? 'fill-white' : ''} /> Auto-Tasa
                                </button>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <input type="number" inputMode="decimal" value={halfBoxPriceUsd} onChange={e => handleHalfBoxPriceUsdChange(e.target.value)} placeholder="Precio USD ($)"
                                    className="w-full bg-white dark:bg-slate-900 p-2 rounded-xl font-black text-xs text-slate-750 dark:text-purple-500 outline-none border border-slate-200 dark:border-slate-800" />
                                <div>
                                    <input type="number" inputMode="decimal" value={halfBoxPriceBs} onChange={e => handleHalfBoxPriceBsChange(e.target.value)} placeholder="Precio Bs (Manual)"
                                        disabled={forceBcv}
                                        className={`w-full p-2 rounded-xl font-black text-xs outline-none border transition-all duration-200 ${
                                            forceBcv
                                                ? 'text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-700 bg-blue-50/30 dark:bg-blue-900/10 cursor-not-allowed'
                                                : autoCalcHalfBox
                                                    ? 'text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/10'
                                                    : 'text-slate-750 dark:text-purple-500 border-slate-200 dark:border-slate-800'
                                        }`} />
                                    {effectiveRate > 0 && Number(halfBoxPriceUsd) > 0 && (
                                        <span className="text-[8px] text-slate-400 font-medium block mt-0.5 ml-1">Ref: {Math.round(Number(halfBoxPriceUsd) * (forceBcv ? (bcvRate || effectiveRate) : effectiveRate))} Bs</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Margen de Ganancia Unidad */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3.5 rounded-xl text-xs flex justify-between items-center">
                        <span className="text-slate-400 font-bold">Margen / Unidad:</span>
                        {parsedPrice > 0 && parsedCost > 0 ? (
                            <span className={`font-black ${mainMarginPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                {mainMarginPct.toFixed(1)}% (${mainMarginUsd.toFixed(2)})
                            </span>
                        ) : (
                            <span className="text-slate-400 italic">Requiere precio y costo</span>
                        )}
                    </div>
                </div>
            )}

            {/* ─── STEP 4: RESUMEN Y CONFIGURACION STOCK ─── */}
            {wizardStep === 4 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
                        <span className="text-xs font-black text-[#193275] dark:text-brand uppercase tracking-widest block mb-1">Paso 4 de 4</span>
                        <h4 className="text-sm font-black text-slate-800 dark:text-white">Inventario y Confirmación</h4>
                        <p className="text-[10px] text-slate-400 mt-0.5">Ingresa el stock físico del producto y confirma la ficha.</p>
                    </div>

                    {/* Stock & Alerta inputs */}
                    <div className={`grid gap-3 ${sellByBox ? 'grid-cols-3' : 'grid-cols-2'}`}>
                        {sellByBox && (
                            <div>
                                <label className="text-xs font-bold text-slate-400 ml-1 mb-1 block uppercase">Stock (Cajas)</label>
                                <input 
                                    type="number" 
                                    step="any"
                                    inputMode="decimal" 
                                    value={localBoxes} 
                                    onChange={e => handleBoxesChange(e.target.value)} 
                                    placeholder="0"
                                    className="w-full bg-slate-50 dark:bg-slate-800 p-3 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/40 text-sm" 
                                />
                            </div>
                        )}
                        <div>
                            <label className="text-xs font-bold text-slate-400 ml-1 mb-1 block uppercase">Stock Inicial (Uds)</label>
                            <input type="number" inputMode="numeric" value={stock} onChange={e => setStock(e.target.value)} placeholder="0"
                                className="w-full bg-slate-50 dark:bg-slate-800 p-3 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/40 text-sm" />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-amber-500 ml-1 mb-1 block uppercase flex items-center gap-1">
                                <AlertTriangle size={10} /> Alerta Mínima
                            </label>
                            <input type="number" inputMode="numeric" value={lowStockAlert} onChange={e => setLowStockAlert(e.target.value)} placeholder="5"
                                className="w-full bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30 p-3 rounded-xl font-bold text-amber-700 dark:text-amber-400 outline-none focus:ring-2 focus:ring-amber-500/50 text-sm" />
                        </div>
                    </div>

                    {/* Previsualización de Ficha de Producto */}
                    <div className="bg-gradient-to-br from-slate-50 to-white dark:from-slate-850 dark:to-slate-900 p-4 rounded-2xl border border-slate-200/50 dark:border-slate-800 shadow-md relative overflow-hidden flex gap-4 items-center">
                        <div className="w-14 h-14 bg-slate-100 dark:bg-slate-700 rounded-xl flex items-center justify-center shrink-0 border border-slate-200/50 overflow-hidden shadow-inner">
                            {image ? <img src={image} className="w-full h-full object-contain p-0.5" alt="Preview" /> : <ShoppingBag size={24} className="text-slate-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <span className="bg-[#193275]/10 dark:bg-brand/10 text-[#193275] dark:text-brand text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full inline-block mb-1">
                                {categories.find(c => c.id === category)?.label || category || 'Sin categoría'}
                            </span>
                            <h3 className="font-bold text-slate-850 dark:text-white text-sm truncate capitalize leading-tight">
                                {name || 'Sin nombre'}
                            </h3>
                            <div className="text-xs font-black text-slate-800 dark:text-white mt-1">
                                ${parsedPrice.toFixed(2)} / {priceBsManual ? `${Number(priceBsManual).toFixed(2)} Bs` : `${(parsedPrice * (forceBcv ? (bcvRate || effectiveRate) : effectiveRate)).toFixed(2)} Bs`}
                            </div>
                        </div>
                        <div className="absolute right-3 top-3">
                            <Eye size={14} className="text-slate-350" />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
