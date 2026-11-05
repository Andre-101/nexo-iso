/**
 * Composición HTTP del backend. Rutas y contratos se inventarían de forma
 * centralizada. Las políticas de negocio permanecen en controllers y services.
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.routes');
const usuarioRoutes = require('./routes/usuario.routes');
const empresaRoutes = require('./routes/empresa.routes');
const areaRoutes = require('./routes/area.routes');
const evaluacionRoutes = require('./routes/evaluacion.routes');
const soporteRoutes = require('./routes/soporte.routes');
const informeRoutes = require('./routes/informe.routes');
const certificacionRoutes = require('./routes/certificacion.routes');
const proyectoRoutes = require('./routes/proyecto.routes');
const g2Routes = require('./routes/g2.routes');
const g3Routes = require('./routes/g3.routes');

const app = express();
app.set('query parser', 'simple'); // Evita prototipos anidados en querystrings (qs).
app.disable('etag');
// En producción, web y API comparten origen: nginx reenvía /api/ a la API.
// NO habilitar CORS (ni depender de un subdominio aún no configurado).
// Los navegadores aplican same-origin; nunca publicar el puerto 3000.
app.use(helmet());
if (process.env.NODE_ENV !== 'production') {
  const { allowedWebOrigins } = require('./utils/allowed-web-origins');
  const allowedOrigins = allowedWebOrigins(process.env.FRONTEND_URL, process.env.WEB_PORT);
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error('Origen no permitido por CORS.'));
    },
  }));
}
app.use(express.json({ limit: '1mb' })); // Límite original necesario para formularios extensos.
app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
morgan.token('safe-path', req => req.path);
if (process.env.NODE_ENV !== 'test') app.use(morgan(':method :safe-path :status :response-time ms')); // No registrar consultas ni Referer.
app.disable('x-powered-by');

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'iso27001-backend' });
});

// Readiness: conexion real y presencia de todos los modelos esperados; no realiza migraciones.
app.get('/ready', async (_req, res) => {
  try {
    const prisma = require('./config/prisma');
    const {checkSchemaReadiness} = require('./utils/schema-readiness-350');
    const schema = await checkSchemaReadiness(prisma);
    if (schema.missing.length) {
      return res.status(503).json({ ok: false, code: 'SCHEMA_NOT_INITIALIZED', missingTables: schema.missing.length });
    }
    return res.json({ ok: true, database: 'ready' });
  } catch (_err) {
    return res.status(503).json({ ok: false, code: 'DATABASE_NOT_READY' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuarioRoutes);
app.use('/api/empresas', empresaRoutes);
app.use('/api/proyectos', g2Routes);
app.use('/api/proyectos', g3Routes);
app.use('/api/proyectos', proyectoRoutes);
app.use('/api/areas', areaRoutes);
app.use('/api/evaluaciones', evaluacionRoutes);
app.use('/api/soportes', soporteRoutes);
app.use('/api/informes', informeRoutes);
app.use('/api/certificaciones', certificacionRoutes);

app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'JSON invalido.' });
  if (err.code === 'LIMIT_FILE_SIZE' || err.type === 'entity.too.large') return res.status(413).json({ message: 'La solicitud supera el límite permitido.' });
  if (typeof err.code === 'string' && err.code.startsWith('LIMIT_')) return res.status(400).json({ message: 'Formulario de archivos inválido.' });
  if (err.message === 'TIPO_ARCHIVO_INVALIDO') return res.status(400).json({ message: 'Solo se aceptan archivos PDF.' });
  if (err.message === 'Origen no permitido por CORS.') return res.status(403).json({ message: 'Origen no autorizado.' });
  console.error('[API_ERROR]', typeof err?.code === 'string' ? err.code : (err?.name || 'UNKNOWN')); // Evitar volcar credenciales o datos personales.
  return res.status(500).json({ message: 'Error interno del servidor.' });
});

module.exports = app;
