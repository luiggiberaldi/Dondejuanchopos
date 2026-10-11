-- Reasignación de la suscripción Web Push del intercomunicador.
-- Ejecutar en Cloud/Sync: https://kcananrtcmckovdstvao.supabase.co
-- No se aplica a ningún proyecto desde el repositorio.
--
-- PROBLEMA QUE RESUELVE
-- `device_push_subscriptions` tiene PK `device_id` y `UNIQUE(endpoint)`. El cliente
-- sólo puede arbitrar una en el upsert (`onConflict: 'device_id'`), así que cuando el
-- mismo navegador vuelve a registrarse con OTRA identidad de dispositivo —identidad
-- regenerada al re-emparejar, monitor revocado y re-vinculado, almacenamiento limpio—
-- el INSERT choca primero contra el índice del endpoint:
--
--   duplicate key value violates unique constraint "device_push_subscriptions_endpoint_key"
--
-- La fila dueña del endpoint puede ser INVISIBLE para el llamante por RLS (un monitor
-- revocado no es miembro activo), así que el cliente no puede liberarla por sí solo:
-- el `delete` no afecta ninguna fila y el reintento vuelve a chocar. Este RPC lo hace
-- desde el servidor, validando pertenencia antes de tocar nada.
--
-- Se conserva `UNIQUE(endpoint)`: un endpoint es un navegador concreto y duplicarlo
-- provocaría notificaciones repetidas. Lo que cambia es quién puede reasignarlo.

CREATE OR REPLACE FUNCTION public.intercom_register_push_subscription(
    p_device_id TEXT,
    p_primary_device_id TEXT,
    p_endpoint TEXT,
    p_p256dh TEXT,
    p_auth TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public, pg_temp
AS $$
BEGIN
    IF COALESCE(btrim(p_device_id), '') = ''
        OR COALESCE(btrim(p_primary_device_id), '') = ''
        OR COALESCE(btrim(p_endpoint), '') = ''
        OR COALESCE(btrim(p_p256dh), '') = ''
        OR COALESCE(btrim(p_auth), '') = '' THEN
        RAISE EXCEPTION 'INTERCOM_PUSH_PAYLOAD_REQUIRED';
    END IF;

    -- Autorización: sólo la caja o un monitor activo de ESA caja se registra para su
    -- intercomunicador. Se reutiliza la misma función que gobierna las RLS del chat.
    IF NOT public.intercom_is_active_member(btrim(p_primary_device_id), btrim(p_device_id)) THEN
        RAISE EXCEPTION 'INTERCOM_PUSH_PAIRING_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    -- El endpoint pertenece a un navegador, no a un device_id: al reasignarlo se libera
    -- la fila anterior, esté activa, revocada o pertenezca a un vínculo viejo.
    DELETE FROM public.device_push_subscriptions
    WHERE endpoint = btrim(p_endpoint)
      AND device_id <> btrim(p_device_id);

    INSERT INTO public.device_push_subscriptions
        (device_id, primary_device_id, endpoint, p256dh, auth, updated_at, revoked_at)
    VALUES
        (btrim(p_device_id), btrim(p_primary_device_id), btrim(p_endpoint),
         btrim(p_p256dh), btrim(p_auth), now(), NULL)
    ON CONFLICT (device_id) DO UPDATE
        SET primary_device_id = EXCLUDED.primary_device_id,
            endpoint         = EXCLUDED.endpoint,
            p256dh           = EXCLUDED.p256dh,
            auth             = EXCLUDED.auth,
            updated_at       = now(),
            revoked_at       = NULL;

    RETURN json_build_object(
        'success', true,
        'device_id', btrim(p_device_id),
        'primary_device_id', btrim(p_primary_device_id)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.intercom_register_push_subscription(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.intercom_register_push_subscription(TEXT, TEXT, TEXT, TEXT, TEXT)
    TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (ejecutar DESPUÉS de aplicar, con dos device_id reales del vínculo)
-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Un dispositivo NO miembro no puede reasignar nada:
--      select public.intercom_register_push_subscription(
--          'device_inventado', 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
--          'https://fcm.googleapis.com/fcm/send/xyz', 'k', 'a');
--    → ERROR INTERCOM_PUSH_PAIRING_REQUIRED (42501) y cero filas nuevas.
--
-- 2) Un miembro real sí reasigna, y no quedan dos filas con el mismo endpoint:
--      select count(*) from public.device_push_subscriptions s
--      where s.endpoint = 'https://fcm.googleapis.com/fcm/send/...';
--    → debe devolver 1.
--
-- 3) La RLS no cambia: el cliente sigue sin poder escribir filas de otros vínculos
--    (las políticas `intercom_push_member_*` se mantienen tal cual).
