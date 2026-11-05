const wrap = require('../middleware/async');
const router = require('express').Router();
const ctrl = require('../controllers/certificacion.controller');
const { verificarToken } = require('../middleware/auth.middleware');
router.use(verificarToken);
router.get('/', wrap(ctrl.listar));
router.get('/:id', wrap(ctrl.obtener));
function deshabilitada(_req, res) {
  return res.status(410).json({ message: 'Operacion antigua deshabilitada: esta plataforma no expide certificaciones oficiales.' });
}
router.post('/desde-evaluacion', deshabilitada);
router.post('/:id/renovar', deshabilitada);
router.put('/:id/estado', deshabilitada);
module.exports = router;
