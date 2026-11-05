const prisma = require('../config/prisma');
const { puedeVerEvaluacion } = require('../utils/access');
const { presentarEvaluacion } = require('../utils/resultadoOrientativo');

async function listar(req, res) {
  if (req.usuario.rol === 'EVALUADOR') return res.json([]);
  const certs = await prisma.certificacion.findMany({
    where: req.usuario.rol === 'ADMIN' ? {} : { evaluacion: { empresa: { usuarioId: req.usuario.id } } },
    include: { evaluacion: { include: { empresa: true } } },
    orderBy: { creadaEn: 'desc' },
  });
  return res.json(certs.map(c => ({ ...c, evaluacion: presentarEvaluacion(c.evaluacion),
    advertencia: 'Registro historico interno; no constituye un certificado oficial ni una conclusion vigente de preparacion.' })));
}

async function obtener(req, res) {
  const id = Number(req.params.id);
  const cert = await prisma.certificacion.findUnique({
    where: { id },
    include: { evaluacion: { include: { empresa: true } } },
  });
  if (!cert) return res.status(404).json({ message: 'Registro no encontrado.' });
  if (!puedeVerEvaluacion(req.usuario, cert.evaluacion)) return res.status(403).json({ message: 'No autorizado.' });
  return res.json({
    ...cert,
    evaluacion: presentarEvaluacion(cert.evaluacion),
    advertencia: 'Registro historico interno; no constituye un certificado oficial ni una conclusion vigente de preparacion.',
  });
}

// Operaciones de expedición, renovación y cambio de estado retiradas del
// controlador: las rutas HTTP de certificación histórica devuelven 410.
// Mantenerlas aquí permitiría invocaciones internas accidentales contrarias
// al alcance: esta plataforma no es un organismo de certificación.
module.exports = { listar, obtener };
