-- CreateTable
CREATE TABLE "avisos_diarios" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "dia" DATE NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avisos_diarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "avisos_diarios_tenantId_tipo_perfilId_dia_key" ON "avisos_diarios"("tenantId", "tipo", "perfilId", "dia");

-- AddForeignKey
ALTER TABLE "avisos_diarios" ADD CONSTRAINT "avisos_diarios_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avisos_diarios" ADD CONSTRAINT "avisos_diarios_tenantId_perfilId_fkey" FOREIGN KEY ("tenantId", "perfilId") REFERENCES "perfiles"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

