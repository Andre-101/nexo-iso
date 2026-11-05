require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

function parseAreasYPreguntas(raw) {
  const lines = raw.split(/\r?\n/);
  const areas = [];
  let areaActual = null;
  let ultimaPregunta = null;

  for (const line of lines) {
    const normalized = line
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/–/g, '—');

    const areaMatch = normalized.match(/^##\s+AREA\s+(\d+)\s+—\s+(.+)$/i);
    if (areaMatch) {
      areaActual = {
        orden: Number(areaMatch[1]),
        nombre: areaMatch[2].trim(),
        descripcion: null,
        preguntas: [],
      };
      areas.push(areaActual);
      continue;
    }

    const preguntaMatch = line.match(/^\*\*(\d+)\.(\d+)\*\*\s+(.+)$/);
    if (preguntaMatch && areaActual) {
      ultimaPregunta = {
        orden: Number(preguntaMatch[2]),
        texto: preguntaMatch[3].trim(),
        descripcion: null,
      };
      areaActual.preguntas.push(ultimaPregunta);
      continue;
    }

    const ejemploMatch = line.match(/^>\s*Ej:\s*(.+)$/i);
    if (ejemploMatch && ultimaPregunta) {
      ultimaPregunta.descripcion = ejemploMatch[1].trim();
      continue;
    }

    if (areaActual && !areaActual.descripcion && line.trim().startsWith('*') && line.trim().endsWith('*')) {
      areaActual.descripcion = line.replace(/\*/g, '').trim();
    }
  }

  return areas;
}

async function main() {
  const sourcePath = path.join(process.cwd(), 'Logica y encuesta.txt');
  const raw = fs.readFileSync(sourcePath, 'utf8');
  const areas = parseAreasYPreguntas(raw);

  // Idempotente y no destructivo: conserva evaluaciones, respuestas y documentos.
  for (const area of areas) {
    let registro = await prisma.area.findFirst({ where: { orden: area.orden } });
    if (!registro) {
      registro = await prisma.area.create({
        data: { nombre: area.nombre, descripcion: area.descripcion, orden: area.orden },
      });
    }
    for (const pregunta of area.preguntas) {
      const existente = await prisma.pregunta.findFirst({
        where: { areaId: registro.id, orden: pregunta.orden },
      });
      if (!existente) {
        await prisma.pregunta.create({
          data: { areaId: registro.id, texto: pregunta.texto,
            descripcion: pregunta.descripcion, orden: pregunta.orden },
        });
      }
    }
  }

  console.log(`Seed no destructivo finalizado: ${areas.length} areas revisadas. No se han creado cuentas administrativas.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
