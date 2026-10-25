-- Intercomunicador MVP de solo texto.
-- Ejecutar en Cloud/Sync: https://kcananrtcmckovdstvao.supabase.co
-- Proyecto confirmado por el usuario; no ejecutar en staging ni en el proyecto de licencias.
-- Requiere que pairing + multisupervisor estén instalados previamente.
-- No se aplica a ningún proyecto desde el repositorio.
-- Habilitar pg_cron y pg_net antes de instalar si se requiere purge y Web Push.
-- Validar la zona horaria efectiva del scheduler. No usar chat para datos sensibles.
-- El cliente usa el JWT anon compartido: RLS valida los IDs declarados, pero no prueba
-- la identidad física del llamante. No es un límite de seguridad contra clientes hostiles.

CREATE TABLE IF NOT EXISTS public.device_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    primary_device_id TEXT NOT NULL,
    sender_device_id TEXT NOT NULL,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('pos', 'monitor')),
    sender_name TEXT NOT NULL CHECK (char_length(sender_name) BETWEEN 1 AND 80),
    message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 160),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_messages_history_idx
    ON public.device_messages (primary_device_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS device_messages_retention_idx
    ON public.device_messages (created_at);

CREATE TABLE IF NOT EXISTS public.device_message_reads (
    primary_device_id TEXT NOT NULL,
    reader_device_id TEXT NOT NULL,
    last_read_at TIMESTAMPTZ NOT NULL,
    last_read_message_id UUID NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (primary_device_id, reader_device_id)
);

CREATE TABLE IF NOT EXISTS public.device_push_subscriptions (
    device_id TEXT PRIMARY KEY,
    primary_device_id TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS device_push_subscriptions_primary_idx
    ON public.device_push_subscriptions (primary_device_id, revoked_at);

ALTER TABLE public.device_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.device_message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_message_reads FORCE ROW LEVEL SECURITY;
ALTER TABLE public.device_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_push_subscriptions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_messages FROM PUBLIC;
REVOKE ALL ON public.device_message_reads FROM PUBLIC;
REVOKE ALL ON public.device_push_subscriptions FROM PUBLIC;
GRANT SELECT, INSERT ON public.device_messages TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.device_message_reads TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_push_subscriptions TO anon, authenticated, service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.device_messages FROM anon, authenticated;
REVOKE DELETE, TRUNCATE ON public.device_message_reads FROM anon, authenticated;
REVOKE TRUNCATE ON public.device_push_subscriptions FROM anon, authenticated;

-- Pairing gate supports legacy 1:1 links and the active multisupervisor table.
CREATE OR REPLACE FUNCTION public.intercom_pair_is_active(p_primary TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p_primary IS NOT NULL AND (
        EXISTS (
            SELECT 1 FROM public.device_pairings dp
            WHERE dp.primary_device_id = p_primary
              AND dp.paired_at IS NOT NULL
              AND dp.monitor_device_id IS NOT NULL
        )
        OR EXISTS (
            SELECT 1 FROM public.device_monitors dm
            WHERE dm.primary_device_id = p_primary
              AND dm.revoked_at IS NULL
        )
    );
$$;
REVOKE ALL ON FUNCTION public.intercom_pair_is_active(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.intercom_pair_is_active(TEXT) TO anon, authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.intercom_is_active_member(p_primary TEXT, p_device TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p_primary IS NOT NULL AND p_device IS NOT NULL
        AND (
            p_device = p_primary
            OR EXISTS (
                SELECT 1 FROM public.device_monitors dm
                WHERE dm.primary_device_id = p_primary
                  AND dm.monitor_device_id = p_device
                  AND dm.revoked_at IS NULL
            )
            OR EXISTS (
                SELECT 1 FROM public.device_pairings dp
                WHERE dp.primary_device_id = p_primary
                  AND dp.monitor_device_id = p_device
                  AND dp.paired_at IS NOT NULL
            )
        );
$$;
REVOKE ALL ON FUNCTION public.intercom_is_active_member(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.intercom_is_active_member(TEXT, TEXT) TO anon, authenticated, service_role, postgres;

-- Edge Function uses this list to omit subscriptions belonging to revoked monitors.
CREATE OR REPLACE FUNCTION public.intercom_active_members(p_primary TEXT)
RETURNS TABLE(device_id TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p_primary
    WHERE public.intercom_pair_is_active(p_primary)
    UNION
    SELECT dm.monitor_device_id
    FROM public.device_monitors dm
    WHERE dm.primary_device_id = p_primary AND dm.revoked_at IS NULL
    UNION
    SELECT dp.monitor_device_id
    FROM public.device_pairings dp
    WHERE dp.primary_device_id = p_primary
      AND dp.paired_at IS NOT NULL
      AND dp.monitor_device_id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.intercom_active_members(TEXT) FROM PUBLIC, anon, authenticated;    GRANT EXECUTE ON FUNCTION public.intercom_active_members(TEXT) TO service_role, postgres;

-- Borrado manual de la conversación. Sólo un miembro activo del vínculo puede
-- borrar; anon/authenticated no tienen DELETE directo sobre device_messages.
CREATE OR REPLACE FUNCTION public.intercom_clear_conversation(p_primary TEXT, p_device TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    IF NOT public.intercom_is_active_member(p_primary, p_device) THEN
        RAISE EXCEPTION 'intercom_clear_forbidden' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.device_message_reads WHERE primary_device_id = p_primary;
    DELETE FROM public.device_messages WHERE primary_device_id = p_primary;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.intercom_clear_conversation(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.intercom_clear_conversation(TEXT, TEXT) TO anon, authenticated, service_role, postgres;

-- Borrado selectivo de mensajes de la conversación.
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

-- Remove any older permissive policies from earlier drafts before adding member checks.
DROP POLICY IF EXISTS intercom_messages_select_active_pair ON public.device_messages;
DROP POLICY IF EXISTS intercom_messages_insert_active_pair ON public.device_messages;
DROP POLICY IF EXISTS intercom_reads_select_active_pair ON public.device_message_reads;
DROP POLICY IF EXISTS intercom_reads_insert_active_pair ON public.device_message_reads;
DROP POLICY IF EXISTS intercom_reads_update_active_pair ON public.device_message_reads;
DROP POLICY IF EXISTS intercom_push_select_active_pair ON public.device_push_subscriptions;
DROP POLICY IF EXISTS intercom_push_insert_active_pair ON public.device_push_subscriptions;
DROP POLICY IF EXISTS intercom_push_update_active_pair ON public.device_push_subscriptions;
DROP POLICY IF EXISTS intercom_push_delete_active_pair ON public.device_push_subscriptions;

DROP POLICY IF EXISTS intercom_messages_member_select ON public.device_messages;
CREATE POLICY intercom_messages_member_select ON public.device_messages
    FOR SELECT TO anon, authenticated
    USING (public.intercom_is_active_member(primary_device_id, sender_device_id));
DROP POLICY IF EXISTS intercom_messages_member_insert ON public.device_messages;
CREATE POLICY intercom_messages_member_insert ON public.device_messages
    FOR INSERT TO anon, authenticated
    WITH CHECK (public.intercom_is_active_member(primary_device_id, sender_device_id));

DROP POLICY IF EXISTS intercom_reads_member_select ON public.device_message_reads;
CREATE POLICY intercom_reads_member_select ON public.device_message_reads
    FOR SELECT TO anon, authenticated
    USING (public.intercom_is_active_member(primary_device_id, reader_device_id));
DROP POLICY IF EXISTS intercom_reads_member_insert ON public.device_message_reads;
CREATE POLICY intercom_reads_member_insert ON public.device_message_reads
    FOR INSERT TO anon, authenticated
    WITH CHECK (public.intercom_is_active_member(primary_device_id, reader_device_id));
DROP POLICY IF EXISTS intercom_reads_member_update ON public.device_message_reads;
CREATE POLICY intercom_reads_member_update ON public.device_message_reads
    FOR UPDATE TO anon, authenticated
    USING (public.intercom_is_active_member(primary_device_id, reader_device_id))
    WITH CHECK (public.intercom_is_active_member(primary_device_id, reader_device_id));

DROP POLICY IF EXISTS intercom_push_member_select ON public.device_push_subscriptions;
CREATE POLICY intercom_push_member_select ON public.device_push_subscriptions
    FOR SELECT TO anon, authenticated
    USING (public.intercom_is_active_member(primary_device_id, device_id));
DROP POLICY IF EXISTS intercom_push_member_insert ON public.device_push_subscriptions;
CREATE POLICY intercom_push_member_insert ON public.device_push_subscriptions
    FOR INSERT TO anon, authenticated
    WITH CHECK (public.intercom_is_active_member(primary_device_id, device_id));
DROP POLICY IF EXISTS intercom_push_member_update ON public.device_push_subscriptions;
CREATE POLICY intercom_push_member_update ON public.device_push_subscriptions
    FOR UPDATE TO anon, authenticated
    USING (public.intercom_is_active_member(primary_device_id, device_id))
    WITH CHECK (public.intercom_is_active_member(primary_device_id, device_id));
DROP POLICY IF EXISTS intercom_push_member_delete ON public.device_push_subscriptions;
CREATE POLICY intercom_push_member_delete ON public.device_push_subscriptions
    FOR DELETE TO anon, authenticated
    USING (public.intercom_is_active_member(primary_device_id, device_id));

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
           SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'device_messages'
       ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.device_messages;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.purge_intercom_data()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Retención: los mensajes del intercomunicador caducan a las 24 horas.
    DELETE FROM public.device_messages WHERE created_at < now() - interval '24 hours';
    DELETE FROM public.device_message_reads r
    WHERE NOT public.intercom_is_active_member(r.primary_device_id, r.reader_device_id);
    DELETE FROM public.device_push_subscriptions s
    WHERE s.revoked_at IS NOT NULL AND s.revoked_at < now() - interval '7 days'
       OR NOT public.intercom_is_active_member(s.primary_device_id, s.device_id);
    DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';
END;
$$;
REVOKE ALL ON FUNCTION public.purge_intercom_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_intercom_data() TO postgres, service_role;

-- DB trigger queues a minimal payload through pg_net. Store secrets in Vault under
-- intercom_push_url and intercom_webhook_secret. URL includes /functions/v1/intercom-push.
CREATE OR REPLACE FUNCTION public.intercom_enqueue_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_url TEXT;
    v_secret TEXT;
BEGIN
    IF NOT public.intercom_is_active_member(NEW.primary_device_id, NEW.sender_device_id) THEN
        RETURN NEW;
    END IF;
    BEGIN
        EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1'
            INTO v_url USING 'intercom_push_url';
        EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1'
            INTO v_secret USING 'intercom_webhook_secret';
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Intercom Push is not configured in Vault; chat insert remains available.';
        RETURN NEW;
    END;
    IF COALESCE(v_url, '') = '' OR COALESCE(v_secret, '') = '' THEN
        RAISE WARNING 'Intercom Push secrets are missing in Vault; chat insert remains available.';
        RETURN NEW;
    END IF;
    BEGIN
        PERFORM net.http_post(
            url := v_url,
            headers := jsonb_build_object('Content-Type', 'application/json', 'x-intercom-webhook-secret', v_secret),
            body := jsonb_build_object('type', 'INSERT', 'record', jsonb_build_object(
                'id', NEW.id,
                'primary_device_id', NEW.primary_device_id,
                'sender_device_id', NEW.sender_device_id
            ))
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Could not enqueue Intercom Push request; chat insert remains available.';
    END;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.intercom_enqueue_push() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.intercom_enqueue_push() TO postgres, service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
        DROP TRIGGER IF EXISTS device_messages_enqueue_push ON public.device_messages;
        CREATE TRIGGER device_messages_enqueue_push
            AFTER INSERT ON public.device_messages
            FOR EACH ROW EXECUTE FUNCTION public.intercom_enqueue_push();
    ELSE
        RAISE NOTICE 'pg_net is not enabled; Web Push sender trigger was not installed.';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
       AND to_regclass('cron.job') IS NOT NULL
       AND to_regclass('cron.job_run_details') IS NOT NULL THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('intercom-purge-6h', 'intercom-purge-hourly');
        PERFORM cron.schedule('intercom-purge-hourly', '0 * * * *', 'SELECT public.purge_intercom_data()');
    ELSE
        RAISE NOTICE 'pg_cron is not enabled; schedule the intercom purge after enabling it.';
    END IF;
END $$;
