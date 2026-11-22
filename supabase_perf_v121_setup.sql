-- =============================================================================
-- v1.2.1 — Micro-RPC get_sales_max_number (ahorra ~1 GB/día egress)
--        + Optimización O(1) pg_column_size en upsert_paired_sales_delta
-- Proyecto Supabase Cloud/Sync: kcananrtcmckovdstvao.supabase.co
-- 100% idempotente y retrocompatible.
-- =============================================================================

-- 1. Micro-RPC: devuelve únicamente el máximo `saleNumber` numérico de Doc 60
--    (~90 bytes en <50 ms en lugar de descargar 5.32 MB en cada venta).
CREATE OR REPLACE FUNCTION public.get_sales_max_number(
    p_device_id TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
SET statement_timeout = '10s'
AS $$
DECLARE
    v_device_id TEXT := btrim(COALESCE(p_device_id, ''));
    v_payload JSONB;
    v_updated_at TIMESTAMPTZ;
    v_max_num INTEGER := 0;
    v_total INTEGER := 0;
BEGIN
    IF v_device_id = '' THEN
        RAISE EXCEPTION 'POS_SYNC_SCOPE_REQUIRED';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.device_pairings pairing
        WHERE pairing.primary_device_id = v_device_id
    ) THEN
        RAISE EXCEPTION 'POS_SYNC_DEVICE_NOT_REGISTERED';
    END IF;

    SELECT d.data->'payload', d.updated_at
      INTO v_payload, v_updated_at
      FROM public.sync_documents d
     WHERE d.device_id = v_device_id
       AND d.collection = 'store'
       AND d.doc_id = 'bodega_sales_v1'
     LIMIT 1;

    IF NOT FOUND OR v_payload IS NULL OR jsonb_typeof(v_payload) <> 'array' THEN
        RETURN json_build_object(
            'success', true,
            'max_sale_number', 0,
            'total_records', 0,
            'updated_at', v_updated_at
        );
    END IF;

    v_total := jsonb_array_length(v_payload);

    SELECT COALESCE(MAX((elem->>'saleNumber')::integer), 0)
      INTO v_max_num
      FROM jsonb_array_elements(v_payload) AS elem
     WHERE jsonb_typeof(elem) = 'object'
       AND COALESCE(elem->>'saleNumber', '') ~ '^[0-9]+$';

    RETURN json_build_object(
        'success', true,
        'max_sale_number', v_max_num,
        'total_records', v_total,
        'updated_at', v_updated_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_sales_max_number(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sales_max_number(TEXT) TO anon, authenticated;

-- 2. Optimizar upsert_paired_sales_delta: usar pg_column_size(v_new_data) O(1)
--    en lugar de octet_length(v_new_data::text) que serializaba 5 MB en cada venta.
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

    IF v_incoming_count > 500 OR pg_column_size(p_records) > 2097152 THEN
        RAISE EXCEPTION 'POS_SYNC_DELTA_BATCH_TOO_LARGE';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.device_pairings pairing
        WHERE pairing.primary_device_id = v_device_id
    ) THEN
        RAISE EXCEPTION 'POS_SYNC_DEVICE_NOT_REGISTERED';
    END IF;

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

    IF v_merged_count < v_existing_count THEN
        RAISE EXCEPTION 'POS_SYNC_DELTA_SHRINK_BLOCKED';
    END IF;
    IF v_merged_cierres < v_existing_cierres THEN
        RAISE EXCEPTION 'POS_SYNC_DELTA_CIERRES_SHRINK_BLOCKED';
    END IF;

    v_new_data := jsonb_build_object('payload', v_merged_payload);
    IF pg_column_size(v_new_data) > 16777216 THEN
        RAISE EXCEPTION 'POS_SYNC_DOCUMENT_TOO_LARGE';
    END IF;

    UPDATE public.sync_documents
       SET data = v_new_data,
           updated_at = now()
     WHERE id = v_doc_id
    RETURNING updated_at INTO v_updated_at;

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
