/**
 * @module proyecto-acceso
 * @description Punto central de autorización por PROYECTO, además del rol global.
 * La pertenencia se consulta en PostgreSQL en cada solicitud: un EVALUADOR sin
 * participación activa jamás hereda acceso a empresas ajenas.
 * @security No usar el identificador del cliente para saltar esta comprobación.
 * @see ../../../docs/06-seguridad/modelo-amenazas.md
 */
const { idValido } = require('./access');
const prisma = require('../config/prisma');

async function obtenerProyecto(id) {
  return prisma.proyectoConsultoria.findUnique({
    where: { id },
    include: {
      empresa: { select: { id: true, nombre: true, usuarioId: true, nit: true } },
      participaciones: { where: { activo: true }, select: { id: true, usuarioId: true, principal: true,
        usuario: { select: { id: true, nombre: true, email: true, rol: true, activo: true } } } },
    },
  });
}
function perfil(usuario, proyecto) {
  if (usuario.rol === 'ADMIN') return { permitido: true, admin: true, consultor: false, lider: false, cliente: false };
  if (usuario.rol === 'EMPRESARIO' && proyecto.empresa.usuarioId === usuario.id)
    return { permitido: true, admin: false, consultor: false, lider: false, cliente: true };
  const participa = usuario.rol === 'EVALUADOR' && proyecto.participaciones.some(p =>
    p.usuarioId === usuario.id && p.usuario.activo);
  const lider = participa && proyecto.participaciones.some(p => p.usuarioId === usuario.id && p.principal);
  return { permitido: Boolean(participa), admin: false, consultor: Boolean(participa), lider: Boolean(lider), cliente: false };
}
/**
 * Verifica identidad, pertenencia al proyecto y restricciones opcionales.
 * @param {import('express').Request} req Solicitud autenticada por verificarToken.
 * @param {import('express').Response} res Respuesta para errores 400/403/404/409.
 * @param {{activo?:boolean,consultor?:boolean,lider?:boolean}} options Reglas requeridas.
 * @returns {Promise<{proyecto:object,rol:object}|null>} Contexto autorizado o null si ya se respondió.
 */
async function autorizar(req, res, { activo = false, consultor = false, lider = false } = {}) {
  const id = idValido(req.params.proyectoId || req.params.id);
  if (!id) { res.status(400).json({ message: 'Proyecto invalido.' }); return null; }
  const proyecto = await obtenerProyecto(id);
  if (!proyecto) { res.status(404).json({ message: 'Proyecto no encontrado.' }); return null; }
  const rol = perfil(req.usuario, proyecto);
  if (!rol.permitido || (consultor && !rol.consultor) || (lider && !rol.lider)) {
    res.status(403).json({ message: 'No autorizado para este proyecto.' }); return null;
  }
  if (activo && proyecto.estado !== 'ACTIVO') {
    res.status(409).json({ message: 'Proyecto no activo.' }); return null;
  }
  return { proyecto, rol };
}
module.exports = { obtenerProyecto, perfil, autorizar };
