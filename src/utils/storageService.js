import localforage from 'localforage';
import { queueCloudSync } from '../hooks/useCloudSync';
import { mergeSalesArrays } from './salesMerge';
localforage.config({
    name: 'BodegaApp',
    storeName: 'bodega_app_data',
    description: 'Almacenamiento local optimizado para PWA de Bodega'
});

/**
 * Cola de reintentos para operaciones que fallaron por QuotaExceededError.
 * Se procesa cuando el dispositivo recupera espacio (ej: tras clearAllData)
 * o mediante un flush manual del caller.
 * @type {Array<{ key: string, value: any, attempts: number }>}
 */
const _retryQueue = [];

const QUOTA_RETRY_MAX = 3;

/**
 * Servicio de almacenamiento que previene el límite de 5MB de localStorage
 * Migrando los datos pesados a IndexedDB a través de localforage.
 *
 * ── HOOK-004 (lock para writes críticos) ─────────────────────────────────
 * IMPORTANTE: los callers que realicen read-modify-write sobre claves críticas
 * (ventas, audit log, cuentas, stock) DEBEN envolver la operación completa en
 * `withLock` para evitar race conditions entre tabs y entre ráfagas de writes.
 * Ejemplo:
 *
 *   import { withLock } from '../utils/withLock';
 *   await withLock('pos_write_lock', async () => {
 *       const sales = await storageService.getItem(SALES_KEY, []);
 *       sales.push(newSale);
 *       await storageService.setItem(SALES_KEY, sales);
 *   });
 *
 * `storageService.setItem` por sí solo NO toma el lock — solo garantiza la
 * escritura atómica en IndexedDB/localStorage, no la coherencia read-write con
 * otros writers concurrentes.
 *
 * ── HOOK-007 (QuotaExceededError) ─────────────────────────────────────────
 * Cuando IndexedDB y localStorage están llenos, disparamos el evento global
 * `quota_exceeded` para que la UI avise al usuario y ofrezca limpieza. La
 * operación fallida se encola para reintento automático cuando haya espacio.
 */
export const storageService = {
    /**
     * Obtiene un item de IndexedDB.
     * Si no existe, intenta leerlo de localStorage (Retrocompatibilidad),
     * lo guarda en IndexedDB y lo borra de localStorage.
     */
    async getItem(key, defaultValue = null) {
        try {
            // 1. Intentar leer de IndexedDB
            const value = await localforage.getItem(key);

            if (value !== null) {
                return value;
            }

            // --- INTENTO DE RECUPERAR DATOS ANTERIORES AUTOMÁTICAMENTE ---
            try {
                if (key === 'bodega_products_v1' || key === 'bodega_customers_v1' || key === 'bodega_accounts_v2') {
                    const oldKeyMap = {
                        'bodega_products_v1': 'my_products_v1',
                        'bodega_customers_v1': 'my_customers_v1',
                        'bodega_accounts_v2': 'my_accounts_v2',
                    };
                    const oldKey = oldKeyMap[key];
                    if (oldKey) {
                        const oldStore = localforage.createInstance({
                            name: 'TasasAlDiaApp',
                            storeName: 'app_data'
                        });
                        const oldVal = await oldStore.getItem(oldKey);
                        if (oldVal !== null) {
                            await localforage.setItem(key, oldVal);
                            console.log(`[Migración Auto] Recuperado ${oldKey} -> ${key}`);
                            return oldVal;
                        }
                    }
                }
            } catch(e) {
                console.error("Error intentando recuperar datos antiguos", e);
            }

            // 2. Si no existe, revisar LocalStorage (Migración al vuelo)
            const fallbackValue = localStorage.getItem(key);
            if (fallbackValue !== null) {
                // Migración silenciosa de localStorage a IndexedDB

                let parsedValue;
                try {
                    parsedValue = JSON.parse(fallbackValue);
                } catch (e) {
                    parsedValue = fallbackValue; // A veces guardamos strings directos
                }

                // Guardar en la nueva base de datos
                await localforage.setItem(key, parsedValue);

                // Borrar el viejo para liberar el preciado espacio de 5MB
                localStorage.removeItem(key);

                return parsedValue;
            }

            // 3. No existe en ningún lado
            return defaultValue;

        } catch (error) {
            console.error(`[Storage Error] Leyendo ${key}:`, error);
            // Fallback drástico en caso de que el navegador bloquee IndexedDB por privacidad extrema
            const backup = localStorage.getItem(key);
            if (backup) {
                try { return JSON.parse(backup); } catch (e) { return backup; }
            }
            return defaultValue;
        }
    },

    /**
     * Guarda un item directamente en IndexedDB
     *
     * HOOK-007: detecta QuotaExceededError y dispara evento global.
     */
    async setItem(key, value) {
        try {
            // ── PROTECCIÓN DE INVENTARIO: Circuit Breaker & Shadow Snapshot ──
            if (key === 'bodega_products_v1' && Array.isArray(value)) {
                try {
                    const existing = await localforage.getItem('bodega_products_v1');
                    if (Array.isArray(existing) && existing.length > 5) {
                        // 1. Shadow Snapshot: Respaldar por tiempo (30 min) y NUNCA si el catálogo encoge
                        const SHADOW_MIN_INTERVAL_MS = 30 * 60 * 1000;
                        const lastTs = Date.parse(localStorage.getItem('bodega_shadow_backup_ts') || '') || 0;
                        const shrinks = value.length < existing.length;

                        if (!shrinks && Date.now() - lastTs > SHADOW_MIN_INTERVAL_MS) {
                            await localforage.setItem('bodega_products_shadow_backup_v1', existing);
                            localStorage.setItem('bodega_shadow_backup_ts', new Date().toISOString());
                        }

                        // 2. Circuit Breaker: Bloquear si se intenta reducir el inventario drásticamente sin confirmación explícita válida (<60s)
                        const flagRaw = localStorage.getItem('confirm_bulk_delete_catalog_flag');
                        const flagTs = parseInt(localStorage.getItem('confirm_bulk_delete_catalog_ts') || '0', 10);
                        const isBulkDeleteAllowed = flagRaw === 'true' && (flagTs === 0 || Date.now() - flagTs < 60000);

                        const floor = Math.max(existing.length * 0.3, 5);
                        if (!isBulkDeleteAllowed && value.length < floor) {
                            console.error(`[CIRCUIT BREAKER INVENTARIO] Intento de reducción anómala detectado: de ${existing.length} a ${value.length} productos. Escritura bloqueada para proteger el inventario.`);
                            throw new Error(`[CircuitBreaker] Sobrescritura anómala bloqueada: de ${existing.length} a ${value.length} productos.`);
                        }
                    }
                } catch (guardErr) {
                    if (guardErr.message?.includes('[CircuitBreaker]')) {
                        throw guardErr;
                    }
                    console.warn('[StorageGuard] Advertencia al verificar shadow snapshot:', guardErr);
                }
            }

            // ── PROTECCIÓN DE VENTAS: Anti-Shrink Circuit Breaker & Auto-Merge & Shadow Snapshot ──
            if (key === 'bodega_sales_v1' && Array.isArray(value)) {
                try {
                    const existing = await localforage.getItem('bodega_sales_v1');
                    if (Array.isArray(existing) && existing.length > 0) {
                        // 1. Shadow Snapshot periódico
                        const SHADOW_SALES_INTERVAL_MS = 15 * 60 * 1000;
                        const lastSalesShadowTs = Date.parse(localStorage.getItem('bodega_sales_shadow_backup_ts') || '') || 0;
                        if (value.length >= existing.length && Date.now() - lastSalesShadowTs > SHADOW_SALES_INTERVAL_MS) {
                            await localforage.setItem('bodega_sales_shadow_backup_v1', existing);
                            localStorage.setItem('bodega_sales_shadow_backup_ts', new Date().toISOString());
                        }

                        // 2. Circuit Breaker Anti-Encogimiento:
                        // Si se intenta guardar un array que tiene menos ventas que el existente, auto-fusionar para no perder registros
                        if (value.length < existing.length) {
                            const allowSalesShrink = localStorage.getItem('confirm_sales_purge_flag') === 'true';
                            if (!allowSalesShrink) {
                                console.warn(`[CIRCUIT BREAKER VENTAS] Intento de encogimiento detectado: de ${existing.length} a ${value.length} ventas. Auto-fusionando registros para proteger integridad.`);
                                value = mergeSalesArrays(value, existing);
                            }
                        }
                    }
                } catch (salesGuardErr) {
                    console.warn('[StorageGuard] Advertencia al verificar protección de ventas:', salesGuardErr);
                }
            }

            await localforage.setItem(key, value);
            // Anti-zombie: purgar localStorage para que el fallback nunca resucite datos viejos
            localStorage.removeItem(key);
            if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("app_storage_update", { detail: { key } }));
            }
            // Emitir a la nube silenciosamente de fondo (EGRESS-FIX: debounced,
            // ruta única — antes push directo que se duplicaba con el listener
            // de useCloudSync y no agrupaba ráfagas de ediciones).
            queueCloudSync(key, value);
        } catch (error) {
            if (_isQuotaError(error)) {
                // HOOK-007: IndexedDB lleno. Avisar a la UI y encolar para reintento.
                _dispatchQuotaExceeded(key, value, error);
                // Última esperanza: intentar localStorage (puede que IDB esté lleno pero LS no).
                try {
                    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
                    if (typeof window !== "undefined") {
                        window.dispatchEvent(new CustomEvent("app_storage_update", { detail: { key } }));
                    }
                    console.warn(`[Storage] Quota IndexedDB llena para ${key}, salvado en localStorage como contingencia.`);
                    return;
                } catch (lsErr) {
                    if (_isQuotaError(lsErr)) {
                        _dispatchQuotaExceeded(key, value, lsErr);
                    }
                    console.error(`[Storage CRÍTICO] Ni IndexedDB ni LocalStorage aceptan ${key}. Operación encolada para reintento.`, lsErr);
                    return;
                }
            }
            // Re-lanzar el Circuit Breaker para que el caller sepa que fue bloqueado
            if (error.message?.includes('[CircuitBreaker]')) {
                throw error;
            }
            console.error(`[Storage Error] Guardando ${key}:`, error);
            // Fallback de emergencia a localStorage si falla algo catastrófico
            try {
                localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
                if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("app_storage_update", { detail: { key } }));
                }
            } catch (e) {
                console.error(`[Storage Error CRÍTICO] Ni IndexedDB ni LocalStorage funcionan para ${key}`, e);
            }
        }
    },

    /**
     * Elimina un item
     */
    async removeItem(key) {
        try {
            await localforage.removeItem(key);
            localStorage.removeItem(key); // Por si acaso quedó algún residuo
        } catch (error) {
            console.error(`[Storage Error] Borrando ${key}:`, error);
        }
    },

    /**
     * Limpieza total para restauración desde backup.
     * Borra todas las claves de la app en IndexedDB y localStorage.
     * Preserva SOLO la sesión de Supabase (sb-*) para no desloguear al usuario.
     */
    async clearAllData() {
        try {
            // 1. Limpiar IndexedDB completo de la app
            await localforage.clear();
            console.log('[clearAllData] IndexedDB limpiado.');

            // 2. Limpiar claves de app en localStorage (preservando sesión de auth)
            const appLsKeys = [
                'street_rate_bs', 'catalog_use_auto_usdt', 'catalog_custom_usdt_price',
                'catalog_show_cash_price', 'monitor_rates_v12', 'business_name', 'business_rif',
                'printer_paper_width', 'allow_negative_stock', 'cop_enabled', 'auto_cop_enabled',
                'tasa_cop', 'bodega_use_auto_rate', 'bodega_custom_rate', 'bodega_inventory_view',
                'premium_token', 'abasto-auth-storage',
            ];
            for (const key of appLsKeys) {
                localStorage.removeItem(key);
            }
            console.log('[clearAllData] LocalStorage de la app limpiado.');

            // HOOK-007: tras limpiar, flush de la cola de reintentos por si había ops pendientes.
            _flushRetryQueue();
        } catch (error) {
            console.error('[Storage Error] Limpiando todo:', error);
            throw error; // Propagar para que el importador aborte si falla la limpieza
        }
    },

    /**
     * Devuelve (copia) el estado actual de la cola de reintentos por QuotaExceeded.
     * Útil para diagnóstico en UI.
     * @returns {Array<{ key: string, attempts: number }>}
     */
    getPendingRetries() {
        return _retryQueue.map(({ key, attempts }) => ({ key, attempts }));
    },

    /**
     * Reintenta manualmente todas las operaciones encoladas. Devuelve el número
     * de ops que se lograron persistir.
     */
    async flushRetries() {
        return _flushRetryQueue();
    },
};

// ─── Helpers internos (HOOK-007) ─────────────────────────────────────────

function _isQuotaError(err) {
    if (!err) return false;
    if (err.name === 'QuotaExceededError') return true;
    if (err.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true; // Firefox
    if (err.code === 22 || err.code === 1014) return true; // Legacy codes
    if (typeof err.message === 'string' && /quota/i.test(err.message)) return true;
    return false;
}

function _dispatchQuotaExceeded(key, value, originalError) {
    // Encolar para reintento
    _retryQueue.push({ key, value, attempts: 0 });
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('quota_exceeded', {
            detail: {
                key,
                queueLength: _retryQueue.length,
                message: originalError?.message || 'QuotaExceededError',
            },
        }));
    }
}

async function _flushRetryQueue() {
    let flushed = 0;
    while (_retryQueue.length > 0) {
        const op = _retryQueue[0];
        if (op.attempts >= QUOTA_RETRY_MAX) {
            _retryQueue.shift();
            console.warn(`[Storage] Descartando op encolada para ${op.key} tras ${QUOTA_RETRY_MAX} intentos.`);
            continue;
        }
        op.attempts++;
        try {
            await localforage.setItem(op.key, op.value);
            _retryQueue.shift();
            flushed++;
        } catch (err) {
            if (_isQuotaError(err)) {
                // Aún sin espacio; dejar en cola y parar el flush.
                break;
            }
            // Error no relacionado con cuota: descartar para no reintentar indefinidamente.
            _retryQueue.shift();
            console.error(`[Storage] Error no-cuota reintentando ${op.key}:`, err);
        }
    }
    return flushed;
}

export default storageService;
