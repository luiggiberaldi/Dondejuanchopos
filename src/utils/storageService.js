import { localStore } from './localStore';
import { queueCloudSync } from '../hooks/useCloudSync';
import { mergeSalesArrays } from './salesMerge';
import { isSyncingFromCloud } from './syncFlags';
export { StorageWriteError } from './localStore';

/**
 * Fachada de negocio: guardias, eventos y sync explícito después del commit.
 * localStore conserva el contrato físico común con monitor/import/recuperación.
 * Los callers read-modify-write deben seguir usando pos_write_lock: la cola
 * local NO aporta atomicidad multiclave ni coordinación entre pestañas.
 */
export const storageService = {
    transaction(callback) {
        const suppressSync = isSyncingFromCloud();
        return localStore.transaction(callback, {
            prepare: prepareWrite,
            onCommitted: (key, value) => notifyPersisted(key, value, !suppressSync),
        });
    },
    recoverTransactions: () => localStore.recoverTransactions(),
    getItem(key, defaultValue = null) {
        // Compatibilidad de UI; los lectores de sync usan el núcleo estricto.
        return localStore.getItem(key, defaultValue, { tolerant: true });
    },

    setItem(key, value) {
        // El origen silencioso pertenece a la operación, también si su fallback
        // se migra después de que runWithoutEco haya terminado.
        const suppressSync = isSyncingFromCloud();
        return localStore.setItem(key, value, {
            allowFallback: true,
            prepare: (incoming, io) => prepareWrite(key, incoming, io),
            onPersisted: (savedKey, savedValue, primary) => notifyPersisted(savedKey, savedValue, primary && !suppressSync),
            onFallback: (failedKey, error, primaryError) => {
                if (isQuotaError(error) || isQuotaError(primaryError)) dispatchQuotaExceeded(failedKey, error);
            },
        });
    },

    removeItem(key) {
        // No ocultar una eliminación parcial a importadores/recuperación.
        return localStore.removeItem(key);
    },

    clearAllData() {
        // Mantiene la sesión sb-*; el núcleo incluye fallbacks de IDB_KEYS y
        // los de la sesión actual. No se ejecuta desde una simple lectura.
        return localStore.clear({ localKeys: [
            'street_rate_bs', 'catalog_use_auto_usdt', 'catalog_custom_usdt_price',
            'catalog_show_cash_price', 'monitor_rates_v12', 'business_name', 'business_rif',
            'printer_paper_width', 'allow_negative_stock', 'cop_enabled', 'auto_cop_enabled',
            'tasa_cop', 'bodega_use_auto_rate', 'bodega_custom_rate', 'bodega_inventory_view',
            'premium_token', 'abasto-auth-storage',
        ] });
    },
    getPendingRetries: () => localStore.getPendingRetries(),
    flushRetries: () => localStore.flushRetries(),
};

function markShadowSaved(io, key) {
    const timestamp = new Date().toISOString();
    const persist = () => localStorage.setItem(key, timestamp);
    // Preparar un snapshot no significa guardarlo: no adelantar su reloj si
    // la operación de negocio se aborta antes del commit durable.
    if (io.afterCommit) io.afterCommit(persist);
    else persist();
}

async function prepareWrite(key, value, io) {
    // Lecturas internas no encoladas: la guardia ya posee la cola de la clave.
    if (key === 'bodega_products_v1' && Array.isArray(value)) {
        try {
            const existing = await io.getItem(key);
            if (Array.isArray(existing) && existing.length > 5) {
                const lastTs = Date.parse(localStorage.getItem('bodega_shadow_backup_ts') || '') || 0;
                const shrinks = value.length < existing.length;
                if (!shrinks && Date.now() - lastTs > 30 * 60 * 1000) {
                    await io.setPrimaryItem('bodega_products_shadow_backup_v1', existing);
                    markShadowSaved(io, 'bodega_shadow_backup_ts');
                }
                const flagRaw = localStorage.getItem('confirm_bulk_delete_catalog_flag');
                const flagTs = parseInt(localStorage.getItem('confirm_bulk_delete_catalog_ts') || '0', 10);
                const isBulkDeleteAllowed = flagRaw === 'true' && (flagTs === 0 || Date.now() - flagTs < 60000);
                const floor = Math.max(existing.length * 0.3, 5);
                if (!isBulkDeleteAllowed && value.length < floor) {
                    throw new Error(`[CircuitBreaker] Sobrescritura anómala bloqueada: de ${existing.length} a ${value.length} productos.`);
                }
            }
        } catch (error) {
            if (error.message?.includes('[CircuitBreaker]') || error.code === 'STORAGE_READ_FAILED') throw error;
            console.warn('[StorageGuard] Advertencia al verificar shadow snapshot:', error);
        }
    }

    if (key === 'bodega_sales_v1' && Array.isArray(value)) {
        try {
            const existing = await io.getItem(key);
            if (Array.isArray(existing) && existing.length > 0) {
                const lastTs = Date.parse(localStorage.getItem('bodega_sales_shadow_backup_ts') || '') || 0;
                if (value.length >= existing.length && Date.now() - lastTs > 15 * 60 * 1000) {
                    await io.setPrimaryItem('bodega_sales_shadow_backup_v1', existing);
                    markShadowSaved(io, 'bodega_sales_shadow_backup_ts');
                }
                const existingCierres = existing.filter(s => s && s.tipo === 'REGISTRO_CIERRE').length;
                const incomingCierres = value.filter(s => s && s.tipo === 'REGISTRO_CIERRE').length;
                if ((existingCierres > 0 && incomingCierres < existingCierres) || value.length < existing.length) {
                    const allow = localStorage.getItem('confirm_sales_purge_flag') === 'true';
                    const isMonitor = localStorage.getItem('dj_pairing_mode') === 'monitor';
                    if (!allow && !isMonitor) value = mergeSalesArrays(value, existing);
                }
            } else {
                const shadow = await io.getItem('bodega_sales_shadow_backup_v1');
                if (Array.isArray(shadow) && shadow.length > value.length
                    && localStorage.getItem('confirm_sales_purge_flag') !== 'true') {
                    value = mergeSalesArrays(value, shadow);
                }
            }
        } catch (error) {
            if (error.code === 'STORAGE_READ_FAILED') throw error;
            console.warn('[StorageGuard] Advertencia al verificar protección de ventas:', error);
        }
    }

    if (key === 'bodega_customers_v1' && Array.isArray(value)) {
        try {
            const existing = await io.getItem(key);
            if (Array.isArray(existing) && existing.length > 3) {
                const lastTs = Date.parse(localStorage.getItem('bodega_customers_shadow_backup_ts') || '') || 0;
                const shrinks = value.length < existing.length;
                if (!shrinks && Date.now() - lastTs > 30 * 60 * 1000) {
                    await io.setPrimaryItem('bodega_customers_shadow_backup_v1', existing);
                    markShadowSaved(io, 'bodega_customers_shadow_backup_ts');
                }
                const allow = localStorage.getItem('confirm_customers_purge_flag') === 'true';
                // Conteo de clientes, no redondeo de dinero.
                // eslint-disable-next-line no-restricted-syntax
                const floor = Math.max(Math.floor(existing.length * 0.5), 1);
                if (!allow && value.length < floor) {
                    throw new Error(`[CircuitBreaker] Sobrescritura anómala bloqueada: de ${existing.length} a ${value.length} clientes.`);
                }
            }
        } catch (error) {
            if (error.message?.includes('[CircuitBreaker]') || error.code === 'STORAGE_READ_FAILED') throw error;
            console.warn('[StorageGuard] Advertencia al verificar protección de clientes:', error);
        }
    }
    return value;
}

function notifyPersisted(key, value, sync) {
    try {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key } }));
    } catch (error) { console.warn('[Storage] Notificación posterior al guardado falló:', error); }
    if (sync) {
        try { queueCloudSync(key, value); } catch (error) {
            console.warn('[Storage] Guardado local confirmado; cola cloud no disponible:', error);
        }
    }
}
function isQuotaError(error) {
    return Boolean(error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
        || error.code === 22 || error.code === 1014 || /quota/i.test(error.message || '')));
}
function dispatchQuotaExceeded(key, error) {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('quota_exceeded', {
        detail: { key, queueLength: localStore.getPendingRetries().length, message: error?.message || 'QuotaExceededError' },
    }));
}

export default storageService;
