'use strict';
/**
 * BE-02 / Q57-Q58: prototipo aislado de apertura de avisos.
 * La BD es PostgreSQL real vía Prisma; solo los registros de ensayo son ficticios.
 * Contrato EXPERIMENTAL, no integración o habilitación comercial.
 */
const crypto = require('node:crypto');
const prisma = require('../config/prisma');
const { idValido } = require('../utils/access');

const resumen = {
  id: true, proyectoId: true, actividadId: true, tipo: true, creadaEn: true,
  leidaEn: true, origenNotificacionId: true,
  proyecto: { select: { nombre: true } },
  actividad: { select: { titulo: true } },
};
const detalle = {
  ...resumen,
  fechaAnterior: true, fechaNueva: true, justificacion: true,
  cambioRepresentacionId: true, eventoTerminacionId: true,
};
// La prueba de apertura identifica un GET de detalle autorizado; no constituye
// una aceptación contractual ni acredita lectura humana o visualización.
// No se guarda en BD: el cliente la devuelve automáticamente tras presentar
// el detalle. Su firma está separada del contexto de los JWT de acceso.
const VIGENCIA_COMPROBANTE_MS = 10 * 60 * 1000;
const CONTEXTO_COMPROBANTE = 'BE02:APERTURA-DETALLE:v1';
function secretoComprobante() {
  const clave = process.env.JWT_SECRET;
  if (typeof clave !== 'string' || clave.length < 32) {
    throw new Error('BE02_CONFIG: JWT_SECRET no configurado con longitud adecuada');
  }
  return clave;
}
function firmarComprobante(payloadCodificado) {
  return crypto.createHmac('sha256', secretoComprobante())
    .update(CONTEXTO_COMPROBANTE + '.' + payloadCodificado)
    .digest('base64url');
}
function emitirComprobante(id, destinatarioId) {
  const payload = Buffer.from(JSON.stringify({n: id, u: destinatarioId, t: Date.now()}))
    .toString('base64url');
  return `${payload}.${firmarComprobante(payload)}`;
}
function validarComprobante(token, id, destinatarioId) {
  if (typeof token !== 'string' || token.length > 512 || token.length < 12) return false;
  const partes = token.split('.');
  if (partes.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(partes[0]) ||
      !/^[A-Za-z0-9_-]{43}$/.test(partes[1])) return false;
  const firmaEsperada = Buffer.from(firmarComprobante(partes[0]), 'base64url');
  const firmaEntregada = Buffer.from(partes[1], 'base64url');
  if (firmaEntregada.toString('base64url') !== partes[1] ||
      firmaEsperada.length !== firmaEntregada.length ||
      !crypto.timingSafeEqual(firmaEsperada, firmaEntregada)) return false;
  let datos;
  try {datos = JSON.parse(Buffer.from(partes[0], 'base64url').toString('utf8'));}
  catch {return false;}
  const ahora = Date.now();
  return datos?.n === id && datos?.u === destinatarioId &&
    Number.isSafeInteger(datos.t) && datos.t <= ahora &&
    ahora - datos.t <= VIGENCIA_COMPROBANTE_MS;
}
function privado(res) {
  // Una respuesta privada nunca debe almacenarse en un proxy o caché compartido.
  if (typeof res.set === 'function') res.set('Cache-Control', 'private, no-store');
}
function fallosDB(error, res) {
  if (['P2034', 'P2002', 'P2003'].includes(error.code)) {
    return res.status(409).json({ message: 'Conflicto de representación; vuelva a consultar.' });
  }
  throw error;
}
function representante(req, res) {
  if (!req.usuario || req.usuario.rol !== 'EMPRESARIO') {
    res.status(403).json({ message: 'Acceso reservado al representante autorizado.' });
    return false;
  }
  return true;
}
/**
 * El bloqueo de empresa (27182, empresaId) es compartido con Q58; antes de
 * adquirirlo solo se lee el ID candidato, que NO concede permiso.
 */
async function empresaActualBloqueada(tx, empresaId, actorId) {
  await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27182, CAST(${empresaId} AS INTEGER)) IS NULL) AS "bloqueoTomado"`;
  return tx.empresa.findFirst({
    where: { id: empresaId, usuarioId: actorId }, select: { id: true },
  });
}
async function listar(req, res) {
  if (!representante(req, res)) return;
  privado(res);
  const actor = req.usuario.id;
  try {
    // La búsqueda externa es únicamente una pista para el bloqueo, no autoriza.
    const empresa = await prisma.empresa.findFirst({
      where: { usuarioId: actor }, select: { id: true },
    });
    if (!empresa) return res.status(403).json({ message: 'No tiene representación vigente.' });
    const resultado = await prisma.$transaction(async tx => {
      if (!await empresaActualBloqueada(tx, empresa.id, actor)) {
        return { status: 403, message: 'La representación cambió.' };
      }
      const where = { destinatarioId: actor, proyecto: { empresaId: empresa.id } };
      // El bloqueo compartido evita intercalados Q57/Q58 entre estas consultas.
      // Otras escrituras no coordinadas deben probarse por separado.
      const pendientesLista = await tx.notificacionProyecto.findMany({
        where: { ...where, leidaEn: null }, orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }],
        take: 50, select: resumen,
      });
      const historicoLista = await tx.notificacionProyecto.findMany({
        where: { ...where, leidaEn: { not: null } },
        orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }],
        take: 20, select: resumen,
      });
      const pendientes = await tx.notificacionProyecto.count({
        where: { ...where, leidaEn: null },
      });
      return { status: 200, notificaciones: [...pendientesLista, ...historicoLista],
        pendientes, limitePendientes: 50, limiteHistorico: 20 };
    }, { isolationLevel: 'ReadCommitted' });
    if (resultado.status !== 200) return res.status(resultado.status).json({ message: resultado.message });
    return res.json(resultado);
  } catch (e) { return fallosDB(e, res); }
}
/** GET detalle no registra lectura: el frontend debe presentar el contenido y
 * luego invocar automáticamente POST /aperturas, nunca por precarga o sondeo. */
async function abrirDetalle(req, res) {
  if (!representante(req, res)) return;
  privado(res);
  const id = idValido(req.params.notificacionId);
  if (!id) return res.status(400).json({ message: 'Notificación inválida.' });
  try {
    // Un ID de aviso ajeno no debe siquiera adquirir un bloqueo de otra empresa.
    // Este filtro preliminar NO sustituye la autorización revalidada bajo Q58.
    const candidato = await prisma.notificacionProyecto.findFirst({
      where: { id, destinatarioId: req.usuario.id },
      select: { proyecto: { select: { empresaId: true } } },
    });
    if (!candidato) return res.status(404).json({ message: 'Aviso no encontrado.' });
    const empresaId = candidato.proyecto.empresaId;
    const resultado = await prisma.$transaction(async tx => {
      if (!await empresaActualBloqueada(tx, empresaId, req.usuario.id)) return null;
      return tx.notificacionProyecto.findFirst({
        where: { id, destinatarioId: req.usuario.id, proyecto: { empresaId } },
        select: detalle,
      });
    }, { isolationLevel: 'ReadCommitted' });
    if (!resultado) return res.status(404).json({ message: 'Aviso no disponible.' });
    return res.json({ ...resultado, comprobanteApertura: emitirComprobante(id, req.usuario.id) });
  } catch (e) { return fallosDB(e, res); }
}
/** Confirmación automática luego de presentar un aviso: no es aceptación legal.
 * Un reintento conserva la fecha original; Q58 serializa por la misma empresa. */
async function confirmarApertura(req, res) {
  if (!representante(req, res)) return;
  privado(res);
  const id = idValido(req.params.notificacionId);
  if (!id) return res.status(400).json({ message: 'Notificación inválida.' });
  // La confirmación requiere un GET de detalle previamente autorizado y
  // un comprobante limitado al mismo destinatario y aviso. El comprobante
  // no sustituye la comprobación TRANSACCIONAL de representación Q58.
  if (!validarComprobante(req.body?.comprobanteApertura, id, req.usuario.id)) {
    return res.status(400).json({ message: 'Abra de nuevo el aviso para registrar su apertura.' });
  }
  try {
    // Un ID de aviso ajeno no debe siquiera adquirir un bloqueo de otra empresa.
    // Este filtro preliminar NO sustituye la autorización revalidada bajo Q58.
    const candidato = await prisma.notificacionProyecto.findFirst({
      where: { id, destinatarioId: req.usuario.id },
      select: { proyecto: { select: { empresaId: true } } },
    });
    if (!candidato) return res.status(404).json({ message: 'Aviso no encontrado.' });
    const empresaId = candidato.proyecto.empresaId;
    const resultado = await prisma.$transaction(async tx => {
      if (!await empresaActualBloqueada(tx, empresaId, req.usuario.id)) return null;
      const where = { id, destinatarioId: req.usuario.id, proyecto: { empresaId } };
      const vigente = await tx.notificacionProyecto.findFirst({
        where, select: { id: true, leidaEn: true },
      });
      if (!vigente) return null;
      if (vigente.leidaEn) return { id, leidaEn: vigente.leidaEn, yaLeida: true };
      const ahora = new Date();
      const actualizado = await tx.notificacionProyecto.updateMany({
        where: { ...where, leidaEn: null }, data: { leidaEn: ahora },
      });
      if (actualizado.count !== 1) throw Object.assign(new Error('Apertura concurrente'), {code:'P2034'});
      return { id, leidaEn: ahora, yaLeida: false };
    }, { isolationLevel: 'ReadCommitted' });
    if (!resultado) return res.status(404).json({ message: 'Aviso no disponible.' });
    return res.json(resultado);
  } catch (e) { return fallosDB(e, res); }
}
function lecturaManualRetirada(_req, res) {
  return res.status(410).json({
    message: 'La lectura manual está retirada: abra el aviso individual y confirme su presentación automáticamente.'
  });
}
module.exports = { listar, abrirDetalle, confirmarApertura, lecturaManualRetirada };
