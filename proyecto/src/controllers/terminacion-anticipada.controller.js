/** DEC-Q62 / RN-19: terminación anticipada por abandono, distinta del cierre satisfactorio. */
'use strict';
const prisma = require('../config/prisma');
const { autorizar } = require('../utils/proyecto-acceso');
const { tieneConservacionRegistrada } = require('../utils/conservacion-registrada');
const ACCION = 'SERVICIO_TERMINADO_ANTICIPADAMENTE';
function texto(v, max, min) {
  return typeof v === 'string' && v.trim().length >= min && v.trim().length <= max ? v.trim() : null;
}
function conflicto(e) { return ['P2034','P2002'].includes(e?.code); }
// Q-63: constatación humana de comunicación realizada, intentada o no aplicable.
// El sistema no envía ni acredita por sí mismo la comunicación contractual.
function validarComunicacion(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const resultado = raw.resultado;
  if (!['REALIZADA','INTENTADA','NO_APLICA'].includes(resultado)) return null;
  const detalle = texto(raw.detalle,3000,20);
  if (!detalle) return null;
  if (resultado === 'NO_APLICA') {
    if (raw.canal || raw.referencia) return null;
    return { resultado, canal: null, referencia: null, detalle };
  }
  const canal = texto(raw.canal,120,3);
  // El registro puede indicar un intento sin constancia documental independiente.
  const referencia = raw.referencia == null || raw.referencia === '' ? null : texto(raw.referencia,1000,5);
  if (!canal || (raw.referencia != null && raw.referencia !== '' && !referencia)) return null;
  return { resultado, canal, referencia, detalle };
}
async function consultar(req,res) {
  const acceso = await autorizar(req,res);
  if (!acceso) return;
  const evento = await prisma.eventoProyecto.findFirst({
    where: { proyectoId: acceso.proyecto.id, accion: ACCION }, orderBy: { id: 'desc' },
    select: { id: true, creadoEn: true, usuarioId: true, detalle: true },
  });
  if (!evento) return res.json({ terminadoAnticipadamente: false, estado: acceso.proyecto.estado });
  const conservacion = await prisma.condicionConservacionProyecto.findFirst({
    where: { proyectoId: acceso.proyecto.id }, orderBy: { id: 'desc' },
    select: { id: true, referenciaAcuerdo: true, periodoPactado: true, constanciaValidacion: true },
  });
  return res.json({ terminadoAnticipadamente: true, estado: acceso.proyecto.estado,
    eventoId: evento.id, fecha: evento.creadoEn, registradoPorId: evento.usuarioId,
    motivo: evento.detalle?.motivo ?? null, referenciaAbandono: evento.detalle?.referenciaAbandono ?? null,
    conservacionPendiente: !tieneConservacionRegistrada(conservacion),
    excepcionConservacionAlTerminar: Boolean(evento.detalle?.excepcionConservacion),
    // Registros históricos Q-62 anteriores a Q-63 no deben recibir constancias inventadas.
    comunicacion: evento.detalle?.comunicacion ?? null,
    avisoInternoRegistrado: Boolean(evento.detalle?.avisoInternoId),
    nota: 'Terminación por abandono; no acredita preparación para certificación ni autoriza borrados.',
  });
}
async function terminar(req,res) {
  const acceso = await autorizar(req,res);
  if (!acceso) return;
  if (!acceso.rol.admin) return res.status(403).json({ message: 'Solo ADMIN puede terminar anticipadamente el servicio.' });
  const motivo = texto(req.body?.motivo,4000,20);
  const referenciaAbandono = req.body?.referenciaAbandono === undefined || req.body.referenciaAbandono === null || req.body.referenciaAbandono === ''
    ? null : texto(req.body.referenciaAbandono,1000,5);
  const aceptoExcepcion = req.body?.confirmarPendienteConservacion === true;
  const comunicacion = validarComunicacion(req.body?.comunicacion);
  if (!motivo || (req.body?.referenciaAbandono != null && req.body.referenciaAbandono !== '' && !referenciaAbandono) ||
      typeof req.body?.confirmarPendienteConservacion !== 'boolean' || !comunicacion)
    return res.status(400).json({ message: 'Debe informar motivo, referencia válida si existe, confirmación de excepción y constancia de comunicación realizada, intentada o justificada como no aplicable.' });
  try {
    const result = await prisma.$transaction(async tx => {
      // Orden de bloqueos compatible con Q-58: empresa ANTES de proyecto.
      // Evita ciclo entre sustitucion de representante y terminacion concurrente.
      const empresaCandado=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27182, CAST(${acceso.proyecto.empresaId} AS INTEGER)) IS NOT NULL) AS "bloqueoTomado"`;
      if(!Array.isArray(empresaCandado)||empresaCandado.length!==1||empresaCandado[0]?.bloqueoTomado!==true)
        throw Object.assign(new Error('Q62: candado de empresa no acreditado'),{code:'Q62_CANDADO_INVALIDO'});
      // El bloqueo 27260 se comparte con Q-60; el cierre no ignora registros concurrentes.
      const conservacionCandado=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27260, CAST(${acceso.proyecto.id} AS INTEGER)) IS NOT NULL) AS "bloqueoTomado"`;
      if(!Array.isArray(conservacionCandado)||conservacionCandado.length!==1||conservacionCandado[0]?.bloqueoTomado!==true)
        throw Object.assign(new Error('Q62: candado de conservación no acreditado'),{code:'Q62_CANDADO_INVALIDO'});
      await tx.$queryRaw`SELECT id FROM "ProyectoConsultoria" WHERE id = ${acceso.proyecto.id} FOR UPDATE`;
      const proyecto = await tx.proyectoConsultoria.findUnique({ where: { id: acceso.proyecto.id }, select: { estado: true } });
      if (!['ACTIVO','SUSPENDIDO'].includes(proyecto?.estado)) return { status: 409, message: 'El servicio ya está terminado o no está disponible. Recarga el expediente.' };
      const empresa = await tx.empresa.findUnique({
        where: { id: acceso.proyecto.empresaId }, select: { usuarioId: true },
      });
      if (!empresa?.usuarioId)
        return { status: 409, message: 'La empresa no tiene representante vigente. No se ha terminado el servicio.' };
      const conservacion = await tx.condicionConservacionProyecto.findFirst({
        where: { proyectoId: acceso.proyecto.id }, orderBy: { id: 'desc' },
        select: { id: true, referenciaAcuerdo: true, periodoPactado: true, constanciaValidacion: true },
      });
      const falta = !tieneConservacionRegistrada(conservacion);
      if (falta && !aceptoExcepcion)
        return { status: 409, message: 'Falta conservación contractual. ADMIN debe confirmar expresamente la excepción y su obligación de registrarla posteriormente.', codigo: 'CONSERVACION_PENDIENTE' };
      const [actividadesPendientes, brechasPendientes] = await Promise.all([
        tx.actividadProyecto.count({ where: { proyectoId: acceso.proyecto.id, estado: { notIn: ['COMPLETADA','CANCELADA'] } } }),
        tx.brechaProyecto.count({ where: { proyectoId: acceso.proyecto.id, estado: { not: 'CERRADA' } } }),
      ]);
      const updated = await tx.proyectoConsultoria.updateMany({
        where: { id: acceso.proyecto.id, estado: { in: ['ACTIVO','SUSPENDIDO'] } }, data: { estado: 'CERRADO' },
      });
      if (updated.count !== 1) return { status: 409, message: 'El estado del proyecto cambió; reintenta luego de actualizar.' };
      const evento = await tx.eventoProyecto.create({ data: {
        proyectoId: acceso.proyecto.id, usuarioId: req.usuario.id, accion: ACCION,
        detalle: { tipo: 'ABANDONO', motivo, referenciaAbandono,
          excepcionConservacion: falta, conservacionIdAlTerminar: conservacion?.id ?? null,
          obligacionAdministrativaPendiente: falta ? 'REGISTRAR_CONSERVACION_CONTRACTUAL' : null,
          actividadesPendientes, brechasPendientes, sinDictamenFavorable: true,
          comunicacion, // ADMIN registra constancia; no se infiere envío ni notificación externa.
        },
      } });
      const aviso = await tx.notificacionProyecto.create({ data: {
        proyectoId: acceso.proyecto.id, actividadId: null,
        destinatarioId: empresa.usuarioId, tipo: 'TERMINACION_ANTICIPADA_ABANDONO',
        justificacion: 'El servicio se terminó anticipadamente por abandono. Consulta el expediente y la comunicación contractual correspondiente.',
        eventoTerminacionId: evento.id,
      } });
      // El ID del aviso permite contrastar la notificación con el evento original;
      // sin crear otra actuación administrativa ni alterar la constancia.
      await tx.eventoProyecto.update({ where: { id: evento.id }, data: {
        detalle: { tipo: 'ABANDONO', motivo, referenciaAbandono,
          excepcionConservacion: falta, conservacionIdAlTerminar: conservacion?.id ?? null,
          obligacionAdministrativaPendiente: falta ? 'REGISTRAR_CONSERVACION_CONTRACTUAL' : null,
          actividadesPendientes, brechasPendientes, sinDictamenFavorable: true,
          comunicacion, avisoInternoId: aviso.id },
      } });
      return { status: 200, data: { notificacionId: aviso.id, comunicacionRegistrada: true, proyectoId: acceso.proyecto.id, estado: 'CERRADO',
        tipoTerminacion: 'ANTICIPADA_POR_ABANDONO', eventoId: evento.id,
        conservacionPendiente: falta, actividadesPendientes, brechasPendientes,
        nota: 'No implica cierre satisfactorio, certificación, reapertura ni eliminación de expedientes.' } };
    }, { isolationLevel: 'Serializable' });
    return res.status(result.status).json(result.data || { message: result.message, ...(result.codigo ? { codigo: result.codigo } : {}) });
  } catch (e) {
    if (conflicto(e)) return res.status(409).json({ message: 'Conflicto de terminación. Consulta el estado del proyecto y vuelve a intentarlo.' });
    throw e;
  }
}
module.exports = { consultar, terminar };
