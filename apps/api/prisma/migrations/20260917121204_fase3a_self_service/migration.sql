-- CreateEnum
CREATE TYPE "EstadoComprobante" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');

-- AlterTable
ALTER TABLE "perfiles" ADD COLUMN     "autoRegistrado" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "listaEsperaHabilitada" BOOLEAN,
ADD COLUMN     "minMinutosAnotarse" INTEGER,
ADD COLUMN     "minMinutosCancelar" INTEGER;

-- CreateTable
CREATE TABLE "claves_invitacion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "usosMax" INTEGER,
    "usosActuales" INTEGER NOT NULL DEFAULT 0,
    "expiraEn" TIMESTAMP(3),
    "packId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claves_invitacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claves_invitacion_salas" (
    "tenantId" TEXT NOT NULL,
    "claveId" TEXT NOT NULL,
    "salaId" TEXT NOT NULL,

    CONSTRAINT "claves_invitacion_salas_pkey" PRIMARY KEY ("claveId","salaId")
);

-- CreateTable
CREATE TABLE "listas_espera" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "turnoId" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "notificado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listas_espera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comprobantes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "claveArchivo" TEXT NOT NULL,
    "nombreOriginal" TEXT NOT NULL,
    "tipoMime" TEXT NOT NULL,
    "subidoEn" TIMESTAMP(3),
    "estado" "EstadoComprobante" NOT NULL DEFAULT 'PENDIENTE',
    "revisadoPor" TEXT,
    "revisadoEn" TIMESTAMP(3),
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comprobantes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "claves_invitacion_tenantId_idx" ON "claves_invitacion"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "claves_invitacion_tenantId_codigo_key" ON "claves_invitacion"("tenantId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "claves_invitacion_tenantId_id_key" ON "claves_invitacion"("tenantId", "id");

-- CreateIndex
CREATE INDEX "claves_invitacion_salas_tenantId_idx" ON "claves_invitacion_salas"("tenantId");

-- CreateIndex
CREATE INDEX "claves_invitacion_salas_salaId_idx" ON "claves_invitacion_salas"("salaId");

-- CreateIndex
CREATE INDEX "listas_espera_tenantId_turnoId_idx" ON "listas_espera"("tenantId", "turnoId");

-- CreateIndex
CREATE UNIQUE INDEX "listas_espera_tenantId_turnoId_perfilId_key" ON "listas_espera"("tenantId", "turnoId", "perfilId");

-- CreateIndex
CREATE INDEX "comprobantes_tenantId_perfilId_idx" ON "comprobantes"("tenantId", "perfilId");

-- CreateIndex
CREATE INDEX "comprobantes_tenantId_estado_idx" ON "comprobantes"("tenantId", "estado");

-- AddForeignKey
ALTER TABLE "claves_invitacion" ADD CONSTRAINT "claves_invitacion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claves_invitacion" ADD CONSTRAINT "claves_invitacion_tenantId_packId_fkey" FOREIGN KEY ("tenantId", "packId") REFERENCES "packs"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claves_invitacion_salas" ADD CONSTRAINT "claves_invitacion_salas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claves_invitacion_salas" ADD CONSTRAINT "claves_invitacion_salas_tenantId_claveId_fkey" FOREIGN KEY ("tenantId", "claveId") REFERENCES "claves_invitacion"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claves_invitacion_salas" ADD CONSTRAINT "claves_invitacion_salas_tenantId_salaId_fkey" FOREIGN KEY ("tenantId", "salaId") REFERENCES "salas"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listas_espera" ADD CONSTRAINT "listas_espera_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listas_espera" ADD CONSTRAINT "listas_espera_tenantId_turnoId_fkey" FOREIGN KEY ("tenantId", "turnoId") REFERENCES "turnos"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listas_espera" ADD CONSTRAINT "listas_espera_tenantId_perfilId_fkey" FOREIGN KEY ("tenantId", "perfilId") REFERENCES "perfiles"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_tenantId_perfilId_fkey" FOREIGN KEY ("tenantId", "perfilId") REFERENCES "perfiles"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
