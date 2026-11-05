const wrap = require('../middleware/async');
const router = require('express').Router();
const ctrl = require('../controllers/evaluacion.controller');
const { verificarToken, soloRoles } = require('../middleware/auth.middleware');

router.get('/', verificarToken, wrap(ctrl.listar));
router.post('/', verificarToken, soloRoles('EMPRESARIO', 'ADMIN'), (_req,res) => res.status(410).json({ message: 'Para iniciar un diagnostico use POST /api/proyectos/:proyectoId/diagnosticos tras contratar el servicio.' }));
router.get('/:id', verificarToken, wrap(ctrl.obtener));
router.post('/:id/respuestas', verificarToken, wrap(ctrl.guardarRespuestas));
router.post('/:id/comentarios-evaluador', verificarToken, soloRoles('ADMIN'), wrap(ctrl.comentarPorPregunta));
router.post('/:id/enviar', verificarToken, soloRoles('EMPRESARIO'), wrap(ctrl.enviar));
router.get('/:id/resumen', verificarToken, wrap(ctrl.resumen));

module.exports = router;
