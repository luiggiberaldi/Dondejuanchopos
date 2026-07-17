import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Gift, Search, X, Plus, Minus, Camera, Tag, Percent, Package, CheckCircle, Sparkles, AlertTriangle, Zap } from 'lucide-react';
import { Modal } from '../Modal';

export default function ComboFormModal({
    isOpen,
    onClose,
    products,
    categories,
    effectiveRate,
    copEnabled,
    tasaCop,
    onSave,
    editingCombo
}) {
    // ── Estados de Formulario ──
    const [name, setName] = useState('');
    const [image, setImage] = useState(null);
    const [category] = useState('combo');
    const [comboItems, setComboItems] = useState([]); // [{ productId, qty, _product }]
    const [priceUsd, setPriceUsd] = useState('');
    const [priceBsManual, setPriceBsManual] = useState(''); // Precio Bs independiente del combo
    const [autoCalc, setAutoCalc] = useState(false); // Auto-Tasa: sincroniza USD ⇔ Bs
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const [isFormShaking, setIsFormShaking] = useState(false);
    const [barcode, setBarcode] = useState('');

    const searchRef = useRef(null);
    const fileInputRef = useRef(null);
    const debounceRef = useRef(null);

    // ── Debounce: actualizar el término de búsqueda real con 150ms de delay ──
    const handleSearchChange = useCallback((val) => {
        setSearchTerm(val);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setDebouncedSearch(val);
        }, 150);
    }, []);

    useEffect(() => () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
    }, []);

    // ── Productos que no son combos ──
    const nonComboProducts = useMemo(() =>
        products?.filter(p => !p.isCombo) || [],
    [products]);

    // ── IDs ya en el combo (memoizado por separado para no recomputar en cada tecla) ──
    const alreadyAddedIds = useMemo(
        () => new Set(comboItems.map(ci => ci.productId)),
        [comboItems]
    );

    // ── Búsqueda de productos (usa debouncedSearch para no filtrar en cada tecla) ──
    const searchResults = useMemo(() => {
        if (!debouncedSearch.trim()) return [];
        const term = debouncedSearch.toLowerCase();
        return nonComboProducts
            .filter(p => !alreadyAddedIds.has(p.id) && p.name.toLowerCase().includes(term))
            .slice(0, 8);
    }, [debouncedSearch, nonComboProducts, alreadyAddedIds]);

    // ── Totales individuales acumulados en USD ──
    const individualTotal = useMemo(() =>
        comboItems.reduce((sum, ci) => sum + (ci._product?.priceUsd || 0) * ci.qty, 0),
    [comboItems]);

    // ── Suma de partes en Bs: usa el precio Bs MANUAL de cada componente si existe,
    //    y solo cae a la conversión por tasa cuando no hay Bs manual (lógica de precios duales). ──
    const individualTotalBs = useMemo(() =>
        comboItems.reduce((sum, ci) => {
            const p = ci._product;
            if (!p) return sum;
            const unitBs = (p.priceBsManual != null && Number(p.priceBsManual) > 0)
                ? Number(p.priceBsManual)
                : (Number(p.priceUsd) || 0) * effectiveRate;
            return sum + unitBs * ci.qty;
        }, 0),
    [comboItems, effectiveRate]);

    const parsedPrice = parseFloat(priceUsd) || 0;
    const parsedPriceBs = parseFloat(priceBsManual) || 0;
    const savingsUsd = individualTotal > 0 && parsedPrice > 0 ? Math.max(0, individualTotal - parsedPrice) : 0;
    const savingsPct = individualTotal > 0 && parsedPrice > 0 ? ((savingsUsd / individualTotal) * 100) : 0;

    // ── Stock virtual disponible del combo en base al limitante ──
    const availableCombos = useMemo(() => {
        if (comboItems.length === 0) return 0;
        const avails = comboItems.map(ci => {
            if (!ci._product || ci.qty <= 0) return 0;
            return Math.floor((ci._product.stock || 0) / ci.qty);
        });
        return Math.min(...avails);
    }, [comboItems]);

    // ── Inicialización en caso de edición ──
    useEffect(() => {
        if (!isOpen) return;
        if (editingCombo) {
            setName(editingCombo.name || '');
            setImage(editingCombo.image || null);
            setPriceUsd(editingCombo.priceUsd ? String(editingCombo.priceUsd) : '');
            setPriceBsManual(
                editingCombo.priceBsManual ? String(editingCombo.priceBsManual)
                : editingCombo.priceBs ? String(editingCombo.priceBs)
                : ''
            );

            setBarcode(editingCombo.barcode || '');
            // Mapear items
            let items = [];
            if (editingCombo.comboItems?.length > 0) {
                items = editingCombo.comboItems.map(ci => ({
                    productId: ci.productId,
                    qty: ci.qty,
                    _product: products?.find(p => p.id === ci.productId) || null
                }));
            }
            setComboItems(items);
        } else {
            setName('');
            setImage(null);
            setComboItems([]);
            setPriceUsd('');
            setPriceBsManual('');
            setSearchTerm('');
            setBarcode('');
        }
        setAutoCalc(false);
    }, [isOpen, editingCombo, products]);

    // ── Auto-Tasa: conversión bidireccional USD ⇔ Bs cuando está activo ──
    const handleToggleAutoCalc = () => {
        const next = !autoCalc;
        setAutoCalc(next);
        if (next && effectiveRate > 0) {
            const usd = parseFloat(priceUsd) || 0;
            if (usd > 0) {
                setPriceBsManual(String(Math.round(usd * effectiveRate)));
            } else {
                const bs = parseFloat(priceBsManual) || 0;
                if (bs > 0) setPriceUsd((bs / effectiveRate).toFixed(2));
            }
        }
    };
    const handlePriceUsdChange = (val) => {
        setPriceUsd(val);
        if (autoCalc && effectiveRate > 0) {
            const p = parseFloat(val) || 0;
            setPriceBsManual(p > 0 ? String(Math.round(p * effectiveRate)) : '');
        }
    };
    const handlePriceBsChange = (val) => {
        setPriceBsManual(val);
        if (autoCalc && effectiveRate > 0) {
            const p = parseFloat(val) || 0;
            setPriceUsd(p > 0 ? (p / effectiveRate).toFixed(2) : '');
        }
    };

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_SIZE = 400;
                let w = img.width, h = img.height;
                if (w > h) { if (w > MAX_SIZE) { h *= MAX_SIZE / w; w = MAX_SIZE; } }
                else { if (h > MAX_SIZE) { w *= MAX_SIZE / h; h = MAX_SIZE; } }
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                setImage(canvas.toDataURL('image/webp', 0.7));
            };
        };
    };

    const addProduct = (product) => {
        setComboItems(prev => [...prev, { productId: product.id, qty: 1, _product: product }]);
        setSearchTerm('');
        setDebouncedSearch('');
        setIsSearchFocused(false);
    };

    const updateQty = (productId, delta) => {
        setComboItems(prev => prev.map(ci =>
            ci.productId === productId ? { ...ci, qty: Math.max(1, ci.qty + delta) } : ci
        ));
    };

    const removeItem = (productId) => {
        setComboItems(prev => prev.filter(ci => ci.productId !== productId));
    };

    const applyDiscount = (pct) => {
        if (individualTotal <= 0) return;
        const factor = 1 - pct / 100;
        handlePriceUsdChange(String(Math.round(individualTotal * factor * 100) / 100));
        // También sugiere el precio Bs manual con el mismo descuento sobre la suma Bs de partes.
        if (individualTotalBs > 0) {
            setPriceBsManual(String(Math.round(individualTotalBs * factor)));
        }
    };

    const handleSave = () => {
        if (!name.trim() || comboItems.length === 0 || parsedPrice <= 0) {
            setIsFormShaking(true);
            setTimeout(() => setIsFormShaking(false), 500);
            return;
        }

        const formattedName = name.replace(/(^\w{1})|(\s+\w{1})/g, l => l.toUpperCase());
        const cleanItems = comboItems.map(ci => ({ productId: ci.productId, qty: ci.qty }));

        const comboProduct = {
            id: editingCombo?.id || crypto.randomUUID(),
            name: formattedName,
            image,
            category,
            barcode: barcode.trim() || null,
            priceUsd: parsedPrice,
            // Precio Bs MANUAL independiente (respetado por el checkout); si no se define,
            // se usa la conversión por tasa como respaldo.
            priceBsManual: parsedPriceBs > 0 ? parsedPriceBs : null,
            priceBs: parsedPriceBs > 0 ? parsedPriceBs : Math.round(parsedPrice * effectiveRate * 100) / 100,
            costUsd: 0,
            costBs: 0,
            stock: 0,
            unit: 'unidad',
            isCombo: true,
            comboItems: cleanItems,
            lowStockAlert: 0,
            createdAt: editingCombo?.createdAt || new Date().toISOString(),
        };

        onSave(comboProduct);
    };

    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="" size="max-w-md">
            <div className={`space-y-4 ${isFormShaking ? 'animate-[shake_0.5s_ease]' : ''}`}>

                {/* ── Cabecera ── */}
                <div className="flex items-center gap-3 -mt-2">
                    <div className="w-10 h-10 bg-brand-light/60 dark:bg-surface-800/30 rounded-xl flex items-center justify-center">
                        <Gift size={20} className="text-brand" />
                    </div>
                    <div>
                        <h3 className="font-black text-slate-800 dark:text-white text-lg tracking-tight">
                            {editingCombo ? 'Editar Combo' : 'Crear Combo'}
                        </h3>
                        <p className="text-[11px] text-slate-400 font-bold">Agrupa varios productos en un solo precio</p>
                    </div>
                </div>

                {/* ── 1. Información Básica ── */}
                <div className="space-y-3">
                    <div className="flex gap-3">
                        <button type="button" onClick={() => fileInputRef.current?.click()}
                            className="w-16 h-16 shrink-0 bg-brand-light/30 dark:bg-surface-800/10 border-2 border-dashed border-brand/20 dark:border-slate-800 rounded-xl flex items-center justify-center overflow-hidden hover:border-brand transition-colors">
                            {image ? (
                                <img src={image} className="w-full h-full object-cover" alt="" />
                            ) : (
                                <Camera size={20} className="text-brand/60" />
                            )}
                        </button>
                        <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleImageUpload} />
                        <div className="flex-1">
                            <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block uppercase">Nombre del Combo</label>
                            <input
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Ej: Combo Fiesta 2"
                                className="w-full bg-slate-50 dark:bg-slate-800 p-3 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/40 transition-all text-sm"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block uppercase">Código de Barras</label>
                        <input
                            type="text"
                            value={barcode}
                            onChange={e => setBarcode(e.target.value)}
                            placeholder="Escanear o ingresar (sep. con comas)..."
                            className="w-full bg-slate-50 dark:bg-slate-800 p-3 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/40 transition-all text-sm"
                        />
                    </div>
                </div>

                {/* ── 2. Componentes del Combo ── */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold text-slate-400 ml-1 block uppercase flex items-center gap-1.5">
                            <Package size={11} /> Productos en el combo
                        </label>
                        {comboItems.length > 0 && (
                            <span className="text-[10px] font-black bg-brand-light/60 dark:bg-surface-800/30 text-brand px-2 py-0.5 rounded-full">
                                {comboItems.length} item{comboItems.length > 1 ? 's' : ''}
                            </span>
                        )}
                    </div>

                    {/* Buscador */}
                    <div className="relative">
                        <div className={`flex items-center bg-white dark:bg-slate-900 rounded-2xl border-2 transition-all ${isSearchFocused ? 'border-brand shadow-lg shadow-brand/10' : 'border-slate-200 dark:border-slate-750'}`}>
                            <div className="ml-3 p-1 rounded-lg">
                                <Search size={15} className={isSearchFocused ? 'text-brand' : 'text-slate-400'} />
                            </div>
                            <input
                                ref={searchRef}
                                type="text"
                                value={searchTerm}
                                onChange={e => handleSearchChange(e.target.value)}
                                onFocus={() => setIsSearchFocused(true)}
                                onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                                placeholder="Buscar producto para agregar..."
                                className="flex-1 bg-transparent p-3 font-bold text-slate-700 dark:text-white outline-none text-sm placeholder:text-slate-400/60"
                            />
                            {searchTerm && (
                                <button type="button" onClick={() => { setSearchTerm(''); setDebouncedSearch(''); }} className="mr-2 p-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-650 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all">
                                    <X size={12} strokeWidth={3} />
                                </button>
                            )}
                        </div>

                        {/* Resultados Desplegables */}
                        {isSearchFocused && searchResults.length > 0 && (
                            <div className="absolute z-50 left-0 right-0 mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl max-h-52 overflow-y-auto custom-scrollbar">
                                <div className="p-1.5">
                                    {searchResults.map((p) => (
                                        <button key={p.id} type="button"
                                            onMouseDown={(e) => { e.preventDefault(); addProduct(p); }}
                                            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-brand-light/30 dark:hover:bg-surface-800/20 transition-all text-left">
                                            <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden shrink-0 flex items-center justify-center border border-slate-200/50 dark:border-slate-700/50">
                                                {p.image ? (
                                                    <img src={p.image} className="w-full h-full object-cover" alt="" />
                                                ) : (
                                                    <Tag size={16} className="text-slate-300 dark:text-slate-650" />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-bold text-slate-700 dark:text-white truncate capitalize">{p.name}</div>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="text-[11px] font-black text-brand">${p.priceUsd.toFixed(2)}</span>
                                                    <span className="text-[10px] text-slate-400">·</span>
                                                    <span className={`text-[10px] font-bold ${(p.stock ?? 0) > 0 ? 'text-slate-400' : 'text-rose-400'}`}>
                                                        {(p.stock ?? 0) > 0 ? `${p.stock} en stock` : 'Sin stock'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="w-8 h-8 bg-brand-light/60 dark:bg-surface-800/30 rounded-lg flex items-center justify-center shrink-0">
                                                <Plus size={14} className="text-brand" strokeWidth={3} />
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {isSearchFocused && searchTerm.trim() && searchResults.length === 0 && (
                            <div className="absolute z-50 left-0 right-0 mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-5 text-center">
                                <Search size={20} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                                <p className="text-xs font-bold text-slate-400">No se encontró "{searchTerm}"</p>
                            </div>
                        )}
                    </div>

                    {/* Componentes Agregados */}
                    {comboItems.length === 0 ? (
                        <div className="border-2 border-dashed border-brand/10 rounded-2xl p-6 text-center bg-brand-light/10">
                            <div className="w-12 h-12 bg-brand-light/60 dark:bg-surface-800/30 rounded-xl flex items-center justify-center mx-auto mb-3">
                                <Gift size={22} className="text-brand/60" />
                            </div>
                            <p className="text-sm font-bold text-slate-500 dark:text-slate-400">Agrega productos al combo</p>
                            <p className="text-[11px] text-slate-400/60 mt-1">Usa el buscador de arriba para empezar</p>
                        </div>
                    ) : (
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                            {comboItems.map((ci, idx) => {
                                const p = ci._product;
                                if (!p) return null;
                                const subtotal = p.priceUsd * ci.qty;
                                return (
                                    <div key={ci.productId} className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-2.5 hover:border-brand transition-colors">
                                        <div className="w-5 h-5 bg-brand-light/60 dark:bg-surface-800/30 rounded-md flex items-center justify-center shrink-0">
                                            <span className="text-[10px] font-black text-brand">{idx + 1}</span>
                                        </div>

                                        <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden shrink-0 flex items-center justify-center border border-slate-200/50 dark:border-slate-700/50">
                                            {p.image ? (
                                                <img src={p.image} className="w-full h-full object-cover" alt="" />
                                            ) : (
                                                <Tag size={14} className="text-slate-350" />
                                            )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-bold text-slate-700 dark:text-white truncate capitalize">{p.name}</div>
                                            <div className="text-[10px] text-slate-400 font-bold">${p.priceUsd.toFixed(2)} c/u · <span className="text-brand font-black">${subtotal.toFixed(2)}</span></div>
                                        </div>

                                        <div className="flex items-center gap-0.5 shrink-0 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-0.5">
                                            <button type="button" onClick={() => updateQty(ci.productId, -1)}
                                                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all">
                                                <Minus size={12} strokeWidth={3} />
                                            </button>
                                            <span className="w-7 text-center text-xs font-black text-brand">{ci.qty}</span>
                                            <button type="button" onClick={() => updateQty(ci.productId, 1)}
                                                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-brand hover:bg-brand-light transition-all">
                                                <Plus size={12} strokeWidth={3} />
                                            </button>
                                        </div>

                                        <button type="button" onClick={() => removeItem(ci.productId)}
                                            className="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 transition-all shrink-0">
                                            <X size={13} strokeWidth={3} />
                                        </button>
                                    </div>
                                );
                            })}

                            <div className="flex justify-between items-center px-3 py-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800">
                                <span className="text-[10px] font-bold text-slate-400 uppercase">Suma de partes ({comboItems.length})</span>
                                <span className="text-xs font-black text-slate-750 dark:text-slate-200">${individualTotal.toFixed(2)} / {individualTotalBs.toFixed(2)} Bs</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* ── 3. Precio de Venta en USD y Bs ── */}
                {comboItems.length > 0 && (
                    <div className="space-y-3 animate-in fade-in duration-200">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold text-slate-400 ml-1 block uppercase flex items-center gap-1.5">
                                <Sparkles size={11} /> Precio de venta del combo
                            </label>
                            <button
                                type="button"
                                onClick={handleToggleAutoCalc}
                                title={autoCalc ? 'Auto-Tasa activo: USD ⇔ Bs según tasa' : 'Activar cálculo automático USD ⇔ Bs'}
                                className={`flex items-center gap-1 text-[9px] font-black px-2.5 py-1 rounded-lg transition-all active:scale-95 ${
                                    autoCalc
                                        ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 border border-slate-200 dark:border-slate-700'
                                }`}
                            >
                                <Zap size={10} className={autoCalc ? 'fill-white' : ''} /> Auto-Tasa
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[9px] font-bold text-slate-400 ml-1 mb-1 block uppercase">Precio USD ($)</label>
                                <div className="relative">
                                    <input
                                        type="number" inputMode="decimal"
                                        value={priceUsd}
                                        onChange={e => handlePriceUsdChange(e.target.value)}
                                        placeholder="0.00"
                                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-2.5 rounded-xl font-black text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/40 text-sm"
                                    />
                                    {parsedPrice > 0 && (
                                        <CheckCircle size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand" />
                                    )}
                                </div>
                            </div>
                            <div>
                                <label className="text-[9px] font-bold text-slate-400 ml-1 mb-1 block uppercase">Precio Bs (Manual)</label>
                                <input
                                    type="number" inputMode="decimal"
                                    value={priceBsManual}
                                    onChange={e => handlePriceBsChange(e.target.value)}
                                    placeholder={parsedPrice > 0 ? (parsedPrice * effectiveRate).toFixed(2) : '0.00'}
                                    className={`w-full p-2.5 rounded-xl font-black text-sm outline-none border transition-all duration-200 ${
                                        autoCalc
                                            ? 'text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/10 focus:ring-2 focus:ring-emerald-500/40'
                                            : 'text-slate-700 dark:text-white bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-brand/40'
                                    }`}
                                />
                                {effectiveRate > 0 && parsedPrice > 0 && (
                                    <span className="text-[8px] text-slate-400 font-medium block mt-0.5 ml-1">Ref: {Math.round(parsedPrice * effectiveRate)} Bs a tasa BCV</span>
                                )}
                            </div>
                        </div>

                        {/* Descuentos Rápidos */}
                        <div className="flex gap-1">
                            {[5, 10, 15, 20, 25].map(pct => (
                                <button key={pct} type="button" onClick={() => applyDiscount(pct)}
                                    className="flex-1 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-brand-light/35 text-slate-500 hover:text-brand text-[10px] font-black rounded-lg transition-colors">
                                    -{pct}%
                                </button>
                            ))}
                        </div>

                        {/* Ahorro Estimado */}
                        {savingsUsd > 0 && (
                            <div className="flex items-center justify-between bg-brand-light/40 dark:bg-surface-800/10 border border-brand/10 dark:border-surface-800 rounded-xl px-3 py-2">
                                <span className="text-[10px] font-bold text-brand flex items-center gap-1">
                                    <Percent size={11} /> Ahorro para el cliente:
                                </span>
                                <span className="text-xs font-black text-brand">
                                    ${savingsUsd.toFixed(2)} / {(savingsUsd * effectiveRate).toFixed(2)} Bs (-{savingsPct.toFixed(0)}%)
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Vista Previa Final ── */}
                {comboItems.length > 0 && parsedPrice > 0 && (
                    <div className="bg-brand-light/20 dark:bg-surface-800/10 border border-brand/10 dark:border-surface-850 rounded-xl p-3.5 animate-in fade-in duration-200">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-black text-brand flex items-center gap-1.5">
                                <Gift size={13} /> Vista previa del combo
                            </span>
                            <span className={`text-[10px] font-bold ${availableCombos > 0 ? 'bg-brand-light/65 text-brand' : 'bg-red-50 text-red-500'} px-2 py-0.5 rounded-full`}>
                                {availableCombos > 0 ? `${availableCombos} disponible${availableCombos !== 1 ? 's' : ''}` : 'Sin componentes suficientes'}
                            </span>
                        </div>

                        <div className="space-y-1 text-xs">
                            {comboItems.map(ci => (
                                <div key={ci.productId} className="flex justify-between text-[11px]">
                                    <span className="text-slate-500 dark:text-slate-400 capitalize">{ci.qty}x {ci._product?.name || '?'}</span>
                                    <span className="text-slate-450">${((ci._product?.priceUsd || 0) * ci.qty).toFixed(2)}</span>
                                </div>
                            ))}
                            <div className="flex justify-between text-[11px] pt-1.5 border-t border-brand/10 dark:border-slate-800">
                                <span className="text-slate-450">Individual</span>
                                <span className="text-slate-400 line-through">${individualTotal.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-xs font-black text-brand pt-0.5">
                                <span>Precio combo</span>
                                <span>${parsedPrice.toFixed(2)} / {(parsedPriceBs > 0 ? parsedPriceBs : parsedPrice * effectiveRate).toFixed(2)} Bs</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Botón Guardar ── */}
                <button type="button" onClick={handleSave}
                    disabled={!name.trim() || comboItems.length === 0 || parsedPrice <= 0}
                    className="w-full py-3.5 rounded-2xl font-black text-white uppercase tracking-wider text-sm bg-brand hover:bg-brand-dark shadow-lg shadow-brand/25 transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100">
                    {editingCombo ? 'Guardar Cambios' : 'Crear Combo'}
                </button>
            </div>
        </Modal>
    );
}
