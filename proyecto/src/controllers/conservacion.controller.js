/** DEC-Q60 / P-05. Registro operativo, no aceptación jurídica ni automatización de borrado. */
const prisma = require('../config/prisma');
const { autorizar } = require('../utils/proyecto-acceso');

function field(value, max, min = 1) { return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max ? value.trim() : null; }
function parsedExpected(value) {
  if (value === null) return null;
  if (Number.isSafeInteger(value) && value > 0) return value;
  return undefined;
}
async function historial(req, res) {
  const access = await autorizar(req, res);
  if (!access) return;
  if (!access.rol.admin && !access.rol.lider) return res.status(403).json({ message: 'Solo ADMIN y el consultor principal vigente pueden consultar las condiciones.' });
  const items = await prisma.condicionConservacionProyecto.findMany({
    where: { proyectoId: access.proyecto.id }, orderBy: { id: 'desc' },
    select: { id: true, referenciaAcuerdo: true, periodoPactado: true, condiciones: true, constanciaValidacion: true,
      creadoEn: true, registradoPor: { select: { id: true, nombre: true } } },
  });
  return res.json({ vigente: items[0] || null, historial: items });
}
async function registrar(req, res, next) {
  const access = await autorizar(req, res);
  if (!access) return;
  if (!access.rol.admin) return res.status(403).json({ message: 'Solo ADMIN registra condiciones contractuales.' });
  const body = req.body || {};
  const referenciaAcuerdo = field(body.referenciaAcuerdo, 250, 3);
  const periodoPactado = field(body.periodoPactado, 350);
  const condiciones = field(body.condiciones, 12000, 10);
  const constanciaValidacion = field(body.constanciaValidacion, 4000, 10);
  const esperadoId = parsedExpected(body.esperadoId);
  if (!referenciaAcuerdo || !periodoPactado || !condiciones || !constanciaValidacion || esperadoId === undefined) {
    return res.status(400).json({ message: 'Referencia, período pactado, condiciones, constancia de validación y versión esperada obligatorios.' });
  }
  try {
    const result = await prisma.$transaction(async tx => {
      const candado=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27260, CAST(${access.proyecto.id} AS INTEGER)) IS NOT NULL) AS "bloqueoTomado"`;
      if(!Array.isArray(candado)||candado.length!==1||candado[0]?.bloqueoTomado!==true)
        throw Object.assign(new Error('Q60: candado de conservación no acreditado'),{code:'Q60_CANDADO_INVALIDO'});
      const last = await tx.condicionConservacionProyecto.findFirst({ where: { proyectoId: access.proyecto.id }, orderBy: { id: 'desc' } });
      if ((last?.id ?? null) !== esperadoId) return { status: 409, message: 'Las condiciones fueron actualizadas por otra sesión. Consulte el historial antes de reintentar.' };
      if (last && last.referenciaAcuerdo === referenciaAcuerdo && last.periodoPactado === periodoPactado && last.condiciones === condiciones && last.constanciaValidacion === constanciaValidacion)
        return { status: 409, message: 'No se registran duplicados idénticos sin cambios contractuales.' };
      const item = await tx.condicionConservacionProyecto.create({ data: {
        proyectoId: access.proyecto.id, registradoPorId: req.usuario.id, referenciaAcuerdo, periodoPactado, condiciones, constanciaValidacion,
      } });
      await tx.eventoProyecto.create({ data: { proyectoId: access.proyecto.id, usuarioId: req.usuario.id,
        accion: 'REGISTRO_CONSERVACION_CONTRACTUAL', detalle: { registroId: item.id, anteriorId: last?.id ?? null, referenciaAcuerdo } } });
      return { status: 201, registro: item };
    }, { isolationLevel: 'Serializable' });
    return res.status(result.status).json(result.registro || { message: result.message });
  } catch(error) {
    if (['P2034', 'P2002'].includes(error.code)) return res.status(409).json({ message: 'Actualización concurrente. Vuelva a consultar los datos.' });
    return next(error);
  }
}
module.exports = { historial, registrar };
