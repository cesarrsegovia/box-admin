-- DropForeignKey
ALTER TABLE "reservas" DROP CONSTRAINT "reservas_tenantId_turnoId_fkey";

-- AddForeignKey
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_tenantId_turnoId_fkey" FOREIGN KEY ("tenantId", "turnoId") REFERENCES "turnos"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
