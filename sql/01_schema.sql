 ============================================================
-- --01_schema.sql — Tablas del sistema Guardias Médicas
-- Ejecutar primero, en el SQL Editor de Supabase
-- ============================================================

-- Extensión para gen_random_uuid() (ya viene habilitada en Supabase)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ------------------------------------------------------------
-- TABLA: profiles
-- Creada automáticamente por el trigger handle_new_user()
-- cuando el médico se registra en auth.users
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id           uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre       text        NOT NULL DEFAULT '',
  apellido     text        NOT NULL DEFAULT '',
  matricula    text        NOT NULL DEFAULT '' UNIQUE,
  especialidad text        NOT NULL DEFAULT '',
  telefono     text,
  rol          text        NOT NULL DEFAULT 'medico'
                           CHECK (rol IN ('medico', 'admin')),
  activo       boolean     NOT NULL DEFAULT false,
  creado_en    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profiles IS
  'Perfil extendido de cada usuario. Espejo de auth.users con datos médicos.';
COMMENT ON COLUMN public.profiles.activo IS
  'false = pendiente de aprobación por el admin; true = puede operar.';


-- ------------------------------------------------------------
-- TABLA: sedes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sedes (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre    text        NOT NULL,
  direccion text,
  color_hex text,                       -- color para el calendario, ej. "#c08a4a"
  activa    boolean     NOT NULL DEFAULT true,
  creada_en timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sedes IS
  'Hospitales / clínicas donde se realizan las guardias.';


-- ------------------------------------------------------------
-- TABLA: trimestres
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trimestres (
  id                      text        PRIMARY KEY,  -- ej. "2026-Q2"
  nombre                  text        NOT NULL,     -- "Abril – Junio 2026"
  fecha_inicio            date        NOT NULL,
  fecha_fin               date        NOT NULL,
  max_guardias_por_medico int         NOT NULL DEFAULT 10
                          CHECK (max_guardias_por_medico > 0),
  inscripciones_abiertas  boolean     NOT NULL DEFAULT false,
  abierto_desde           timestamptz,              -- apertura programada (opcional)
  abierto_hasta           timestamptz,
  creado_en               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT trimestres_fechas_validas CHECK (fecha_fin > fecha_inicio)
);

COMMENT ON COLUMN public.trimestres.inscripciones_abiertas IS
  'El admin lo activa/desactiva. Mientras sea false los médicos solo ven, no se anotan.';


-- ------------------------------------------------------------
-- TABLA: guardias
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guardias (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha          date        NOT NULL,
  hora_inicio    time        NOT NULL DEFAULT '08:00',
  duracion_horas int         NOT NULL DEFAULT 24
                 CHECK (duracion_horas > 0),
  sede_id        uuid        NOT NULL REFERENCES public.sedes(id)      ON DELETE RESTRICT,
  servicio       text        NOT NULL,
  cupos_totales  int         NOT NULL DEFAULT 1
                 CHECK (cupos_totales > 0),
  trimestre_id   text        NOT NULL REFERENCES public.trimestres(id) ON DELETE RESTRICT,
  notas          text,
  creado_por     uuid        REFERENCES public.profiles(id)            ON DELETE SET NULL,
  creado_en      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardias_fecha      ON public.guardias(fecha);
CREATE INDEX IF NOT EXISTS idx_guardias_trimestre  ON public.guardias(trimestre_id);
CREATE INDEX IF NOT EXISTS idx_guardias_sede       ON public.guardias(sede_id);

COMMENT ON TABLE public.guardias IS
  'Cada guardia de 24 hs publicada por el admin para un trimestre y sede.';


-- ------------------------------------------------------------
-- TABLA: inscripciones
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inscripciones (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  guardia_id   uuid        NOT NULL REFERENCES public.guardias(id)  ON DELETE CASCADE,
  medico_id    uuid        NOT NULL REFERENCES public.profiles(id)  ON DELETE CASCADE,
  estado       text        NOT NULL DEFAULT 'confirmada'
               CHECK (estado IN ('confirmada', 'cancelada', 'asignada_admin', 'cancelada_admin')),
  inscripto_en timestamptz NOT NULL DEFAULT now(),
  cancelado_en timestamptz
);

-- Índice parcial: un médico no puede tener dos inscripciones 'confirmada'
-- en la misma guardia. Permite cancelar y volver a anotarse.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inscripciones_unica_activa
  ON public.inscripciones(guardia_id, medico_id)
  WHERE estado = 'confirmada';

CREATE INDEX IF NOT EXISTS idx_inscripciones_medico  ON public.inscripciones(medico_id);
CREATE INDEX IF NOT EXISTS idx_inscripciones_guardia ON public.inscripciones(guardia_id);
CREATE INDEX IF NOT EXISTS idx_inscripciones_estado  ON public.inscripciones(estado);

COMMENT ON COLUMN public.inscripciones.estado IS
  'confirmada: activa | cancelada: el médico canceló | '
  'cancelada_admin: el admin la dio de baja | asignada_admin: asignada manualmente';
