-- =============================================================================
-- Fase 2A — Señal liviana de Cierre de Caja en Tiempo Real (shift_close_events)
-- Proyecto Supabase Cloud/Sync: kcananrtcmckovdstvao.supabase.co
--
-- Ejecutar manualmente en el SQL Editor ANTES de activar/desplegar Fase 2B.
-- Script 100% idempotente y aditivo: no altera sync_documents ni device_pairings.
--
-- Seguridad:
--   - La tabla NO contiene montos, totales, diferencias ni nombres de cajero.
--   - `sync_documents` permanece cerrado a `anon`.
--   - La lectura Realtime está restringida por RLS a parejas activas vía
--     `public.intercom_pair_is_active(primary_device_id)` (supabase_messages_setup.sql).
--   - La escritura ocurre exclusivamente mediante el RPC SECURITY DEFINER
--     `public.emit_shift_close_event`, con rate-limit de 3 cierres distintos / 10 min
--     y re-emisión del mismo cierre acotada a 1 por minuto.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.shift_close_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    primary_device_id TEXT NOT NULL,
    cierre_id BIGINT NOT NULL,
    cierre_number INTEGER,
    emitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT shift_close_events_unique_cierre UNIQUE (primary_device_id, cierre_id)
);

CREATE INDEX IF NOT EXISTS idx_shift_close_events_primary_emitted
    ON public.shift_close_events (primary_device_id, emitted_at DESC);

ALTER TABLE public.shift_close_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_close_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.shift_close_events FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.shift_close_events FROM anon, authenticated;
GRANT SELECT ON public.shift_close_events TO anon, authenticated, service_role;

DROP POLICY IF EXISTS shift_close_events_select_active_pair ON public.shift_close_events;
CREATE POLICY shift_close_events_select_active_pair
    ON public.shift_close_events
    FOR SELECT
    TO anon, authenticated
    USING (public.intercom_pair_is_active(primary_device_id));

CREATE OR REPLACE FUNCTION public.emit_shift_close_event(
    p_primary_device_id TEXT,
    p_cierre_id BIGINT,
    p_cierre_number INTEGER DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_primary_id TEXT := btrim(COALESCE(p_primary_device_id, ''));
    v_recent_distinct_count INTEGER := 0;
    v_was_inserted BOOLEAN := false;
    v_emitted_at TIMESTAMPTZ;
BEGIN
    IF v_primary_id = '' OR p_cierre_id IS NULL THEN
        RAISE EXCEPTION 'POS_SYNC_SCOPE_REQUIRED';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.device_pairings pairing
        WHERE pairing.primary_device_id = v_primary_id
    ) THEN
        RAISE EXCEPTION 'POS_SYNC_DEVICE_NOT_REGISTERED';
    END IF;

    -- Rate-limit estricto: máximo 3 cierres distintos por caja en 10 minutos.
    -- Excluir `cierre_id <> p_cierre_id` permite que re-emisiones del MISMO cierre
    -- lleguen al ON CONFLICT ... WHERE y devuelvan reason='recent' en vez de 'rate_limited'.
    SELECT COUNT(*)
      INTO v_recent_distinct_count
      FROM public.shift_close_events e
     WHERE e.primary_device_id = v_primary_id
       AND e.cierre_id <> p_cierre_id
       AND e.emitted_at > now() - interval '10 minutes';

    IF v_recent_distinct_count >= 3 THEN
        RETURN json_build_object(
            'success', true,
            'inserted', false,
            'reemitted', false,
            'throttled', true,
            'reason', 'rate_limited'
        );
    END IF;

    INSERT INTO public.shift_close_events (primary_device_id, cierre_id, cierre_number)
    VALUES (v_primary_id, p_cierre_id, p_cierre_number)
    ON CONFLICT (primary_device_id, cierre_id) DO UPDATE
        SET emitted_at = now(),
            cierre_number = COALESCE(EXCLUDED.cierre_number, shift_close_events.cierre_number)
        WHERE shift_close_events.emitted_at < now() - interval '1 minute'
    RETURNING (xmax = 0) AS was_inserted, emitted_at
      INTO v_was_inserted, v_emitted_at;

    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', true,
            'inserted', false,
            'reemitted', false,
            'throttled', true,
            'reason', 'recent'
        );
    END IF;

    RETURN json_build_object(
        'success', true,
        'inserted', v_was_inserted,
        'reemitted', NOT v_was_inserted,
        'throttled', false,
        'reason', CASE WHEN v_was_inserted THEN 'inserted' ELSE 'reemitted' END,
        'emitted_at', v_emitted_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.emit_shift_close_event(TEXT, BIGINT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.emit_shift_close_event(TEXT, BIGINT, INTEGER) TO anon, authenticated, service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
           SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime'
             AND schemaname = 'public'
             AND tablename = 'shift_close_events'
       ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.shift_close_events;
    END IF;
END $$;

-- =============================================================================
-- Limpieza opcional (pg_cron): purgar señales con más de 30 días de antigüedad.
-- Nota: el Monitor ignora explícitamente eventos DELETE de esta tabla.
--
-- SELECT cron.schedule(
--     'purge-old-shift-close-events',
--     '15 4 * * *',
--     $$DELETE FROM public.shift_close_events WHERE created_at < now() - interval '30 days';$$
-- );
-- =============================================================================
