# Fix Definitivo — Sincronización Delta de Ventas/Cierres y Blindaje Anti-Timeout (v1.2.0)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminar de raíz los retrasos de 5 minutos y fallos de subida al cerrar caja (como el cierre #100 del 21-11-2026) reemplazando la transferencia de ~10.2 MB por operación en `bodega_sales_v1` por un RPC delta atómico (~2 KB por venta / ~35 KB por cierre) con `SET statement_timeout = '30s'`, UX honesta de confirmación en el modal de cierre, y compactación segura de payloads cloud.

**Architecture:**
1. **Capa SQL (`supabase_sales_delta_and_timeouts_setup.sql`):** Eleva `statement_timeout = '30s'` en todos los RPCs de documentos/backups (eliminando cortes de 3 s del rol `anon`) e introduce `public.upsert_paired_sales_delta(p_device_id, p_records)` con bloqueo `FOR UPDATE` sobre `sync_documents` que fusiona solo los registros modificados aplicando exactamente las 5 Reglas de Oro de `salesMerge.js` + Invariante I5 directamente en PostgreSQL (sin descargar 5.32 MB ni subir 4.88 MB).
2. **Capa POS (`salesDeltaSync.js` + `useCloudSync.js` + `DashboardView.jsx` + `CierreCajaSummaryModal.jsx`):** Rastrea huellas locales de ventas ya confirmadas en nube (`bodega_sales_sync_fingerprints_v1`), envía solo el delta (2–60 KB) con fallback transparente a `write_paired_sync_document` si el RPC no existe o el documento base falta, elimina el doble-push al guardar el cierre (`skipCloudSync: true`), y cambia el modal de cierre para no mostrar check verde hasta la confirmación real en la nube (con auto-reintento cada 10 s ante fallos transitorios).
3. **Capa Higiene Cloud (opcional/Fase 4):** Activa la compactación ya existente de `bodega_kardex_v1` (`2.88 MB → 0.93 MB`, `-68%`) y limpia campos internos redundantes en ventas cerradas antiguas (>30 días) de `bodega_sales_v1` (`4.88 MB → ~3.19 MB`) sin tocar jamás `VENTA_FIADA`, `COBRO_DEUDA`, `REGISTRO_CIERRE` ni el IndexedDB local.

**Tech Stack:** PostgreSQL / Supabase RPC (`SECURITY DEFINER`, `JSONB`), React + Vite PWA, IndexedDB (`localStore`), Vitest (`npx vitest run`).

**Dispositivo central de producción (`.agents/AGENTS.md`):** `PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F` (Doc 60: 2.186 registros, 4.88 MB al 22-11-2026).

---

## Diagnóstico Verificado en Producción (21–22/11/2026)

| Hallazgo | Evidencia medida en Supabase | Impacto |
|---|---|---|
| **Timeout de 3 s en RPCs `anon`** | Venta `#1926` (`23:53:25`) subió `products` en 9 s, `kardex` (`2.88 MB`) en **1m 46s**, y `bodega_sales_v1` (`4.88 MB`) en **4m 56s** (`23:58:21`). `supervisor_commands` ya registró `canceling statement due to statement timeout`. | Cada escritura de 5 MB JSONB choca con el `statement_timeout` de `anon` (~3 s) y entra en backoff exponencial. |
| **Transferencia de ~10.2 MB por cierre/venta** | Con `dj_sales_push_merge_v1`, cada push descarga **5.32 MB** (`read_paired_audit_documents`) y sube **4.88 MB** (`write_paired_sync_document`) incluso para 1 venta (2 KB) o 1 cierre (35 KB). | 300× más tráfico del necesario; en los 52 s antes de apagar la PC (`23:58:21` → `23:59:13`), el cierre #100 no alcanzó a subir. |
| **Doble push en `handleConfirmCashRecon`** | `storageService.setItem(SALES_KEY)` agenda `_debouncePush` (300 ms) antes de escribir el espejo de 5 MB en IndexedDB; `pushCriticalCloudSync` luego aborta ese push ordinario. | Tráfico desperdiciado y riesgo de contención en la cola serializada justo al cerrar caja. |
| **Falsa sensación de completado en modal** | `CierreCajaSummaryModal` muestra header verde `"✅ Cierre Completado"` aunque `syncStatus` sea `'syncing'` o `'failed'`; tras 3 fallos rápidos no reintenta hasta el tick de 60 s. | El cajero imprime el ticket y apaga Windows antes de que la nube confirme el cierre. |
| **Crecimiento hacia tope de 8 MB** | `bodega_sales_v1` = `4.88 MB` (+1.22 MB/mes) y `bodega_kardex_v1` = `2.88 MB`. | En ~2.5 meses `bodega_sales_v1` golpeará el muro de 8 MB si no se compacta y amplía el techo SQL. |

---

## Orden Estricto de Despliegue

1. **Task 1 (SQL en Supabase — aplicar PRIMERO en SQL Editor):** `supabase_sales_delta_and_timeouts_setup.sql`. 100% aditivo e idempotente; la PWA `v1.1.9` sigue funcionando igual pero sin cortes de 3 s.
2. **Task 2 (Pure helper + TDD):** `src/utils/salesDeltaSync.js` + `tests/salesDeltaSync.test.js`.
3. **Task 3 (Motor de sync delta + fallback):** `src/hooks/useCloudSync.js` + `tests/salesDeltaCloudSync.test.js`.
4. **Task 4 (Cierre sin doble-push + UX honesta + auto-reintento 10 s):** `src/utils/storageService.js`, `src/views/DashboardView.jsx`, `src/components/Dashboard/CierreCajaSummaryModal.jsx` + tests.
5. **Task 5 (Compactación cloud segura de Kardex y ventas antiguas):** `src/utils/salesCompactor.js`, `src/hooks/useCloudSync.js`, `tests/egressHashOwnership.test.js`, `tests/salesCompactor.test.js`.
6. **Task 6 (Bump `v1.2.0`, suite completa, deploy y verificación en producción).**

---

### Task 1: Migración SQL — `statement_timeout = 30s` + RPC `upsert_paired_sales_delta`

**Files:**
- Create: `supabase_sales_delta_and_timeouts_setup.sql`
- Modify: `supabase_remote_audit_setup.sql` (mantener sincronizado el script canónico con `SET statement_timeout = '30s'`)

**Step 1: Crear el script SQL idempotente `supabase_sales_delta_and_timeouts_setup.sql`**

```sql
-- =============================================================================
-- Fix Definitivo — Timeouts seguros (30s) + RPC Delta de Ventas (v1.2.0)
-- Proyecto Supabase Cloud/Sync: kcananrtcmckovdstvao.supabase.co
--
-- Ejecutar manualmente en el SQL Editor ANTES de desplegar v1.2.0.
-- Script 100% idempotente y retrocompatible con v1.1.9.
-- =============================================================================

-- 1. Elevar statement_timeout a 30s en RPCs que leen/escriben documentos grandes
--    (evita el timeout por defecto de ~3s del rol `anon` en payloads JSONB de 3–5 MB).
ALTER FUNCTION public.read_paired_audit_documents(TEXT, TEXT, TEXT[], TIMESTAMPTZ)
    SET statement_timeout = '30s';

ALTER FUNCTION public.write_paired_sync_document(TEXT, TEXT, TEXT, JSONB)
    SET statement_timeout = '30s';

ALTER FUNCTION public.write_paired_cloud_backup(TEXT, UUID, JSONB)
    SET statement_timeout = '30s';

ALTER FUNCTION public.read_paired_cloud_backup(TEXT, TEXT, TIMESTAMPTZ)
    SET statement_timeout = '30s';

-- 2. Ampliar techo de seguridad en write_paired_sync_document a 16 MB (mientras el
--    cliente mantiene la compactación objetivo < 4 MB). Misma validación y whitelist.
CREATE OR REPLACE FUNCTION public.write_paired_sync_document(
    p_device_id TEXT,
    p_collection TEXT,
    p_doc_id TEXT,
    p_data JSONB
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
BEGIN
    IF COALESCE(btrim(p_device_id), '') = ''
        OR p_collection IS NULL
        OR p_doc_id IS NULL
        OR p_data IS NULL THEN
        RAISE EXCEPTION 'POS_SYNC_SCOPE_REQUIRED';
    END IF;

    IF p_collection NOT IN ('store', 'local') THEN
        RAISE EXCEPTION 'POS_SYNC_COLLECTION_NOT_ALLOWED';
    END IF;

    IF jsonb_typeof(p_data) <> 'object' THEN
        RAISE EXCEPTION 'POS_SYNC_DATA_OBJECT_REQUIRED';
    END IF;

    -- Techo de emergencia ampliado a 16 MB para evitar bloqueo operativo por crecimiento.
    IF octet_length(p_data::text) > 16777216 THEN
        RAISE EXCEPTION 'POS_SYNC_DOCUMENT_TOO_LARGE';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.device_pairings pairing
        WHERE pairing.primary_device_id = btrim(p_device_id)
    ) THEN
        RAISE EXCEPTION 'POS_SYNC_DEVICE_NOT_REGISTERED';
    END IF;

    IF (
        p_collection = 'store'
        AND p_doc_id NOT IN (
            'bodega_accounts_v2',
            'bodega_customers_v1',
            'bodega_kardex_snapshots_v1',
            'bodega_kardex_v1',
            'bodega_inventory_operations_v1',
            'bodega_employee_consumptions_v1',
            'bodega_employee_payroll_projection_v1',
            'bodega_employees_v1',
            'bodega_payroll_periods_v1',
            'bodega_payroll_settlements_v1',
            'bodega_payment_methods_v1',
            'bodega_pending_cart_v1',
            'bodega_products_v1',
            'bodega_sales_v1',
            'bodega_supplier_invoices_v1',
            'bodega_suppliers_v1',
            'my_categories_v1'
        )
    ) OR (
        p_collection = 'local'
        AND p_doc_id NOT IN (
            'allow_negative_stock',
            'auto_cop_enabled',
            'bodega_custom_rate',
            'bodega_inventory_view',
            'bodega_rate_mode',
            'bodega_use_auto_rate',
            'bodega_users_catalog_v1',
            'business_name',
            'business_rif',
            'catalog_custom_usdt_price',
            'catalog_show_cash_price',
            'catalog_use_auto_usdt',
            'cop_enabled',
            'cop_primary',
            'dj_granel_enabled',
            'monitor_rates_v12',
            'printer_paper_width',
            'street_rate_bs',
            'tasa_cop'
        )
    ) THEN
        RAISE EXCEPTION 'POS_SYNC_DOCUMENT_NOT_ALLOWED';
    END IF;

    INSERT INTO public.sync_documents (device_id, collection, doc_id, data)
    VALUES (btrim(p_device_id), p_collection, p_doc_id, p_data)
    ON CONFLICT (device_id, collection, doc_id)
    DO UPDATE SET data = EXCLUDED.data, updated_at = now();

    RETURN json_build_object(
        'success', true,
        'device_id', btrim(p_device_id),
        'collection', p_collection,
        'doc_id', p_doc_id
    );
END;
$$;

-- 3. Helper puro de fusión de un registro individual (espeja salesMerge.js + Invariante I5)
CREATE OR REPLACE FUNCTION public.merge_single_sale_jsonb(
    p_cloud JSONB,
    p_incoming JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    v_cloud_ts TIMESTAMPTZ;
    v_in_ts TIMESTAMPTZ;
    v_base JSONB;
    v_cloud_closed BOOLEAN;
    v_in_closed BOOLEAN;
    v_resolved_cierre_id JSONB;
    v_resolved_cierre_num JSONB;
    v_is_closed BOOLEAN;
BEGIN
    IF p_cloud IS NULL THEN RETURN p_incoming; END IF;
    IF p_incoming IS NULL THEN RETURN p_cloud; END IF;

    -- Parseo defensivo de timestamps ISO
    BEGIN
        v_cloud_ts := COALESCE(NULLIF(p_cloud->>'updatedAt', ''), NULLIF(p_cloud->>'timestamp', ''), NULLIF(p_cloud->>'createdAt', ''))::timestamptz;
    EXCEPTION WHEN others THEN v_cloud_ts := '-infinity'::timestamptz;
    END;
    BEGIN
        v_in_ts := COALESCE(NULLIF(p_incoming->>'updatedAt', ''), NULLIF(p_incoming->>'timestamp', ''), NULLIF(p_incoming->>'createdAt', ''))::timestamptz;
    EXCEPTION WHEN others THEN v_in_ts := '-infinity'::timestamptz;
    END;

    -- Regla de Oro 5 + Invariante I5: REGISTRO_CIERRE existente en la nube es inmutable
    -- salvo corrección estrictamente posterior (updatedAt/timestamp > nube).
    IF p_cloud->>'tipo' = 'REGISTRO_CIERRE' OR p_incoming->>'tipo' = 'REGISTRO_CIERRE' THEN
        IF p_cloud->>'tipo' = 'REGISTRO_CIERRE' AND NOT (v_in_ts > v_cloud_ts) THEN
            v_base := p_cloud;
        ELSE
            v_base := p_cloud || p_incoming;
        END IF;
        v_base := v_base || jsonb_build_object(
            'tipo', 'REGISTRO_CIERRE',
            'cajaCerrada', true,
            'summary', COALESCE(p_cloud->'summary', p_incoming->'summary', v_base->'summary'),
            'cierreNumber', COALESCE(p_cloud->'cierreNumber', p_incoming->'cierreNumber', v_base->'cierreNumber'),
            'cierreId', COALESCE(p_cloud->'cierreId', p_incoming->'cierreId', p_cloud->'id', p_incoming->'id')
        );
        RETURN v_base;
    END IF;

    v_cloud_closed := COALESCE((p_cloud->>'cajaCerrada')::boolean, false)
        OR COALESCE(NULLIF(p_cloud->>'cierreId', ''), '') <> '';
    v_in_closed := COALESCE((p_incoming->>'cajaCerrada')::boolean, false)
        OR COALESCE(NULLIF(p_incoming->>'cierreId', ''), '') <> '';

    -- Invariante I5: en empate de timestamp gana LA NUBE (p_cloud), salvo que
    -- incoming aporte sellado nuevo o anulación nueva.
    IF v_in_ts > v_cloud_ts
       OR (v_in_closed AND NOT v_cloud_closed)
       OR (p_incoming->>'status' = 'ANULADA' AND COALESCE(p_cloud->>'status', '') <> 'ANULADA') THEN
        v_base := p_cloud || p_incoming;
    ELSE
        v_base := p_incoming || p_cloud;
    END IF;

    -- Regla de Oro 1: Preservación indestructible de cierreId / cajaCerrada
    v_resolved_cierre_id := CASE
        WHEN COALESCE(NULLIF(p_cloud->>'cierreId', ''), '') <> '' THEN p_cloud->'cierreId'
        WHEN COALESCE(NULLIF(p_incoming->>'cierreId', ''), '') <> '' THEN p_incoming->'cierreId'
        ELSE NULL
    END;
    v_resolved_cierre_num := CASE
        WHEN COALESCE(NULLIF(p_cloud->>'cierreNumber', ''), '') <> '' THEN p_cloud->'cierreNumber'
        WHEN COALESCE(NULLIF(p_incoming->>'cierreNumber', ''), '') <> '' THEN p_incoming->'cierreNumber'
        ELSE NULL
    END;
    v_is_closed := v_cloud_closed OR v_in_closed OR (v_resolved_cierre_id IS NOT NULL);

    IF v_is_closed THEN
        v_base := v_base || jsonb_build_object('cajaCerrada', true);
        IF v_resolved_cierre_id IS NOT NULL THEN
            v_base := v_base || jsonb_build_object('cierreId', v_resolved_cierre_id);
        END IF;
        IF v_resolved_cierre_num IS NOT NULL THEN
            v_base := v_base || jsonb_build_object('cierreNumber', v_resolved_cierre_num);
        END IF;
    END IF;

    -- Regla de Oro 2: Si fue ANULADA en cualquiera de los lados, se preserva ANULADA
    IF p_cloud->>'status' = 'ANULADA' OR p_incoming->>'status' = 'ANULADA' THEN
        v_base := v_base || jsonb_build_object('status', 'ANULADA');
        IF COALESCE(p_cloud->'anuladaAt', p_incoming->'anuladaAt') IS NOT NULL THEN
            v_base := v_base || jsonb_build_object('anuladaAt', COALESCE(p_cloud->'anuladaAt', p_incoming->'anuladaAt'));
        END IF;
        IF COALESCE(p_cloud->'anuladaPor', p_incoming->'anuladaPor') IS NOT NULL THEN
            v_base := v_base || jsonb_build_object('anuladaPor', COALESCE(p_cloud->'anuladaPor', p_incoming->'anuladaPor'));
        END IF;
        IF COALESCE(p_cloud->'motivoAnulacion', p_incoming->'motivoAnulacion') IS NOT NULL THEN
            v_base := v_base || jsonb_build_object('motivoAnulacion', COALESCE(p_cloud->'motivoAnulacion', p_incoming->'motivoAnulacion'));
        END IF;
    END IF;

    -- Reglas de Oro 3 y 4: Preservar deducciones e IDs de operación
    IF jsonb_typeof(p_cloud->'inventoryDeductionsApplied') = 'array'
       AND jsonb_array_length(p_cloud->'inventoryDeductionsApplied') > 0
       AND (jsonb_typeof(v_base->'inventoryDeductionsApplied') <> 'array'
            OR jsonb_array_length(v_base->'inventoryDeductionsApplied') = 0) THEN
        v_base := v_base || jsonb_build_object('inventoryDeductionsApplied', p_cloud->'inventoryDeductionsApplied');
    END IF;
    IF COALESCE(v_base->>'checkoutOperationId', '') = '' AND COALESCE(p_cloud->>'checkoutOperationId', '') <> '' THEN
        v_base := v_base || jsonb_build_object('checkoutOperationId', p_cloud->'checkoutOperationId');
    END IF;
    IF COALESCE(v_base->>'inventoryOperationId', '') = '' AND COALESCE(p_cloud->>'inventoryOperationId', '') <> '' THEN
        v_base := v_base || jsonb_build_object('inventoryOperationId', p_cloud->'inventoryOperationId');
    END IF;

    RETURN v_base;
END;
$$;

-- 4. RPC Atómico Delta de Ventas: recibe solo los registros nuevos/modificados (2–60 KB)
--    y los fusiona por `id` en sync_documents (`bodega_sales_v1`) bajo lock FOR UPDATE.
CREATE OR REPLACE FUNCTION public.upsert_paired_sales_delta(
    p_device_id TEXT,
    p_records JSONB
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
DECLARE
    v_device_id TEXT := btrim(COALESCE(p_device_id, ''));
    v_doc_id BIGINT;
    v_existing_data JSONB;
    v_existing_payload JSONB;
    v_existing_count INTEGER;
    v_incoming_count INTEGER;
    v_merged_payload JSONB;
    v_merged_count INTEGER;
    v_new_data JSONB;
    v_confirmed_cierre_ids JSONB;
    v_updated_at TIMESTAMPTZ;
BEGIN
    IF v_device_id = '' OR p_records IS NULL OR jsonb_typeof(p_records) <> 'array' THEN
        RAISE EXCEPTION 'POS_SYNC_SCOPE_REQUIRED';
    END IF;

    v_incoming_count := jsonb_array_length(p_records);
    IF v_incoming_count = 0 THEN
        RETURN json_build_object('success', true, 'upserted_count', 0, 'confirmed_cierre_ids', '[]'::jsonb);
    END IF;

    IF v_incoming_count > 500 OR octet_length(p_records::text) > 2097152 THEN
        RAISE EXCEPTION 'POS_SYNC_DELTA_BATCH_TOO_LARGE';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.device_pairings pairing
        WHERE pairing.primary_device_id = v_device_id
    ) THEN
        RAISE EXCEPTION 'POS_SYNC_DEVICE_NOT_REGISTERED';
    END IF;

    -- Lock de fila para serializar escrituras concurrentes de manera atómica
    SELECT d.id, d.data
      INTO v_doc_id, v_existing_data
      FROM public.sync_documents d
     WHERE d.device_id = v_device_id
       AND d.collection = 'store'
       AND d.doc_id = 'bodega_sales_v1'
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'reason', 'base_doc_missing');
    END IF;

    v_existing_payload := CASE
        WHEN jsonb_typeof(v_existing_data->'payload') = 'array' THEN v_existing_data->'payload'
        ELSE '[]'::jsonb
    END;
    v_existing_count := jsonb_array_length(v_existing_payload);

    WITH existing_rows AS (
        SELECT DISTINCT ON (elem->>'id')
               elem->>'id' AS rec_id,
               elem AS rec
          FROM jsonb_array_elements(v_existing_payload) WITH ORDINALITY AS t(elem, ord)
         WHERE jsonb_typeof(elem) = 'object'
           AND COALESCE(elem->>'id', '') <> ''
         ORDER BY elem->>'id', ord ASC
    ),
    incoming_rows AS (
        SELECT DISTINCT ON (elem->>'id')
               elem->>'id' AS rec_id,
               elem AS rec
          FROM jsonb_array_elements(p_records) WITH ORDINALITY AS t(elem, ord)
         WHERE jsonb_typeof(elem) = 'object'
           AND COALESCE(elem->>'id', '') <> ''
         ORDER BY elem->>'id', ord DESC
    ),
    merged_rows AS (
        SELECT COALESCE(e.rec_id, i.rec_id) AS rec_id,
               public.merge_single_sale_jsonb(e.rec, i.rec) AS rec
          FROM existing_rows e
          FULL OUTER JOIN incoming_rows i ON e.rec_id = i.rec_id
    )
    SELECT COALESCE(
               jsonb_agg(
                   rec ORDER BY COALESCE(rec->>'timestamp', rec->>'createdAt', '') DESC
               ),
               '[]'::jsonb
           ),
           COUNT(*)::integer
      INTO v_merged_payload, v_merged_count
      FROM merged_rows;

    -- Invariante I1: el delta NUNCA puede encoger el historial existente
    IF v_merged_count < v_existing_count THEN
        RAISE EXCEPTION 'POS_SYNC_DELTA_SHRINK_BLOCKED';
    END IF;

    v_new_data := jsonb_build_object('payload', v_merged_payload);
    IF octet_length(v_new_data::text) > 16777216 THEN
        RAISE EXCEPTION 'POS_SYNC_DOCUMENT_TOO_LARGE';
    END IF;

    UPDATE public.sync_documents
       SET data = v_new_data,
           updated_at = now()
     WHERE id = v_doc_id
    RETURNING updated_at INTO v_updated_at;

    -- Extraer los cierreId de los REGISTRO_CIERRE presentes en el lote y confirmados en el doc final
    SELECT COALESCE(jsonb_agg(DISTINCT (elem->>'cierreId')), '[]'::jsonb)
      INTO v_confirmed_cierre_ids
      FROM jsonb_array_elements(v_merged_payload) AS elem
     WHERE elem->>'tipo' = 'REGISTRO_CIERRE'
       AND COALESCE(elem->>'cierreId', '') <> ''
       AND (elem->>'cierreId') IN (
           SELECT inc->>'cierreId'
             FROM jsonb_array_elements(p_records) AS inc
            WHERE inc->>'tipo' = 'REGISTRO_CIERRE'
              AND COALESCE(inc->>'cierreId', '') <> ''
       );

    RETURN json_build_object(
        'success', true,
        'device_id', v_device_id,
        'total_records', v_merged_count,
        'upserted_count', v_incoming_count,
        'confirmed_cierre_ids', v_confirmed_cierre_ids,
        'updated_at', v_updated_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_single_sale_jsonb(JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_paired_sales_delta(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_paired_sales_delta(TEXT, JSONB) TO anon, authenticated;
```

**Step 2: Sincronizar `SET statement_timeout = '30s'` en `supabase_remote_audit_setup.sql`**

Agregar `SET statement_timeout = '30s'` en las cabeceras de `read_paired_audit_documents`, `write_paired_sync_document`, `write_paired_cloud_backup` y `read_paired_cloud_backup` en `supabase_remote_audit_setup.sql` para mantener el archivo fuente canónico alineado.

**Step 3: Ejecutar `supabase_sales_delta_and_timeouts_setup.sql` en el SQL Editor de Supabase y verificar (read-only probe)**

Run:
```bash
node -e "import('node:fs').then(async({default:fs})=>{const E={};fs.readFileSync('.env','utf8').split(/\r?\n/).forEach(l=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)E[m[1]]=m[2];});const r=await fetch((E.VITE_SUPABASE_URL||E.VITE_SUPABASE_CLOUD_URL)+'/rest/v1/rpc/upsert_paired_sales_delta',{method:'POST',headers:{apikey:E.VITE_SUPABASE_ANON_KEY,Authorization:'Bearer '+E.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_device_id:'',p_records:[]})});console.log(r.status,await r.text());});"
```
Expected: `400 {"code":"P0001",...,"message":"POS_SYNC_SCOPE_REQUIRED"}` (confirma que el RPC existe, es invocable por `anon` y valida alcance).

**Step 4: Commit**

```bash
git add supabase_sales_delta_and_timeouts_setup.sql supabase_remote_audit_setup.sql
git commit -m "feat(sql): statement_timeout 30s en RPCs + upsert_paired_sales_delta atomico"
```

---

### Task 2: Módulo Puro de Delta de Ventas (`src/utils/salesDeltaSync.js`) + Tests TDD

**Files:**
- Create: `src/utils/salesDeltaSync.js`
- Create: `tests/salesDeltaSync.test.js`

**Step 1: Escribir los tests que fallen (`tests/salesDeltaSync.test.js`)**

Cubrir:
1. `computeSaleSyncFingerprint` cambia si cambia `cajaCerrada`, `cierreId`, `status`, `updatedAt`, `totalBs`, `totalUsd`, `payments.length` o `items.length`.
2. `extractSalesDelta` con mapa de huellas cálido devuelve solo la venta nueva (1 registro) o los registros del cierre (34 registros), nunca los 2.186.
3. `extractSalesDelta` en arranque en frío (`fingerprints === null`) sin `expectedCierreId` devuelve `{ mode: 'full', records: null }`.
4. `extractSalesDelta` en arranque en frío (`fingerprints === null`) CON `expectedCierreId` (cierre crítico) devuelve `{ mode: 'delta', records }` con todos los registros que tengan ese `cierreId`, el `REGISTRO_CIERRE`, cualquier abierto (`cajaCerrada !== true`) y los últimos 72 h.
5. `extractSalesDelta` con `dirty.length > maxBatch` (ej. restauración masiva) devuelve `{ mode: 'full', records: null }`.
6. `mergeSyncedFingerprints` actualiza únicamente los registros confirmados sin borrar huellas previas.
7. `buildSyncedFingerprintsMap` ignora elementos inválidos o sin `id`.

**Step 2: Correr tests y confirmar fallo**

Run: `npx vitest run tests/salesDeltaSync.test.js`
Expected: FAIL (`Cannot find module '../src/utils/salesDeltaSync'`).

**Step 3: Implementar `src/utils/salesDeltaSync.js`**

```js
// src/utils/salesDeltaSync.js
// Cálculo puro y determinista del lote delta de `bodega_sales_v1` para
// `upsert_paired_sales_delta`. Nunca muta registros ni elimina historial.

export const SALES_SYNC_FINGERPRINTS_KEY = 'bodega_sales_sync_fingerprints_v1';
export const SALES_DELTA_MAX_BATCH = 250;
const COLD_CLOSE_LOOKBACK_MS = 72 * 60 * 60 * 1000;

export function computeSaleSyncFingerprint(sale) {
    if (!sale || typeof sale !== 'object' || !sale.id) return '';
    const payLen = Array.isArray(sale.payments) ? sale.payments.length : 0;
    const itemLen = Array.isArray(sale.items) ? sale.items.length : (Number(sale.itemCount) || 0);
    return [
        sale.tipo || '',
        sale.updatedAt || sale.timestamp || sale.createdAt || '',
        sale.cajaCerrada === true ? '1' : '0',
        sale.cierreId != null ? String(sale.cierreId) : '',
        sale.cierreNumber != null ? String(sale.cierreNumber) : '',
        sale.status || '',
        sale.totalUsd ?? '',
        sale.totalBs ?? '',
        payLen,
        itemLen,
        sale.saleNumber ?? '',
        sale.isArchived === true ? 'A' : '',
    ].join('|');
}

export function buildSyncedFingerprintsMap(salesList) {
    const map = {};
    if (!Array.isArray(salesList)) return map;
    for (let i = 0; i < salesList.length; i++) {
        const s = salesList[i];
        if (s && typeof s === 'object' && s.id) {
            map[s.id] = computeSaleSyncFingerprint(s);
        }
    }
    return map;
}

export function mergeSyncedFingerprints(existingMap, uploadedRecords) {
    const next = existingMap && typeof existingMap === 'object' ? { ...existingMap } : {};
    if (!Array.isArray(uploadedRecords)) return next;
    for (let i = 0; i < uploadedRecords.length; i++) {
        const s = uploadedRecords[i];
        if (s && typeof s === 'object' && s.id) {
            next[s.id] = computeSaleSyncFingerprint(s);
        }
    }
    return next;
}

/**
 * Determina si `bodega_sales_v1` puede enviarse como delta liviano o requiere
 * subida completa.
 *
 * @returns {{ mode: 'unchanged'|'delta'|'full', records: Array|null }}
 */
export function extractSalesDelta(
    localSales,
    syncedFingerprints,
    { expectedCierreId = null, maxBatch = SALES_DELTA_MAX_BATCH, nowMs = Date.now() } = {},
) {
    if (!Array.isArray(localSales) || localSales.length === 0) {
        return { mode: 'full', records: null };
    }

    const hasWarmMap = syncedFingerprints
        && typeof syncedFingerprints === 'object'
        && !Array.isArray(syncedFingerprints)
        && Object.keys(syncedFingerprints).length > 0;

    if (!hasWarmMap) {
        // Arranque en frío durante un CIERRE CRÍTICO: priorizar entrega en <1s
        // enviando todo el turno cerrado + abiertos + ventana de 72 h.
        if (expectedCierreId != null) {
            const targetId = String(expectedCierreId);
            const cierreRecordId = `cierre_${targetId}`;
            const cutoff = nowMs - COLD_CLOSE_LOOKBACK_MS;
            const coldBatch = localSales.filter((s) => {
                if (!s || typeof s !== 'object' || !s.id) return false;
                if (String(s.cierreId ?? '') === targetId) return true;
                if (s.id === cierreRecordId) return true;
                if (s.cajaCerrada !== true) return true;
                const ts = Date.parse(s.updatedAt || s.timestamp || s.createdAt || '');
                return Number.isFinite(ts) && ts >= cutoff;
            });
            if (coldBatch.length > 0 && coldBatch.length <= maxBatch) {
                return { mode: 'delta', records: coldBatch };
            }
        }
        return { mode: 'full', records: null };
    }

    const dirty = [];
    for (let i = 0; i < localSales.length; i++) {
        const s = localSales[i];
        if (!s || typeof s !== 'object' || !s.id) continue;
        const fp = computeSaleSyncFingerprint(s);
        if (syncedFingerprints[s.id] !== fp) {
            dirty.push(s);
            if (dirty.length > maxBatch) {
                return { mode: 'full', records: null };
            }
        }
    }

    // Defensa extra: si es un cierre crítico, garantizar que el REGISTRO_CIERRE esté en el lote
    if (expectedCierreId != null) {
        const targetId = String(expectedCierreId);
        const alreadyIncluded = dirty.some(
            (s) => s.tipo === 'REGISTRO_CIERRE' && String(s.cierreId ?? '') === targetId,
        );
        if (!alreadyIncluded) {
            const cierreRec = localSales.find(
                (s) => s && s.tipo === 'REGISTRO_CIERRE' && String(s.cierreId ?? '') === targetId,
            );
            if (cierreRec) dirty.push(cierreRec);
        }
    }

    if (dirty.length === 0) {
        return { mode: 'unchanged', records: [] };
    }
    return { mode: 'delta', records: dirty };
}
```

**Step 4: Correr tests y verificar PASS**

Run: `npx vitest run tests/salesDeltaSync.test.js`
Expected: PASS (todos los casos en verde).

**Step 5: Commit**

```bash
git add src/utils/salesDeltaSync.js tests/salesDeltaSync.test.js
git commit -m "feat(sync): helper puro salesDeltaSync para extraccion de deltas de ventas"
```

---

### Task 3: Integrar Delta Push en `useCloudSync.js` con Fallback Transparente + Reuso de `cloudReference`

**Files:**
- Modify: `src/hooks/useCloudSync.js` (líneas 25–45, 242–499, 549–647)
- Create: `tests/salesDeltaCloudSync.test.js`

**Detalles exactos de diseño:**
1. Agregar `SALES_SYNC_FINGERPRINTS_KEY` (`'bodega_sales_sync_fingerprints_v1'`) a `CLOUD_SYNC_EXCLUDE` (defensa en profundidad; tampoco está en `IDB_KEYS`).
2. Cache en memoria `_salesFingerprintsCache = { deviceId: null, map: null }` cargado una sola vez desde `localStore.getItem(SALES_SYNC_FINGERPRINTS_KEY)` por `deviceId` (invalidado si cambia la identidad o si `confirm_sales_purge_flag === 'true'` o `forceUnconditional === true`).
3. En `pushCloudSyncNow` cuando `key === 'bodega_sales_v1' && Array.isArray(value) && !forceUnconditional && !allowSalesPurgeEarly`:
   - Ejecutar `extractSalesDelta(value, fingerprintsMap, { expectedCierreId })`.
   - Si `mode === 'delta'` y `records.length > 0`:
     - Invocar `supabaseCloud.rpc('upsert_paired_sales_delta', { p_device_id: activeDeviceId, p_records: records })` (propagando `.abortSignal(signal)`).
     - Si el RPC responde `{ success: true }`:
       - Actualizar `fingerprintsMap = mergeSyncedFingerprints(fingerprintsMap, records)` y persistir en `localStore.setItem(SALES_SYNC_FINGERPRINTS_KEY, fingerprintsMap)`.
       - Pasar al **único bloque de salida exitosa** donde se escribe `localStorage.setItem(hashKey, currentHash)` (preservando la invariante D1 verificada en `tests/egressHashOwnership.test.js`) y `notifySalesPushConfirmed(activeDeviceId, confirmedRecords, ...)`, devolviendo `uploadedCierreIds: data.confirmed_cierre_ids` si `collectCierreIds` es true!
     - Si el RPC devuelve `PGRST202` / `42883` (función aún no desplegada) o `{ success: false, reason: 'base_doc_missing' }`:
       - Registrar `console.info('[CloudSync] Delta RPC no disponible; usando fallback completo.')` y **caer limpiamente al flujo existente** (`salesPushMerge` + `write_paired_sync_document`) sin registrar cooldown ni fallo.
     - Si el RPC devuelve error de red / 5xx / `57014`:
       - Registrar retry failure y retornar `{ ok: false, reason: 'rpc_error'|'transport', retryable: true }` para que `pushCriticalCloudSync` reintente rápido.
   - Si cae al flujo completo (`write_paired_sync_document`) y tiene éxito:
     - Sembrar `fingerprintsMap = buildSyncedFingerprintsMap(sourceSalesPayload)` y guardarlo en `localStore`, para que desde el siguiente movimiento TODAS las subidas sean deltas de 2–35 KB.
4. En `pushCriticalCloudSync`:
   - Pasar `expectedCierreId` dentro de las opciones a `pushCloudSyncDetailed` para que el cold-start cierre fast-path funcione incluso en el primer arranque tras actualizar.
   - Ampliar reintentos rápidos a `maxRetries = 3, retryDelaysMs = [2000, 5000, 10000], timeoutMs = 120000`.
   - Reutilizar `cloudReference` en memoria durante los reintentos del mismo `pushCriticalCloudSync` si por fallback necesitó `salesPushMerge`.

**Step 1: Escribir tests de integración en `tests/salesDeltaCloudSync.test.js`**
- Caso 1: Push de 1 venta con mapa cálido llama `upsert_paired_sales_delta` con **1 registro** (nunca llama `read_paired_audit_documents` ni `write_paired_sync_document`).
- Caso 2: Cierre crítico (`pushCriticalCloudSync` con `expectedCierreId`) en cold-start llama `upsert_paired_sales_delta` con solo los registros del cierre + abiertos, confirma `uploadedCierreIds` y marca `ok: true`.
- Caso 3: Fallback transparente si `upsert_paired_sales_delta` responde `PGRST202` o `base_doc_missing` → usa `write_paired_sync_document` y siembra `fingerprints`.
- Caso 4: Si `confirm_sales_purge_flag === 'true'` o `forceUnconditional === true`, omite delta y usa `write_paired_sync_document`.

**Step 2: Correr tests y confirmar fallo**

Run: `npx vitest run tests/salesDeltaCloudSync.test.js`
Expected: FAIL.

**Step 3: Implementar los cambios en `src/hooks/useCloudSync.js`**

**Step 4: Correr suite de tests de sync y regresiones**

Run: `npx vitest run tests/salesDeltaCloudSync.test.js tests/cierreCloudSync.test.js tests/egressHashOwnership.test.js tests/salesPushMerge.test.js tests/shiftCloseSignal.test.js`
Expected: Todos en PASS (verificar especialmente que `egressHashOwnership.test.js` mantiene 1 sola escritura de `hashKey`).

**Step 5: Commit**

```bash
git add src/hooks/useCloudSync.js tests/salesDeltaCloudSync.test.js
git commit -m "feat(cloud-sync): habilitar delta push de ventas/cierres con fallback seguro"
```

---

### Task 4: Eliminar Doble-Push al Cerrar + UX Honesta y Auto-Reintento 10 s en Modal de Cierre

**Files:**
- Modify: `src/utils/storageService.js:27-39`
- Modify: `src/views/DashboardView.jsx:473-522, 597-635`
- Modify: `src/components/Dashboard/CierreCajaSummaryModal.jsx:65-80, 176-274, 299-306`
- Modify: `tests/dashboardCloseIntegration.test.jsx`

**Cambios exactos:**
1. **`src/utils/storageService.js`:**
   ```js
   setItem(key, value, options = {}) {
       const suppressSync = isSyncingFromCloud() || options?.skipCloudSync === true;
       return localStore.setItem(key, value, {
           allowFallback: true,
           prepare: (incoming, io) => prepareWrite(key, incoming, io),
           onPersisted: (savedKey, savedValue, primary) => notifyPersisted(savedKey, savedValue, primary && !suppressSync),
           onFallback: (failedKey, error, primaryError) => {
               if (isQuotaError(error) || isQuotaError(primaryError)) dispatchQuotaExceeded(failedKey, error);
           },
       });
   },
   ```
2. **`src/views/DashboardView.jsx`:**
   - En `handleConfirmCashRecon`, cambiar `await storageService.setItem(SALES_KEY, freshUpdated);` → `await storageService.setItem(SALES_KEY, freshUpdated, { skipCloudSync: true });` (el cierre se sube exclusivamente por `syncLatestCloseToCloud` → `pushCriticalCloudSync`, evitando el push ordinario abortado por la escritura del espejo de 5 MB).
   - Agregar `useEffect` de auto-reintento rápido cada **10 segundos** mientras `showCierreSummary && cierreSyncStatus === 'failed'` y el error sea transitorio (máximo 6 auto-reintentos = 1 min, complementando el botón manual y el ciclo de 60 s).
3. **`src/components/Dashboard/CierreCajaSummaryModal.jsx`:**
   - Header dinámico según `syncStatus`:
     - `syncStatus === 'syncing'`: ícono spinner azul/ámbar + `"Guardado local — Enviando al Supervisor..."`
     - `syncStatus === 'failed'`: ícono `CloudOff` ámbar + `"Cierre guardado solo en esta PC"`
     - `syncStatus === 'synced'` o `'idle'`: check verde + `"Cierre Completado"` (si `'synced'`: `"Cierre Completado y Enviado"`)
   - En el banner `syncing`, mensaje explícito: `"Enviando cierre al Supervisor... No cierres el programa ni apagues la PC hasta ver la confirmación verde."`
   - Botón inferior mientras `syncStatus === 'syncing'`: `"Esperando confirmación del Supervisor..."` (sigue abriendo el aviso de confirmación al hacer click para nunca atrapar al usuario offline).

**Step 1: Agregar/actualizar casos en `tests/dashboardCloseIntegration.test.jsx`**
- Verificar que `handleConfirmCashRecon` pasa `{ skipCloudSync: true }` a `storageService.setItem(SALES_KEY, ...)`.
- Verificar que `CierreCajaSummaryModal` NO muestra el título `"Cierre Completado"` mientras `syncStatus === 'syncing'` ni `'failed'`, y sí lo muestra cuando `syncStatus === 'synced'`.
- Verificar el auto-reintento de 10 s cuando `syncStatus === 'failed'` y el modal sigue abierto.

**Step 2: Correr tests y confirmar fallo**

Run: `npx vitest run tests/dashboardCloseIntegration.test.jsx`
Expected: FAIL en los casos nuevos.

**Step 3: Implementar cambios en `storageService.js`, `DashboardView.jsx` y `CierreCajaSummaryModal.jsx`**

**Step 4: Correr tests y verificar PASS**

Run: `npx vitest run tests/dashboardCloseIntegration.test.jsx tests/cierreCloudSync.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/utils/storageService.js src/views/DashboardView.jsx src/components/Dashboard/CierreCajaSummaryModal.jsx tests/dashboardCloseIntegration.test.jsx
git commit -m "fix(cierre-ux): eliminar doble-push al cerrar, header honesto y auto-reintento 10s"
```

---

### Task 5: Higiene Cloud — Compactación de Kardex (`-68%`) y Ventas Cerradas Antiguas (`-35%`)

> **Importante:** Este paso solo afecta lo publicado en `sync_documents` (nube) para mantener rápido el arranque del Monitor y evitar el techo de tamaño. **Jamás muta el IndexedDB local de la caja ni toca `VENTA_FIADA`, `COBRO_DEUDA`, `REGISTRO_CIERRE`, `GASTO_INTERNO` ni `APERTURA_CAJA`.**

**Files:**
- Modify: `src/utils/salesCompactor.js`
- Modify: `src/hooks/useCloudSync.js` (líneas 60–72)
- Modify: `tests/salesCompactor.test.js`
- Modify: `tests/egressHashOwnership.test.js` (líneas 53–59)

**Verificación previa obligatoria (antes de tocar código):**
- Confirmar en `MonitorKardexTab` (o vista de Kardex del Supervisor) que `tipo === 'APERTURA_PERIODO'` renderiza sin errores y preserva los saldos de stock.
- Confirmar en `MonitorCierresTab` y `SaleDetailModal` que `isArchived === true` en `VENTA` (>30 días) mantiene intactos: desglose de métodos de pago, total USD/Bs, `itemCount`, nombre del cajero, y banner *"Detalle histórico archivado"*.

**Cambios exactos:**
1. En `src/utils/salesCompactor.js`:
   - Restringir `ARCHIVABLE_SALE_TYPES` a `new Set(['VENTA'])` (nunca archivar `VENTA_FIADA` ni `VENTA_CASHEA` para que el historial de deudas de clientes conserve siempre el detalle de artículos!).
   - Elevar `SALES_RECENT_DAYS_RETENTION` de `15` a `30` días (todo el último mes conserva detalle completo de artículos en el Supervisor).
   - Al archivar una `VENTA` cerrada >30 días (`applySalesArchiveMarker`), omitir también `changeLedger` vacío (`!hasChange && parts.length === 0`) y propiedades opcionales nulas/cero (`changeOwed: null`, `changeVoucher: null`, `tipDonated: null`, `customerPhone: null`, etc.), reduciendo Doc 60 de `4.88 MB → ~3.2 MB` de forma segura.
2. En `src/hooks/useCloudSync.js`:
   - Activar `const KARDEX_EGRESS_COMPACTION_ENABLED = true;` (`bodega_kardex_v1`: `2.88 MB → 0.93 MB`, `-68%`) y versionar `PAYLOAD_TRANSFORM_VERSIONS.bodega_kardex_v1 = 'kardex-snapshot-30d-v1'`.
   - Mantener `SALES_ARCHIVE_ENABLED = false` por defecto hasta validar 48 h el delta push en producción (y activarlo luego con 1 línea o flag cuando se verifique estable en Monitor), para desacoplar riesgos.
3. Actualizar `tests/salesCompactor.test.js` y `tests/egressHashOwnership.test.js`.

**Step 1–4: TDD (tests → fallo → implementación → verde)**

Run: `npx vitest run tests/salesCompactor.test.js tests/kardexScope.test.js tests/egressHashOwnership.test.js tests/salesPushMerge.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/utils/salesCompactor.js src/hooks/useCloudSync.js tests/salesCompactor.test.js tests/egressHashOwnership.test.js
git commit -m "perf(cloud-sync): compactacion 30d de Kardex (-68%) y reglas seguras de archivado de ventas"
```

---

### Task 6: Release `v1.2.0`, Verificación Integral y Chequeo en Producción

**Files:**
- Modify: `package.json` (`version: "1.2.0"`)
- Modify: `package-lock.json` (`version: "1.2.0"`)

**Step 1: Correr build de producción y suite de tests**

Run:
```bash
npm run build
npx vitest run tests/salesDeltaSync.test.js tests/salesDeltaCloudSync.test.js tests/cierreCloudSync.test.js tests/dashboardCloseIntegration.test.jsx tests/shiftCloseSignal.test.js tests/monitorSyncRecovery.test.js tests/salesPushMerge.test.js tests/salesCompactor.test.js tests/egressHashOwnership.test.js tests/cloudRetry.test.js
```
Expected: Build limpio sin errores + 100% PASS en todas las suites de sync/cierre.

**Step 2: Commit y push (solo cuando el usuario autorice)**

```bash
git add package.json package-lock.json
git commit -m "chore(release): v1.2.0 - sync delta de ventas/cierres y blindaje anti-timeout"
```

**Step 3: Criterios de aceptación en vivo (`PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F`)**
1. Al ejecutar `supabase_sales_delta_and_timeouts_setup.sql` en Supabase:
   - `upsert_paired_sales_delta` responde en `< 500 ms` para un lote delta.
   - `write_paired_sync_document` tiene `statement_timeout = 30s` (cero errores `57014`).
2. Al encender hoy la caja principal (`PDA-V2-...39F`):
   - El cierre #100 del 21-11 sube automáticamente a Doc 60.
   - Al actualizar a `v1.2.0`, cada venta nueva sube ~2 KB en `< 1 s` (vs 4 min 56 s antes).
3. En el próximo cierre nocturno (#101):
   - El modal muestra `"Guardado local — Enviando al Supervisor..."` y pasa a check verde `"Cierre Completado y Enviado"` en **1–3 segundos**.
   - Aparece la fila en `shift_close_events` y el Panel de Supervisión refleja el cierre en tiempo real sin esperar al día siguiente.
   - `node scripts/daily-sync-audit.mjs` reporta **0 duplicados**, **0 pérdidas de cierres** y `Doc 60` íntegro.
