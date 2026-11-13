-- AlterTable
ALTER TABLE "ausencias" DROP COLUMN "horaFin",
DROP COLUMN "horaInicio",
DROP COLUMN "recuperable",
DROP COLUMN "todoElDia";

-- AlterTable
ALTER TABLE "salas" DROP COLUMN "exclusiva";
