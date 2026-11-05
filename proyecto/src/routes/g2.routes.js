const router = require('express').Router();
const multer = require('multer');
const crypto = require('node:crypto');
const path = require('node:path');
const { verificarToken } = require('../middleware/auth.middleware');
const { uploadDir } = require('../middleware/upload.middleware');
const wrap = require('../middleware/async');
const g2 = require('../controllers/g2.controller');
const {exigirPlanAceptado,exigirPlanBrecha}=require('../middleware/plan-aceptado.middleware');
const fs = require('node:fs');
const folder = path.join(uploadDir, 'g2');
fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, folder),
    filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.pdf`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 12, parts: 13, fieldNestingDepth: 2, fieldNameSize: 100, fieldSize: 64 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf' || path.extname(file.originalname).toLowerCase() !== '.pdf')
      return cb(new Error('TIPO_ARCHIVO_INVALIDO'));
    return cb(null, true);
  },
});
router.use(verificarToken);
router.get('/:proyectoId/entregables', wrap(g2.listarEntregables));
router.post('/:proyectoId/actividades/:actividadId/entregables', wrap(exigirPlanAceptado), wrap(g2.crearEntregable));
router.post('/:proyectoId/entregables/:entregableId/versiones', wrap(exigirPlanAceptado), wrap(g2.autorizarSubida), upload.single('archivo'), wrap(g2.subirVersion));
router.get('/:proyectoId/entregables/:entregableId/versiones/:versionId/descargar', wrap(g2.descargarVersion));
router.post('/:proyectoId/entregables/:entregableId/versiones/:versionId/revisar', wrap(exigirPlanAceptado), wrap(g2.revisarVersion));
router.post('/:proyectoId/entregables/:entregableId/versiones/:versionId/coelaboracion', wrap(exigirPlanAceptado), wrap(g2.responderCoelaboracion));
router.post('/:proyectoId/actividades/:actividadId/verificaciones', wrap(exigirPlanAceptado), wrap(g2.verificarImplementacion));
router.get('/:proyectoId/actividades/:actividadId/verificaciones', wrap(g2.listarVerificaciones));
router.post('/:proyectoId/brechas/:brechaId/cerrar',wrap(exigirPlanBrecha),wrap(g2.cerrarBrecha));
router.get('/:proyectoId/informes-preparacion', wrap(g2.listarInformes));
router.post('/:proyectoId/informes-preparacion', wrap(g2.publicarInforme));
router.post('/:proyectoId/informes-preparacion/:informeId/afectacion', wrap(g2.marcarInformeAfectado));
router.get('/:proyectoId/informes-preparacion/:informeId/pdf', wrap(g2.descargarInforme));
module.exports = router;
