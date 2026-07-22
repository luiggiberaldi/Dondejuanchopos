import React, { useState, useEffect } from 'react';
import { X, Package, Barcode, Tag, AlertTriangle, Send, Loader2 } from 'lucide-react';
import { useProductContext } from '../../context/ProductContext';
import { derivePricingMode } from '../../hooks/useProductForm';
import PricingModeSelector from '../Products/PricingModeSelector';
import PricePreviewLine from '../Products/PricePreviewLine';

const EMPTY = {
    name: '', category: '', barcode: '',
    priceUsd: '', priceBsManual: '', priceBsUsdRef: '', costUsd: '', stock: '', lowStockAlert: '5',
    sellByBox: false, boxUnits: '', boxBarcode: '', boxPriceUsd: '', boxPriceBs: '', boxPriceBsUsdRef: '',
    sellByHalfBox: false, halfBoxUnits: '', halfBoxBarcode: '', halfBoxPriceUsd: '', halfBoxPriceBs: '', halfBoxPriceBsUsdRef: '',
    pricingMode: 'tasa_dia',
};

function productToForm(p) {
    if (!p) return { ...EMPTY };
    const s = (v) => (v == null ? '' : String(v));
    return {
        name: s(p.name), category: s(p.category), barcode: s(p.barcode),
        priceUsd: s(p.priceUsd), priceBsManual: s(p.priceBsManual), priceBsUsdRef: s(p.priceBsUsdRef),
        costUsd: s(p.costUsd), stock: s(p.stock), lowStockAlert: s(p.lowStockAlert ?? 5),
        sellByBox: Boolean(p.sellByBox), boxUnits: s(p.boxUnits), boxBarcode: s(p.boxBarcode),
        boxPriceUsd: s(p.boxPriceUsd), boxPriceBs: s(p.boxPriceBs), boxPriceBsUsdRef: s(p.boxPriceBsUsdRef),
        sellByHalfBox: Boolean(p.sellByHalfBox), halfBoxUnits: s(p.halfBoxUnits), halfBoxBarcode: s(p.halfBoxBarcode),
        halfBoxPriceUsd: s(p.halfBoxPriceUsd), halfBoxPriceBs: s(p.halfBoxPriceBs), halfBoxPriceBsUsdRef: s(p.halfBoxPriceBsUsdRef),
        pricingMode: derivePricingMode(p, 'unit'),
    };
}

const inputCls = 'w-full bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl font-bold text-xs text-slate-700 dark:text-white outline-none border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-brand/40';
const labelCls = 'text-[9px] font-bold text-slate-400 ml-1 mb-0.5 block uppercase';

export default function RemoteProductFormModal({ isOpen, onClose, editingProduct, onSubmit, effectiveRate, bcvRate }) {
    const { categories } = useProductContext();
    const [form, setForm] = useState(EMPTY);
    const [sending, setSending] = useState(false);

    useEffect(() => {
        if (isOpen) setForm(productToForm(editingProduct));
    }, [isOpen, editingProduct]);

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

    const handleModeChange = (mode) => {
        setForm(prev => ({
            ...prev,
            pricingMode: mode,
            priceBsManual: mode !== 'bs_fijo' ? '' : prev.priceBsManual,
            priceBsUsdRef: mode !== 'dual_usd' ? '' : prev.priceBsUsdRef,
        }));
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
            const data = {
                ...(editingProduct || {}),
                name: form.name.trim(),
                category: form.category || editingProduct?.category || 'varios',
                barcode: form.barcode.trim() || null,
                priceUsd: Number(form.priceUsd) || 0,
                // D4: solo persistir el campo Bs que corresponde al modo
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
                boxPriceUsd: form.sellByBox && form.boxPriceUsd !== '' ? Number(form.boxPriceUsd) : null,
                boxPriceBs: form.sellByBox && form.boxPriceBs !== '' ? Number(form.boxPriceBs) : null,
                boxPriceBsUsdRef: form.sellByBox && form.boxPriceBsUsdRef !== '' ? Number(form.boxPriceBsUsdRef) : null,
                sellByHalfBox: form.sellByBox && form.sellByHalfBox,
                halfBoxUnits: form.sellByHalfBox ? parseInt(form.halfBoxUnits, 10) || null : null,
                halfBoxBarcode: form.sellByHalfBox ? form.halfBoxBarcode.trim() || null : null,
                halfBoxPriceUsd: form.sellByHalfBox && form.halfBoxPriceUsd !== '' ? Number(form.halfBoxPriceUsd) : null,
                halfBoxPriceBs: form.sellByHalfBox && form.halfBoxPriceBs !== '' ? Number(form.halfBoxPriceBs) : null,
                halfBoxPriceBsUsdRef: form.sellByHalfBox && form.halfBoxPriceBsUsdRef !== '' ? Number(form.halfBoxPriceBsUsdRef) : null,
            };
            delete data.image;
            if (!editingProduct) data.id = crypto.randomUUID();
            await onSubmit(editingProduct ? 'edit' : 'add', data.id, data);
            onClose();
        } finally {
            setSending(false);
        }
    };

    const formatBlock = (title, color, unitsField, barcodeField, usdField, bsField, bsUsdRefField, unitsPlaceholder) => (
        <div className={`p-3 rounded-xl border space-y-2 ${color}`}>
            <span className="text-[9px] font-black uppercase tracking-wider">{title}</span>
            <div className="grid grid-cols-2 gap-2">
                <div>
                    <label className={labelCls}>Unidades</label>
                    <input type="number" inputMode="numeric" value={form[unitsField]} onChange={set(unitsField)} placeholder={unitsPlaceholder} className={inputCls} />
                </div>
                <div>
                    <label className={labelCls}>Cód. barras</label>
                    <input type="text" value={form[barcodeField]} onChange={set(barcodeField)} placeholder="Escanear..." className={inputCls} />
                </div>
                <div>
                    <label className={labelCls}>Precio USD</label>
                    <input type="number" inputMode="decimal" value={form[usdField]} onChange={set(usdField)} placeholder="0.00" className={inputCls} />
                </div>
                {form.pricingMode === 'bs_fijo' && (
                    <div>
                        <label className={labelCls}>Precio Bs (Fijo)</label>
                        <input type="number" inputMode="decimal" value={form[bsField]} onChange={set(bsField)} placeholder="0.00" className={inputCls} />
                    </div>
                )}
                {form.pricingMode === 'dual_usd' && (
                    <div>
                        <label className={labelCls}>$ si paga en Bs</label>
                        <input type="number" inputMode="decimal" value={form[bsUsdRefField]} onChange={set(bsUsdRefField)} placeholder="0.00" className={inputCls} />
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 bg-brand-light/60 dark:bg-slate-800 rounded-xl flex items-center justify-center">
                            <Package size={18} className="text-brand" />
                        </div>
                        <div>
                            <h3 className="font-black text-slate-800 dark:text-white text-sm">
                                {editingProduct ? 'Editar producto (remoto)' : 'Nuevo producto (remoto)'}
                            </h3>
                            <p className="text-[10px] text-slate-400 font-bold">Se encolará hasta pulsar «Subir al sistema»</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                        <X size={16} />
                    </button>
                </div>

                {/* Identidad */}
                <div className="space-y-2">
                    <div>
                        <label className={labelCls}>Nombre</label>
                        <input value={form.name} onChange={set('name')} placeholder="Ej: Ron Santa Teresa 750ml" className={inputCls} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className={labelCls}>Categoría</label>
                            <select value={form.category} onChange={set('category')} className={inputCls}>
                                <option value="">Seleccionar...</option>
                                {(categories || []).filter(c => c.id !== 'todos').map(c => (
                                    <option key={c.id} value={c.id}>{c.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}><Barcode size={9} className="inline mr-0.5" />Cód. barras unidad</label>
                            <input value={form.barcode} onChange={set('barcode')} placeholder="Escanear..." className={inputCls} />
                        </div>
                    </div>
                </div>

                {/* Modo de precio */}
                <div className="space-y-1.5">
                    <label className={labelCls}>¿Cómo se cobra?</label>
                    <PricingModeSelector
                        value={form.pricingMode}
                        onChange={handleModeChange}
                        effectiveRate={effectiveRate}
                        bcvRate={bcvRate}
                    />
                </div>

                {/* Precio Unidad */}
                <div className="p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 space-y-2">
                    <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1"><Tag size={10} /> Unidad</span>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className={labelCls}>{form.pricingMode === 'dual_usd' ? '$ en divisa' : 'Precio USD ($)'}</label>
                            <input type="number" inputMode="decimal" value={form.priceUsd} onChange={set('priceUsd')} placeholder="0.00" className={inputCls} />
                        </div>
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

                {/* Toggle Caja */}
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input type="checkbox" checked={form.sellByBox} onChange={toggle('sellByBox')} className="w-4 h-4 accent-emerald-500" />
                    <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">Vender por Caja</span>
                </label>
                {form.sellByBox && formatBlock('Caja', 'border-blue-500/20 bg-blue-500/5 text-blue-600 dark:text-blue-400', 'boxUnits', 'boxBarcode', 'boxPriceUsd', 'boxPriceBs', 'boxPriceBsUsdRef', 'Ej: 36')}

                {/* Toggle ½ Caja */}
                <label className={`flex items-center gap-2.5 select-none ${form.sellByBox ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}>
                    <input type="checkbox" checked={form.sellByHalfBox} disabled={!form.sellByBox} onChange={toggle('sellByHalfBox')} className="w-4 h-4 accent-emerald-500" />
                    <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">
                        Vender por ½ Caja {!form.sellByBox && <span className="text-rose-500 normal-case">(requiere Caja)</span>}
                    </span>
                </label>
                {form.sellByHalfBox && formatBlock('½ Caja', 'border-purple-500/20 bg-purple-500/5 text-purple-600 dark:text-purple-400', 'halfBoxUnits', 'halfBoxBarcode', 'halfBoxPriceUsd', 'halfBoxPriceBs', 'halfBoxPriceBsUsdRef', form.boxUnits ? String(Math.floor((parseInt(form.boxUnits, 10) || 0) / 2)) : '18')}

                {/* Costo / Stock / Alerta */}
                <div className="grid grid-cols-3 gap-2">
                    <div>
                        <label className={labelCls}>Costo USD</label>
                        <input type="number" inputMode="decimal" value={form.costUsd} onChange={set('costUsd')} placeholder="0.00" className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>Stock (Uds)</label>
                        <input
                            type="number" inputMode="numeric" value={form.stock} onChange={set('stock')} placeholder="0"
                            disabled={Boolean(editingProduct)}
                            title={editingProduct ? 'Ajusta con +/- en la lista' : undefined}
                            className={`${inputCls} ${editingProduct ? 'opacity-40 cursor-not-allowed' : ''}`}
                        />
                        {editingProduct && <span className="text-[8px] text-slate-400 font-medium block mt-0.5 ml-1">Ajusta con +/-</span>}
                    </div>
                    <div>
                        <label className={`${labelCls} text-amber-500 flex items-center gap-0.5`}><AlertTriangle size={9} /> Alerta mín.</label>
                        <input type="number" inputMode="numeric" value={form.lowStockAlert} onChange={set('lowStockAlert')} placeholder="5" className={inputCls} />
                    </div>
                </div>

                <button
                    onClick={handleSubmit}
                    disabled={!canSave || sending}
                    className="w-full py-3 rounded-2xl font-black text-white uppercase tracking-wider text-xs bg-brand hover:bg-brand-dark shadow-lg shadow-brand/25 transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    {sending ? 'Guardando...' : 'Guardar en cola'}
                </button>
                <p className="text-[9px] text-slate-400 text-center -mt-1">Se enviará a la caja al pulsar «Subir al sistema». La foto se gestiona desde la caja.</p>
            </div>
        </div>
    );
}
