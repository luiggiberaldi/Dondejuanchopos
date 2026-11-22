-- =============================================================================
-- Fix Definitivo — Timeouts seguros (30s) + RPC Delta de Ventas (v1.2.0)
-- Proyecto Supabase Cloud/Sync: kcananrtcmckovdstvao.supabase.co
--
-- Ejecutar manualmente en el SQL Editor ANTES de desplegar v1.2.0.
-- Script 100% idempotente y retrocompatible con v1.1.9.
--
-- Guardrails:
--   1. SET statement_timeout = '30s' en RPCs pesados (evita cortes de 3s de `anon`).
--   2. Lock FOR UPDATE en sync_documents para serializar fusiones concurrentes.
--   3. Sin casts ::boolean inseguros sobre JSONB arbitrario.
--   4. Invariantes duras: total_records >= existing_count Y cierres >= existing_cierres.
--   5. Preserva elementos sin `id` (si existiera alguno legacy) sin perder filas.
--   6. Retorna base_doc_missing si el doc base no existe o está vacío (fallback seguro).
-- =============================================================================

-- 1. Elevar statement_timeout a 30s en los RPCs pesados existentes
ALTER FUNCTION public.read_paired_audit_documents(TEXT, TEXT, TEXT[], TIMESTAMPTZ)
    SET statement_timeout = '30s';

ALTER FUNCTION public.write_paired_sync_document(TEXT, TEXT, TEXT, JSONB)
    SET statement_timeout = '30s';

ALTER FUNCTION public.write_paired_cloud_backup(TEXT, UUID, JSONB)
    SET statement_timeout = '30s';

ALTER FUNCTION public.read_paired_cloud_backup(TEXT, TEXT, TIMESTAMPTZ)
    SET statement_timeout = '30s';

-- 2. Ampliar techo de emergencia de write_paired_sync_document a 16 MB con timeout 30s
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

    -- Techo de emergencia ampliado a 16 MB (cliente mantiene compactación objetivo < 4 MB)
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

    -- Parseo defensivo de timestamps ISO (nunca aborta por string malformado)
    BEGIN
        v_cloud_ts := COALESCE(
            NULLIF(p_cloud->>'updatedAt', ''),
            NULLIF(p_cloud->>'timestamp', ''),
            NULLIF(p_cloud->>'createdAt', '')
        )::timestamptz;
    EXCEPTION WHEN others THEN
        v_cloud_ts := '-infinity'::timestamptz;
    END;

    BEGIN
        v_in_ts := COALESCE(
            NULLIF(p_incoming->>'updatedAt', ''),
            NULLIF(p_incoming->>'timestamp', ''),
            NULLIF(p_incoming->>'createdAt', '')
        )::timestamptz;
    EXCEPTION WHEN others THEN
        v_in_ts := '-infinity'::timestamptz;
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

    -- Guardrail: evaluación segura de cajaCerrada sin cast ::boolean
    v_cloud_closed := LOWER(COALESCE(p_cloud->>'cajaCerrada', '')) IN ('true', 't', '1')
        OR (p_cloud->'cierreId' IS NOT NULL
            AND jsonb_typeof(p_cloud->'cierreId') <> 'null'
            AND NULLIF(btrim(p_cloud->>'cierreId'), '') IS NOT NULL);

    v_in_closed := LOWER(COALESCE(p_incoming->>'cajaCerrada', '')) IN ('true', 't', '1')
        OR (p_incoming->'cierreId' IS NOT NULL
            AND jsonb_typeof(p_incoming->'cierreId') <> 'null'
            AND NULLIF(btrim(p_incoming->>'cierreId'), '') IS NOT NULL);

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
        WHEN p_cloud->'cierreId' IS NOT NULL
             AND jsonb_typeof(p_cloud->'cierreId') <> 'null'
             AND NULLIF(btrim(p_cloud->>'cierreId'), '') IS NOT NULL
            THEN p_cloud->'cierreId'
        WHEN p_incoming->'cierreId' IS NOT NULL
             AND jsonb_typeof(p_incoming->'cierreId') <> 'null'
             AND NULLIF(btrim(p_incoming->>'cierreId'), '') IS NOT NULL
            THEN p_incoming->'cierreId'
        ELSE NULL
    END;

    v_resolved_cierre_num := CASE
        WHEN p_cloud->'cierreNumber' IS NOT NULL
             AND jsonb_typeof(p_cloud->'cierreNumber') <> 'null'
             AND NULLIF(btrim(p_cloud->>'cierreNumber'), '') IS NOT NULL
            THEN p_cloud->'cierreNumber'
        WHEN p_incoming->'cierreNumber' IS NOT NULL
             AND jsonb_typeof(p_incoming->'cierreNumber') <> 'null'
             AND NULLIF(btrim(p_incoming->>'cierreNumber'), '') IS NOT NULL
            THEN p_incoming->'cierreNumber'
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

-- 4. RPC Atómico Delta de Ventas: fusiona solo registros nuevos/modificados (2–60 KB)
--    directamente en sync_documents (`bodega_sales_v1`) bajo lock FOR UPDATE.
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
    v_existing_cierres INTEGER;
    v_incoming_count INTEGER;
    v_merged_payload JSONB;
    v_merged_count INTEGER;
    v_merged_cierres INTEGER;
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

    -- Lock de fila para serializar escrituras concurrentes de forma atómica
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

    IF v_existing_count = 0 THEN
        RETURN json_build_object('success', false, 'reason', 'base_doc_missing');
    END IF;

    SELECT COUNT(*)::integer
      INTO v_existing_cierres
      FROM jsonb_array_elements(v_existing_payload) AS elem
     WHERE jsonb_typeof(elem) = 'object'
       AND elem->>'tipo' = 'REGISTRO_CIERRE';

    WITH existing_keyed AS (
        SELECT DISTINCT ON (elem->>'id')
               elem->>'id' AS rec_id,
               elem AS rec
          FROM jsonb_array_elements(v_existing_payload) WITH ORDINALITY AS t(elem, ord)
         WHERE jsonb_typeof(elem) = 'object'
           AND COALESCE(elem->>'id', '') <> ''
         ORDER BY elem->>'id', ord ASC
    ),
    existing_unkeyed AS (
        -- Guardrail: jamás descartar registros legacy que carezcan de id
        SELECT elem AS rec
          FROM jsonb_array_elements(v_existing_payload) AS elem
         WHERE jsonb_typeof(elem) <> 'object'
            OR COALESCE(elem->>'id', '') = ''
    ),
    incoming_keyed AS (
        SELECT DISTINCT ON (elem->>'id')
               elem->>'id' AS rec_id,
               elem AS rec
          FROM jsonb_array_elements(p_records) WITH ORDINALITY AS t(elem, ord)
         WHERE jsonb_typeof(elem) = 'object'
           AND COALESCE(elem->>'id', '') <> ''
         ORDER BY elem->>'id', ord DESC
    ),
    merged_rows AS (
        SELECT public.merge_single_sale_jsonb(e.rec, i.rec) AS rec
          FROM existing_keyed e
          FULL OUTER JOIN incoming_keyed i ON e.rec_id = i.rec_id
        UNION ALL
        SELECT rec FROM existing_unkeyed
    )
    SELECT COALESCE(
               jsonb_agg(
                   rec ORDER BY COALESCE(rec->>'timestamp', rec->>'createdAt', '') DESC
               ),
               '[]'::jsonb
           ),
           COUNT(*)::integer,
           COUNT(*) FILTER (WHERE jsonb_typeof(rec) = 'object' AND rec->>'tipo' = 'REGISTRO_CIERRE')::integer
      INTO v_merged_payload, v_merged_count, v_merged_cierres
      FROM merged_rows;

    -- Invariante I1: el delta NUNCA puede encoger el historial ni reducir cierres
    IF v_merged_count < v_existing_count THEN
        RAISE EXCEPTION 'POS_SYNC_DELTA_SHRINK_BLOCKED';
    END IF;
    IF v_merged_cierres < v_existing_cierres THEN
        RAISE EXCEPTION 'POS_SYNC_DELTA_CIERRES_SHRINK_BLOCKED';
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

    -- Confirmar los cierreId de REGISTRO_CIERRE presentes en p_records y verificados en v_merged_payload
    SELECT COALESCE(jsonb_agg(DISTINCT (elem->>'cierreId')), '[]'::jsonb)
      INTO v_confirmed_cierre_ids
      FROM jsonb_array_elements(v_merged_payload) AS elem
     WHERE jsonb_typeof(elem) = 'object'
       AND elem->>'tipo' = 'REGISTRO_CIERRE'
       AND COALESCE(elem->>'cierreId', '') <> ''
       AND (elem->>'cierreId') IN (
           SELECT inc->>'cierreId'
             FROM jsonb_array_elements(p_records) AS inc
            WHERE jsonb_typeof(inc) = 'object'
              AND inc->>'tipo' = 'REGISTRO_CIERRE'
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
