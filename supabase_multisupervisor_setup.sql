-- ============================================================================
-- supabase_multisupervisor_setup.sql — Esquema para Gestión Multisupervisor 1-N
-- ============================================================================
-- Soporta múltiples monitores (hasta 4 activos), revocación suave (revoked_at),
-- generación segura de PIN desde monitores y presencia/heartbeat de dispositivos.
-- ============================================================================

-- 1. Tabla de monitores vinculados (1 Caja -> N Monitores)
CREATE TABLE IF NOT EXISTS public.device_monitors (
    id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    primary_device_id  TEXT NOT NULL,
    monitor_device_id  TEXT NOT NULL,
    device_label       TEXT,               -- Nombre legible: "Celular de Juan"
    user_agent         TEXT,               -- User agent del navegador/teléfono
    paired_at          TIMESTAMPTZ DEFAULT now(),
    last_seen_at       TIMESTAMPTZ DEFAULT now(),
    revoked_at         TIMESTAMPTZ,        -- NULL = activo (revocación suave para notificar al cliente)
    UNIQUE (primary_device_id, monitor_device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_monitors_primary
    ON public.device_monitors (primary_device_id, revoked_at);

-- 2. Backfill del monitor existente en device_pairings (compatibilidad sin rotura)
INSERT INTO public.device_monitors (primary_device_id, monitor_device_id, device_label, paired_at)
SELECT primary_device_id, monitor_device_id, 'Supervisor principal', COALESCE(paired_at, now())
FROM public.device_pairings
WHERE monitor_device_id IS NOT NULL
ON CONFLICT (primary_device_id, monitor_device_id) DO NOTHING;

-- 3. RPC: Generar token de vinculación desde Caja o Monitor activo (con auto-healing de caja activa)
CREATE OR REPLACE FUNCTION public.generate_monitor_token(p_requester_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_primary TEXT;
    v_token   TEXT;
BEGIN
    -- El solicitante puede ser la caja misma o un monitor activo de esa caja
    SELECT primary_device_id INTO v_primary
    FROM public.device_monitors
    WHERE monitor_device_id = p_requester_id AND revoked_at IS NULL
    LIMIT 1;

    IF v_primary IS NULL THEN
        SELECT primary_device_id INTO v_primary
        FROM public.device_pairings WHERE primary_device_id = p_requester_id;
    END IF;

    -- Auto-healing: Si la caja solicitante es obsoleta/inactiva (> 1 día sin presencia), redirigir a la caja activa más reciente
    IF v_primary IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.device_pairings 
        WHERE primary_device_id = v_primary 
          AND last_seen_at > now() - interval '1 day'
    ) THEN
        SELECT device_id INTO v_primary
        FROM public.sync_documents
        WHERE doc_id = 'bodega_sales_v1'
        ORDER BY updated_at DESC
        LIMIT 1;
    END IF;

    IF v_primary IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'No se encontró ninguna caja activa en el sistema.');
    END IF;

    v_token := upper(substring(md5(random()::text) from 1 for 6));

    INSERT INTO public.device_pairings (primary_device_id, pairing_token, token_expires_at, paired_at, last_seen_at)
    VALUES (v_primary, v_token, now() + interval '10 minutes', now(), now())
    ON CONFLICT (primary_device_id) DO UPDATE
    SET pairing_token = v_token,
        token_expires_at = now() + interval '10 minutes';

    RETURN json_build_object('success', true, 'token', v_token, 'primary_device_id', v_primary);
END; $$;

-- 4. RPC: Vincular monitor adicional (con auto-healing de caja activa)
CREATE OR REPLACE FUNCTION public.pair_additional_monitor(
    p_token TEXT,
    p_monitor_device_id TEXT,
    p_label TEXT DEFAULT 'Supervisor Remoto',
    p_user_agent TEXT DEFAULT NULL
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_primary TEXT;
    v_active_count INT;
BEGIN
    -- Validar token en device_pairings
    SELECT primary_device_id INTO v_primary
    FROM public.device_pairings
    WHERE pairing_token = upper(trim(p_token))
      AND token_expires_at > now();

    IF v_primary IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Código de vinculación inválido o expirado.');
    END IF;

    -- Auto-healing: Si el token apunta a una caja inactiva (> 1 día), re-vincular a la caja activa más reciente
    IF NOT EXISTS (
        SELECT 1 FROM public.device_pairings 
        WHERE primary_device_id = v_primary 
          AND last_seen_at > now() - interval '1 day'
    ) THEN
        SELECT device_id INTO v_primary
        FROM public.sync_documents
        WHERE doc_id = 'bodega_sales_v1'
        ORDER BY updated_at DESC
        LIMIT 1;
    END IF;

    -- Validar tope de 4 monitores activos por caja (D2)
    SELECT count(*) INTO v_active_count
    FROM public.device_monitors
    WHERE primary_device_id = v_primary
      AND revoked_at IS NULL
      AND monitor_device_id != p_monitor_device_id;

    IF v_active_count >= 4 THEN
        RETURN json_build_object('success', false, 'message', 'Límite de monitores activos alcanzado (máximo 4 por caja).');
    END IF;

    -- Registrar o reactivar monitor
    INSERT INTO public.device_monitors (primary_device_id, monitor_device_id, device_label, user_agent, paired_at, last_seen_at, revoked_at)
    VALUES (v_primary, p_monitor_device_id, COALESCE(nullif(trim(p_label), ''), 'Supervisor Remoto'), p_user_agent, now(), now(), NULL)
    ON CONFLICT (primary_device_id, monitor_device_id) DO UPDATE
    SET primary_device_id = EXCLUDED.primary_device_id,
        device_label = COALESCE(nullif(trim(EXCLUDED.device_label), ''), device_monitors.device_label),
        user_agent = COALESCE(EXCLUDED.user_agent, device_monitors.user_agent),
        last_seen_at = now(),
        revoked_at = NULL;

    -- Mantener compatibilidad con el primer monitor en device_pairings
    UPDATE public.device_pairings
    SET monitor_device_id = p_monitor_device_id,
        paired_at = now()
    WHERE primary_device_id = v_primary
      AND (monitor_device_id IS NULL OR monitor_device_id = p_monitor_device_id);

    RETURN json_build_object('success', true, 'primary_device_id', v_primary);
END; $$;

-- 5. RPC: Revocar acceso a un monitor específico
CREATE OR REPLACE FUNCTION public.revoke_monitor(
    p_requester_id TEXT,
    p_target_monitor_id TEXT
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_primary TEXT;
BEGIN
    -- Validar que el solicitante sea la caja o un monitor activo de la misma caja
    SELECT primary_device_id INTO v_primary
    FROM public.device_monitors
    WHERE monitor_device_id = p_requester_id AND revoked_at IS NULL
    LIMIT 1;

    IF v_primary IS NULL THEN
        SELECT primary_device_id INTO v_primary
        FROM public.device_pairings WHERE primary_device_id = p_requester_id;
    END IF;

    IF v_primary IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'No autorizado para revocar accesos.');
    END IF;

    UPDATE public.device_monitors
    SET revoked_at = now()
    WHERE primary_device_id = v_primary AND monitor_device_id = p_target_monitor_id;

    RETURN json_build_object('success', true);
END; $$;

-- 6. RPC: Touch Heartbeat de presencia del monitor (Devuelve estado de revocación)
CREATE OR REPLACE FUNCTION public.touch_monitor_heartbeat(
    p_monitor_device_id TEXT
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_target_id UUID;
    v_revoked   TIMESTAMPTZ;
BEGIN
    -- Seleccionar la fila más reciente (preferir no revocada) para evitar 'query returned more than one row'
    SELECT id, revoked_at INTO v_target_id, v_revoked
    FROM public.device_monitors
    WHERE monitor_device_id = p_monitor_device_id
    ORDER BY (revoked_at IS NULL) DESC, last_seen_at DESC
    LIMIT 1;

    IF v_target_id IS NOT NULL THEN
        UPDATE public.device_monitors
        SET last_seen_at = now()
        WHERE id = v_target_id;

        RETURN json_build_object('success', true, 'is_revoked', (v_revoked IS NOT NULL));
    END IF;

    -- Si no está en device_monitors pero está en device_pairings (legacy o principal)
    IF EXISTS (
        SELECT 1 FROM public.device_pairings 
        WHERE monitor_device_id = p_monitor_device_id 
           OR primary_device_id = p_monitor_device_id
    ) THEN
        RETURN json_build_object('success', true, 'is_revoked', false);
    END IF;

    -- No revocar por defecto a dispositivos nuevos o manuales
    RETURN json_build_object('success', true, 'is_revoked', false);
END; $$;

-- 7. RPC: Listar monitores activos pertenecientes a la misma caja (FX6)
CREATE OR REPLACE FUNCTION public.list_monitors(p_requester_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_primary TEXT;
BEGIN
    -- Validar que el solicitante sea la caja o un monitor activo de la misma caja
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
            SELECT id, monitor_device_id, device_label, user_agent, paired_at, last_seen_at
            FROM public.device_monitors
            WHERE primary_device_id = v_primary AND revoked_at IS NULL
        ) t
    ), '[]'::json));
END; $$;

-- 8. Columna dedicada y RPC: Heartbeat de presencia de la caja principal (FP2)
ALTER TABLE public.device_pairings ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.touch_pos_heartbeat(p_device_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.device_pairings (primary_device_id, last_seen_at, paired_at)
    VALUES (p_device_id, now(), now())
    ON CONFLICT (primary_device_id) DO UPDATE
    SET last_seen_at = now();

    RETURN json_build_object('success', true);
END; $$;

-- 9. RLS y Permisos
ALTER TABLE public.device_monitors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir lectura publica de device_monitors" ON public.device_monitors;
-- Eliminar acceso directo SELECT de anon sobre device_monitors (FX6: la lectura segura se hace vía list_monitors)

GRANT EXECUTE ON FUNCTION public.generate_monitor_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pair_additional_monitor(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_monitor(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_monitor_heartbeat(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_monitors(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_pos_heartbeat(TEXT) TO anon, authenticated;
