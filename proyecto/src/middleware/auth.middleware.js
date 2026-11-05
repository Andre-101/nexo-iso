/**
 * Autenticación JWT y roles globales.
 * La comprobación de rol NO sustituye autorización por proyecto/recurso:
 * véase src/utils/proyecto-acceso.js (defensa contra IDOR/tenant crossover).
 */
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

async function verificarToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: 'Token requerido.' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'], issuer: 'nexo', audience: 'nexo-web',
    });
    const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });

    if (!usuario || !usuario.activo || (payload.ver ?? 0) !== (usuario.versionSesion ?? 0)) {
      return res.status(401).json({ message: 'Usuario invalido o inactivo.' });
    }

    req.usuario = {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
    };

    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Token invalido.' });
  }
}

function soloRoles(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ message: 'No autenticado.' });
    }

    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ message: 'No autorizado para este recurso.' });
    }

    return next();
  };
}

module.exports = { verificarToken, soloRoles };
