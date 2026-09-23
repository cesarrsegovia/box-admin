-- Fase 5B: el indice que necesita el job diario de vencimiento de packs.
--
-- Va en una migracion aparte de 20260922223243_fase5b_comunicacion porque
-- aquella ya estaba aplicada cuando se detecto que faltaba, y editar una
-- migracion aplicada rompe el checksum que Prisma guarda en _prisma_migrations.
--
-- No es destructiva y no toca datos: solo crea un indice. Sobre una tabla
-- `perfiles` grande, un CREATE INDEX a secas toma un ACCESS EXCLUSIVE LOCK y
-- bloquea las escrituras mientras lo construye. Con los volumenes de un
-- gimnasio (cientos de filas por tenant) eso son milisegundos; si algun dia
-- dejara de serlo, la version de produccion es CREATE INDEX CONCURRENTLY, que
-- Prisma no genera solo porque no puede ir dentro de una transaccion.

-- CreateIndex
CREATE INDEX "perfiles_tenantId_vigenciaHasta_idx" ON "perfiles"("tenantId", "vigenciaHasta");
