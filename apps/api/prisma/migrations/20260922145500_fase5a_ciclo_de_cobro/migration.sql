-- Fase 5A: el ciclo de cobro.
--
-- OJO: esta migracion BORRA perfiles.pagoAlDia, que en la base de desarrollo
-- tenia 91 valores. Es deliberado: era un booleano que aprobar un comprobante
-- ponia en true y nada bajaba jamas, y desde esta fase "estar al dia" se deriva
-- de los pagos vigentes.
--
-- NO se convierten los valores viejos en pagos de cortesia a proposito. Una
-- cortesia lleva un periodo, y el periodo que cubria cada uno de esos `true` no
-- lo sabe nadie: inventarlo seria fabricar datos que la Fase 6 leeria como
-- ciertos. Si algun dia hay produccion, la conversion la decide el gimnasio
-- antes de desplegar, no esta migracion.

-- CreateEnum
CREATE TYPE "MetodoPago" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'CORTESIA', 'OTRO');

-- AlterTable
ALTER TABLE "perfiles" DROP COLUMN "pagoAlDia";

-- CreateTable
CREATE TABLE "pagos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "metodo" "MetodoPago" NOT NULL,
    "esSena" BOOLEAN NOT NULL DEFAULT false,
    "cubreDesde" DATE NOT NULL,
    "cubreHasta" DATE NOT NULL,
    "comprobanteId" TEXT,
    "registradoPor" TEXT NOT NULL,
    "nota" TEXT,
    "anuladoEn" TIMESTAMP(3),
    "anuladoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pagos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pagos_tenantId_perfilId_idx" ON "pagos"("tenantId", "perfilId");

-- CreateIndex
CREATE INDEX "pagos_tenantId_cubreHasta_idx" ON "pagos"("tenantId", "cubreHasta");

-- CreateIndex
CREATE UNIQUE INDEX "comprobantes_tenantId_id_key" ON "comprobantes"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_tenantId_perfilId_fkey" FOREIGN KEY ("tenantId", "perfilId") REFERENCES "perfiles"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_tenantId_comprobanteId_fkey" FOREIGN KEY ("tenantId", "comprobanteId") REFERENCES "comprobantes"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

