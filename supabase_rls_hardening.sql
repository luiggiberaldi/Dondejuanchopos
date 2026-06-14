-- =================================================================================
-- REFORZAMIENTO DE SEGURIDAD SUPABASE (RLS HARDENING - CORREGIDO)
-- =================================================================================
-- Ejecuta este script en el "SQL Editor" de tu respectivo proyecto de Supabase.

-- ─────────────────────────────────────────────────────────────────────────────────
-- A) EJECUTAR EN: Base de Datos de Sincronización (Proyecto ewwszyzzvoweudholmbf)
-- ─────────────────────────────────────────────────────────────────────────────────
-- Este proyecto maneja la sincronización en la nube y los respaldos en vivo.

-- 1. Tabla: sync_documents
ALTER TABLE public.sync_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sync_documents_open" ON public.sync_documents;
DROP POLICY IF EXISTS "sync_documents_device_isolation" ON public.sync_documents;

-- Aislamiento por device_id usando autenticación JWT (se activará al integrar la Estación Maestra)
CREATE POLICY "sync_documents_device_isolation" ON public.sync_documents
    FOR ALL
    TO authenticated
    USING (device_id = (auth.jwt() ->> 'device_id'))
    WITH CHECK (device_id = (auth.jwt() ->> 'device_id'));


-- 2. Tabla: cloud_backups
ALTER TABLE public.cloud_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cloud_backups_open" ON public.cloud_backups;
DROP POLICY IF EXISTS "cloud_backups_device_isolation" ON public.cloud_backups;

CREATE POLICY "cloud_backups_device_isolation" ON public.cloud_backups
    FOR ALL
    TO authenticated
    USING (device_id = (auth.jwt() ->> 'device_id'))
    WITH CHECK (device_id = (auth.jwt() ->> 'device_id'));


-- ─────────────────────────────────────────────────────────────────────────────────
-- B) EJECUTAR EN: Base de Datos de Licencias (Proyecto jjbzevntreoxpuofgkyi)
-- ─────────────────────────────────────────────────────────────────────────────────
-- Este proyecto maneja la validación de licencias activas y dispositivos autorizados.

-- 1. Tabla: licenses (Tabla activa en tu base de datos de licencias actual)
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "licenses_open" ON public.licenses;
DROP POLICY IF EXISTS "licenses_device_isolation" ON public.licenses;

-- Permite a los clientes consultar su propia licencia mediante el device_id filtrado
CREATE POLICY "licenses_device_read" ON public.licenses
    FOR SELECT
    USING (true); -- Mantenido abierto para SELECT debido a lectura anónima (anon key), pero restringido a solo lectura.

-- Evita que clientes anónimos modifiquen o borren licencias (solo el admin del panel de Supabase puede hacerlo)
CREATE POLICY "licenses_admin_write" ON public.licenses
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
