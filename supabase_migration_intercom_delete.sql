-- ==============================================================================
-- Migración: Borrado selectivo y corrección de permisos en Intercomunicador
-- Proyecto: kcananrtcmckovdstvao.supabase.co
-- Ejecutar en: Supabase Dashboard -> SQL Editor
-- ==============================================================================

-- 1. Reparar permisos de intercom_clear_conversation para el rol anon (PWA cliente)
REVOKE ALL ON FUNCTION public.intercom_clear_conversation(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.intercom_clear_conversation(TEXT, TEXT) TO anon, authenticated, service_role, postgres;

-- 2. Nueva función RPC para borrado selectivo de mensajes por UUID
CREATE OR REPLACE FUNCTION public.intercom_delete_messages(
    p_primary TEXT,
    p_device TEXT,
    p_message_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    IF NOT public.intercom_is_active_member(p_primary, p_device) THEN
        RAISE EXCEPTION 'intercom_delete_forbidden' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.device_messages
    WHERE primary_device_id = p_primary
      AND id = ANY(p_message_ids);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.intercom_delete_messages(TEXT, TEXT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.intercom_delete_messages(TEXT, TEXT, UUID[]) TO anon, authenticated, service_role, postgres;
