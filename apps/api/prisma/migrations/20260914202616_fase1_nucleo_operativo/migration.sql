-- CreateEnum
CREATE TYPE "TipoPack" AS ENUM ('MENSUAL', 'TOTAL');

-- CreateEnum
CREATE TYPE "OrigenReserva" AS ENUM ('ADMIN', 'ALUMNO', 'RUTINA', 'PRUEBA', 'LISTA_ESPERA', 'EXTRA');

-- CreateEnum
CREATE TYPE "TipoCancelacion" AS ENUM ('RECUPERABLE', 'DEFINITIVA');

-- CreateTable
CREATE TABLE "salas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "visibleAlumnos" BOOLEAN NOT NULL DEFAULT true,
    "soloCuposLiberados" BOOLEAN NOT NULL DEFAULT false,
    "exclusiva" BOOLEAN NOT NULL DEFAULT false,
    "cupoBase" INTEGER,
    "minMinutosCancelar" INTEGER,
    "minMinutosAnotarse" INTEGER,
    "listaEsperaHabilitada" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perfiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "telefono" TEXT,
    "fichaMedica" TEXT,
    "packId" TEXT,
    "clasesExtra" INTEGER NOT NULL DEFAULT 0,
    "cancelacionesUsadas" INTEGER NOT NULL DEFAULT 0,
    "pagoAlDia" BOOLEAN NOT NULL DEFAULT false,
    "vigenciaDesde" TIMESTAMP(3),
    "vigenciaHasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perfiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios_salas" (
    "tenantId" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "salaId" TEXT NOT NULL,

    CONSTRAINT "usuarios_salas_pkey" PRIMARY KEY ("perfilId","salaId")
);

-- CreateTable
CREATE TABLE "packs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "salaId" TEXT,
    "tipo" "TipoPack" NOT NULL DEFAULT 'MENSUAL',
    "precio" DECIMAL(10,2),
    "clasesPorMes" INTEGER,
    "clasesTotales" INTEGER,
    "cancelacionesPermitidas" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turnos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "salaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFin" TEXT NOT NULL,
    "cupo" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "turnos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "turnoId" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "origen" "OrigenReserva" NOT NULL,
    "esPrueba" BOOLEAN NOT NULL DEFAULT false,
    "pagoRealizado" BOOLEAN NOT NULL DEFAULT false,
    "canceladaEn" TIMESTAMP(3),
    "cancelacionTipo" "TipoCancelacion",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "salas_tenantId_idx" ON "salas"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "salas_tenantId_id_key" ON "salas"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "perfiles_usuarioId_key" ON "perfiles"("usuarioId");

-- CreateIndex
CREATE INDEX "perfiles_tenantId_idx" ON "perfiles"("tenantId");

-- CreateIndex
CREATE INDEX "perfiles_tenantId_packId_idx" ON "perfiles"("tenantId", "packId");

-- CreateIndex
CREATE UNIQUE INDEX "perfiles_tenantId_id_key" ON "perfiles"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "perfiles_tenantId_usuarioId_key" ON "perfiles"("tenantId", "usuarioId");

-- CreateIndex
CREATE INDEX "usuarios_salas_tenantId_idx" ON "usuarios_salas"("tenantId");

-- CreateIndex
CREATE INDEX "usuarios_salas_salaId_idx" ON "usuarios_salas"("salaId");

-- CreateIndex
CREATE INDEX "packs_tenantId_idx" ON "packs"("tenantId");

-- CreateIndex
CREATE INDEX "packs_tenantId_salaId_idx" ON "packs"("tenantId", "salaId");

-- CreateIndex
CREATE UNIQUE INDEX "packs_tenantId_id_key" ON "packs"("tenantId", "id");

-- CreateIndex
CREATE INDEX "turnos_tenantId_salaId_fecha_idx" ON "turnos"("tenantId", "salaId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "turnos_tenantId_id_key" ON "turnos"("tenantId", "id");

-- CreateIndex
CREATE INDEX "reservas_tenantId_turnoId_idx" ON "reservas"("tenantId", "turnoId");

-- CreateIndex
CREATE INDEX "reservas_tenantId_perfilId_idx" ON "reservas"("tenantId", "perfilId");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_tenantId_id_key" ON "usuarios"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "salas" ADD CONSTRAINT "salas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfiles" ADD CONSTRAINT "perfiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfiles" ADD CONSTRAINT "perfiles_tenantId_usuarioId_fkey" FOREIGN KEY ("tenantId", "usuarioId") REFERENCES "usuarios"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfiles" ADD CONSTRAINT "perfiles_tenantId_packId_fkey" FOREIGN KEY ("tenantId", "packId") REFERENCES "packs"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios_salas" ADD CONSTRAINT "usuarios_salas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios_salas" ADD CONSTRAINT "usuarios_salas_tenantId_perfilId_fkey" FOREIGN KEY ("tenantId", "perfilId") REFERENCES "perfiles"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios_salas" ADD CONSTRAINT "usuarios_salas_tenantId_salaId_fkey" FOREIGN KEY ("tenantId", "salaId") REFERENCES "salas"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packs" ADD CONSTRAINT "packs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packs" ADD CONSTRAINT "packs_tenantId_salaId_fkey" FOREIGN KEY ("tenantId", "salaId") REFERENCES "salas"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_tenantId_salaId_fkey" FOREIGN KEY ("tenantId", "salaId") REFERENCES "salas"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_tenantId_turnoId_fkey" FOREIGN KEY ("tenantId", "turnoId") REFERENCES "turnos"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_tenantId_perfilId_fkey" FOREIGN KEY ("tenantId", "perfilId") REFERENCES "perfiles"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
