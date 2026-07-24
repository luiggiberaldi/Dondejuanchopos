import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Gift, Search, X, Plus, Minus, Camera, Tag, Percent, Package, CheckCircle, Sparkles, Zap, ChevronDown, ChevronUp, Check, Sliders, AlertCircle } from 'lucide-react';
import { Modal } from '../Modal';
import { calculateComboStock } from '../../utils/productProcessor';

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
    const [isModular, setIsModular] = useState(false);
    const [modularGroups, setModularGroups] = useState([]); // [{ id, title, requiredQty, allowedProductIds }]
    const [groupSearchTerms, setGroupSearchTerms] = useState({}); // { [groupId]: 'search term' }
    const [priceUsd, setPriceUsd] = useState('');
    const [priceBsManual, setPriceBsManual] = useState(''); // Precio Bs independiente del combo
    const [autoCalc, setAutoCalc] = useState(true); // Auto-Tasa activo por defecto
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const [isFormShaking, setIsFormShaking] = useState(false);
    const [barcode, setBarcode] = useState('');
    const [showBarcode, setShowBarcode] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState({}); // { [groupId]: boolean }

    const searchRef = useRef(null);
    const fileInputRef = useRef(null);
    const debounceRef = useRef(null);

    // ── Debounce: actualizar término de búsqueda ──
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

    // ── IDs ya en los ítems fijos del combo ──
    const alreadyAddedIds = useMemo(
        () => new Set(comboItems.map(ci => ci.productId)),
        [comboItems]
    );

    // ── Búsqueda de productos ──
    const searchResults = useMemo(() => {
        if (!debouncedSearch.trim()) return [];
        const term = debouncedSearch.toLowerCase();
        return nonComboProducts
            .filter(p => !alreadyAddedIds.has(p.id) && p.name.toLowerCase().includes(term))
            .slice(0, 8);
    }, [debouncedSearch, nonComboProducts, alreadyAddedIds]);

    // ── Totales acumulados ──
    const individualTotal = useMemo(() =>
        comboItems.reduce((sum, ci) => sum + (ci._product?.priceUsd || 0) * ci.qty, 0),
    [comboItems]);

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

    // ── Stock disponible calculado ──
    const availableCombos = useMemo(() => {
        return calculateComboStock(
            { isCombo: true, comboItems, isModular, modularGroups },
            products
        );
    }, [comboItems, isModular, modularGroups, products]);

    // ── Gestores de Grupos Modulares ──
    const addModularGroup = () => {
        const newId = crypto.randomUUID();
        setModularGroups(prev => [
            ...prev,
            {
                id: newId,
                title: `Selección ${prev.length + 1}`,
                requiredQty: 10,
                allowedProductIds: []
            }
        ]);
        // Expandir el nuevo grupo automáticamente
        setCollapsedGroups(prev => ({ ...prev, [newId]: false }));
    };

    const updateModularGroup = (groupId, field, value) => {
        setModularGroups(prev => prev.map(g => g.id === groupId ? { ...g, [field]: value } : g));
    };

    const removeModularGroup = (groupId) => {
        setModularGroups(prev => prev.filter(g => g.id !== groupId));
    };

    const toggleProductInGroup = (groupId, productId) => {
        setModularGroups(prev => prev.map(g => {
            if (g.id !== groupId) return g;
            const exists = (g.allowedProductIds || []).includes(productId);
            return {
                ...g,
                allowedProductIds: exists
                    ? g.allowedProductIds.filter(id => id !== productId)
                    : [...g.allowedProductIds, productId]
            };
        }));
    };

    const toggleGroupCollapse = (groupId) => {
        setCollapsedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
    };

    // ── Carga en caso de edición ──
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
            setShowBarcode(Boolean(editingCombo.barcode));
            setIsModular(!!editingCombo.isModular || (editingCombo.modularGroups && editingCombo.modularGroups.length > 0));
            setModularGroups(editingCombo.modularGroups || []);

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
            setIsModular(false);
            setModularGroups([]);
            setPriceUsd('');
            setPriceBsManual('');
            setSearchTerm('');
            setBarcode('');
            setShowBarcode(false);
            setCollapsedGroups({});
        }
        setAutoCalc(true);
    }, [isOpen, editingCombo, products]);

    // ── Auto-Tasa Conversión ──
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
        if (individualTotalBs > 0) {
            setPriceBsManual(String(Math.round(individualTotalBs * factor)));
        }
    };

    // ── Validaciones para guardar ──
    const hasName = Boolean(name.trim());
    const hasFixedItems = comboItems.length > 0;
    const hasModularItems = (isModular || modularGroups.length > 0) && modularGroups.length > 0;
    const hasProducts = hasFixedItems || hasModularItems;
    const hasValidPrice = parsedPrice > 0;
    const isFormValid = hasName && hasProducts && hasValidPrice;

    const handleSave = () => {
        if (!isFormValid) {
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
            priceBsManual: parsedPriceBs > 0 ? parsedPriceBs : null,
            priceBs: parsedPriceBs > 0 ? parsedPriceBs : Math.round(parsedPrice * effectiveRate * 100) / 100,
            costUsd: 0,
            costBs: 0,
            stock: 0,
            unit: 'unidad',
            isCombo: true,
            isModular: hasModularItems,
            comboItems: cleanItems,
            modularGroups: hasModularItems ? modularGroups.map(g => ({
                id: g.id || crypto.randomUUID(),
                title: g.title || 'Selección',
                requiredQty: Math.max(1, parseInt(g.requiredQty, 10) || 1),
                allowedProductIds: g.allowedProductIds || []
            })) : [],
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
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-colors ${
                        isModular 
                            ? 'bg-purple-100 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400' 
                            : 'bg-brand-light/60 dark:bg-surface-800/30 text-brand'
                    }`}>
                        {isModular ? <Sparkles size={20} /> : <Gift size={20} />}
                    </div>
                    <div>
                        <h3 className="font-black text-slate-800 dark:text-white text-lg tracking-tight">
                            {editingCombo 
                                ? (isModular ? 'Editar Combo con Opciones' : 'Editar Combo Fijo') 
                                : (isModular ? 'Crear Combo con Opciones' : 'Crear Combo Fijo')}
                        </h3>
                        <p className="text-[11px] text-slate-400 font-bold">
                            {isModular 
                                ? 'El cliente elige libremente sus productos preferidos' 
                                : 'Agrupa productos exactos en un solo precio fijo'}
                        </p>
                    </div>
                </div>

                {/* ── Selector de Tipo de Combo (Tarjetas visuales) ── */}
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-2xl border border-slate-200/50 dark:border-slate-700/50">
                    <button
                        type="button"
                        onClick={() => setIsModular(false)}
                        className={`p-2.5 rounded-xl text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                            !isModular
                                ? 'bg-white dark:bg-slate-700 text-brand shadow-sm border border-brand/20'
                                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                    >
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${!isModular ? 'bg-brand-light text-brand' : 'bg-slate-200 dark:bg-slate-800'}`}>
                            <Package size={16} />
                        </div>
                        <div className="min-w-0">
                            <div className="text-xs font-black leading-tight">Combo Fijo</div>
                            <div className="text-[9px] text-slate-400 font-medium truncate">Productos fijos</div>
                        </div>
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            setIsModular(true);
                            if (modularGroups.length === 0) addModularGroup();
                        }}
                        className={`p-2.5 rounded-xl text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                            isModular
                                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-sm shadow-purple-500/20'
                                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                    >
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isModular ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}>
                            <Sparkles size={16} />
                        </div>
                        <div className="min-w-0">
                            <div className="text-xs font-black leading-tight">Con Opciones</div>
                            <div className="text-[9px] text-purple-200 dark:text-purple-300 font-medium truncate">El cliente elige</div>
                        </div>
                    </button>
                </div>

                {/* ── 1. Información Básica + Precio de Venta (Al Inicio) ── */}
                <div className="space-y-3 bg-slate-50 dark:bg-slate-900/60 p-3.5 rounded-2xl border border-slate-200/60 dark:border-slate-800">
                    <div className="flex gap-3">
                        <button type="button" onClick={() => fileInputRef.current?.click()}
                            className="w-14 h-14 shrink-0 bg-white dark:bg-slate-800 border-2 border-dashed border-brand/30 rounded-xl flex items-center justify-center overflow-hidden hover:border-brand transition-colors shadow-sm">
                            {image ? (
                                <img src={image} className="w-full h-full object-cover" alt="" />
                            ) : (
                                <Camera size={18} className="text-brand/60" />
                            )}
                        </button>
                        <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleImageUpload} />
                        <div className="flex-1">
                            <label className="text-[10px] font-black text-slate-400 ml-1 mb-1 block uppercase tracking-wider">Nombre del Combo</label>
                            <input
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Ej: Combo Familiar 3x2"
                                className="w-full bg-white dark:bg-slate-800 p-2.5 rounded-xl font-bold text-slate-800 dark:text-white outline-none border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-brand/40 transition-all text-sm"
                            />
                        </div>
                    </div>

                    {/* Precios USD & Bs (Mapeados arriba) */}
                    <div className="space-y-2 pt-1 border-t border-slate-200/60 dark:border-slate-800">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-black text-slate-400 ml-1 block uppercase tracking-wider flex items-center gap-1">
                                <Tag size={11} /> Precio de venta
                            </label>
                            <button
                                type="button"
                                onClick={handleToggleAutoCalc}
                                title={autoCalc ? 'Auto-Tasa activo' : 'Activar cálculo automático Bs'}
                                className={`flex items-center gap-1 text-[9px] font-black px-2 py-0.5 rounded-lg transition-all ${
                                    autoCalc
                                        ? 'bg-emerald-500 text-white shadow-xs'
                                        : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                                }`}
                            >
                                <Zap size={10} className={autoCalc ? 'fill-white' : ''} /> Auto-Tasa
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
                            <div>
                                <label className="text-[9px] font-bold text-slate-400 ml-1 mb-1 block uppercase">Precio USD ($)</label>
                                <div className="relative">
                                    <input
                                        type="number" inputMode="decimal"
                                        value={priceUsd}
                                        onChange={e => handlePriceUsdChange(e.target.value)}
                                        placeholder="0.00"
                                        className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 rounded-xl font-black text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-brand/40 text-sm"
                                    />
                                    {parsedPrice > 0 && (
                                        <CheckCircle size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-brand" />
                                    )}
                                </div>
                            </div>
                            <div>
                                <label className="text-[9px] font-bold text-slate-400 ml-1 mb-1 block uppercase">Precio Bs</label>
                                <input
                                    type="number" inputMode="decimal"
                                    value={priceBsManual}
                                    onChange={e => handlePriceBsChange(e.target.value)}
                                    placeholder={parsedPrice > 0 ? (parsedPrice * effectiveRate).toFixed(2) : '0.00'}
                                    className={`w-full p-2 rounded-xl font-black text-sm outline-none border transition-all ${
                                        autoCalc
                                            ? 'text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/20'
                                            : 'text-slate-800 dark:text-white bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                                    }`}
                                />
                            </div>
                        </div>

                        {/* Descuentos Rápidos sobre suma de partes */}
                        {individualTotal > 0 && (
                            <div className="flex gap-1 pt-1">
                                {[5, 10, 15, 20, 25].map(pct => (
                                    <button key={pct} type="button" onClick={() => applyDiscount(pct)}
                                        className="flex-1 py-1 bg-white dark:bg-slate-800 hover:bg-brand-light text-slate-500 hover:text-brand text-[9px] font-black rounded-lg transition-colors border border-slate-200/50 dark:border-slate-700/50">
                                        -{pct}%
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Código de barras opcional */}
                    {!showBarcode && !barcode ? (
                        <button
                            type="button"
                            onClick={() => setShowBarcode(true)}
                            className="text-[10px] font-bold text-slate-400 hover:text-brand transition-colors block ml-1"
                        >
                            ＋ Agregar código de barras (opcional)
                        </button>
                    ) : (
                        <div>
                            <label className="text-[9px] font-bold text-slate-400 ml-1 mb-1 block uppercase">Código de Barras</label>
                            <input
                                type="text"
                                value={barcode}
                                onChange={e => setBarcode(e.target.value)}
                                placeholder="Escanear o ingresar..."
                                className="w-full bg-white dark:bg-slate-800 p-2 rounded-xl font-bold text-slate-700 dark:text-white outline-none border border-slate-200 dark:border-slate-700 text-xs"
                            />
                        </div>
                    )}
                </div>

                {/* ── 2. Productos Incluidos Siempre (Fijos) ── */}
                <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] font-black text-slate-400 ml-1 block uppercase flex items-center gap-1.5 tracking-wider">
                            <Package size={12} /> {isModular ? 'Productos incluidos siempre (Obligatorios)' : 'Productos del combo'}
                        </label>
                        {comboItems.length > 0 && (
                            <span className="text-[10px] font-black bg-brand-light text-brand px-2 py-0.5 rounded-full">
                                {comboItems.length} producto{comboItems.length > 1 ? 's' : ''}
                            </span>
                        )}
                    </div>

                    {/* Buscador */}
                    <div className="relative">
                        <div className={`flex items-center bg-white dark:bg-slate-900 rounded-2xl border-2 transition-all ${isSearchFocused ? 'border-brand shadow-md shadow-brand/10' : 'border-slate-200 dark:border-slate-800'}`}>
                            <Search size={14} className={`ml-3 ${isSearchFocused ? 'text-brand' : 'text-slate-400'}`} />
                            <input
                                ref={searchRef}
                                type="text"
                                value={searchTerm}
                                onChange={e => handleSearchChange(e.target.value)}
                                onFocus={() => setIsSearchFocused(true)}
                                onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                                placeholder={isModular ? "Buscar producto fijo para incluir siempre..." : "Buscar producto para añadir al combo..."}
                                className="flex-1 bg-transparent p-2.5 font-bold text-slate-700 dark:text-white outline-none text-xs placeholder:text-slate-400/60"
                            />
                            {searchTerm && (
                                <button type="button" onClick={() => { setSearchTerm(''); setDebouncedSearch(''); }} className="mr-2 p-1 text-slate-400 hover:text-slate-600">
                                    <X size={12} />
                                </button>
                            )}
                        </div>

                        {/* Dropdown de Búsqueda */}
                        {isSearchFocused && searchResults.length > 0 && (
                            <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl max-h-48 overflow-y-auto custom-scrollbar p-1.5 space-y-1">
                                {searchResults.map((p) => (
                                    <button key={p.id} type="button"
                                        onMouseDown={(e) => { e.preventDefault(); addProduct(p); }}
                                        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-brand-light/30 dark:hover:bg-slate-800 transition-all text-left">
                                        <div className="w-8 h-8 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden shrink-0 flex items-center justify-center">
                                            {p.image ? <img src={p.image} className="w-full h-full object-cover" alt="" /> : <Tag size={14} className="text-slate-400" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-bold text-slate-700 dark:text-white truncate capitalize">{p.name}</div>
                                            <div className="text-[10px] text-slate-400 font-medium">${p.priceUsd.toFixed(2)} · Stock: {p.stock ?? 0}</div>
                                        </div>
                                        <Plus size={14} className="text-brand shrink-0" strokeWidth={3} />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Lista de productos fijos */}
                    {comboItems.length > 0 && (
                        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                            {comboItems.map((ci, idx) => {
                                const p = ci._product;
                                if (!p) return null;
                                const subtotal = p.priceUsd * ci.qty;
                                return (
                                    <div key={ci.productId} className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2">
                                        <span className="w-5 h-5 bg-brand-light rounded-md flex items-center justify-center text-[10px] font-black text-brand shrink-0">{idx + 1}</span>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-bold text-slate-800 dark:text-white truncate capitalize">{p.name}</div>
                                            <div className="text-[10px] text-slate-400 font-medium">${p.priceUsd.toFixed(2)} c/u · <span className="text-brand font-bold">${subtotal.toFixed(2)}</span></div>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
                                            <button type="button" onClick={() => updateQty(ci.productId, -1)} className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-red-500"><Minus size={11} strokeWidth={3} /></button>
                                            <span className="w-6 text-center text-xs font-black text-brand">{ci.qty}</span>
                                            <button type="button" onClick={() => updateQty(ci.productId, 1)} className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-brand"><Plus size={11} strokeWidth={3} /></button>
                                        </div>
                                        <button type="button" onClick={() => removeItem(ci.productId)} className="p-1 text-slate-400 hover:text-rose-500 shrink-0"><X size={13} /></button>
                                    </div>
                                );
                            })}
                            <div className="flex justify-between items-center px-3 py-1.5 bg-slate-100 dark:bg-slate-800/50 rounded-xl text-[10px] font-bold">
                                <span className="text-slate-400 uppercase">Suma de partes individuales</span>
                                <span className="text-slate-700 dark:text-slate-200 font-black">${individualTotal.toFixed(2)} / {individualTotalBs.toFixed(2)} Bs</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* ── 3. Grupos de Selección (Solo Combo con Opciones) ── */}
                {isModular && (
                    <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-black text-slate-400 ml-1 block uppercase flex items-center gap-1.5 tracking-wider">
                                <Sparkles size={12} className="text-purple-500" /> Grupos de Selección Libre
                            </label>
                            <button
                                type="button"
                                onClick={addModularGroup}
                                className="px-2.5 py-1 text-[10px] font-black rounded-xl bg-purple-600 text-white hover:bg-purple-700 transition-all flex items-center gap-1 shadow-xs cursor-pointer"
                            >
                                <Plus size={12} strokeWidth={2.5} /> Nuevo Grupo
                            </button>
                        </div>

                        <div className="space-y-2">
                            {modularGroups.map((g) => {
                                const allowedIds = g.allowedProductIds || [];
                                const allowedProds = allowedIds.map(pid => products?.find(p => p.id === pid)).filter(Boolean);
                                const totalGroupStock = allowedProds.reduce((sum, p) => sum + (p.stock || 0), 0);
                                const isCoverageOk = totalGroupStock >= g.requiredQty;
                                const isCollapsed = Boolean(collapsedGroups[g.id]);
                                const groupSearch = (groupSearchTerms[g.id] || '').toLowerCase().trim();

                                const filteredAvailable = nonComboProducts.filter(p => {
                                    if (allowedIds.includes(p.id)) return false;
                                    if (!groupSearch) return true;
                                    return p.name.toLowerCase().includes(groupSearch);
                                });

                                return (
                                    <div key={g.id} className="bg-white dark:bg-slate-900 border border-purple-200/80 dark:border-purple-800/50 rounded-2xl shadow-xs overflow-hidden">
                                        {/* Accordion Header */}
                                        <div className="p-3 bg-purple-50/50 dark:bg-purple-950/20 flex items-center gap-2 border-b border-purple-100 dark:border-purple-900/30">
                                            <button
                                                type="button"
                                                onClick={() => toggleGroupCollapse(g.id)}
                                                className="p-1 text-purple-600 dark:text-purple-400 hover:bg-purple-100 rounded-lg transition-colors"
                                            >
                                                {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                                            </button>
                                            <input
                                                type="text"
                                                value={g.title}
                                                onChange={e => updateModularGroup(g.id, 'title', e.target.value)}
                                                placeholder="Nombre del grupo (ej: Cervezas)"
                                                className="flex-1 bg-white dark:bg-slate-800 p-2 rounded-xl text-xs font-black text-slate-800 dark:text-white outline-none border border-purple-200/60 dark:border-purple-800"
                                            />
                                            <div className="flex items-center gap-1 bg-white dark:bg-slate-800 px-2 py-1.5 rounded-xl border border-purple-200/60 dark:border-purple-800 shrink-0">
                                                <span className="text-[9px] font-bold text-slate-400">Elige:</span>
                                                <input
                                                    type="number" min="1"
                                                    value={g.requiredQty}
                                                    onChange={e => updateModularGroup(g.id, 'requiredQty', Math.max(1, parseInt(e.target.value, 10) || 1))}
                                                    className="w-7 text-center text-xs font-black text-purple-600 dark:text-purple-400 outline-none"
                                                />
                                                <span className="text-[9px] font-bold text-slate-400">uds</span>
                                            </div>
                                            <button type="button" onClick={() => removeModularGroup(g.id)} className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg">
                                                <X size={14} />
                                            </button>
                                        </div>

                                        {/* Status summary when collapsed */}
                                        {isCollapsed && (
                                            <div className="px-3 py-2 text-[10px] font-bold flex justify-between items-center text-slate-500">
                                                <span>{allowedProds.length} opciones permitidas</span>
                                                <span className={isCoverageOk ? 'text-emerald-600' : 'text-amber-600'}>
                                                    Stock: {totalGroupStock} / {g.requiredQty} {isCoverageOk ? '✓' : '⚠️'}
                                                </span>
                                            </div>
                                        )}

                                        {/* Accordion Body */}
                                        {!isCollapsed && (
                                            <div className="p-3 space-y-2.5">
                                                {/* Chips de Productos Permitidos */}
                                                {allowedProds.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {allowedProds.map(p => (
                                                            <span key={p.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-xs font-bold border border-purple-200">
                                                                <span className="capitalize">{p.name}</span>
                                                                <span className="text-[9px] font-black bg-purple-200/80 px-1 rounded text-purple-800">{p.stock ?? 0}</span>
                                                                <button type="button" onClick={() => toggleProductInGroup(g.id, p.id)} className="hover:text-rose-500 text-purple-400"><X size={12} /></button>
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Mini buscador para añadir opciones */}
                                                <div className="relative">
                                                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                                    <input
                                                        type="text"
                                                        value={groupSearchTerms[g.id] || ''}
                                                        onChange={e => setGroupSearchTerms(prev => ({ ...prev, [g.id]: e.target.value }))}
                                                        placeholder="Buscar producto para permitir en este grupo..."
                                                        className="w-full bg-slate-50 dark:bg-slate-800 pl-7 pr-6 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 outline-none border border-slate-200/50"
                                                    />
                                                </div>

                                                {/* Lista filtrada de permitidos */}
                                                <div className="max-h-28 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                                                    {filteredAvailable.slice(0, groupSearch ? 8 : 3).map(p => (
                                                        <button
                                                            key={p.id} type="button" onClick={() => toggleProductInGroup(g.id, p.id)}
                                                            className="w-full flex items-center justify-between p-1.5 rounded-xl text-left text-xs font-bold bg-slate-50 dark:bg-slate-800/50 hover:bg-purple-50 text-slate-700 dark:text-slate-300 transition-colors"
                                                        >
                                                            <span className="truncate capitalize">{p.name}</span>
                                                            <span className="text-[10px] text-purple-600 font-black shrink-0 ml-2">+ Añadir</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* ── Vista Previa Simplificada ── */}
                {parsedPrice > 0 && hasProducts && (
                    <div className="bg-brand-light/30 dark:bg-slate-800/60 border border-brand/20 rounded-2xl p-3 flex items-center justify-between">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-wider text-brand">Resumen del Combo</div>
                            <div className="text-xs font-black text-slate-800 dark:text-white">${parsedPrice.toFixed(2)} / {(parsedPriceBs > 0 ? parsedPriceBs : parsedPrice * effectiveRate).toFixed(2)} Bs</div>
                        </div>
                        <div className="text-right">
                            {savingsUsd > 0 && (
                                <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full block mb-0.5">
                                    Ahorro cliente: -${savingsUsd.toFixed(2)} (-{savingsPct.toFixed(0)}%)
                                </span>
                            )}
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${availableCombos > 0 ? 'bg-brand-light text-brand' : 'bg-rose-100 text-rose-600'}`}>
                                {availableCombos > 0 ? `${availableCombos} combos disp.` : 'Sin stock suficiente'}
                            </span>
                        </div>
                    </div>
                )}

                {/* ── Checklist Contextual & Botón Guardar ── */}
                <div className="space-y-2 pt-1">
                    {!isFormValid && (
                        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-2.5 rounded-xl text-[10px] font-bold text-amber-700 dark:text-amber-400 space-y-1">
                            <div className="flex items-center gap-1 font-black"><AlertCircle size={12} /> Para guardar este combo requiere:</div>
                            <ul className="list-disc list-inside space-y-0.5 pl-1">
                                {!hasName && <li>Nombre del combo</li>}
                                {!hasProducts && <li>Al menos un producto o grupo de selección</li>}
                                {!hasValidPrice && <li>Precio de venta mayor a $0.00</li>}
                            </ul>
                        </div>
                    )}

                    <button type="button" onClick={handleSave}
                        disabled={!isFormValid}
                        className="w-full py-3.5 rounded-2xl font-black text-white uppercase tracking-wider text-sm bg-brand hover:bg-brand-dark shadow-lg shadow-brand/20 transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed">
                        {editingCombo ? 'Guardar Cambios' : 'Crear Combo'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
