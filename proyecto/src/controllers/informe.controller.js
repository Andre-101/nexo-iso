const prisma = require('../config/prisma');
const { construirPdfInforme } = require('../utils/pdfInforme');
const { puedeVerEvaluacion } = require('../utils/access');

async function crear(req, res) {
  const { evaluacionId, resumen, recomendaciones } = req.body;
  if (!evaluacionId || !resumen || !recomendaciones) {
    return res.status(400).json({ message: 'evaluacionId, resumen y recomendaciones son obligatorios.' });
  }

  const evaluacion = await prisma.evaluacion.findUnique({ where: { id: Number(evaluacionId) }, include: { empresa: true } });
  if (!evaluacion) return res.status(404).json({ message: 'Evaluacion no encontrada.' });

  if (!puedeVerEvaluacion(req.usuario, evaluacion)) return res.status(403).json({ message: 'No autorizado.' });
  if (evaluacion.estado === 'BORRADOR') return res.status(409).json({ message: 'Envie la evaluacion antes de crear un informe.' });
  const informe = await prisma.informe.create({
    data: {
      evaluacionId: Number(evaluacionId),
      creadoPorId: req.usuario.id,
      resumen,
      recomendaciones,
    },
  });

  await prisma.evaluacion.update({
    where: { id: Number(evaluacionId) },
    data: { estado: 'EN_REVISION' },
  });

  return res.status(201).json(informe);
}

async function obtener(req, res) {
  const id = Number(req.params.id);
  const informe = await prisma.informe.findUnique({
    where: { id },
    include: { creadoPor: { select: { id: true, nombre: true, email: true } } },
  });
  if (!informe) return res.status(404).json({ message: 'Informe no encontrado.' });
  const evaluacion = await prisma.evaluacion.findUnique({ where: { id: informe.evaluacionId }, include: { empresa: true } });
  if (!evaluacion || !puedeVerEvaluacion(req.usuario, evaluacion)) return res.status(403).json({ message: 'No autorizado.' });
  return res.json(informe);
}

async function porEvaluacion(req, res) {
  const evaluacionId = Number(req.params.evaluacionId);
  const evaluacion = await prisma.evaluacion.findUnique({ where: { id: evaluacionId }, include: { empresa: true } });
  if (!evaluacion) return res.status(404).json({ message: 'Evaluacion no encontrada.' });

  if (!puedeVerEvaluacion(req.usuario, evaluacion)) return res.status(403).json({ message: 'No autorizado.' });

  const informes = await prisma.informe.findMany({
    where: { evaluacionId },
    orderBy: { creadoEn: 'desc' },
  });
  return res.json(informes);
}

async function descargarPdfPorEvaluacion(req, res) {
  const evaluacionId = Number(req.params.evaluacionId);
  const evaluacion = await prisma.evaluacion.findUnique({
    where: { id: evaluacionId },
    include: {
      empresa: true,
      respuestas: {
        include: {
          pregunta: {
            include: { area: true },
          },
        },
        orderBy: { preguntaId: 'asc' },
      },
      certificacion: true,
      informes: {
        include: { creadoPor: { select: { id: true, nombre: true, email: true } } },
        orderBy: { creadoEn: 'desc' },
      },
    },
  });

  if (!evaluacion) return res.status(404).json({ message: 'Evaluacion no encontrada.' });

  if (!puedeVerEvaluacion(req.usuario, evaluacion)) return res.status(403).json({ message: 'No autorizado.' });

  if (!evaluacion.respuestas.length) {
    return res.status(400).json({ message: 'La evaluacion no tiene respuestas para generar informe.' });
  }

  const ultimoInforme = evaluacion.informes[0] || null;
  const nombreEmpresa = (evaluacion.empresa?.nombre || 'empresa').replace(/[^\w.-]+/g, '_');
  const tipo = 'informe_preparacion';
  const nombreArchivo = `${tipo}_${nombreEmpresa}_eval_${evaluacion.id}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);

  construirPdfInforme({
    stream: res,
    evaluacion,
    certificacion: evaluacion.certificacion,
    preguntas: evaluacion.respuestas,
    informe: ultimoInforme,
  });
}

module.exports = { crear, obtener, porEvaluacion, descargarPdfPorEvaluacion };
