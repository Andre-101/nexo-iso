const prisma = require('../config/prisma');
const { ESTADO, AVISO, presentarEvaluacion } = require('../utils/resultadoOrientativo');
const { puedeVerEvaluacion, puedeVerEmpresa, idValido } = require('../utils/access');

async function validarAccesoEvaluacion(evaluacionId, usuario) {
  const evaluacion = await prisma.evaluacion.findUnique({
    where: { id: evaluacionId },
    include: {
      empresa: true,
      respuestas: true,
      soportes: true,
    },
  });
  if (!evaluacion) return { error: 'NO_ENCONTRADA' };

  if (!puedeVerEvaluacion(usuario, evaluacion)) return { error: 'PROHIBIDO' };

  return { evaluacion };
}

// El sistema actual no ejecuta un modelo de IA. Evitar conclusiones normativas.
function construirSugerenciaIA() {
  return 'Resultado estadistico orientativo. Un consultor debe revisar el SGSI y sus evidencias.';
}

async function listar(req, res) {
  const where = req.usuario.rol === 'ADMIN' ? {} : { empresa: { usuarioId: req.usuario.id } };
  if (req.usuario.rol === 'EVALUADOR') return res.json([]);
  const evaluaciones = await prisma.evaluacion.findMany({
    where,
    include: { empresa: true },
    orderBy: { creadaEn: 'desc' },
  });
  return res.json(evaluaciones.map(presentarEvaluacion));
}

async function iniciar(req, res) {
  const { empresaId } = req.body;
  if (!idValido(empresaId)) return res.status(400).json({ message: 'empresaId invalido.' });

  const empresa = await prisma.empresa.findUnique({ where: { id: Number(empresaId) } });
  if (!empresa) return res.status(404).json({ message: 'Empresa no encontrada.' });
  
  if (!puedeVerEmpresa(req.usuario, empresa)) {
    return res.status(403).json({ message: 'Solo puedes crear evaluaciones de tus empresas.' });
  }

  const evaluacion = await prisma.evaluacion.create({
    data: {
      empresaId: empresa.id,
      empresarioId: empresa.usuarioId,
      estado: 'BORRADOR',
    },
  });

  return res.status(201).json(evaluacion);
}

async function obtener(req, res) {
  const id = Number(req.params.id);
  const acceso = await validarAccesoEvaluacion(id, req.usuario);
  if (acceso.error === 'NO_ENCONTRADA') return res.status(404).json({ message: 'Evaluacion no encontrada.' });
  if (acceso.error === 'PROHIBIDO') return res.status(403).json({ message: 'No autorizado.' });

  const evaluacion = await prisma.evaluacion.findUnique({
    where: { id },
    include: {
      empresa: true,
      respuestas: {
        include: { pregunta: { include: { area: true } },
          actualizadaPor: { select: { id: true, nombre: true } },
          cambios: { orderBy: { creadoEn: 'asc' }, include: { autor: { select: { id: true, nombre: true } } } },
        },
      },
      soportes: true,
      informes: true,
      certificacion: true,
    },
  });
  // No exponer rutas internas de ficheros ni certificados historicos a través del detalle.
  evaluacion.soportes = (evaluacion.soportes || []).map(({ rutaArchivo, ...soporte }) => soporte);
  delete evaluacion.certificacion; // registro historico no es certificado oficial
  return res.json(presentarEvaluacion(evaluacion));
}

// Falta de infraestructura ALT implica denegación, nunca escritura sin guardia.
function errorEscrituraALT313(error, res) {
  if (['ALT307_CORTE_VIGENTE','ALT307_PROYECTO_NO_OPERABLE','P2034'].includes(error?.code))
    return res.status(409).json({ message: 'El proyecto o diagnóstico cambió. Actualice la vista.' });
  if (['ALT307_ACTOR_NO_VIGENTE','ALT307_PERMISO_ORDINARIO_NO_ACREDITADO'].includes(error?.code))
    return res.status(403).json({ message: 'No autorizado para modificar este diagnóstico.' });
  if (['ALT313_ENTRADA_INVALIDA','ALT313_PREGUNTA_INEXISTENTE','ALT313_CUESTIONARIO_VACIO',
      'ALT313_RESPUESTAS_INCONSISTENTES'].includes(error?.code))
    return res.status(400).json({ message: 'El contenido del diagnóstico no es válido.' });
  if (error?.code==='ALT313_RESPUESTAS_INCOMPLETAS')
    return res.status(409).json({ message: 'El diagnóstico tiene respuestas pendientes. Complételas antes de enviarlo.' });
  if (['ALT306_FUENTE_NO_ACREDITADA','ALT307_FUENTE_NO_ACREDITADA',
       'ALT307_CANDADO_NO_ACREDITADO','ALT313_FUENTE_NO_ACREDITADA',
       'P2021','P2022','P1001'].includes(error?.code))
    return res.status(503).json({ message: 'Control ALT no disponible. No se guardó el diagnóstico.' });
  throw error;
}

function errorComentarioALT314(error, res) {
  if (['ALT307_CORTE_VIGENTE','ALT307_PROYECTO_NO_OPERABLE','P2034'].includes(error?.code))
    return res.status(409).json({message:'El proyecto cambió o está restringido. Actualice la vista.'});
  if (['ALT307_ACTOR_NO_VIGENTE','ALT307_PERMISO_ORDINARIO_NO_ACREDITADO'].includes(error?.code))
    return res.status(403).json({message:'No autorizado para revisar este diagnóstico.'});
  if (['ALT314_ENTRADA_INVALIDA','ALT314_RESPUESTA_INEXISTENTE'].includes(error?.code))
    return res.status(400).json({message:'Los comentarios contienen preguntas o valores inválidos.'});
  if (['ALT306_FUENTE_NO_ACREDITADA','ALT307_FUENTE_NO_ACREDITADA',
       'ALT307_CANDADO_NO_ACREDITADO','ALT314_FUENTE_NO_ACREDITADA',
       'P2021','P2022','P1001'].includes(error?.code))
    return res.status(503).json({message:'Control ALT no disponible. No se modificaron los comentarios.'});
  throw error;
}

async function guardarRespuestas(req, res) {
  const id = Number(req.params.id);
  const acceso = await validarAccesoEvaluacion(id, req.usuario);
  if (acceso.error === 'NO_ENCONTRADA') return res.status(404).json({ message: 'Evaluacion no encontrada.' });
  if (acceso.error === 'PROHIBIDO') return res.status(403).json({ message: 'No autorizado.' });

  if (req.usuario.rol !== 'EMPRESARIO') {
    return res.status(403).json({ message: 'Solo EMPRESARIO puede responder.' });
  }

  if (acceso.evaluacion.estado !== 'BORRADOR') {
    return res.status(409).json({ message: 'La evaluacion ya fue enviada y no admite cambios en las respuestas.' });
  }

  const { respuestas } = req.body;
  if (!Array.isArray(respuestas) || respuestas.length === 0) {
    return res.status(400).json({ message: 'Debes enviar una lista de respuestas.' });
  }

  const ids = respuestas.map((item) => idValido(item.preguntaId));
  if (ids.some((id) => id === null) || new Set(ids).size !== ids.length ||
      respuestas.some((item) => !Number.isInteger(item.valor) || item.valor < 0 || item.valor > 5 ||
        (item.comentario !== undefined && typeof item.comentario !== 'string'))) {
    return res.status(400).json({ message: 'Identificadores unicos y valores enteros entre 0 y 5 requeridos.' });
  }
  // ALT313: diagnósticos vinculados a proyecto usan un candado compartido con
  // el corte ALT306 y revalidan representante/estado después de adquirirlo.
  if (acceso.evaluacion.proyectoId) {
    try {
      const { guardarRespuestasProyectoALT } = require('../services/alt-respuestas-envio-313');
      const resultado = await guardarRespuestasProyectoALT({
        db: prisma, proyectoId: acceso.evaluacion.proyectoId, actorId: req.usuario.id,
        diagnosticoId: id, respuestas: respuestas.map(r => ({
          preguntaId: Number(r.preguntaId), valor: r.valor, ...(r.comentario === undefined ? {} : { comentario: r.comentario }),
        })),
      });
      return res.json({ message: resultado.message });
    } catch (error) { return errorEscrituraALT313(error, res); }
  }
  const preguntasExistentes = await prisma.pregunta.count({ where: { id: { in: ids } } });
  if (preguntasExistentes !== ids.length) return res.status(400).json({ message: 'Una o mas preguntas no existen.' });

  const guardado = await prisma.$transaction(async (tx) => {
    // Q-59: confirmar dentro de la transacción que el usuario continúa siendo
    // representante. La actualización condicional serializa cambios con SOL-28.
    const representa = await tx.empresa.updateMany({
      where: { id: acceso.evaluacion.empresaId, usuarioId: req.usuario.id },
      data: { usuarioId: req.usuario.id },
    });
    if (!representa.count) throw new Error('REPRESENTACION_CAMBIADA');
    if (acceso.evaluacion.proyectoId) {
      const proyecto = await tx.proyectoConsultoria.findUnique({
        where: { id: acceso.evaluacion.proyectoId }, select: { estado: true, empresaId: true },
      });
      if (!proyecto || proyecto.estado !== 'ACTIVO' || proyecto.empresaId !== acceso.evaluacion.empresaId)
        throw new Error('PROYECTO_NO_ACTIVO');
    }
    const lock = await tx.evaluacion.updateMany({
      where: { id, estado: 'BORRADOR', empresaId: acceso.evaluacion.empresaId }, data: { estado: 'BORRADOR' },
    });
    if (!lock.count) throw new Error('EVALUACION_BLOQUEADA');
    // Un reenvío idéntico no crea una revisión falsa.
    for (const item of respuestas) {
      const where = { evaluacionId_preguntaId: { evaluacionId: id, preguntaId: item.preguntaId } };
      const anterior = await tx.respuesta.findUnique({ where });
      const comentarioNuevo = item.comentario?.trim() || null;
      if (anterior && anterior.valor === item.valor && (anterior.comentario || null) === comentarioNuevo) continue;
      const guardada = await tx.respuesta.upsert({
        where, update: { valor: item.valor, comentario: comentarioNuevo, actualizadaPorId: req.usuario.id },
        create: { evaluacionId: id, preguntaId: item.preguntaId, valor: item.valor,
          comentario: comentarioNuevo, actualizadaPorId: req.usuario.id },
      });
      await tx.cambioRespuestaDiagnostico.create({ data: {
        respuestaId: guardada.id, autorId: req.usuario.id,
        valorAnterior: anterior?.valor ?? null, comentarioAnterior: anterior?.comentario ?? null,
        valorNuevo: item.valor, comentarioNuevo,
      } });
    }
    return true;
  }, { isolationLevel: 'Serializable' }).catch((error) => {
    if (['EVALUACION_BLOQUEADA','REPRESENTACION_CAMBIADA','PROYECTO_NO_ACTIVO'].includes(error.message)) return null;
    if (error.code === 'P2034') return null;
    throw error;
  });
  if (!guardado) return res.status(409).json({ message: 'El diagnóstico fue enviado o cambió su representante. Actualice la vista.' });
  return res.json({ message: 'Respuestas guardadas correctamente.' });
}

async function enviar(req, res) {
  const id = Number(req.params.id);
  const acceso = await validarAccesoEvaluacion(id, req.usuario);
  if (acceso.error === 'NO_ENCONTRADA') return res.status(404).json({ message: 'Evaluacion no encontrada.' });
  if (acceso.error === 'PROHIBIDO') return res.status(403).json({ message: 'No autorizado.' });

  if (req.usuario.rol !== 'EMPRESARIO') {
    return res.status(403).json({ message: 'Solo EMPRESARIO puede enviar la evaluacion.' });
  }

  if (acceso.evaluacion.estado !== 'BORRADOR') {
    return res.status(409).json({ message: 'La evaluacion ya fue enviada.' });
  }

  if (acceso.evaluacion.proyectoId) {
    try {
      const { enviarDiagnosticoProyectoALT } = require('../services/alt-respuestas-envio-313');
      const resultado = await enviarDiagnosticoProyectoALT({
        db: prisma, proyectoId: acceso.evaluacion.proyectoId, actorId: req.usuario.id, diagnosticoId: id,
      });
      return res.json(resultado);
    } catch (error) { return errorEscrituraALT313(error, res); }
  }

  const resultado = await prisma.$transaction(async (tx) => {
    // Q-59: el antiguo representante no puede enviar un borrador después de la sustitución.
    const representa = await tx.empresa.updateMany({
      where: { id: acceso.evaluacion.empresaId, usuarioId: req.usuario.id },
      data: { usuarioId: req.usuario.id },
    });
    if (!representa.count) return { status: 409, message: 'Representante cambiado. Vuelva a cargar el diagnóstico.' };
    if (acceso.evaluacion.proyectoId) {
      const proyecto = await tx.proyectoConsultoria.findUnique({
        where: { id: acceso.evaluacion.proyectoId }, select: { estado: true, empresaId: true },
      });
      if (!proyecto || proyecto.estado !== 'ACTIVO' || proyecto.empresaId !== acceso.evaluacion.empresaId)
        return { status: 409, message: 'No se puede enviar un diagnóstico de un proyecto inactivo.' };
    }
    // Serializar el envio con la edicion de respuestas sobre la misma fila.
    const lock = await tx.evaluacion.updateMany({
      where: { id, estado: 'BORRADOR' }, data: { estado: 'BORRADOR' },
    });
    if (!lock.count) return { status: 409, message: 'La evaluacion ya fue enviada.' };
    const preguntasTotales = await tx.pregunta.count();
    if (!preguntasTotales) return { status: 400, message: 'El cuestionario esta vacio.' };
    const respuestas = await tx.respuesta.findMany({ where: { evaluacionId: id } });
    if (respuestas.length !== preguntasTotales) {
      return { status: 400, message: `Faltan respuestas. ${respuestas.length}/${preguntasTotales} preguntas respondidas.` };
    }
    const suma = respuestas.reduce((acc, r) => acc + r.valor, 0);
    const puntajePromedio = Number((suma / respuestas.length).toFixed(2));
    const tieneSoportes = (await tx.soporte.count({ where: { evaluacionId: id } })) > 0;
    const evaluacion = await tx.evaluacion.update({
      where: { id },
      data: {
        estado: 'ENVIADA', puntajePromedio, dictamen: null,
        prioritaria: false, requiereSoportes: false,
        tieneSoportes,
        mensajeDecision: AVISO,
        enviadaEn: new Date(),
      },
    });
    return {
      evaluacion: presentarEvaluacion(evaluacion),
      decision: {
        puedeEscalar: false,
        estadoValidacionCriterios: ESTADO,
        mensaje: 'Autodiagnostico recibido; requiere revision profesional.',
        sugerenciaIA: construirSugerenciaIA(),
      },
    };
  }, { isolationLevel: 'Serializable' }).catch((error) => {
    if (error.code === 'P2034') return { status: 409, message: 'Conflicto de concurrencia. Actualice el diagnóstico.' };
    throw error;
  });
  if (resultado.status) return res.status(resultado.status).json({ message: resultado.message });
  return res.json(resultado);
}

async function resumen(req, res) {
  const id = Number(req.params.id);
  const acceso = await validarAccesoEvaluacion(id, req.usuario);
  if (acceso.error === 'NO_ENCONTRADA') return res.status(404).json({ message: 'Evaluacion no encontrada.' });
  if (acceso.error === 'PROHIBIDO') return res.status(403).json({ message: 'No autorizado.' });

  const porArea = await prisma.area.findMany({
    orderBy: { orden: 'asc' },
    include: {
      preguntas: {
        include: {
          respuestas: {
            where: { evaluacionId: id },
          },
        },
      },
    },
  });

  const resumenAreas = porArea.map((area) => {
    const valores = area.preguntas.flatMap((p) => p.respuestas.map((r) => r.valor));
    const promedio = valores.length
      ? Number((valores.reduce((acc, v) => acc + v, 0) / valores.length).toFixed(2))
      : null;
    return {
      areaId: area.id,
      nombre: area.nombre,
      promedio,
      respuestas: valores.length,
    };
  });

  return res.json({
    evaluacionId: id,
    puntajePromedio: acceso.evaluacion.puntajePromedio,
    dictamen: null,
    mensajeDecision: AVISO,
    estadoValidacionCriterios: ESTADO,
    resultadoOrientativo: true,
    tieneClasificacionHistoricaNoValidada: Boolean(acceso.evaluacion.dictamen),
    resumenAreas,
  });
}

async function comentarPorPregunta(req, res) {
  const id = Number(req.params.id);
  const acceso = await validarAccesoEvaluacion(id, req.usuario);
  if (acceso.error === 'NO_ENCONTRADA') return res.status(404).json({ message: 'Evaluacion no encontrada.' });
  if (acceso.error === 'PROHIBIDO') return res.status(403).json({ message: 'No autorizado.' });
  if (!['EVALUADOR', 'ADMIN'].includes(req.usuario.rol)) {
    return res.status(403).json({ message: 'Solo EVALUADOR o ADMIN puede comentar.' });
  }

  const { comentarios } = req.body;
  if (!Array.isArray(comentarios) || comentarios.length === 0) {
    return res.status(400).json({ message: 'Debes enviar una lista de comentarios.' });
  }

  // ALT314: los diagnósticos de proyectos requieren candado ALT y escritura
  // atómica. La ruta histórica sin proyecto conserva su contrato anterior.
  if (acceso.evaluacion.proyectoId) {
    try {
      const {comentarDiagnosticoProyectoALT}=require('../services/alt-comentarios-admin-314');
      const resultado=await comentarDiagnosticoProyectoALT({db:prisma,
        proyectoId:acceso.evaluacion.proyectoId, actorId:req.usuario.id,
        diagnosticoId:id, comentarios});
      return res.json({message:'Comentarios del evaluador guardados.',cambios:resultado.cambios});
    } catch(error) { return errorComentarioALT314(error,res); }
  }

  for (const item of comentarios) {
    if (!item.preguntaId) {
      return res.status(400).json({ message: 'Cada comentario requiere preguntaId.' });
    }
    const respuesta = await prisma.respuesta.findUnique({
      where: {
        evaluacionId_preguntaId: { evaluacionId: id, preguntaId: Number(item.preguntaId) },
      },
    });
    if (!respuesta) {
      return res.status(400).json({ message: `La pregunta ${item.preguntaId} no tiene respuesta del empresario.` });
    }
    await prisma.respuesta.update({
      where: {
        evaluacionId_preguntaId: { evaluacionId: id, preguntaId: Number(item.preguntaId) },
      },
      data: { comentarioEvaluador: item.comentarioEvaluador || null },
    });
  }

  await prisma.evaluacion.update({
    where: { id },
    data: { estado: 'EN_REVISION' },
  });

  return res.json({ message: 'Comentarios del evaluador guardados.' });
}

module.exports = { listar, iniciar, obtener, guardarRespuestas, enviar, resumen, comentarPorPregunta };
