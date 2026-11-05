-- G1.1: Ejecutar EXCLUSIVAMENTE despues de migraciones Prisma validadas en BD vacia de pruebas.
-- No se ejecuta automaticamente. No aplicar sobre produccion sin plan y respaldo validado.
BEGIN;
-- No puede haber dos participaciones activas del mismo consultor en un proyecto.
CREATE UNIQUE INDEX IF NOT EXISTS "ParticipacionConsultor_unica_activa"
  ON "ParticipacionConsultor" ("proyectoId", "usuarioId") WHERE "activo" = TRUE;
-- Solo un consultor principal activo por proyecto.
CREATE UNIQUE INDEX IF NOT EXISTS "ParticipacionConsultor_principal_unico"
  ON "ParticipacionConsultor" ("proyectoId") WHERE "activo" = TRUE AND "principal" = TRUE;
-- Una participacion activa no tiene fecha de retiro; una retirada si la tiene.
ALTER TABLE "ParticipacionConsultor" ADD CONSTRAINT "participacion_estado_fechas"
  CHECK (("activo" AND "retiradoEn" IS NULL) OR (NOT "activo" AND "retiradoEn" IS NOT NULL));
-- Cierre profesional debe registrar responsable, fecha y justificacion.
ALTER TABLE "BrechaProyecto" ADD CONSTRAINT "brecha_cierre_justificado"
  CHECK ("estado" <> 'CERRADA' OR
    ("cerradaPorId" IS NOT NULL AND "cerradaEn" IS NOT NULL
      AND "justificacionCierre" IS NOT NULL AND length(trim("justificacionCierre")) > 0));
-- El diagnostico origen siempre debe pertenecer al proyecto de la brecha.
-- Requiere unicidad auxiliar en (id,proyectoId) en Evaluacion, creada en migracion Prisma G1.
ALTER TABLE "BrechaProyecto" ADD CONSTRAINT "brecha_diagnostico_mismo_proyecto"
  FOREIGN KEY ("origenEvaluacionId", "proyectoId")
  REFERENCES "Evaluacion" ("id", "proyectoId") ON UPDATE RESTRICT ON DELETE RESTRICT;
-- Vincular un diagnostico a un proyecto de la misma empresa; comprobacion cuando se cambia la FK.
CREATE OR REPLACE FUNCTION g1_validar_empresa_diagnostico() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."proyectoId" IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM "ProyectoConsultoria" p
   WHERE p."id" = NEW."proyectoId" AND p."empresaId" = NEW."empresaId"
 ) THEN
   RAISE EXCEPTION 'El diagnostico y el proyecto pertenecen a distintas empresas';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "evaluacion_g1_empresa_proyecto"
 BEFORE INSERT OR UPDATE OF "proyectoId", "empresaId" ON "Evaluacion"
 FOR EACH ROW EXECUTE FUNCTION g1_validar_empresa_diagnostico();
COMMIT;
-- NOTA: el indice unico garantiza COMO MAXIMO un principal. La regla AL MENOS UNO
-- para proyecto ACTIVO la exige la transaccion de activacion/reasignacion y debe
-- validarse adicionalmente con pruebas SQL de concurrencia antes de produccion.
