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
          'bodega_employee_consumptions_v1',
          'bodega_employee_payroll_projection_v1',
          'bodega_employees_v1',
          'bodega_payroll_periods_v1',
          'bodega_payroll_settlements_v1',
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
-- DETALLE DE NÓMINA — solo bajo demanda y acotado por empleado/período.
-- El Monitor recibe únicamente la proyección resumida por realtime.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.read_paired_employee_payroll_detail(
    p_primary_device_id TEXT,
    p_monitor_device_id TEXT,
    p_employee_id TEXT,
    p_period_id TEXT
)
RETURNS TABLE (
    employee_id TEXT,
    periodo_id TEXT,
    consumptions JSONB,
    settlements JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
    IF COALESCE(btrim(p_primary_device_id), '') = ''
        OR COALESCE(btrim(p_monitor_device_id), '') = ''
        OR COALESCE(btrim(p_employee_id), '') = ''
        OR COALESCE(p_period_id, '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'REMOTE_PAYROLL_SCOPE_REQUIRED';
    END IF;

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
        RAISE EXCEPTION 'REMOTE_PAYROLL_PAIRING_REQUIRED';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.sync_documents document
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE
                WHEN jsonb_typeof(document.data->'payload') = 'array' THEN document.data->'payload'
                ELSE '[]'::jsonb
            END
        ) item
        WHERE document.device_id = p_primary_device_id
          AND document.doc_id = 'bodega_employees_v1'
          AND item->>'id' = p_employee_id
    ) THEN
        RAISE EXCEPTION 'REMOTE_PAYROLL_EMPLOYEE_NOT_FOUND';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.sync_documents document
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE
                WHEN jsonb_typeof(document.data->'payload') = 'array' THEN document.data->'payload'
                ELSE '[]'::jsonb
            END
        ) item
        WHERE document.device_id = p_primary_device_id
          AND document.doc_id = 'bodega_payroll_periods_v1'
          AND COALESCE(item->>'id', item->>'periodoId') = p_period_id
    ) THEN
        RAISE EXCEPTION 'REMOTE_PAYROLL_PERIOD_NOT_FOUND';
    END IF;

    RETURN QUERY
    SELECT
        p_employee_id,
        p_period_id,
        COALESCE((
            SELECT jsonb_agg(item)
            FROM public.sync_documents document
            CROSS JOIN LATERAL jsonb_array_elements(
                CASE
                    WHEN jsonb_typeof(document.data->'payload') = 'array' THEN document.data->'payload'
                    ELSE '[]'::jsonb
                END
            ) item
            WHERE document.device_id = p_primary_device_id
              AND document.doc_id = 'bodega_employee_consumptions_v1'
              AND item->>'employeeId' = p_employee_id
              AND item->>'periodoId' = p_period_id
        ), '[]'::jsonb),
        COALESCE((
            SELECT jsonb_agg(item)
            FROM public.sync_documents document
            CROSS JOIN LATERAL jsonb_array_elements(
                CASE
                    WHEN jsonb_typeof(document.data->'payload') = 'array' THEN document.data->'payload'
                    ELSE '[]'::jsonb
                END
            ) item
            WHERE document.device_id = p_primary_device_id
              AND document.doc_id = 'bodega_payroll_settlements_v1'
              AND item->>'employeeId' = p_employee_id
              AND item->>'periodoId' = p_period_id
        ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.read_paired_employee_payroll_detail(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_paired_employee_payroll_detail(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

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

-- ═════════════════════════════════════════════════════════════════════════════
-- BACKUP COMPLETO SOLICITADO DESDE EL SUPERVISOR
-- ═════════════════════════════════════════════════════════════════════════════
-- La caja recopila sus claves locales al recibir `request_full_backup` y las
-- publica en cloud_backups mediante estos RPCs. No se concede CRUD a anon sobre
-- cloud_backups ni se retransmiten los documentos pesados por Realtime.

ALTER TABLE public.supervisor_commands
    DROP CONSTRAINT IF EXISTS supervisor_commands_command_type_check;

ALTER TABLE public.supervisor_commands
    ADD CONSTRAINT supervisor_commands_command_type_check
    CHECK (command_type IN (
        'rate_change',
        'inventory_update',
        'void_sale',
        'user_update',
        'force_daily_close',
        'reopen_shift',
        'request_full_backup'
    ));

CREATE OR REPLACE FUNCTION public.write_paired_cloud_backup(
    p_device_id TEXT,
    p_request_id UUID,
    p_backup_data JSONB
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
DECLARE
    v_monitor_device_id TEXT;
BEGIN
    IF COALESCE(btrim(p_device_id), '') = ''
        OR p_request_id IS NULL
        OR p_backup_data IS NULL
        OR jsonb_typeof(p_backup_data) <> 'object' THEN
        RAISE EXCEPTION 'REMOTE_BACKUP_PAYLOAD_REQUIRED';
    END IF;

    IF octet_length(p_backup_data::text) > 8388608 THEN
        RAISE EXCEPTION 'REMOTE_BACKUP_TOO_LARGE';
    END IF;

    SELECT command.monitor_device_id
    INTO v_monitor_device_id
    FROM public.supervisor_commands command
    WHERE command.id = p_request_id
      AND command.primary_device_id = btrim(p_device_id)
      AND command.command_type = 'request_full_backup'
      AND command.status = 'pending'
      AND command.created_at > now() - interval '15 minutes';

    IF v_monitor_device_id IS NULL THEN
        RAISE EXCEPTION 'REMOTE_BACKUP_REQUEST_INVALID';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.device_monitors monitor
        WHERE monitor.primary_device_id = btrim(p_device_id)
          AND monitor.monitor_device_id = v_monitor_device_id
          AND monitor.revoked_at IS NULL
    )
    AND NOT EXISTS (
        SELECT 1
        FROM public.device_pairings pairing
        WHERE pairing.primary_device_id = btrim(p_device_id)
          AND pairing.monitor_device_id = v_monitor_device_id
          AND pairing.paired_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'REMOTE_BACKUP_PAIRING_REQUIRED';
    END IF;

    INSERT INTO public.cloud_backups (device_id, backup_data, updated_at)
    VALUES (btrim(p_device_id), p_backup_data, now())
    ON CONFLICT (device_id)
    DO UPDATE SET backup_data = EXCLUDED.backup_data, updated_at = now();

    RETURN json_build_object(
        'success', true,
        'device_id', btrim(p_device_id),
        'request_id', p_request_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.read_paired_cloud_backup(
    p_primary_device_id TEXT,
    p_monitor_device_id TEXT,
    p_updated_after TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    backup_data JSONB,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
    IF COALESCE(btrim(p_primary_device_id), '') = ''
        OR COALESCE(btrim(p_monitor_device_id), '') = '' THEN
        RAISE EXCEPTION 'REMOTE_BACKUP_SCOPE_REQUIRED';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.device_monitors monitor
        WHERE monitor.primary_device_id = p_primary_device_id
          AND monitor.monitor_device_id = p_monitor_device_id
          AND monitor.revoked_at IS NULL
    )
    AND NOT EXISTS (
        SELECT 1
        FROM public.device_pairings pairing
        WHERE pairing.primary_device_id = p_primary_device_id
          AND pairing.monitor_device_id = p_monitor_device_id
          AND pairing.paired_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'REMOTE_BACKUP_PAIRING_REQUIRED';
    END IF;

    RETURN QUERY
    SELECT backup.backup_data, backup.updated_at
    FROM public.cloud_backups backup
    WHERE backup.device_id = p_primary_device_id
      AND (p_updated_after IS NULL OR backup.updated_at > p_updated_after)
    ORDER BY backup.updated_at DESC
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.write_paired_cloud_backup(TEXT, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.write_paired_cloud_backup(TEXT, UUID, JSONB) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.read_paired_cloud_backup(TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_paired_cloud_backup(TEXT, TEXT, TIMESTAMPTZ) TO anon, authenticated;

-- cloud_backups permanece sin SELECT/INSERT/UPDATE/DELETE directo para anon.
REVOKE ALL ON public.cloud_backups FROM anon;
