-- AlterTable
ALTER TABLE "reservas" ADD COLUMN     "asistio" BOOLEAN;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "tarifaPorHoraProfesor" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "turnos" ADD COLUMN     "profesorId" TEXT;

-- CreateTable
CREATE TABLE "horarios_profesor_asignados" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "profesorId" TEXT NOT NULL,
    "salaId" TEXT NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFin" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "desde" DATE NOT NULL,
    "hasta" DATE,
    "tarifaPorHora" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "horarios_profesor_asignados_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "horarios_profesor_asignados_tenantId_profesorId_idx" ON "horarios_profesor_asignados"("tenantId", "profesorId");

-- CreateIndex
CREATE INDEX "horarios_profesor_asignados_tenantId_salaId_diaSemana_idx" ON "horarios_profesor_asignados"("tenantId", "salaId", "diaSemana");

-- CreateIndex
CREATE INDEX "turnos_tenantId_profesorId_idx" ON "turnos"("tenantId", "profesorId");

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_tenantId_profesorId_fkey" FOREIGN KEY ("tenantId", "profesorId") REFERENCES "perfiles"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horarios_profesor_asignados" ADD CONSTRAINT "horarios_profesor_asignados_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horarios_profesor_asignados" ADD CONSTRAINT "horarios_profesor_asignados_tenantId_profesorId_fkey" FOREIGN KEY ("tenantId", "profesorId") REFERENCES "perfiles"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horarios_profesor_asignados" ADD CONSTRAINT "horarios_profesor_asignados_tenantId_salaId_fkey" FOREIGN KEY ("tenantId", "salaId") REFERENCES "salas"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
