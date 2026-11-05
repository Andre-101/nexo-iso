const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { failedLogin, successfulLogin } = require('../middleware/login-throttle');

function crearToken(usuario) {
  return jwt.sign(
    { sub: usuario.id, rol: usuario.rol, email: usuario.email, ver: usuario.versionSesion ?? 0 },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', issuer: 'nexo', audience: 'nexo-web', expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

async function registro(req, res) {
  try {
    const { nombre, email, password, rol = 'EMPRESARIO' } = req.body;
    if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) return res.status(400).json({ message: 'La contraseña debe tener entre 12 caracteres y 72 bytes UTF-8.' });

    if (typeof nombre !== 'string' || !nombre.trim() || nombre.length > 180 ||
        typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || !password) {
      return res.status(400).json({ message: 'nombre, email y password son obligatorios.' });
    }

    if (!['ADMIN', 'EMPRESARIO', 'EVALUADOR'].includes(rol)) {
      return res.status(400).json({ message: 'Rol invalido.' });
    }

    const normalEmail = email.trim().toLowerCase();
    const existe = await prisma.usuario.findUnique({ where: { email: normalEmail } });
    if (existe) {
      return res.status(409).json({ message: 'El email ya se encuentra registrado.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const usuario = await prisma.usuario.create({
      data: { nombre: nombre.trim(), email: normalEmail, passwordHash, rol },
      select: { id: true, nombre: true, email: true, rol: true, activo: true, creadoEn: true },
    });

    // SOL-39: ADMIN da de alta una identidad; no inicia sesión por la nueva cuenta.
    // Emitir el JWT aquí permitiría que una credencial destinada a la persona creada
    // se entregase a quien administra el alta, además de confundir el contrato público.
    return res.status(201).json({ usuario });
  } catch (error) {
    return res.status(500).json({ message: 'No se pudo registrar el usuario.' });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || !email.trim() || email.length > 254 ||
        typeof password !== 'string' || !password || password.length > 4096) {
      return res.status(400).json({ message: 'email y password son obligatorios.' });
    }

    const usuario = await prisma.usuario.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!usuario || !usuario.activo) {
      failedLogin(req);
      return res.status(401).json({ message: 'Credenciales invalidas.' });
    }

    const ok = await bcrypt.compare(password, usuario.passwordHash);
    if (!ok) {
      failedLogin(req);
      return res.status(401).json({ message: 'Credenciales invalidas.' });
    }

    successfulLogin(req);
    const token = crearToken(usuario);
    return res.json({
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'No se pudo iniciar sesion.' });
  }
}

async function me(req, res) {
  return res.json({ usuario: req.usuario });
}

module.exports = { registro, login, me };
