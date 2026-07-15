-- ============================================================
-- SQL SETUP: Comandos del Supervisor (rate_change + inventory_update)
-- ============================================================
-- ⚠️  CORRER EN EL PROYECTO **CLOUD / SYNC P2P** (el que apunta
--     VITE_SUPABASE_CLOUD_URL en tu .env — donde viven sync_documents
--     y device_pairings). NO en el proyecto de licencias.
--
-- Contexto: la tabla supervisor_commands fue creada a mano en el
-- dashboard. Este script la versiona en el repo y es IDEMPOTENTE:
-- puede correrse sobre la tabla existente sin perder datos.
-- Añade: columna error_reason, CHECKs de command_type/status,
-- RLS por emparejamiento y registro en la publicación realtime.
-- ============================================================

-- 1. Tabla (no-op si ya existe)
CREATE TABLE IF NOT EXISTS public.supervisor_commands (
    id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    primary_device_id  TEXT NOT NULL,          -- La caja que debe aplicar el comando
    monitor_device_id  TEXT NOT NULL,          -- El celular del supervisor que lo emite
    command_type       TEXT NOT NULL,          -- 'rate_change' | 'inventory_update'
    payload            JSONB NOT NULL DEFAULT '{}'::jsonb,
    status             TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'applied' | 'failed'
    error_reason       TEXT,                   -- Razón cuando status='failed'
    created_at         TIMESTAMPTZ DEFAULT now(),
    applied_at         TIMESTAMPTZ
);

-- 2. Columna nueva sobre la tabla ya existente en producción
ALTER TABLE public.supervisor_commands ADD COLUMN IF NOT EXISTS error_reason TEXT;

-- 3. CHECK constraints (idempotentes)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'supervisor_commands_command_type_check'
    ) THEN
        ALTER TABLE public.supervisor_commands
            ADD CONSTRAINT supervisor_commands_command_type_check
            CHECK (command_type IN ('rate_change', 'inventory_update'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'supervisor_commands_status_check'
    ) THEN
        ALTER TABLE public.supervisor_commands
            ADD CONSTRAINT supervisor_commands_status_check
            CHECK (status IN ('pending', 'applied', 'failed'));
    END IF;
END $$;

-- 4. Índice para el catch-up de la caja (pendientes por dispositivo)
CREATE INDEX IF NOT EXISTS idx_supervisor_commands_pending
    ON public.supervisor_commands (primary_device_id, status, created_at);

-- 5. RLS: solo dispositivos emparejados pueden operar, y solo sobre sus filas.
--    (Mismo criterio que sync_documents_anon_access en supabase_pairing_setup.sql:
--    la app usa el rol anon; el emparejamiento en device_pairings es la autorización.)
ALTER TABLE public.supervisor_commands ENABLE ROW LEVEL SECURITY;

-- El monitor emparejado inserta comandos hacia su caja
DROP POLICY IF EXISTS "supervisor_commands_monitor_insert" ON public.supervisor_commands;
CREATE POLICY "supervisor_commands_monitor_insert" ON public.supervisor_commands
    FOR INSERT
    TO anon
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.device_pairings dp
            WHERE dp.primary_device_id = supervisor_commands.primary_device_id
              AND dp.monitor_device_id = supervisor_commands.monitor_device_id
        )
    );

-- Caja y monitor del par leen sus comandos
DROP POLICY IF EXISTS "supervisor_commands_pair_select" ON public.supervisor_commands;
CREATE POLICY "supervisor_commands_pair_select" ON public.supervisor_commands
    FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.device_pairings dp
            WHERE dp.primary_device_id = supervisor_commands.primary_device_id
        )
    );

-- La caja (o el monitor del par) actualiza el status del comando
DROP POLICY IF EXISTS "supervisor_commands_pair_update" ON public.supervisor_commands;
CREATE POLICY "supervisor_commands_pair_update" ON public.supervisor_commands
    FOR UPDATE
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.device_pairings dp
            WHERE dp.primary_device_id = supervisor_commands.primary_device_id
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.device_pairings dp
            WHERE dp.primary_device_id = supervisor_commands.primary_device_id
        )
    );

GRANT SELECT, INSERT, UPDATE ON public.supervisor_commands TO anon, authenticated;

-- 6. Publicación realtime (REPLICA IDENTITY por defecto — no FULL — para
--    no duplicar el payload de cada mensaje, según supabase_egress_optimization.sql)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'supervisor_commands'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.supervisor_commands;
    END IF;
END $$;
