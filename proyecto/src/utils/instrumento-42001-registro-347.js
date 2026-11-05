'use strict';
/** Registro EXPERIMENTAL de borradores 42001, inmutable como evento de proyecto.
 * No agrega cuestionarios ejecutables ni interpreta el contenido de la norma.
 * Un único historial por proyecto bajo candados de identidad/cuenta/proyecto;
 * el hash previo se exige para evitar sobrescrituras o carreras entre revisores.
 */
const {tomarCandadoPrisma330}=require('./candado-prisma-330');
const {prepararExpediente42001}=require('./instrumento-42001-borrador-342');
const ACCION='I42001_BORRADOR_PREPARATORIO_NO_APROBADO';
const sha=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const id=x=>Number.isSafeInteger(x)&&x>0;
function bloquear(code,status){return Object.assign(new Error(code),{status});}
async function registrarBorrador42001_347(db,{proyectoId,actorId,items,huellaAnterior=null}={}){
 if(!id(proyectoId)||!id(actorId)||!(huellaAnterior===null||sha(huellaAnterior))||
  !Array.isArray(items)||typeof db?.$transaction!=='function')throw bloquear('I42001_347_PARAMETROS_INVALIDOS',400);
 return db.$transaction(async tx=>{
  await tomarCandadoPrisma330(tx,'IDENTIDAD',actorId);
  await tomarCandadoPrisma330(tx,'CUENTA',actorId);
  await tomarCandadoPrisma330(tx,'PROYECTO',proyectoId);
  const actor=await tx.usuario.findUnique({where:{id:actorId},select:{rol:true,activo:true,bloqueoUrgente:true}});
  const proyecto=await tx.proyectoConsultoria.findUnique({where:{id:proyectoId},
   select:{id:true,estado:true,normaCodigo:true,edicionNormativa:true}});
  if(!actor?.activo||actor.bloqueoUrgente||!proyecto||proyecto.estado!=='ACTIVO'||
   (actor.rol!=='ADMIN'&&(actor.rol!=='EVALUADOR'||
    !await tx.participacionConsultor.findFirst({where:{proyectoId,usuarioId:actorId,
     activo:true,principal:true},select:{id:true}}))))throw bloquear('I42001_347_ACCESO_DENEGADO',403);
  // La identidad normativa es un requisito de almacenamiento, no una habilitación.
  let borrador;
  try{borrador=prepararExpediente42001(proyecto,items);}
  catch{throw bloquear('I42001_347_INSTRUMENTO_NO_VALIDADO',422);}
  const historia=await tx.eventoProyecto.findMany({where:{proyectoId,accion:ACCION},
   orderBy:{id:'desc'},take:21,select:{id:true,detalle:true}});
  if(!Array.isArray(historia)||historia.length>20||
   historia.some(e=>!e||!sha(e.detalle?.hashExpediente)))
   throw bloquear('I42001_347_HISTORIAL_INCOHERENTE',409);
  const anterior=historia[0]||null;
  const ultima=anterior?.detalle.hashExpediente||null;
  if(historia.some((e,i)=>i>0&&e.detalle.hashExpediente===borrador.hashExpediente))
   throw bloquear('I42001_347_REVISION_REPETIDA',409);
  if(ultima===borrador.hashExpediente){
   // Un reintento de la última revisión es idempotente, con la misma huella previa.
   if(anterior.detalle.huellaAnterior!==huellaAnterior)throw bloquear('I42001_347_CONFLICTO_REVISION',409);
   return Object.freeze({estado:'BORRADOR_REGISTRADO_NO_APROBADO',id:anterior.id,
    hashExpediente:ultima,reutilizado:true,puedeEjecutarDiagnostico:false,puedePublicarse:false});
  }
  if(ultima!==huellaAnterior)throw bloquear('I42001_347_CONFLICTO_REVISION',409);
  if(historia.length>=20)throw bloquear('I42001_347_MAXIMO_REVISIONES',409);
  const nuevo=await tx.eventoProyecto.create({data:{proyectoId,usuarioId:actorId,accion:ACCION,
    detalle:{proyectoId,hashExpediente:borrador.hashExpediente,huellaAnterior,
     normaCodigo:'ISO_42001',edicionNormativa:'2023',estado:'BORRADOR_NO_VALIDADO',
     items:borrador.items.map(x=>({idInterno:x.idInterno,tituloTrabajo:x.tituloTrabajo,
      fuenteId:x.fuenteId,fuenteSha256:x.fuenteSha256,notasPreparacion:x.notasPreparacion}))}},
   select:{id:true}});
  return Object.freeze({estado:'BORRADOR_REGISTRADO_NO_APROBADO',id:nuevo.id,
    hashExpediente:borrador.hashExpediente,reutilizado:false,
    puedeEjecutarDiagnostico:false,puedePublicarse:false});
 },{isolationLevel:'Serializable'});
}
module.exports={registrarBorrador42001_347,ACCION};
