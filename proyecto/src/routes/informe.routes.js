const wrap = require('../middleware/async');
const router = require('express').Router();
const ctrl = require('../controllers/informe.controller');
const { verificarToken, soloRoles } = require('../middleware/auth.middleware');

router.post('/', verificarToken, soloRoles('ADMIN'), wrap(ctrl.crear));
router.get('/evaluacion/:evaluacionId', verificarToken, wrap(ctrl.porEvaluacion));
router.get('/evaluacion/:evaluacionId/pdf', verificarToken, wrap(ctrl.descargarPdfPorEvaluacion));
router.get('/:id', verificarToken, wrap(ctrl.obtener));

module.exports = router;
