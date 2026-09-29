-- AlterTable
ALTER TABLE "reservas" ADD COLUMN     "avisoCancelacionEn" TIMESTAMP(3),
ADD COLUMN     "avisoConfirmacionEn" TIMESTAMP(3),
ADD COLUMN     "avisoCupoEn" TIMESTAMP(3);
