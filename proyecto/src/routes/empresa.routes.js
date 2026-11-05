const wrap = require('../middleware/async');
const router = require('express').Router();
const { listar, obtener, crear, actualizar, eliminar, aprobarEmpresa, conciliarDatos, listarAvisosRegistrales, abrirAvisoRegistral, sustituirRepresentante } = require('../controllers/empresa.controller');
const { verificarToken, soloRoles } = require('../middleware/auth.middleware');

router.get('/', verificarToken, wrap(listar));
router.get('/avisos-registrales', verificarToken, soloRoles('ADMIN'), wrap(listarAvisosRegistrales));
router.get('/avisos-registrales/:avisoId', verificarToken, soloRoles('ADMIN'), wrap(abrirAvisoRegistral));
router.get('/:id', verificarToken, wrap(obtener));
// DEC-REG239-A: no existe un endpoint para alta independiente de empresa.
// La creación interna ocurre exclusivamente en /api/usuarios/:id/vinculacion-empresa.
router.put('/:id', verificarToken, wrap(actualizar));
router.post('/:id/sustituir-representante', verificarToken, soloRoles('ADMIN'), wrap(sustituirRepresentante));
// Operación de habilitación manual retirada: ninguna ruta publica aprobarEmpresa.
router.post('/:id/conciliar-datos', verificarToken, soloRoles('ADMIN'), wrap(conciliarDatos));
router.delete('/:id', verificarToken, soloRoles('ADMIN'), wrap(eliminar));

module.exports = router;
