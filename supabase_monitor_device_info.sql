-- ============================================================================
-- Dispositivos vinculados: modelo, sistema operativo y nombre editable
-- 2026-11-05 · ver docs/DISPOSITIVOS_VINCULADOS_NOMBRE_Y_MODELO.md
-- Idempotente: se puede ejecutar varias veces.
-- ============================================================================

ALTER TABLE public.device_monitors ADD COLUMN IF NOT EXISTS device_platform TEXT;
ALTER TABLE public.device_monitors ADD COLUMN IF NOT EXISTS device_model TEXT;

-- list_monitors: misma autorización que antes, ahora devuelve plataforma y modelo.
CREATE OR REPLACE FUNCTION public.list_monitors(p_requester_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
    v_primary TEXT;
BEGIN
    SELECT primary_device_id INTO v_primary
    FROM public.device_monitors
    WHERE monitor_device_id = p_requester_id AND revoked_at IS NULL
    LIMIT 1;

    IF v_primary IS NULL THEN
        SELECT primary_device_id INTO v_primary
        FROM public.device_pairings WHERE primary_device_id = p_requester_id;
    END IF;

    IF v_primary IS NULL THEN
        RETURN json_build_object('success', false, 'devices', '[]'::json);
    END IF;

    RETURN json_build_object('success', true, 'devices', COALESCE((
        SELECT json_agg(row_to_json(t) ORDER BY t.paired_at)
        FROM (
            SELECT id, monitor_device_id, device_label, user_agent, device_platform, device_model,
                   paired_at, last_seen_at
            FROM public.device_monitors
            WHERE primary_device_id = v_primary AND revoked_at IS NULL
        ) t
    ), '[]'::json));
END; $function$;

-- Renombrar un dispositivo vinculado. Autoriza igual que revoke_monitor: la caja
-- o cualquier monitor activo del mismo vínculo.
CREATE OR REPLACE FUNCTION public.rename_monitor(p_requester_id text, p_target_monitor_id text, p_label text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
    v_primary TEXT;
    v_label TEXT := btrim(regexp_replace(COALESCE(p_label, ''), '\s+', ' ', 'g'));
    v_updated INTEGER;
BEGIN
    IF char_length(v_label) < 1 OR char_length(v_label) > 40 THEN
        RETURN json_build_object('success', false, 'message', 'El nombre debe tener entre 1 y 40 caracteres.');
    END IF;

    SELECT primary_device_id INTO v_primary
    FROM public.device_monitors
    WHERE monitor_device_id = p_requester_id AND revoked_at IS NULL
    LIMIT 1;

    IF v_primary IS NULL THEN
        SELECT primary_device_id INTO v_primary
        FROM public.device_pairings WHERE primary_device_id = p_requester_id;
    END IF;

    IF v_primary IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'No autorizado para renombrar dispositivos.');
    END IF;

    UPDATE public.device_monitors
    SET device_label = v_label
    WHERE primary_device_id = v_primary
      AND monitor_device_id = p_target_monitor_id
      AND revoked_at IS NULL;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 0 THEN
        RETURN json_build_object('success', false, 'message', 'Dispositivo no encontrado en este vínculo.');
    END IF;

    -- Los mensajes ya enviados por este dispositivo en este vínculo pasan a mostrar
    -- el nombre nuevo. El trigger de push es AFTER INSERT, así que esto no notifica.
    UPDATE public.device_messages
    SET sender_name = v_label
    WHERE primary_device_id = v_primary
      AND sender_device_id = p_target_monitor_id
      AND sender_name IS DISTINCT FROM v_label;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    RETURN json_build_object('success', true, 'device_label', v_label, 'messages_renamed', v_updated);
END; $function$;

-- Cada monitor reporta su propio sistema/modelo (obtenidos con userAgentData en el
-- navegador, porque el user agent reducido de Chrome oculta el modelo).
CREATE OR REPLACE FUNCTION public.report_monitor_device_info(
    p_monitor_device_id text, p_platform text, p_model text, p_user_agent text
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
BEGIN
    UPDATE public.device_monitors
    SET device_platform = NULLIF(left(btrim(COALESCE(p_platform, '')), 40), ''),
        device_model    = NULLIF(left(btrim(COALESCE(p_model, '')), 60), ''),
        user_agent      = COALESCE(NULLIF(left(COALESCE(p_user_agent, ''), 200), ''), user_agent)
    WHERE monitor_device_id = p_monitor_device_id AND revoked_at IS NULL;
    RETURN json_build_object('success', FOUND);
END; $function$;

REVOKE ALL ON FUNCTION public.rename_monitor(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.report_monitor_device_info(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rename_monitor(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_monitor_device_info(text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_monitors(text) TO anon, authenticated, service_role;
