const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const prisma = require('../config/prisma');
const { puedeVerEvaluacion, idValido } = require('../utils/access');

const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'private_uploads'));
fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });

// Comprobar autorización antes de aceptar bytes del archivo.
async function autorizarCarga(req, res, next) {
  try {
    const id = idValido(req.params.evaluacionId);
    if (!id) return res.status(400).json({ message: 'Identificador de evaluacion invalido.' });
    const evaluacion = await prisma.evaluacion.findUnique({ where: { id }, include: { empresa: true } });
    if (!evaluacion) return res.status(404).json({ message: 'Evaluacion no encontrada.' });
    if (!puedeVerEvaluacion(req.usuario, evaluacion) || req.usuario.rol !== 'EMPRESARIO') {
      return res.status(403).json({ message: 'No autorizado para cargar este documento.' });
    }
    // DEC-P05 / RN-20: al finalizar o suspender el proyecto permanece la consulta,
    // pero no se crean nuevos soportes por la interfaz heredada.
    if (evaluacion.proyectoId != null) {
      const proyecto = await prisma.proyectoConsultoria.findUnique({
        where: { id: evaluacion.proyectoId }, select: { estado: true },
      });
      if (!proyecto || proyecto.estado !== 'ACTIVO') {
        return res.status(409).json({ message: 'Expediente no activo: los documentos se conservan únicamente para consulta.' });
      }
    }
    req.evaluacionAutorizada = evaluacion;
    return next();
  } catch (error) { return next(error); }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.pdf`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 12, parts: 13, fieldNestingDepth: 2, fieldNameSize: 100, fieldSize: 64 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' && path.extname(file.originalname).toLowerCase() === '.pdf';
    if (!ok) return cb(new Error('TIPO_ARCHIVO_INVALIDO'));
    return cb(null, true);
  },
});
module.exports = { upload, autorizarCarga, uploadDir };
