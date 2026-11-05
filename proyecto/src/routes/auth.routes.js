const router = require('express').Router();
const { registro, login, me } = require('../controllers/auth.controller');
const { verificarToken, soloRoles } = require('../middleware/auth.middleware');
const { loginThrottle } = require('../middleware/login-throttle');

router.post('/registro', verificarToken, soloRoles('ADMIN'), registro);
router.post('/login', loginThrottle, login);
router.get('/me', verificarToken, me);

module.exports = router;
