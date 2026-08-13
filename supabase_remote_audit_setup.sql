-- ============================================================================
-- SUPERVISOR REMOTE AUDIT — READ-ONLY RPC
-- ============================================================================
-- Ejecutar en el proyecto que contiene sync_documents y device_pairings.
-- No abre SELECT directo para anon: la lectura pasa por pairing + whitelist.
-- Requiere que supabase_pairing_setup.sql haya creado device_pairings y que
-- supabase_multisupervisor_setup.sql haya creado device_monitors cuando se
-- utilice el modelo multisupervisor.
-- Esta versión usa un cursor opcional para que el monitor no retransmita
-- históricos completos durante cada reconexión.

-- El script anterior creó la firma de tres argumentos. Se elimina para evitar
-- que el RPC incremental quede ambiguo después de aplicar esta migración.
DROP FUNCTION IF EXISTS public.read_paired_audit_documents(TEXT, TEXT, TEXT[]);

CREATE OR REPLACE FUNCTION public.read_paired_audit_documents(
    p_primary_device_id TEXT,
    p_monitor_device_id TEXT,
    p_doc_ids TEXT[],
    p_updated_after TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    collection TEXT,
    doc_id TEXT,
    data JSONB,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
    IF COALESCE(trim(p_primary_device_id), '') = ''
        OR COALESCE(trim(p_monitor_device_id), '') = ''
        OR p_doc_ids IS NULL THEN
        RAISE EXCEPTION 'REMOTE_AUDIT_SCOPE_REQUIRED';
    END IF;

    -- Aceptar tanto el vínculo legacy 1-1 como el modelo multisupervisor 1-N.
    -- Los monitores añadidos por pair_additional_monitor viven en
    -- device_monitors y no necesariamente reemplazan monitor_device_id en
    -- device_pairings.
    IF NOT EXISTS (
        SELECT 1
        FROM public.device_pairings pairing
        WHERE pairing.primary_device_id = p_primary_device_id
          AND pairing.monitor_device_id = p_monitor_device_id
          AND pairing.paired_at IS NOT NULL
    )
    AND NOT EXISTS (
        SELECT 1
        FROM public.device_monitors monitor
        WHERE monitor.primary_device_id = p_primary_device_id
          AND monitor.monitor_device_id = p_monitor_device_id
          AND monitor.revoked_at IS NULL
    ) THEN
        RAISE EXCEPTION 'REMOTE_AUDIT_PAIRING_REQUIRED';
    END IF;

    RETURN QUERY
    SELECT document.collection, document.doc_id, document.data, document.updated_at
    FROM public.sync_documents document
    WHERE document.device_id = p_primary_device_id
      AND document.doc_id = ANY (p_doc_ids)
      AND (p_updated_after IS NULL OR document.updated_at > p_updated_after)
      AND document.doc_id IN (
          -- IDB_KEYS canónicas
          'abasto_audit_log_v1',
          'bodega_accounts_v2',
          'bodega_customers_v1',
          'bodega_kardex_snapshots_v1',
          'bodega_kardex_v1',
          'bodega_inventory_operations_v1',
          'bodega_payment_methods_v1',
          'bodega_pending_cart_v1',
          'bodega_products_v1',
          'bodega_sales_mirror_v1',
          'bodega_sales_v1',
          'bodega_supplier_invoices_v1',
          'bodega_suppliers_v1',
          'my_categories_v1',
          -- LS_KEYS permitidas; premium_token y sesiones quedan fuera
          'allow_negative_stock',
          'auto_cop_enabled',
          'bodega_custom_rate',
          'bodega_inventory_view',
          'bodega_use_auto_rate',
          'bodega_rate_mode',
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
    ORDER BY document.updated_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.read_paired_audit_documents(TEXT, TEXT, TEXT[], TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_paired_audit_documents(TEXT, TEXT, TEXT[], TIMESTAMPTZ) TO anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- POS WRITE — La caja opera como `anon`, pero no recibe CRUD directo sobre la
-- tabla. Este RPC es la única ruta de escritura: exige una caja registrada,
-- whitelist de documentos y tamaño máximo; nunca concede lectura.
-- ═════════════════════════════════════════════════════════════════════════════
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

    -- Mantener el mismo tope duro que el cliente para evitar documentos
    -- desbocados y respuestas/Realtime excesivos.
    IF octet_length(p_data::text) > 2097152 THEN
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

REVOKE ALL ON FUNCTION public.write_paired_sync_document(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.write_paired_sync_document(TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;

-- Mantener la tabla cerrada para el rol anon. La caja escribe únicamente por el
-- RPC anterior; el Supervisor lee únicamente por read_paired_audit_documents.
REVOKE SELECT ON public.sync_documents FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.sync_documents FROM anon;
