-- ============================================================================
-- Intercomunicador: editar un mensaje enviado (como WhatsApp)
-- 2026-11-05 · ver docs/INTERCOMUNICADOR_PUSH_NOTIFICACIONES.md §7
-- Idempotente: se puede ejecutar varias veces.
--
-- Reglas (validadas aquí, no sólo en el cliente):
--   * sólo el dispositivo que envió el mensaje puede editarlo;
--   * sólo durante 15 minutos desde el envío;
--   * el dispositivo debe seguir siendo miembro activo del vínculo;
--   * 1–160 caracteres (mismo CHECK de la tabla).
-- Editar NO envía push: el trigger device_messages_enqueue_push es AFTER INSERT.
-- Los demás equipos reciben el cambio por Realtime (evento UPDATE).
-- ============================================================================

ALTER TABLE public.device_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.intercom_edit_message(
    p_primary TEXT, p_device TEXT, p_message_id UUID, p_message TEXT
)
RETURNS public.device_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_text TEXT := btrim(COALESCE(p_message, ''));
    v_row public.device_messages;
BEGIN
    IF NOT public.intercom_is_active_member(p_primary, p_device) THEN
        RAISE EXCEPTION 'intercom_edit_forbidden' USING ERRCODE = '42501';
    END IF;
    IF char_length(v_text) < 1 OR char_length(v_text) > 160 THEN
        RAISE EXCEPTION 'intercom_edit_invalid_length' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_row FROM public.device_messages
    WHERE id = p_message_id AND primary_device_id = p_primary
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'intercom_edit_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_row.sender_device_id <> p_device THEN
        RAISE EXCEPTION 'intercom_edit_not_owner' USING ERRCODE = '42501';
    END IF;
    IF v_row.created_at < now() - interval '15 minutes' THEN
        RAISE EXCEPTION 'intercom_edit_window_expired' USING ERRCODE = '22023';
    END IF;
    IF v_row.message = v_text THEN
        RETURN v_row; -- sin cambios: no marcar como editado
    END IF;

    UPDATE public.device_messages
    SET message = v_text, edited_at = now()
    WHERE id = p_message_id
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.intercom_edit_message(TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.intercom_edit_message(TEXT, TEXT, UUID, TEXT) TO anon, authenticated, service_role;
