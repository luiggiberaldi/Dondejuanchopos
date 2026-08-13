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

-- Mantener la tabla cerrada para el rol anon. La caja autenticada usa su
-- política Auth; el Supervisor solo usa el RPC anterior.
REVOKE SELECT ON public.sync_documents FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.sync_documents FROM anon;
