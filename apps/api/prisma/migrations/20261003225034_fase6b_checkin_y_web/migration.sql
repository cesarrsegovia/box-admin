-- Fase 6B: check-in por QR y web publica.
--
-- OJO: esta migracion BORRA vacaciones_alumnos.devuelveClase, que en la base de
-- desarrollo tenia 1 valor no nulo. Es deliberado y esta decidido con Cesar: las
-- clases perdidas no se devuelven. La columna se almacenaba sin aplicarse nunca
-- y llevaba cuatro fases de mudanza. No hay nada que convertir: el mecanismo
-- real para darle una clase a alguien es perfiles.clasesExtra, que sigue vivo.
--
-- El UNIQUE (tenantId, id) de `reservas` no es un capricho: es el destino de la
-- clave foranea COMPUESTA de `asistencias`, y es lo que hace que sea Postgres
-- —y no el codigo— quien impida que una asistencia apunte a la reserva de otro
-- gimnasio. No puede fallar por duplicados: `id` ya es la clave primaria, asi
-- que (tenantId, id) es unico por construccion.

-- CreateEnum
CREATE TYPE "OrigenAsistencia" AS ENUM ('QR', 'MANUAL');

-- AlterTable
ALTER TABLE "vacaciones_alumnos" DROP COLUMN "devuelveClase";

-- CreateTable
CREATE TABLE "config_checkin_qr" (
    "tenantId" TEXT NOT NULL,
    "minutosAntes" INTEGER NOT NULL DEFAULT 15,
    "minutosDespues" INTEGER NOT NULL DEFAULT 15,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "config_checkin_qr_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "asistencias" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reservaId" TEXT NOT NULL,
    "origen" "OrigenAsistencia" NOT NULL,
    "ip" TEXT,
    "dispositivo" TEXT,
    "marcadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asistencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_salon_config" (
    "tenantId" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT false,
    "colorPrimario" TEXT NOT NULL DEFAULT '#000000',
    "colorSecundario" TEXT NOT NULL DEFAULT '#ffffff',
    "tituloPrincipal" TEXT,
    "tagline" TEXT,
    "sobreElSalon" TEXT,
    "imagenPrincipalUrl" TEXT,
    "whatsapp" TEXT,
    "instagram" TEXT,
    "linkExtra" TEXT,
    "mostrarPrecios" BOOLEAN NOT NULL DEFAULT true,
    "mostrarTestimonios" BOOLEAN NOT NULL DEFAULT false,
    "mostrarFAQ" BOOLEAN NOT NULL DEFAULT false,
    "mostrarTurnosLibres" BOOLEAN NOT NULL DEFAULT false,
    "planDestacadoId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_salon_config_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "testimonios" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "testimonios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preguntas_frecuentes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pregunta" TEXT NOT NULL,
    "respuesta" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "preguntas_frecuentes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asistencias_tenantId_idx" ON "asistencias"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "asistencias_tenantId_reservaId_key" ON "asistencias"("tenantId", "reservaId");

-- CreateIndex
CREATE INDEX "testimonios_tenantId_orden_idx" ON "testimonios"("tenantId", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "testimonios_tenantId_id_key" ON "testimonios"("tenantId", "id");

-- CreateIndex
CREATE INDEX "preguntas_frecuentes_tenantId_orden_idx" ON "preguntas_frecuentes"("tenantId", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "preguntas_frecuentes_tenantId_id_key" ON "preguntas_frecuentes"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "reservas_tenantId_id_key" ON "reservas"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "config_checkin_qr" ADD CONSTRAINT "config_checkin_qr_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asistencias" ADD CONSTRAINT "asistencias_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asistencias" ADD CONSTRAINT "asistencias_tenantId_reservaId_fkey" FOREIGN KEY ("tenantId", "reservaId") REFERENCES "reservas"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_salon_config" ADD CONSTRAINT "web_salon_config_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_salon_config" ADD CONSTRAINT "web_salon_config_tenantId_planDestacadoId_fkey" FOREIGN KEY ("tenantId", "planDestacadoId") REFERENCES "packs"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonios" ADD CONSTRAINT "testimonios_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preguntas_frecuentes" ADD CONSTRAINT "preguntas_frecuentes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

