/** DEC-Q61: prevalidación informativa, sin mutación del estado del proyecto. */
'use strict';
const prisma = require('../config/prisma');
const { autorizar } = require('../utils/proyecto-acceso');
const { evaluarCierreFormal } = require('../utils/cierre-formal');
async function prevalidacion(req, res) {
  const acceso = await autorizar(req, res);
  if (!acceso) return;
  if (!acceso.rol.admin && !acceso.rol.lider)
    return res.status(403).json({ message: 'Solo ADMIN y el consultor principal pueden consultar la prevalidación del cierre.' });
  const resultado = await evaluarCierreFormal(prisma, acceso.proyecto.id, acceso.proyecto.estado);
  return res.json(resultado);
}
module.exports = { prevalidacion };
