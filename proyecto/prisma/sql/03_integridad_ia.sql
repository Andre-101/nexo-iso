-- G3: crear solo DESPUES de prisma db push, sobre base desechable.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS "g3_un_analisis_activo_version"
  ON "AnalisisDocumentoIA" ("versionId") WHERE "estado" = 'EN_PROCESO';
ALTER TABLE "AnalisisDocumentoIA"
 ADD CONSTRAINT "g3_sha256_valid" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "HallazgoDocumentoIA"
 ADD CONSTRAINT "g3_pagina_positiva" CHECK ("pagina" > 0);
COMMIT;
