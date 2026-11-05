/** SOL-53/Q-54: bloqueo urgente y reactivación con revisión explícita y auditoría. */
const crypto = require('node:crypto');
const prisma = require('../config/prisma');
const tomarCandadoPrisma330=(tx,espacio,id)=>require('../utils/candado-prisma-330').tomarCandadoPrisma330(tx,espacio,id);
const { idValido } = require('../utils/access');
const motivoValido = v => typeof v === 'string' && v.trim().length >= 10 && v.trim().length <= 2000;
const errorEstado = (code, message) => ({ code, message });

async function relacionesActuales(tx, usuario) {
  // El representante actual se obtiene de Empresa.usuarioId; el anterior NO hereda acceso.
  // Se listan todos los proyectos, incluidos cerrados, porque las relaciones aún pueden dar lectura.
  const [empresas, participaciones] = await Promise.all([
    tx.empresa.findMany({ where: { usuarioId: usuario.id }, select: {
      id: true, nombre: true, proyectos: { select: { id: true, nombre: true, estado: true }, orderBy: { id: 'asc' } },
    }, orderBy: { id: 'asc' } }),
    tx.participacionConsultor.findMany({ where: { usuarioId: usuario.id, activo: true }, select: {
      id: true, principal: true, proyecto: { select: { id: true, nombre: true, estado: true } },
    }, orderBy: { id: 'asc' } }),
  ]);
  return { empresas, participaciones };
}
function huella(usuario, relaciones) {
  const contenido = JSON.stringify({
    id: usuario.id, rol: usuario.rol, activo: usuario.activo,
    bloqueoUrgente: usuario.bloqueoUrgente, versionSesion: usuario.versionSesion,
    relaciones,
  });
  return crypto.createHash('sha256').update(contenido).digest('hex');
}
async function transaccionCuenta(usuarioId, ejecutar) {
  return prisma.$transaction(async tx => {
    // F3-ANA-334: el alta y reemplazo del representante toman IDENTIDAD.
    // La administración de su cuenta debe respetar la misma exclusión antes de CUENTA,
    // para no comprobar `activo`/`rol` a la vez que se altera la identidad.
    // Orden global: IDENTIDAD -> CUENTA; no invertir en otros escritores.
    await tomarCandadoPrisma330(tx,'IDENTIDAD',usuarioId);
    await tomarCandadoPrisma330(tx,'CUENTA',usuarioId);
    return ejecutar(tx);
  }, { isolationLevel: 'Serializable' });
}
function respuestaResultado(res, result) {
  if (result.error) return res.status(result.error.code).json({ message: result.error.message });
  return res.json(result.value);
}
function gestionarError(error, res, next) {
  if (error.code === 'CANDADO_330_NO_ACREDITADO') return res.status(503).json({message:'Control transaccional de identidad no disponible.',codigo:error.code});
  if (error.code === 'P2003') return res.status(409).json({ message: 'Existen referencias históricas que impiden eliminar la identidad.' });
  if (error.code === 'P2025') return res.status(404).json({ message: 'Usuario no encontrado.' });
  if (error.code === 'P2034' || error.code === 'P2002') return res.status(409).json({ message: 'Los datos cambiaron durante la operación. Actualice y revise de nuevo.' });
  return next(error);
}

async function bloqueoUrgente(req, res, next) {
  const id = idValido(req.params.id);
  if (!id || !motivoValido(req.body?.motivo)) return res.status(400).json({ message: 'Usuario válido y motivo justificado (10 a 2000 caracteres) requeridos.' });
  if (id === req.usuario.id) return res.status(409).json({ message: 'ADMIN no puede bloquear urgentemente su propia cuenta.' });
  try {
    const result = await transaccionCuenta(id, async tx => {
      const usuario = await tx.usuario.findUnique({ where: { id } });
      if (!usuario) return { error: errorEstado(404, 'Usuario no encontrado.') };
      if (!usuario.activo || usuario.bloqueoUrgente) return { error: errorEstado(409, 'La cuenta no está activa.') };
      // SOL-53 es específico del consultor principal y representante actual.
      const [principales, representaciones] = await Promise.all([
        tx.participacionConsultor.count({ where: { usuarioId: id, principal: true, activo: true } }),
        tx.empresa.count({ where: { usuarioId: id } }),
      ]);
      if ((!principales && !representaciones) || usuario.rol === 'ADMIN')
        return { error: errorEstado(409, 'El bloqueo urgente se reserva para un principal o representante vigente.') };
      const relaciones = await relacionesActuales(tx, usuario);
      await tx.usuario.update({ where: { id }, data: {
        activo: false, bloqueoUrgente: true, versionSesion: { increment: 1 },
      } });
      await tx.eventoEstadoCuenta.create({ data: {
        usuarioId: id, adminId: req.usuario.id, accion: 'BLOQUEO_URGENTE',
        motivo: req.body.motivo.trim(), relaciones,
      } });
      return { value: { id, activo: false, bloqueoUrgente: true } };
    });
    return respuestaResultado(res, result);
  } catch (error) { return gestionarError(error, res, next); }
}

async function prepararReactivacion(req, res, next) {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ message: 'Usuario inválido.' });
  try {
    const usuario = await prisma.usuario.findUnique({ where: { id } });
    if (!usuario) return res.status(404).json({ message: 'Usuario no encontrado.' });
    if (usuario.activo || !usuario.bloqueoUrgente) return res.status(409).json({ message: 'La cuenta no tiene un bloqueo urgente pendiente.' });
    const relaciones = await relacionesActuales(prisma, usuario);
    return res.json({ usuario: { id, nombre: usuario.nombre, rol: usuario.rol },
      relaciones, huellaRevision: huella(usuario, relaciones),
      advertencia: 'Confirme solo las relaciones vigentes. Los permisos ya retirados y las tareas reasignadas no se restauran.' });
  } catch (error) { return next(error); }
}

async function reactivarUrgente(req, res, next) {
  const id = idValido(req.params.id);
  const { huellaRevision, relacionesConfirmadas, motivoResolucion } = req.body || {};
  if (!id || relacionesConfirmadas !== true || !motivoValido(motivoResolucion) ||
      typeof huellaRevision !== 'string' || !/^[a-f0-9]{64}$/.test(huellaRevision))
    return res.status(400).json({ message: 'Requiere revisión vigente, confirmación expresa y motivo de resolución (10 a 2000 caracteres).' });
  try {
    const result = await transaccionCuenta(id, async tx => {
      const usuario = await tx.usuario.findUnique({ where: { id } });
      if (!usuario) return { error: errorEstado(404, 'Usuario no encontrado.') };
      if (usuario.activo || !usuario.bloqueoUrgente)
        return { error: errorEstado(409, 'La cuenta no requiere esta reactivación.') };
      const relaciones = await relacionesActuales(tx, usuario);
      if (huella(usuario, relaciones) !== huellaRevision)
        return { error: errorEstado(409, 'Las relaciones o el estado de cuenta cambiaron. Vuelva a revisar antes de confirmar.') };
      await tx.usuario.update({ where: { id }, data: { activo: true, bloqueoUrgente: false } });
      await tx.eventoEstadoCuenta.create({ data: {
        usuarioId: id, adminId: req.usuario.id, accion: 'REACTIVACION_REVISADA',
        motivo: motivoResolucion.trim(), relaciones,
      } });
      // NO se alteran Empresa.usuarioId, ParticipacionConsultor, roles ni tareas.
      return { value: { id, activo: true, bloqueoUrgente: false, revisionRegistrada: true } };
    });
    return respuestaResultado(res, result);
  } catch (error) { return gestionarError(error, res, next); }
}

/** Ruta ordinaria, separada del bloqueo urgente y sin vía de elusión de Q-54. */
async function estadoNormal(req, res, next) {
  const id = idValido(req.params.id);
  const activo = req.body?.activo;
  if (!id || typeof activo !== 'boolean') return res.status(400).json({ message: 'Usuario y activo (booleano) requeridos.' });
  if (id === req.usuario.id && !activo) return res.status(409).json({ message: 'No puede desactivar su propia cuenta.' });
  try {
    const result = await transaccionCuenta(id, async tx => {
      const usuario = await tx.usuario.findUnique({ where: { id } });
      if (!usuario) return { error: errorEstado(404, 'Usuario no encontrado.') };
      if (activo && usuario.bloqueoUrgente)
        return { error: errorEstado(409, 'Reactivación urgente requiere revisión de relaciones y confirmación ADMIN.') };
      if (activo === usuario.activo) return { value: { id, nombre: usuario.nombre, activo } };
      if (!activo) {
        const [principales, proyectosCliente] = await Promise.all([
          tx.participacionConsultor.count({ where: { usuarioId: id, activo: true, principal: true, proyecto: { estado: 'ACTIVO' } } }),
          tx.proyectoConsultoria.count({ where: { empresa: { usuarioId: id }, estado: 'ACTIVO' } }),
        ]);
        if (principales) return { error: errorEstado(409, 'Reasigne primero el consultor principal de proyectos activos.') };
        if (proyectosCliente) return { error: errorEstado(409, 'La cuenta representa un cliente con proyecto activo. Gestione un reemplazo antes de desactivarla.') };
      }
      const relaciones = await relacionesActuales(tx, usuario);
      const actualizado = await tx.usuario.update({ where: { id }, data: {
        activo, ...(!activo ? { versionSesion: { increment: 1 } } : {}),
      }, select: { id: true, nombre: true, activo: true } });
      await tx.eventoEstadoCuenta.create({ data: {
        usuarioId: id, adminId: req.usuario.id,
        accion: activo ? 'ACTIVACION_ORDINARIA' : 'DESACTIVACION_ORDINARIA',
        motivo: 'Cambio ordinario autorizado por administrador', relaciones,
      } });
      return { value: actualizado };
    });
    return respuestaResultado(res, result);
  } catch (error) { return gestionarError(error, res, next); }
}

/** Edición administrativa que comparte el candado de identidad con Q58/SOL-42.
 * Sin transacción, un cambio de rol puede adelantarse a una vinculación
 * comprobada sobre una instantánea anterior del representante.
 */
async function editarPerfil(req,res,next) {
  const id=idValido(req.params.id);
  if(!id) return res.status(400).json({message:'Usuario invalido.'});
  const {nombre,rol}=req.body||{};
  if(rol && !['ADMIN','EMPRESARIO','EVALUADOR'].includes(rol))
    return res.status(400).json({message:'Rol invalido.'});
  try {
    const result=await transaccionCuenta(id, async tx=>{
      const actual=await tx.usuario.findUnique({where:{id},select:{id:true,rol:true}});
      if(!actual) return {error:errorEstado(404,'Usuario no encontrado.')};
      if(rol && rol!=='EVALUADOR') {
        const n=await tx.participacionConsultor.count({where:{usuarioId:id,activo:true}});
        if(n) return {error:errorEstado(409,'Retire las asignaciones activas antes de cambiar el rol.')};
      }
      if(rol && rol!=='EMPRESARIO') {
        const n=await tx.empresa.count({where:{usuarioId:id}});
        if(n) return {error:errorEstado(409,'Sustituya formalmente al representante de la empresa antes de cambiar su rol.')};
      }
      const actualizado=await tx.usuario.update({where:{id},data:{nombre:nombre??undefined,rol:rol??undefined},
        select:{id:true,nombre:true,email:true,rol:true,activo:true}});
      return {value:actualizado};
    });
    return respuestaResultado(res,result);
  }catch(error){return gestionarError(error,res,next);}
}

/** F3-ANA-335: la supresión física de una identidad es excepcional:
 * solo si NO tiene relaciones ni trazabilidad conservable. Las condiciones
 * y el borrado se evalúan bajo IDENTIDAD -> CUENTA en una transacción.
 * Las FKs siguen siendo el último control ante escritores concurrentes.
 */
async function eliminarCuenta(req,res,next){
  const id=idValido(req.params.id);
  if(!id) return res.status(400).json({message:'Usuario inválido.'});
  if(id===req.usuario.id) return res.status(409).json({message:'ADMIN no puede eliminar su propia cuenta.'});
  try {
    const result=await transaccionCuenta(id,async tx=>{
      const existe=await tx.usuario.findUnique({where:{id},select:{id:true}});
      if(!existe) return {error:errorEstado(404,'Usuario no encontrado.')};
      const eventos=await tx.eventoEstadoCuenta.count({where:{OR:[{usuarioId:id},{adminId:id}]}});
      if(eventos) return {error:errorEstado(409,'La cuenta tiene historial auditable y no se puede eliminar.')};
      const participaciones=await tx.participacionConsultor.count({where:{usuarioId:id}});
      if(participaciones) return {error:errorEstado(409,'El usuario tiene historial de consultoría. Desactive su cuenta en lugar de eliminarlo.')};
      const representaciones=await tx.empresa.count({where:{usuarioId:id}});
      if(representaciones) return {error:errorEstado(409,'El usuario representa una empresa. No se puede borrar sin reasignación formal.')};
      const avisos=await tx.notificacionProyecto.count({where:{destinatarioId:id}});
      if(avisos) return {error:errorEstado(409,'La cuenta tiene avisos históricos. Desactívela; no elimine su identidad.')};
      const cambios=await tx.eventoRepresentacionEmpresa.count({where:{OR:[
        {adminId:id},{representanteAnteriorId:id},{representanteNuevoId:id},
      ]}});
      if(cambios) return {error:errorEstado(409,'La cuenta tiene historial de representación y no puede eliminarse.')};
      await tx.usuario.delete({where:{id}});
      return {value:{message:'Usuario eliminado.'}};
    });
    return respuestaResultado(res,result);
  }catch(error){return gestionarError(error,res,next);}
}

module.exports = { bloqueoUrgente, prepararReactivacion, reactivarUrgente, estadoNormal, editarPerfil, eliminarCuenta, huella };
