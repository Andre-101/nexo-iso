const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const prisma = require('../config/prisma');
const { uploadDir } = require('../middleware/upload.middleware');
const { puedeVerEvaluacion, idValido } = require('../utils/access');

const legacyDir = path.resolve(process.cwd(), 'uploads');
// G0/P05 (experimental): solo archivos regulares dentro de los directorios
// privados configurados. Una comprobación de prefijo textual no detecta enlaces
// simbólicos/junctions que cambian el destino real de una descarga.
function descendienteDe(directorio, destino) {
  const relativo = path.relative(directorio, destino);
  return relativo !== '' && relativo !== '..' &&
    !relativo.startsWith('..' + path.sep) && !path.isAbsolute(relativo);
}
function rutaSegura(archivo) {
  if (typeof archivo !== 'string' || !archivo || archivo.includes('\0')) return null;
  const absolute = path.resolve(archivo);
  for (const root of [uploadDir, legacyDir]) {
    if (!descendienteDe(root, absolute)) continue;
    try {
      const rootReal = fs.realpathSync(root);
      // No permitir enlaces en ninguno de los componentes del archivo almacenado.
      // La carpeta raíz misma puede estar montada intencionalmente en otra ubicación.
      let actual = root;
      for (const segmento of path.relative(root, absolute).split(path.sep)) {
        actual = path.join(actual, segmento);
        if (fs.lstatSync(actual).isSymbolicLink()) return null;
      }
      const archivoReal = fs.realpathSync(absolute);
      if (!descendienteDe(rootReal, archivoReal)) return null;
      if (!fs.statSync(archivoReal).isFile()) return null;
      return absolute;
    } catch (error) {
      // Si desaparece o no puede leerse un archivo, no resolver rutas alternativas.
      if (['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EPERM'].includes(error.code)) return null;
      throw error;
    }
  }
  return null;
}
// F3-ANA-237 / G0: validar la identidad de un descriptor abierto, no entregar
// de nuevo la ruta a Express. La ruta se puede sustituir entre realpath y
// res.download; aquí la lectura se hace desde el descriptor comprobado.
// No constituye una garantía ante mutaciones de contenido in-place ni ante un
// atacante con permisos para alterar arbitrariamente el directorio privado.
function abrirDescriptorPrivado(archivo) {
  const validado = rutaSegura(archivo);
  if (!validado) return null;
  let fd;
  function cerrarSiAbierto() {
    if (fd === undefined) return;
    const existente = fd;
    fd = undefined;
    fs.closeSync(existente);
  }
  try {
    const anterior = fs.lstatSync(validado);
    if (!anterior.isFile() || anterior.isSymbolicLink()) return null;
    // O_NOFOLLOW protege el último componente en sistemas que lo soportan;
    // O_NONBLOCK evita bloquearse si un archivo es sustituido por FIFO en Unix.
    const flags = fs.constants.O_RDONLY |
      (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
    fd = fs.openSync(validado, flags);
    const abierto = fs.fstatSync(fd);
    const posterior = fs.lstatSync(validado);
    const validadoDespues = rutaSegura(archivo);
    const mismaIdentidad = validadoDespues === validado &&
      anterior.dev === abierto.dev && anterior.ino === abierto.ino &&
      posterior.dev === abierto.dev && posterior.ino === abierto.ino;
    if (!mismaIdentidad || !abierto.isFile() || !posterior.isFile() ||
        anterior.nlink < 1 || abierto.nlink < 1 || posterior.nlink < 1) {
      cerrarSiAbierto();
      return null;
    }
    return { fd, size: abierto.size };
  } catch (error) {
    cerrarSiAbierto();
    if (['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EPERM', 'ESTALE', 'EINVAL', 'EISDIR'].includes(error.code)) {
      return null;
    }
    throw error;
  }
}
// Cabecera de descarga con nombre inofensivo (ASCII y UTF-8, RFC 6266).
function nombreDescargaSeguro(nombre) {
  const normalizado = String(nombre || 'soporte.pdf')
    .replace(/[\x00-\x1f\x7f\\/:;\"<>|?*]/g, '_').replace(/"/g, '_').trim().slice(0, 180) || 'soporte.pdf';
  const ascii = normalizado.replace(/[^\x20-\x7e]/g, '_');
  const utf8 = encodeURIComponent(normalizado).replace(/[!'()*]/g, c =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
function borrarTemporal(req) {
  if (req.file && rutaSegura(req.file.path)) {
    try { fs.unlinkSync(req.file.path); } catch (err) { if (err.code !== 'ENOENT') console.error(err); }
  }
}
function registroPublico(s) {
  const { rutaArchivo, ...seguro } = s;
  return { ...seguro, downloadUrl: `/api/soportes/archivo/${s.id}` };
}
function esPdfReal(archivo) {
  try {
    const fd = fs.openSync(archivo, 'r');
    try {
      const buffer = Buffer.alloc(5);
      const n = fs.readSync(fd, buffer, 0, 5, 0);
      return n === 5 && buffer.toString('ascii') === '%PDF-';
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}

// F3-ANA-236: la autorización de autorizarCarga ocurre ANTES de recibir los
// bytes (multer). No puede servir como permiso vigente al momento de persistir.
// Los bloqueos SELECT FOR UPDATE siguen el orden Usuario -> Empresa ->
// Proyecto -> Evaluacion, sin cambiar los registros como efecto del bloqueo.
// No se cambian filas para adquirir el bloqueo, ni se confía en empresarioId
// histórico como titular vigente. Serializable aborta transacciones en conflicto.
async function crearSoporteAutorizado(req, metadata) {
  const id = idValido(req.params.evaluacionId);
  if (!id || req.evaluacionAutorizada?.id !== id || req.usuario?.rol !== 'EMPRESARIO') {
    return null;
  }
  return prisma.$transaction(async tx => {
    const previo = await tx.evaluacion.findUnique({
      where: { id }, select: { id: true, empresaId: true, proyectoId: true },
    });
    if (!previo) return null;
    const [cuenta] = await tx.$queryRaw`
      SELECT "id", "activo", "rol" FROM "Usuario"
      WHERE "id" = ${req.usuario.id} FOR UPDATE
    `;
    if (!cuenta || !cuenta.activo || cuenta.rol !== 'EMPRESARIO') return null;
    const [empresa] = await tx.$queryRaw`
      SELECT "id", "usuarioId" FROM "Empresa"
      WHERE "id" = ${previo.empresaId} FOR UPDATE
    `;
    if (!empresa || empresa.usuarioId !== req.usuario.id) return null;

    if (previo.proyectoId != null) {
      const [proyecto] = await tx.$queryRaw`
        SELECT "id", "empresaId", "estado" FROM "ProyectoConsultoria"
        WHERE "id" = ${previo.proyectoId} FOR UPDATE
      `;
      if (!proyecto || proyecto.empresaId !== previo.empresaId || proyecto.estado !== 'ACTIVO') return null;
    }

    // El registro pudo cambiar entre la primera lectura y los bloqueos.
    const [vigente] = await tx.$queryRaw`
      SELECT "id", "empresaId", "proyectoId" FROM "Evaluacion"
      WHERE "id" = ${id} FOR UPDATE
    `;
    if (!vigente || vigente.empresaId !== previo.empresaId || vigente.proyectoId !== previo.proyectoId) {
      return null;
    }
    const soporte = await tx.soporte.create({ data: {
      evaluacionId: vigente.id,
      areaId: metadata.areaId,
      subidoPorId: req.usuario.id,
      nombreOriginal: metadata.nombreOriginal,
      rutaArchivo: metadata.rutaArchivo,
      mimeTipo: 'application/pdf',
      tamanoBytes: metadata.tamanoBytes,
      fechaVencimiento: metadata.fechaVencimiento,
      estadoIA: 'NO_ANALIZADO',
      observacionIA: 'Documento pendiente de revision humana. No se ha ejecutado inteligencia artificial.',
    } });
    await tx.evaluacion.update({ where: { id: vigente.id }, data: { tieneSoportes: true } });
    return soporte;
  }, { isolationLevel: 'Serializable' });
}

async function subir(req, res) {
  try {
    if (!req.file) return res.status(400).json({ message: 'Adjunte un PDF.' });
    const evaluacion = req.evaluacionAutorizada;
    if (!evaluacion || !puedeVerEvaluacion(req.usuario, evaluacion) || req.usuario?.rol !== 'EMPRESARIO') {
      borrarTemporal(req);
      return res.status(403).json({ message: 'No autorizado.' });
    }
    if (!esPdfReal(req.file.path)) {
      borrarTemporal(req);
      return res.status(400).json({ message: 'El contenido no corresponde a un archivo PDF.' });
    }
    const { areaId, fechaVencimiento } = req.body || {};
    const areaNum = areaId ? idValido(areaId) : null;
    if (areaId && !areaNum) {
      borrarTemporal(req);
      return res.status(400).json({ message: 'Area invalida.' });
    }
    if (areaNum) {
      const area = await prisma.area.findUnique({ where: { id: areaNum } });
      if (!area) {
        borrarTemporal(req);
        return res.status(400).json({ message: 'Area inexistente.' });
      }
    }
    let fecha = null;
    if (fechaVencimiento) {
      fecha = new Date(fechaVencimiento);
      if (!Number.isFinite(fecha.getTime())) {
        borrarTemporal(req);
        return res.status(400).json({ message: 'Fecha invalida.' });
      }
    }

    let soporte;
    try {
      soporte = await crearSoporteAutorizado(req, {
        areaId: areaNum,
        nombreOriginal: path.basename(req.file.originalname).slice(0, 180),
        rutaArchivo: req.file.path,
        tamanoBytes: req.file.size,
        fechaVencimiento: fecha,
      });
    } catch (error) {
      if (error.code !== 'P2034') throw error;
      borrarTemporal(req);
      return res.status(409).json({ message: 'Conflicto de concurrencia. Vuelva a intentar la carga.' });
    }
    if (!soporte) {
      borrarTemporal(req);
      return res.status(409).json({ message: 'La representacion, la evaluacion o el estado del proyecto han cambiado. Actualice la vista.' });
    }
    return res.status(201).json(registroPublico(soporte));
  } catch (error) { borrarTemporal(req); throw error; }
}
async function listar(req, res) {
  const id = idValido(req.params.evaluacionId);
  if (!id) return res.status(400).json({ message: 'Identificador invalido.' });
  const evaluacion = await prisma.evaluacion.findUnique({ where: { id }, include: { empresa: true } });
  if (!evaluacion) return res.status(404).json({ message: 'Evaluacion no encontrada.' });
  if (!puedeVerEvaluacion(req.usuario, evaluacion)) return res.status(403).json({ message: 'No autorizado.' });
  const soportes = await prisma.soporte.findMany({
    where: { evaluacionId: id },
    orderBy: { creadoEn: 'desc' },
    include: { area: { select: { id: true, nombre: true } },
      subidoPor: { select: { id: true, nombre: true, rol: true } } },
  });
  return res.json(soportes.map(registroPublico));
}
async function descargar(req, res) {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ message: 'Identificador invalido.' });
  const soporte = await prisma.soporte.findUnique({ where: { id } });
  if (!soporte) return res.status(404).json({ message: 'Documento no encontrado.' });
  const evaluacion = await prisma.evaluacion.findUnique({ where: { id: soporte.evaluacionId }, include: { empresa: true } });
  if (!evaluacion || !puedeVerEvaluacion(req.usuario, evaluacion)) {
    return res.status(403).json({ message: 'No autorizado.' });
  }
  const descriptor = abrirDescriptorPrivado(soporte.rutaArchivo);
  if (!descriptor) return res.status(409).json({ message: 'Ruta documental invalida.' });
  let lector;
  try {
    // La ruta no vuelve a abrirse: stream recibe el fd que se verificó.
    lector = fs.createReadStream(null, { fd: descriptor.fd, autoClose: true });
  } catch (error) {
    fs.closeSync(descriptor.fd);
    throw error;
  }
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', nombreDescargaSeguro(soporte.nombreOriginal));
    res.setHeader('Content-Length', String(descriptor.size));
    // La descarga mediante descriptor no implementa las descargas parciales
    // anteriores de express.sendFile. No anunciar soporte de Range.
    res.setHeader('Accept-Ranges', 'none');
    pipeline(lector, res, error => {
      // pipeline cierra ambos streams ante error o desconexión; no intentar
      // otra respuesta JSON después de haber empezado a transmitir bytes.
      if (error && error.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error('Fallo de transmisión de soporte privado:', error.code || 'STREAM_ERROR');
      }
    });
  } catch (error) {
    // También liberar fd ante un fallo síncrono de cabeceras (p. ej. respuesta
    // ya enviada), antes de que pipeline se haya podido apropiar del lector.
    lector.destroy();
    throw error;
  }
  return res;
}
async function eliminar(req, res) {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ message: 'Identificador invalido.' });
  const soporte = await prisma.soporte.findUnique({ where: { id } });
  if (!soporte) return res.status(404).json({ message: 'Soporte no encontrado.' });
  const evaluacion = await prisma.evaluacion.findUnique({ where: { id: soporte.evaluacionId }, include: { empresa: true } });
  if (!evaluacion || !puedeVerEvaluacion(req.usuario, evaluacion) ||
      (req.usuario.rol !== 'ADMIN' && soporte.subidoPorId !== req.usuario.id)) {
    return res.status(403).json({ message: 'No autorizado.' });
  }
  // DEC-P05: ninguna cuenta (incluido ADMIN) tiene facultad para destruir soportes
  // del expediente mediante este endpoint legado. Hace falta una política de retención
  // aprobada y un proceso independiente con autorización, bitácora y tratamiento
  // de copias de seguridad. La ruta se conserva para no dar un 404 ambiguo.
  return res.status(409).json({
    message: 'Eliminación de evidencias suspendida por DEC-P05. Conserve el soporte; no existe todavía un procedimiento de eliminación autorizado.',
    codigo: 'RETENCION_PENDIENTE',
  });
}
module.exports = { subir, listar, descargar, eliminar };
