import React, { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import localforage from 'localforage';
import { storageService } from '../utils/storageService';
import { withLock } from '../utils/withLock';
import { BODEGA_CATEGORIES } from '../config/categories';
// HOOK-011: Tras la eliminación del monkeypatch global de localStorage por el Agente B
// (SEC-009), los callers que escriben claves `LOCAL_KEYS` deben invocar `pushLocalSync`
// explícitamente para que el cambio se propague a `sync_documents` (colección 'local').
import { pushLocalSync } from '../hooks/useCloudSync';
import { calculateComboStock } from '../utils/productProcessor';
import { showToast } from '../components/Toast';
import { formatBs } from '../utils/calculatorUtils';
import { sumR } from '../utils/dinero';
import { buildStockTransition } from '../utils/inventoryMovementModel';
import { getFrozenFormats } from '../utils/frozenPrices';
import { migrateFormatPriceAliases } from '../utils/productPriceMigration';
import { shouldApplySyncVersion } from '../utils/syncVersionGuard';

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
    const productSyncVersionRef = useRef(null);
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
            // Recuperar primero operaciones Stock + Kardex que quedaron en
            // PENDING/FAILED_RETRYABLE tras un corte entre escrituras.
            try {
                const { recoverPendingInventoryOperations } = await import('../services/inventoryOperationService');
                await recoverPendingInventoryOperations();
            } catch (error) {
                console.error('[ProductContext] No se pudieron recuperar operaciones de inventario:', error);
            }
            try {
                const { recoverPendingEmployeeOperations } = await import('../services/employeeService');
                await recoverPendingEmployeeOperations();
            } catch (error) {
                console.error('[ProductContext] No se pudieron recuperar operaciones de empleados:', error);
            }
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
            // El stock se persiste exclusivamente por inventoryOperationService.
            // Releerlo bajo el mismo lock evita que un auto-save de atributos
            // vuelva a guardar una proyección optimista y pise un Kardex en vuelo.
            savePromises.push(withLock('pos_write_lock', async () => {
                if (products.length > 0) {
                    const durableProducts = await storageService.getItem('bodega_products_v1', []);
                    const durableById = new Map((Array.isArray(durableProducts) ? durableProducts : [])
                        .map(product => [product.id, product]));
                    const stockTraceFields = [
                        'stock',
                        'lastStockOperationId',
                        'stockOperationIds',
                        'stockUpdatedAt',
                        'stockUpdatedBy',
                        'stockUpdatedByName',
                        'stockUpdatedByRole',
                    ];
                    const productsForSave = products.map(product => {
                        const durable = durableById.get(product.id);
                        if (!durable) return product;
                        const merged = { ...product };
                        for (const field of stockTraceFields) {
                            if (Object.prototype.hasOwnProperty.call(durable, field)) merged[field] = durable[field];
                            else delete merged[field];
                        }
                        return merged;
                    });
                    await storageService.setItem('bodega_products_v1', productsForSave);
                } else {
                    await storageService.removeItem('bodega_products_v1');
                }
            }));
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
        } else {
            localStorage.removeItem('bodega_custom_rate');
            pushLocalSync('bodega_custom_rate', null);
        }
    }, [rateMode, customRate]);

    // Listener para actualizar si cambia en otra pestaña/componente
    useEffect(() => {
        const handleStorageChange = (e) => {
            if (e.key === 'bodega_custom_rate') {
                if (e.newValue && parseFloat(e.newValue) > 0) setCustomRate(e.newValue);
                else setCustomRate('');
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
                const incomingVersion = e.detail?.source === 'monitor-sync' ? e.detail?.syncVersion : null;
                const isMonitorProductContext = localStorage.getItem('dj_pairing_mode') === 'monitor';
                if (isMonitorProductContext && e.detail?.source !== 'monitor-sync') {
                    return;
                }
                if (e.detail?.source === 'monitor-sync'
                    && !shouldApplySyncVersion(productSyncVersionRef.current, incomingVersion)) {
                    return;
                }

                const updatedProducts = Array.isArray(e.detail?.payload)
                    ? e.detail.payload
                    : await storageService.getItem('bodega_products_v1', []);
                const sanitized = sanitizeProducts(updatedProducts);
                if (e.detail?.source === 'monitor-sync' && incomingVersion) {
                    productSyncVersionRef.current = incomingVersion;
                }
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
                else setCustomRate('');
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

        const restoreVisualFromDurableState = async () => {
            try {
                const fresh = await storageService.getItem('bodega_products_v1', []);
                if (Array.isArray(fresh)) {
                    setProducts(sanitizeProducts(fresh));
                    return;
                }
            } catch (error) {
                console.warn('[ProductContext] No se pudo leer stock para rollback:', error);
            }

            // Último recurso: restaurar solo si la fila todavía conserva la
            // proyección que originó esta operación. No pisar una venta o un
            // segundo ajuste que haya ocurrido después.
            setProducts(previous => previous.map(product => {
                if (product.id !== productId) return product;
                const current = Number(product.stock) || 0;
                const isSameProjection = Math.abs(current - entry.projectedStock) <= 0.000001;
                return isSameProjection ? { ...product, stock: entry.initialStock } : product;
            }));
        };

        const settle = async (result, user) => {
            const nextEntryPending = pendingKardexBufferRef.current.has(productId);
            if (result?.success) {
                // Si no hay otro ajuste local esperando, reflejar el snapshot
                // confirmado por el servicio. Si lo hay, el siguiente resultado
                // contiene la secuencia completa y evita un parpadeo intermedio.
                if (!nextEntryPending && Array.isArray(result.updatedProducts)) {
                    setProducts(sanitizeProducts(result.updatedProducts));
                }
                return;
            }

            // Una operación recuperable se reintenta en el mismo proceso; no se
            // obliga al cajero a recargar la PC para que ProductContext la vea.
            if (result?.pending) {
                try {
                    const { recoverPendingInventoryOperations } = await import('../services/inventoryOperationService');
                    const recovered = await recoverPendingInventoryOperations();
                    const recoveredOperation = recovered.find(item => item.operationId === entry.operationId && item.success);
                    if (recoveredOperation?.success) {
                        if (!pendingKardexBufferRef.current.has(productId)
                            && Array.isArray(recoveredOperation.updatedProducts)) {
                            setProducts(sanitizeProducts(recoveredOperation.updatedProducts));
                        }
                        return;
                    }
                } catch (recoveryError) {
                    console.warn('[ProductContext] Recuperación inmediata de stock falló:', recoveryError);
                }
            }

            await restoreVisualFromDurableState();
            showToast('No se pudo guardar el ajuste de stock. Se restauró el valor anterior.', 'error');
            console.error('[ProductContext] Ajuste Kardex rechazado:', result?.error || 'error desconocido', {
                operationId: entry.operationId,
                actorId: user?.id || null,
            });
        };

        import('../services/inventoryOperationService').then(({ applyInventoryOperation }) => {
            import('../hooks/store/useAuthStore').then(({ useAuthStore }) => {
                const user = useAuthStore.getState().usuarioActivo;
                const isPositive = entry.accumulatedDelta > 0;
                return applyInventoryOperation({
                    operationId: entry.operationId,
                    referenceId: entry.operationId,
                    referenceType: 'AJUSTE_RAPIDO',
                    source: 'AJUSTE_RAPIDO',
                    tipo: isPositive ? 'ENTRADA' : 'SALIDA',
                    subtipo: 'AJUSTE_RAPIDO',
                    reason: entry.motivo || (isPositive
                        ? `Ajuste +${entry.accumulatedDelta} unds`
                        : `Ajuste ${entry.accumulatedDelta} unds`),
                    deductions: [{
                        productoId: entry.product.id,
                        cantidad: entry.accumulatedDelta,
                        unidad: entry.product.unit || 'unidad',
                        origen: 'AJUSTE'
                    }],
                    allowNegative: entry.allowNegative,
                    actor: {
                        usuarioId: user?.id || null,
                        usuarioNombre: user?.nombre || 'Administrador',
                        usuarioRol: user?.rol || 'SYSTEM',
                    },
                    metadata: {
                        requestedQuantity: entry.requestedDelta,
                        appliedQuantity: entry.accumulatedDelta
                    }
                }).then(result => settle(result, user));
            });
        }).catch(error => {
            settle({ success: false, error: error?.message || 'Error registrando ajuste' }, null);
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
    const adjustStock = useCallback((productId, delta, options = {}) => {
        const targetProduct = productsRef.current.find(p => p.id === productId || p._originalId === productId);
        if (!targetProduct) return;

        const actualId = targetProduct.id;
        const allowNegative = localStorage.getItem('allow_negative_stock') === 'true';
        let entry = pendingKardexBufferRef.current.get(actualId);
        const projectedStock = entry?.projectedStock ?? (Number(targetProduct.stock) || 0);
        const transition = buildStockTransition(projectedStock, delta, { allowNegative });

        // 1. Actualizar el estado visual al stock realmente aplicable.
        setProducts(prevProducts => prevProducts.map(p => (
            p.id === actualId || p._originalId === actualId
                ? { ...p, stock: transition.stockDespues }
                : p
        )));

        // 2. Acumular cantidades aplicadas, no deltas imposibles por clamp.
        if (entry?.timer) clearTimeout(entry.timer);
        if (!entry) {
            entry = {
                product: targetProduct,
                initialStock: projectedStock,
                projectedStock: transition.stockDespues,
                accumulatedDelta: transition.cantidadAplicada,
                requestedDelta: transition.cantidadSolicitada,
                allowNegative,
                motivo: options.motivo || null,
                operationId: `adjust_${actualId}_${crypto.randomUUID()}`,
                timer: null
            };
            pendingKardexBufferRef.current.set(actualId, entry);
        } else {
            entry.projectedStock = transition.stockDespues;
            entry.accumulatedDelta = sumR(entry.accumulatedDelta, transition.cantidadAplicada);
            entry.requestedDelta = sumR(entry.requestedDelta, transition.cantidadSolicitada);
            entry.allowNegative = allowNegative;
            if (options.motivo) entry.motivo = options.motivo;
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
        return {
            products: [],
            setProducts: () => {},
            rawProducts: [],
            categories: [],
            setCategories: () => {},
            effectiveRate: 1,
            rateMode: 'bcv',
            tasaCop: 4150,
            copEnabled: false,
            copPrimary: false,
            bsRoundingStep: 10,
            setBsRoundingStep: () => {},
            bsCongeladoAlert: null,
            isBsWizardOpen: false,
            dismissBsCongeladoAlert: () => {},
            openBsCongeladoWizard: () => {},
            closeBsCongeladoWizard: () => {},
            previousRate: 0,
            addProduct: async () => {},
            updateProduct: async () => {},
            deleteProduct: async () => {},
            adjustStock: async () => {},
        };
    }
    return context;
};
