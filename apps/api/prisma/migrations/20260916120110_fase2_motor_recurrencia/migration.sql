-- CreateEnum
CREATE TYPE "EstadoMes" AS ENUM ('BORRADOR', 'HABILITADO');

-- CreateTable
CREATE TABLE "rutinas_fijas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "salaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFin" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "desde" DATE NOT NULL,
    "hasta" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rutinas_fijas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meses_calendario" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "salaId" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "estado" "EstadoMes" NOT NULL DEFAULT 'BORRADOR',
    "publicadoEn" TIMESTAMP(3),
    "publicadoPor" TEXT,
    "ultimoJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meses_calendario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacaciones_alumnos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "desde" DATE NOT NULL,
    "hasta" DATE NOT NULL,
    "motivo" TEXT,
    "devuelveClase" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vacaciones_alumnos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ausencias" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "salaId" TEXT,
    "desde" DATE NOT NULL,
    "hasta" DATE NOT NULL,
    "todoElDia" BOOLEAN NOT NULL DEFAULT true,
    "horaInicio" TEXT,
    "horaFin" TEXT,
    "recuperable" BOOLEAN NOT NULL DEFAULT true,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ausencias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rutinas_fijas_tenantId_perfilId_idx" ON "rutinas_fijas"("tenantId", "perfilId");

-- CreateIndex
CREATE INDEX "rutinas_fijas_tenantId_salaId_diaSemana_idx" ON "rutinas_fijas"("tenantId", "salaId", "diaSemana");

-- CreateIndex
CREATE UNIQUE INDEX "meses_calendario_tenantId_salaId_anio_mes_key" ON "meses_calendario"("tenantId", "salaId", "anio", "mes");

-- CreateIndex
CREATE INDEX "vacaciones_alumnos_tenantId_perfilId_idx" ON "vacaciones_alumnos"("tenantId", "perfilId");

-- CreateIndex
CREATE INDEX "ausencias_tenantId_salaId_idx" ON "ausencias"("tenantId", "salaId");

-- CreateIndex
CREATE UNIQUE INDEX "turnos_tenantId_salaId_fecha_horaInicio_key" ON "turnos"("tenantId", "salaId", "fecha", "horaInicio");

-- AddForeignKey
ALTER TABLE "rutinas_fijas" ADD CONSTRAINT "rutinas_fijas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rutinas_fijas" ADD CONSTRAINT "rutinas_fijas_tenantId_perfilId_fkey" FOREIGN KEY ("tenantId", "perfilId") REFERENCES "perfiles"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rutinas_fijas" ADD CONSTRAINT "rutinas_fijas_tenantId_salaId_fkey" FOREIGN KEY ("tenantId", "salaId") REFERENCES "salas"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meses_calendario" ADD CONSTRAINT "meses_calendario_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meses_calendario" ADD CONSTRAINT "meses_calendario_tenantId_salaId_fkey" FOREIGN KEY ("tenantId", "salaId") REFERENCES "salas"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacaciones_alumnos" ADD CONSTRAINT "vacaciones_alumnos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacaciones_alumnos" ADD CONSTRAINT "vacaciones_alumnos_tenantId_perfilId_fkey" FOREIGN KEY ("tenantId", "perfilId") REFERENCES "perfiles"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ausencias" ADD CONSTRAINT "ausencias_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ausencias" ADD CONSTRAINT "ausencias_tenantId_salaId_fkey" FOREIGN KEY ("tenantId", "salaId") REFERENCES "salas"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Idempotencia de la generacion: un perfil no puede tener dos reservas ACTIVAS
-- en el mismo turno. Es un indice PARCIAL (solo sobre las no canceladas), asi
-- que Prisma no puede declararlo en el schema y se escribe aqui a mano.
--
-- La Fase 1 dejaba esta unicidad solo en manos del service, dentro de la
-- transaccion Serializable. Sigue estando ahi; esto es la red de debajo, y es lo
-- que garantiza que publicar un mes dos veces no duplique reservas aunque el
-- service tuviera un bug.
CREATE UNIQUE INDEX "reservas_activas_unicas"
  ON "reservas" ("tenantId", "turnoId", "perfilId")
  WHERE "canceladaEn" IS NULL;
