-- ============================================================================
-- FASE 2 del plan de egress — permitir doc_ids de delta diario de ventas
-- ESTADO: NO APLICADO. Requiere aprobación explícita de luigi (es un cambio
-- en la base de producción, aunque sea aditivo y sin tocar datos).
--
-- Qué hace: amplía la whitelist de `write_paired_sync_document` para aceptar
-- `bodega_sales_delta_YYYY-MM-DD` (un doc por día). Sin esto, el push del
-- delta falla con POS_SYNC_DOCUMENT_NOT_ALLOWED.
--
-- Riesgo: mínimo y aditivo — solo AGREGA doc_ids permitidos; el resto de la
-- función queda idéntico (mismo search_path, mismos GRANTs).
-- Aplicar con: psql / Supabase Dashboard > SQL Editor > Run.
-- ============================================================================

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

    -- Mantener tope de 8MB alineado con REMOTE_BACKUP_MAX_BYTES y el compactador proactivo
    IF octet_length(p_data::text) > 8388608 THEN
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
        -- FASE 2 egress: deltas diarios de ventas (doc_id dinámico por día).
        AND p_doc_id NOT LIKE 'bodega_sales_delta\_%'
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
