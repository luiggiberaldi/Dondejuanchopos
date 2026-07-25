import React, { useState, useEffect, useRef } from 'react';
import { X, Package, Barcode, Tag, AlertTriangle, Send, Loader2, Camera, Check } from 'lucide-react';
import { useProductContext } from '../../context/ProductContext';
import { derivePricingMode } from '../../hooks/useProductForm';
import PricingModeSelector from '../Products/PricingModeSelector';
import PricePreviewLine from '../Products/PricePreviewLine';
import { calcUsdFromBs } from '../../utils/calculatorUtils';

const MODE_LABELS = {
    tasa_dia: 'Tasa del día',
    bcv: 'Siempre BCV',
    dual_usd: 'Dos precios en $',
    bs_fijo: 'Bs congelado',
};

const EMPTY = {
    name: '', category: '', barcode: '', image: '',
    priceUsd: '', priceBsManual: '', priceBsUsdRef: '', costUsd: '', stock: '', lowStockAlert: '5',
    sellByBox: false, boxUnits: '', boxBarcode: '', boxPriceUsd: '', boxPriceBs: '', boxPriceBsUsdRef: '', boxPricingMode: 'inherit',
    sellByHalfBox: false, halfBoxUnits: '', halfBoxBarcode: '', halfBoxPriceUsd: '', halfBoxPriceBs: '', halfBoxPriceBsUsdRef: '', halfBoxPricingMode: 'inherit',
    pricingMode: 'tasa_dia',
};

function productToForm(p) {
    if (!p) return { ...EMPTY };
    const s = (v) => (v == null ? '' : String(v));
    return {
        name: s(p.name), category: s(p.category), barcode: s(p.barcode), image: s(p.image),
        priceUsd: s(p.priceUsd), priceBsManual: s(p.priceBsManual), priceBsUsdRef: s(p.priceBsUsdRef),
        costUsd: s(p.costUsd || p.costPrice), stock: s(p.stock), lowStockAlert: s(p.lowStockAlert ?? 5),
        sellByBox: Boolean(p.sellByBox), boxUnits: s(p.boxUnits), boxBarcode: s(p.boxBarcode),
        boxPriceUsd: s(p.boxPriceUsd), boxPriceBs: s(p.boxPriceBs), boxPriceBsUsdRef: s(p.boxPriceBsUsdRef),
        boxPricingMode: derivePricingMode(p, 'box'),
        sellByHalfBox: Boolean(p.sellByHalfBox), halfBoxUnits: s(p.halfBoxUnits), halfBoxBarcode: s(p.halfBoxBarcode),
        halfBoxPriceUsd: s(p.halfBoxPriceUsd), halfBoxPriceBs: s(p.halfBoxPriceBs), halfBoxPriceBsUsdRef: s(p.halfBoxPriceBsUsdRef),
        halfBoxPricingMode: derivePricingMode(p, 'halfBox'),
        pricingMode: derivePricingMode(p, 'unit'),
    };
}

const inputCls = 'w-full bg-slate-50 dark:bg-slate-800/80 p-3 rounded-2xl font-bold text-sm text-slate-800 dark:text-white outline-none border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-brand/40 shadow-xs transition-all';
const labelCls = 'text-xs font-black text-slate-600 dark:text-slate-300 ml-1 mb-1 block uppercase tracking-wider';

export default function RemoteProductFormModal({ isOpen, onClose, editingProduct, onSubmit, effectiveRate, bcvRate }) {
    const { categories } = useProductContext();
    const [form, setForm] = useState(EMPTY);
    const [bsInputs, setBsInputs] = useState({ unit: '', box: '', halfBox: '' });
    const [sending, setSending] = useState(false);
    const fileInputRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            const initialForm = productToForm(editingProduct);
            setForm(initialForm);

            const getBs = (usdVal, mode) => {
                const rate = mode === 'bcv' ? (bcvRate > 0 ? bcvRate : effectiveRate) : (effectiveRate > 0 ? effectiveRate : bcvRate);
                const num = parseFloat(usdVal);
                return (!isNaN(num) && num > 0 && rate > 0) ? (num * rate).toFixed(2) : '';
            };

            const unitMode = initialForm.pricingMode;
            const boxMode = initialForm.boxPricingMode === 'inherit' ? unitMode : initialForm.boxPricingMode;
            const halfBoxMode = initialForm.halfBoxPricingMode === 'inherit' ? unitMode : initialForm.halfBoxPricingMode;

            setBsInputs({
                unit: getBs(initialForm.priceUsd, unitMode),
                box: getBs(initialForm.boxPriceUsd, boxMode),
                halfBox: getBs(initialForm.halfBoxPriceUsd, halfBoxMode),
            });
        }
    }, [isOpen, editingProduct, bcvRate, effectiveRate]);

    if (!isOpen) return null;

    const set = (field) => (e) => {
        const value = e?.target ? e.target.value : e;
        setForm(prev => ({ ...prev, [field]: value }));
    };
    const toggle = (field) => () => setForm(prev => {
        const next = { ...prev, [field]: !prev[field] };
        if (field === 'sellByBox' && !next.sellByBox) next.sellByHalfBox = false;
        return next;
    });

    const handleImageUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 400;
                const MAX_HEIGHT = 400;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                setForm(prev => ({ ...prev, image: dataUrl }));
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    };

    const handleModeChange = (mode) => {
        setForm(prev => ({
            ...prev,
            pricingMode: mode,
            priceBsManual: mode !== 'bs_fijo' ? '' : prev.priceBsManual,
            priceBsUsdRef: mode !== 'dual_usd' ? '' : prev.priceBsUsdRef,
        }));
        const rate = mode === 'bcv' ? (bcvRate > 0 ? bcvRate : effectiveRate) : (effectiveRate > 0 ? effectiveRate : bcvRate);
        const num = parseFloat(form.priceUsd);
        if (!isNaN(num) && num > 0 && rate > 0) {
            setBsInputs(prev => ({ ...prev, unit: (num * rate).toFixed(2) }));
        }
    };

    const handleUsdChange = (usdField, key, value, mode) => {
        const rate = mode === 'bcv' ? (bcvRate > 0 ? bcvRate : effectiveRate) : (effectiveRate > 0 ? effectiveRate : bcvRate);
        const usdNum = parseFloat(value);
        const calculatedBs = (!isNaN(usdNum) && usdNum > 0 && rate > 0) ? (usdNum * rate).toFixed(2) : '';

        setForm(prev => ({ ...prev, [usdField]: value }));
        setBsInputs(prev => ({ ...prev, [key]: calculatedBs }));
    };

    const handleBsChange = (usdField, key, value, mode) => {
        const rate = mode === 'bcv' ? (bcvRate > 0 ? bcvRate : effectiveRate) : (effectiveRate > 0 ? effectiveRate : bcvRate);
        setBsInputs(prev => ({ ...prev, [key]: value }));

        if (value !== '' && rate > 0) {
            const usdCalc = calcUsdFromBs(value, rate);
            setForm(prev => ({ ...prev, [usdField]: usdCalc }));
        } else {
            setForm(prev => ({ ...prev, [usdField]: '' }));
        }
    };

    const priceNum = Number(form.priceUsd) || 0;
    const canSave = form.name.trim().length >= 3 && priceNum > 0
        && (!form.sellByBox || parseInt(form.boxUnits, 10) > 0)
        && (!form.sellByHalfBox || parseInt(form.halfBoxUnits, 10) > 0);

    const handleSubmit = async () => {
        if (!canSave || sending) return;
        setSending(true);
        try {
            const mode = form.pricingMode;
            const boxEffMode = form.boxPricingMode === 'inherit' ? mode : form.boxPricingMode;
            const halfBoxEffMode = form.halfBoxPricingMode === 'inherit' ? mode : form.halfBoxPricingMode;

            const data = {
                ...(editingProduct || {}),
                name: form.name.trim(),
                category: form.category || editingProduct?.category || 'varios',
                barcode: form.barcode.trim() || null,
                image: form.image || null,
                priceUsd: Number(form.priceUsd) || 0,
                priceBsManual: mode === 'bs_fijo' && form.priceBsManual !== '' ? Number(form.priceBsManual) : null,
                priceBsUsdRef: mode === 'dual_usd' && form.priceBsUsdRef !== '' ? Number(form.priceBsUsdRef) : null,
                forceBcv: mode === 'bcv',
                pricingMode: mode,
                costUsd: Number(form.costUsd) || 0,
                stock: parseInt(form.stock, 10) || 0,
                lowStockAlert: parseInt(form.lowStockAlert, 10) || 5,

                sellByBox: form.sellByBox,
                boxUnits: form.sellByBox ? parseInt(form.boxUnits, 10) || null : null,
                boxBarcode: form.sellByBox ? form.boxBarcode.trim() || null : null,
                boxPricingMode: form.sellByBox ? form.boxPricingMode : 'inherit',
                boxPriceUsd: form.sellByBox && form.boxPriceUsd !== '' ? Number(form.boxPriceUsd) : null,
                boxPriceBs: form.sellByBox && boxEffMode === 'bs_fijo' && form.boxPriceBs !== '' ? Number(form.boxPriceBs) : null,
                boxPriceBsUsdRef: form.sellByBox && boxEffMode === 'dual_usd' && form.boxPriceBsUsdRef !== '' ? Number(form.boxPriceBsUsdRef) : null,

                sellByHalfBox: form.sellByBox && form.sellByHalfBox,
                halfBoxUnits: form.sellByHalfBox ? parseInt(form.halfBoxUnits, 10) || null : null,
                halfBoxBarcode: form.sellByHalfBox ? form.halfBoxBarcode.trim() || null : null,
                halfBoxPricingMode: form.sellByHalfBox ? form.halfBoxPricingMode : 'inherit',
                halfBoxPriceUsd: form.sellByHalfBox && form.halfBoxPriceUsd !== '' ? Number(form.halfBoxPriceUsd) : null,
                halfBoxPriceBs: form.sellByHalfBox && halfBoxEffMode === 'bs_fijo' && form.halfBoxPriceBs !== '' ? Number(form.halfBoxPriceBs) : null,
                halfBoxPriceBsUsdRef: form.sellByHalfBox && halfBoxEffMode === 'dual_usd' && form.halfBoxPriceBsUsdRef !== '' ? Number(form.halfBoxPriceBsUsdRef) : null,
            };

            if (!editingProduct) data.id = crypto.randomUUID();
            await onSubmit(editingProduct ? 'edit' : 'add', data.id, data);
            onClose();
        } finally {
            setSending(false);
        }
    };

    const formatBlock = (title, color, modeField, bsKey, unitsField, barcodeField, usdField, bsField, bsUsdRefField, unitsPlaceholder) => {
        const effMode = form[modeField] === 'inherit' ? form.pricingMode : form[modeField];

        return (
            <div className={`p-4 rounded-3xl border-2 space-y-3.5 ${color}`}>
                <div className="flex items-center justify-between border-b border-slate-200/50 dark:border-slate-800/50 pb-2.5">
                    <span className="text-xs font-black uppercase tracking-wider">{title}</span>
                    {form[modeField] === 'inherit' ? (
                        <button
                            type="button"
                            onClick={() => setForm(f => ({ ...f, [modeField]: form.pricingMode }))}
                            className="text-xs font-black text-brand hover:underline uppercase cursor-pointer"
                        >
                            Usar otra regla
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setForm(f => ({ ...f, [modeField]: 'inherit' }))}
                            className="text-xs font-black text-slate-400 hover:text-brand uppercase cursor-pointer"
                        >
                            Volver a heredar
                        </button>
                    )}
                </div>

                {form[modeField] === 'inherit' ? (
                    <div className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800/60 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                        <span>Regla: Sigue la regla de la Unidad ({MODE_LABELS[form.pricingMode] || 'Tasa del día'})</span>
                    </div>
                ) : (
                    <div className="space-y-1">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Regla propia para {title}</span>
                        <PricingModeSelector
                            compact
                            value={form[modeField]}
                            onChange={(m) => setForm(f => ({ ...f, [modeField]: m }))}
                            effectiveRate={effectiveRate}
                            bcvRate={bcvRate}
                        />
                    </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label className={labelCls}>Unidades</label>
                        <input type="number" inputMode="numeric" value={form[unitsField]} onChange={set(unitsField)} placeholder={unitsPlaceholder} className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>Cód. barras</label>
                        <input type="text" value={form[barcodeField]} onChange={set(barcodeField)} placeholder="Escanear..." className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>{effMode === 'dual_usd' ? '$ en divisa' : 'Precio USD ($)'}</label>
                        <input
                            type="number"
                            inputMode="decimal"
                            value={form[usdField]}
                            onChange={(e) => handleUsdChange(usdField, bsKey, e.target.value, effMode)}
                            placeholder="0.00"
                            className={inputCls}
                        />
                    </div>
                    {(effMode === 'bcv' || effMode === 'tasa_dia') && (
                        <div>
                            <label className={labelCls}>
                                Precio Bs ({effMode === 'bcv' ? 'tasa BCV' : 'tasa Día'})
                            </label>
                            <input
                                type="number"
                                inputMode="decimal"
                                value={bsInputs[bsKey]}
                                onChange={(e) => handleBsChange(usdField, bsKey, e.target.value, effMode)}
                                placeholder="0.00 Bs"
                                className={inputCls}
                            />
                        </div>
                    )}
                    {effMode === 'bs_fijo' && (
                        <div>
                            <label className={labelCls}>Precio Bs (Fijo)</label>
                            <input type="number" inputMode="decimal" value={form[bsField]} onChange={set(bsField)} placeholder="0.00" className={inputCls} />
                        </div>
                    )}
                    {effMode === 'dual_usd' && (
                        <div>
                            <label className={labelCls}>$ si paga en Bs</label>
                            <input type="number" inputMode="decimal" value={form[bsUsdRefField]} onChange={set(bsUsdRefField)} placeholder="0.00" className={inputCls} />
                        </div>
                    )}
                </div>

                <PricePreviewLine
                    mode={effMode}
                    usd={form[usdField]}
                    bsManual={form[bsField]}
                    bsUsdRef={form[bsUsdRefField]}
                    effectiveRate={effectiveRate}
                    bcvRate={bcvRate}
                />
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-7 max-w-xl sm:max-w-2xl w-full shadow-2xl animate-in zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto space-y-5">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 bg-brand-light/70 dark:bg-slate-800 rounded-2xl flex items-center justify-center">
                            <Package size={22} className="text-brand" />
                        </div>
                        <div>
                            <h3 className="font-black text-slate-800 dark:text-white text-base sm:text-lg">
                                {editingProduct ? 'Editar producto (remoto)' : 'Nuevo producto (remoto)'}
                            </h3>
                            <p className="text-xs text-slate-400 font-extrabold">Se encolará hasta pulsar «Subir al sistema»</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-2xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Identidad del Producto + Subir Foto */}
                <div className="flex flex-col sm:flex-row items-start gap-4">
                    {/* Foto */}
                    <div className="shrink-0 w-full sm:w-auto flex sm:block justify-center">
                        <div>
                            <label className={labelCls}>Foto del producto</label>
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                className="w-24 h-24 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex flex-col items-center justify-center cursor-pointer hover:border-brand transition-all relative overflow-hidden group shadow-xs"
                            >
                                {form.image ? (
                                    <>
                                        <img src={form.image} className="w-full h-full object-cover" alt="Product" />
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); setForm(prev => ({ ...prev, image: '' })); }}
                                            className="absolute top-1.5 right-1.5 p-1 bg-rose-500 text-white rounded-full opacity-90 hover:opacity-100 transition-opacity shadow"
                                            title="Quitar foto"
                                        >
                                            <X size={12} />
                                        </button>
                                    </>
                                ) : (
                                    <div className="text-center p-2">
                                        <Camera size={22} className="text-slate-400 mx-auto mb-1" />
                                        <span className="text-[9px] font-black text-slate-500 uppercase block leading-tight">Subir foto</span>
                                    </div>
                                )}
                            </div>
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="image/*"
                                onChange={handleImageUpload}
                            />
                        </div>
                    </div>

                    {/* Nombre, Categoría y Código */}
                    <div className="flex-1 space-y-3 w-full min-w-0">
                        <div>
                            <label className={labelCls}>Nombre del Producto</label>
                            <input value={form.name} onChange={set('name')} placeholder="Ej: Cheekesitos Pequeño" className={inputCls} />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className={labelCls}>Categoría</label>
                                <select value={form.category} onChange={set('category')} className={inputCls}>
                                    <option value="">Seleccionar categoría...</option>
                                    {(categories || []).filter(c => c.id !== 'todos').map(c => (
                                        <option key={c.id} value={c.id}>{c.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className={labelCls}><Barcode size={12} className="inline mr-1" />Cód. de barras</label>
                                <input value={form.barcode} onChange={set('barcode')} placeholder="Escanear o ingresar..." className={inputCls} />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Modo de precio Unidad */}
                <div className="space-y-2">
                    <label className={labelCls}>¿Cómo se cobra la Unidad?</label>
                    <PricingModeSelector
                        value={form.pricingMode}
                        onChange={handleModeChange}
                        effectiveRate={effectiveRate}
                        bcvRate={bcvRate}
                    />
                </div>

                {/* Precio y Costo Unidad */}
                <div className="p-4 rounded-3xl border-2 border-emerald-500/30 bg-emerald-500/5 space-y-3">
                    <span className="text-xs font-black text-emerald-700 dark:text-emerald-300 uppercase tracking-wider flex items-center gap-1.5"><Tag size={14} /> Configuración de la Unidad</span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                            <label className={labelCls}>Costo USD ($)</label>
                            <input
                                type="number"
                                inputMode="decimal"
                                value={form.costUsd}
                                onChange={set('costUsd')}
                                placeholder="0.00"
                                className={inputCls}
                            />
                        </div>
                        <div>
                            <label className={labelCls}>{form.pricingMode === 'dual_usd' ? '$ en divisa' : 'Precio USD ($)'}</label>
                            <input
                                type="number"
                                inputMode="decimal"
                                value={form.priceUsd}
                                onChange={(e) => handleUsdChange('priceUsd', 'unit', e.target.value, form.pricingMode)}
                                placeholder="0.00"
                                className={inputCls}
                            />
                        </div>
                        {(form.pricingMode === 'bcv' || form.pricingMode === 'tasa_dia') && (
                            <div>
                                <label className={labelCls}>
                                    Precio Bs ({form.pricingMode === 'bcv' ? 'tasa BCV' : 'tasa Día'})
                                </label>
                                <input
                                    type="number"
                                    inputMode="decimal"
                                    value={bsInputs.unit}
                                    onChange={(e) => handleBsChange('priceUsd', 'unit', e.target.value, form.pricingMode)}
                                    placeholder="0.00 Bs"
                                    className={inputCls}
                                />
                            </div>
                        )}
                        {form.pricingMode === 'bs_fijo' && (
                            <div>
                                <label className={labelCls}>Precio Bs (Fijo)</label>
                                <input type="number" inputMode="decimal" value={form.priceBsManual} onChange={set('priceBsManual')} placeholder="0.00" className={inputCls} />
                            </div>
                        )}
                        {form.pricingMode === 'dual_usd' && (
                            <div>
                                <label className={labelCls}>$ si paga en Bs</label>
                                <input type="number" inputMode="decimal" value={form.priceBsUsdRef} onChange={set('priceBsUsdRef')} placeholder="0.00" className={inputCls} />
                            </div>
                        )}
                    </div>
                    <PricePreviewLine
                        mode={form.pricingMode}
                        usd={form.priceUsd}
                        bsManual={form.priceBsManual}
                        bsUsdRef={form.priceBsUsdRef}
                        effectiveRate={effectiveRate}
                        bcvRate={bcvRate}
                    />
                </div>

                {/* Checkbox Caja Reconstruido */}
                <div
                    onClick={toggle('sellByBox')}
                    className={`p-3.5 rounded-2xl border-2 transition-all flex items-center justify-between cursor-pointer ${
                        form.sellByBox
                            ? 'bg-blue-500/10 border-blue-500 text-blue-700 dark:text-blue-300 shadow-xs'
                            : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                    }`}
                >
                    <div className="flex items-center gap-3">
                        <Package size={20} className={form.sellByBox ? 'text-blue-600' : 'text-slate-400'} />
                        <span className="text-xs font-black uppercase tracking-wider">Vender por Caja</span>
                    </div>
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center border-2 transition-all ${
                        form.sellByBox ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                    }`}>
                        {form.sellByBox && <Check size={14} strokeWidth={3} />}
                    </div>
                </div>
                {form.sellByBox && formatBlock('Caja', 'border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300', 'boxPricingMode', 'box', 'boxUnits', 'boxBarcode', 'boxPriceUsd', 'boxPriceBs', 'boxPriceBsUsdRef', 'Ej: 36')}

                {/* Checkbox ½ Caja Reconstruido */}
                <div
                    onClick={form.sellByBox ? toggle('sellByHalfBox') : undefined}
                    className={`p-3.5 rounded-2xl border-2 transition-all flex items-center justify-between ${
                        !form.sellByBox
                            ? 'opacity-40 cursor-not-allowed bg-slate-50 dark:bg-slate-800/30 border-slate-200 dark:border-slate-800 text-slate-400'
                            : form.sellByHalfBox
                            ? 'bg-purple-500/10 border-purple-500 text-purple-700 dark:text-purple-300 shadow-xs cursor-pointer'
                            : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer'
                    }`}
                >
                    <div className="flex items-center gap-3">
                        <Package size={20} className={form.sellByHalfBox ? 'text-purple-600' : 'text-slate-400'} />
                        <div>
                            <span className="text-xs font-black uppercase tracking-wider block">Vender por ½ Caja</span>
                            {!form.sellByBox && <span className="text-[10px] text-rose-500 font-extrabold">(requiere activar Vender por Caja)</span>}
                        </div>
                    </div>
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center border-2 transition-all ${
                        form.sellByHalfBox ? 'bg-purple-600 border-purple-600 text-white' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                    }`}>
                        {form.sellByHalfBox && <Check size={14} strokeWidth={3} />}
                    </div>
                </div>
                {form.sellByHalfBox && formatBlock('½ Caja', 'border-purple-500/30 bg-purple-500/5 text-purple-700 dark:text-purple-300', 'halfBoxPricingMode', 'halfBox', 'halfBoxUnits', 'halfBoxBarcode', 'halfBoxPriceUsd', 'halfBoxPriceBs', 'halfBoxPriceBsUsdRef', form.boxUnits ? String(Math.floor((parseInt(form.boxUnits, 10) || 0) / 2)) : '18')}

                {/* Stock / Alerta */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label className={labelCls}>Stock Inicial (Uds)</label>
                        <input
                            type="number" inputMode="numeric" value={form.stock} onChange={set('stock')} placeholder="0"
                            disabled={Boolean(editingProduct)}
                            title={editingProduct ? 'Ajusta con +/- en la lista' : undefined}
                            className={`${inputCls} ${editingProduct ? 'opacity-40 cursor-not-allowed' : ''}`}
                        />
                        {editingProduct && <span className="text-[10px] text-slate-400 font-extrabold block mt-1 ml-1">Ajusta directamente con +/- en la lista</span>}
                    </div>
                    <div>
                        <label className={`${labelCls} text-amber-600 dark:text-amber-400 flex items-center gap-1`}><AlertTriangle size={12} /> Alerta stock mínimo</label>
                        <input type="number" inputMode="numeric" value={form.lowStockAlert} onChange={set('lowStockAlert')} placeholder="5" className={inputCls} />
                    </div>
                </div>

                <button
                    onClick={handleSubmit}
                    disabled={!canSave || sending}
                    className="w-full py-4 rounded-2xl font-black text-white uppercase tracking-wider text-sm bg-brand hover:bg-brand-dark shadow-xl shadow-brand/25 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer mt-4"
                >
                    {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                    {sending ? 'Guardando cambios...' : 'Guardar cambios en cola'}
                </button>
            </div>
        </div>
    );
}
