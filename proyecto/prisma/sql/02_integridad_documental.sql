-- G2.1: restricciones adicionales EXCLUSIVAMENTE para BD NUEVA/DESCARTABLE
-- Ejecutar despues de generar y aplicar migraciones Prisma validadas en PostgreSQL 16.
-- No ejecutar sin revisar los nombres reales de las tablas y hacer backup/verificacion.
BEGIN;
ALTER TABLE "EntregableProyecto" ADD CONSTRAINT "g2_version_actual_no_negativa" CHECK ("versionActual" >= 0);
ALTER TABLE "DocumentoVersionProyecto" ADD CONSTRAINT "g2_numero_version_positivo" CHECK ("numero" > 0);
ALTER TABLE "DocumentoVersionProyecto" ADD CONSTRAINT "g2_tamano_pdf_razonable" CHECK ("tamanoBytes" > 0 AND "tamanoBytes" <= 10485760);
ALTER TABLE "DocumentoVersionProyecto" ADD CONSTRAINT "g2_sha256_hex" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "DocumentoVersionProyecto" ADD CONSTRAINT "g2_nombre_almacenado_uuid" CHECK ("archivoAlmacenado" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$');
ALTER TABLE "RevisionDocumentalProyecto" ADD CONSTRAINT "g2_solo_decisiones_finales" CHECK ("resultado" <> 'PENDIENTE');

-- Las decisiones profesionales y los informes se conservan historicamente.
CREATE OR REPLACE FUNCTION g2_registros_inmutables() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
   RAISE EXCEPTION 'Los registros G2 son inmutables: % %', TG_TABLE_NAME, TG_OP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "g2_bloquear_revision_mutable" BEFORE UPDATE OR DELETE ON "RevisionDocumentalProyecto"
 FOR EACH ROW EXECUTE FUNCTION g2_registros_inmutables();
CREATE TRIGGER "g2_bloquear_verificacion_mutable" BEFORE UPDATE OR DELETE ON "VerificacionOperativaProyecto"
 FOR EACH ROW EXECUTE FUNCTION g2_registros_inmutables();
CREATE TRIGGER "g2_bloquear_informe_mutable" BEFORE UPDATE OR DELETE ON "InformePreparacionProyecto"
 FOR EACH ROW EXECUTE FUNCTION g2_registros_inmutables();

-- Una version solo cambia una vez desde PENDIENTE a su resultado documental.
CREATE OR REPLACE FUNCTION g2_proteger_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
   RAISE EXCEPTION 'No se pueden eliminar versiones documentales';
 END IF;
 IF OLD."estadoRevision" <> 'PENDIENTE'
    OR NEW."estadoRevision" NOT IN ('ACEPTADA', 'CORRECCION_REQUERIDA')
    OR (to_jsonb(NEW) - 'estadoRevision') IS DISTINCT FROM (to_jsonb(OLD) - 'estadoRevision') THEN
   RAISE EXCEPTION 'Una version documental solo permite registrar una decision final';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "g2_proteger_version" BEFORE UPDATE OR DELETE ON "DocumentoVersionProyecto"
 FOR EACH ROW EXECUTE FUNCTION g2_proteger_version();
COMMIT;

-- PENDIENTES ANTES DE PRODUCCION:
-- (1) Prueba transaccional con PostgreSQL: aceptar solo ultimo numero de version.
-- (2) Retencion/antimalware/PDF parsing aislado; backups de DB Y archivos.
-- (3) Controles de autorizacion por proyecto y revisión de TOCTOU concurrente.
-- (4) Los triggers NO reemplazan politicas de acceso al propio servidor de BD.
