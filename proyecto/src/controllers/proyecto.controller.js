const prisma = require('../config/prisma');
const tomarCandadoPrisma330=(tx,espacio,id)=>require('../utils/candado-prisma-330').tomarCandadoPrisma330(tx,espacio,id);
const { idValido } = require('../utils/access');
const { autorizar } = require('../utils/proyecto-acceso');
const { estadoDeActividad, evaluarActividadesCierreBrecha } = require('../utils/g2-evidencias');
const { clasificarAlta } = require('../utils/identidad-normativa');

const str = (v, max=200) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const validarObligatorio = (v, max=200) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
const conflictoDB = e => ['P2002', 'P2034', 'P2003'].includes(e.code);
async function evento(tx, proyectoId, usuarioId, accion, detalle) {
  return tx.eventoProyecto.create({ data: { proyectoId, usuarioId, accion, detalle } });
}
async function listar(req, res) {
  let where = {};
  if (req.usuario.rol === 'EMPRESARIO') where = { empresa: { usuarioId: req.usuario.id } };
  else if (req.usuario.rol === 'EVALUADOR') where = {
    participaciones: { some: { usuarioId: req.usuario.id, activo: true } },
  };
  const proyectos = await prisma.proyectoConsultoria.findMany({
    where, orderBy: { creadoEn: 'desc' },
    include: { empresa: { select: { id: true, nombre: true } }, participaciones: {
      where: { activo: true }, select: { usuarioId: true, principal: true },
    } },
  });
  return res.json(proyectos);
}
async function obtener(req, res) {
  const acceso = await autorizar(req, res);
  if (!acceso) return;
  return res.json(acceso.proyecto);
}
/**
 * Crea proyecto activo después de validar empresa, contrato, consultor principal y permisos de ADMIN.
 * @param {import('express').Request} req Usuario autenticado en req.usuario.
 * @param {import('express').Response} res Resultado HTTP; ver rutas para contrato.
 * @returns {Promise<void>}
 */
async function crear(req, res) {
  const { empresaId, consultorPrincipalId, nombre, referenciaContrato, alcanceContractual, alcanceSGSIPropuesto, iaHabilitada } = req.body || {};
  // DEC-IA70-01-B: solamente una decisión explícita false desactiva al crear;
  // valores ambiguos ("false", 0, null) no se interpretan como consentimiento.
  if (iaHabilitada !== undefined && typeof iaHabilitada !== 'boolean')
    return res.status(400).json({message:'iaHabilitada debe ser booleano cuando se indique.'});
  const empresaNum = idValido(empresaId), consultorNum = idValido(consultorPrincipalId);
  const identidadNormativa = clasificarAlta(req.body);
  if (!identidadNormativa) return res.status(400).json({
    message: 'Indique explícitamente normaCodigo y edicionNormativa: ISO_27001/2022 o ISO_42001/2023. No se infiere desde el contrato.',
  });
  if (!empresaNum || !consultorNum || !validarObligatorio(nombre, 200) ||
      !validarObligatorio(referenciaContrato, 120) || !validarObligatorio(alcanceContractual, 12000) ||
      (alcanceSGSIPropuesto != null && typeof alcanceSGSIPropuesto !== 'string')) {
    return res.status(400).json({ message: 'Empresa, consultor principal, nombre, referencia y alcance contractual son obligatorios.' });
  }
  const empresa = await prisma.empresa.findUnique({ where: { id: empresaNum } });
  const consultor = await prisma.usuario.findUnique({ where: { id: consultorNum } });
  if (!empresa || empresa.estado !== 'APROBADA' || empresa.origenDatos === 'LEGADO' || empresa.bloqueoNuevosProyectos ||
      !consultor || !consultor.activo || consultor.rol !== 'EVALUADOR')
    return res.status(400).json({ message: 'Empresa habilitada y consultor activo requeridos.' });
  try {
    const proyecto = await prisma.$transaction(async tx => {
      // SOL-47: serializa alta contra la conciliación/reconsulta y revalida el bloqueo
      // bajo el mismo candado por empresa. No basta la comprobación anterior al TX.
      await tomarCandadoPrisma330(tx,'EMPRESA',empresaNum);
      const vigente = await tx.empresa.findUnique({where:{id:empresaNum},select:{
        id:true,estado:true,origenDatos:true,bloqueoNuevosProyectos:true,
      }});
      if(!vigente || vigente.estado!=='APROBADA' || vigente.origenDatos==='LEGADO' || vigente.bloqueoNuevosProyectos)
        return null;
      const creado = await tx.proyectoConsultoria.create({ data: {
        empresaId: empresaNum, creadoPorId: req.usuario.id,
        nombre: nombre.trim(), referenciaContrato: referenciaContrato.trim(),
        alcanceContractual: alcanceContractual.trim(),
        alcanceSGSIPropuesto: alcanceSGSIPropuesto?.trim() || null,
        ...identidadNormativa,
        iaEstado:iaHabilitada===false?'DESACTIVADA_AL_CREAR':'HABILITADA',
        estado: 'ACTIVO',
      } });
      await tx.participacionConsultor.create({ data: {
        proyectoId: creado.id, usuarioId: consultorNum, principal: true, activo: true,
      } });
      await evento(tx, creado.id, req.usuario.id, 'PROYECTO_ACTIVADO', { consultorPrincipalId: consultorNum, referenciaContrato: referenciaContrato.trim(), ...identidadNormativa, iaEstado:creado.iaEstado });
      return creado;
    }, { isolationLevel: 'Serializable' });
    if (!proyecto) return res.status(409).json({message:'La situación registral de la empresa impide nuevos proyectos hasta revisión.'});
    return res.status(201).json(proyecto);
  } catch (e) {
    if (e?.code==='CANDADO_330_NO_ACREDITADO')
      return res.status(503).json({ message: 'Control registral no disponible; no se creó el proyecto.' });
    if (conflictoDB(e)) return res.status(409).json({ message: 'Conflicto al activar proyecto.' });
    throw e;
  }
}
/**
 * Directorio mínimo de consultores activos para quien puede incorporar
 * colaboradores al equipo. No expone correos, cuentas cliente ni permisos globales.
 * La consulta de candidatos NO concede acceso al expediente.
 */
async function consultoresDisponibles(req, res) {
  const acceso = await autorizar(req, res, { activo: true });
  if (!acceso) return;
  if (!acceso.rol.admin && !acceso.rol.lider)
    return res.status(403).json({ message: 'Solo ADMIN o el principal de este proyecto gestionan colaboradores.' });
  const activos = new Set(acceso.proyecto.participaciones.filter(p => p.usuario.activo).map(p => p.usuarioId));
  const disponibles = await prisma.usuario.findMany({
    where: { rol: 'EVALUADOR', activo: true },
    select: { id: true, nombre: true }, orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
  });
  return res.json(disponibles.filter(u => !activos.has(u.id)));
}
/**
 * RN-07: ADMIN designa/reemplaza principal; ADMIN y principal vigente pueden
 * incorporar colaboradores. El principal nunca se reemplaza a sí mismo.
 * Las asignaciones se serializan por proyecto y registran su actor.
 */
async function asignar(req, res) {
  const acceso = await autorizar(req, res, { activo: true });
  if (!acceso) return;
  if (!acceso.rol.admin && !acceso.rol.lider)
    return res.status(403).json({ message: 'Sin autoridad para gestionar este equipo.' });
  const usuarioId = idValido(req.body?.usuarioId);
  const principal = req.body?.principal;
  if (!usuarioId || typeof principal !== 'boolean')
    return res.status(400).json({ message: 'usuarioId y principal (booleano) requeridos.' });
  if (principal && !acceso.rol.admin)
    return res.status(403).json({ message: 'Solo ADMIN puede designar o reemplazar al principal.' });
  try {
    const resultado = await prisma.$transaction(async tx => {
      await tomarCandadoPrisma330(tx,'PROYECTO',acceso.proyecto.id);
      if (!acceso.rol.admin) {
        const actor = await tx.participacionConsultor.findFirst({ where: {
          proyectoId: acceso.proyecto.id, usuarioId: req.usuario.id, principal: true, activo: true,
          usuario: { activo: true, rol: 'EVALUADOR' },
        } });
        if (!actor) return { status: 403, message: 'El liderazgo cambió. Recarga el expediente.' };
      }
      const candidato = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { activo: true, rol: true } });
      if (!candidato || !candidato.activo || candidato.rol !== 'EVALUADOR')
        return { status: 409, message: 'El consultor ya no está activo o no es elegible.' };
      const existentes = await tx.participacionConsultor.findMany({ where: { proyectoId: acceso.proyecto.id, activo: true } });
      const actual = existentes.find(x => x.usuarioId === usuarioId);
      if (actual && actual.principal === principal)
        return { status: 409, message: 'El consultor ya tiene esa participación vigente.' };
      if (principal) {
        // SOL-07/10: no promover a quien aportó evidencia de una actividad
        // todavía pendiente. ADMIN debe resolverla con revisión, anulación
        // justificada o reasignación y resolución ANTES de nombrarlo principal.
        // Solo se revisa evidencia del propio proyecto; la autoría no cambia.
        const pendientes = await tx.documentoVersionProyecto.count({ where: {
          proyectoId: acceso.proyecto.id, subidoPorId: usuarioId,
          entregable: { actividad: { estado: { notIn: ['COMPLETADA','CANCELADA'] } } },
        } });
        if (pendientes > 0) return { status: 409,
          message: 'No puede designarse principal: aportó evidencias en actividades pendientes. ADMIN debe resolverlas primero conforme a SOL-07/10.' };

        // La sustitución formal del principal conserva sus propias reglas SOL-07/10.
        // No se elimina ni se reasigna ninguna actividad con este cambio.
        await tx.participacionConsultor.updateMany({
          where: { proyectoId: acceso.proyecto.id, activo: true, principal: true },
          data: { principal: false },
        });
      } else if (actual?.principal)
        return { status: 403, message: 'El principal solo puede ser reemplazado por ADMIN mediante su procedimiento.' };
      if (actual) {
        await tx.participacionConsultor.update({ where: { id: actual.id }, data: { principal } });
      } else {
        await tx.participacionConsultor.create({ data: {
          proyectoId: acceso.proyecto.id, usuarioId, principal, activo: true,
        } });
      }
      await evento(tx, acceso.proyecto.id, req.usuario.id,
        principal ? 'LIDER_REASIGNADO' : 'CONSULTOR_ASIGNADO', { usuarioId, principal });
      return { status: 200 };
    }, { isolationLevel: 'Serializable' });
    if (resultado.status !== 200) return res.status(resultado.status).json({ message: resultado.message });
    return res.json({ message: 'Asignación registrada.' });
  } catch (e) {
    if (conflictoDB(e)) return res.status(409).json({ message: 'Conflicto de asignación. Actualiza el expediente.' });
    throw e;
  }
}
/** Retira acceso a un colaborador no principal sin borrar actividades ni autorías. */
async function retirar(req, res) {
  const acceso = await autorizar(req, res, { activo: true });
  if (!acceso) return;
  if (!acceso.rol.admin && !acceso.rol.lider)
    return res.status(403).json({ message: 'Sin autoridad para retirar colaboradores.' });
  const usuarioId = idValido(req.params.usuarioId);
  if (!usuarioId) return res.status(400).json({ message: 'Consultor inválido.' });
  try {
    const resultado = await prisma.$transaction(async tx => {
      await tomarCandadoPrisma330(tx,'PROYECTO',acceso.proyecto.id);
      if (!acceso.rol.admin) {
        const actor = await tx.participacionConsultor.findFirst({ where: {
          proyectoId: acceso.proyecto.id, usuarioId: req.usuario.id, principal: true, activo: true,
          usuario: { activo: true, rol: 'EVALUADOR' },
        } });
        if (!actor) return { status: 403, message: 'El liderazgo cambió. Recarga el expediente.' };
      }
      const actual = await tx.participacionConsultor.findFirst({ where: {
        proyectoId: acceso.proyecto.id, usuarioId, activo: true,
      } });
      if (!actual) return { status: 404, message: 'Consultor no asignado.' };
      if (actual.principal) return { status: 409, message: 'Debe aplicarse el procedimiento de sustitución del principal.' };
      await tx.participacionConsultor.update({ where: { id: actual.id }, data: {
        activo: false, retiradoEn: new Date(),
      } });
      await evento(tx, acceso.proyecto.id, req.usuario.id, 'CONSULTOR_RETIRADO', { usuarioId });
      return { status: 200 };
    }, { isolationLevel: 'Serializable' });
    if (resultado.status !== 200) return res.status(resultado.status).json({ message: resultado.message });
    return res.json({ message: 'Acceso de consultor revocado. Las actividades pendientes requieren reasignación.' });
  } catch (e) {
    if (conflictoDB(e)) return res.status(409).json({ message: 'Conflicto de retiro. Actualiza el expediente.' });
    throw e;
  }
}
async function diagnosticos(req, res) {
  const acceso = await autorizar(req, res);
  if (!acceso) return;
  const lista = await prisma.evaluacion.findMany({ where: { proyectoId: acceso.proyecto.id },
    select: { id: true, estado: true, creadaEn: true, enviadaEn: true, puntajePromedio: true, empresarioId: true }, orderBy: { creadaEn: 'desc' } });
  return res.json(lista);
}
/**
 * Crea diagnóstico inicial del cliente para proyecto autorizado.
 * @param {import('express').Request} req Usuario autenticado en req.usuario.
 * @param {import('express').Response} res Resultado HTTP; ver rutas para contrato.
 * @returns {Promise<void>}
 */
async function iniciarDiagnostico(req, res) {
  const acceso = await autorizar(req, res, { activo: true });
  if (!acceso) return;
  if (!acceso.rol.cliente && !acceso.rol.admin)
    return res.status(403).json({ message: 'El diagnostico lo inicia la empresa o su administrador.' });
  try {
    // Carga localizada: evita acoplar los demás controladores a este módulo ALT.
    const { crearDiagnosticoResguardadoALT } = require('../services/alt-diagnostico-310');
    const evaluacion = await crearDiagnosticoResguardadoALT({
      db: prisma, proyectoId: acceso.proyecto.id, actorId: req.usuario.id,
    });
    return res.status(201).json(evaluacion);
  } catch (e) {
    if (e?.code === 'ALT307_CORTE_VIGENTE' || e?.code === 'ALT307_PROYECTO_NO_OPERABLE')
      return res.status(409).json({ message: 'Proyecto restringido o no operativo.' });
    if (e?.code === 'ALT307_PERMISO_ORDINARIO_NO_ACREDITADO' ||
        e?.code === 'ALT307_ACTOR_NO_VIGENTE' || e?.code === 'ALT310_REPRESENTANTE_NO_ACREDITADO')
      return res.status(403).json({ message: 'Autorizacion vigente no acreditada.' });
    if (e?.code === 'P2034')
      return res.status(409).json({ message: 'Conflicto concurrente; reintente.' });
    if (['P2021','P2022','P1001','ALT306_FUENTE_NO_ACREDITADA',
      'ALT307_FUENTE_NO_ACREDITADA','ALT307_CANDADO_NO_ACREDITADO',
      'ALT310_FUENTE_NO_ACREDITADA'].includes(e?.code))
      return res.status(503).json({ message: 'Control ALT no disponible.' });
    throw e;
  }
}
async function detalleDiagnostico(req, res) {
  const acceso = await autorizar(req, res);
  if (!acceso) return;
  const id = idValido(req.params.diagnosticoId);
  if (!id) return res.status(400).json({ message: 'Diagnostico invalido.' });
  const e = await prisma.evaluacion.findFirst({
    where: { id, proyectoId: acceso.proyecto.id },
    include: {
      respuestas: {
        include: {
          pregunta: { select: { id: true, texto: true, areaId: true } },
          actualizadaPor: { select: { id: true, nombre: true } },
          cambios: { orderBy: { creadoEn: 'asc' }, include: { autor: { select: { id: true, nombre: true } } } },
        },
      },
      soportes: { select: { id: true, nombreOriginal: true, mimeTipo: true, creadoEn: true } },
    },
  });
  if (!e) return res.status(404).json({ message: 'Diagnostico no encontrado en el proyecto.' });
  return res.json(e);
}
/**
 * Registra comentarios de consultor asignado sobre diagnóstico enviado.
 * @param {import('express').Request} req Usuario autenticado en req.usuario.
 * @param {import('express').Response} res Resultado HTTP; ver rutas para contrato.
 * @returns {Promise<void>}
 */
async function revisarDiagnostico(req, res) {
  const acceso = await autorizar(req, res, { activo: true, consultor: true });
  if (!acceso) return;
  const id = idValido(req.params.diagnosticoId);
  const comentarios = req.body?.comentarios;
  if (!id || !Array.isArray(comentarios) || !comentarios.length || comentarios.length > 100 ||
      comentarios.some(c => !idValido(c.preguntaId) || typeof c.comentario !== 'string' ||
        !c.comentario.trim() || c.comentario.length > 3000) ||
      new Set(comentarios.map(c => c.preguntaId)).size !== comentarios.length)
    return res.status(400).json({ message: 'Lista de comentarios por pregunta invalida.' });
  try {
    const { revisarDiagnosticoResguardadoALT } = require('../services/alt-revision-diagnostico-312');
    const resultado = await revisarDiagnosticoResguardadoALT({
      db: prisma, proyectoId: acceso.proyecto.id, actorId: req.usuario.id,
      diagnosticoId: id, comentarios,
    });
    return res.json(resultado);
  } catch (e) {
    if (['ALT307_CORTE_VIGENTE','ALT307_PROYECTO_NO_OPERABLE'].includes(e?.code))
      return res.status(409).json({ message: 'Proyecto restringido o no operativo.' });
    if (['ALT307_ACTOR_NO_VIGENTE','ALT307_PERMISO_ORDINARIO_NO_ACREDITADO'].includes(e?.code))
      return res.status(403).json({ message: 'Consultor no autorizado para revisar este diagnóstico.' });
    if (e?.code === 'ALT312_DIAGNOSTICO_NO_REVISABLE')
      return res.status(409).json({ message: 'Diagnóstico no revisable o no pertenece al proyecto.' });
    if (e?.code === 'ALT312_RESPUESTA_NO_EXISTE')
      return res.status(400).json({ message: 'La pregunta debe tener una respuesta existente.' });
    if (e?.code === 'P2034')
      return res.status(409).json({ message: 'Conflicto concurrente; reintente.' });
    if (['P2021','P2022','P1001','ALT306_FUENTE_NO_ACREDITADA',
      'ALT307_FUENTE_NO_ACREDITADA','ALT307_CANDADO_NO_ACREDITADO',
      'ALT312_FUENTE_NO_ACREDITADA'].includes(e?.code))
      return res.status(503).json({ message: 'Control ALT no disponible.' });
    throw e;
  }
}
/**
 * Registra brecha trazable por criterio y proyecto, no basada sólo en puntuación.
 * @param {import('express').Request} req Usuario autenticado en req.usuario.
 * @param {import('express').Response} res Resultado HTTP; ver rutas para contrato.
 * @returns {Promise<void>}
 */
async function registrarBrecha(req, res) {
  const acceso = await autorizar(req, res, { activo: true, consultor: true });
  if (!acceso) return;
  const { titulo, descripcion, criterio, origenEvaluacionId } = req.body || {};
  const idDiagnostico = origenEvaluacionId == null ? null : idValido(origenEvaluacionId);
  if (origenEvaluacionId != null && !idDiagnostico)
    return res.status(400).json({ message: 'Diagnostico de origen invalido.' });
  if (!validarObligatorio(titulo, 180) || !validarObligatorio(descripcion, 8000) ||
      !validarObligatorio(criterio, 3000))
    return res.status(400).json({ message: 'Titulo, descripcion y criterio verificable requeridos.' });
  try {
    const { registrarBrechaResguardadaALT } = require('../services/alt-brecha-proyecto-315');
    const brecha = await registrarBrechaResguardadaALT({
      db: prisma, proyectoId: acceso.proyecto.id, actorId: req.usuario.id,
      titulo, descripcion, criterio, origenEvaluacionId: idDiagnostico,
    });
    return res.status(201).json(brecha);
  } catch (e) {
    if (['ALT307_CORTE_VIGENTE', 'ALT307_PROYECTO_NO_OPERABLE', 'P2034'].includes(e?.code))
      return res.status(409).json({ message: 'Proyecto restringido o modificado. Actualice el expediente.' });
    if (['ALT307_ACTOR_NO_VIGENTE', 'ALT307_PERMISO_ORDINARIO_NO_ACREDITADO'].includes(e?.code))
      return res.status(403).json({ message: 'Consultor no autorizado para registrar esta brecha.' });
    if (['ALT315_ENTRADA_INVALIDA', 'ALT315_ORIGEN_CRUZADO'].includes(e?.code))
      return res.status(400).json({ message: 'Brecha u origen de diagnóstico inválidos.' });
    if (['ALT306_FUENTE_NO_ACREDITADA', 'ALT307_FUENTE_NO_ACREDITADA',
      'ALT307_CANDADO_NO_ACREDITADO', 'ALT315_FUENTE_NO_ACREDITADA',
      'P2021', 'P2022', 'P1001'].includes(e?.code))
      return res.status(503).json({ message: 'Control ALT no disponible; no se registró la brecha.' });
    throw e;
  }
}
async function listarBrechas(req, res) {
  const acceso = await autorizar(req, res);
  if (!acceso) return;
  return res.json(await prisma.brechaProyecto.findMany({ where: { proyectoId: acceso.proyecto.id }, orderBy: { creadaEn: 'desc' },
    include: { actividades: { select: { actividadId: true, excluidaEn: true } } },
  }));
}
/** SOL-31/SOL-36: incorporación al plan exclusiva del principal; puede no
 * estar vinculada a brechas o referir varias brechas del mismo proyecto.
 * La propuesta de otros consultores es un flujo independiente, aún pendiente.
 * @param {import('express').Request} req Usuario autenticado en req.usuario.
 * @param {import('express').Response} res Resultado HTTP; ver rutas para contrato.
 * @returns {Promise<void>}
 */
async function registrarActividad(req, res) {
  const acceso = await autorizar(req, res, { activo: true, lider: true });
  if (!acceso) return;
  const { titulo, descripcion, tipoResponsable, asignadoAId, brechaIds, fechaObjetivo, cobertura, acuerdoAdicionalId, actividadOrigenId } = req.body || {};
  const clase = cobertura == null ? 'BASE' : cobertura;
  const acuerdoId = clase === 'ADICIONAL' ? idValido(acuerdoAdicionalId) : null;
  const tieneOrigen = actividadOrigenId != null && actividadOrigenId !== '';
  const origenId = tieneOrigen ? idValido(actividadOrigenId) : null;
  if (tieneOrigen && (!origenId || clase !== 'ADICIONAL'))
    return res.status(400).json({ message: 'La continuidad requiere actividad de origen valida y cobertura ADICIONAL.' });
  if (!['BASE','ADICIONAL'].includes(clase) || (clase === 'ADICIONAL' && !acuerdoId) || (clase === 'BASE' && acuerdoAdicionalId != null))
    return res.status(400).json({ message: 'Indique cobertura BASE o ADICIONAL con acuerdo habilitado del mismo proyecto.' });
  const asignado = idValido(asignadoAId);
  if (!validarObligatorio(titulo, 180) || !['CLIENTE','CONSULTORA'].includes(tipoResponsable) || !asignado ||
      (descripcion != null && (typeof descripcion !== 'string' || descripcion.length > 8000)) ||
      (brechaIds != null && !Array.isArray(brechaIds)))
    return res.status(400).json({ message: 'Título, tipo y responsable son obligatorios; las brechas, si se indican, deben ser una lista.' });
  const ids = (brechaIds || []).map(idValido);
  if (ids.some(x=>!x) || new Set(ids).size !== ids.length) return res.status(400).json({ message: 'Brechas invalidas.' });
  if (clase === 'ADICIONAL' && tipoResponsable !== 'CONSULTORA') return res.status(400).json({ message: 'El servicio adicional de la consultora requiere actividad de aporte CONSULTORA.' });
  if (tipoResponsable === 'CLIENTE' && asignado !== acceso.proyecto.empresa.usuarioId ||
      tipoResponsable === 'CONSULTORA' && !acceso.proyecto.participaciones.some(p => p.usuarioId === asignado && p.usuario.activo))
    return res.status(403).json({ message: 'Responsable fuera del proyecto.' });
  let fecha = null;
  if (fechaObjetivo != null && fechaObjetivo !== '') {
    if (typeof fechaObjetivo !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fechaObjetivo)) return res.status(400).json({ message: 'Fecha debe ser YYYY-MM-DD.' });
    fecha = new Date(`${fechaObjetivo}T00:00:00.000Z`);
    if (!Number.isFinite(fecha.getTime()) || fecha.toISOString().slice(0,10) !== fechaObjetivo) return res.status(400).json({ message: 'Fecha invalida.' });
  }
  try {
    // ALT316: toda revalidación definitiva y los tres tipos de escritura ocurren
    // DESPUÉS del candado ALT, nunca a partir de lecturas previas del HTTP.
    const { registrarActividadResguardadaALT } = require('../services/alt-actividades-316');
    const actividad = await registrarActividadResguardadaALT({
      db: prisma, proyectoId: acceso.proyecto.id, actorId: req.usuario.id,
      titulo, descripcion, tipoResponsable, asignadoAId: asignado, brechaIds: ids,
      fechaObjetivo: fecha, cobertura: clase, acuerdoAdicionalId: acuerdoId, actividadOrigenId: origenId,
    });
    return res.status(201).json(actividad);
  } catch (e) {
    if (['ALT316_ENTRADA_INVALIDA', 'ALT316_BRECHA_CRUZADA'].includes(e?.code))
      return res.status(400).json({message:'Actividad o brechas no válidas para este proyecto.'});
    if (['ALT307_ACTOR_NO_VIGENTE','ALT307_PERMISO_ORDINARIO_NO_ACREDITADO',
      'ALT316_RESPONSABLE_NO_AUTORIZADO'].includes(e?.code))
      return res.status(403).json({message:'Principal o responsable no autorizado actualmente.'});
    if (['ALT307_CORTE_VIGENTE','ALT307_PROYECTO_NO_OPERABLE',
      'ALT316_ACUERDO_NO_HABILITADO','ALT316_ORIGEN_NO_APTO','P2034'].includes(e?.code))
      return res.status(409).json({message:'Proyecto restringido, acuerdo no habilitado o continuidad de actividad no válida.'});
    if (['ALT306_FUENTE_NO_ACREDITADA','ALT307_FUENTE_NO_ACREDITADA','ALT307_CANDADO_NO_ACREDITADO',
      'ALT316_FUENTE_NO_ACREDITADA','ALT316_CANDADO_COMERCIAL_NO_ACREDITADO',
      'P2021','P2022','P1001'].includes(e?.code))
      return res.status(503).json({message:'Control ALT no disponible; no se registró la actividad.'});
    throw e;
  }
}
/**
 * Reasigna el responsable de una actividad de la consultora sin borrar historia.
 * SOL-52: solo principal vigente, consultor destino activo en el MISMO proyecto,
 * justificacion explicita y concurrencia CAS. No aprueba evidencia, no cambia
 * estado ni atribuye al nuevo responsable la autoria de documentos anteriores.
 * La reasignacion del representante requiere el flujo de representacion aparte.
 */
async function reasignarActividad(req, res) {
  const acceso = await autorizar(req, res, { activo: true, lider: true });
  if (!acceso) return;
  const actividadId = idValido(req.params.actividadId);
  const usuarioId = idValido(req.body?.usuarioId);
  const esperadoResponsableId = idValido(req.body?.esperadoResponsableId);
  const justificacion = req.body?.justificacion;
  if (!actividadId || !usuarioId || !esperadoResponsableId ||
      !validarObligatorio(justificacion, 4000))
    return res.status(400).json({ message: 'Actividad, responsable anterior, consultor nuevo y justificacion son obligatorios.' });
  const candidato = acceso.proyecto.participaciones.find(p =>
    p.usuarioId === usuarioId && p.usuario.activo && p.usuario.rol === 'EVALUADOR');
  if (!candidato) return res.status(403).json({ message: 'El nuevo encargado debe ser un consultor activo de este proyecto.' });
  if (usuarioId === esperadoResponsableId)
    return res.status(409).json({ message: 'El nuevo encargado ya es el responsable declarado.' });
  try {
    const {ejecutarCambioActividadALT} = require('../services/alt-mutaciones-actividades-321');
    const result = await ejecutarCambioActividadALT({db:prisma,proyectoId:acceso.proyecto.id,actorId:req.usuario.id,ejecutar:async tx => {
      // La designacion o el retiro de un consultor usa la misma cerradura del
      // proyecto. Verificar nuevamente permisos DENTRO de la transaccion evita
      // reasignar con una participacion revocada entre lectura y escritura.
      const liderVigente = await tx.participacionConsultor.findFirst({ where: {
        proyectoId: acceso.proyecto.id, usuarioId: req.usuario.id, activo: true, principal: true,
      } });
      if (!liderVigente) return { status: 403, message: 'Ya no eres principal activo de este proyecto.' };
      const destinoVigente = await tx.participacionConsultor.findFirst({
        where: { proyectoId: acceso.proyecto.id, usuarioId, activo: true },
        include: { usuario: { select: { activo: true, rol: true } } },
      });
      if (!destinoVigente || !destinoVigente.usuario.activo || destinoVigente.usuario.rol !== 'EVALUADOR')
        return { status: 409, message: 'El consultor destino ya no dispone de acceso vigente. Actualiza el expediente.' };
      const task = await tx.actividadProyecto.findFirst({ where: { id: actividadId, proyectoId: acceso.proyecto.id } });
      if (!task) return { status: 404, message: 'Actividad no encontrada en este proyecto.' };
      if (task.tipoResponsable !== 'CONSULTORA')
        return { status: 409, message: 'Las actividades del representante se gestionan mediante su propio flujo.' };
      if (['COMPLETADA','CANCELADA'].includes(task.estado))
        return { status: 409, message: 'Las actividades finalizadas no pueden reasignarse.' };
      if (task.asignadoAId !== esperadoResponsableId)
        return { status: 409, message: 'La asignacion cambio. Actualiza el expediente antes de continuar.' };
      const change = await tx.actividadProyecto.updateMany({
        where: { id: actividadId, proyectoId: acceso.proyecto.id, asignadoAId: esperadoResponsableId,
          tipoResponsable: 'CONSULTORA', estado: { notIn: ['COMPLETADA','CANCELADA'] } },
        data: { asignadoAId: usuarioId },
      });
      if (change.count !== 1)
        return { status: 409, message: 'La actividad cambio mientras se reasignaba. Actualiza el expediente.' };
      await evento(tx, acceso.proyecto.id, req.usuario.id, 'ACTIVIDAD_REASIGNADA', {
        actividadId, anteriorId: esperadoResponsableId, nuevoId: usuarioId,
        justificacion: justificacion.trim(), estadoConservado: task.estado,
      });
      return { status: 200, id: actividadId, asignadoAId: usuarioId, estado: task.estado };
    }});
    return res.status(result.status).json(result.status===200
      ? { id: result.id, asignadoAId: result.asignadoAId, estado: result.estado,
        message: 'Responsable actualizado; historial, revisiones y estado conservados.' }
      : { message: result.message });
  } catch (e) {
    if (e?.code==='ALT307_CORTE_VIGENTE'||e?.code==='ALT307_PROYECTO_NO_OPERABLE')
      return res.status(409).json({message:'Proyecto restringido por corte ALT; no se modificó la actividad.'});
    if (e?.code==='ALT307_PERMISO_ORDINARIO_NO_ACREDITADO'||e?.code==='ALT307_ACTOR_NO_VIGENTE')
      return res.status(403).json({message:'El principal ya no está autorizado para modificar la actividad.'});
    if (['ALT307_FUENTE_NO_ACREDITADA','ALT307_CANDADO_NO_ACREDITADO',
      'ALT321_FUENTE_NO_ACREDITADA','ALT321_CANDADO_COMERCIAL_NO_ACREDITADO',
      'P2021','P2022','P1001'].includes(e?.code))
      return res.status(503).json({message:'Control ALT no disponible; no se modificó la actividad.'});

    if (conflictoDB(e)) return res.status(409).json({ message: 'Conflicto de concurrencia al reasignar. Recarga el expediente.' });
    throw e;
  }
}

/** SOL-17: el principal designa el consultor que revisa las evidencias aportadas por empresa. */
async function designarRevisorActividad(req, res) {
  const acceso = await autorizar(req, res, { activo: true, lider: true });
  if (!acceso) return;
  const actividadId = idValido(req.params.actividadId);
  const consultorId = idValido(req.body?.consultorId);
  const esperado = req.body?.esperadoConsultorId == null ? null : idValido(req.body.esperadoConsultorId);
  const motivo = req.body?.motivo;
  if (!actividadId || !consultorId || (req.body?.esperadoConsultorId != null && !esperado) ||
      !validarObligatorio(motivo, 2000)) return res.status(400).json({ message: 'Consultor, estado esperado y motivo son obligatorios.' });
  try {
    const {ejecutarGobiernoActividadALT} = require('../services/alt-gobierno-actividades-322');
    const result = await ejecutarGobiernoActividadALT({db:prisma,proyectoId:acceso.proyecto.id,
      actorId:req.usuario.id,ejecutar:async tx => {
      const liderActual = await tx.participacionConsultor.findFirst({ where: {
        proyectoId: acceso.proyecto.id, usuarioId: req.usuario.id, activo: true, principal: true,
      }});
      if (!liderActual) return { status: 403, message: 'Ya no eres principal vigente.' };
      const colaborador = await tx.participacionConsultor.findFirst({ where: {
        proyectoId: acceso.proyecto.id, usuarioId: consultorId, activo: true, principal: false,
      }, include: { usuario: { select: { activo: true, rol: true } } } });
      if (!colaborador?.usuario.activo || colaborador.usuario.rol !== 'EVALUADOR')
        return { status: 403, message: 'El encargado debe ser colaborador activo del proyecto, distinto del principal.' };
      const task = await tx.actividadProyecto.findFirst({ where: { id: actividadId, proyectoId: acceso.proyecto.id } });
      if (!task) return { status: 404, message: 'Actividad inexistente.' };
      if (task.tipoResponsable !== 'CLIENTE' || ['COMPLETADA','CANCELADA'].includes(task.estado))
        return { status: 409, message: 'Solo actividades abiertas de aporte empresarial admiten esta designación.' };
      if (task.consultorRevisorId !== esperado || task.consultorRevisorId === consultorId)
        return { status: 409, message: 'El encargado ha cambiado. Actualiza el expediente.' };
      // Solo las versiones ACTUALES bloquean cambios de revisor. Una versión
      // reemplazada conserva la constancia histórica pero deja de ser vigente.
      const entregables = await tx.entregableProyecto.findMany({ where: {
        proyectoId: acceso.proyecto.id, actividadId,
      }, select: { id: true, versionActual: true } });
      const vigentes = entregables.filter(x => x.versionActual > 0).map(x => ({
        entregableId: x.id, numero: x.versionActual,
      }));
      let pendientesPorRetiro = false;
      if (vigentes.length) {
        const pendientes = await tx.documentoVersionProyecto.findMany({ where: {
          proyectoId: acceso.proyecto.id, estadoCoelaboracion: 'DECLARADA',
          estadoRevision: 'PENDIENTE', OR: vigentes,
        }, select: { id: true, consultorCoautorId: true } });
        // DEC-Q56: el retiro del coautor no puede impedir la continuidad. Se
        // cambia el encargado, NUNCA el autor ni el estado de su declaración.
        // Con un coautor aún participante la designación sigue bloqueada.
        for (const pendiente of pendientes) {
          if (!pendiente.consultorCoautorId) return { status: 409, message: 'Declaración sin coautor verificable; requiere revisión de integridad.' };
          const coautorVigente = await tx.participacionConsultor.findFirst({ where: {
            proyectoId: acceso.proyecto.id, usuarioId: pendiente.consultorCoautorId,
            activo: true, principal: false,
          } });
          if (coautorVigente) return { status: 409, message: 'Hay una coelaboración pendiente de un consultor que aún participa. Debe responder o reemplazarse la versión.' };
          pendientesPorRetiro = true;
        }
      }
      const updated = await tx.actividadProyecto.updateMany({ where: {
        id: task.id, proyectoId: acceso.proyecto.id, consultorRevisorId: esperado,
      }, data: { consultorRevisorId: consultorId } });
      if (updated.count !== 1) return { status: 409, message: 'Designación concurrente; recarga expediente.' };
      await evento(tx, acceso.proyecto.id, req.usuario.id, 'REVISOR_ACTIVIDAD_DESIGNADO',
        { actividadId, consultorAnteriorId: esperado, consultorId, motivo: motivo.trim(),
          continuidadQ56: Boolean(vigentes.length && pendientesPorRetiro),
          notaQ56: pendientesPorRetiro ? 'Las declaraciones históricas permanecen sin confirmar; la empresa debe cargar versiones aclaradas.' : undefined });
      return { id: actividadId, consultorRevisorId: consultorId };
    }});
    return res.status(result.status || 200).json(result.status ? { message: result.message } : result);
  } catch (e) {
    if (e?.code?.startsWith('ALT307_') || e?.code?.startsWith('ALT322_'))
      return res.status(['ALT307_CORTE_VIGENTE','ALT307_PROYECTO_NO_OPERABLE'].includes(e.code) ? 409 :
        ['ALT307_PERMISO_ORDINARIO_NO_ACREDITADO','ALT307_ACTOR_NO_VIGENTE'].includes(e.code) ? 403 : 503)
        .json({message:'Control operativo ALT denegado o no disponible; no se cambió el revisor.'});
    if (conflictoDB(e)) return res.status(409).json({ message: 'Cambio concurrente; recarga el expediente.' });
    throw e;
  }
}

// DEC-Q57: solo el principal activo cambia una fecha, con motivo y aviso persistente.
// La lectura previa de la fecha se confirma DENTRO de la transaccion serializable.
function fechaISO(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const fecha = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0,10)===value ? fecha : undefined;
}
const fechaTexto = value => value ? new Date(value).toISOString().slice(0,10) : null;
async function cambiarFechaObjetivo(req, res) {
  const acceso = await autorizar(req, res, { activo: true, lider: true });
  if (!acceso) return;
  const id = idValido(req.params.actividadId);
  const nueva = fechaISO(req.body?.fechaObjetivo);
  const anterior = fechaISO(req.body?.fechaAnteriorEsperada);
  const justificacion = req.body?.justificacion;
  if (!id || nueva === undefined || anterior === undefined || !validarObligatorio(justificacion, 4000))
    return res.status(400).json({ message: 'Actividad, fecha nueva, fecha previa y justificación (máximo 4000 caracteres) requeridas.' });
  // No se acepta establecer/eliminar una fecha sin un valor explícito en el JSON.
  if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'fechaObjetivo') ||
      !Object.prototype.hasOwnProperty.call(req.body || {}, 'fechaAnteriorEsperada'))
    return res.status(400).json({ message: 'Declare fechaObjetivo y fechaAnteriorEsperada (null si no hay fecha).' });
  if (fechaTexto(nueva) === fechaTexto(anterior))
    return res.status(409).json({ message: 'No hay cambio de fecha que notificar.' });
  try {
    const {ejecutarGobiernoActividadALT} = require('../services/alt-gobierno-actividades-322');
    const resultado = await ejecutarGobiernoActividadALT({db:prisma,proyectoId:acceso.proyecto.id,
      actorId:req.usuario.id,conBloqueoEmpresa:true,ejecutar:async tx => {
      const lider = await tx.participacionConsultor.findFirst({ where: {
        proyectoId: acceso.proyecto.id, usuarioId: req.usuario.id, principal: true, activo: true,
        usuario: { activo: true, rol: 'EVALUADOR' },
      } });
      if (!lider) return { status: 403, message: 'Ya no eres el principal vigente.' };
      const project = await tx.proyectoConsultoria.findUnique({ where: { id: acceso.proyecto.id },
        select: { estado: true, empresa: { select: { usuarioId: true } } } });
      if (project?.estado !== 'ACTIVO') return { status: 409, message: 'El proyecto ya no está activo.' };
      const actividad = await tx.actividadProyecto.findFirst({ where: { id, proyectoId: acceso.proyecto.id },
        select: { fechaObjetivo: true, estado: true } });
      if (!actividad) return { status: 404, message: 'Actividad no encontrada.' };
      if (['COMPLETADA','CANCELADA'].includes(actividad.estado))
        return { status: 409, message: 'No puede cambiarse la fecha de una actividad terminada.' };
      if (fechaTexto(actividad.fechaObjetivo) !== fechaTexto(anterior))
        return { status: 409, message: 'La fecha cambió en otra sesión. Actualiza el expediente.' };
      const destinatarioId = project.empresa.usuarioId;
      if (!destinatarioId) return { status: 409, message: 'El proyecto no tiene representante actual.' };
      await tx.actividadProyecto.update({ where: { id }, data: { fechaObjetivo: nueva } });
      await evento(tx, acceso.proyecto.id, req.usuario.id, 'ACTIVIDAD_FECHA_MODIFICADA', {
        actividadId: id, fechaAnterior: fechaTexto(anterior), fechaNueva: fechaTexto(nueva),
        justificacion: justificacion.trim(), destinatarioId,
      });
      await tx.notificacionProyecto.create({ data: {
        proyectoId: acceso.proyecto.id, actividadId: id, destinatarioId,
        tipo: 'CAMBIO_FECHA_OBJETIVO', fechaAnterior: anterior, fechaNueva: nueva,
        justificacion: justificacion.trim(),
      } });
      return { status: 200, actividadId: id, fechaObjetivo: fechaTexto(nueva), notificado: true };
    }});
    if (resultado.status !== 200) return res.status(resultado.status).json({ message: resultado.message });
    return res.json(resultado);
  } catch(e) {
    if (e?.code?.startsWith('ALT307_') || e?.code?.startsWith('ALT322_'))
      return res.status(['ALT307_CORTE_VIGENTE','ALT307_PROYECTO_NO_OPERABLE'].includes(e.code) ? 409 :
        ['ALT307_PERMISO_ORDINARIO_NO_ACREDITADO','ALT307_ACTOR_NO_VIGENTE'].includes(e.code) ? 403 : 503)
        .json({message:'Control operativo ALT denegado o no disponible; fecha y aviso sin modificaciones.'});
    if (conflictoDB(e)) return res.status(409).json({ message: 'Conflicto al cambiar la fecha. Actualiza el expediente.' });
    throw e;
  }
}
// Las consultas nunca devuelven notificaciones de otro usuario ni otro proyecto por ID.
async function listarNotificaciones(req, res) {
  if (req.usuario.rol !== 'EMPRESARIO') return res.status(403).json({ message: 'Solo el representante accede a su bandeja.' });
  const select = { id: true, proyectoId: true, actividadId: true, tipo: true,
    fechaAnterior: true, fechaNueva: true, justificacion: true, creadaEn: true, leidaEn: true, origenNotificacionId: true, cambioRepresentacionId: true, eventoTerminacionId: true,
    proyecto: { select: { nombre: true } }, actividad: { select: { titulo: true } } };
  // El historial de representación no concede acceso: SOL-42.
  // Los avisos anteriores permanecen auditables, pero el antiguo representante
  // no puede consultarlos tras dejar de representar a la empresa.
  const where = { destinatarioId: req.usuario.id, proyecto: { empresa: { usuarioId: req.usuario.id } } };
  // Pendientes primero: los avisos antiguos sin leer no desaparecen detrás
  // de 50 registros ya leídos. A medida que se leen, se cargan los siguientes.
  const [unread, history, pendientes] = await Promise.all([
    prisma.notificacionProyecto.findMany({ where: { ...where, leidaEn: null },
      orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }], take: 50, select }),
    prisma.notificacionProyecto.findMany({ where: { ...where, leidaEn: { not: null } },
      orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }], take: 20, select }),
    prisma.notificacionProyecto.count({ where: { ...where, leidaEn: null } }),
  ]);
  return res.json({ notificaciones: [...unread, ...history], pendientes, limitePendientes: 50, limiteHistorico: 20 });
}
async function marcarNotificacionLeida(req, res) {
  if (req.usuario.rol !== 'EMPRESARIO') return res.status(403).json({ message: 'Solo el representante puede leer sus avisos.' });
  const id = idValido(req.params.notificacionId);
  if (!id) return res.status(400).json({ message: 'Notificación inválida.' });
  try {
    const resultado = await prisma.$transaction(async tx => {
      // Bloquear por la empresa del aviso, incluso si el destinatario histórico ya
      // perdió acceso; la actualización verifica de nuevo la representación vigente.
      const notice = await tx.notificacionProyecto.findFirst({ where: { id },
        select: { proyecto: { select: { empresaId: true } } },
      });
      if (!notice) return { status: 404, message: 'Notificación no encontrada.' };
      await tomarCandadoPrisma330(tx,'EMPRESA',notice.proyecto.empresaId);
      const scope = { id, destinatarioId: req.usuario.id,
        proyecto: { empresa: { usuarioId: req.usuario.id } } };
      const change = await tx.notificacionProyecto.updateMany({
        where: { ...scope, leidaEn: null }, data: { leidaEn: new Date() },
      });
      if (!change.count) {
        const exists = await tx.notificacionProyecto.findFirst({ where: scope, select: { id: true, leidaEn: true } });
        if (!exists) return { status: 404, message: 'Notificación no encontrada.' };
        return { status: 200, id, leidaEn: exists.leidaEn, yaLeida: true };
      }
      return { status: 200, id, leida: true };
    }, { isolationLevel: 'Serializable' });
    return res.status(resultado.status).json(resultado.status === 200 ? resultado : { message: resultado.message });
  } catch (e) {
    if (conflictoDB(e)) return res.status(409).json({ message: 'La representación o el aviso cambiaron. Actualiza la bandeja.' });
    throw e;
  }
}

async function listarActividades(req, res) {
  const acceso = await autorizar(req, res);
  if (!acceso) return;
  return res.json(await prisma.actividadProyecto.findMany({ where: { proyectoId: acceso.proyecto.id }, orderBy: { creadaEn: 'desc' },
    include: { brechas: { select: { brechaId: true, excluidaEn: true } } },
  }));
}
/**
 * Controla transición de actividad; completar requiere evidencia y verificación.
 * @param {import('express').Request} req Usuario autenticado en req.usuario.
 * @param {import('express').Response} res Resultado HTTP; ver rutas para contrato.
 * @returns {Promise<void>}
 */
async function actualizarActividad(req, res) {
  const acceso = await autorizar(req, res, { activo: true });
  if (!acceso) return;
  const actividadId=idValido(req.params.actividadId),estado=req.body?.estado;
  if(!actividadId||typeof estado!=='string')
    return res.status(400).json({message:'Actividad y estado requeridos.'});
  try {
    const {actualizarEstadoActividadALT}=require('../services/alt-estados-actividades-323');
    const resultado=await actualizarEstadoActividadALT({db:prisma,proyectoId:acceso.proyecto.id,
      actorId:req.usuario.id,actividadId,estado});
    return res.status(resultado.status).json(resultado.status===200?
      {id:resultado.id,estado:resultado.estado}:
      {message:resultado.message,...(resultado.detalle?{detalle:resultado.detalle}:{})});
  }catch(e){
    if(e?.code==='ALT323_ENTRADA_INVALIDA')return res.status(400).json({message:'Transicion de estado invalida.'});
    if(['ALT307_CORTE_VIGENTE','ALT307_PROYECTO_NO_OPERABLE','P2034','ALT307_CONFLICTOS_AGOTADOS'].includes(e?.code))
      return res.status(409).json({message:'La operación está restringida o cambió simultáneamente. Recarga el expediente.'});
    if(['ALT307_ACTOR_NO_VIGENTE','ALT307_PERMISO_ORDINARIO_NO_ACREDITADO'].includes(e?.code))
      return res.status(403).json({message:'La identidad o participación ya no están autorizadas.'});
    if(e?.code?.startsWith('ALT323_')||['ALT307_FUENTE_NO_ACREDITADA','ALT307_CANDADO_NO_ACREDITADO','ALT306_FUENTE_NO_ACREDITADA'].includes(e?.code))
      return res.status(503).json({message:'Control ALT de transiciones no disponible; no se ha aplicado el cambio.'});
    if(conflictoDB(e))return res.status(409).json({message:'Conflicto de transición. Recarga el expediente.'});
    throw e;
  }
}
/**
 * DEC-Q68: anulación EXPLÍCITA y justificada del antecedente cuando ya hay
 * actividad sucesora independiente, sin mover evidencias ni convalidaciones.
 * El principal vigente es el único actor autorizado. Operación transaccional
 * bajo el mismo candado usado al modificar acuerdos comerciales (Q-66/67).
 */
async function anularActividadAntecedente(req, res) {
  const acceso = await autorizar(req, res, { activo: true, lider: true });
  if (!acceso) return;
  const origenId = idValido(req.params.actividadId);
  const sucesoraId = idValido(req.body?.actividadSucesoraId);
  const motivo = req.body?.justificacion;
  const estadoEsperado = req.body?.estadoEsperado;
  if (!origenId || !sucesoraId || origenId === sucesoraId || (!validarObligatorio(motivo, 4000) || motivo.trim().length < 10) ||
      !['EN_PROGRESO','EN_REVISION'].includes(estadoEsperado))
    return res.status(400).json({ message: 'Indique actividad, sucesora distinta, estado esperado y justificación (máximo 4000 caracteres).' });
  try {
    const {ejecutarCambioActividadALT} = require('../services/alt-mutaciones-actividades-321');
    const resultado = await ejecutarCambioActividadALT({db:prisma,proyectoId:acceso.proyecto.id,actorId:req.usuario.id,ejecutar:async tx => {
      const proyectoActual = await tx.proyectoConsultoria.findFirst({where:{id:acceso.proyecto.id,estado:'ACTIVO'}});
      const principalActual = await tx.participacionConsultor.findFirst({where:{
        proyectoId:acceso.proyecto.id,usuarioId:req.usuario.id,activo:true,principal:true,
        usuario:{activo:true,rol:'EVALUADOR'},
      }});
      if (!proyectoActual || !principalActual)
        return {status:409,message:'El proyecto o su principal cambiaron. Actualiza el expediente.'};
      const origen = await tx.actividadProyecto.findFirst({where:{id:origenId,proyectoId:acceso.proyecto.id}});
      if (!origen) return {status:404,message:'Actividad original no encontrada.'};
      if (origen.estado !== estadoEsperado || origen.cobertura !== 'ADICIONAL' || !origen.acuerdoAdicionalId)
        return {status:409,message:'El antecedente cambió o no corresponde a una actividad adicional pendiente.'};
      const sucesora = await tx.actividadProyecto.findFirst({where:{
        id:sucesoraId,proyectoId:acceso.proyecto.id,actividadOrigenId:origenId,
        cobertura:'ADICIONAL',estado:{not:'CANCELADA'},
      }});
      if (!sucesora || !sucesora.acuerdoAdicionalId || sucesora.acuerdoAdicionalId === origen.acuerdoAdicionalId)
        return {status:409,message:'La sucesora debe pertenecer al mismo proyecto, continuar el antecedente y usar otro acuerdo.'};
      const [acuerdoOrigen,acuerdoNuevo] = await Promise.all([
        tx.acuerdoAdicionalProyecto.findFirst({where:{id:origen.acuerdoAdicionalId,
          proyectoId:acceso.proyecto.id,estado:{in:['CANCELADO','MODIFICADO']}}}),
        tx.acuerdoAdicionalProyecto.findFirst({where:{id:sucesora.acuerdoAdicionalId,
          proyectoId:acceso.proyecto.id,estado:'HABILITADO'}}),
      ]);
      if (!acuerdoOrigen || !acuerdoNuevo)
        return {status:409,message:'Se requiere acuerdo anterior afectado y acuerdo sucesor habilitado.'};
      const actualizado = await tx.actividadProyecto.updateMany({where:{
        id:origenId,proyectoId:acceso.proyecto.id,estado:estadoEsperado,
        acuerdoAdicionalId:origen.acuerdoAdicionalId,
      },data:{estado:'CANCELADA'}});
      if (actualizado.count !== 1)
        return {status:409,message:'La actividad cambió durante la operación. Recarga el expediente.'};
      await evento(tx, acceso.proyecto.id, req.usuario.id, 'ACTIVIDAD_ANULADA_CONTINUIDAD', {
        actividadId:origenId, actividadSucesoraId:sucesoraId,desde:estadoEsperado,hasta:'CANCELADA',
        acuerdoAnteriorId:origen.acuerdoAdicionalId,acuerdoNuevoId:sucesora.acuerdoAdicionalId,
        justificacion:motivo.trim(),anulacionNoEquivaleACumplimiento:true,
      });
      return {status:200,id:origenId,estado:'CANCELADA',actividadSucesoraId:sucesoraId};
    }});
    return res.status(resultado.status).json(resultado.status===200?resultado:{message:resultado.message});
  } catch (e) {
    if (e?.code==='ALT307_CORTE_VIGENTE'||e?.code==='ALT307_PROYECTO_NO_OPERABLE')
      return res.status(409).json({message:'Proyecto restringido por corte ALT; no se modificó la actividad.'});
    if (e?.code==='ALT307_PERMISO_ORDINARIO_NO_ACREDITADO'||e?.code==='ALT307_ACTOR_NO_VIGENTE')
      return res.status(403).json({message:'El principal ya no está autorizado para modificar la actividad.'});
    if (['ALT307_FUENTE_NO_ACREDITADA','ALT307_CANDADO_NO_ACREDITADO',
      'ALT321_FUENTE_NO_ACREDITADA','ALT321_CANDADO_COMERCIAL_NO_ACREDITADO',
      'P2021','P2022','P1001'].includes(e?.code))
      return res.status(503).json({message:'Control ALT no disponible; no se modificó la actividad.'});

    if (conflictoDB(e)) return res.status(409).json({message:'Conflicto de concurrencia. Actualiza el expediente.'});
    throw e;
  }
}

/** DEC-Q72: retirar justificadamente una rama terminal que dejó de formar
 * parte del alcance. Solo principal vigente, cambio comercial registrado por
 * ADMIN y nuevo acuerdo formalizado y aceptado externamente (Q65/Q66).
 * No elimina actividades ni evidencias, ni computa retiro como cumplimiento.
 */
async function retirarRamaAlcance(req, res) {
  const acceso = await autorizar(req, res, { activo: true, lider: true });
  if (!acceso) return;
  const actividadId = idValido(req.params.actividadId);
  const brechaId = idValido(req.body?.brechaId);
  const acuerdoNuevoId = idValido(req.body?.acuerdoNuevoId);
  const estadoEsperado = req.body?.estadoEsperado;
  const justificacion = req.body?.justificacion;
  if (!actividadId || !brechaId || !acuerdoNuevoId ||
      !['PENDIENTE','EN_PROGRESO','EN_REVISION'].includes(estadoEsperado) ||
      !validarObligatorio(justificacion, 4000) || justificacion.trim().length < 10)
    return res.status(400).json({ message: 'Indique brecha, acuerdo nuevo aceptado, estado esperado y motivo de retiro (10 a 4000 caracteres).' });
  try {
    const {ejecutarCambioActividadALT} = require('../services/alt-mutaciones-actividades-321');
    const resultado = await ejecutarCambioActividadALT({db:prisma,proyectoId:acceso.proyecto.id,actorId:req.usuario.id,ejecutar:async tx => {
      const [proyecto, principal] = await Promise.all([
        tx.proyectoConsultoria.findFirst({where:{id:acceso.proyecto.id,estado:'ACTIVO'},select:{id:true}}),
        tx.participacionConsultor.findFirst({where:{proyectoId:acceso.proyecto.id,
          usuarioId:req.usuario.id,activo:true,principal:true,usuario:{activo:true,rol:'EVALUADOR'}}}),
      ]);
      if (!proyecto || !principal) return {status:403,message:'El proyecto o el principal vigente cambiaron.'};
      const actividad = await tx.actividadProyecto.findFirst({where:{id:actividadId,proyectoId:acceso.proyecto.id}});
      if (!actividad) return {status:404,message:'Actividad no encontrada.'};
      if (actividad.proyectoId !== acceso.proyecto.id || actividad.estado !== estadoEsperado ||
          actividad.cobertura !== 'ADICIONAL' || !actividad.acuerdoAdicionalId || !actividad.actividadOrigenId)
        return {status:409,message:'Solo puede retirarse una sucesora adicional pendiente, de estado vigente.'};
      if (actividad.acuerdoAdicionalId === acuerdoNuevoId)
        return {status:409,message:'El alcance nuevo debe estar bajo un acuerdo diferente.'};
      const [anterior, nuevo, brecha, links, descendientes] = await Promise.all([
        tx.acuerdoAdicionalProyecto.findFirst({where:{id:actividad.acuerdoAdicionalId,
          proyectoId:acceso.proyecto.id,estado:{in:['CANCELADO','MODIFICADO']}}}),
        tx.acuerdoAdicionalProyecto.findFirst({where:{id:acuerdoNuevoId,
          proyectoId:acceso.proyecto.id,estado:'HABILITADO'}}),
        tx.brechaProyecto.findFirst({where:{id:brechaId,proyectoId:acceso.proyecto.id}}),
        tx.actividadBrechaProyecto.findMany({where:{actividadId,proyectoId:acceso.proyecto.id},
          select:{brechaId:true,excluidaEn:true}}),
        tx.actividadProyecto.count({where:{proyectoId:acceso.proyecto.id,actividadOrigenId:actividadId}}),
      ]);
      if (!anterior || !nuevo || !nuevo.referenciaAcuerdo || !nuevo.constanciaValidacion ||
          !nuevo.referenciaAceptacion || !nuevo.constanciaAceptacion ||
          !nuevo.aceptacionRegistradaEn || !nuevo.confirmadoEn)
        return {status:409,message:'Se requiere cambio comercial registrado por ADMIN y nuevo acuerdo confirmado y aceptado por la empresa.'};
      if (!brecha || !['ABIERTA','EN_TRATAMIENTO'].includes(brecha.estado))
        return {status:409,message:'La brecha debe existir y permanecer abierta antes del retiro.'};
      // El estado de actividad es global. No cancelar una actividad compartida
      // por otras brechas: afectaría alcance ajeno sin decisión de negocio.
      if (links.filter(v=>!v.excluidaEn).length !== 1 || !links.some(v=>!v.excluidaEn && v.brechaId === brechaId))
        return {status:409,message:'La actividad debe pertenecer exclusivamente a esta brecha para retirar una rama.'};
      if (descendientes)
        return {status:409,message:'Solo se permite retirar una rama terminal, no una actividad con sucesoras.'};
      const origen = await tx.actividadProyecto.findFirst({where:{id:actividad.actividadOrigenId,
        proyectoId:acceso.proyecto.id,estado:'CANCELADA',cobertura:'ADICIONAL'}});
      if (!origen) return {status:409,message:'La rama no tiene antecedente anulado y documentado.'};
      const hermanas = await tx.actividadBrechaProyecto.findMany({where:{brechaId,
        proyectoId:acceso.proyecto.id},select:{actividadId:true,actividad:{select:{actividadOrigenId:true}}}});
      if (!hermanas.some(h => h.actividadId === origen.id) ||
          !hermanas.some(h => h.actividadId !== actividadId && h.actividad.actividadOrigenId === origen.id))
        return {status:409,message:'El retiro solo procede en una ramificación con otra sucesora de la misma brecha.'};
      const anulacion = await tx.eventoProyecto.findMany({where:{proyectoId:acceso.proyecto.id,
        accion:'ACTIVIDAD_ANULADA_CONTINUIDAD'},select:{detalle:true}});
      if (!anulacion.some(e => e.detalle?.actividadId===origen.id && e.detalle?.hasta==='CANCELADA' &&
          e.detalle?.anulacionNoEquivaleACumplimiento === true))
        return {status:409,message:'La anulación de la actividad origen no tiene constancia auditada.'};
      const changed = await tx.actividadProyecto.updateMany({where:{id:actividadId,
        proyectoId:acceso.proyecto.id,estado:estadoEsperado,acuerdoAdicionalId:actividad.acuerdoAdicionalId},
        data:{estado:'CANCELADA'}});
      if (changed.count !== 1) return {status:409,message:'La actividad cambió. Actualiza el expediente.'};
      await evento(tx, acceso.proyecto.id, req.usuario.id, 'ACTIVIDAD_RAMA_RETIRADA_ALCANCE', {
        actividadId, brechaId, actividadOrigenId:origen.id, desde:estadoEsperado, hasta:'CANCELADA',
        acuerdoAnteriorId:anterior.id, referenciaCambio:anterior.referenciaCambio,
        acuerdoNuevoId:nuevo.id, referenciaAceptacion:nuevo.referenciaAceptacion,
        justificacion:justificacion.trim(), retiroNoEquivaleACumplimiento:true,
      });
      return {status:200,actividadId,brechaId,estado:'CANCELADA',noEquivaleACumplimiento:true};
    }});
    return res.status(resultado.status).json(resultado.status===200?resultado:{message:resultado.message});
  } catch (e) {
    if (e?.code==='ALT307_CORTE_VIGENTE'||e?.code==='ALT307_PROYECTO_NO_OPERABLE')
      return res.status(409).json({message:'Proyecto restringido por corte ALT; no se modificó la actividad.'});
    if (e?.code==='ALT307_PERMISO_ORDINARIO_NO_ACREDITADO'||e?.code==='ALT307_ACTOR_NO_VIGENTE')
      return res.status(403).json({message:'El principal ya no está autorizado para modificar la actividad.'});
    if (['ALT307_FUENTE_NO_ACREDITADA','ALT307_CANDADO_NO_ACREDITADO',
      'ALT321_FUENTE_NO_ACREDITADA','ALT321_CANDADO_COMERCIAL_NO_ACREDITADO',
      'P2021','P2022','P1001'].includes(e?.code))
      return res.status(503).json({message:'Control ALT no disponible; no se modificó la actividad.'});

    if (conflictoDB(e)) return res.status(409).json({message:'Conflicto de actualización. Recarga el expediente.'});
    throw e;
  }
}

/** DEC-Q73: excluir solo el VINCULO actividad-brecha cuando el alcance
 * de una actividad compartida cambia. El estado, evidencias y otros enlaces
 * de la actividad permanecen intactos. Exclusión auditable e irreversible
 * por este endpoint (no se redefine historia silenciosamente).
 */
async function excluirVinculoActividadBrecha(req, res) {
  const acceso = await autorizar(req, res, { activo: true, lider: true });
  if (!acceso) return;
  const actividadId = idValido(req.params.actividadId);
  const brechaId = idValido(req.body?.brechaId);
  const acuerdoNuevoId = idValido(req.body?.acuerdoNuevoId);
  const estadoEsperado = req.body?.estadoEsperado;
  const justificacion = req.body?.justificacion;
  if (!actividadId || !brechaId || !acuerdoNuevoId ||
      !['PENDIENTE','EN_PROGRESO','EN_REVISION'].includes(estadoEsperado) ||
      !validarObligatorio(justificacion, 4000) || justificacion.trim().length < 10)
    return res.status(400).json({message:'Indique actividad, brecha, estado esperado, acuerdo nuevo y justificación (10 a 4000 caracteres).'});
  try {
    const {ejecutarCambioActividadALT} = require('../services/alt-mutaciones-actividades-321');
    const resultado = await ejecutarCambioActividadALT({db:prisma,proyectoId:acceso.proyecto.id,actorId:req.usuario.id,ejecutar:async tx => {
      const [proyecto, principal, actividad, brecha] = await Promise.all([
        tx.proyectoConsultoria.findFirst({where:{id:acceso.proyecto.id,estado:'ACTIVO'},select:{id:true}}),
        tx.participacionConsultor.findFirst({where:{proyectoId:acceso.proyecto.id,usuarioId:req.usuario.id,
          activo:true,principal:true,usuario:{activo:true,rol:'EVALUADOR'}}}),
        tx.actividadProyecto.findFirst({where:{id:actividadId,proyectoId:acceso.proyecto.id}}),
        tx.brechaProyecto.findFirst({where:{id:brechaId,proyectoId:acceso.proyecto.id}}),
      ]);
      if (!proyecto || !principal) return {status:403,message:'Proyecto o consultor principal no vigentes.'};
      if (!actividad || !brecha) return {status:404,message:'Actividad o brecha no encontrada.'};
      if (actividad.proyectoId !== acceso.proyecto.id || brecha.proyectoId && brecha.proyectoId !== acceso.proyecto.id ||
          !['ABIERTA','EN_TRATAMIENTO'].includes(brecha.estado) ||
          actividad.estado !== estadoEsperado || actividad.cobertura !== 'ADICIONAL' || !actividad.acuerdoAdicionalId)
        return {status:409,message:'La brecha o la actividad cambiaron, o no es trabajo adicional pendiente.'};
      if (actividad.acuerdoAdicionalId === acuerdoNuevoId)
        return {status:409,message:'El nuevo alcance debe estar formalizado bajo otro acuerdo.'};
      const [anterior,nuevo,vinculos,descendientes] = await Promise.all([
        tx.acuerdoAdicionalProyecto.findFirst({where:{id:actividad.acuerdoAdicionalId,
          proyectoId:acceso.proyecto.id,estado:{in:['CANCELADO','MODIFICADO']}}}),
        tx.acuerdoAdicionalProyecto.findFirst({where:{id:acuerdoNuevoId,
          proyectoId:acceso.proyecto.id,estado:'HABILITADO'}}),
        tx.actividadBrechaProyecto.findMany({where:{actividadId,proyectoId:acceso.proyecto.id},
          select:{brechaId:true,excluidaEn:true}}),
        tx.actividadProyecto.count({where:{proyectoId:acceso.proyecto.id,actividadOrigenId:actividadId}}),
      ]);
      if (!anterior || !anterior.referenciaCambio || !anterior.constanciaCambio ||
          !nuevo || !nuevo.referenciaAcuerdo || !nuevo.constanciaValidacion ||
          !nuevo.referenciaAceptacion || !nuevo.constanciaAceptacion ||
          !nuevo.aceptacionRegistradaEn || !nuevo.confirmadoEn)
        return {status:409,message:'Falta cambio comercial formalizado por ADMIN o aceptación del nuevo alcance empresarial.'};
      if (descendientes) return {status:409,message:'Una actividad con sucesoras debe resolverse mediante su cadena de continuidad.'};
      const activos = vinculos.filter(v => !v.excluidaEn);
      if (activos.length < 2 || new Set(activos.map(v=>v.brechaId)).size !== activos.length ||
          !activos.some(v => v.brechaId === brechaId))
        return {status:409,message:'Solo puede excluirse una relación vigente de actividad compartida. Las otras deben seguir activas.'};
      // Nunca usar delete: la relación histórica sobrevive y la tarea sigue
      // siendo ejecutable para las demás brechas; UPDATE condicional atómico.
      const actualizado = await tx.actividadBrechaProyecto.updateMany({where:{
        actividadId,brechaId,proyectoId:acceso.proyecto.id,excluidaEn:null,
      },data:{excluidaEn:new Date()}});
      if (actualizado.count !== 1)
        return {status:409,message:'El vínculo cambió durante la operación. Actualice el expediente.'};
      await evento(tx, acceso.proyecto.id, req.usuario.id, 'ACTIVIDAD_BRECHA_EXCLUIDA_ALCANCE', {
        actividadId,brechaId,estadoActividadConservado:estadoEsperado,
        otrasBrechasActivasIds:activos.filter(v=>v.brechaId!==brechaId).map(v=>v.brechaId).sort((a,b)=>a-b),
        acuerdoAnteriorId:anterior.id,referenciaCambio:anterior.referenciaCambio,
        acuerdoNuevoId:nuevo.id,referenciaAceptacion:nuevo.referenciaAceptacion,
        justificacion:justificacion.trim(),exclusionNoEquivaleACumplimiento:true,
      });
      return {status:200,actividadId,brechaId,relacion:'EXCLUIDA',
        estadoActividad:estadoEsperado,otrasBrechasActivasIds:activos.filter(v=>v.brechaId!==brechaId).map(v=>v.brechaId)};
    }});
    return res.status(resultado.status).json(resultado.status===200?resultado:{message:resultado.message});
  } catch(e) {
    if (e?.code==='ALT307_CORTE_VIGENTE'||e?.code==='ALT307_PROYECTO_NO_OPERABLE')
      return res.status(409).json({message:'Proyecto restringido por corte ALT; no se modificó la actividad.'});
    if (e?.code==='ALT307_PERMISO_ORDINARIO_NO_ACREDITADO'||e?.code==='ALT307_ACTOR_NO_VIGENTE')
      return res.status(403).json({message:'El principal ya no está autorizado para modificar la actividad.'});
    if (['ALT307_FUENTE_NO_ACREDITADA','ALT307_CANDADO_NO_ACREDITADO',
      'ALT321_FUENTE_NO_ACREDITADA','ALT321_CANDADO_COMERCIAL_NO_ACREDITADO',
      'P2021','P2022','P1001'].includes(e?.code))
      return res.status(503).json({message:'Control ALT no disponible; no se modificó la actividad.'});

    if (conflictoDB(e)) return res.status(409).json({message:'Conflicto de actualización; recargue el expediente.'});
    throw e;
  }
}

/**
 * DEC-Q74: constancia explicativa de cambio comercial POSTERIOR a una actividad
 * compartida ya COMPLETADA. Nunca altera su vinculación histórica, el estado,
 * los documentos, revisiones o las verificaciones aprobadas.
 */
async function registrarConstanciaAlcanceCompletada(req, res) {
  const acceso = await autorizar(req, res, { activo: true, lider: true });
  if (!acceso) return;
  const actividadId = idValido(req.params.actividadId);
  const brechaId = idValido(req.body?.brechaId);
  const acuerdoNuevoId = idValido(req.body?.acuerdoNuevoId);
  const impactoEvaluacion = req.body?.impactoEvaluacion;
  const estadoEsperado = req.body?.estadoEsperado;
  if (!actividadId || !brechaId || !acuerdoNuevoId || estadoEsperado !== 'COMPLETADA' ||
      !validarObligatorio(impactoEvaluacion, 4000) || impactoEvaluacion.trim().length < 10)
    return res.status(400).json({ message: 'Indique actividad completada, brecha, acuerdo nuevo y efecto documentado (10 a 4000 caracteres).' });
  try {
    const resultado = await prisma.$transaction(async tx => {
      await tomarCandadoPrisma330(tx,'PROYECTO',acceso.proyecto.id);
      const [proyecto, principal, actividad] = await Promise.all([
        tx.proyectoConsultoria.findFirst({ where: { id: acceso.proyecto.id, estado: 'ACTIVO' }, select: { id: true } }),
        tx.participacionConsultor.findFirst({ where: { proyectoId: acceso.proyecto.id, usuarioId: req.usuario.id,
          activo: true, principal: true, usuario: { activo: true, rol: 'EVALUADOR' } } }),
        tx.actividadProyecto.findFirst({ where: { id: actividadId, proyectoId: acceso.proyecto.id } }),
      ]);
      if (!proyecto || !principal) return { status: 403, message: 'Proyecto o principal no vigentes.' };
      if (!actividad) return { status: 404, message: 'Actividad no encontrada.' };
      if (actividad.proyectoId !== acceso.proyecto.id || actividad.estado !== 'COMPLETADA' || actividad.cobertura !== 'ADICIONAL' || !actividad.acuerdoAdicionalId)
        return { status: 409, message: 'Solo aplica a trabajo adicional ya completado y conservado.' };
      if (actividad.acuerdoAdicionalId === acuerdoNuevoId)
        return { status: 409, message: 'La referencia debe ser un acuerdo posterior distinto.' };
      const [brecha, vinculos, anterior, nuevo] = await Promise.all([
        tx.brechaProyecto.findFirst({ where: { id: brechaId, proyectoId: acceso.proyecto.id } }),
        tx.actividadBrechaProyecto.findMany({ where: { actividadId, proyectoId: acceso.proyecto.id },
          select: { brechaId: true, excluidaEn: true } }),
        tx.acuerdoAdicionalProyecto.findFirst({ where: { id: actividad.acuerdoAdicionalId,
          proyectoId: acceso.proyecto.id, estado: { in: ['CANCELADO', 'MODIFICADO'] } } }),
        tx.acuerdoAdicionalProyecto.findFirst({ where: { id: acuerdoNuevoId, proyectoId: acceso.proyecto.id,
          estado: 'HABILITADO' } }),
      ]);
      if (!brecha) return { status: 404, message: 'Brecha no encontrada.' };
      if (vinculos.filter(x => !x.excluidaEn).length < 2 ||
          !vinculos.some(x => x.brechaId === brechaId && !x.excluidaEn))
        return { status: 409, message: 'La actividad completada debe conservar un vínculo vigente y compartido con esa brecha.' };
      if (!anterior?.referenciaCambio || !anterior?.constanciaCambio ||
          !nuevo?.referenciaAcuerdo || !nuevo?.constanciaValidacion ||
          !nuevo?.referenciaAceptacion || !nuevo?.constanciaAceptacion ||
          !nuevo?.aceptacionRegistradaEn || !nuevo?.confirmadoEn)
        return { status: 409, message: 'Falta cambio formalizado por ADMIN o aceptación empresarial del nuevo alcance.' };
      const registro = await evento(tx, acceso.proyecto.id, req.usuario.id, 'ACTIVIDAD_COMPLETADA_CONSTANCIA_ALCANCE', {
        actividadId, brechaId, estadoHistoricoConservado: 'COMPLETADA',
        acuerdoAnteriorId: anterior.id, acuerdoNuevoId: nuevo.id,
        referenciaCambio: anterior.referenciaCambio, referenciaAceptacion: nuevo.referenciaAceptacion,
        impactoEvaluacion: impactoEvaluacion.trim(),
        noExcluyeVinculo: true, noRevocaAprobaciones: true, noReabreBrechaAutomaticamente: true,
      });
      return { status: 201, id: registro.id, actividadId, brechaId, constanciaRegistrada: true,
        aviso: 'Anotación histórica: no modifica cumplimientos ni sustituye evaluación de la brecha.' };
    }, { isolationLevel: 'Serializable' });
    return res.status(resultado.status).json(resultado.status === 201 ? resultado : { message: resultado.message });
  } catch (e) {
    if (conflictoDB(e)) return res.status(409).json({ message: 'Conflicto de concurrencia. Recargue el expediente.' });
    throw e;
  }
}

/** Consulta trazable y de solo lectura de las anotaciones Q-74 sin editar el historial. */
async function listarConstanciasAlcanceCompletada(req, res) {
  const acceso = await autorizar(req, res);
  if (!acceso) return;
  const actividadId = idValido(req.params.actividadId);
  if (!actividadId) return res.status(400).json({ message: 'Actividad inválida.' });
  const actividad = await prisma.actividadProyecto.findFirst({
    where: { id: actividadId, proyectoId: acceso.proyecto.id }, select: { id: true },
  });
  if (!actividad) return res.status(404).json({ message: 'Actividad no encontrada.' });
  const registros = await prisma.eventoProyecto.findMany({ where: {
    proyectoId: acceso.proyecto.id, accion: 'ACTIVIDAD_COMPLETADA_CONSTANCIA_ALCANCE',
    detalle: { path: ['actividadId'], equals: actividadId },
  }, select: { id: true, usuarioId: true, creadoEn: true, detalle: true },
  orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }], take: 100 });
  return res.json(registros);
}

/**
 * SOL-34: reabre una brecha previamente CERRADA SOLO durante un proyecto ACTIVO.
 * La corrección se inicia con una actividad nueva BASE, independiente de toda
 * actividad COMPLETADA; no se reutilizan documentos ni aprobaciones anteriores.
 * Para trabajo adicional se debe utilizar primero el flujo comercial Q-65/66;
 * esta operación no concede autorización contractual implícita.
 * La instantánea del cierre previo queda preservada en el evento auditado.
 */
async function reabrirBrecha(req, res) {
  const { ejecutarBrechaResguardadaALT } = require('../services/alt-brechas-324');
  const acceso = await autorizar(req, res, { activo: true, lider: true });
  if (!acceso) return;
  const brechaId = idValido(req.params.brechaId);
  const anteriorId = idValido(req.body?.actividadAnteriorId);
  const asignadoAId = idValido(req.body?.asignadoAId);
  const cobertura = req.body?.cobertura || 'BASE';
  const acuerdoAdicionalId = cobertura === 'ADICIONAL' ? idValido(req.body?.acuerdoAdicionalId) : null;
  const { justificacion, correccionRequerida, tituloActividad, descripcionActividad, tipoResponsable } = req.body || {};
  if (!brechaId || !anteriorId || !asignadoAId || !validarObligatorio(justificacion, 4000) ||
      justificacion.trim().length < 10 || !validarObligatorio(correccionRequerida, 4000) ||
      correccionRequerida.trim().length < 10 || !validarObligatorio(tituloActividad, 180) ||
      !['CLIENTE','CONSULTORA'].includes(tipoResponsable) || !['BASE','ADICIONAL'].includes(cobertura) ||
      (cobertura === 'ADICIONAL' && (!acuerdoAdicionalId || tipoResponsable !== 'CONSULTORA')) ||
      (descripcionActividad != null && (typeof descripcionActividad !== 'string' || descripcionActividad.length > 8000))) {
    return res.status(400).json({ message: 'Indique brecha, actividad completada de origen, motivo (mín. 10 caracteres), corrección (mín. 10), título y responsable válido.' });
  }
  if (cobertura === 'BASE' && req.body?.acuerdoAdicionalId != null)
    return res.status(400).json({ message: 'La cobertura BASE no admite referencias comerciales adicionales.' });
  try {
    const result = await ejecutarBrechaResguardadaALT({db:prisma,proyectoId:acceso.proyecto.id,actorId:req.usuario.id,principal:true,ejecutar:async tx => {
      const [proyecto, principal, brecha, anterior] = await Promise.all([
        tx.proyectoConsultoria.findFirst({ where: { id: acceso.proyecto.id, estado: 'ACTIVO' }, select: { id: true, empresaId: true } }),
        tx.participacionConsultor.findFirst({ where: { proyectoId: acceso.proyecto.id, usuarioId: req.usuario.id,
          principal: true, activo: true, usuario: { activo: true, rol: 'EVALUADOR' } }, select: { id: true } }),
        tx.brechaProyecto.findFirst({ where: { id: brechaId, proyectoId: acceso.proyecto.id } }),
        tx.actividadProyecto.findFirst({ where: { id: anteriorId, proyectoId: acceso.proyecto.id },
          include: { brechas: { where: { brechaId }, select: { brechaId: true, excluidaEn: true } } } }),
      ]);
      if (!proyecto || !principal) return { status: 403, message: 'El proyecto o su principal ya no están vigentes.' };
      if (!brecha) return { status: 404, message: 'Brecha no encontrada.' };
      if (brecha.estado !== 'CERRADA' || !brecha.cerradaEn || !brecha.cerradaPorId)
        return { status: 409, message: 'Solo se puede reabrir una brecha formalmente cerrada y documentada.' };
      if (!anterior || anterior.proyectoId !== acceso.proyecto.id || anterior.estado !== 'COMPLETADA' || !anterior.brechas.some(v => v.brechaId === brechaId && !v.excluidaEn))
        return { status: 409, message: 'La actividad de origen debe estar COMPLETADA y vinculada a esta brecha sin exclusión.' };
      if (anterior.cobertura === 'ADICIONAL' && cobertura !== 'ADICIONAL')
        return { status: 409, message: 'Una corrección de servicio adicional requiere acuerdo habilitado y aceptado; no se puede reclasificar como BASE.' };
      if (cobertura === 'ADICIONAL') {
        const acuerdo = await tx.acuerdoAdicionalProyecto.findFirst({ where: {
          id: acuerdoAdicionalId, proyectoId: acceso.proyecto.id, estado: 'HABILITADO',
        } });
        if (!acuerdo?.confirmadoEn || !acuerdo?.aceptacionRegistradaEn || !acuerdo?.constanciaAceptacion)
          return { status: 409, message: 'Falta acuerdo adicional formalizado y alcance aceptado para la actividad correctiva.' };
      }
      if (tipoResponsable === 'CLIENTE') {
        const empresa = await tx.empresa.findFirst({ where: { id: proyecto.empresaId }, select: { usuarioId: true } });
        const representante = empresa && await tx.usuario.findFirst({ where: { id: empresa.usuarioId, activo: true, rol: 'EMPRESARIO' }, select: { id: true } });
        if (!representante || representante.id !== asignadoAId)
          return { status: 409, message: 'El responsable debe ser el representante empresarial vigente y activo.' };
      } else {
        const colaborador = await tx.participacionConsultor.findFirst({ where: {
          proyectoId: acceso.proyecto.id, usuarioId: asignadoAId, activo: true,
          usuario: { activo: true, rol: 'EVALUADOR' },
        }, select: { id: true } });
        if (!colaborador)
          return { status: 409, message: 'El responsable debe ser un consultor activo asignado al proyecto.' };
      }
      const changed = await tx.brechaProyecto.updateMany({ where: {
        id: brechaId, proyectoId: acceso.proyecto.id, estado: 'CERRADA', cerradaEn: brecha.cerradaEn,
      }, data: { estado: 'EN_TRATAMIENTO', cerradaPorId: null, cerradaEn: null, justificacionCierre: null } });
      if (changed.count !== 1) return { status: 409, message: 'El cierre cambió. Actualice el expediente.' };
      const actividad = await tx.actividadProyecto.create({ data: {
        proyectoId: acceso.proyecto.id, titulo: tituloActividad.trim(),
        descripcion: str(descripcionActividad, 8000) || correccionRequerida.trim(),
        tipoResponsable, asignadoAId, estado: 'PENDIENTE', cobertura, acuerdoAdicionalId,
      } });
      await tx.actividadBrechaProyecto.create({ data: {
        proyectoId: acceso.proyecto.id, brechaId, actividadId: actividad.id,
      } });
      // Comparar estado para evitar reabrir dos veces. El bloqueo por proyecto
      // y Serializable evitan carrera con otro cierre o cambio de responsable.
      await evento(tx, acceso.proyecto.id, req.usuario.id, 'BRECHA_REABIERTA_SOL34', {
        brechaId, estadoAnterior: 'CERRADA', estadoNuevo: 'EN_TRATAMIENTO',
        cierreAnterior: { cerradaPorId: brecha.cerradaPorId, cerradaEn: brecha.cerradaEn,
          justificacionCierre: brecha.justificacionCierre },
        actividadOriginalCompletadaId: anteriorId, actividadCorrectivaId: actividad.id, coberturaCorrectiva: cobertura, acuerdoAdicionalId,
        motivo: justificacion.trim(), correccionRequerida: correccionRequerida.trim(),
        requiereNuevaRevision: true, cierreAnteriorConservado: true,
        noReabreActividadAnterior: true, noDictamenAutomatico: true,
      });
      return { status: 201, brechaId, estado: 'EN_TRATAMIENTO', actividadCorrectivaId: actividad.id,
        aviso: 'Reapertura interna por corrección. Requiere nueva evidencia y cierre profesional; no implica certificación.' };
    }});
    return res.status(result.status).json(result.status === 201 ? result : { message: result.message });
  } catch (error) {
    if (['ALT307_CORTE_VIGENTE','ALT307_PROYECTO_NO_OPERABLE'].includes(error?.code))
      return res.status(409).json({message:'Proyecto restringido por corte ALT; no se modificó la brecha.'});
    if (['ALT307_ACTOR_NO_VIGENTE','ALT307_PERMISO_ORDINARIO_NO_ACREDITADO'].includes(error?.code))
      return res.status(403).json({message:'El consultor ya no está autorizado.'});
    if (['ALT307_FUENTE_NO_ACREDITADA','ALT307_CANDADO_NO_ACREDITADO',
      'ALT324_FUENTE_NO_ACREDITADA','ALT324_CANDADO_NO_ACREDITADO','P2021','P2022','P1001'].includes(error?.code))
      return res.status(503).json({message:'Control ALT no disponible; no se modificó la brecha.'});
    if (conflictoDB(error)) return res.status(409).json({ message: 'Conflicto al reabrir la brecha. Recargue el expediente.' });
    throw error;
  }
}

/** Lectura de cierres y reaperturas reales sin sobreescribir evidencia anterior. */
async function historialBrecha(req, res) {
  const acceso = await autorizar(req, res);
  if (!acceso) return;
  const brechaId = idValido(req.params.brechaId);
  if (!brechaId) return res.status(400).json({ message: 'Brecha inválida.' });
  const brecha = await prisma.brechaProyecto.findFirst({ where: { id: brechaId, proyectoId: acceso.proyecto.id }, select: { id: true } });
  if (!brecha) return res.status(404).json({ message: 'Brecha no encontrada.' });
  const eventos = await prisma.eventoProyecto.findMany({ where: {
    proyectoId: acceso.proyecto.id, accion: { in: ['BRECHA_CERRADA_G2','BRECHA_REABIERTA_SOL34'] },
    detalle: { path: ['brechaId'], equals: brechaId },
  }, select: { id: true, accion: true, usuarioId: true, creadoEn: true, detalle: true },
  orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }], take: 100 });
  return res.json(eventos);
}

/**
 * Documenta propuesta de cierre; no equivale al cierre formal G2.
 * @param {import('express').Request} req Usuario autenticado en req.usuario.
 * @param {import('express').Response} res Resultado HTTP; ver rutas para contrato.
 * @returns {Promise<void>}
 */
async function proponerCierreBrecha(req, res) {
  const { ejecutarBrechaResguardadaALT } = require('../services/alt-brechas-324');
  const acceso = await autorizar(req, res, { activo: true, consultor: true });
  if (!acceso) return;
  const brechaId = idValido(req.params.brechaId);
  const justificacion = req.body?.justificacion;
  if (!brechaId || !validarObligatorio(justificacion, 4000)) return res.status(400).json({ message: 'Brecha y justificacion requeridas.' });
  try {
    const resultado = await ejecutarBrechaResguardadaALT({db:prisma,proyectoId:acceso.proyecto.id,actorId:req.usuario.id,principal:false,ejecutar:async tx => {
      const proyectoActual = await tx.proyectoConsultoria.findFirst({ where: { id: acceso.proyecto.id, estado: 'ACTIVO' }, select: { id: true } });
      const participacionActual = await tx.participacionConsultor.findFirst({ where: {
        proyectoId: acceso.proyecto.id, usuarioId: req.usuario.id, activo: true,
        usuario: { activo: true, rol: 'EVALUADOR' },
      }, select: { id: true } });
      if (!proyectoActual || !participacionActual) return { status: 409,
        message: 'El estado del proyecto o la participación del consultor cambiaron.' };
      const brecha = await tx.brechaProyecto.findFirst({ where: { id: brechaId, proyectoId: acceso.proyecto.id },
        include: { actividades: { include: { actividad: {
          select: { id: true, estado: true, cobertura: true, actividadOrigenId: true },
        } } } },
      });
      if (!brecha) return { status: 404, message: 'Brecha no encontrada.' };
      if (['CERRADA','PROPUESTA_CIERRE'].includes(brecha.estado))
        return { status: 409, message: 'La brecha ya se encuentra en cierre o cerrada.' };
      const evaluacion = await evaluarActividadesCierreBrecha(tx, acceso.proyecto.id, brecha);
      if (!evaluacion.lista) return { status: 409, message: evaluacion.motivo };
      const changed = await tx.brechaProyecto.updateMany({ where: {
        id: brechaId, proyectoId: acceso.proyecto.id, estado: brecha.estado,
      }, data: { estado: 'PROPUESTA_CIERRE', justificacionCierre: justificacion.trim() } });
      if (!changed.count) return { status: 409, message: 'La brecha cambió durante el cierre.' };
      await evento(tx, acceso.proyecto.id, req.usuario.id, 'BRECHA_PROPUESTA_CIERRE', {
        brechaId, justificacion: justificacion.trim(), continuidades: evaluacion.continuidades, exclusionesActividadIds: evaluacion.exclusionesActividadIds || [],
        advertencia: 'Propuesta interna; no representa conformidad ISO/IEC 27001',
      });
      return { status: 200, id: brechaId, estado: 'PROPUESTA_CIERRE',
        continuidades: evaluacion.continuidades,
        mensaje: 'Propuesta registrada. No representa cierre verificado ni conformidad ISO 27001.' };
    }});
    return res.status(resultado.status).json(resultado.status === 200 ? resultado : { message: resultado.message });
  } catch (error) {
    if (['ALT307_CORTE_VIGENTE','ALT307_PROYECTO_NO_OPERABLE'].includes(error?.code))
      return res.status(409).json({message:'Proyecto restringido por corte ALT; no se modificó la brecha.'});
    if (['ALT307_ACTOR_NO_VIGENTE','ALT307_PERMISO_ORDINARIO_NO_ACREDITADO'].includes(error?.code))
      return res.status(403).json({message:'El consultor ya no está autorizado.'});
    if (['ALT307_FUENTE_NO_ACREDITADA','ALT307_CANDADO_NO_ACREDITADO',
      'ALT324_FUENTE_NO_ACREDITADA','ALT324_CANDADO_NO_ACREDITADO','P2021','P2022','P1001'].includes(error?.code))
      return res.status(503).json({message:'Control ALT no disponible; no se modificó la brecha.'});
    if (conflictoDB(error)) return res.status(409).json({ message: 'Conflicto durante la propuesta de cierre.' });
    throw error;
  }
}

module.exports = { listar, obtener, crear, asignar, retirar, consultoresDisponibles, diagnosticos, iniciarDiagnostico,
  registrarBrecha, listarBrechas, detalleDiagnostico, revisarDiagnostico, registrarActividad, listarActividades, actualizarActividad, anularActividadAntecedente, retirarRamaAlcance, excluirVinculoActividadBrecha, registrarConstanciaAlcanceCompletada, listarConstanciasAlcanceCompletada, cambiarFechaObjetivo, listarNotificaciones, marcarNotificacionLeida, reasignarActividad, designarRevisorActividad, proponerCierreBrecha, reabrirBrecha, historialBrecha };
