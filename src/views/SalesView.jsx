// v1.2.0: Rebrand al design system "Precios al Día" — colores warm cream + brand cian en elementos inline.
// Nota: SalesHeader.jsx y CartPanel.jsx son subcomponentes fuera de scope; se migran en P2-P4.
import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from 'react';
import { FinancialEngine } from '../core/FinancialEngine';
import { storageService } from '../utils/storageService';
import { CurrencyService } from '../services/CurrencyService';
import { round2, divR } from '../utils/dinero';
import { useSounds } from '../hooks/useSounds';
import { useVoiceSearch } from '../hooks/useVoiceSearch';
import { useNotifications } from '../hooks/useNotifications';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { showToast } from '../components/Toast';
import { ShoppingCart, X, DollarSign, CheckCircle2 } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useProductContext } from '../context/ProductContext';

import { useAuthStore } from '../hooks/store/useAuthStore';

// Components
import SalesHeader from '../components/Sales/SalesHeader';
import SearchBar from '../components/Sales/SearchBar';
import CategoryBar from '../components/Sales/CategoryBar';
import CartPanel from '../components/Sales/CartPanel';
import ReceiptModal from '../components/Sales/ReceiptModal';
import CheckoutModal from '../components/Sales/CheckoutModal';
import CheckoutModalPOS from '../components/Sales/CheckoutModalPOS';
import CustomAmountModal from '../components/Sales/CustomAmountModal';
import KeyboardHelpModal from '../components/Sales/KeyboardHelpModal';
import DiscountModal from '../components/Sales/DiscountModal';
import CajaCerradaOverlay from '../components/Sales/CajaCerradaOverlay';
import ModularComboPickerModal from '../components/Sales/ModularComboPickerModal';
import { getLocalISODate } from '../utils/dateHelpers';
import AperturaCajaModal from '../components/Dashboard/AperturaCajaModal';

import ConfirmModal from '../components/ConfirmModal';
import Confetti from '../components/Confetti';
import { useSalesKeyboard } from '../hooks/useSalesKeyboard';
import { buildReceiptWhatsAppUrl } from '../components/Sales/ReceiptShareHelper';

import { useSalesData } from '../hooks/useSalesData';
import { useCheckoutFlow } from '../hooks/useCheckoutFlow';
import { compareBarcodes } from '../utils/calculatorUtils';

export default function SalesView({ triggerHaptic, isActive }) {
    const { playAdd, playRemove, playCheckout, playError } = useSounds();
    const { notifyLowStock, notifySaleComplete } = useNotifications();

    // ── Global Context ──────────────────────────────────────
    const { products, setProducts, isLoadingProducts, rateMode, setRateMode, useAutoRate, setUseAutoRate, customRate, setCustomRate, effectiveRate, rates, copEnabled, copPrimary, tasaCop, autoCopEnabled, setAutoCopEnabled, tasaCopManual, setTasaCopManual, categories, checkoutMode, setCheckoutMode } = useProductContext();



    const [showConfetti, setShowConfetti] = useState(false);
    const [showClearCartConfirm, setShowClearCartConfirm] = useState(false);
    const [showCustomAmountModal, setShowCustomAmountModal] = useState(false);
    const [showKeyboardHelp, setShowKeyboardHelp] = useState(false); // Keyboard shortcuts modal state

    // Apertura Caja
    const [isAperturaOpen, setIsAperturaOpen] = useState(false);

    // Cart (from global context)
    const { cart, setCart, cartRef, pendingNavigate, setPendingNavigate, discount, setDiscount } = useCart();
    const [showDiscountModal, setShowDiscountModal] = useState(false);

    // Search
    const searchInputRef = useRef(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [selectedCategory, setSelectedCategory] = useState('todos');

    // Modals
    const [showCheckout, setShowCheckout] = useState(false);
    const [showReceipt, setShowReceipt] = useState(null);
    const [hierarchyPending, setHierarchyPending] = useState(null);
    const [weightPending, setWeightPending] = useState(null);
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [modularComboPickerOpen, setModularComboPickerOpen] = useState(false);
    const [pendingModularCombo, setPendingModularCombo] = useState(null);

    // Rate config
    const [showRateConfig, setShowRateConfig] = useState(false);

    const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);

    // Ventas en Espera (Listo POS: "ESPERA")
    const [pendingCarts, setPendingCarts] = useState([]);

    // Cart Navigation State
    const [cartSelectedIndex, setCartSelectedIndex] = useState(-1);

    // ── Sales Data Hook ─────────────────────────────
    const {
        customers, setCustomers,
        paymentMethods,
        isLoadingLocal,
        salesData, setSalesData,
        todayAperturaData, setTodayAperturaData,
    } = useSalesData({ setCart, cartRef, setProducts, isActive });

    const isLoading = isLoadingProducts || isLoadingLocal;

    // Auto-select last item when cart length changes (if user was already interacting with the cart)
    useEffect(() => {
        if (cart.length > 0) {
            setCartSelectedIndex(prev => prev === -1 ? prev : Math.min(prev, cart.length - 1));
        } else if (cart.length === 0) {
            setCartSelectedIndex(-1);
        }
    }, [cart.length]);

    // Cargar ventas en espera desde IndexedDB al iniciar
    useEffect(() => {
        storageService.getItem('bodega_pending_holds_v1', []).then(data => {
            if (Array.isArray(data)) setPendingCarts(data);
        });
    }, []);

    // Función para guardar el carrito activo como "en espera" (Listo POS: ESPERA)
    const handleHoldCart = async () => {
        if (cart.length === 0) return;
        triggerHaptic && triggerHaptic();
        const newHolds = [...pendingCarts, { id: Date.now(), items: cart, discount }];
        setPendingCarts(newHolds);
        await storageService.setItem('bodega_pending_holds_v1', newHolds);
        setCart([]);
        setDiscount({ type: 'percentage', value: 0 });
        showToast(`Venta guardada en espera (${newHolds.length} en cola)`, 'info');
    };

    // Función para restaurar una venta en espera
    const handleRestoreHold = async (holdId) => {
        const hold = pendingCarts.find(h => h.id === holdId);
        if (!hold) return;
        if (cart.length > 0) {
            showToast('Vacía la cesta actual antes de restaurar una venta en espera.', 'warning');
            return;
        }
        setCart(hold.items);
        setDiscount(hold.discount);
        const newHolds = pendingCarts.filter(h => h.id !== holdId);
        setPendingCarts(newHolds);
        await storageService.setItem('bodega_pending_holds_v1', newHolds);
    };

    // Voice
    const handleSetSearchTerm = (text) => { setSearchTerm(text); setSelectedIndex(0); };
    const { isRecording, isProcessingAudio, startRecording, stopRecording } = useVoiceSearch({
        onResult: (text) => {
            if (!text) return;
            const normalizedTerm = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const bestMatches = products.filter(p => {
                const normalizedName = p.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                return normalizedName.includes(normalizedTerm);
            });

            if (bestMatches.length > 0) {
                // Auto-agregar la primera (mejor) coincidencia
                addToCart(bestMatches[0]);
                handleSetSearchTerm('');
            } else {
                playError();
                showToast(`No encontré ningún producto parecido a "${text}"`, 'warning');
                // Al menos dejamos el texto en el buscador por si el usuario quiere corregirlo manualmente
                handleSetSearchTerm(text);
                searchInputRef.current?.focus();
            }
        },
        triggerHaptic,
    });

    // Barcode Scanner Global
    useBarcodeScanner({
        onScan: (barcode) => {
            if (showCheckout || showReceipt || showClearCartConfirm) return;

            // Pesa electrónica con PLU
            if (barcode.startsWith('21') && barcode.length >= 13) {
                const pluCode = parseInt(barcode.substring(2, 7), 10).toString();
                const weightKg = parseInt(barcode.substring(7, 12), 10) / 1000;
                const p = products.find(p => p.id === pluCode || p.barcode?.includes(pluCode) || p.barcode?.includes(barcode.substring(0, 7)));
                if (p) { addToCart({ ...p, isWeight: true }, weightKg, null, true); return; }
            }

            // Buscar producto y formato por código de barra (comparación robusta)
            let foundProduct = null;
            let foundMode = null;
            for (const p of products) {
                if (p.sellByBox && compareBarcodes(p.boxBarcode, barcode)) {
                    foundProduct = p;
                    foundMode = 'box';
                    break;
                }
                if (p.sellByHalfBox && compareBarcodes(p.halfBoxBarcode, barcode)) {
                    foundProduct = p;
                    foundMode = 'halfBox';
                    break;
                }
                if (compareBarcodes(p.barcode, barcode) || compareBarcodes(p.id, barcode)) {
                    foundProduct = p;
                    foundMode = 'unit'; // Al escanear el código principal (unidad), se agrega directamente a la cesta
                    break;
                }
            }

            if (foundProduct) {
                addToCart(foundProduct, null, foundMode, true);
            } else {
                playError();
                showToast(`Producto no encontrado (${barcode})`, 'warning');
            }
        },
        enabled: !isLoading && isActive && !!todayAperturaData
    });

    // Paste Barcode Handler (Ctrl+V)
    const handlePasteBarcode = (pastedText) => {
        if (showCheckout || showReceipt || showClearCartConfirm) return;

        // Intentar Pesa Electrónica
        if (pastedText.startsWith('21') && pastedText.length >= 13) {
            const pluCode = parseInt(pastedText.substring(2, 7), 10).toString();
            const weightKg = parseInt(pastedText.substring(7, 12), 10) / 1000;
            const p = products.find(p => p.id === pluCode || p.barcode?.includes(pluCode) || p.barcode?.includes(pastedText.substring(0, 7)));
            if (p) {
                addToCart({ ...p, isWeight: true }, weightKg, null, true);
                setTimeout(() => setSearchTerm(''), 10);
                return;
            }
        }

        // Buscar producto y formato por código de barra pegado (comparación robusta)
        let foundProduct = null;
        let foundMode = null;
        for (const p of products) {
            if (p.sellByBox && compareBarcodes(p.boxBarcode, pastedText)) {
                foundProduct = p;
                foundMode = 'box';
                break;
            }
            if (p.sellByHalfBox && compareBarcodes(p.halfBoxBarcode, pastedText)) {
                foundProduct = p;
                foundMode = 'halfBox';
                break;
            }
            if (compareBarcodes(p.barcode, pastedText) || compareBarcodes(p.id, pastedText)) {
                foundProduct = p;
                foundMode = 'unit'; // Al pegar el código principal (unidad), se agrega directamente a la cesta
                break;
            }
        }

        if (foundProduct) {
            addToCart(foundProduct, null, foundMode, true);
            setTimeout(() => setSearchTerm(''), 10);
        }
        // Si no es un código exacto, no hacemos nada extra, el navegador lo pegará como texto normal para buscar.
    };

    // ── Derived (memos) ───────────────────────────
    const deferredSearchTerm = useDeferredValue(searchTerm);

    const searchResults = useMemo(() => {
        if (deferredSearchTerm.length < 1) return [];
        const normalizedTerm = deferredSearchTerm.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        return products.filter(p => {
            if (p.barcode?.includes(deferredSearchTerm)) return true;
            if (p.sellByBox && p.boxBarcode?.includes(deferredSearchTerm)) return true;
            if (p.sellByHalfBox && p.halfBoxBarcode?.includes(deferredSearchTerm)) return true;
            const normalizedName = p.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            return normalizedName.includes(normalizedTerm);
        }).slice(0, 6);
    }, [deferredSearchTerm, products]);

    const filteredByCategory = useMemo(() => selectedCategory === 'todos'
        ? products
        : products.filter(p => p.category === selectedCategory), [selectedCategory, products]);

    const {
        subtotalUsd: cartSubtotalUsd,
        subtotalBs: cartSubtotalBs,
        discountAmountUsd,
        discountAmountBs,
        totalUsd: cartTotalUsd,
        totalBs: cartTotalBs,
        totalCop: cartTotalCop
    } = useMemo(() =>
        FinancialEngine.buildCartTotals(cart, discount, effectiveRate, copEnabled ? tasaCop : 0, rates?.bcv?.price || effectiveRate)
    , [cart, discount, effectiveRate, copEnabled, tasaCop, rates]);

    // Variables estáticas para pasar a los componentes hijos
    const discountData = {
        active: discount?.value > 0,
        amountUsd: discountAmountUsd,
        amountBs: discountAmountBs,
        type: discount?.type,
        value: discount?.value
    };

    // ── Current cash float (for soft change warning in CheckoutModal) ──
    const currentFloat = useMemo(() => {
        const todayStr = getLocalISODate(new Date());
        const todayOpen = salesData.filter(s => {
            if (s.cajaCerrada) return false;
            const saleDay = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : todayStr;
            return saleDay === todayStr;
        });
        const bd = FinancialEngine.calculatePaymentBreakdown(todayOpen);
        return {
            usd: bd['efectivo_usd']?.total ?? 0,
            bs:  bd['efectivo_bs']?.total  ?? 0,
        };
    }, [salesData]);

    const cartItemCount = cart.reduce((sum, item) => sum + item.qty, 0);

    const formatBs = (n) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

    // Persist cart (With Debounce to avoid blocking UI on rapid scans)
    const isCartInitialized = useRef(false);
    useEffect(() => {
        if (!isCartInitialized.current) { isCartInitialized.current = true; return; }
        const timer = setTimeout(() => {
            if (cart.length > 0) storageService.setItem('bodega_pending_cart_v1', cart);
            else storageService.removeItem('bodega_pending_cart_v1');
        }, 1000);
        return () => clearTimeout(timer);
    }, [cart]);

    // Handle pending navigation from recycled cart (replaces old localStorage approach)
    useEffect(() => {
        if (pendingNavigate && cart.length > 0 && isActive) {
            setPendingNavigate(null);
        }
    }, [pendingNavigate, cart, isActive, setPendingNavigate]);

    // Auto-focus search
    useEffect(() => { if (!isLoading && searchInputRef.current) searchInputRef.current.focus(); }, [isLoading]);

    // Return focus after closing modals
    useEffect(() => { if (!showCheckout && !showReceipt && searchInputRef.current) searchInputRef.current.focus(); }, [showCheckout, showReceipt]);

    // Global keybinds (F9 = checkout, Escape = close modals)
    useEffect(() => {
        const handler = (e) => {
            if (e.key === 'F9') { e.preventDefault(); if (cart.length > 0 && !showCheckout && !showReceipt) setShowCheckout(true); }
            if (e.key === 'Escape') {
                if (showCheckout) { setShowCheckout(false); setSelectedCustomerId(''); }
                else if (showReceipt) { setShowReceipt(null); setSelectedCustomerId(''); }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [cart, showCheckout, showReceipt]);

    // ── Checkout Flow Hook ──────────────────────────
    const { handleCheckout, handleCreateCustomer, handleSaveApertura } = useCheckoutFlow({
        cart, cartTotalUsd, cartTotalBs, cartSubtotalUsd,
        selectedCustomerId, customers, setCustomers, products, setProducts,
        effectiveRate, tasaCop, copEnabled, discountData, useAutoRate, bcvRate: rates?.bcv?.price || effectiveRate,
        setSalesData, setShowReceipt, setShowCheckout, setSelectedCustomerId,
        setCart, setCartSelectedIndex, setShowConfetti, setTodayAperturaData, setIsAperturaOpen,
        playCheckout, playError, notifyLowStock, notifySaleComplete, triggerHaptic
    });

    // ── Callbacks ─────────────────────────────────
    const handleModularComboConfirm = useCallback((modularSelections) => {
        setModularComboPickerOpen(false);
        const combo = pendingModularCombo;
        setPendingModularCombo(null);
        if (!combo) return;

        const cartId = `${combo.id}_modular_${Date.now()}`;
        const itemCostBs = combo.costBs || (combo.costUsd ? combo.costUsd * effectiveRate : 0);

        setCart(prev => [{
            ...combo,
            id: cartId,
            name: combo.name,
            priceUsd: CurrencyService.safeParse(combo.priceUsd) || 0,
            priceBsManual: combo.priceBsManual ? CurrencyService.safeParse(combo.priceBsManual) : null,
            costUsd: CurrencyService.safeParse(combo.costUsd) || 0,
            costBs: itemCostBs,
            qty: 1,
            isWeight: false,
            _originalId: combo.id,
            _mode: 'unit',
            isModular: true,
            modularSelections
        }, ...prev]);

        playAdd();
    }, [pendingModularCombo, playAdd, effectiveRate, setCart]);

    const addToCart = useCallback((product, qtyOverride = null, forceMode = null, isBarcodeSource = false) => {
        triggerHaptic && triggerHaptic();

        // Intercepción: combo modular → abrir picker antes de agregar
        if (product.isCombo && product.isModular && product.modularGroups?.length > 0) {
            setPendingModularCombo(product);
            setModularComboPickerOpen(true);
            return;
        }

        // Si tiene formatos habilitados y no hay modo forzado, mostrar selector
        if ((product.sellByBox || product.sellByHalfBox) && !forceMode && !qtyOverride) {
            setHierarchyPending(product);
            return;
        }

        // Si es a granel
        if ((product.unit === 'kg' || product.unit === 'litro') && !qtyOverride) {
            setWeightPending(product);
            return;
        }

        const mode = forceMode || 'unit';
        let priceToUse = CurrencyService.safeParse(product.priceUsd) || 0;
        let priceBsToUse = product.priceBsManual ? CurrencyService.safeParse(product.priceBsManual) : null;
        let cartId = product.id;
        let cartName = product.name;
        let unitsMultiplier = 1;

        if (mode === 'box') {
            priceToUse = CurrencyService.safeParse(product.boxPriceUsd) || 0;
            priceBsToUse = product.boxPriceBs ? CurrencyService.safeParse(product.boxPriceBs) : null;
            cartId = product.id + '_box';
            cartName = product.name + ' (Caja)';
            unitsMultiplier = parseInt(product.boxUnits, 10) || 1;
        } else if (mode === 'halfBox') {
            priceToUse = CurrencyService.safeParse(product.halfBoxPriceUsd) || 0;
            priceBsToUse = product.halfBoxPriceBs ? CurrencyService.safeParse(product.halfBoxPriceBs) : null;
            cartId = product.id + '_half';
            cartName = product.name + ' (½ Caja)';
            unitsMultiplier = parseInt(product.halfBoxUnits, 10) || 1;
        }

        // Validación de precio
        if (priceToUse <= 0) {
            playError();
            showToast('Este formato no tiene un precio válido asignado', 'warning');
            return;
        }

        const allowNegativeStock = localStorage.getItem('allow_negative_stock') === 'true';
        const currentStock = CurrencyService.safeParse(product.stock) || 0;
        const qtyToAdd = qtyOverride || 1;

        // Validación de stock
        if (!allowNegativeStock) {
            const currentCart = cartRef.current;
            const existingInCart = currentCart.find(i => i.id === cartId);
            const existingQty = existingInCart ? existingInCart.qty : 0;
            const stockNeeded = (existingQty + qtyToAdd) * unitsMultiplier;

            // Calcular stock usado por otros formatos del mismo producto en el carrito
            const otherCartItems = currentCart.filter(i => (i._originalId || i.id) === product.id && i.id !== cartId);
            const otherStockUsed = otherCartItems.reduce((sum, item) => {
                const mult = item._mode === 'box' ? (item.boxUnits || 1) : item._mode === 'halfBox' ? (item.halfBoxUnits || 1) : 1;
                return sum + (item.qty * mult);
            }, 0);

            if (stockNeeded + otherStockUsed > currentStock) {
                playError();
                showToast(`${product.name}: stock máximo alcanzado`, 'warning');
                return;
            }
        }

        playAdd();

        setCart(prev => {
            const existing = prev.find(i => i.id === cartId);
            if (existing && !qtyOverride) return prev.map(i => i.id === cartId ? { ...i, qty: i.qty + 1 } : i);
            if (existing && qtyOverride) return prev.map(i => i.id === cartId ? { ...i, qty: i.qty + qtyOverride } : i);

            const itemCostBs = product.costBs || (product.costUsd ? product.costUsd * effectiveRate : 0);
            return [{
                ...product,
                id: cartId,
                name: cartName,
                priceUsd: priceToUse,
                priceBsManual: priceBsToUse,
                costUsd: product.costUsd ? CurrencyService.safeParse(product.costUsd) * unitsMultiplier : 0,
                costBs: itemCostBs * unitsMultiplier,
                qty: qtyToAdd,
                isWeight: !!qtyOverride,
                _originalId: product.id,
                _mode: mode,
            }, ...prev];
        });

        handleSetSearchTerm('');
        setHierarchyPending(null);

        // --- LISTO POS Flow: blur/focus search dynamic based on source ---
        setTimeout(() => {
            if (isBarcodeSource) {
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
                setCartSelectedIndex(-1); // Resetea navegación en la cesta
            } else {
                searchInputRef.current?.blur();
                setCartSelectedIndex(0); // Enfoca el ítem para +/- rápido
            }
        }, 50);
    }, [triggerHaptic, effectiveRate, tasaCop]);

    // Recalculate priceUsd for cart items with priceCop when tasaCop changes
    useEffect(() => {
        if (!tasaCop || tasaCop <= 0) return;
        setCart(prev => {
            const needsUpdate = prev.some(i => i.priceCop && i.priceCop > 0);
            if (!needsUpdate) return prev;
            return prev.map(i => {
                if (i.priceCop && i.priceCop > 0) {
                    return { ...i, priceUsd: i.priceCop / tasaCop };
                }
                return i;
            });
        });
    }, [tasaCop]);

    const updateQty = (id, delta) => {
        triggerHaptic && triggerHaptic();
        if (delta < 0) playRemove();

        const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';

        // Pre-check stock BEFORE setCart to avoid React StrictMode double toast
        if (!allowNeg && delta > 0) {
            const currentCart = cartRef.current;
            const cartItem = currentCart.find(i => i.id === id);
            if (cartItem) {
                const originalId = cartItem._originalId || cartItem.id;
                const productData = products.find(p => p.id === originalId);
                if (productData) {
                    const availableStock = CurrencyService.safeParse(productData.stock) || 0;
                    const newQty = Math.round((cartItem.qty + delta) * 1000) / 1000;
                    const totalUsed = currentCart.reduce((sum, item) => {
                        if ((item._originalId || item.id) !== originalId) return sum;
                        if (item.id === id) return sum;
                        if (item._mode === 'unit') return sum + (item.qty / (item._unitsPerPackage || 1));
                        return sum + item.qty;
                    }, 0);
                    const thisItemStock = cartItem._mode === 'unit' ? newQty / (cartItem._unitsPerPackage || 1) : newQty;
                    if (totalUsed + thisItemStock > availableStock) {
                        playError();
                        showToast(`${cartItem.name}: stock maximo alcanzado`, 'warning');
                        return;
                    }
                }
            }
        }

        setCart(prev => prev.map(i => {
            if (i.id !== id) return i;
            let newQty = Math.round((i.qty + delta) * 1000) / 1000;
            if (newQty < 0) newQty = 0;
            return newQty === 0 ? null : { ...i, qty: newQty };
        }).filter(Boolean));
    };

    const removeFromCart = (id) => {
        triggerHaptic && triggerHaptic();
        playRemove();
        setCart(prev => prev.filter(i => i.id !== id));
    };

    const handleSearchKeyDown = (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(prev => Math.min(prev + 1, searchResults.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(prev => Math.max(prev - 1, 0)); }
        else if (e.key === 'ArrowRight') {
            // Jump to cart navigation if items exist
            if (cart.length > 0) {
                e.preventDefault();
                searchInputRef.current?.blur();
            }
        }
        else if (e.key === 'Enter') {
            e.preventDefault();
            const trimmedTerm = searchTerm.trim();

            // 1. Coincidencia exacta de código de barras o ID primero (pistola enfocada)
            if (trimmedTerm.length >= 3) {
                let exactMatch = null;
                let exactMode = null;
                for (const p of products) {
                    if (p.sellByBox && compareBarcodes(p.boxBarcode, trimmedTerm)) {
                        exactMatch = p;
                        exactMode = 'box';
                        break;
                    }
                    if (p.sellByHalfBox && compareBarcodes(p.halfBoxBarcode, trimmedTerm)) {
                        exactMatch = p;
                        exactMode = 'halfBox';
                        break;
                    }
                    if (compareBarcodes(p.barcode, trimmedTerm) || compareBarcodes(p.id, trimmedTerm)) {
                        exactMatch = p;
                        exactMode = 'unit'; // Al ingresar o escanear el código principal, se agrega directamente
                        break;
                    }
                }
                if (exactMatch) {
                    addToCart(exactMatch, null, exactMode, true);
                    handleSetSearchTerm('');
                    return;
                }
            }

            // 2. Barcode de balanza/pesa electrónica (prefijo 21)
            if (trimmedTerm.startsWith('21') && trimmedTerm.length >= 13) {
                const pluCode = parseInt(trimmedTerm.substring(2, 7), 10).toString();
                const weightKg = parseInt(trimmedTerm.substring(7, 12), 10) / 1000;
                const p = products.find(p => p.id === pluCode || p.barcode?.includes(pluCode) || p.barcode?.includes(trimmedTerm.substring(0, 7)));
                if (p) { addToCart({ ...p, isWeight: true }, weightKg, null, true); handleSetSearchTerm(''); return; }
            }

            // 3. Fallbacks de selección
            if (searchResults[selectedIndex]) {
                addToCart(searchResults[selectedIndex]);
            } else if (searchResults.length === 1) {
                addToCart(searchResults[0]);
            }
        }
    };

    const handleAddCustomAmount = (amount, currency) => {
        let amountUsd = 0;
        let exactBsToStore = null;

        if (currency === 'USD') {
            amountUsd = round2(amount);
            // exactBsToStore remains null to float with effectiveRate
        } else if (currency === 'COP') {
            const tasaCopVal = (tasaCop && tasaCop > 0) ? tasaCop : 4150;
            amountUsd = round2(divR(amount, tasaCopVal));
            // exactBsToStore remains null to float with effectiveRate
        } else {
            // Default BS
            amountUsd = round2(divR(amount, effectiveRate));
            exactBsToStore = round2(amount);
        }

        if (amountUsd <= 0) return;

        const customProduct = {
            id: `custom_${Date.now()}`,
            name: 'Venta Libre',
            priceUsdt: amountUsd, // Usamos priceUsdt para que la validación temprana lo acepte
            exactBs: exactBsToStore, // Monto exacto original en Bs, o null si debe flotar
            costBs: 0,
            costUsd: 0,
            unit: 'unidad',
            category: 'otros',
            stock: 9999,
        };

        addToCart(customProduct);
        setShowCustomAmountModal(false);
    };

    // ==========================================
    // KEYBOARD SHORTCUTS (LISTO POS Port)
    // ==========================================
    useSalesKeyboard({
        todayAperturaData, showCheckout, showReceipt, hierarchyPending, weightPending,
        showClearCartConfirm, showCustomAmountModal, showRateConfig, showKeyboardHelp,
        showDiscountModal, searchInputRef, setCartSelectedIndex, setShowClearCartConfirm,
        cartRef, setShowCheckout, cartSelectedIndex, updateQty, removeFromCart
    });

    // ── Loading ───────────────────────────────────
    if (isLoading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center">
                <div className="w-8 h-8 rounded-full border-4 border-slate-200 dark:border-slate-800 border-t-emerald-500 animate-spin" />
            </div>
        );
    }

    // ── Render ─────────────────────────────────────
    return (
        <div className="flex-1 min-h-0 flex flex-col dark:bg-slate-950 p-2 sm:p-4 sm:pb-4 overflow-hidden relative">

            {/* Header + Rate Config */}
            <SalesHeader
                effectiveRate={effectiveRate}
                rateMode={rateMode} setRateMode={setRateMode}
                useAutoRate={useAutoRate} setUseAutoRate={setUseAutoRate}
                customRate={customRate} setCustomRate={setCustomRate}
                rates={rates}
                showRateConfig={showRateConfig} setShowRateConfig={setShowRateConfig}
                setShowKeyboardHelp={setShowKeyboardHelp}
                triggerHaptic={triggerHaptic}
                copEnabled={copEnabled} copPrimary={copPrimary} tasaCop={tasaCop}
                autoCopEnabled={autoCopEnabled} setAutoCopEnabled={setAutoCopEnabled}
                tasaCopManual={tasaCopManual} setTasaCopManual={setTasaCopManual}
            />

            {!todayAperturaData ? (
                <CajaCerradaOverlay
                    cartCount={cart.length}
                    onOpenApertura={() => setIsAperturaOpen(true)}
                />
            ) : (
                <>


                    {/* ── Split Layout: Products (left) + Cart Sidebar (right) on desktop ── */}
                    <div className="flex-1 min-h-0 flex flex-col lg:flex-row lg:gap-4">

                        {/* ── Left Column: Search + Categories ── */}
                        <div className="flex-1 min-h-0 flex flex-col lg:min-w-0 overflow-y-auto lg:overflow-hidden" style={{ WebkitOverflowScrolling: 'touch' }}>
                            {/* ── ZONA SUPERIOR: Buscador + Tasa (fila horizontal en desktop) ── */}
                            <div className="shrink-0 mb-3 flex items-stretch gap-3">
                                {/* Buscador: ocupa todo el espacio */}
                                <div className="flex-1 bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl p-3 sm:p-4 shadow-sm border border-slate-100 dark:border-slate-800 relative">
                                    <SearchBar
                                        ref={searchInputRef}
                                        searchTerm={searchTerm}
                                        onSearchChange={handleSetSearchTerm}
                                        onKeyDown={handleSearchKeyDown}
                                        onPasteBarcode={handlePasteBarcode}
                                        searchResults={searchResults}
                                        selectedIndex={selectedIndex} setSelectedIndex={setSelectedIndex}
                                        effectiveRate={effectiveRate}
                                        addToCart={addToCart}
                                        isRecording={isRecording} isProcessingAudio={isProcessingAudio} startRecording={startRecording} stopRecording={stopRecording}
                                        hierarchyPending={hierarchyPending} setHierarchyPending={setHierarchyPending}
                                        weightPending={weightPending} setWeightPending={setWeightPending}
                                        copEnabled={copEnabled} copPrimary={copPrimary} tasaCop={tasaCop}
                                    />
                                </div>

                                {/* Tasa de Referencia Flotante (estilo Listo POS 2026) — solo visible en desktop (lg:flex) */}
                                <button
                                    onClick={() => {
                                        const activeUser = useAuthStore.getState().usuarioActivo;
                                        const allowCajeroEditRate = localStorage.getItem('allow_cajero_edit_rate') === 'true';
                                        const isCajero = activeUser?.rol === 'CAJERO';
                                        if (isCajero && !allowCajeroEditRate) {
                                            showToast('Acceso denegado: Solo administradores pueden cambiar la tasa.', 'warning');
                                            return;
                                        }
                                        setShowRateConfig(v => !v);
                                    }}
                                    className={`hidden lg:flex shrink-0 flex-col items-center justify-center bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl px-5 border border-slate-100 dark:border-slate-800 shadow-sm transition-all min-w-[100px] gap-0.5 ${
                                        (() => {
                                            const activeUser = useAuthStore.getState().usuarioActivo;
                                            const allowCajeroEditRate = localStorage.getItem('allow_cajero_edit_rate') === 'true';
                                            const isCajero = activeUser?.rol === 'CAJERO';
                                            return !(isCajero && !allowCajeroEditRate);
                                        })() ? 'hover:border-brand/40 cursor-pointer' : 'cursor-not-allowed opacity-80'
                                    }`}
                                >
                                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                                        {copEnabled && copPrimary ? 'TASA COP' : 'TASA BCV'}
                                    </span>
                                    <span className="text-base font-black text-brand leading-none tabular-nums">
                                        {copEnabled && copPrimary
                                            ? Math.round(tasaCop).toLocaleString('es-CO')
                                            : formatBs(effectiveRate).replace('.', ',')}
                                    </span>
                                    {!useAutoRate && <span className="text-[8px] bg-brand-light dark:bg-surface-800/30 text-brand-dark dark:text-brand px-1 rounded font-bold">MAN</span>}
                                </button>
                            </div>

                            {/* Category Chips + Product Grid */}
                            {!showCheckout && !showReceipt && (
                                <CategoryBar
                                    selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory}
                                    filteredByCategory={filteredByCategory}
                                    addToCart={addToCart}
                                    triggerHaptic={triggerHaptic}
                                    searchTerm={searchTerm}
                                    onOpenCustomAmount={() => setShowCustomAmountModal(true)}
                                    copEnabled={copEnabled}
                                    copPrimary={copPrimary}
                                    tasaCop={tasaCop}
                                    effectiveRate={effectiveRate}
                                    products={products}
                                    categories={categories}
                                    onClearCart={() => { triggerHaptic && triggerHaptic(); setShowClearCartConfirm(true); }}
                                    onHoldCart={handleHoldCart}
                                    pendingCartsCount={pendingCarts.length}
                                    onRestoreHold={handleRestoreHold}
                                    pendingCarts={pendingCarts}
                                    onOpenHelp={() => setShowKeyboardHelp(true)}
                                />
                    )}
                </div>

                {/* ── Right Column: Cart Sidebar — desktop only ── */}
                <div className="hidden lg:flex lg:w-[380px] lg:shrink-0 lg:flex-col">
                    <CartPanel
                        cart={cart} effectiveRate={effectiveRate} bcvRate={rates?.bcv?.price || effectiveRate}
                        cartSubtotalUsd={cartSubtotalUsd} cartSubtotalBs={cartSubtotalBs}
                        cartTotalUsd={cartTotalUsd} cartTotalBs={cartTotalBs} cartTotalCop={cartTotalCop} cartItemCount={cartItemCount}
                        discountData={discountData} onOpenDiscount={() => setShowDiscountModal(true)}
                        updateQty={updateQty} removeFromCart={removeFromCart}
                        onCheckout={() => { triggerHaptic && triggerHaptic(); setShowCheckout(true); }}
                        onClearCart={() => { triggerHaptic && triggerHaptic(); setShowClearCartConfirm(true); }}
                        triggerHaptic={triggerHaptic}
                        cartSelectedIndex={cartSelectedIndex}
                        copEnabled={copEnabled}
                        copPrimary={copPrimary}
                        tasaCop={tasaCop}
                    />
                </div>

            </div>

            {/* ── Mobile Cart FAB & Bottom Sheet (lg:hidden) ── */}
            <div className="lg:hidden">
                {/* Floating Action Button — v1.2.0: bg-brand (cian) en vez de emerald */}
                {cart.length > 0 && !isCartSheetOpen && !showCheckout && !showReceipt && (
                    <button
                        onClick={() => { triggerHaptic && triggerHaptic(); setIsCartSheetOpen(true); }}
                        className="fixed bottom-[max(6.2rem,env(safe-area-inset-bottom)+5.7rem)] left-4 right-4 bg-brand hover:bg-brand-dark text-white p-4 rounded-2xl shadow-primary-tone flex items-center justify-between z-40 active:scale-95 transition-all animate-in slide-in-from-bottom"
                    >
                        <div className="flex items-center gap-3">
                            <div className="bg-white/20 p-2 rounded-xl">
                                <ShoppingCart size={20} />
                            </div>
                            <div className="text-left">
                                <div className="text-xs font-bold text-white/80 uppercase tracking-wider">Ver Cesta</div>
                                <div className="font-black leading-none">{cartItemCount} artículo{cartItemCount !== 1 && 's'}</div>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-2xl font-black leading-none">
                                {copEnabled && copPrimary && tasaCop > 0
                                    ? `${new Intl.NumberFormat('es-CO').format(Math.round(cartTotalCop))} COP`
                                    : `$${cartTotalUsd.toFixed(2)}`}
                            </div>
                            <div className="text-xs font-bold text-white/80 mt-1">Bs {formatBs(cartTotalBs)}</div>
                        </div>
                    </button>
                )}

                {/* Bottom Sheet Overlay — v1.2.0: cart panel con bg-surface-2 */}
                {isCartSheetOpen && !showCheckout && !showReceipt && (
                    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-surface-950/60 backdrop-blur-sm animate-in fade-in duration-200 pb-[max(0px,env(safe-area-inset-bottom))]"
                         onClick={() => setIsCartSheetOpen(false)}>
                        <div className="bg-surface-2 dark:bg-surface-950 w-full rounded-t-3xl shadow-tone-lg flex flex-col max-h-[85vh] animate-in slide-in-from-bottom-full duration-300"
                             onClick={e => e.stopPropagation()}>
                            <div className="shrink-0 flex justify-center pt-3 pb-2" onClick={() => setIsCartSheetOpen(false)}>
                                <div className="w-12 h-1.5 bg-surface-300 dark:bg-surface-700 rounded-full cursor-pointer" />
                            </div>
                            <div className="shrink-0 px-4 pb-3 flex items-center justify-between border-b border-surface-200 dark:border-surface-700">
                                <h3 className="font-black text-surface-700 dark:text-surface-100 text-lg flex items-center gap-2">
                                    <ShoppingCart size={20} className="text-brand" /> Cesta Actual
                                </h3>
                                <button onClick={() => setIsCartSheetOpen(false)} className="p-2 -mr-2 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors">
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto">
                                <CartPanel
                                    cart={cart} effectiveRate={effectiveRate} bcvRate={rates?.bcv?.price || effectiveRate}
                                    cartSubtotalUsd={cartSubtotalUsd} cartSubtotalBs={cartSubtotalBs}
                                    cartTotalUsd={cartTotalUsd} cartTotalBs={cartTotalBs} cartTotalCop={cartTotalCop} cartItemCount={cartItemCount}
                                    discountData={discountData} onOpenDiscount={() => setShowDiscountModal(true)}
                                    updateQty={updateQty} removeFromCart={removeFromCart}
                                    onCheckout={() => { triggerHaptic && triggerHaptic(); setShowCheckout(true); setIsCartSheetOpen(false); }}
                                    onClearCart={() => { triggerHaptic && triggerHaptic(); setShowClearCartConfirm(true); }}
                                    triggerHaptic={triggerHaptic}
                                    cartSelectedIndex={cartSelectedIndex}
                                    copEnabled={copEnabled}
                                    copPrimary={copPrimary}
                                    tasaCop={tasaCop}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
            </>
            )}

            {/* Checkout Modal — modo dinámico según preferencia del usuario */}
            {showCheckout && (() => {
                const sharedProps = {
                    onClose: () => { setShowCheckout(false); setSelectedCustomerId(''); },
                    cartSubtotalUsd, cartSubtotalBs: cartSubtotalUsd * effectiveRate,
                    cartTotalUsd, cartTotalBs, cartTotalCop,
                    discountData, effectiveRate,
                    customers, selectedCustomerId, setSelectedCustomerId,
                    paymentMethods,
                    onConfirmSale: handleCheckout, onCreateCustomer: handleCreateCustomer,
                    triggerHaptic,
                    copEnabled, copPrimary, tasaCop,
                    currentFloatUsd: currentFloat.usd,
                    currentFloatBs: currentFloat.bs,
                    onSwitchMode: setCheckoutMode,
                };
                return checkoutMode === 'pos'
                    ? <CheckoutModalPOS {...sharedProps} />
                    : <CheckoutModal {...sharedProps} />;
            })()}

            {/* Receipt Modal */}
            <ReceiptModal
                receipt={showReceipt}
                onClose={() => { setShowReceipt(null); setSelectedCustomerId(''); }}
                onShareWhatsApp={(r) => { window.open(buildReceiptWhatsAppUrl(r, effectiveRate), '_blank'); }}
                currentRate={effectiveRate}
                copPrimary={copPrimary}
            />

            {/* Custom Amount Modal */}
            {showCustomAmountModal && (
                <CustomAmountModal
                    onClose={() => setShowCustomAmountModal(false)}
                    onConfirm={handleAddCustomAmount}
                    effectiveRate={effectiveRate}
                    triggerHaptic={triggerHaptic}
                />
            )}

            {/* Clear Cart Confirm */}
            <ConfirmModal
                isOpen={showClearCartConfirm}
                onClose={() => setShowClearCartConfirm(false)}
                onConfirm={() => { setCart([]); setDiscount({ type: 'percentage', value: 0 }); setShowClearCartConfirm(false); setCartSelectedIndex(-1); }}
                title="¿Vaciar toda la cesta?"
                message="Todos los productos serán eliminados de la cesta actual. Esta acción no se puede deshacer."
                confirmText="Sí, vaciar"
                variant="cart"
            />

            {/* Discount Modal */}
            {showDiscountModal && (
                <DiscountModal
                    currentDiscount={discount}
                    onApply={(newDiscount) => {
                        setDiscount(newDiscount);
                        setShowDiscountModal(false);
                    }}
                    onClose={() => setShowDiscountModal(false)}
                    cartSubtotalUsd={cartSubtotalUsd}
                    effectiveRate={effectiveRate}
                    tasaCop={tasaCop}
                    copEnabled={copEnabled}
                    copPrimary={copPrimary}
                />
            )}

            {/* Confetti */}
            {showConfetti && <Confetti onDone={() => setShowConfetti(false)} />}

            {/* Keyboard Shortcuts Help Modal (Desktop Only) */}
            <KeyboardHelpModal
                isOpen={showKeyboardHelp}
                onClose={() => setShowKeyboardHelp(false)}
            />

            {/* Apertura Caja Modal */}
            <AperturaCajaModal
                isOpen={isAperturaOpen}
                onClose={() => setIsAperturaOpen(false)}
                onConfirm={handleSaveApertura}
                copEnabled={copEnabled}
                copPrimary={copPrimary}
            />

            {/* Selector de Combos Modulares */}
            {modularComboPickerOpen && pendingModularCombo && (
                <ModularComboPickerModal
                    isOpen={modularComboPickerOpen}
                    onClose={() => { setModularComboPickerOpen(false); setPendingModularCombo(null); }}
                    combo={pendingModularCombo}
                    products={products}
                    effectiveRate={effectiveRate}
                    onConfirm={handleModularComboConfirm}
                />
            )}
        </div>
    );
}
