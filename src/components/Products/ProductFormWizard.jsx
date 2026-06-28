import React, { useRef, useState } from 'react';
import { Camera, X, AlertTriangle, Package, Tag, Scale, Droplets, Barcode, Banknote, CheckCircle, Plus, Eye, ShoppingBag, Search, Link } from 'lucide-react';
import { useProductContext } from '../../context/ProductContext';
import CustomSelect from '../CustomSelect';

const PACKAGING_TYPES = [
    { id: 'suelto', label: 'Suelto', Icon: Tag, desc: 'Unidad individual', color: 'emerald' },
    { id: 'lote', label: 'Lote', Icon: Package, desc: 'Caja, bulto o paquete', color: 'indigo' },
    { id: 'granel', label: 'Granel', Icon: Scale, desc: 'Por Kg o Litro', color: 'amber' },
];

export default function ProductFormWizard({
    wizardStep,
    image, setImage,
    name, setName,
    barcode, setBarcode,
    category, setCategory,
    priceUsd, handlePriceUsdChange,
    priceBs, handlePriceBsChange,
    handlePriceCopChange,
    priceCop,
    costUsd, handleCostUsdChange,
    costBs, handleCostBsChange,
    costCop, handleCostCopChange,
    stock, setStock,
    lowStockAlert, setLowStockAlert,

    unitsPerPackage, setUnitsPerPackage,
    sellByUnit, setSellByUnit,
    unitPriceUsd, setUnitPriceUsd,
    unitPriceCop, setUnitPriceCop,

    packagingType, setPackagingType,
    stockInLotes, setStockInLotes,
    granelUnit, setGranelUnit,
    effectiveRate,
    copEnabled,
    copPrimary,
    tasaCop,

    handleImageUpload,
    categories,
    isSearchingImage,
    handleLoadImageFromUrl
}) {
    const fileInputRef = useRef(null);
    
    // Categorías en línea
    const { setCategories } = useProductContext();
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState("");

    const handleAddCategory = () => {
        if (!newCategoryName.trim()) return;
        const catId = newCategoryName.trim().toLowerCase().replace(/\s+/g, '_');
        
        setCategories(prev => {
            if(prev.find(c => c.id === catId)) return prev;
            return [...prev, { id: catId, label: newCategoryName.trim(), icon: '◆', color: 'emerald' }];
        });
        
        setCategory(catId);
        setIsAddingCategory(false);
        setNewCategoryName("");
    };

    const isLote = packagingType === 'lote';
    const isGranel = packagingType === 'granel';
    const parsedUnits = parseInt(unitsPerPackage) || 0;
    const parsedPrice = parseFloat(priceUsd) || 0;
    const parsedCost = parseFloat(costUsd) || 0;

    // Margin calculations
    const mainMarginPct = parsedCost > 0 ? ((parsedPrice - parsedCost) / parsedCost * 100) : null;
    const mainMarginUsd = parsedPrice - parsedCost;

    const effectiveUnitPrice = copEnabled && tasaCop > 0 && unitPriceCop
        ? parseFloat(unitPriceCop) / tasaCop
        : unitPriceUsd
            ? parseFloat(unitPriceUsd)
            : (parsedUnits > 0 ? parsedPrice / parsedUnits : 0);
    const unitCost = parsedUnits > 0 && parsedCost > 0 ? parsedCost / parsedUnits : 0;
    const unitMarginPct = unitCost > 0 ? ((effectiveUnitPrice - unitCost) / unitCost * 100) : null;
    const unitMarginUsd = effectiveUnitPrice - unitCost;

    const parsedStockLotes = parseInt(stockInLotes) || 0;
    const stockUnitsCalc = parsedStockLotes * (parsedUnits || 1);
    const parsedAlert = parseInt(lowStockAlert) || 0;
    const alertLotesCalc = parsedUnits > 0 ? (parsedAlert / parsedUnits) : 0;

    const granelLabel = granelUnit === 'kg' ? 'Kilo' : 'Litro';
    const priceSuffix = isLote ? ' / Lote' : isGranel ? ` / ${granelLabel}` : '';

    return (
        <div className="space-y-4">
            {/* ─── STEP 1: DATOS BASICOS ─── */}
            {wizardStep === 1 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
                        <span className="text-xs font-black text-emerald-500 uppercase tracking-widest block mb-1">Paso 1 de 4</span>
                        <h4 className="text-sm font-black text-slate-800 dark:text-white">Identidad del Producto</h4>
                        <p className="text-[10px] text-slate-400 mt-0.5">Sube una foto y define la información comercial básica.</p>
                    </div>

                    {/* Upload and Smart URL Paste Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 select-none">
                        {/* File Upload Zone */}
                        <div onClick={() => fileInputRef.current?.click()} className="sm:col-span-5 h-28 bg-slate-50 dark:bg-slate-800 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-500 transition-colors relative overflow-hidden">
                            {image ? <img src={image} className="w-full h-full object-cover" alt="Product preview" /> : (
                                <>
                                    <Camera size={22} className="text-slate-400 mb-1" />
                                    <span className="text-[10px] font-black text-slate-500">Subir foto local</span>
                                </>
                            )}
                            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                            {image && <button onClick={(e) => { e.stopPropagation(); setImage(null); }} className="absolute top-2 right-2 p-1 bg-black/50 text-white rounded-full"><X size={12} /></button>}
                        </div>

                        {/* Web Image Finder & URL Paste Zone */}
                        <div className="sm:col-span-7 h-28 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-2.5 flex flex-col justify-between">
                            <div className="flex justify-between items-center">
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Foto de la Web</span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (!name || name.trim().length < 3) {
                                            alert('Ingresa el nombre del producto (mín. 3 letras) para buscar');
                                            return;
                                        }
                                        window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(name.trim())}`, '_blank');
                                    }}
                                    className="flex items-center gap-1 text-[9px] font-extrabold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors uppercase"
                                >
                                    <Search size={10} /> Buscar en Google
                                </button>
                            </div>

                            <div className="relative mt-1">
                                <input
                                    type="url"
                                    placeholder="Pega la dirección de la imagen..."
                                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-2 py-1.5 pr-8 rounded-xl text-[11px] text-slate-700 dark:text-white outline-none focus:ring-1 focus:ring-emerald-500 placeholder-slate-400 font-bold"
                                    onChange={(e) => {
                                        const url = e.target.value.trim();
                                        if (url && url.startsWith('http')) {
                                            handleLoadImageFromUrl(url);
                                            e.target.value = ''; // limpiar input
                                        }
                                    }}
                                />
                                {isSearchingImage ? (
                                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                                        <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-emerald-500 border-t-transparent" />
                                    </div>
                                ) : (
                                    <Link size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                )}
                            </div>

                            <span className="text-[8px] text-slate-400 leading-none">
                                Copia la URL de una foto en Google y pégala aquí para cargar.
                            </span>
                        </div>
                    </div>

                    {/* Name */}
                    <div className="relative">
                        <label className="text-xs font-bold text-slate-400 ml-1 mb-1 block uppercase">Nombre comercial</label>
                        <input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="Ej: Harina PAN 1kg"
                            className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 pr-10 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50 capitalize text-sm" />
                        {name && name.trim().length >= 3 && (
                            <CheckCircle size={18} className="absolute right-3 top-[38px] text-emerald-500 transition-all duration-300" />
                        )}
                    </div>

                    {/* Barcode */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 ml-1 mb-1 block uppercase">Código de barras (Opcional)</label>
                        <div className="relative">
                            <input value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="Ej: 7591111222233"
                                className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 pl-10 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" />
                            <Barcode size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        </div>
                    </div>

                    {/* Category */}
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <label className="text-xs font-bold text-slate-400 ml-1 block uppercase">Categoría</label>
                            <button 
                                onClick={() => setIsAddingCategory(!isAddingCategory)}
                                className="text-[10px] font-bold text-emerald-500 hover:text-emerald-600 flex items-center gap-1 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-md transition-colors"
                            >
                                {isAddingCategory ? <X size={12} /> : <Plus size={12} />}
                                {isAddingCategory ? 'Cancelar' : 'Nueva'}
                            </button>
                        </div>
                        {isAddingCategory ? (
                            <div className="flex gap-2 animate-in fade-in slide-in-from-top-1">
                                <input 
                                    autoFocus
                                    value={newCategoryName}
                                    onChange={e => setNewCategoryName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                                    placeholder="Nombre de categoría..."
                                    className="flex-1 bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
                                />
                                <button 
                                    onClick={handleAddCategory}
                                    disabled={!newCategoryName.trim()}
                                    className="bg-emerald-500 text-white px-4 rounded-xl font-bold disabled:opacity-50 hover:bg-emerald-600 transition-colors text-sm"
                                >
                                    Guardar
                                </button>
                            </div>
                        ) : (
                            <CustomSelect
                                value={category}
                                onChange={setCategory}
                                options={categories.filter(c => c.id !== 'todos').map(c => ({ value: c.id, label: c.label }))}
                            />
                        )}
                    </div>
                </div>
            )}

            {/* ─── STEP 2: EMPAQUE Y STOCK ─── */}
            {wizardStep === 2 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
                        <span className="text-xs font-black text-brand uppercase tracking-widest block mb-1">Paso 2 de 4</span>
                        <h4 className="text-sm font-black text-slate-800 dark:text-white">Empaque y Logística</h4>
                        <p className="text-[10px] text-slate-400 mt-0.5">Define cómo se distribuye y cuál es el inventario inicial.</p>
                    </div>

                    {/* Packaging selection */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 ml-1 mb-1.5 block uppercase">Tipo de Empaque</label>
                        <div className="grid grid-cols-3 gap-2">
                            {PACKAGING_TYPES.map(pt => {
                                const selected = packagingType === pt.id;
                                const colorMap = {
                                    emerald: selected ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : '',
                                    indigo: selected ? 'border-brand bg-brand-light dark:bg-surface-800/20' : '',
                                    amber: selected ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20' : '',
                                };
                                const textColor = {
                                    emerald: 'text-emerald-700 dark:text-emerald-400',
                                    indigo: 'text-brand-dark dark:text-brand',
                                    amber: 'text-amber-700 dark:text-amber-400',
                                };
                                return (
                                    <button key={pt.id}
                                        type="button"
                                        onClick={() => setPackagingType(pt.id)}
                                        className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all active:scale-95 ${selected
                                            ? colorMap[pt.color]
                                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300'
                                            }`}>
                                        <pt.Icon size={22} strokeWidth={2} className={selected ? textColor[pt.color] : 'text-slate-400'} />
                                        <span className={`text-[10px] font-black uppercase ${selected ? textColor[pt.color] : 'text-slate-500'}`}>{pt.label}</span>
                                        <span className="text-[8px] text-slate-400 leading-tight text-center">{pt.desc}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Granel Unit Selector */}
                    {isGranel && (
                        <div className="flex gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                            {['kg', 'litro'].map(u => (
                                <button key={u} type="button" onClick={() => setGranelUnit(u)}
                                    className={`flex-1 py-2 rounded-xl font-bold text-xs transition-all active:scale-95 ${granelUnit === u
                                        ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/30'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'
                                        }`}>
                                    {u === 'kg' ? <><Scale size={12} className="inline -mt-0.5" /> Kilogramo</> : <><Droplets size={12} className="inline -mt-0.5" /> Litro</>}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Lote Details */}
                    {isLote && (
                        <div className="bg-brand-light dark:bg-surface-800/10 p-4 rounded-xl border border-surface-200 dark:border-surface-800/30 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                            <div>
                                <label className="text-xs font-bold text-brand-dark dark:text-brand ml-1 mb-1 block uppercase">¿Cuántas unidades trae el lote?</label>
                                <input type="number" inputMode="numeric" value={unitsPerPackage} onChange={e => setUnitsPerPackage(e.target.value)} placeholder="Ej: 24"
                                    className="w-full bg-white dark:bg-slate-800 p-3 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/50 text-sm" />
                            </div>

                            {/* sellByUnit toggle */}
                            {parsedUnits > 1 && (
                                <label className="flex items-center gap-3 cursor-pointer select-none p-1 rounded-lg hover:bg-brand-light/50 dark:hover:bg-surface-800/20 transition-colors">
                                    <div className={`w-11 h-6 rounded-full relative transition-colors duration-200 shrink-0 ${sellByUnit ? 'bg-brand' : 'bg-slate-300 dark:bg-slate-600'}`}
                                        onClick={() => setSellByUnit(!sellByUnit)}>
                                        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200 ${sellByUnit ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                                    </div>
                                    <div onClick={() => setSellByUnit(!sellByUnit)}>
                                        <span className="text-xs font-bold text-brand-dark dark:text-brand">Venta detallada suelta</span>
                                        <p className="text-[9px] text-brand/70 dark:text-brand/50 mt-0.5">Permite vender unidades sueltas además de lotes enteros.</p>
                                    </div>
                                </label>
                            )}
                        </div>
                    )}

                    {/* Stock & Alarm */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            {isLote ? (
                                <>
                                    <label className="text-xs font-bold text-slate-400 ml-1 mb-1 block uppercase">¿Cuántos lotes?</label>
                                    <input type="number" inputMode="numeric" value={stockInLotes} onChange={e => setStockInLotes(e.target.value)} placeholder="0"
                                        className="w-full bg-slate-50 dark:bg-slate-800 p-3 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" />
                                    {parsedStockLotes > 0 && parsedUnits > 0 && (
                                        <p className="text-[9px] text-brand font-bold mt-1 ml-1">= {stockUnitsCalc} unidades</p>
                                    )}
                                </>
                            ) : (
                                <>
                                    <label className="text-xs font-bold text-slate-400 ml-1 mb-1 block uppercase">Stock Inicial</label>
                                    <input type="number" inputMode="numeric" value={stock} onChange={e => setStock(e.target.value)} placeholder="0"
                                        className="w-full bg-slate-50 dark:bg-slate-800 p-3 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" />
                                </>
                            )}
                        </div>
                        <div>
                            <label className="text-xs font-bold text-amber-500 ml-1 mb-1 block uppercase flex items-center gap-1">
                                <AlertTriangle size={10} /> Alerta stock
                            </label>
                            <input type="number" inputMode="numeric" value={lowStockAlert} onChange={e => setLowStockAlert(e.target.value)} placeholder="5"
                                className="w-full bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30 p-3 rounded-xl font-bold text-amber-700 dark:text-amber-400 outline-none focus:ring-2 focus:ring-amber-500/50 text-sm" />
                            {isLote && parsedAlert > 0 && parsedUnits > 0 && (
                                <p className="text-[9px] text-amber-500 font-bold mt-1 ml-1">= {alertLotesCalc.toFixed(1)} lotes</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ─── STEP 3: COSTOS Y PRECIOS ─── */}
            {wizardStep === 3 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
                        <span className="text-xs font-black text-amber-500 uppercase tracking-widest block mb-1">Paso 3 de 4</span>
                        <h4 className="text-sm font-black text-slate-800 dark:text-white">Costos y Ganancias</h4>
                        <p className="text-[10px] text-slate-400 mt-0.5">Configura costos de adquisición y precios de venta final.</p>
                    </div>

                    {/* Cost inputs */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 ml-1 mb-1 block uppercase tracking-wider">
                                Costo ({copEnabled && copPrimary && tasaCop > 0 ? 'COP' : '$'}){priceSuffix}
                            </label>
                            {copEnabled && copPrimary && tasaCop > 0 ? (
                                <input type="number" inputMode="decimal" value={costCop} onChange={e => handleCostCopChange(e.target.value)} placeholder="4100"
                                    className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-slate-500/50 transition-all text-sm" />
                            ) : (
                                <input type="number" inputMode="decimal" value={costUsd} onChange={e => handleCostUsdChange(e.target.value)} placeholder="1.00"
                                    className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-slate-500/50 transition-all text-sm" />
                            )}
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 ml-1 mb-1 block uppercase tracking-wider">
                                Costo (Bs){priceSuffix}
                            </label>
                            <input type="number" inputMode="decimal" value={costBs} onChange={e => handleCostBsChange(e.target.value)} placeholder="0.00"
                                className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-slate-500/50 transition-all text-sm" />
                        </div>
                    </div>

                    {/* Lote Cost Equivalency */}
                    {isLote && parsedUnits > 1 && parsedCost > 0 && (
                        <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 px-3 py-1.5 rounded-xl text-[10px]">
                            <span className="text-slate-500 font-medium">Costo unitario auto-calculado:</span>
                            <span className="font-bold text-slate-700 dark:text-white">
                                {copEnabled && copPrimary && tasaCop > 0 ? `${Math.round((parsedCost / parsedUnits) * tasaCop).toLocaleString('es-CO')} COP` : `$${(parsedCost / parsedUnits).toFixed(2)}`}
                            </span>
                        </div>
                    )}

                    {/* COP Selling Price */}
                    {copEnabled && (
                        <div className="relative">
                            <label className="text-[10px] font-bold text-amber-600 dark:text-amber-400 ml-1 mb-1 block uppercase tracking-wider">
                                Precio Venta (Pesos COP){priceSuffix}
                            </label>
                            <input
                                type="number"
                                inputMode="decimal"
                                placeholder="Ej: 15000"
                                value={priceCop}
                                onChange={e => handlePriceCopChange(e.target.value)}
                                className="w-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 p-3 pr-10 rounded-xl font-black text-amber-800 dark:text-amber-400 outline-none focus:ring-2 focus:ring-amber-500/50 transition-all text-sm"
                            />
                            <Banknote size={16} className="absolute right-3 top-[32px] text-amber-400" />
                        </div>
                    )}

                    {/* Selling prices USD / Bs */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="relative">
                            <label className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 ml-1 mb-1 block uppercase tracking-wider">
                                Precio Venta ({copEnabled ? 'USD' : '$'}){priceSuffix}
                            </label>
                            <input type="number" inputMode="decimal" value={priceUsd} onChange={e => handlePriceUsdChange(e.target.value)} placeholder="1.50"
                                className="w-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/30 p-3 pr-10 rounded-xl font-black text-emerald-800 dark:text-emerald-400 outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all text-sm" />
                            {parseFloat(priceUsd) > 0 && (
                                <CheckCircle size={16} className="absolute right-3 top-[32px] text-emerald-500" />
                            )}
                        </div>
                        <div className="relative">
                            <label className="text-[10px] font-bold text-brand-dark dark:text-brand ml-1 mb-1 block uppercase tracking-wider">
                                Precio Venta (Bs){priceSuffix}
                            </label>
                            <input type="number" inputMode="decimal" value={priceBs} onChange={e => handlePriceBsChange(e.target.value)} placeholder="0.00"
                                className="w-full bg-brand-light dark:bg-surface-800/20 border border-surface-200 dark:border-surface-800/30 p-3 pr-10 rounded-xl font-black text-surface-800 dark:text-brand outline-none focus:ring-2 focus:ring-brand/50 transition-all text-sm" />
                            {parseFloat(priceBs) > 0 && (
                                <CheckCircle size={16} className="absolute right-3 top-[32px] text-brand" />
                            )}
                        </div>
                    </div>

                    {/* COP Warning */}
                    {copEnabled && parsedPrice >= 100 && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 p-2.5 rounded-xl flex items-center gap-2 text-[10px]">
                            <AlertTriangle size={14} className="text-red-500 shrink-0" />
                            <span className="text-red-700 dark:text-red-400 font-medium">
                                ¿Precio alto en USD? Si es en COP, usa el campo "Pesos COP" arriba.
                            </span>
                        </div>
                    )}

                    {/* COP Preview */}
                    {copEnabled && parsedPrice > 0 && (
                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200/50 dark:border-amber-800/30 p-2 py-2.5 rounded-xl flex items-center justify-between text-xs">
                            <span className="text-amber-800 dark:text-amber-500 font-bold flex items-center gap-1">
                                <Banknote size={14} /> Equiv. COP
                            </span>
                            <span className="font-black text-amber-600 dark:text-amber-400 text-base">
                                {priceCop && parseFloat(priceCop) > 0
                                    ? Math.round(parseFloat(priceCop)).toLocaleString('es-CO')
                                    : Math.round(parsedPrice * tasaCop).toLocaleString('es-CO')}
                            </span>
                        </div>
                    )}

                    {/* sellByUnit price fields */}
                    {isLote && sellByUnit && parsedUnits > 1 && (
                        <div className="bg-white dark:bg-slate-800/80 p-3 rounded-xl border border-surface-300 dark:border-surface-800/40 space-y-2">
                            <label className="text-[10px] font-bold text-brand-dark dark:text-brand uppercase tracking-wider block">Precio por Unidad Suelta</label>
                            {copEnabled ? (
                                <div className="space-y-2">
                                    <div>
                                        <label className="text-[8px] font-bold text-amber-600 ml-0.5 block">Pesos COP</label>
                                        <input type="number" inputMode="decimal" value={unitPriceCop}
                                            onChange={e => {
                                                const val = e.target.value;
                                                setUnitPriceCop(val);
                                                setUnitPriceUsd(val && parseFloat(val) > 0 && tasaCop > 0
                                                    ? (parseFloat(val) / tasaCop).toFixed(4)
                                                    : '');
                                            }}
                                            placeholder={parsedPrice > 0 && parsedUnits > 0 && tasaCop > 0
                                                ? Math.round((parsedPrice / parsedUnits) * tasaCop).toString()
                                                : '0'}
                                            className="w-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 p-2 rounded-lg font-black text-amber-800 dark:text-amber-400 outline-none text-xs" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        <div>
                                            <label className="text-[8px] font-bold text-emerald-500 ml-0.5 block">USD ($)</label>
                                            <div className="w-full bg-emerald-50/50 dark:bg-slate-900 border border-emerald-100 dark:border-emerald-900/30 p-2 rounded-lg font-black text-emerald-700 dark:text-emerald-400">
                                                {effectiveUnitPrice > 0 ? effectiveUnitPrice.toFixed(2) : '—'}
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[8px] font-bold text-brand ml-0.5 block">Bs</label>
                                            <div className="w-full bg-brand-light/50 dark:bg-slate-900 border border-surface-200 dark:border-surface-800/30 p-2 rounded-lg font-black text-brand-dark dark:text-amber-400 flex items-center justify-between">
                                                {effectiveRate > 0 && effectiveUnitPrice > 0
                                                    ? (effectiveUnitPrice * effectiveRate).toFixed(2)
                                                    : '—'}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div>
                                        <label className="text-[8px] font-bold text-emerald-500 ml-0.5 block">USD ($)</label>
                                        <input type="number" inputMode="decimal" value={unitPriceUsd}
                                            onChange={e => setUnitPriceUsd(e.target.value)}
                                            placeholder={parsedPrice > 0 && parsedUnits > 0 ? (parsedPrice / parsedUnits).toFixed(2) : '0.00'}
                                            className="w-full bg-brand-light/50 dark:bg-slate-900 border border-surface-200 dark:border-surface-700/30 p-2 rounded-lg font-black text-brand-dark dark:text-brand outline-none text-xs" />
                                    </div>
                                    <div>
                                        <label className="text-[8px] font-bold text-brand ml-0.5 block">Bs</label>
                                        <div className="w-full bg-brand-light/50 dark:bg-slate-900 border border-surface-200 dark:border-surface-800/30 p-2 rounded-lg font-black text-brand-dark dark:text-brand flex items-center justify-between">
                                            {effectiveRate > 0 ? (effectiveUnitPrice * effectiveRate).toFixed(2) : '—'}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Margin Indicator panel */}
                    <div className={`p-3 rounded-xl border space-y-1 ${mainMarginPct !== null && mainMarginPct < 0
                        ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/30'
                        : mainMarginPct !== null && mainMarginPct === 0
                            ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30'
                            : 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-800'
                        }`}>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Margen de Ganancia</p>
                        {parsedPrice > 0 && parsedCost > 0 ? (
                            <div className="space-y-1 text-xs">
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 font-medium">{isLote ? 'Margen Lote:' : isGranel ? `Margen / ${granelLabel}:` : 'Margen / Unidad:'}</span>
                                    <span className={`font-black ${mainMarginPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                        {mainMarginPct.toFixed(1)}%
                                        <span className="text-[10px] ml-1.5 opacity-80 font-bold">(${mainMarginUsd.toFixed(2)})</span>
                                    </span>
                                </div>
                                {isLote && sellByUnit && parsedUnits > 1 && unitMarginPct !== null && (
                                    <div className="flex justify-between items-center border-t border-slate-200/50 dark:border-slate-700/50 pt-1 mt-1">
                                        <span className="text-slate-500 font-medium">Margen Unidad:</span>
                                        <span className={`font-black ${unitMarginPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                            {unitMarginPct.toFixed(1)}%
                                            <span className="text-[10px] ml-1.5 opacity-80 font-bold">(${unitMarginUsd.toFixed(2)})</span>
                                        </span>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="text-[10px] text-slate-400 italic">
                                Ingresa Precio y Costo para calcular tu margen.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ─── STEP 4: RESUMEN Y CONFIRMACION ─── */}
            {wizardStep === 4 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
                        <span className="text-xs font-black text-rose-500 uppercase tracking-widest block mb-1">Paso 4 de 4</span>
                        <h4 className="text-sm font-black text-slate-800 dark:text-white">Resumen del Producto</h4>
                        <p className="text-[10px] text-slate-400 mt-0.5">Valida los datos antes de guardarlo en tu inventario.</p>
                    </div>

                    {/* Custom high fidelity catalog card preview */}
                    <div className="bg-gradient-to-br from-slate-50 to-white dark:from-slate-800/80 dark:to-slate-900 p-4 rounded-3xl border-2 border-slate-100 dark:border-slate-800 shadow-lg relative overflow-hidden flex gap-4 items-center">
                        <div className="w-16 h-16 sm:w-20 sm:h-20 bg-slate-100 dark:bg-slate-700 rounded-2xl flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-600/50 overflow-hidden shadow-inner">
                            {image ? (
                                <img src={image} className="w-full h-full object-cover" alt="Preview image" />
                            ) : (
                                <ShoppingBag size={28} className="text-slate-400 dark:text-slate-500" />
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <span className="bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full inline-block mb-1">
                                {categories.find(c => c.id === category)?.label || category || 'Sin categoría'}
                            </span>
                            <h3 className="font-black text-slate-800 dark:text-white text-base sm:text-lg truncate capitalize leading-tight">
                                {name || 'Producto sin nombre'}
                            </h3>
                            <div className="flex items-baseline gap-1 mt-1">
                                <span className="text-lg font-black text-slate-800 dark:text-white">
                                    {copEnabled && copPrimary && tasaCop > 0
                                        ? `${(priceCop && parseFloat(priceCop) > 0 ? Math.round(parseFloat(priceCop)) : Math.round(parsedPrice * tasaCop)).toLocaleString('es-CO')} COP`
                                        : `$${parsedPrice.toFixed(2)}`}
                                </span>
                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{priceSuffix}</span>
                            </div>
                            <div className="flex gap-2 items-center mt-1.5 text-[9px] font-bold text-slate-400">
                                <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                    Empaque: <span className="text-slate-700 dark:text-white uppercase font-black">{PACKAGING_TYPES.find(p => p.id === packagingType)?.label || packagingType}</span>
                                </span>
                                <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                    Stock: <span className="text-slate-700 dark:text-white font-black">{isLote ? `${parsedStockLotes} lotes` : `${stock || 0}`}</span>
                                </span>
                            </div>
                        </div>
                        <div className="absolute right-3 top-3">
                            <Eye size={16} className="text-slate-300 dark:text-slate-600" />
                        </div>
                    </div>

                    {/* Breakdown table */}
                    <div className="border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden bg-slate-50/50 dark:bg-slate-900/50 p-3.5 space-y-2 text-xs">
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400 font-medium">Costo de compra:</span>
                            <span className="font-bold text-slate-700 dark:text-white">
                                {copEnabled && copPrimary && tasaCop > 0 ? `${parseFloat(costCop || 0).toLocaleString('es-CO')} COP` : `$${parsedCost.toFixed(2)}`}
                            </span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400 font-medium">Margen estimado:</span>
                            {mainMarginPct !== null ? (
                                <span className={`font-black ${mainMarginPct >= 0 ? 'text-emerald-500' : 'text-rose-500'} flex items-center gap-1`}>
                                    {mainMarginPct.toFixed(1)}% (${mainMarginUsd.toFixed(2)})
                                </span>
                            ) : (
                                <span className="text-slate-400 italic">No disponible</span>
                            )}
                        </div>
                        {isLote && sellByUnit && parsedUnits > 1 && (
                            <div className="flex justify-between items-center border-t border-slate-100 dark:border-slate-800/60 pt-2 mt-1">
                                <span className="text-slate-400 font-medium">Unidad suelta:</span>
                                <span className="font-bold text-brand">
                                    {copEnabled && tasaCop > 0 ? `${Math.round(effectiveUnitPrice * tasaCop).toLocaleString('es-CO')} COP` : `$${effectiveUnitPrice.toFixed(2)}`}
                                </span>
                            </div>
                        )}
                        {barcode && (
                            <div className="flex justify-between items-center">
                                <span className="text-slate-400 font-medium">Cód. Barras:</span>
                                <span className="font-bold text-slate-700 dark:text-white tracking-widest">{barcode}</span>
                            </div>
                        )}
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400 font-medium">Alerta mín. stock:</span>
                            <span className="font-black text-amber-500">{lowStockAlert || '5'} uds</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
