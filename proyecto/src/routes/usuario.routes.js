const router = require('express').Router();
const { verificarToken, soloRoles } = require('../middleware/auth.middleware');
const prisma = require('../config/prisma');
const wrap = require('../middleware/async');
const { idValido } = require('../utils/access');
const cuentas = require('../controllers/cuentas.controller');
const empresas = require('../controllers/empresa.controller');

router.get('/', verificarToken, soloRoles('ADMIN'), wrap(async (_req, res) => {
  const usuarios = await prisma.usuario.findMany({
    select: { id: true, nombre: true, email: true, rol: true, activo: true, bloqueoUrgente: true, creadoEn: true },
    orderBy: { creadoEn: 'desc' },
  });
  res.json(usuarios);
}));

// El alta de la empresa ocurre solo como efecto de vincular su representante por NIT.
router.post('/:id/vinculacion-empresa', verificarToken, soloRoles('ADMIN'), wrap((req,res)=>
  empresas.crear({...req,body:{...req.body,usuarioId:req.params.id}},res)));

router.post('/:id/bloqueo-urgente', verificarToken, soloRoles('ADMIN'), cuentas.bloqueoUrgente);
router.get('/:id/revision-reactivacion', verificarToken, soloRoles('ADMIN'), cuentas.prepararReactivacion);
router.post('/:id/reactivacion', verificarToken, soloRoles('ADMIN'), cuentas.reactivarUrgente);

router.put('/:id/estado', verificarToken, soloRoles('ADMIN'), cuentas.estadoNormal);

// F3-ANA-334: revalida asignaciones y representación bajo candados de identidad y cuenta.
router.put('/:id', verificarToken, soloRoles('ADMIN'), cuentas.editarPerfil);

// F3-ANA-335: el borrado queda bajo los mismos candados de identidad y cuenta.
router.delete('/:id', verificarToken, soloRoles('ADMIN'), cuentas.eliminarCuenta);

module.exports = router;
