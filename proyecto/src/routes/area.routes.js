const router = require('express').Router();
const { verificarToken } = require('../middleware/auth.middleware');
const prisma = require('../config/prisma');

router.get('/', verificarToken, async (_req, res) => {
  const areas = await prisma.area.findMany({
    include: { preguntas: { orderBy: { orden: 'asc' } } },
    orderBy: { orden: 'asc' },
  });
  res.json(areas);
});

module.exports = router;
