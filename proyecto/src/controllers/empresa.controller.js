const prisma = require('../config/prisma');
const { puedeVerEmpresa } = require('../utils/access');
const proveedorRegistral = require('../services/proveedor-registral-ficticio');
const { normalizarNit, planVinculacion, referenciaSuficiente } = require('../utils/registro-empresarial');
const reconsultaRegistral = require('../services/reconsulta-registral');
const {tomarCandadoPrisma330}=require('../utils/candado-prisma-330');

function vistaEmpresa(empresa,rol) {
  if(rol==='ADMIN') return empresa;
  // La referencia de las fuentes alternativas y las constancias internas no se exponen a clientes.
  const {id,nombre,nit,sector,tamano,estado,origenDatos,revisionPendiente}=empresa;
  return {id,nombre,nit,sector,tamano,estado,origenDatos,revisionPendiente};
}
function generarSugerenciaEmpresa(empresa) {
  if (empresa.estado === 'APROBADA') {
    return 'Empresa habilitada para iniciar el diagnostico de preparacion ISO 27001.';
  }
  if (empresa.estado === 'RECHAZADA') {
    return empresa.observacionAdmin
      ? `IA: ${empresa.observacionAdmin}`
      : 'IA: Revisión fallida. Verifique NIT/RUT, sector y documentación antes de volver a enviar.';
  }
  return 'IA: Empresa pendiente de revisión administrativa.';
}

async function listar(req, res) {
  const where = req.usuario.rol === 'ADMIN' ? {} : { usuarioId: req.usuario.id };
  if (req.usuario.rol === 'EVALUADOR') return res.json([]);
  const data = await prisma.empresa.findMany({
    where,
    orderBy: { creadaEn: 'desc' },
  });
  return res.json(data.map(empresa=>vistaEmpresa(empresa,req.usuario.rol)));
}

async function obtener(req, res) {
  const id = Number(req.params.id);
  const empresa = await prisma.empresa.findUnique({ where: { id } });
  if (!empresa) return res.status(404).json({ message: 'Empresa no encontrada.' });

  if (!puedeVerEmpresa(req.usuario, empresa)) {
    return res.status(403).json({ message: 'No autorizado.' });
  }

  return res.json(vistaEmpresa(empresa,req.usuario.rol));
}

/**
 * Vinculación de representante por NIT. No existe alta independiente de empresa
 * ni botón de habilitación manual: la verificación de origen o la constancia
 * excepcional de ADMIN se registran en la MISMA operación de vinculación.
 * El catálogo local es explícitamente FICTICIO.
 */
async function crear(req, res) {
  const { nit, usuarioId, constanciaRepresentacion, datosProvisionales, referenciaExterna } = req.body || {};
  const representanteId = Number(usuarioId);
  const nitNormalizado = normalizarNit(nit);
  if (!Number.isSafeInteger(representanteId) || representanteId <= 0 || !nitNormalizado)
    return res.status(400).json({message:'Se requieren representante y NIT válidos.'});
  const mode=require('../utils/data-mode').dataMode();
  if(mode==='demo'&&!/^SIM-[0-9]{4}$/.test(nitNormalizado))return res.status(400).json({message:'En demostración utilice solo identificadores SIM-* ficticios.'});
  if(mode==='production'&&!/^[0-9]{6,12}(?:-[0-9])?$/.test(nitNormalizado))return res.status(400).json({message:'En proveedores reales se requiere NIT numérico colombiano; no se admiten identificadores SIM-*.'});
  if (!referenciaSuficiente(constanciaRepresentacion))
    return res.status(400).json({message:'Constancia de autorización del representante requerida (SOL-44).'});
  // La entrada del cliente no puede alterar un dato obtenido del catálogo.
  if (['nombre','sector','tamano','estado','datosFuente','origenDatos'].some(c=>Object.hasOwn(req.body || {},c)))
    return res.status(400).json({message:'Los datos registrales no pueden proporcionarse como campos editables.'});
  const consulta=await proveedorRegistral.consultar(nitNormalizado);
  const plan=planVinculacion({nit:nitNormalizado,consulta,datosProvisionales,referenciaExterna});
  if(plan.error) return res.status(422).json({message:'Datos provisionales o sustento insuficientes.',codigo:plan.error,codigoConsulta:plan.codigoConsulta});
  try {
    const resultado=await prisma.$transaction(async tx=>{
      await tomarCandadoPrisma330(tx,'IDENTIDAD',representanteId);
      const representante=await tx.usuario.findUnique({where:{id:representanteId},select:{id:true,activo:true,rol:true}});
      if(!representante || !representante.activo || representante.rol!=='EMPRESARIO')
        return {status:400,message:'Representante no válido.'};
      if(await tx.empresa.count({where:{usuarioId:representanteId}}))
        return {status:409,message:'Esta persona ya representa otra empresa (SOL-42).'};
      if(await tx.empresa.findUnique({where:{nit:nitNormalizado},select:{id:true}}))
        return {status:409,message:'Ya existe una vinculación empresarial con ese NIT.'};
      const empresa=await tx.empresa.create({data:{
        nombre:plan.nombre,nit:plan.nit,sector:plan.sector,tamano:plan.tamano,
        usuarioId:representanteId,estado:plan.estadoEmpresa,
        origenDatos:plan.estado,
        ...(plan.fuente?{datosFuente:plan.fuente}:{}),
        ...(plan.manual?{datosManual:plan.manual}:{}),
        referenciaManual:plan.manual?referenciaExterna.trim():null,
        constanciaRepresentacion:constanciaRepresentacion.trim(),
        codigoConsulta:plan.codigoConsulta,consultadaEn:new Date(),
        revisionPendiente:plan.estado==='ADMIN_PROVISIONAL',
        revisadaPorAdminId:plan.manual?req.usuario.id:null,
        bloqueoNuevosProyectos:false,huellaDecisionFuente:plan.huellaDecisionFuente||null,
      }});
      await tx.eventoConsultaEmpresa.create({data:{
        empresaId:empresa.id,actorAdminId:req.usuario.id,
        tipo:plan.estado==='FUENTE'?'VINCULO_CON_FUENTE':
          plan.estado==='ADMIN_CONCILIADO'?'VINCULO_DIFERENCIA_REVISADA_ADMIN':'VINCULO_PROVISIONAL_ADMIN',
        codigo:plan.codigoConsulta,
        ...(plan.diferencias?{diferencias:plan.diferencias}:{}),
        ...(plan.manual?{datosManual:plan.manual,referenciaManual:referenciaExterna.trim()}:{}),
      }});
      return {status:201,empresa};
    },{isolationLevel:'ReadCommitted'});
    if(resultado.status!==201) return res.status(resultado.status).json({message:resultado.message});
    return res.status(201).json(resultado.empresa);
  }catch(e){
    if(e.code==='CANDADO_330_NO_ACREDITADO') return res.status(503).json({message:'Control de identidad no disponible.',codigo:e.code});
    if(e.code==='P2002') return res.status(409).json({message:'El NIT o su representante ya están vinculados.'});
    if(e.code==='P2034') return res.status(409).json({message:'Conflicto concurrente: reintente.'});
    throw e;
  }
}

// F3-ANA-238: el control visual previo no autoriza una escritura posterior.
// La condición usuarioId forma parte de la sentencia SQL de UPDATE para impedir
// que el representante anterior edite después de una sustitución Q58.
// Prisma 5 admite predicados escalares adicionales junto a la clave única `id`.
async function actualizar(req, res) {
  // REQ-21 / SOL-43: el perfil registral no es un formulario libre.
  // Las rectificaciones se tramitan exclusivamente con conciliación trazada.
  return res.status(409).json({
    message:'Los datos registrales no son editables. Utilice la conciliación documentada.',
    codigo:'DATOS_REGISTRALES_SOLO_LECTURA',
  });
}

/** F3-ANA-336. Supresión excepcional de una empresa sin antecedentes.
 * Leer el representante inicial solo sirve para determinar la llave IDENTIDAD;
 * la decisión y la eliminación se toman dentro de la MISMA transacción.
 * Orden de candados: IDENTIDAD -> EMPRESA, compatible con Q58.
 */
async function eliminar(req, res) {
  const id = Number(req.params.id);
  if(!Number.isSafeInteger(id) || id <= 0 || id > 2147483647)
    return res.status(400).json({message:'Identificador de empresa inválido.'});
  try {
    const resultado = await prisma.$transaction(async tx => {
      const inicial = await tx.empresa.findUnique({where:{id},select:{id:true,usuarioId:true}});
      if(!inicial) return {status:404,message:'Empresa no encontrada.'};
      // Nunca adquirir EMPRESA antes de IDENTIDAD: Q58 comparte este orden.
      await tomarCandadoPrisma330(tx,'IDENTIDAD',inicial.usuarioId);
      await tomarCandadoPrisma330(tx,'EMPRESA',id);
      const empresa = await tx.empresa.findUnique({where:{id}});
      if(!empresa) return {status:404,message:'Empresa no encontrada.'};
      if(empresa.usuarioId !== inicial.usuarioId)
        return {status:409,message:'La representación cambió. Actualice los datos e inténtelo de nuevo.'};
      if(!puedeVerEmpresa(req.usuario,empresa))
        return {status:403,message:'No autorizado.'};
      if(await tx.eventoConsultaEmpresa.count({where:{empresaId:id}}))
        return {status:409,message:'La empresa posee historial de consulta registral y no puede eliminarse.'};
      if(await tx.eventoRepresentacionEmpresa.count({where:{empresaId:id}}))
        return {status:409,message:'La empresa posee historial de representación y no puede eliminarse.'};
      if(await tx.proyectoConsultoria.count({where:{empresaId:id}}))
        return {status:409,message:'La empresa tiene proyectos; preservar historial.'};
      if(await tx.evaluacion.count({where:{empresaId:id}}))
        return {status:409,message:'La empresa tiene evaluaciones; preservar historial.'};
      // Condición sobre la misma FK validada para impedir borrar otra representación.
      const eliminado=await tx.empresa.deleteMany({where:{id,usuarioId:inicial.usuarioId}});
      if(eliminado.count!==1)
        return {status:409,message:'La empresa cambió durante la operación. Reintente.'};
      return {status:200,message:'Empresa eliminada.'};
    },{isolationLevel:'Serializable'});
    return res.status(resultado.status).json({message:resultado.message});
  }catch(error){
    if(error.code==='CANDADO_330_NO_ACREDITADO')
      return res.status(503).json({message:'Control de empresa no disponible.',codigo:error.code});
    if(['P2003','P2014','P2025','P2034'].includes(error.code))
      return res.status(409).json({message:'La empresa tiene referencias o cambios concurrentes; conservar expediente.'});
    throw error;
  }
}

async function aprobarEmpresa(req, res) {
  return res.status(410).json({
    message:'No existe habilitación manual separada. La verificación se registra al vincular al representante.',
    codigo:'FLUJO_HABILITACION_RETIRADO',
  });
}

/** Bandeja registral personal, sin lectura al listar. Lectura automática al abrir detalle. */
async function listarAvisosRegistrales(req,res) {
  const avisos=await prisma.eventoConsultaEmpresa.findMany({
    where:{destinatarioAdminId:req.usuario.id,tipo:'CAMBIO_ERROR_CONSULTA_BAJA_PRIORIDAD'},
    select:{id:true,empresaId:true,tipo:true,codigo:true,prioridad:true,leidaEn:true,registradaEn:true},
    orderBy:{registradaEn:'desc'},take:100,
  });
  res.set('Cache-Control','private, no-store');
  return res.json(avisos);
}
async function abrirAvisoRegistral(req,res) {
  const avisoId=Number(req.params.avisoId);
  if(!Number.isSafeInteger(avisoId)||avisoId<=0) return res.status(400).json({message:'Aviso inválido.'});
  const resultado=await prisma.$transaction(async tx=>{
    const aviso=await tx.eventoConsultaEmpresa.findFirst({where:{id:avisoId,
      destinatarioAdminId:req.usuario.id,tipo:'CAMBIO_ERROR_CONSULTA_BAJA_PRIORIDAD'},
      select:{id:true,empresaId:true,tipo:true,codigo:true,prioridad:true,leidaEn:true,registradaEn:true}});
    if(!aviso) return null;
    if(!aviso.leidaEn) {
      const fecha=new Date();
      await tx.eventoConsultaEmpresa.updateMany({where:{id:avisoId,
        destinatarioAdminId:req.usuario.id,leidaEn:null},data:{leidaEn:fecha}});
      aviso.leidaEn=fecha;
    }
    return aviso;
  },{isolationLevel:'ReadCommitted'});
  if(!resultado) return res.status(404).json({message:'Aviso no encontrado.'});
  res.set('Cache-Control','private, no-store');
  return res.json(resultado);
}

/** Operación excepcional de resolución de diferencias, NO habilitación de empresas. */
async function conciliarDatos(req,res) {
  const empresaId=Number(req.params.id);
  if(!Number.isSafeInteger(empresaId)||empresaId<=0) return res.status(400).json({message:'ID inválido.'});
  const resultado=await reconsultaRegistral.conciliar(prisma,{
    empresaId,adminId:req.usuario.id,eleccion:req.body?.eleccion,motivo:req.body?.motivo,
  });
  return res.status(resultado.status).json(resultado);
}

// DEC-Q58/Q64 / SOL-28: la sustitución no reescribe autorías ni destinatarios históricos.
// Se serializa con cambios de fecha (Q-57) utilizando la misma llave por empresa.
async function sustituirRepresentante(req, res, next) {
  const empresaId = Number(req.params.id);
  const nuevoId = Number(req.body?.representanteNuevoId);
  const anteriorId = Number(req.body?.representanteAnteriorId);
  const motivo = req.body?.motivo;
  const constancia = req.body?.constanciaValidacion;
  const idOK = id => Number.isSafeInteger(id) && id > 0;
  const textoOK = value => typeof value === 'string' && value.trim().length >= 10 && value.trim().length <= 2000;
  if (!idOK(empresaId) || !idOK(nuevoId) || !idOK(anteriorId) || !textoOK(motivo) || !textoOK(constancia) || req.body?.representacionVerificada !== true)
    return res.status(400).json({ message: 'Empresa, representantes, motivo, constancia y confirmación de verificación obligatorios.' });
  if (nuevoId === anteriorId) return res.status(409).json({ message: 'El nuevo representante debe ser distinto del actual.' });
  try {
    const result = await prisma.$transaction(async tx => {
      // Orden fijo: primero identidad candidata, luego empresa. Evita designación concurrente en dos empresas.
      await tomarCandadoPrisma330(tx,'IDENTIDAD',nuevoId);
      await tomarCandadoPrisma330(tx,'EMPRESA',empresaId);
      const empresa = await tx.empresa.findUnique({ where: { id: empresaId }, select: { id: true, nombre: true, usuarioId: true } });
      if (!empresa) return { status: 404, message: 'Empresa no encontrada.' };
      if (empresa.usuarioId !== anteriorId) return { status: 409, message: 'La representación cambió. Actualice el listado antes de continuar.' };
      const candidato = await tx.usuario.findUnique({ where: { id: nuevoId }, select: { rol: true, activo: true } });
      if (!candidato || !candidato.activo || candidato.rol !== 'EMPRESARIO')
        return { status: 409, message: 'El nuevo representante debe tener una cuenta activa de empresa.' };
      // SOL-42: no representar dos empresas simultáneamente.
      if (await tx.empresa.count({ where: { usuarioId: nuevoId } }))
        return { status: 409, message: 'El candidato ya representa otra empresa.' };
      const projects = await tx.proyectoConsultoria.findMany({ where: { empresaId }, select: { id: true } });
      const projectIds = projects.map(x => x.id);
      const pendientes = projectIds.length ? await tx.notificacionProyecto.findMany({
        where: { proyectoId: { in: projectIds }, destinatarioId: anteriorId, leidaEn: null,
          tipo: { in: ['CAMBIO_FECHA_OBJETIVO', 'TERMINACION_ANTICIPADA_ABANDONO'] } },
        orderBy: { id: 'asc' },
      }) : [];
      const evento = await tx.eventoRepresentacionEmpresa.create({ data: {
        empresaId, adminId: req.usuario.id, representanteAnteriorId: anteriorId, representanteNuevoId: nuevoId,
        motivo: motivo.trim(), constanciaValidacion: constancia.trim(),
      } });
      // No se tocan documentos, autores ni avisos históricos. La nueva identidad
      // recibe acceso por Empresa.usuarioId, no por herencia de token.
      await tx.empresa.update({ where: { id: empresaId }, data: { usuarioId: nuevoId } });
      // Las tareas empresariales activas necesitan responsable operativo actual.
      // No se alteran tareas completadas/canceladas ni versiones o aportantes históricos.
      const actividades = projectIds.length ? await tx.actividadProyecto.updateMany({ where: {
        proyectoId: { in: projectIds }, tipoResponsable: 'CLIENTE', asignadoAId: anteriorId,
        estado: { notIn: ['COMPLETADA', 'CANCELADA'] },
      }, data: { asignadoAId: nuevoId } }) : { count: 0 };
      for (const n of pendientes) {
        // Q-64: un aviso de terminación conserva la referencia única al evento
        // únicamente en el ORIGINAL; la copia se enlaza por origenNotificacionId.
        // No se genera una segunda terminación ni se replica su constancia.
        await tx.notificacionProyecto.create({ data: {
          proyectoId: n.proyectoId, actividadId: n.actividadId, destinatarioId: nuevoId,
          tipo: n.tipo, fechaAnterior: n.fechaAnterior, fechaNueva: n.fechaNueva,
          justificacion: n.justificacion, origenNotificacionId: n.id, cambioRepresentacionId: evento.id,
        } });
      }
      return { status: 200, empresaId, representanteAnteriorId: anteriorId, representanteNuevoId: nuevoId,
        avisosReemitidos: pendientes.length, actividadesReasignadas: actividades.count, eventoId: evento.id };
    }, { isolationLevel: 'Serializable' });
    return res.status(result.status).json(result.status === 200 ? result : { message: result.message });
  } catch (error) {
    if (error.code === 'CANDADO_330_NO_ACREDITADO')
      return res.status(503).json({ message: 'Control de representación no disponible.', codigo: error.code });
    if (['P2034','P2002','P2003'].includes(error.code))
      return res.status(409).json({ message: 'Conflicto en la representación. Actualiza los datos e inténtalo de nuevo.' });
    return next(error);
  }
}

module.exports = { listar, obtener, crear, actualizar, eliminar, aprobarEmpresa, conciliarDatos, listarAvisosRegistrales, abrirAvisoRegistral, sustituirRepresentante };
