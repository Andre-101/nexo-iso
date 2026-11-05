require('dotenv').config();
// En VPS, NODE_OPTIONS precarga el lector de archivos /run/secrets antes de Prisma.
require('./utils/data-mode').checkMode(process.env);
const { validarEntorno } = require('./config/security');
validarEntorno();
const app = require('./app');
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => console.log(`API ISO27001 escuchando en puerto ${port}`));
server.headersTimeout = 15_000;
server.requestTimeout = 60_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 200;
