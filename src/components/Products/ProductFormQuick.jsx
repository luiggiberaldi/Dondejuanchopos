import React, { useRef, useState, useEffect } from 'react';
import { Camera, X, AlertTriangle, Package, Tag, Scale, ChevronDown, ChevronUp, Barcode, Banknote, CheckCircle, Zap, Boxes } from 'lucide-react';
import CustomSelect from '../CustomSelect';

export default function ProductFormQuick({
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
}) {
    const fileInputRef = useRef(null);
    const [showSummary, setShowSummary] = useState(false);

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

    // Calcular margen de ganancia de la unidad
    const mainMarginPct = parsedCost > 0 ? ((parsedPrice - parsedCost) / parsedCost * 100) : null;
    const mainMarginUsd = parsedPrice - parsedCost;

    return (
        <div className="space-y-5">
            {/* Cabecera del Formulario: Imagen + Datos Básicos */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                {/* Foto del Producto */}
                <div className="md:col-span-4 select-none flex flex-col">
                    <label className="text-xs font-bold text-slate-400 ml-1 mb-1.5 block uppercase">Foto del Producto</label>
                    <div 
                        onClick={() => fileInputRef.current?.click()} 
                        className="flex-1 min-h-[144px] bg-slate-50 dark:bg-slate-800 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-500 transition-colors relative overflow-hidden"
                    >
                        {image ? (
                            <img src={image} className="w-full h-full object-contain p-1" alt="Product preview" />
                        ) : (
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
                    {/* Nombre del Producto */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 ml-1 mb-1.5 block uppercase">Nombre del Artículo</label>
                        <input 
                            type="text" 
                            value={name} 
                            onChange={e => setName(e.target.value)} 
                            placeholder="Ej: Ron Santa Teresa Gran Reserva 750ml"
                            className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" 
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

            {/* SECCIÓN COSTO */}
            <div className="bg-blue-500/5 dark:bg-blue-500/10 p-4 rounded-2xl border border-blue-500/20 space-y-3">
                <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest block ml-1">
                        Costo de Adquisición
                    </span>
                    <button
                        type="button"
                        onClick={handleToggleCalcCostBcv}
                        title={calcCostBcv ? 'Tasa BCV activa: ingresas USD BCV y se calcula el costo real' : 'Activar cálculo en base a tasa oficial BCV'}
                        className={`flex items-center gap-1.5 text-[9px] font-black px-2.5 py-1 rounded-lg transition-all duration-200 active:scale-95 border ${
                            calcCostBcv
                                ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30 border-transparent'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-650 dark:hover:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                    >
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

            {/* FORMATOS DE VENTA */}
            <div className="space-y-4">
                <label className="text-xs font-black text-slate-400 ml-1 mb-0.5 block uppercase tracking-wider">Formatos de Venta</label>
                
                {/* Formato 1: Unidad (Fijo) */}
                <div className="bg-emerald-500/5 dark:bg-emerald-500/10 p-4 rounded-2xl border border-emerald-500/20 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-[#193275] dark:text-brand uppercase tracking-wider flex items-center gap-1.5">
                            <Tag size={14} className="text-emerald-500" /> Venta por Unidad (Fijo)
                        </span>
                        <button
                            type="button"
                            onClick={handleToggleAutoCalcUnit}
                            title={autoCalcUnit ? 'Auto-Tasa activo: USD⇔Bs según tasa' : 'Activar cálculo automático USD ⇔ Bs'}
                            className={`flex items-center gap-1.5 text-[9px] font-black px-2.5 py-1 rounded-lg transition-all duration-200 active:scale-95 ${
                                autoCalcUnit
                                    ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 border border-slate-200 dark:border-slate-700'
                            }`}
                        >
                            <Zap size={10} className={autoCalcUnit ? 'fill-white' : ''} /> Auto-Tasa
                        </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="relative">
                            <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block">CÓD. BARRAS</label>
                            <input 
                                type="text" 
                                value={barcode} 
                                onChange={e => setBarcode(e.target.value)} 
                                placeholder="Escanear o ingresar (sep. con comas)..."
                                className="w-full bg-white dark:bg-slate-900 p-2.5 pl-8 rounded-xl font-bold text-xs text-slate-750 dark:text-white outline-none border border-slate-200 dark:border-slate-850" 
                            />
                            <Barcode size={14} className="absolute left-2.5 bottom-3.5 text-slate-400" />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block h-4 flex items-center">PRECIO USD ($)</label>
                            <input 
                                type="number" 
                                inputMode="decimal" 
                                value={priceUsd} 
                                onChange={e => handleUnitPriceUsdChange(e.target.value)} 
                                placeholder="1.50"
                                className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-black text-xs text-[#193275] dark:text-brand outline-none border border-slate-200 dark:border-slate-850" 
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold ml-1 mb-1 h-4 flex items-center justify-between">
                                <span className={`transition-colors duration-200 ${ autoCalcUnit ? 'text-emerald-500' : 'text-slate-400' }`}>
                                    PRECIO BS
                                </span>
                                {effectiveRate > 0 && parsedPrice > 0 && (
                                    <span className="text-[8px] text-slate-400 font-medium whitespace-nowrap">Ref: {Math.round(parsedPrice * effectiveRate)} Bs</span>
                                )}
                            </label>
                            <input 
                                type="number" 
                                inputMode="decimal" 
                                value={priceBsManual} 
                                onChange={e => handleUnitPriceBsChange(e.target.value)} 
                                placeholder="0.00"
                                className={`w-full p-2.5 rounded-xl font-black text-xs outline-none border transition-all duration-200 ${
                                    autoCalcUnit
                                        ? 'text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/10'
                                        : 'bg-white dark:bg-slate-900 text-[#193275] dark:text-brand border-slate-200 dark:border-slate-850'
                                }`}
                            />
                        </div>
                    </div>
                </div>

                {/* Formato 2: Caja (Toggle) */}
                <div className="bg-emerald-500/5 dark:bg-emerald-500/10 p-4 rounded-2xl border border-emerald-500/20 space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer select-none">
                        <div 
                            className={`w-10 h-5.5 rounded-full relative transition-colors duration-200 shrink-0 ${sellByBox ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-650'}`}
                            onClick={() => {
                                const next = !sellByBox;
                                setSellByBox(next);
                                if (!next) setSellByHalfBox(false);
                            }}
                        >
                            <div className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform duration-200 ${sellByBox ? 'translate-x-[20px]' : 'translate-x-0.5'}`} />
                        </div>
                        <div 
                            onClick={() => {
                                const next = !sellByBox;
                                setSellByBox(next);
                                if (!next) setSellByHalfBox(false);
                            }} 
                            className="flex-1"
                        >
                            <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                                <Package size={14} className={sellByBox ? 'text-emerald-500' : 'text-slate-400'} /> ¿Vender por Caja?
                            </span>
                            <p className="text-[9px] text-slate-400 mt-0.5">Permite vender la caja cerrada (huacal o bulto) con precio especial</p>
                        </div>
                    </label>

                    {sellByBox && (
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="sm:col-span-4 flex items-center justify-between">
                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Precios de Caja</span>
                                <button
                                    type="button"
                                    onClick={handleToggleAutoCalcBox}
                                    title={autoCalcBox ? 'Auto-Tasa activo' : 'Activar cálculo automático USD ⇔ Bs'}
                                    className={`flex items-center gap-1.5 text-[9px] font-black px-2.5 py-1 rounded-lg transition-all duration-200 active:scale-95 ${
                                        autoCalcBox
                                            ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30'
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 border border-slate-200 dark:border-slate-700'
                                    }`}
                                >
                                    <Zap size={10} className={autoCalcBox ? 'fill-white' : ''} /> Auto-Tasa
                                </button>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block">UDS POR CAJA</label>
                                <input 
                                    type="number" 
                                    inputMode="numeric" 
                                    value={boxUnits} 
                                    onChange={e => setBoxUnits(e.target.value)} 
                                    placeholder="Ej: 36"
                                    className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-bold text-xs text-slate-750 dark:text-white outline-none border border-slate-200 dark:border-slate-850" 
                                />
                            </div>
                            <div className="relative">
                                <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block">CÓD. BARRAS CAJA</label>
                                <input 
                                    type="text" 
                                    value={boxBarcode} 
                                    onChange={e => setBoxBarcode(e.target.value)} 
                                    placeholder="Código caja (sep. con comas)..."
                                    className="w-full bg-white dark:bg-slate-900 p-2.5 pl-8 rounded-xl font-bold text-xs text-slate-750 dark:text-white outline-none border border-slate-200 dark:border-slate-850" 
                                />
                                <Barcode size={14} className="absolute left-2.5 bottom-3.5 text-slate-400" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block">PRECIO CAJA ($)</label>
                                <input 
                                    type="number" 
                                    inputMode="decimal" 
                                    value={boxPriceUsd} 
                                    onChange={e => handleBoxPriceUsdChange(e.target.value)} 
                                    placeholder="45.00"
                                    className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-black text-xs text-[#193275] dark:text-brand outline-none border border-slate-200 dark:border-slate-850" 
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold ml-1 mb-1 h-4 flex items-center justify-between">
                                    <span className={`transition-colors duration-200 ${ autoCalcBox ? 'text-emerald-500' : 'text-slate-400' }`}>PRECIO CAJA BS</span>
                                    {effectiveRate > 0 && Number(boxPriceUsd) > 0 && (
                                        <span className="text-[8px] text-slate-400 font-medium whitespace-nowrap">Ref: {Math.round(Number(boxPriceUsd) * effectiveRate)} Bs</span>
                                    )}
                                </label>
                                <input 
                                    type="number" 
                                    inputMode="decimal" 
                                    value={boxPriceBs} 
                                    onChange={e => handleBoxPriceBsChange(e.target.value)} 
                                    placeholder="1700.00"
                                    className={`w-full p-2.5 rounded-xl font-black text-xs outline-none border transition-all duration-200 ${
                                        autoCalcBox
                                            ? 'text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/10'
                                            : 'bg-white dark:bg-slate-900 text-[#193275] dark:text-brand border-slate-200 dark:border-slate-850'
                                    }`}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Formato 3: ½ Caja (Toggle) */}
                <div className="bg-emerald-500/5 dark:bg-emerald-500/10 p-4 rounded-2xl border border-emerald-500/20 space-y-3">
                    <label className={`flex items-center gap-3 select-none transition-all duration-200 ${sellByBox ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}>
                        <div 
                            className={`w-10 h-5.5 rounded-full relative transition-colors duration-200 shrink-0 ${sellByHalfBox && sellByBox ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-650'}`}
                            onClick={() => {
                                if (sellByBox) setSellByHalfBox(!sellByHalfBox);
                            }}
                        >
                            <div className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform duration-200 ${sellByHalfBox && sellByBox ? 'translate-x-[20px]' : 'translate-x-0.5'}`} />
                        </div>
                        <div 
                            onClick={() => {
                                if (sellByBox) setSellByHalfBox(!sellByHalfBox);
                            }} 
                            className="flex-1"
                        >
                            <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                                <Package size={14} className={sellByHalfBox && sellByBox ? 'text-emerald-500' : 'text-slate-400'} /> ¿Vender por ½ Caja?
                            </span>
                            <p className="text-[9px] text-slate-400 mt-0.5">Permite vender la mitad de la caja con su propio precio {!sellByBox && <span className="text-rose-500 font-bold">(Requiere activar Caja primero)</span>}</p>
                        </div>
                    </label>

                    {sellByHalfBox && (
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="sm:col-span-4 flex items-center justify-between">
                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Precios de ½ Caja</span>
                                <button
                                    type="button"
                                    onClick={handleToggleAutoCalcHalfBox}
                                    title={autoCalcHalfBox ? 'Auto-Tasa activo' : 'Activar cálculo automático USD ⇔ Bs'}
                                    className={`flex items-center gap-1.5 text-[9px] font-black px-2.5 py-1 rounded-lg transition-all duration-200 active:scale-95 ${
                                        autoCalcHalfBox
                                            ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30'
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 border border-slate-200 dark:border-slate-700'
                                    }`}
                                >
                                    <Zap size={10} className={autoCalcHalfBox ? 'fill-white' : ''} /> Auto-Tasa
                                </button>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block">UDS POR ½ CAJA</label>
                                <input 
                                    type="number" 
                                    inputMode="numeric" 
                                    value={halfBoxUnits} 
                                    onChange={e => setHalfBoxUnits(e.target.value)} 
                                    placeholder={boxUnits ? Math.floor(parseInt(boxUnits, 10) / 2).toString() : "18"}
                                    className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-bold text-xs text-slate-750 dark:text-white outline-none border border-slate-200 dark:border-slate-850" 
                                />
                            </div>
                            <div className="relative">
                                <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block">CÓD. BARRAS ½ CAJA</label>
                                <input 
                                    type="text" 
                                    value={halfBoxBarcode} 
                                    onChange={e => setHalfBoxBarcode(e.target.value)} 
                                    placeholder="Código media (sep. con comas)..."
                                    className="w-full bg-white dark:bg-slate-900 p-2.5 pl-8 rounded-xl font-bold text-xs text-slate-750 dark:text-white outline-none border border-slate-200 dark:border-slate-850" 
                                />
                                <Barcode size={14} className="absolute left-2.5 bottom-3.5 text-slate-400" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block">PRECIO ½ CAJA ($)</label>
                                <input 
                                    type="number" 
                                    inputMode="decimal" 
                                    value={halfBoxPriceUsd} 
                                    onChange={e => handleHalfBoxPriceUsdChange(e.target.value)} 
                                    placeholder="24.00"
                                    className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-black text-xs text-[#193275] dark:text-brand outline-none border border-slate-200 dark:border-slate-850" 
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold ml-1 mb-1 h-4 flex items-center justify-between">
                                    <span className={`transition-colors duration-200 ${ autoCalcHalfBox ? 'text-emerald-500' : 'text-slate-400' }`}>PRECIO ½ CAJA BS</span>
                                    {effectiveRate > 0 && Number(halfBoxPriceUsd) > 0 && (
                                        <span className="text-[8px] text-slate-400 font-medium whitespace-nowrap">Ref: {Math.round(Number(halfBoxPriceUsd) * effectiveRate)} Bs</span>
                                    )}
                                </label>
                                <input 
                                    type="number" 
                                    inputMode="decimal" 
                                    value={halfBoxPriceBs} 
                                    onChange={e => handleHalfBoxPriceBsChange(e.target.value)} 
                                    placeholder="900.00"
                                    className={`w-full p-2.5 rounded-xl font-black text-xs outline-none border transition-all duration-200 ${
                                        autoCalcHalfBox
                                            ? 'text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/10'
                                            : 'bg-white dark:bg-slate-900 text-[#193275] dark:text-brand border-slate-200 dark:border-slate-850'
                                    }`}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* MARGEN DE GANANCIA (SÓLO DE LA UNIDAD) */}
            <div className={`p-3.5 rounded-xl border space-y-1.5 min-h-[60px] ${mainMarginPct !== null && mainMarginPct < 0
                ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/30'
                : mainMarginPct !== null && mainMarginPct === 0
                    ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30'
                    : 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-800'
                }`}>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Margen de Ganancia de Unidad</p>
                {parsedPrice > 0 && parsedCost > 0 ? (
                    <div className="space-y-1.5">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500 font-medium">Margen / Unidad:</span>
                            <span className={`font-black ${mainMarginPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                {mainMarginPct.toFixed(1)}%
                                <span className="text-xs ml-1.5 opacity-80 font-bold">(${mainMarginUsd.toFixed(2)})</span>
                            </span>
                        </div>
                        {mainMarginPct < 0 && (
                            <p className="text-[10px] font-bold text-rose-500 flex items-center gap-1 mt-1">
                                <AlertTriangle size={11} /> Estás vendiendo a pérdida
                            </p>
                        )}
                        {mainMarginPct === 0 && (
                            <p className="text-[10px] font-bold text-amber-500 flex items-center gap-1 mt-1">
                                <AlertTriangle size={11} /> Punto de equilibrio (sin ganancia)
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="text-xs text-slate-400 italic">
                        Ingresa precio y costo para ver la ganancia de la unidad.
                    </div>
                )}
            </div>

            {/* SECCIÓN STOCK Y ALERTA MÍNIMA */}
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
                            className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/40 text-sm" 
                        />
                    </div>
                )}
                <div>
                    <label className="text-xs font-bold text-slate-400 ml-1 mb-1 block uppercase">Stock (Unidades)</label>
                    <input 
                        type="number" 
                        inputMode="numeric" 
                        value={stock} 
                        onChange={e => setStock(e.target.value)} 
                        placeholder="0"
                        className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/40 text-sm" 
                    />
                </div>
                <div>
                    <label className="text-xs font-bold text-amber-500 ml-1 mb-1 block uppercase flex items-center gap-1">
                        <AlertTriangle size={10} /> Alerta mín. (Uds)
                    </label>
                    <input 
                        type="number" 
                        inputMode="numeric" 
                        value={lowStockAlert} 
                        onChange={e => setLowStockAlert(e.target.value)} 
                        placeholder="5"
                        className="w-full bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30 p-3.5 rounded-xl font-bold text-amber-700 dark:text-amber-400 outline-none focus:ring-2 focus:ring-amber-500/50 text-sm" 
                    />
                </div>
            </div>

            {/* RESUMEN ANTES DE GUARDAR */}
            {name && parsedPrice > 0 && (
                <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                    <button 
                        onClick={() => setShowSummary(!showSummary)}
                        type="button"
                        className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/50 text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                    >
                        <span>📋 Resumen de Formatos</span>
                        {showSummary ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {showSummary && (
                        <div className="px-3 py-2.5 space-y-1.5 text-xs bg-white dark:bg-slate-900 animate-in fade-in slide-in-from-top-1 duration-150 border-t border-slate-100 dark:border-slate-800">
                            <div className="flex justify-between"><span className="text-slate-400">Nombre:</span><span className="font-bold text-slate-700 dark:text-white">{name}</span></div>
                            
                            {/* Unidad */}
                            <div className="border-t border-slate-100 dark:border-slate-800 pt-1.5 mt-1 text-[11px] font-bold text-[#193275] dark:text-brand">Unidad:</div>
                            <div className="flex justify-between pl-2"><span className="text-slate-400">Precio USD:</span><span className="font-bold text-emerald-600">${parsedPrice.toFixed(2)}</span></div>
                            {priceBsManual && <div className="flex justify-between pl-2"><span className="text-slate-400">Precio Bs (Manual):</span><span className="font-bold text-emerald-600">{Number(priceBsManual).toFixed(2)} Bs</span></div>}
                            
                            {/* Caja */}
                            {sellByBox && (
                                <>
                                    <div className="border-t border-slate-100 dark:border-slate-800 pt-1.5 mt-1 text-[11px] font-bold text-[#193275] dark:text-brand">Caja ({boxUnits} uds):</div>
                                    <div className="flex justify-between pl-2"><span className="text-slate-400">Precio USD:</span><span className="font-bold text-emerald-600">${(Number(boxPriceUsd) || 0).toFixed(2)}</span></div>
                                    {boxPriceBs && <div className="flex justify-between pl-2"><span className="text-slate-400">Precio Bs (Manual):</span><span className="font-bold text-emerald-600">{Number(boxPriceBs).toFixed(2)} Bs</span></div>}
                                </>
                            )}
                            
                            {/* Media Caja */}
                            {sellByHalfBox && (
                                <>
                                    <div className="border-t border-slate-100 dark:border-slate-800 pt-1.5 mt-1 text-[11px] font-bold text-[#193275] dark:text-brand">Media Caja ({halfBoxUnits} uds):</div>
                                    <div className="flex justify-between pl-2"><span className="text-slate-400">Precio USD:</span><span className="font-bold text-emerald-600">${(Number(halfBoxPriceUsd) || 0).toFixed(2)}</span></div>
                                    {halfBoxPriceBs && <div className="flex justify-between pl-2"><span className="text-slate-400">Precio Bs (Manual):</span><span className="font-bold text-emerald-600">{Number(halfBoxPriceBs).toFixed(2)} Bs</span></div>}
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
