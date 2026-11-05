/**
 * Orquestación G3 de análisis documental asistido por IA.
 * Invariantes: autorización del cliente por versión vigente, activación explícita,
 * límite de uso, extracción íntegra, validación de citas y revisión humana.
 * Los brazos G4.x/G5 son experimentos aislados; no se equiparan a conformidad.
 * @see ../../../docs/06-seguridad/ia-y-privacidad.md
 */
'use strict';
const prisma=require('../config/prisma');
const tomarCandadoPrisma330=(tx,espacio,id)=>require('../utils/candado-prisma-330').tomarCandadoPrisma330(tx,espacio,id);
const {autorizar}=require('../utils/proyecto-acceso');
const {idValido}=require('../utils/access');
const g3=require('../utils/g3-analisis');
const provider=require('../utils/proveedor-ia-348');
const MENSAJES_DOCUMENTO={
 PDF_SUPERA_LIMITE_PAGINAS:'El PDF tiene mas de 12 paginas. No se analizo parcialmente. Divida o reduzca el documento y solicite un nuevo analisis.',
 PDF_TEXTO_EXCEDE_LIMITE:'El PDF contiene mas texto del que puede analizarse de forma completa. Reduzca el alcance del documento y vuelva a intentar.',
 PDF_PAGINAS_INVALIDAS:'No fue posible determinar el numero de paginas del PDF.',
 PDF_INSPECCION_FALLIDA:'No fue posible inspeccionar la estructura del PDF.',
 PDF_POPPLER_NO_DISPONIBLE:'Motor de extracción PDF no instalado o inaccesible en este servidor.'
};
const fail=(res,status,message)=>res.status(status).json({message:MENSAJES_DOCUMENTO[message]||message,code:message});
// Las autorizaciones históricas sin proveedor explícito no habilitan transferencias posteriores.
async function authorizationMatches(db,projectId,permission,versionId){
 if(!permission||permission.revocadoEn)return false;
 const record=await db.eventoProyecto.findFirst({where:{proyectoId:projectId,accion:'IA_AUTORIZACION',
   detalle:{path:['versionId'],equals:versionId}},orderBy:{id:'desc'},select:{detalle:true}});
 const config=provider.estado();
 return Boolean(record?.detalle?.autorizacionId===permission.id && record.detalle.proveedor===config.proveedor &&
   record.detalle.modelo===config.modelo && record.detalle.externo===config.externo &&
   (!config.externo || config.transferenciaHabilitada));
}
async function configuration(req,res){const access=await autorizar(req,res);if(!access)return;return res.json(provider.estado());}
const isConflict=e=>['P2002','P2003','P2034'].includes(e?.code);
async function log(tx,req,project,action,details){await tx.eventoProyecto.create({data:{proyectoId:project,usuarioId:req.usuario.id,accion:action,detalle:details}});}
async function versionOf(project,vid){return prisma.documentoVersionProyecto.findFirst({where:{id:idValido(vid)||-1,proyectoId:project},include:{entregable:{select:{versionActual:true,actividadId:true}}}});}
// No basta el permiso al comienzo de la petición: la asignación se puede
// retirar mientras Ollama está procesando o antes de guardar una revisión.
async function consultorVigente(db,proyectoId,usuarioId){
  return Boolean(await db.participacionConsultor.findFirst({where:{
    proyectoId,usuarioId,activo:true,usuario:{activo:true,rol:'EVALUADOR'}
  },select:{id:true}}));
}
async function alcanceDocumentoVigente(db,proyectoId,v){
  const act=await db.actividadProyecto.findFirst({where:{id:v.entregable.actividadId,proyectoId},
    select:{cobertura:true,acuerdoAdicionalId:true}});
  if (!act) return false;
  if(act.cobertura!=='ADICIONAL')return true;
  return Boolean(await db.acuerdoAdicionalProyecto.findFirst({where:{id:act.acuerdoAdicionalId,proyectoId,estado:'HABILITADO'},select:{id:true}}));
}
// F3-ANA-342: La revocación/otorgamiento no puede competir con la
// publicación IA que usa el candado PROYECTO. El representante se revalida
// dentro de la misma transacción, sin confiar en autorizar() pretransaccional.
async function representanteIAEnTransaccion(tx,proyectoId,usuarioId){
  const proyecto=await tx.proyectoConsultoria.findUnique({
    where:{id:proyectoId},select:{id:true,estado:true,iaEstado:true,
      empresa:{select:{usuarioId:true}}}
  });
  if(!proyecto || proyecto.estado!=='ACTIVO' || proyecto.empresa?.usuarioId!==usuarioId) return null;
  const usuario=await tx.usuario.findUnique({where:{id:usuarioId},select:{activo:true,rol:true}});
  if(!usuario?.activo || usuario.rol!=='EMPRESARIO') return null;
  return proyecto;
}
async function requireCurrent(req,res,access){
  const v=await versionOf(access.proyecto.id,req.params.versionId);
  if(!v)return fail(res,404,'Version no encontrada.');
  if(v.numero!==v.entregable.versionActual){fail(res,409,'Debe utilizar la version documental actual.');return null;}
  return v;
}
async function permissions(req,res){
  const access=await autorizar(req,res);if(!access)return;
  const v=await versionOf(access.proyecto.id,req.params.versionId);
  if(!v)return fail(res,404,'Version no encontrada.');
  // DEC-IA70-07-R: ADMIN y representante no reciben finalidad ni clasificación
  // libre de documentos (pueden contener contexto reservado). Solo estado mínimo.
  const perm=await prisma.autorizacionDocumentoIA.findUnique({where:{versionId:v.id},
    select:{id:true,autorizadoEn:true,revocadoEn:true}});
  const vigente=await authorizationMatches(prisma,access.proyecto.id,perm,v.id);
  return res.json({configuracion:provider.estado(),versionId:v.id,esActual:v.numero===v.entregable.versionActual,
    permiso:perm?{autorizado:vigente,requiereNuevaAutorizacion:!vigente,revocadoEn:perm.revocadoEn}:null});
}
async function authorize(req,res){
  const access=await autorizar(req,res,{activo:true});if(!access)return;
  if(access.proyecto.iaEstado!=='HABILITADA')
    return fail(res,409,'IA no habilitada para este proyecto.');
  if(!access.rol.cliente)return fail(res,403,'Solo el representante del cliente puede autorizar el analisis de sus documentos.');
  const v=await requireCurrent(req,res,access);if(!v||!v.id)return;
  const {acepto,clasificacion,finalidad,proveedorAceptado}=req.body||{};
  const conf=provider.estado();
  if(!conf.habilitada||conf.externo&&!conf.transferenciaHabilitada)return fail(res,503,'IA no habilitada o transferencia externa no aprobada por el operador.');
  if(proveedorAceptado!==conf.proveedor)return fail(res,409,'El proveedor IA cambió. Revise y acepte el proveedor actual.');
  if(acepto!==true||!['PUBLICO','INTERNO'].includes(clasificacion)||typeof finalidad!=='string'||finalidad.trim().length<10||finalidad.length>240)
    return fail(res,400,'Se requiere autorizacion expresa, clasificacion admitida y finalidad.');
  try{
    const saved=await prisma.$transaction(async tx=>{
      await tomarCandadoPrisma330(tx,'PROYECTO',access.proyecto.id);
      const actual=await representanteIAEnTransaccion(tx,access.proyecto.id,req.usuario.id);
      if(!actual || actual.iaEstado!=='HABILITADA')return {conflict:true};
      const versionActual=await tx.entregableProyecto.findUnique({
        where:{id:v.entregableId},select:{versionActual:true}});
      if(versionActual?.versionActual!==v.numero)return {conflict:true};
      const row=await tx.autorizacionDocumentoIA.upsert({where:{versionId:v.id},create:{proyectoId:access.proyecto.id,versionId:v.id,
        autorizadoPorId:req.usuario.id,clasificacion,finalidad:finalidad.trim()},update:{autorizadoPorId:req.usuario.id,clasificacion,
        finalidad:finalidad.trim(),revocadoEn:null,autorizadoEn:new Date()}});
      await log(tx,req,access.proyecto.id,'IA_AUTORIZACION', {versionId:v.id,clasificacion,
        autorizacionId:row.id,proveedor:conf.proveedor,modelo:conf.modelo,externo:conf.externo});return row;
    },{isolationLevel:'Serializable'});
    if(saved.conflict)return fail(res,409,'Representacion, estado IA o version modificados durante la autorizacion.');
    return res.status(201).json({id:saved.id,versionId:v.id,clasificacion:saved.clasificacion,revocadoEn:saved.revocadoEn});
  }catch(e){if(isConflict(e))return fail(res,409,'Conflicto de autorizacion.');throw e;}
}
async function revoke(req,res){
  const access=await autorizar(req,res,{activo:true});if(!access)return;
  if(!access.rol.cliente)return fail(res,403,'Solo el cliente puede revocar autorizaciones.');
  const v=await versionOf(access.proyecto.id,req.params.versionId);if(!v)return fail(res,404,'Version no encontrada.');
  let result;
  try{result=await prisma.$transaction(async tx=>{
    await tomarCandadoPrisma330(tx,'PROYECTO',access.proyecto.id);
    if(!(await representanteIAEnTransaccion(tx,access.proyecto.id,req.usuario.id)))
      return {denied:true};
    const changed=await tx.autorizacionDocumentoIA.updateMany({
      where:{versionId:v.id,proyectoId:access.proyecto.id,revocadoEn:null},
      data:{revocadoEn:new Date()}});
    if(changed.count)await log(tx,req,access.proyecto.id,'IA_REVOCADA',{versionId:v.id});
    return {count:changed.count};
  },{isolationLevel:'Serializable'});}catch(e){
    if(isConflict(e))return fail(res,409,'Revocacion concurrente.');
    throw e;
  }
  if(result.denied)return fail(res,403,'Representacion o cuenta revocada durante la solicitud.');
  if(!result.count)return fail(res,409,'No hay autorizacion activa.');
  return res.json({versionId:v.id,revocada:true,nota:'Los informes ya generados permanecen registrados para trazabilidad; ninguna nueva ejecucion esta autorizada.'});
}
async function run(req,res){
  const access=await autorizar(req,res,{activo:true,consultor:true});if(!access)return;
  // IA250: el estado legado NULL nunca se interpreta como aceptación.
  if(access.proyecto.iaEstado!=='HABILITADA')
    return fail(res,409,'IA no habilitada para este proyecto. No existe reactivación funcional.');
  if(process.env.AI_ENABLED!=='1')return fail(res,503,'IA deshabilitada. Configure un proveedor de análisis.');
  const v=await requireCurrent(req,res,access);if(!v||!v.id)return;
  if (!(await alcanceDocumentoVigente(prisma,access.proyecto.id,v)))return fail(res,409,'La actividad ya no tiene acuerdo adicional vigente.');
  const criteria=req.body?.criterios;
  if(!Array.isArray(criteria)||criteria.length<1||criteria.length>5||!criteria.every(x=>typeof x==='string'&&x.trim().length>=12&&x.length<=320))
    return fail(res,400,'Indique entre 1 y 5 criterios propios verificables (12 a 320 caracteres).');
  const normalized=criteria.map(s=>s.trim());if(new Set(normalized).size!==normalized.length)return fail(res,400,'Criterios duplicados.');
  // G4.8 SOLO laboratorio sintético: descomposición redactada por consultor.
  // No se acepta ni activa esta estructura en la API de producción o demo.
  let g48Specs;
  if(process.env.G48_VALIDATION==='1'&&process.env.G48_ATOMIC==='1'){
    try {g48Specs=require('../utils/g4-8-atomic').checkSpecs(normalized,req.body?.desgloses);}
    catch {return fail(res,400,'G48_DESGLOSE_INVALIDO');}
  } else if(req.body?.desgloses!==undefined){return fail(res,400,'Desglose atomico no habilitado.');}

  const permission=await prisma.autorizacionDocumentoIA.findFirst({where:{versionId:v.id,proyectoId:access.proyecto.id,revocadoEn:null}});
  if(!permission||!(await authorizationMatches(prisma,access.proyecto.id,permission,v.id)))
    return fail(res,403,'Se requiere autorización expresa para el proveedor IA configurado en esta versión.');
  const count=await prisma.analisisDocumentoIA.count({where:{proyectoId:access.proyecto.id,creadoEn:{gte:new Date(Date.now()-24*3600*1000)}}});
  if(count>=20)return fail(res,429,'Limite de 20 analisis por proyecto cada 24 horas.');
  let reserved;
  try{
    reserved=await prisma.$transaction(async tx=>{
      await tomarCandadoPrisma330(tx,'PROYECTO',access.proyecto.id);
      const proyectoIA=await tx.proyectoConsultoria.findUnique({where:{id:access.proyecto.id},select:{iaEstado:true}});
      if(proyectoIA?.iaEstado!=='HABILITADA')return {blocked:true};
      if (!(await consultorVigente(tx,access.proyecto.id,req.usuario.id))) return {blocked:true};
      if (!(await authorizationMatches(tx,access.proyecto.id,permission,v.id)))return {blocked:true};
      if (!(await alcanceDocumentoVigente(tx,access.proyecto.id,v))) return {blocked:true};
      // Recuperar análisis abandonados por reinicios: el timeout del modelo es 90 s.
      await tx.analisisDocumentoIA.updateMany({where:{versionId:v.id,proyectoId:access.proyecto.id,estado:'EN_PROCESO',creadoEn:{lt:new Date(Date.now()-(process.env.G48_VALIDATION==='1'&&process.env.G48_ATOMIC==='1'?30:5)*60*1000)}},data:{estado:'FALLIDO',errorCodigo:'IA_EJECUCION_INTERRUMPIDA',terminadoEn:new Date()}});
      const r=await tx.analisisDocumentoIA.create({data:{proyectoId:access.proyecto.id,versionId:v.id,autorizacionId:permission.id,
        solicitadoPorId:req.usuario.id,modelo:g3.modelForProvider(),criterios:normalized,sha256:v.sha256}});
      await log(tx,req,access.proyecto.id,'IA_SOLICITADA',{versionId:v.id,analisisId:r.id});return r;
    },{isolationLevel:'Serializable'});
  }catch(e){if(isConflict(e))return fail(res,409,'Ya hay un analisis en curso para esta version.');throw e;}
  if(reserved.blocked)return fail(res,409,'El alcance del acuerdo cambió durante la solicitud.');
  try {
    const parsed=await g3.extractPdf(v);
    const result=await g3.requestAI(normalized,parsed.texto,{g48Specs});
    // Evitar guardar resultados cuando se revoco el permiso durante la llamada.
    const finish=await prisma.$transaction(async tx=>{
      await tomarCandadoPrisma330(tx,'PROYECTO',access.proyecto.id);
      const alcanceActual=await alcanceDocumentoVigente(tx,access.proyecto.id,v);
      const proyectoIA=await tx.proyectoConsultoria.findUnique({where:{id:access.proyecto.id},select:{iaEstado:true}});
      const authorized=await tx.autorizacionDocumentoIA.findFirst({where:{id:permission.id,proyectoId:access.proyecto.id,revocadoEn:null}});
      const authorizedProvider=await authorizationMatches(tx,access.proyecto.id,authorized,v.id);
      const current=await tx.entregableProyecto.findUnique({where:{id:v.entregableId},select:{versionActual:true}});
      if(proyectoIA?.iaEstado!=='HABILITADA'||!authorizedProvider||!alcanceActual||current?.versionActual!==v.numero ||
         !(await consultorVigente(tx,access.proyecto.id,req.usuario.id))){
        await tx.analisisDocumentoIA.update({where:{id:reserved.id},data:{estado:'FALLIDO',errorCodigo:'AUTORIZACION_O_VERSION_CAMBIO',terminadoEn:new Date()}});
        return {conflict:true};
      }
      const warning=[parsed.truncado?'TEXTO_TRUNCADO_16000':'',result.descartados?'HALLAZGOS_SIN_CITA_DESCARTADOS':''].filter(Boolean).join(',')||null;
      await tx.analisisDocumentoIA.update({where:{id:reserved.id},data:{estado:'LISTO',longitudTexto:parsed.texto.length,advertencia:warning,terminadoEn:new Date()}});
      for(const h of result.hallazgos)await tx.hallazgoDocumentoIA.create({data:{...h,proyectoId:access.proyecto.id,analisisId:reserved.id}});
      await log(tx,req,access.proyecto.id,'IA_FINALIZADA',{analisisId:reserved.id,hallazgos:result.hallazgos.length,descartados:result.descartados});
      return {id:reserved.id,estado:'LISTO',hallazgos:result.hallazgos,advertencia:warning,descartados:result.descartados,...(result.decisiones?{decisiones:result.decisiones,metodo:result.metodo}:{})};
    },{isolationLevel:'Serializable'});
    if(finish.conflict)return fail(res,409,'La autorizacion fue revocada o se creo una nueva version. No se guardaron hallazgos.');
    return res.status(201).json({...finish,aviso:'Solo sugerencias preliminares; requieren validacion profesional. No constituyen cumplimiento ni certificacion ISO.'});
  }catch(e){
    const code=(typeof e.code==='string' && (e.code.startsWith('PDF_') || e.code.startsWith('IA_')))?e.code:'IA_ERROR_INTERNO';
    try{await prisma.analisisDocumentoIA.update({where:{id:reserved.id},data:{estado:'FALLIDO',errorCodigo:code,terminadoEn:new Date()}});}catch{} // fallos ya contenidos en registro
    if(code==='IA_ERROR_INTERNO')console.error('G3 error interno:',e?.code||e?.name||'error');
    return fail(res,e.http||500,code);
  }
}
// Único lugar donde se determina la proyección de salida de IA. Un endpoint
// de lista no puede usar la consulta detallada y luego eliminar campos: el
// servidor tampoco debe leerlos para un actor sin autorización.
const PROYECCION_ESTADO_IA={id:true,estado:true,creadoEn:true,terminadoEn:true};
const PROYECCION_DETALLE_IA={...PROYECCION_ESTADO_IA,modelo:true,criterios:true,advertencia:true,errorCodigo:true,
  hallazgos:{select:{id:true,criterio:true,observacion:true,cita:true,pagina:true,sugerencia:true,
    estado:true,motivoDecision:true,revisadoPorId:true,revisadoEn:true}}};
/** SOL-16: ADMIN aplica corte posterior irreversible por proyecto.
 * Reserva y publicación de G3 toman el mismo advisory lock 27183 por proyecto.
 * Un modelo remoto puede continuar computando; su resultado ya no se incorpora.
 * No hay eliminación de resultados históricos ni reactivación por endpoint.
 */
async function desactivarProyecto(req,res){
  const access=await autorizar(req,res);if(!access)return;
  if(!access.rol.admin)return fail(res,403,'Solo ADMIN puede desactivar la IA del proyecto.');
  const motivo=req.body?.motivo;
  if(typeof motivo!=='string'||motivo.trim().length<12||motivo.length>1000)
    return fail(res,400,'Indique un motivo de 12 a 1000 caracteres.');
  try{
    const result=await prisma.$transaction(async tx=>{
      await tomarCandadoPrisma330(tx,'PROYECTO',access.proyecto.id);
      const p=await tx.proyectoConsultoria.findUnique({where:{id:access.proyecto.id},select:{id:true,iaEstado:true}});
      if(p?.iaEstado!=='HABILITADA')return {conflict:true};
      const changed=await tx.proyectoConsultoria.updateMany({where:{id:p.id,iaEstado:'HABILITADA'},data:{iaEstado:'DESACTIVADA_POSTERIOR'}});
      if(changed.count!==1)return {conflict:true};
      const canceladas=await tx.analisisDocumentoIA.updateMany({where:{proyectoId:p.id,estado:'EN_PROCESO'},
        data:{estado:'FALLIDO',errorCodigo:'IA_CORTE_IRREVERSIBLE',terminadoEn:new Date()}});
      // IA255: el mismo candado cubre trabajos de la bandeja. Al liberar la
      // transacción, cualquier token retenido por un worker queda inválido.
      const cola=await tx.registroEventoIA.updateMany({where:{proyectoId:p.id,
        estado:{in:['PENDIENTE','EN_PROCESO']}},data:{estado:'CANCELADO',
        motivoCodigo:'IA_CORTE_IRREVERSIBLE',leaseToken:null,leaseHasta:null,
        terminadoEn:new Date()}});
      await log(tx,req,p.id,'IA_DESACTIVADA_IRREVERSIBLE',{motivo:motivo.trim(),
        canceladas:canceladas.count,trabajosColaCancelados:cola.count});
      return {ok:true,canceladas:canceladas.count,trabajosColaCancelados:cola.count};
    },{isolationLevel:'Serializable'});
    if(result.conflict)return fail(res,409,'IA ya desactivada o proyecto sin estado IA acreditado.');
    return res.json({iaEstado:'DESACTIVADA_POSTERIOR',irreversible:true,canceladas:result.canceladas,
      trabajosColaCancelados:result.trabajosColaCancelados,
      aviso:'El trabajo humano continúa. No se publicarán nuevos hallazgos IA para el proyecto.'});
  }catch(e){if(isConflict(e))return fail(res,409,'Conflicto de concurrencia al desactivar IA.');throw e;}
}
async function list(req,res){
  const access=await autorizar(req,res);if(!access)return;
  const v=await versionOf(access.proyecto.id,req.params.versionId);if(!v)return fail(res,404,'Version no encontrada.');
  // DEC-IA70-07-R: ni ADMIN ni representante acceden a criterios, citas,
  // sugerencias, observaciones, motivo profesional o errores internos, incluso
  // de versiones históricas. El representante recibe exclusivamente el estado.
  const consultor=access.rol.consultor===true;
  const where={versionId:v.id,proyectoId:access.proyecto.id};
  if(consultor){
    // Revalidación en la misma consulta de datos: una revocación de asignación
    // tras autorizar() pero antes de findMany() no autoriza leer hallazgos.
    where.proyecto={participaciones:{some:{usuarioId:req.usuario.id,activo:true,
      usuario:{activo:true,rol:'EVALUADOR'}}}};
  }
  const rows=await prisma.analisisDocumentoIA.findMany({where,orderBy:{creadoEn:'desc'},take:15,
    select:consultor?PROYECCION_DETALLE_IA:PROYECCION_ESTADO_IA});
  const analisis=consultor?rows:rows.map(r=>({id:r.id,estado:r.estado,creadoEn:r.creadoEn,
    terminadoEn:r.terminadoEn,hallazgos:[]}));
  return res.json({versionId:v.id,analisis,
    aviso:consultor?'Observaciones preliminares sujetas a revision profesional.':'Solo se muestra el estado del procesamiento; las observaciones internas son reservadas.'});
}
/**
 * F3-ANA-262 | Lectura segregada de resultados de la bandeja automatica.
 * Nunca consultar observaciones/citas para ADMIN o representante: una
 * proyeccion sobre la respuesta de una consulta detallada NO es autorizacion.
 * El filtro de pertenencia vigente se aplica en la MISMA consulta que obtiene
 * el detalle y no confia solo en la comprobacion inicial de autorizar().
 */
const PROYECCION_COLA_ESTADO={id:true,estado:true,creadoEn:true,terminadoEn:true};
const PROYECCION_COLA_CONSULTOR={...PROYECCION_COLA_ESTADO,
  resultadoAutomaticoIA:{select:{id:true,metodo:true,perfil:true,creadoEn:true,observaciones:true}}};
function exponerResultado262(registro){
  const base={id:registro.id,estado:registro.estado,creadoEn:registro.creadoEn,
    terminadoEn:registro.terminadoEn};
  const r=registro.resultadoAutomaticoIA;
  if(registro.estado!=='LISTO'||!r)return {...base,resultado:null};
  // Ninguna fila anterior a SQL 009 se reetiqueta de forma retrospectiva.
  if(r.metodo!=='COMPARACION_LITERAL'||r.perfil!=='MIC-74-04')
    return {...base,resultado:{procedenciaAcreditada:false}};
  if(!Array.isArray(r.observaciones)||r.observaciones.length>8||
     !r.observaciones.every(o=>o&&typeof o==='object'&&!Array.isArray(o)&&
       Object.keys(o).sort().join(',')==='cita,descripcion,pagina,tipo'&&
       o.tipo==='MIC-74-04'&&typeof o.cita==='string'&&o.cita.length>=12&&o.cita.length<=240&&
       typeof o.descripcion==='string'&&o.descripcion.length>=15&&o.descripcion.length<=600&&
       Number.isSafeInteger(o.pagina)&&o.pagina>0))
    return {...base,resultado:{procedenciaAcreditada:false}};
  return {...base,resultado:{id:r.id,metodo:r.metodo,perfil:r.perfil,
    creadoEn:r.creadoEn,procedenciaAcreditada:true,
    observaciones:r.observaciones.map(o=>({tipo:o.tipo,descripcion:o.descripcion,cita:o.cita,pagina:o.pagina}))}};
}
async function listAutomatic(req,res){
  const access=await autorizar(req,res);if(!access)return;
  const v=await versionOf(access.proyecto.id,req.params.versionId);
  if(!v)return fail(res,404,'Version no encontrada.');
  const consultor=access.rol.consultor===true;
  const where={proyectoId:access.proyecto.id,versionId:v.id};
  if(consultor){
    where.proyecto={participaciones:{some:{usuarioId:req.usuario.id,activo:true,
      usuario:{activo:true,rol:'EVALUADOR'}}}};
  }else if(access.rol.cliente){
    // Defensa contra sustitucion de representante entre autenticacion y consulta.
    where.proyecto={empresa:{usuarioId:req.usuario.id}};
  }
  const registros=await prisma.registroEventoIA.findMany({where,
    orderBy:[{creadoEn:'desc'},{id:'desc'}],take:15,
    select:consultor?PROYECCION_COLA_CONSULTOR:PROYECCION_COLA_ESTADO});
  return res.json({versionId:v.id,registros:consultor?registros.map(exponerResultado262):registros,
    alcance:'MIC-74-04',cobertura:'PARCIAL',
    aviso:consultor?'Posibles repeticiones literales sujetas a revision humana, no conformidad ISO.':
      'Solo estado del procesamiento. Las observaciones internas estan reservadas.'});
}
async function review(req,res){
  const access=await autorizar(req,res,{activo:true,consultor:true});if(!access)return;
  const fid=idValido(req.params.hallazgoId);
  if(!fid)return fail(res,400,'Identificador de hallazgo invalido.');
  const {decision,motivo}=req.body||{};
  if(!['CONFIRMADO','DESCARTADO'].includes(decision)||typeof motivo!=='string'||motivo.trim().length<12||motivo.length>1200)
    return fail(res,400,'Decision y motivo profesional (minimo 12 caracteres) requeridos.');
  try{
    const result=await prisma.$transaction(async tx=>{
      if(!(await consultorVigente(tx,access.proyecto.id,req.usuario.id)))return {accessDenied:true};
      const h=await tx.hallazgoDocumentoIA.findFirst({where:{id:fid,proyectoId:access.proyecto.id},include:{analisis:{include:{version:{include:{entregable:{select:{versionActual:true}}}}}}}});
      if(!h)return {missing:true};
      if(h.estado!=='PENDIENTE'||h.analisis.estado!=='LISTO')return {conflict:true};
      if(h.analisis.version.numero!==h.analisis.version.entregable.versionActual)return {conflict:true};
      const updated=await tx.hallazgoDocumentoIA.updateMany({where:{id:fid,proyectoId:access.proyecto.id,estado:'PENDIENTE'},data:{estado:decision,motivoDecision:motivo.trim(),revisadoPorId:req.usuario.id,revisadoEn:new Date()}});
      if(!updated.count)return {conflict:true};
      await log(tx,req,access.proyecto.id,'IA_HALLAZGO_REVISADO',{hallazgoId:fid,decision});return {ok:true};
    },{isolationLevel:'Serializable'});
    if(result.accessDenied)return fail(res,403,'La asignacion del consultor ya no esta vigente.');
    if(result.missing)return fail(res,404,'Hallazgo no encontrado.');if(result.conflict)return fail(res,409,'Hallazgo ya revisado, analisis invalido o version obsoleta.');
    return res.json({id:fid,estado:decision,nota:'La revision no modifica automaticamente brechas, actividades ni certificaciones.'});
  }catch(e){if(isConflict(e))return fail(res,409,'Revision concurrente.');throw e;}
}
module.exports={configuration,permissions,authorize,revoke,run,list,listAutomatic,review,desactivarProyecto};
