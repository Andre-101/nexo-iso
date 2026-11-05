'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const PDFDocument = require('pdfkit');
const prisma = require('../config/prisma');
const { ESTADO: VALIDACION_SGSI, AVISO: AVISO_SGSI } = require('../utils/resultadoOrientativo');
const { autorizar } = require('../utils/proyecto-acceso');
const { idValido } = require('../utils/access');
const { uploadDir } = require('../middleware/upload.middleware');
const { estadoDeActividad, evaluarActividadesCierreBrecha } = require('../utils/g2-evidencias');
const { puedeAportarVersion } = require('../utils/g2-permisos');
const { puedeRevisarVersion } = require('../utils/g2-revision-permisos');
const { resumirVigenciaInforme } = require('../utils/sol35-informes');

const G2_ROOT = path.join(uploadDir, 'g2');
fs.mkdirSync(G2_ROOT, { recursive: true, mode: 0o700 });
function validText(value, max, required = true) {
  return typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);
}
function clean(value) { return typeof value === 'string' ? value.trim() : ''; }
function fail(res, status, message) { return res.status(status).json({ message }); }
function isDbConflict(error) { return ['P2002', 'P2003', 'P2034'].includes(error?.code); }
function archivoSeguro(filename) {
  if (typeof filename !== 'string' || !/^[0-9a-f-]{36}\.pdf$/i.test(filename)) return null;
  const target = path.resolve(G2_ROOT, filename);
  if (path.dirname(target) !== path.resolve(G2_ROOT)) return null;
  return target;
}
function borrarTemporal(req) {
  if (!req.file) return;
  if (archivoSeguro(path.basename(req.file.path)) !== path.resolve(req.file.path)) return;
  try { fs.unlinkSync(req.file.path); } catch (err) { if (err.code !== 'ENOENT') console.error('G2 limpieza fallida', err); }
}
async function registrar(tx, projectId, userId, accion, detail) {
  return tx.eventoProyecto.create({ data: { proyectoId: projectId, usuarioId: userId, accion, detalle: detail } });
}
async function actividad(db, proyectoId, id) {
  const num = idValido(id);
  if (!num) return null;
  return db.actividadProyecto.findFirst({ where: { id: num, proyectoId } });
}
// DEC-Q66: una cancelacion o modificacion congela la ejecucion pendiente sin
// destruir versiones, autores ni constancias anteriores.
async function alcanceVigente(db, proyectoId, act) {
  if (!act || act.cobertura !== 'ADICIONAL') return true;
  const agreement=await db.acuerdoAdicionalProyecto.findFirst({
    where:{id:act.acuerdoAdicionalId,proyectoId,estado:'HABILITADO'},select:{id:true}
  });
  return Boolean(agreement);
}
async function entregable(db, proyectoId, id) {
  const num = idValido(id);
  if (!num) return null;
  return db.entregableProyecto.findFirst({ where: { id: num, proyectoId }, include: { actividad: { select: { id: true, estado: true, asignadoAId: true, tipoResponsable: true, consultorRevisorId: true, cobertura: true, acuerdoAdicionalId: true } } } });
}
function permisoSubida(acceso, usuario, e) {
  return puedeAportarVersion(acceso.rol, usuario.id, e?.actividad);
}
async function listarEntregables(req, res) {
  const a = await autorizar(req, res); if (!a) return;
  const data = await prisma.entregableProyecto.findMany({
    where: { proyectoId: a.proyecto.id }, orderBy: { creadoEn: 'desc' },
    include: { versiones: { orderBy: { numero: 'desc' }, select: {
      id: true, numero: true, nombreOriginal: true, sha256: true, estadoRevision: true, creadoEn: true, subidoPorId: true,
      estadoCoelaboracion: true, consultorCoautorId: true, respuestaCoelaboracionEn: true, observacionCoelaboracion: true,
      revision: { select: { resultado: true, observacion: true, revisadoPorId: true, revisadoEn: true } },
    } } },
  });
  return res.json(data);
}
async function crearEntregable(req, res) {
  const a = await autorizar(req, res, { activo: true, consultor: true }); if (!a) return;
  const act = await actividad(prisma, a.proyecto.id, req.params.actividadId);
  if (!act) return fail(res, 404, 'Actividad no encontrada.');
  if (['COMPLETADA','CANCELADA'].includes(act.estado)) return fail(res, 409, 'Actividad finalizada.');
  if (!(await alcanceVigente(prisma,a.proyecto.id,act))) return fail(res,409,'Acuerdo adicional cancelado o modificado: no se puede crear trabajo nuevo.');
  const { titulo, criterio } = req.body || {};
  if (!validText(titulo, 180) || !validText(criterio, 4000)) return fail(res, 400, 'Titulo y criterio son obligatorios.');
  const result = await prisma.$transaction(async tx => {
    if (act.cobertura==='ADICIONAL' && typeof tx.$queryRaw==='function')
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(27183, CAST(${a.proyecto.id} AS INTEGER))`;
    if (!(await alcanceVigente(tx,a.proyecto.id,act))) return {blocked:true};
    const e = await tx.entregableProyecto.create({ data: {
      proyectoId: a.proyecto.id, actividadId: act.id, creadoPorId: req.usuario.id,
      titulo: clean(titulo), criterio: clean(criterio),
    } });
    await registrar(tx, a.proyecto.id, req.usuario.id, 'ENTREGABLE_CREADO', { entregableId: e.id, actividadId: act.id });
    return e;
  });
  return result.blocked?fail(res,409,'Acuerdo adicional ya no vigente.'):res.status(201).json(result);
}
/**
 * Comprueba autorización ANTES de que multer escriba PDF en volumen privado.
 * @param {import('express').Request} req Usuario autenticado en req.usuario.
 * @param {import('express').Response} res Resultado HTTP; ver rutas para contrato.
 * @returns {Promise<void>}
 */
async function autorizarSubida(req, res, next) {
  try {
    const a = await autorizar(req, res, { activo: true }); if (!a) return;
    const e = await entregable(prisma, a.proyecto.id, req.params.entregableId);
    if (!e) return fail(res, 404, 'Entregable no encontrado.');
    if (!permisoSubida(a, req.usuario, e)) return fail(res, 403, 'Usuario no autorizado para entregar este archivo.');
    if (['COMPLETADA','CANCELADA'].includes(e.actividad.estado)) return fail(res, 409, 'Actividad finalizada.');
    if (!(await alcanceVigente(prisma,a.proyecto.id,e.actividad))) return fail(res,409,'Alcance adicional sin autorización vigente.');
    req.g2Entregable = e;
    return next();
  } catch (error) { next(error); }
}
/**
 * Valida PDF, asocia hash/versionado y limpia temporales ante fallos.
 * @param {import('express').Request} req Usuario autenticado en req.usuario.
 * @param {import('express').Response} res Resultado HTTP; ver rutas para contrato.
 * @returns {Promise<void>}
 */
async function subirVersion(req, res) {
  if (!req.file) return fail(res, 400, 'Debe adjuntar un archivo PDF.');
  let retain = false;
  try {
    // El usuario puede perder participación o responsabilidad durante la subida.
    // Revalidar tras recibir bytes impide conservar aportes realizados con
    // permisos obsoletos, sin alterar el historial previo.
    const accesoActual = await autorizar(req, res, { activo: true });
    if (!accesoActual) return;
    const e = await entregable(prisma, accesoActual.proyecto.id, req.params.entregableId);
    if (!e) return fail(res, 404, 'Entregable no encontrado.');
    if (!permisoSubida(accesoActual, req.usuario, e))
      return fail(res, 403, 'El usuario ya no es aportante autorizado de esta actividad.');
    if (['COMPLETADA','CANCELADA'].includes(e.actividad.estado))
      return fail(res, 409, 'Actividad finalizada.');
    if (!(await alcanceVigente(prisma,accesoActual.proyecto.id,e.actividad)))
      return fail(res,409,'Acuerdo adicional sin autorización vigente.');
    const p = req.file.path;
    const fd = fs.openSync(p, 'r');
    const signature = Buffer.alloc(5);
    try { if (fs.readSync(fd, signature, 0, 5, 0) !== 5 || signature.toString('ascii') !== '%PDF-') {
      return fail(res, 400, 'El contenido no corresponde a un PDF.');
    } } finally { fs.closeSync(fd); }
    // El representante declara por versión; ausencia del campo se interpreta como NO (compatibilidad).
    const declaracion = req.body?.coelaboracion ?? 'NO';
    const aclaracionQ56 = req.body?.aclaracionCoelaboracion ?? '';
    if (!['SI','NO'].includes(declaracion)) return fail(res, 400, 'Declaración de coelaboración inválida.');
    if (!validText(aclaracionQ56, 2000, false)) return fail(res, 400, 'La aclaración de coelaboración es demasiado extensa.');
    if (declaracion === 'SI' && e.actividad.tipoResponsable !== 'CLIENTE')
      return fail(res, 400, 'La coelaboración declarable exige un aporte del representante.');
    if (declaracion === 'SI' && !e.actividad.consultorRevisorId)
      return fail(res, 409, 'El principal debe designar primero al consultor encargado.');
    const digest = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    const filename = path.basename(p);
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(27183, CAST(${e.proyectoId} AS INTEGER))`;
      const current = await tx.entregableProyecto.findUnique({ where: { id: e.id }, select: { versionActual: true, proyectoId: true } });
      const liveActivity = await tx.actividadProyecto.findFirst({ where: { id: e.actividadId, proyectoId: e.proyectoId } });
      if (!liveActivity || ['COMPLETADA','CANCELADA'].includes(liveActivity.estado)) return { conflict: true };
      if (!(await alcanceVigente(tx,e.proyectoId,liveActivity))) return {conflict:true};
      if (declaracion === 'SI') {
        if (!liveActivity.consultorRevisorId || liveActivity.consultorRevisorId !== e.actividad.consultorRevisorId)
          return { conflict: true };
        const asesor = await tx.participacionConsultor.findFirst({ where: {
          proyectoId: e.proyectoId, usuarioId: liveActivity.consultorRevisorId, activo: true, principal: false,
        }, include: { usuario: { select: { rol: true, activo: true } } } });
        if (!asesor?.usuario.activo || asesor.usuario.rol !== 'EVALUADOR') return { conflict: true };
      }
      if (!current || current.proyectoId !== e.proyectoId) return { conflict: true };
      // DEC-Q56: cuando la versión vigente declaró a un consultor retirado,
      // solo una NUEVA versión aclarada puede seguir el trámite. Conservamos
      // intactas las versiones previas y su declaración no confirmada.
      let versionReemplazadaQ56 = null;
      if (current.versionActual > 0) {
        const previa = await tx.documentoVersionProyecto.findFirst({ where: {
          entregableId: e.id, proyectoId: e.proyectoId, numero: current.versionActual,
        }, select: { id: true, consultorCoautorId: true, estadoCoelaboracion: true,
          estadoRevision: true } });
        if (previa?.estadoCoelaboracion === 'DECLARADA' && previa.estadoRevision === 'PENDIENTE') {
          if (!previa.consultorCoautorId) return { conflict: true };
          const coautorVigente = await tx.participacionConsultor.findFirst({ where: {
            proyectoId: e.proyectoId, usuarioId: previa.consultorCoautorId,
            activo: true, principal: false,
          } });
          if (!coautorVigente || liveActivity.consultorRevisorId !== previa.consultorCoautorId) {
            if (!liveActivity.consultorRevisorId || liveActivity.consultorRevisorId === previa.consultorCoautorId)
              return { q56: 'El principal debe designar al nuevo encargado antes de cargar la versión aclarada.' };
            const nuevoEncargado = await tx.participacionConsultor.findFirst({ where: {
              proyectoId: e.proyectoId, usuarioId: liveActivity.consultorRevisorId,
              activo: true, principal: false,
            } });
            if (!nuevoEncargado)
              return { q56: 'El nuevo encargado ya no participa; solicita una nueva designación.' };
            if (!clean(aclaracionQ56))
              return { q56: 'Indica por qué esta nueva versión aclara la declaración de coelaboración del consultor retirado.' };
            versionReemplazadaQ56 = previa.id;
          }
        }
      }
      const nextNumber = current.versionActual + 1;
      const update = await tx.entregableProyecto.updateMany({ where: {
        id: e.id, proyectoId: e.proyectoId, versionActual: current.versionActual,
      }, data: { versionActual: { increment: 1 } } });
      if (update.count !== 1) return { conflict: true };
      const saved = await tx.documentoVersionProyecto.create({ data: {
        entregableId: e.id, proyectoId: e.proyectoId, numero: nextNumber,
        nombreOriginal: path.basename(req.file.originalname).slice(0,180), archivoAlmacenado: filename,
        tamanoBytes: req.file.size, sha256: digest, subidoPorId: req.usuario.id,
        estadoCoelaboracion: declaracion === 'SI' ? 'DECLARADA' : 'NO_DECLARADA',
        consultorCoautorId: declaracion === 'SI' ? liveActivity.consultorRevisorId : null,
      } });
      await registrar(tx, e.proyectoId, req.usuario.id, 'VERSION_DOCUMENTAL_CARGADA', {
        entregableId: e.id, versionId: saved.id, numero: nextNumber,
        declaracionCoelaboracion: declaracion, consultorCoautorId: saved.consultorCoautorId,
        reemplazaDeclaracionSinConfirmarQ56: versionReemplazadaQ56,
        aclaracionCoelaboracionQ56: versionReemplazadaQ56 ? clean(aclaracionQ56) : null,
      });
      return { saved };
    }, { isolationLevel: 'Serializable' });
    if (result.conflict) return fail(res, 409, 'El entregable cambio durante la carga. Reintente.');
    if (result.q56) return fail(res, 409, result.q56);
    retain = true;
    return res.status(201).json({
      id: result.saved.id, entregableId: e.id, numero: result.saved.numero,
      estadoRevision: result.saved.estadoRevision || 'PENDIENTE', sha256: digest,
      estadoCoelaboracion: result.saved.estadoCoelaboracion, consultorCoautorId: result.saved.consultorCoautorId,
    });
  } catch (error) {
    if (isDbConflict(error)) return fail(res, 409, 'Carga concurrente. Reintente.');
    throw error;
  } finally { if (!retain) borrarTemporal(req); }
}
/**
 * Entrega bytes privados sólo tras control de proyecto y documento.
 * @param {import('express').Request} req Usuario autenticado en req.usuario.
 * @param {import('express').Response} res Resultado HTTP; ver rutas para contrato.
 * @returns {Promise<void>}
 */
async function descargarVersion(req, res) {
  const a = await autorizar(req, res); if (!a) return;
  const e = await entregable(prisma, a.proyecto.id, req.params.entregableId);
  if (!e) return fail(res, 404, 'Entregable no encontrado.');
  const versionId = idValido(req.params.versionId);
  if (!versionId) return fail(res, 400, 'Version invalida.');
  const version = await prisma.documentoVersionProyecto.findFirst({ where: {
    id: versionId, entregableId: e.id, proyectoId: a.proyecto.id,
  } });
  if (!version) return fail(res, 404, 'Version no encontrada.');
  const file = archivoSeguro(version.archivoAlmacenado);
  if (!file) return fail(res, 409, 'Ruta documental no confiable.');
  try {
    const real = await fs.promises.realpath(file);
    if (path.dirname(real) !== await fs.promises.realpath(G2_ROOT)) return fail(res, 409, 'Ubicacion no autorizada.');
  } catch { return fail(res, 404, 'Archivo no disponible.'); }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.download(file, version.nombreOriginal.replace(/[\r\n\\/]/g,'_'), {
    headers: { 'Content-Type': 'application/pdf' },
  }, err => { if (err && !res.headersSent) return fail(res, 404, 'Archivo no disponible.'); });
}
/** Q-55: solo el coautor nombrado confirma o rechaza la declaración del representante. */
async function responderCoelaboracion(req, res) {
  const acceso = await autorizar(req, res, { activo: true, consultor: true }); if (!acceso) return;
  const e = await entregable(prisma, acceso.proyecto.id, req.params.entregableId);
  const versionId = idValido(req.params.versionId);
  if (!e || !versionId) return fail(res, 404, 'Documento o versión no encontrada.');
  const { decision, observacion = '' } = req.body || {};
  if (!['CONFIRMADA', 'RECHAZADA'].includes(decision) || !validText(observacion, 2000, decision === 'RECHAZADA'))
    return fail(res, 400, 'Decisión u observación inválida.');
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(27183, CAST(${acceso.proyecto.id} AS INTEGER))`;
      const participacion = await tx.participacionConsultor.findFirst({ where: {
        proyectoId: acceso.proyecto.id, usuarioId: req.usuario.id, activo: true, principal: false,
      } });
      if (!participacion) return { status: 403, message: 'Consultor ya no participa como encargado vigente.' };
      if (!(await alcanceVigente(tx,acceso.proyecto.id,e.actividad)))
        return {status:409,message:'Acuerdo adicional cancelado o modificado; confirmacion pendiente suspendida.'};
      const v = await tx.documentoVersionProyecto.findFirst({ where: {
        id: versionId, entregableId: e.id, proyectoId: acceso.proyecto.id,
      } });
      if (!v) return { status: 404, message: 'Versión no encontrada.' };
      if (v.consultorCoautorId !== req.usuario.id) return { status: 403, message: 'Solo el consultor identificado puede responder.' };
      const responsableActual = await tx.actividadProyecto.findFirst({ where: {
        id: e.actividadId, proyectoId: acceso.proyecto.id,
      }, select: { consultorRevisorId: true } });
      if (responsableActual?.consultorRevisorId !== req.usuario.id)
        return { status: 409, message: 'El encargado ya cambió. La declaración previa permanece sin confirmar y la empresa debe aportar una nueva versión aclarada.' };
      const current = await tx.entregableProyecto.findUnique({ where: { id: e.id }, select: { versionActual: true } });
      if (v.estadoCoelaboracion !== 'DECLARADA' || v.estadoRevision !== 'PENDIENTE' || current?.versionActual !== v.numero)
        return { status: 409, message: 'La declaración ya fue respondida o no es la versión vigente.' };
      const update = await tx.documentoVersionProyecto.updateMany({ where: {
        id: v.id, proyectoId: acceso.proyecto.id, estadoCoelaboracion: 'DECLARADA', estadoRevision: 'PENDIENTE',
      }, data: { estadoCoelaboracion: decision, observacionCoelaboracion: clean(observacion), respuestaCoelaboracionEn: new Date() } });
      if (update.count !== 1) return { status: 409, message: 'Conflicto al confirmar la coelaboración.' };
      await registrar(tx, acceso.proyecto.id, req.usuario.id, 'COELABORACION_RESPONDIDA',
        { entregableId: e.id, versionId, consultorCoautorId: req.usuario.id, decision, observacion: clean(observacion) });
      return { status: 200, versionId, estadoCoelaboracion: decision };
    }, { isolationLevel: 'Serializable' });
    return res.status(result.status).json(result.message ? { message: result.message } : result);
  } catch (error) {
    if (isDbConflict(error)) return fail(res, 409, 'Conflicto de concurrencia. Recarga el expediente.');
    throw error;
  }
}

/**
 * Añade revisión de una versión actual; no implica verificación operativa.
 * @param {import('express').Request} req Usuario autenticado en req.usuario.
 * @param {import('express').Response} res Resultado HTTP; ver rutas para contrato.
 * @returns {Promise<void>}
 */
async function revisarVersion(req, res) {
  const a = await autorizar(req, res, { activo: true, consultor: true }); if (!a) return;
  const e = await entregable(prisma, a.proyecto.id, req.params.entregableId);
  if (!e) return fail(res, 404, 'Entregable no encontrado.');
  const vid = idValido(req.params.versionId);
  if (!vid) return fail(res, 400, 'Version invalida.');
  const { resultado, observacion = '' } = req.body || {};
  if (!['ACEPTADA','CORRECCION_REQUERIDA'].includes(resultado) ||
      !validText(observacion, 5000, resultado !== 'ACEPTADA')) return fail(res, 400, 'Resultado u observacion invalida.');
  try {
    const result = await prisma.$transaction(async tx => {
      const v = await tx.documentoVersionProyecto.findFirst({ where: {
        id: vid, proyectoId: a.proyecto.id, entregableId: e.id,
      } });
      const latest = await tx.entregableProyecto.findUnique({ where: { id: e.id }, select: { versionActual: true } });
      if (e.actividad.cobertura==='ADICIONAL' && typeof tx.$queryRaw==='function')
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(27183, CAST(${a.proyecto.id} AS INTEGER))`;
      if (!(await alcanceVigente(tx,a.proyecto.id,e.actividad))) return {conflict:true};
      if (!v) return { missing: true };
      // SOL-02: no permitir que un consultor ordinario apruebe su propio aporte.
      if (!puedeRevisarVersion(a.rol, req.usuario.id, e.actividad, v)) return { forbidden: true };
      if (!latest || v.numero !== latest.versionActual || v.estadoRevision !== 'PENDIENTE') return { conflict: true };
      const update = await tx.documentoVersionProyecto.updateMany({ where: {
        id: v.id, proyectoId: a.proyecto.id, estadoRevision: 'PENDIENTE',
      }, data: { estadoRevision: resultado } });
      if (update.count !== 1) return { conflict: true };
      const review = await tx.revisionDocumentalProyecto.create({ data: {
        proyectoId: a.proyecto.id, versionId: v.id, resultado, observacion: clean(observacion), revisadoPorId: req.usuario.id,
      } });
      await registrar(tx, a.proyecto.id, req.usuario.id, 'VERSION_DOCUMENTAL_REVISADA', { entregableId: e.id, versionId: v.id, resultado });
      return { review };
    }, { isolationLevel: 'Serializable' });
    if (result.missing) return fail(res, 404, 'Version no encontrada.');
    if (result.forbidden) return fail(res, 403, 'Solo el revisor autorizado puede aprobar esta version; no se permite aprobar aportes propios.');
    if (result.conflict) return fail(res, 409, 'Version anterior o ya revisada.');
    return res.status(201).json(result.review);
  } catch (error) {
    if (isDbConflict(error)) return fail(res, 409, 'Conflicto de revision.');
    throw error;
  }
}
/**
 * Registra evidencia independiente de operación real declarada por consultor.
 * @param {import('express').Request} req Usuario autenticado en req.usuario.
 * @param {import('express').Response} res Resultado HTTP; ver rutas para contrato.
 * @returns {Promise<void>}
 */
async function verificarImplementacion(req, res) {
  const a = await autorizar(req, res, { activo: true, consultor: true }); if (!a) return;
  const act = await actividad(prisma, a.proyecto.id, req.params.actividadId);
  if (!act) return fail(res, 404, 'Actividad no encontrada.');
  if (act.estado !== 'EN_REVISION') return fail(res, 409, 'La actividad debe estar EN_REVISION para verificar implementacion.');
  if (!(await alcanceVigente(prisma,a.proyecto.id,act))) return fail(res,409,'Acuerdo adicional ya no autoriza verificaciones.');
  const { resultado, metodo, evidencia, justificacion } = req.body || {};
  if (!['VERIFICADA','NO_VERIFICADA','NO_APLICA'].includes(resultado) ||
      !validText(metodo,180) || !validText(evidencia,5000,false) ||
      !validText(justificacion,4000) ||
      (resultado === 'VERIFICADA' && !clean(evidencia))) return fail(res, 400, 'Se requiere resultado, metodo y justificacion; la verificacion positiva requiere evidencia.');
  const created = await prisma.$transaction(async tx => {
    if (act.cobertura==='ADICIONAL' && typeof tx.$queryRaw==='function')
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(27183, CAST(${a.proyecto.id} AS INTEGER))`;
    if (!(await alcanceVigente(tx,a.proyecto.id,act))) return {blocked:true};
    const v = await tx.verificacionOperativaProyecto.create({ data: {
      proyectoId: a.proyecto.id, actividadId: act.id, resultado, metodo: clean(metodo),
      evidencia: clean(evidencia), justificacion: clean(justificacion), verificadoPorId: req.usuario.id,
    } });
    await registrar(tx, a.proyecto.id, req.usuario.id, 'IMPLEMENTACION_VERIFICADA', { actividadId: act.id, verificacionId: v.id, resultado });
    return v;
  });
  return created.blocked?fail(res,409,'Acuerdo adicional ya no vigente.'):res.status(201).json(created);
}
async function listarVerificaciones(req, res) {
  const a = await autorizar(req, res); if (!a) return;
  const act = await actividad(prisma, a.proyecto.id, req.params.actividadId);
  if (!act) return fail(res, 404, 'Actividad no encontrada.');
  const data = await prisma.verificacionOperativaProyecto.findMany({ where: {
    proyectoId: a.proyecto.id, actividadId: act.id,
  }, orderBy: [{ verificadoEn: 'desc' }, { id: 'desc' }] });
  return res.json(data);
}
/**
 * Formaliza cierre cuando existe la justificación exigida y líder autorizado.
 * @param {import('express').Request} req Usuario autenticado en req.usuario.
 * @param {import('express').Response} res Resultado HTTP; ver rutas para contrato.
 * @returns {Promise<void>}
 */
async function cerrarBrecha(req, res) {
  const a = await autorizar(req, res, { activo: true, lider: true }); if (!a) return;
  const bid = idValido(req.params.brechaId);
  if (!bid || !validText(req.body?.justificacion,4000)) return fail(res, 400, 'Brecha y justificacion requeridas.');
  try {
    const result = await prisma.$transaction(async tx => {
      const b = await tx.brechaProyecto.findFirst({ where: { id: bid, proyectoId: a.proyecto.id },
        include: { actividades: { select: { actividadId: true, excluidaEn: true,
          actividad: { select: { id: true, estado: true, cobertura: true, actividadOrigenId: true } },
        } } },
      });
      if (!b) return { missing: true };
      if (b.estado !== 'PROPUESTA_CIERRE') return { conflict: true };
      const evaluacion = await evaluarActividadesCierreBrecha(tx, a.proyecto.id, b);
      if (!evaluacion.lista) return { conflict: true, motivo: evaluacion.motivo };
      const justificacionCobertura = clean(req.body?.justificacionCoberturaRamificada);
      if ((evaluacion.ramificaciones.length || evaluacion.exclusionesActividadIds?.length) && (justificacionCobertura.length < 10 || justificacionCobertura.length > 4000))
        return { conflict: true, motivo: 'El principal debe justificar expresamente que todas las ramas cubren el alcance de la brecha (10 a 4000 caracteres).' };
      const changed = await tx.brechaProyecto.updateMany({ where: {
        id: bid, proyectoId: a.proyecto.id, estado: 'PROPUESTA_CIERRE',
      }, data: { estado: 'CERRADA', cerradaPorId: req.usuario.id, cerradaEn: new Date(),
        justificacionCierre: clean(req.body.justificacion),
      } });
      if (!changed.count) return { conflict: true };
      await registrar(tx, a.proyecto.id, req.usuario.id, 'BRECHA_CERRADA_G2', { brechaId: bid, justificacion: clean(req.body.justificacion), continuidades: evaluacion.continuidades, exclusionesActividadIds: evaluacion.exclusionesActividadIds || [], justificacionCoberturaRamificada: (evaluacion.ramificaciones.length || evaluacion.exclusionesActividadIds?.length) ? justificacionCobertura : null });
      return { ok: true };
    }, { isolationLevel: 'Serializable' });
    if (result.missing) return fail(res, 404, 'Brecha no encontrada.');
    if (result.conflict) return fail(res, 409, result.motivo || 'No se puede cerrar: tareas, evidencias o verificacion pendientes.');
    return res.json({ id: bid, estado: 'CERRADA', aviso: 'Decision interna de consultoria, no certificacion oficial.' });
  } catch (error) { if (isDbConflict(error)) return fail(res, 409, 'Conflicto de cierre.'); throw error; }
}
async function resumenProyecto(db, id) {
  const [brechas, actividades, entregables] = await Promise.all([
    db.brechaProyecto.findMany({ where: { proyectoId: id }, select: { id: true, estado: true } }),
    db.actividadProyecto.findMany({ where: { proyectoId: id }, select: { id: true, estado: true } }),
    db.entregableProyecto.findMany({ where: { proyectoId: id }, include: {
      versiones: { select: { numero: true, estadoRevision: true } },
    } }),
  ]);
  const pendientesDocumento = entregables.filter(e => !e.versionActual ||
    !e.versiones.some(v => v.numero === e.versionActual && v.estadoRevision === 'ACEPTADA')).length;
  return {
    brechasTotal: brechas.length, brechasAbiertas: brechas.filter(b => b.estado !== 'CERRADA').length,
    actividadesTotal: actividades.length, actividadesPendientes: actividades.filter(x => x.estado !== 'COMPLETADA' && x.estado !== 'CANCELADA').length,
    entregablesTotal: entregables.length, entregablesPendientes: pendientesDocumento,
  };
}
async function eventosVigenciaInformes(db, proyectoId) {
  return db.eventoProyecto.findMany({ where: { proyectoId,
    accion: { in: ['INFORME_AFECTADO_SOL35','INFORME_SUSTITUIDO_SOL35'] },
  }, select: { id: true, accion: true, detalle: true }, orderBy: { id: 'asc' } });
}
async function listarInformes(req, res) {
  const a = await autorizar(req, res); if (!a) return;
  const [reports, events] = await Promise.all([
    prisma.informePreparacionProyecto.findMany({ where: { proyectoId: a.proyecto.id },
      orderBy: { numero: 'desc' }, select: { id: true, numero: true, resumen: true,
        recomendaciones: true, instantanea: true, publicadoEn: true, publicadoPorId: true } }),
    eventosVigenciaInformes(prisma, a.proyecto.id),
  ]);
  const estados = resumirVigenciaInforme(events);
  return res.json(reports.map(report => ({ ...report,
    vigenciaDocumental: estados.get(report.id)?.estado || 'VIGENTE',
    informacionVigencia: estados.get(report.id) || null,
  })));
}

/** SOL-35: principal confirma explícitamente que la corrección afecta un informe.
 * No se infiere afectación a partir de un cambio editorial o de la reapertura.
 */
async function marcarInformeAfectado(req, res) {
  const a = await autorizar(req, res, { activo: true, lider: true });if(!a)return;
  const informeId = idValido(req.params.informeId);
  const brechaId = idValido(req.body?.brechaId);
  const justificacion = clean(req.body?.justificacion);
  if (!informeId || !brechaId || justificacion.length < 10 || justificacion.length > 4000)
    return fail(res,400,'Informe, brecha y motivo profesional de afectación (10 a 4000 caracteres) obligatorios.');
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(27183, CAST(${a.proyecto.id} AS INTEGER))`;
      const [proyecto, lider, report, breach] = await Promise.all([
        tx.proyectoConsultoria.findFirst({ where: { id:a.proyecto.id, estado:'ACTIVO' }, select: {id:true} }),
        tx.participacionConsultor.findFirst({ where: { proyectoId:a.proyecto.id, usuarioId:req.usuario.id, principal:true,
          activo:true, usuario:{ activo:true, rol:'EVALUADOR' } }, select:{id:true} }),
        tx.informePreparacionProyecto.findFirst({ where: { id:informeId, proyectoId:a.proyecto.id },select:{id:true} }),
        tx.brechaProyecto.findFirst({ where: { id:brechaId, proyectoId:a.proyecto.id },select:{id:true} }),
      ]);
      if (!proyecto || !lider)return {status:403,message:'El principal o proyecto dejaron de estar vigentes.'};
      if (!report || !breach)return {status:404,message:'El informe o brecha no pertenecen al proyecto.'};
      const vigencia=resumirVigenciaInforme(await eventosVigenciaInformes(tx,a.proyecto.id));
      if (vigencia.has(informeId))return {status:409,message:'El informe ya fue señalado o sustituido; consulte su historial.'};
      await registrar(tx,a.proyecto.id,req.usuario.id,'INFORME_AFECTADO_SOL35',{
        informeId,brechaId,justificacion,requiereSustitucion:true,
        noModificaInformeOriginal:true,noEquivaleACertificacion:true,
      });
      return {status:201,informeId,vigenciaDocumental:'REQUIERE_ACTUALIZACION'};
    },{isolationLevel:'Serializable'});
    return res.status(result.status).json(result.status===201?result:{message:result.message});
  }catch(error){if(isDbConflict(error))return fail(res,409,'Conflicto al registrar la afectación.');throw error;}
}

/**
 * Publica resumen de preparación no oficial con instantánea del proyecto.
 * @param {import('express').Request} req Usuario autenticado en req.usuario.
 * @param {import('express').Response} res Resultado HTTP; ver rutas para contrato.
 * @returns {Promise<void>}
 */
async function publicarInforme(req, res) {
  const a = await autorizar(req, res, { activo: true, lider: true }); if (!a) return;
  if (!validText(req.body?.resumen,10000) || !validText(req.body?.recomendaciones,10000))
    return fail(res,400,'Resumen y recomendaciones requeridos.');
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(27183, CAST(${a.proyecto.id} AS INTEGER))`;
      const [actual, vigente] = await Promise.all([
        tx.proyectoConsultoria.findFirst({where:{id:a.proyecto.id,estado:'ACTIVO'},select:{id:true}}),
        tx.participacionConsultor.findFirst({where:{proyectoId:a.proyecto.id,usuarioId:req.usuario.id,
          principal:true,activo:true,usuario:{activo:true,rol:'EVALUADOR'}},select:{id:true}}),
      ]);
      if(!actual || !vigente)return {status:403,message:'Proyecto o principal no vigentes.'};
      const estados = resumirVigenciaInforme(await eventosVigenciaInformes(tx,a.proyecto.id));
      const pendientes = [...estados.entries()].filter(([,v])=>v.estado==='REQUIERE_ACTUALIZACION').map(([id])=>id);
      const sustituyeId = req.body?.sustituyeInformeId == null || req.body?.sustituyeInformeId === ''
        ? null : idValido(req.body.sustituyeInformeId);
      if((pendientes.length && !pendientes.includes(sustituyeId)) || (!pendientes.length && sustituyeId))
        return {status:409,message:'Debe indicar explícitamente uno de los informes afectados pendientes para sustituirlo.'};
      if(pendientes.length && !sustituyeId)
        return {status:409,message:'Existe informe afectado pendiente de sustitución.'};
      const ultimo = await tx.informePreparacionProyecto.findFirst({ where: { proyectoId: a.proyecto.id }, orderBy: { numero: 'desc' }, select: { numero: true } });
      const numero = (ultimo?.numero || 0) + 1;
      const instantanea = await resumenProyecto(tx, a.proyecto.id);
      const data = await tx.informePreparacionProyecto.create({ data: {
        proyectoId: a.proyecto.id, numero, resumen: clean(req.body.resumen),
        recomendaciones: clean(req.body.recomendaciones), publicadoPorId: req.usuario.id,
        instantanea: { ...instantanea, fechaCorte: new Date().toISOString(),
          estadoValidacionCriterios: VALIDACION_SGSI,
          advertencia: `${AVISO_SGSI} No constituye certificacion oficial ISO/IEC 27001.` },
      } });
      await registrar(tx, a.proyecto.id, req.usuario.id, 'INFORME_PREPARACION_PUBLICADO', { informeId: data.id, numero });
      if(sustituyeId)await registrar(tx,a.proyecto.id,req.usuario.id,'INFORME_SUSTITUIDO_SOL35',{
        informeAnteriorId:sustituyeId,informeNuevoId:data.id,numeroNuevo:numero,
        conservaOriginal:true,noEsDictamenFavorable:true,
      });
      return {status:201,report:data};
    }, { isolationLevel: 'Serializable' });
    return res.status(result.status).json(result.status===201?result.report:{message:result.message});
  } catch (error) { if (isDbConflict(error)) return fail(res,409,'Publicacion concurrente. Reintente.'); throw error; }
}
async function descargarInforme(req, res) {
  const a = await autorizar(req, res); if (!a) return;
  const id = idValido(req.params.informeId);
  if (!id) return fail(res,400,'Informe invalido.');
  const report = await prisma.informePreparacionProyecto.findFirst({ where: { id, proyectoId: a.proyecto.id } });
  if (!report) return fail(res,404,'Informe no encontrado.');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="informe-preparacion-${a.proyecto.id}-${report.numero}.pdf"`);
  const pdf = new PDFDocument({ margin: 55, size: 'A4', info: { Title: 'Informe de preparacion - consultoria' } });
  pdf.on('error', error => { console.error('PDF G2',error); if (!res.headersSent) fail(res,500,'No se pudo generar el PDF.'); else res.destroy(error); });
  pdf.pipe(res);
  pdf.fontSize(18).text('Informe de preparacion ISO/IEC 27001');
  pdf.moveDown().fontSize(10).text('Informe interno de seguimiento. Criterios de preparación y cuestionario pendientes de validación experta. No es un certificado oficial ni un dictamen automático favorable.', { underline: true });
  pdf.moveDown().text(`Proyecto: ${a.proyecto.nombre}`);
  pdf.text(`Empresa: ${a.proyecto.empresa.nombre}`);
  pdf.text(`Informe numero: ${report.numero}`);
  const vigencia=resumirVigenciaInforme(await eventosVigenciaInformes(prisma,a.proyecto.id)).get(report.id);
  if(vigencia?.estado==='REQUIERE_ACTUALIZACION')
    pdf.text('ADVERTENCIA: informe histórico afectado por corrección; requiere actualización profesional.');
  else if(vigencia?.estado==='SUSTITUIDO')
    pdf.text(`INFORME HISTÓRICO: sustituido por el informe con ID ${vigencia.sustituidoPorId}.`);
  pdf.text(`Fecha: ${new Date(report.publicadoEn).toISOString().slice(0,10)}`);
  pdf.moveDown().fontSize(13).text('Resumen profesional').fontSize(10).text(report.resumen);
  pdf.moveDown().fontSize(13).text('Recomendaciones').fontSize(10).text(report.recomendaciones);
  const s = report.instantanea;
  pdf.moveDown().fontSize(13).text('Estado registrado al publicar').fontSize(10);
  for (const [k,label] of [['brechasTotal','Brechas identificadas'],['brechasAbiertas','Brechas sin cerrar'],
    ['actividadesTotal','Actividades registradas'],['actividadesPendientes','Actividades pendientes'],
    ['entregablesTotal','Entregables registrados'],['entregablesPendientes','Entregables sin aceptacion vigente']])
    pdf.text(`${label}: ${s[k] ?? 'Sin dato'}`);
  pdf.moveDown().fontSize(9).text(AVISO_SGSI);
  pdf.end();
}
module.exports = { listarEntregables, crearEntregable, autorizarSubida, subirVersion, descargarVersion,
  revisarVersion, responderCoelaboracion, verificarImplementacion, listarVerificaciones, cerrarBrecha, listarInformes, publicarInforme, descargarInforme, marcarInformeAfectado };
