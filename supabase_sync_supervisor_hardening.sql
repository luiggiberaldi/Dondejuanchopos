-- supabase_sync_supervisor_hardening.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Auditoría de sincronización Monitor ↔ Caja — endurecimiento del canal.
-- Cubre S1, S2, S3, S6 y S7 de PLAN_FIXES_SYNC_SUPERVISOR.md.
--
-- IDEMPOTENTE: puede ejecutarse tantas veces como haga falta.
-- ORDEN DE EJECUCIÓN: después de supabase_pairing_setup.sql,
--                     supabase_multisupervisor_setup.sql y
--                     supabase_supervisor_commands_setup.sql.
--
-- CONTEXTO: la aplicación opera íntegramente como el rol `anon` (no hay sesión
-- de Supabase Auth). La autorización se deriva de las filas de device_pairings
-- y device_monitors. Por eso ninguna RPC concedida a `anon` puede CREAR una
-- autorización: solo puede consumir una que ya exista.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- S1 — touch_pos_heartbeat deja de poder crear filas de emparejamiento.
--      Antes: INSERT ... ON CONFLICT DO UPDATE  → cualquier anon se autoconcedía
--             una fila en device_pairings y con ella acceso total a esa caja.
--      Ahora: UPDATE puro. Si la caja no está registrada, devuelve success:false
--             y la app debe pasar por el flujo de emparejamiento normal.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.touch_pos_heartbeat(p_device_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rows INT;
BEGIN
    IF p_device_id IS NULL OR btrim(p_device_id) = '' THEN
        RETURN json_build_object('success', false, 'message', 'device_id requerido.');
    END IF;

    UPDATE public.device_pairings
    SET last_seen_at = now()
    WHERE primary_device_id = p_device_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows = 0 THEN
        -- S1: NO se crea la fila. Una caja sin registro previo no obtiene
        -- autorización por el simple hecho de latir.
        RETURN json_build_object('success', false, 'registered', false,
                                 'message', 'Dispositivo no registrado.');
    END IF;

    RETURN json_build_object('success', true, 'registered', true);
END; $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S1b — La caja se autorregistra UNA sola vez, de forma explícita y sin token.
--       Se separa del heartbeat para que el registro sea un acto deliberado y
--       auditable, y para que no ocurra en cada latido.
--       Sigue siendo alcanzable por anon (la caja no tiene otra identidad), pero
--       ya no es un efecto colateral silencioso: solo crea la fila si NO existe.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.register_pos_device(p_device_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_device_id IS NULL OR btrim(p_device_id) = '' THEN
        RETURN json_build_object('success', false, 'message', 'device_id requerido.');
    END IF;

    INSERT INTO public.device_pairings (primary_device_id, last_seen_at, paired_at)
    VALUES (p_device_id, now(), now())
    ON CONFLICT (primary_device_id) DO UPDATE
    SET last_seen_at = now();

    RETURN json_build_object('success', true);
END; $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S2 — is_authorized_monitor sin comodines.
--      Antes terminaba en `OR EXISTS (SELECT 1 FROM device_pairings dp
--      WHERE dp.primary_device_id = p_primary)`, que ignora al monitor por
--      completo y hace que la función devuelva true para cualquiera.
--      También aceptaba p_monitor='monitor_web' y monitor_device_id IS NULL.
--      Ahora exige una pertenencia real y vigente.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.is_authorized_monitor(p_primary TEXT, p_monitor TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT
        p_primary IS NOT NULL
        AND p_monitor IS NOT NULL
        AND btrim(p_monitor) <> ''
        AND (
            -- Monitor multisupervisor vigente de esa caja
            EXISTS (
                SELECT 1 FROM public.device_monitors dm
                WHERE dm.primary_device_id = p_primary
                  AND dm.monitor_device_id = p_monitor
                  AND dm.revoked_at IS NULL
            )
            -- Monitor legacy 1-a-1, par exacto
            OR EXISTS (
                SELECT 1 FROM public.device_pairings dp
                WHERE dp.primary_device_id = p_primary
                  AND dp.monitor_device_id = p_monitor
            )
            -- La propia caja actuando sobre sus comandos
            OR p_primary = p_monitor
        );
$$;

GRANT EXECUTE ON FUNCTION public.is_authorized_monitor(TEXT, TEXT) TO anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- S3 — Se elimina el auto-healing que entrega la caja más activa del sistema.
--      Antes, si la caja solicitante estaba inactiva > 1 día, ambas funciones
--      caían a `SELECT device_id FROM sync_documents ORDER BY updated_at DESC
--      LIMIT 1` — es decir, la caja más activa de CUALQUIER tienda.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.generate_monitor_token(p_requester_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_primary TEXT;
    v_token   TEXT;
BEGIN
    IF p_requester_id IS NULL OR btrim(p_requester_id) = '' THEN
        RETURN json_build_object('success', false, 'message', 'Solicitante no válido.');
    END IF;

    -- El solicitante debe ser la caja misma o un monitor vigente de esa caja.
    SELECT primary_device_id INTO v_primary
    FROM public.device_monitors
    WHERE monitor_device_id = p_requester_id AND revoked_at IS NULL
    LIMIT 1;

    IF v_primary IS NULL THEN
        SELECT primary_device_id INTO v_primary
        FROM public.device_pairings
        WHERE primary_device_id = p_requester_id;
    END IF;

    -- S3: sin fallback global. Si no hay pertenencia, se rechaza.
    IF v_primary IS NULL THEN
        RETURN json_build_object('success', false,
            'message', 'No autorizado para generar códigos de vinculación.');
    END IF;

    v_token := upper(substring(md5(random()::text) from 1 for 6));

    UPDATE public.device_pairings
    SET pairing_token = v_token,
        token_expires_at = now() + interval '10 minutes'
    WHERE primary_device_id = v_primary;

    RETURN json_build_object('success', true, 'token', v_token,
                             'primary_device_id', v_primary);
END; $$;

CREATE OR REPLACE FUNCTION public.pair_additional_monitor(
    p_token TEXT,
    p_monitor_device_id TEXT,
    p_label TEXT DEFAULT 'Supervisor Remoto',
    p_user_agent TEXT DEFAULT NULL
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_primary      TEXT;
    v_active_count INT;
BEGIN
    IF p_monitor_device_id IS NULL OR btrim(p_monitor_device_id) = '' THEN
        RETURN json_build_object('success', false, 'message', 'Dispositivo no válido.');
    END IF;

    SELECT primary_device_id INTO v_primary
    FROM public.device_pairings
    WHERE pairing_token = upper(btrim(p_token))
      AND token_expires_at > now();

    -- S3: sin auto-healing. Token inválido o expirado = rechazo.
    IF v_primary IS NULL THEN
        RETURN json_build_object('success', false,
            'message', 'Código de vinculación inválido o expirado.');
    END IF;

    SELECT count(*) INTO v_active_count
    FROM public.device_monitors
    WHERE primary_device_id = v_primary
      AND revoked_at IS NULL
      AND monitor_device_id != p_monitor_device_id;

    IF v_active_count >= 4 THEN
        RETURN json_build_object('success', false,
            'message', 'Límite de monitores activos alcanzado (máximo 4 por caja).');
    END IF;

    INSERT INTO public.device_monitors
        (primary_device_id, monitor_device_id, device_label, user_agent,
         paired_at, last_seen_at, revoked_at)
    VALUES
        (v_primary, p_monitor_device_id,
         COALESCE(nullif(btrim(p_label), ''), 'Supervisor Remoto'),
         p_user_agent, now(), now(), NULL)
    ON CONFLICT (primary_device_id, monitor_device_id) DO UPDATE
    SET device_label = COALESCE(nullif(btrim(EXCLUDED.device_label), ''),
                                device_monitors.device_label),
        user_agent   = COALESCE(EXCLUDED.user_agent, device_monitors.user_agent),
        last_seen_at = now(),
        revoked_at   = NULL;

    UPDATE public.device_pairings
    SET monitor_device_id = p_monitor_device_id,
        paired_at = now()
    WHERE primary_device_id = v_primary
      AND (monitor_device_id IS NULL OR monitor_device_id = p_monitor_device_id);

    -- Consumir el token: un token = un emparejamiento.
    UPDATE public.device_pairings
    SET pairing_token = NULL, token_expires_at = NULL
    WHERE primary_device_id = v_primary;

    RETURN json_build_object('success', true, 'primary_device_id', v_primary);
END; $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S7 — La revocación se vuelve exigible.
--      Antes, un dispositivo desconocido recibía is_revoked:false ("no revocar
--      por defecto"), de modo que borrar la fila NO expulsaba al monitor.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.touch_monitor_heartbeat(p_monitor_device_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target_id UUID;
    v_revoked   TIMESTAMPTZ;
BEGIN
    IF p_monitor_device_id IS NULL OR btrim(p_monitor_device_id) = '' THEN
        RETURN json_build_object('success', false, 'is_revoked', true);
    END IF;

    SELECT id, revoked_at INTO v_target_id, v_revoked
    FROM public.device_monitors
    WHERE monitor_device_id = p_monitor_device_id
    ORDER BY (revoked_at IS NULL) DESC, last_seen_at DESC
    LIMIT 1;

    IF v_target_id IS NOT NULL THEN
        IF v_revoked IS NOT NULL THEN
            RETURN json_build_object('success', true, 'is_revoked', true);
        END IF;

        UPDATE public.device_monitors SET last_seen_at = now() WHERE id = v_target_id;
        RETURN json_build_object('success', true, 'is_revoked', false);
    END IF;

    -- Monitor legacy 1-a-1 registrado en device_pairings.
    IF EXISTS (
        SELECT 1 FROM public.device_pairings
        WHERE monitor_device_id = p_monitor_device_id
    ) THEN
        RETURN json_build_object('success', true, 'is_revoked', false);
    END IF;

    -- S7: desconocido = revocado. Es la única forma de que expulsar funcione.
    RETURN json_build_object('success', true, 'is_revoked', true);
END; $$;

-- S7b — unpair_monitor marca revoked_at para que device_monitors no siga
--       autorizando al dispositivo desvinculado.
--
-- La versión de supabase_pairing_setup.sql era RETURNS VOID y Postgres no permite
-- cambiar el tipo de retorno con CREATE OR REPLACE (42P13). El DROP es obligatorio
-- y va antes del GRANT de más abajo, que vuelve a conceder EXECUTE a anon.
DROP FUNCTION IF EXISTS public.unpair_monitor(TEXT);

CREATE OR REPLACE FUNCTION public.unpair_monitor(p_device_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_monitor TEXT;
BEGIN
    SELECT monitor_device_id INTO v_monitor
    FROM public.device_pairings
    WHERE primary_device_id = p_device_id;

    UPDATE public.device_pairings
    SET monitor_device_id = NULL,
        pairing_token = NULL,
        token_expires_at = NULL
    WHERE primary_device_id = p_device_id;

    -- S7: la desvinculación debe revocar también en device_monitors.
    UPDATE public.device_monitors
    SET revoked_at = now()
    WHERE primary_device_id = p_device_id
      AND revoked_at IS NULL;

    RETURN json_build_object('success', true, 'unpaired_monitor', v_monitor);
END; $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Permisos (idempotentes)
-- ═════════════════════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION public.touch_pos_heartbeat(TEXT)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_pos_device(TEXT)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_monitor_token(TEXT)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_monitor_heartbeat(TEXT)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unpair_monitor(TEXT)           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pair_additional_monitor(TEXT, TEXT, TEXT, TEXT)
    TO anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- S6 — RLS de supervisor_commands ligada al par caja↔monitor real.
--      Antes bastaba que existiera la caja en device_pairings; ahora se exige
--      que el lector/escritor sea la propia caja o un monitor vigente de ella.
--      is_authorized_monitor ya está endurecida por S2 y es SECURITY DEFINER,
--      así que puede leer device_monitors aunque anon no tenga SELECT directo.
-- ═════════════════════════════════════════════════════════════════════════════

-- Lectura: la caja lee lo suyo; el monitor lee lo que él mismo emitió.
DROP POLICY IF EXISTS "supervisor_commands_pair_select" ON public.supervisor_commands;
CREATE POLICY "supervisor_commands_pair_select" ON public.supervisor_commands
    FOR SELECT
    TO anon, authenticated
    USING (
        public.is_authorized_monitor(
            supervisor_commands.primary_device_id,
            supervisor_commands.monitor_device_id
        )
    );

-- Escritura de status: solo la caja destinataria cierra sus comandos.
-- El monitor NO puede marcar 'applied'; solo puede cancelar los suyos (FX03).
DROP POLICY IF EXISTS "supervisor_commands_pair_update" ON public.supervisor_commands;
CREATE POLICY "supervisor_commands_pair_update" ON public.supervisor_commands
    FOR UPDATE
    TO anon, authenticated
    USING (
        public.is_authorized_monitor(
            supervisor_commands.primary_device_id,
            supervisor_commands.monitor_device_id
        )
    )
    WITH CHECK (
        public.is_authorized_monitor(
            supervisor_commands.primary_device_id,
            supervisor_commands.monitor_device_id
        )
    );

-- Inserción: solo un monitor vigente emite comandos hacia su caja.
DROP POLICY IF EXISTS "supervisor_commands_monitor_insert" ON public.supervisor_commands;
CREATE POLICY "supervisor_commands_monitor_insert" ON public.supervisor_commands
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (
        public.is_authorized_monitor(
            supervisor_commands.primary_device_id,
            supervisor_commands.monitor_device_id
        )
        AND supervisor_commands.status = 'pending'
    );

GRANT SELECT, INSERT, UPDATE ON public.supervisor_commands TO anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- D5 — `updated_at` lo escribe el servidor, no el cliente.
--      Antes lo enviaba la caja con su propio reloj mientras el monitor filtraba
--      con el suyo: cualquier desfase descartaba una ventana de escrituras.
--      Con el trigger, ambos lados comparten la referencia temporal de Postgres.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.sync_documents_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_documents_updated_at ON public.sync_documents;
CREATE TRIGGER trg_sync_documents_updated_at
    BEFORE INSERT OR UPDATE ON public.sync_documents
    FOR EACH ROW EXECUTE FUNCTION public.sync_documents_set_updated_at();

ALTER TABLE public.sync_documents
    ALTER COLUMN updated_at SET DEFAULT now();


