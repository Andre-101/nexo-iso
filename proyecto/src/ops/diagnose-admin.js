'use strict';
// F354. Diagnostico solo lectura. No imprime correos, hashes, tokens ni secretos.
// Ejecutar en el contenedor API que ya utiliza DATABASE_URL/JWT_SECRET reales.
const prisma = require('../config/prisma');
const bcrypt = require('bcryptjs');

const emit = (code, extra = {}) => console.log('NEXO_ADMIN_DIAG ' + JSON.stringify({ code, ...extra }));
async function main() {
  try {
    const total = await prisma.usuario.count({ where: { rol: 'ADMIN' } });
    if (total === 0) { emit('ADMIN_NOT_FOUND'); process.exitCode = 1; return; }
    if (total !== 1) { emit('ADMIN_COUNT_UNEXPECTED', { count: total }); process.exitCode = 1; return; }
    const admin = await prisma.usuario.findFirst({
      where: { rol: 'ADMIN' },
      select: { id: true, activo: true, passwordHash: true, versionSesion: true },
    });
    if (!admin?.activo) { emit('ADMIN_INACTIVE'); process.exitCode = 1; return; }
    if (typeof admin.passwordHash !== 'string' || !/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(admin.passwordHash)) {
      emit('ADMIN_HASH_INVALID'); process.exitCode = 1; return;
    }
    // Probar el endpoint real sin enviar contraseñas auténticas ni alterar datos.
    const response = await fetch('http://127.0.0.1:3000/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nexo-probe-nonexistent@invalid.test', password: 'invalid-test-only' }),
      signal: AbortSignal.timeout(5000),
    });
    if (response.status !== 401) {
      emit('LOGIN_ENDPOINT_NOT_READY', { httpStatus: response.status }); process.exitCode = 1; return;
    }
    emit('ADMIN_PRESENT_LOGIN_ENDPOINT_OK', { adminActive: true, loginEndpoint: 401 });
  } catch (e) {
    const dbcode = typeof e?.code === 'string' && /^P\d{4}$/.test(e.code) ? e.code : null;
    emit(dbcode ? 'ADMIN_DB_' + dbcode : (e?.name === 'TimeoutError' ? 'ADMIN_LOGIN_TIMEOUT' : 'ADMIN_DIAG_FAILED'));
    process.exitCode = 2;
  } finally { await prisma.$disconnect().catch(() => {}); }
}
main();
