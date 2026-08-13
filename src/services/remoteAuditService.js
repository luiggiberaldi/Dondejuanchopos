import { supabaseCloud } from '../config/supabaseCloud';
import { IDB_KEYS, LS_KEYS } from '../config/backupKeys';

const REMOTE_BACKUP_EXCLUDED_KEYS = Object.freeze([
    'premium_token',
]);

export const REMOTE_KARDEX_DOC_IDS = Object.freeze([
    'bodega_products_v1',
    'bodega_kardex_v1',
    'bodega_kardex_snapshots_v1',
    'bodega_inventory_operations_v1',
]);

export const REMOTE_AUDIT_DOC_IDS = Object.freeze([
    ...REMOTE_KARDEX_DOC_IDS,
    'bodega_sales_v1',
]);

export const REMOTE_BACKUP_DOC_IDS = Object.freeze([
    ...IDB_KEYS,
    ...LS_KEYS.filter(key => !REMOTE_BACKUP_EXCLUDED_KEYS.includes(key)),
]);

// Documentos que el monitor necesita para su vista operativa. Se leen por el
// mismo RPC protegido, pero no forman parte del backup v2 canónico.
export const REMOTE_MONITOR_DOC_IDS = Object.freeze([
    'bodega_products_v1',
    'bodega_sales_v1',
    'bodega_customers_v1',
    'bodega_suppliers_v1',
    'bodega_supplier_invoices_v1',
    'bodega_accounts_v2',
    'bodega_payment_methods_v1',
    'bodega_pending_cart_v1',
    'my_categories_v1',
    'bodega_rate_mode',
    'bodega_users_catalog_v1',
    'business_name',
    'business_rif',
    'bodega_custom_rate',
    'street_rate_bs',
    'monitor_rates_v12',
    'tasa_cop',
    'cop_enabled',
    'cop_primary',
    'auto_cop_enabled',
    'bodega_use_auto_rate',
]);

export const REMOTE_READABLE_DOC_IDS = Object.freeze([
    ...new Set([...REMOTE_BACKUP_DOC_IDS, ...REMOTE_MONITOR_DOC_IDS]),
]);

const REMOTE_BACKUP_CRITICAL_DOC_IDS = Object.freeze([
    'bodega_products_v1',
    'bodega_sales_v1',
    'bodega_kardex_v1',
    'bodega_inventory_operations_v1',
]);

function getLocalStorageValue(key) {
    const storage = typeof globalThis !== 'undefined' ? globalThis.localStorage : null;
    if (!storage || typeof storage.getItem !== 'function') return null;
    return storage.getItem(key);
}

function getPairedDeviceId() {
    return getLocalStorageValue('dj_paired_device_id');
}

function getMonitorDeviceId() {
    return getLocalStorageValue('dj_device_id');
}

function errorResult(code, message, extra = {}) {
    return {
        success: false,
        error: { code, message },
        ...extra,
    };
}

function normalizeDocIds(docIds, allowedDocIds) {
    if (!Array.isArray(docIds) || docIds.length === 0) {
        return errorResult('REMOTE_DOC_IDS_REQUIRED', 'Debe solicitarse al menos un documento.');
    }

    const requested = [...new Set(docIds)];
    const allowed = new Set(allowedDocIds);
    const invalid = requested.filter(docId => !allowed.has(docId));
    if (invalid.length > 0) {
        return errorResult(
            'REMOTE_DOC_ID_NOT_ALLOWED',
            `Documentos no permitidos: ${invalid.join(', ')}`,
            { invalidDocIds: invalid },
        );
    }

    return { success: true, docIds: requested };
}

function validateDeviceScope(deviceId) {
    if (typeof deviceId !== 'string' || deviceId.trim() === '') {
        return errorResult('REMOTE_DEVICE_ID_REQUIRED', 'El device_id de la caja es requerido.');
    }

    const pairedDeviceId = getPairedDeviceId();
    if (!pairedDeviceId || pairedDeviceId !== deviceId) {
        return errorResult(
            'REMOTE_DEVICE_SCOPE_MISMATCH',
            'La caja solicitada no coincide con el dispositivo emparejado.',
        );
    }

    return { success: true };
}

function getPayload(row) {
    return row?.data && Object.prototype.hasOwnProperty.call(row.data, 'payload')
        ? row.data.payload
        : null;
}

function maxUpdatedAt(documents) {
    return documents.reduce((max, document) => {
        const timestamp = document?.updated_at ? new Date(document.updated_at).getTime() : 0;
        return timestamp > max ? timestamp : max;
    }, 0);
}

/**
 * Lee documentos de una caja emparejada solo cuando el Supervisor lo solicita.
 * No persiste el resultado, no publica cambios y no abre una suscripción Realtime.
 */
export async function fetchRemoteDocuments(
    deviceId,
    docIds,
    client = supabaseCloud,
    { updatedAfter = null } = {},
) {
    const scope = validateDeviceScope(deviceId);
    if (!scope.success) return scope;

    const normalized = normalizeDocIds(docIds, REMOTE_READABLE_DOC_IDS);
    if (!normalized.success) return normalized;

    if (!client) {
        return errorResult('REMOTE_CLOUD_UNAVAILABLE', 'La conexión Cloud no está configurada.');
    }

    const monitorDeviceId = getMonitorDeviceId();
    if (!monitorDeviceId) {
        return errorResult('REMOTE_MONITOR_ID_REQUIRED', 'El dispositivo Supervisor no está identificado.');
    }

    try {
        const { data, error } = await client.rpc('read_paired_audit_documents', {
            p_primary_device_id: deviceId,
            p_monitor_device_id: monitorDeviceId,
            p_doc_ids: normalized.docIds,
            p_updated_after: updatedAfter,
        });

        if (error) {
            return errorResult(
                error.code || (error.status ? `HTTP_${error.status}` : 'REMOTE_QUERY_FAILED'),
                error.message || 'No se pudieron leer los documentos remotos.',
            );
        }

        const documents = (Array.isArray(data) ? data : [])
            .filter(row => row?.doc_id && row.data != null)
            .map(row => ({
                collection: row.collection,
                doc_id: row.doc_id,
                payload: getPayload(row),
                updated_at: row.updated_at || null,
            }));

        const receivedIds = new Set(documents.map(document => document.doc_id));
        const missingDocIds = normalized.docIds.filter(docId => !receivedIds.has(docId));
        const latest = maxUpdatedAt(documents);

        return {
            success: true,
            deviceId,
            documents,
            missingDocIds,
            maxUpdatedAt: latest > 0 ? new Date(latest).toISOString() : null,
        };
    } catch (error) {
        return errorResult(
            'REMOTE_QUERY_EXCEPTION',
            error?.message || 'Error inesperado leyendo documentos remotos.',
        );
    }
}

export async function fetchRemoteKardex(deviceId, client = supabaseCloud) {
    return fetchRemoteDocuments(deviceId, REMOTE_KARDEX_DOC_IDS, client);
}

export async function fetchRemoteInventoryAudit(deviceId, client = supabaseCloud) {
    return fetchRemoteDocuments(deviceId, REMOTE_AUDIT_DOC_IDS, client);
}

function serializeLocalValue(value) {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * Convierte la lectura remota a backup v2 sin escribir en storage ni en Supabase.
 */
export function buildRemoteBackup(deviceId, documents, generatedAt = new Date().toISOString()) {
    if (typeof deviceId !== 'string' || deviceId.trim() === '') {
        throw new Error('El device_id de origen es requerido para el backup.');
    }

    const idb = {};
    const ls = {};
    const receivedIds = new Set();

    for (const document of Array.isArray(documents) ? documents : []) {
        const docId = document?.doc_id;
        if (!REMOTE_BACKUP_DOC_IDS.includes(docId)) continue;
        if (REMOTE_BACKUP_EXCLUDED_KEYS.includes(docId)) continue;

        receivedIds.add(docId);
        if (document.collection === 'local') {
            ls[docId] = serializeLocalValue(document.payload);
        } else {
            idb[docId] = document.payload;
        }
    }

    const missingDocIds = REMOTE_BACKUP_DOC_IDS.filter(docId => !receivedIds.has(docId));
    const missingCriticalDocIds = REMOTE_BACKUP_CRITICAL_DOC_IDS.filter(docId => !receivedIds.has(docId));

    return {
        timestamp: generatedAt,
        version: '2.0',
        appName: 'TasasAlDia_Bodegas_Cloud',
        source: 'supervisor_remote_read',
        sourceDeviceId: deviceId,
        data: { idb, ls },
        metadata: {
            missingDocIds,
            missingCriticalDocIds,
            isComplete: missingDocIds.length === 0,
        },
    };
}

export function extractRemoteKardexData(documents) {
    const result = {
        products: [],
        sales: [],
        kardex: [],
        snapshots: [],
        operations: [],
        missingDocIds: [],
    };

    const byId = new Map((documents || []).map(document => [document.doc_id, document.payload]));
    if (Array.isArray(byId.get('bodega_products_v1'))) result.products = byId.get('bodega_products_v1');
    if (Array.isArray(byId.get('bodega_sales_v1'))) result.sales = byId.get('bodega_sales_v1');
    if (Array.isArray(byId.get('bodega_kardex_v1'))) result.kardex = byId.get('bodega_kardex_v1');
    if (Array.isArray(byId.get('bodega_kardex_snapshots_v1'))) result.snapshots = byId.get('bodega_kardex_snapshots_v1');
    if (Array.isArray(byId.get('bodega_inventory_operations_v1'))) result.operations = byId.get('bodega_inventory_operations_v1');

    for (const docId of REMOTE_KARDEX_DOC_IDS) {
        if (!byId.has(docId)) result.missingDocIds.push(docId);
    }

    return result;
}
