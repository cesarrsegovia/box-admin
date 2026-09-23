-- CreateEnum
CREATE TYPE "TipoPlantilla" AS ENUM ('CONFIRMACION', 'CANCELACION', 'RECORDATORIO_PAGO', 'LISTA_ESPERA', 'VENCIMIENTO_PACK');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "diasAvisoVencimiento" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "configuraciones_smtp" (
    "tenantId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "puerto" INTEGER NOT NULL,
    "seguro" BOOLEAN NOT NULL DEFAULT true,
    "usuario" TEXT NOT NULL,
    "claveCifrada" TEXT NOT NULL,
    "emailOrigen" TEXT NOT NULL,
    "emailDestino" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuraciones_smtp_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "plantillas_email" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tipo" "TipoPlantilla" NOT NULL,
    "asunto" TEXT NOT NULL,
    "cuerpoHtml" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plantillas_email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suscripciones_push" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suscripciones_push_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plantillas_email_tenantId_tipo_key" ON "plantillas_email"("tenantId", "tipo");

-- CreateIndex
CREATE INDEX "suscripciones_push_tenantId_perfilId_idx" ON "suscripciones_push"("tenantId", "perfilId");

-- CreateIndex
CREATE UNIQUE INDEX "suscripciones_push_tenantId_perfilId_endpoint_key" ON "suscripciones_push"("tenantId", "perfilId", "endpoint");

-- AddForeignKey
ALTER TABLE "configuraciones_smtp" ADD CONSTRAINT "configuraciones_smtp_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantillas_email" ADD CONSTRAINT "plantillas_email_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suscripciones_push" ADD CONSTRAINT "suscripciones_push_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suscripciones_push" ADD CONSTRAINT "suscripciones_push_tenantId_perfilId_fkey" FOREIGN KEY ("tenantId", "perfilId") REFERENCES "perfiles"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
