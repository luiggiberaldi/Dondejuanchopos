import React, { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import localforage from 'localforage';
import { storageService } from '../utils/storageService';
import { BODEGA_CATEGORIES } from '../config/categories';
// HOOK-011: Tras la eliminación del monkeypatch global de localStorage por el Agente B
// (SEC-009), los callers que escriben claves `LOCAL_KEYS` deben invocar `pushLocalSync`
// explícitamente para que el cambio se propague a `sync_documents` (colección 'local').
import { pushLocalSync } from '../hooks/useCloudSync';
import { calculateComboStock } from '../utils/productProcessor';
import { showToast } from '../components/Toast';
import { formatBs } from '../utils/calculatorUtils';
import { getFrozenFormats } from '../utils/frozenPrices';
import { migrateFormatPriceAliases } from '../utils/productPriceMigration';

const ProductContext = createContext();

const normalizeCategories = (cats) => {
    const list = Array.isArray(cats) ? cats : [];
    return list.map(cat => {
        if (!cat) return null;
        if (typeof cat === 'string') {
            return {
                id: cat.toLowerCase().replace(/\s+/g, '_'),
                label: cat.charAt(0).toUpperCase() + cat.slice(1),
                icon: '📦',
                color: 'slate'
            };
        }
        if (typeof cat === 'object') {
            const label = cat.label || cat.name || cat.id || 'Categoría';
            const id = cat.id || label.toLowerCase().replace(/\s+/g, '_');
            return {
                ...cat,
                id,
                label,
                icon: cat.icon || '📦',
                color: cat.color || 'slate'
            };
        }
        return null;
    }).filter(Boolean);
};

const sanitizeProducts = (productsList) => {
    if (!Array.isArray(productsList)) return [];
    const seenIds = new Set();
    return productsList.map((p, idx) => {
        if (!p) return p;
        let item = migrateFormatPriceAliases(p);

        // Garantizar ID único para evitar advertencias de React por claves duplicadas
        let pId = item.id;
        if (!pId || seenIds.has(pId)) {
            pId = item.id ? `${item.id}_dup_${idx}_${Math.random().toString(36).substring(2, 6)}` : `prod_${Date.now()}_${idx}`;
            item.id = pId;
        }
        seenIds.add(pId);

        // Si la URL es de Supabase pero no contiene /public/, se lo insertamos
        if (typeof item.image === 'string' && item.image.includes('.supabase.co/storage/v1/object/') && !item.image.includes('/storage/v1/object/public/')) {
            item.image = item.image.replace('/storage/v1/object/', '/storage/v1/object/public/');
        }
        return item;
    });
};

export function sanitizeRateMode(raw) {
    if (!raw) {
        const oldAuto = typeof localStorage !== 'undefined' ? localStorage.getItem('bodega_use_auto_rate') : null;
        return oldAuto === 'false' ? 'manual' : 'bcv';
    }
    let clean = String(raw).trim();
    try {
        const parsed = JSON.parse(clean);
        if (typeof parsed === 'string') clean = parsed.trim();
    } catch { /* mantener string no JSON */ }
    clean = clean.replace(/^["']|["']$/g, '').toLowerCase();
    if (['bcv', 'euro', 'usdt', 'manual'].includes(clean)) return clean;
    return 'bcv';
}

export function ProductProvider({ children, rates }) {
    const [rawProducts, setProductsState] = useState([]);
    const setProducts = useCallback((val) => {
        setProductsState(prev => {
            const next = typeof val === 'function' ? val(prev) : val;
            return sanitizeProducts(next);
        });
    }, []);

    // Calcular dinámicamente el stock de los combos (normales y modulares - Propuesta A)
    const getProductStock = useCallback((p, allProducts) => {
        return calculateComboStock(p, allProducts);
    }, []);

    const products = useMemo(() => {
        return rawProducts.map(p => {
            if (p.isCombo) {
                return {
                    ...p,
                    stock: calculateComboStock(p, rawProducts)
                };
            }
            return p;
        });
    }, [rawProducts]);

    const [categories, setRawCategories] = useState(() => normalizeCategories(BODEGA_CATEGORIES));
    const setCategories = useCallback((cats) => {
        setRawCategories(prev => {
            const next = typeof cats === 'function' ? cats(prev) : cats;
            return normalizeCategories(next);
        });
    }, []);
    const [isLoadingProducts, setIsLoadingProducts] = useState(true);

    // Guard ref: prevents infinite loop when auto-save fires app_storage_update
    const savingRef = useRef(false);
    const pendingStorageRefreshRef = useRef(false);
    const hasMountedRef = useRef(false);
    const rawProductsRef = useRef(rawProducts);
    useEffect(() => {
        rawProductsRef.current = rawProducts;
    }, [rawProducts]);
    const productsRef = useRef(products);
    useEffect(() => {
        productsRef.current = products;
    }, [products]);

    // MARKET LOGIC - Street Rate
    const [streetRate, setStreetRate] = useState(() => {
        const saved = localStorage.getItem('street_rate_bs');
        return saved ? parseFloat(saved) : 0;
    });

    // GLOBAL RATE LOGIC — rateMode: 'bcv' | 'euro' | 'usdt' | 'manual'
    // Backward-compat: si existía bodega_use_auto_rate=false se migra a 'manual'
    const [rateMode, setRateMode] = useState(() => {
        return sanitizeRateMode(localStorage.getItem('bodega_rate_mode'));
    });
    const [customRate, setCustomRate] = useState(() => {
        const saved = localStorage.getItem('bodega_custom_rate');
        return saved && parseFloat(saved) > 0 ? saved : '';
    });
    // Alias de compatibilidad: useAutoRate=true cuando no es manual
    const useAutoRate = rateMode !== 'manual';
    const setUseAutoRate = (val) => {
        if (val) {
            setRateMode(prev => ['bcv', 'euro', 'usdt'].includes(prev) ? prev : 'bcv');
        } else {
            setRateMode('manual');
        }
    };

    // AUTO COP LOGIC
    const [copEnabled, setCopEnabled] = useState(() => {
        return localStorage.getItem('cop_enabled') === 'true';
    });
    const [autoCopEnabled, setAutoCopEnabled] = useState(() => {
        return localStorage.getItem('auto_cop_enabled') === 'true';
    });
    const [tasaCopManual, setTasaCopManual] = useState(() => {
        return localStorage.getItem('tasa_cop') || '';
    });
    const [copPrimary, setCopPrimary] = useState(() => {
        return localStorage.getItem('cop_primary') === 'true';
    });

    // BS ROUNDING STEP — 0: sin redondeo | 1: enteros | 5 | 10 (default de fábrica) | 20 | 50
    const [bsRoundingStep, setBsRoundingStepState] = useState(() => {
        const saved = localStorage.getItem('bs_rounding_step');
        if (saved !== null) return parseInt(saved, 10);
        // DEFAULT DE FÁBRICA: 10 (múltiplos de 10 Bs)
        localStorage.setItem('bs_rounding_step', '10');
        return 10;
    });
    const setBsRoundingStep = useCallback((val) => {
        const numVal = parseInt(val, 10) || 0;
        setBsRoundingStepState(numVal);
        localStorage.setItem('bs_rounding_step', String(numVal));
    }, []);

    // CHECKOUT MODE — 'basic' (barras móviles) | 'pos' (2 columnas, estilo Listo POS)
    const [checkoutMode, setCheckoutModeState] = useState(() => {
        const saved = localStorage.getItem('checkout_mode');
        if (saved) return saved;
        // Detectar por defecto basado en viewport (PC/Escritorio: >= 1024px)
        const isPC = typeof window !== 'undefined' && window.innerWidth >= 1024;
        return isPC ? 'pos' : 'basic';
    });
    const setCheckoutMode = (mode) => {
        setCheckoutModeState(mode);
        localStorage.setItem('checkout_mode', mode);
    };

    // effectiveRate según el modo seleccionado
    const effectiveRate = (() => {
        if (rateMode === 'euro') return rates?.euro?.price || rates?.bcv?.price || 1;
        if (rateMode === 'usdt') return rates?.usdt?.price || rates?.bcv?.price || 1;
        if (rateMode === 'manual') return parseFloat(customRate) > 0 ? parseFloat(customRate) : (rates?.bcv?.price || 1);
        return rates?.bcv?.price || 1; // 'bcv' (default)
    })();
    
    // Calcula el COP efectivo. rates.autoCopRate es calculado en useRates basado en TRM y la Brecha USDT/BCV.
    const tasaCop = autoCopEnabled && rates?.autoCopRate?.price 
        ? rates.autoCopRate.price 
        : (parseFloat(tasaCopManual) > 0 ? parseFloat(tasaCopManual) : 4150);

    // Detección automática de cambio de tasa para productos en Bs Congelado
    const [bsCongeladoAlert, setBsCongeladoAlert] = useState(null); // { prevRate, newRate, count }
    const [isBsWizardOpen, setIsBsWizardOpen] = useState(false);
    const [previousRate, setPreviousRate] = useState(() => {
        const saved = localStorage.getItem('dj_prev_rate');
        return saved ? parseFloat(saved) : 0;
    });

    useEffect(() => {
        // No evaluar ni mover el baseline de tasa mientras el catálogo esté cargando (products = [])
        if (isLoadingProducts) return;

        // Guarda-raíl: La alerta y revisión de Bs Congelado SOLO aplica si la tasa está en modo MANUAL
        if (rateMode !== 'manual') {
            if (bsCongeladoAlert) setBsCongeladoAlert(null);
            if (effectiveRate > 0) localStorage.setItem('dj_last_effective_rate', String(effectiveRate));
            return;
        }

        if (effectiveRate > 0) {
            const lastKnown = parseFloat(localStorage.getItem('dj_last_effective_rate') || '0');

            if (!(lastKnown > 0 && Math.abs(lastKnown - effectiveRate) > 0.05)) {
                localStorage.setItem('dj_last_effective_rate', String(effectiveRate));
                return;
            }

            const frozenCount = (products || []).reduce((acc, p) => acc + getFrozenFormats(p).length, 0);

            localStorage.setItem('dj_prev_rate', String(lastKnown));
            setPreviousRate(lastKnown);

            if (frozenCount > 0) {
                setBsCongeladoAlert({
                    prevRate: lastKnown,
                    newRate: effectiveRate,
                    count: frozenCount,
                    timestamp: Date.now()
                });
                showToast(`⚡ Tasa cambiada de ${formatBs(lastKnown)} a ${formatBs(effectiveRate)} Bs (${frozenCount} productos congelados por revisar)`, 'info');
            } else {
                showToast(`⚡ Tasa de cambio actualizada a ${formatBs(effectiveRate)} Bs`, 'success');
            }

            localStorage.setItem('dj_last_effective_rate', String(effectiveRate));
        }
    }, [effectiveRate, rateMode, products, isLoadingProducts]);

    const openBsCongeladoWizard = useCallback(() => {
        setIsBsWizardOpen(true);
    }, []);

    const closeBsCongeladoWizard = useCallback(() => {
        setIsBsWizardOpen(false);
    }, []);

    const dismissBsCongeladoAlert = useCallback(() => {
        setBsCongeladoAlert(null);
    }, []);

    // Initial Load
    useEffect(() => {
        let isMounted = true;
        const loadData = async () => {
            const savedProducts = await storageService.getItem('bodega_products_v1', []);
            const savedCategories = await storageService.getItem('my_categories_v1', BODEGA_CATEGORIES);
            if (isMounted) {
                setProducts(savedProducts);
                setCategories(savedCategories);
                setIsLoadingProducts(false);
            }
        };
        loadData();
        return () => { isMounted = false; };
    }, []);

    // One-time migration: assign priceCop to existing products that don't have it
    useEffect(() => {
        if (isLoadingProducts || products.length === 0) return;
        if (!copEnabled || !tasaCop || tasaCop <= 0) return;
        if (localStorage.getItem('priceCop_migration_v1') === 'done') return;

        const needsMigration = products.some(p => p.priceUsdt > 0 && (p.priceCop == null || p.priceCop <= 0));
        if (!needsMigration) {
            localStorage.setItem('priceCop_migration_v1', 'done');
            return;
        }

        const migrated = products.map(p => {
            if (p.priceUsdt > 0 && (p.priceCop == null || p.priceCop <= 0)) {
                const priceCop = Math.round(p.priceUsdt * tasaCop);
                const unitPriceCop = p.unitPriceUsd > 0
                    ? Math.round(p.unitPriceUsd * tasaCop)
                    : null;
                return { ...p, priceCop, ...(unitPriceCop ? { unitPriceCop } : {}) };
            }
            return p;
        });

        setProducts(migrated);
        localStorage.setItem('priceCop_migration_v1', 'done');
    }, [isLoadingProducts, products.length, copEnabled, tasaCop]);

    // Set Initial Street Rate (from BCV)
    useEffect(() => {
        if (!streetRate && rates.bcv?.price > 0 && !localStorage.getItem('street_rate_bs')) {
            setStreetRate(rates.bcv.price);
        }
    }, [rates.bcv?.price, streetRate]);

    // Auto-save products and categories with Debounce (Performance Fix)
    // HOOK-018: Setear `savingRef.current = true` ANTES del setTimeout para que
    // el handler de `app_storage_update` (disparado por el setItem dentro del
    // callback, o por un push cloud que llega entre el schedule y el fire) vea
    // el flag activo y NO dispare un re-fetch que pisaría el save en curso.
    useEffect(() => {
        if (isLoadingProducts) return;
        // En modo monitor, omitir el guardado automático local/nube para evitar que el monitor
        // pise la base de datos de productos de la caja principal (evita borrados accidentales).
        if (localStorage.getItem('dj_pairing_mode') === 'monitor') return;

        if (!hasMountedRef.current) {
            hasMountedRef.current = true;
            return;
        }

        // Setear el guard ANTES de agendar el timeout (HOOK-018).
        savingRef.current = true;

        const timer = setTimeout(() => {
            const savePromises = [];
            if (products.length > 0) {
                savePromises.push(storageService.setItem('bodega_products_v1', products));
            } else {
                savePromises.push(storageService.removeItem('bodega_products_v1'));
            }
            savePromises.push(storageService.setItem('my_categories_v1', categories));
            Promise.all(savePromises).finally(() => {
                // Reset guard after microtask queue flushes
                setTimeout(() => {
                    savingRef.current = false;
                    if (pendingStorageRefreshRef.current) {
                        pendingStorageRefreshRef.current = false;
                        storageService.getItem('bodega_products_v1', []).then(fresh => {
                            if (fresh && Array.isArray(fresh)) {
                                setProducts(sanitizeProducts(fresh));
                            }
                        });
                    }
                }, 50);
            });
        }, 1000); // 1 segundo de debounce

        return () => {
            clearTimeout(timer);
            // Si el efecto se re-corre antes del fire (cambio rápido de products),
            // dejamos el guard en true — el siguiente run lo reseteará al final.
            // No tocamos savingRef aquí: lo gestiona el callback del setTimeout.
        };
    }, [products, categories, isLoadingProducts]);

    useEffect(() => {
        if (streetRate > 0) localStorage.setItem('street_rate_bs', streetRate.toString());
    }, [streetRate]);

    useEffect(() => {
        localStorage.setItem('bodega_rate_mode', rateMode);
        localStorage.setItem('bodega_use_auto_rate', JSON.stringify(rateMode !== 'manual'));
        pushLocalSync('bodega_use_auto_rate', rateMode !== 'manual');
        pushLocalSync('bodega_rate_mode', rateMode);
        if (customRate) {
            localStorage.setItem('bodega_custom_rate', customRate.toString());
            pushLocalSync('bodega_custom_rate', parseFloat(customRate));
        }
    }, [rateMode, customRate]);

    // Listener para actualizar si cambia en otra pestaña/componente
    useEffect(() => {
        const handleStorageChange = (e) => {
            if (e.key === 'bodega_custom_rate') {
                if (e.newValue && parseFloat(e.newValue) > 0) setCustomRate(e.newValue);
            }
            if (e.key === 'bodega_rate_mode') {
                if (e.newValue) setRateMode(sanitizeRateMode(e.newValue));
            }
            if (e.key === 'bodega_use_auto_rate') {
                // HOOK-022: antes catch silencioso; loguear en dev para detectar corrupción.
                try {
                    const isAuto = !!JSON.parse(e.newValue);
                    if (isAuto) {
                        setRateMode(prev => ['bcv', 'euro', 'usdt'].includes(prev) ? prev : 'bcv');
                    } else {
                        setRateMode('manual');
                    }
                }
                catch (err) { console.warn('[ProductContext] storage bodega_use_auto_rate parse error:', err); }
            }
            if (e.key === 'cop_enabled') {
                setCopEnabled(e.newValue === 'true');
            }
            if (e.key === 'auto_cop_enabled') {
                setAutoCopEnabled(e.newValue === 'true');
            }
            if (e.key === 'tasa_cop') {
                setTasaCopManual(e.newValue);
            }
            if (e.key === 'cop_primary') {
                setCopPrimary(e.newValue === 'true');
            }
            if (e.key === 'bodega_products_v1') {
                // If modified in another tab, fetch it
                storageService.getItem('bodega_products_v1', []).then(updatedProducts => {
                    const sanitized = sanitizeProducts(updatedProducts);
                    if (JSON.stringify(sanitized) !== JSON.stringify(rawProductsRef.current)) {
                        setProducts(sanitized);
                    }
                });
            }
            if (e.key === 'my_categories_v1') {
                storageService.getItem('my_categories_v1', BODEGA_CATEGORIES).then(updatedCategories => setCategories(updatedCategories));
            }
        };

        const handleAppStorageUpdate = async (e) => {
            const isMonitor = localStorage.getItem('dj_pairing_mode') === 'monitor';
            const key = e.detail?.key;
            if (savingRef.current && !isMonitor) {
                if (key === 'bodega_products_v1' || key === 'my_categories_v1') {
                    pendingStorageRefreshRef.current = true;
                }
                return;
            }
            if (!key) return;

            if (key === 'bodega_products_v1') {
                const updatedProducts = await storageService.getItem('bodega_products_v1', []);
                const sanitized = sanitizeProducts(updatedProducts);
                setProducts(sanitized);
            }
            if (key === 'my_categories_v1') {
                const updatedCategories = await storageService.getItem('my_categories_v1', BODEGA_CATEGORIES);
                setCategories(updatedCategories);
            }
            if (key === 'bodega_rate_mode') {
                const val = localStorage.getItem('bodega_rate_mode');
                if (val) setRateMode(val);
            }
            if (key === 'bodega_custom_rate') {
                const val = localStorage.getItem('bodega_custom_rate');
                if (val && parseFloat(val) > 0) setCustomRate(val);
            }
            if (key === 'bodega_use_auto_rate') {
                const val = localStorage.getItem('bodega_use_auto_rate');
                try {
                    const isAuto = val ? JSON.parse(val) : true;
                    if (isAuto) {
                        setRateMode(prev => ['bcv', 'euro', 'usdt'].includes(prev) ? prev : 'bcv');
                    } else {
                        setRateMode('manual');
                    }
                } catch (err) {}
            }
            if (key === 'cop_enabled') {
                setCopEnabled(localStorage.getItem('cop_enabled') === 'true');
            }
            if (key === 'auto_cop_enabled') {
                setAutoCopEnabled(localStorage.getItem('auto_cop_enabled') === 'true');
            }
            if (key === 'tasa_cop') {
                setTasaCopManual(localStorage.getItem('tasa_cop') || '');
            }
            if (key === 'cop_primary') {
                setCopPrimary(localStorage.getItem('cop_primary') === 'true');
            }
        };

        const handleSupervisorInventoryApplied = async (e) => {
            const updated = e.detail?.updatedProducts;
            if (Array.isArray(updated) && updated.length > 0) {
                setProducts(sanitizeProducts(updated));
            } else {
                const fresh = await storageService.getItem('bodega_products_v1', []);
                if (fresh && Array.isArray(fresh)) {
                    setProducts(sanitizeProducts(fresh));
                }
            }
        };

        window.addEventListener('storage', handleStorageChange);
        window.addEventListener('app_storage_update', handleAppStorageUpdate);
        window.addEventListener('supervisor_inventory_applied', handleSupervisorInventoryApplied);
        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('app_storage_update', handleAppStorageUpdate);
            window.removeEventListener('supervisor_inventory_applied', handleSupervisorInventoryApplied);
        };
    }, []);

    // ── Buffer de aglomeración inteligente para Kardex (Debounce 800ms) ──────────
    const pendingKardexBufferRef = useRef(new Map());

    const flushProductKardex = useCallback((productId) => {
        const entry = pendingKardexBufferRef.current.get(productId);
        if (!entry) return;
        pendingKardexBufferRef.current.delete(productId);

        if (entry.accumulatedDelta === 0) return;

        const finalStock = entry.initialStock + entry.accumulatedDelta;
        import('../services/kardexService').then(({ recordKardexMovement }) => {
            import('../hooks/store/useAuthStore').then(({ useAuthStore }) => {
                const user = useAuthStore.getState().usuarioActivo;
                const isPositive = entry.accumulatedDelta > 0;
                const sign = isPositive ? '+' : '';
                recordKardexMovement({
                    productoId: entry.product.id,
                    productoNombre: entry.product.name,
                    sku: entry.product.barcode || entry.product.sku || '',
                    tipo: isPositive ? 'ENTRADA' : 'SALIDA',
                    subtipo: 'AJUSTE_RAPIDO',
                    cantidad: entry.accumulatedDelta,
                    unidad: entry.product.unit || 'unidad',
                    stock_antes: entry.initialStock,
                    stock_despues: finalStock,
                    costoUnitario: Number(entry.product.costUsd || entry.product.cost || 0),
                    motivo: isPositive
                        ? `Aumento directo con botón (${sign}${entry.accumulatedDelta} u)`
                        : `Disminución / Salida directa con botón (${entry.accumulatedDelta} u)`,
                    usuarioId: user?.id || null,
                    usuarioNombre: user?.nombre || 'Administrador'
                }).catch(e => console.error('[ProductContext] Error registrando Kardex agendado:', e));
            });
        });
    }, []);

    const flushAllPendingKardex = useCallback(() => {
        for (const [productId, entry] of pendingKardexBufferRef.current.entries()) {
            if (entry.timer) clearTimeout(entry.timer);
            flushProductKardex(productId);
        }
    }, [flushProductKardex]);

    useEffect(() => {
        return () => {
            flushAllPendingKardex();
        };
    }, [flushAllPendingKardex]);

    // HOOK-005: Memoizar adjustStock para que el objeto `value` del Provider
    // sea estable entre renders cuando los productos no cambian.
    const adjustStock = useCallback((productId, delta) => {
        const targetProduct = productsRef.current.find(p => p.id === productId || p._originalId === productId);
        if (!targetProduct) return;

        const actualId = targetProduct.id;

        // 1. Actualizar el estado visual de los productos de forma inmediata (60 FPS)
        setProducts(prevProducts => prevProducts.map(p => {
            if (p.id === actualId || p._originalId === actualId) {
                const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';
                const newStock = (p.stock ?? 0) + delta;
                return { ...p, stock: allowNeg ? newStock : Math.max(0, newStock) };
            }
            return p;
        }));

        // 2. Acumular en el buffer debounced del Kardex
        let entry = pendingKardexBufferRef.current.get(actualId);

        if (entry) {
            if (entry.timer) clearTimeout(entry.timer);
            entry.accumulatedDelta += delta;
        } else {
            const initialStock = Number(targetProduct.stock) || 0;
            entry = {
                product: targetProduct,
                initialStock: initialStock,
                accumulatedDelta: delta,
                timer: null
            };
            pendingKardexBufferRef.current.set(actualId, entry);
        }

        entry.timer = setTimeout(() => {
            flushProductKardex(actualId);
        }, 800);
    }, [flushProductKardex]);

    // Restauración de Copia de Sombra de Emergencia
    const restoreShadowBackup = useCallback(async () => {
        try {
            const shadow = await localforage.getItem('bodega_products_shadow_backup_v1');
            if (Array.isArray(shadow) && shadow.length > 0) {
                localStorage.setItem('confirm_bulk_delete_catalog_flag', 'true');
                localStorage.setItem('confirm_bulk_delete_catalog_ts', Date.now().toString());
                try {
                    await storageService.setItem('bodega_products_v1', shadow);
                } finally {
                    localStorage.removeItem('confirm_bulk_delete_catalog_flag');
                    localStorage.removeItem('confirm_bulk_delete_catalog_ts');
                }
                setProducts(shadow);
                showToast(`¡Se restauraron ${shadow.length} productos desde la Copia de Sombra Local!`, 'success');
                return true;
            } else {
                showToast('No hay copia de sombra guardada aún', 'info');
                return false;
            }
        } catch (err) {
            console.error('Error restaurando copia de sombra:', err);
            showToast('Error al restaurar copia de sombra', 'error');
            return false;
        }
    }, []);

    // HOOK-005: Envolver `value` en useMemo con deps correctas para evitar que
    // TODOS los consumidores se re-rendericen en cada render del Provider.
    // Las setters de useState son estables y no necesitan estar en deps.
    const value = useMemo(() => ({
        products,
        setProducts,
        categories,
        setCategories,
        isLoadingProducts,
        streetRate,
        setStreetRate,
        rateMode,
        setRateMode,
        useAutoRate,
        setUseAutoRate,
        customRate,
        setCustomRate,
        effectiveRate,
        rates,
        copEnabled,
        setCopEnabled,
        autoCopEnabled,
        setAutoCopEnabled,
        tasaCopManual,
        setTasaCopManual,
        copPrimary,
        setCopPrimary,
        tasaCop,
        checkoutMode,
        setCheckoutMode,
        adjustStock,
        bsRoundingStep,
        setBsRoundingStep,
        bsCongeladoAlert,
        dismissBsCongeladoAlert,
        previousRate,
        isBsWizardOpen,
        openBsCongeladoWizard,
        closeBsCongeladoWizard,
        restoreShadowBackup,
    }), [
        products,
        categories,
        isLoadingProducts,
        streetRate,
        useAutoRate,
        customRate,
        effectiveRate,
        rates,
        rateMode,
        copEnabled,
        autoCopEnabled,
        tasaCopManual,
        copPrimary,
        tasaCop,
        checkoutMode,
        adjustStock,
        bsRoundingStep,
        setBsRoundingStep,
        bsCongeladoAlert,
        dismissBsCongeladoAlert,
        previousRate,
        isBsWizardOpen,
        openBsCongeladoWizard,
        closeBsCongeladoWizard,
    ]);

    return (
        <ProductContext.Provider value={value}>
            {children}
        </ProductContext.Provider>
    );
}

export const useProductContext = () => {
    const context = useContext(ProductContext);
    if (!context) {
        throw new Error("useProductContext must be used within a ProductProvider");
    }
    return context;
};
