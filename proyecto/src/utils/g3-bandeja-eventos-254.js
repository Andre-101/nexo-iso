/**
 * F3-ANA-254 | Barrido TRANSACCIONAL de eventos confirmados, sin cursor persistente.
 * Solo prepara la bandeja. No lee bytes PDF, no solicita Ollama, no modifica G2,
 * no asigna autor humano ni crea una autorización G3 ficticia.
 *
 * IMPORTANTE: NO invocar como tarea automática hasta validar 006 en PostgreSQL
 * real, la concurrencia y el consumidor controlado de la cola.
 */
'use strict';
const {ACCION,evaluar}=require('./g3-elegibilidad-automatica-253');
const LIMITE_MAXIMO=50;
const int=x=>Number.isSafeInteger(x)&&x>0;
const CONFLICTOS=new Set(['P2002','P2034']);
function verificar(db,limite){
  if(!Number.isSafeInteger(limite)||limite<1||limite>LIMITE_MAXIMO)
    throw new TypeError('IA254_LOTE_INVALIDO');
  if(!db||typeof db.$transaction!=='function'||!db.controlBandejaIA||!db.eventoProyecto||!db.registroEventoIA)
    throw new TypeError('IA254_BASE_NO_DISPONIBLE');
}
function filtro(control){
  if(!control || !int(control.id)||control.id!==1 ||
     !Number.isSafeInteger(control.eventoBaseId)||control.eventoBaseId<0 ||
     !(control.fechaInicio instanceof Date)||!Number.isFinite(control.fechaInicio.getTime()))
    throw new Error('IA254_BARRERA_INVALIDA');
  return {accion:ACCION,id:{gt:control.eventoBaseId},creadoEn:{gte:control.fechaInicio},registroIA:{is:null}};
}
async function registrarEvento(db,evento){
  if(!int(evento?.id)||!int(evento.proyectoId)||evento.accion!==ACCION)
    throw new Error('IA254_EVENTO_INVALIDO');
  return db.$transaction(async tx=>{
    // Misma sección crítica del corte irreversible SOL-16 y la publicación G3.
    // Serializa encoladores del mismo proyecto sin afectar otros proyectos.
    await require('./candado-prisma-330').tomarCandadoPrisma330(tx,'PROYECTO',evento.proyectoId);
    const vigente=await tx.controlBandejaIA.findUnique({where:{id:1}});
    filtro(vigente);
    // La identidad del evento es una lectura NUEVA y confiable dentro del
    // mismo límite transaccional; no confiar en un snapshot exterior alterable.
    const real=await tx.eventoProyecto.findUnique({where:{id:evento.id},
      select:{id:true,proyectoId:true,accion:true,detalle:true,creadoEn:true}});
    if(!real||real.proyectoId!==evento.proyectoId||real.accion!==ACCION||
        !(real.creadoEn instanceof Date))throw Error('IA254_ORIGEN_EVENTO_INCOHERENTE');
    if(real.id<=vigente.eventoBaseId || real.creadoEn<vigente.fechaInicio)
      return {eventoId:evento.id,estado:'FUERA_DE_BARRERA'};
    if(await tx.registroEventoIA.findUnique({where:{eventoId:evento.id},select:{id:true}}))
      return {eventoId:evento.id,estado:'YA_REGISTRADO'};
    // Evaluar de nuevo dentro de la transacción; el resultado anterior al lock
    // no concede permiso para encolar ni publicar.
    const r=await evaluar(tx,real);
    const candidata=r.estado==='CANDIDATA_NO_DESPACHADA';
    const versionId=candidata?r.versionId:null;
    let motivo=candidata?null:r.estado;
    if(candidata && await tx.registroEventoIA.findFirst({where:{proyectoId:evento.proyectoId,
      versionId,estado:{not:'OMITIDO'}},select:{id:true}}))motivo='VERSION_YA_REGISTRADA';
    const estado=candidata&&!motivo?'PENDIENTE':'OMITIDO';
    // Nunca persiste criterios, contenido del PDF, citas, prompt o nombres.
    await tx.registroEventoIA.create({data:{eventoId:evento.id,proyectoId:evento.proyectoId,
      versionId:estado==='PENDIENTE'?versionId:null,
      sha256:estado==='PENDIENTE'?r.identidad.split(':').at(-1):null,
      estado,motivoCodigo:estado==='OMITIDO'?motivo:null}});
    return {eventoId:evento.id,estado,motivo:motivo||undefined};
  },{isolationLevel:'Serializable'});
}
async function registrarLote(db,{limite=20}={}){
  verificar(db,limite);
  const control=await db.controlBandejaIA.findUnique({where:{id:1}});
  const where=filtro(control);
  // NO cursor: un evento con ID menor que otro pero confirmado más tarde
  // sigue sin registro y será recuperado en el siguiente barrido.
  const events=await db.eventoProyecto.findMany({where,orderBy:{id:'asc'},take:limite,
    select:{id:true,proyectoId:true,accion:true,detalle:true,creadoEn:true}});
  if(!Array.isArray(events)||events.length>limite)throw Error('IA254_EVENTOS_INVALIDOS');
  const items=[];
  for(const ev of events){
    if(!int(ev?.id)||!int(ev.proyectoId)||!Number.isFinite(ev.creadoEn?.getTime()))
      throw Error('IA254_EVENTO_INVALIDO');
    try{items.push(await registrarEvento(db,ev));}
    catch(e){
      // Una colisión concurrente no representa error del documento humano;
      // la siguiente iteración inspeccionará la fila nuevamente si hace falta.
      if(CONFLICTOS.has(e?.code))items.push({eventoId:ev.id,estado:'CONFLICTO_REINTENTABLE'});
      else throw e;
    }
  }
  return {etapa:'F3-ANA-254',modo:'SOLO_ENCOLADO_SIN_INFERENCIA',
    eventoBaseId:control.eventoBaseId,procesados:items.length,items};
}
module.exports={LIMITE_MAXIMO,filtro,registrarEvento,registrarLote};
