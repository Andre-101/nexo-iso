/**
 * F3-ANA-253 | DETECTOR DE CANDIDATOS (SOLO LECTURA, EXPERIMENTAL).
 *
 * SOL-03/08 y DEC-IA73-01: solo versiones NUEVAS, análisis individual, nunca
 * equivalencia a aprobación. No ejecuta Ollama ni escribe en BD o disco.
 * La fuente de eventos es el asiento atómico G2 VERSION_DOCUMENTAL_CARGADA;
 * NO altera G2 ni crea permisos de documento artificiales.
 *
 * IMPORTANTE: NO es un worker ni consume persistentemente el cursor. Para
 * ejecutar realmente faltan cola duradera, deduplicación en BD, criterio
 * acotado, migración de G3 heredado y validación PostgreSQL (incl. 005).
 */
'use strict';
const ACCION='VERSION_DOCUMENTAL_CARGADA';
const MAX_LOTE=50;
const integer=x=>Number.isSafeInteger(x)&&x>0;
const hex=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const resultado=(ev,estado)=>({eventoId:ev.id,proyectoId:ev.proyectoId,
  versionId:integer(ev.detalle?.versionId)?ev.detalle.versionId:null,estado});
function validarCursor(cursor,limite){
  if(!Number.isSafeInteger(cursor)||cursor<0)throw new TypeError('IA253_CURSOR_EXPLICITO_REQUERIDO');
  if(!Number.isSafeInteger(limite)||limite<1||limite>MAX_LOTE)throw new TypeError('IA253_LOTE_INVALIDO');
}
// Snapshot de elegibilidad, nunca autorización para ejecutar. Al reservar
// un trabajo y antes de publicar se deben revalidar las mismas condiciones
// bajo el advisory lock de proyecto utilizado por el corte irreversible.
async function evaluar(db,ev){
  if(!integer(ev?.id)||!integer(ev.proyectoId)||ev.accion!==ACCION)return resultado(ev,'EVENTO_INVALIDO');
  const d=ev.detalle;
  if(!d||Array.isArray(d)||!integer(d.versionId)||!integer(d.entregableId)||!integer(d.numero))
    return resultado(ev,'DETALLE_INVALIDO');
  const p=await db.proyectoConsultoria.findUnique({where:{id:ev.proyectoId},
    select:{id:true,iaEstado:true,estado:true}});
  if(!p||p.id!==ev.proyectoId)return resultado(ev,'PROYECTO_INEXISTENTE');
  if(p.iaEstado!=='HABILITADA')return resultado(ev,'IA_NO_HABILITADA');
  if(p.estado!=='ACTIVO')return resultado(ev,'PROYECTO_NO_ACTIVO');
  const v=await db.documentoVersionProyecto.findFirst({
    where:{id:d.versionId,proyectoId:ev.proyectoId,entregableId:d.entregableId,numero:d.numero},
    select:{id:true,proyectoId:true,numero:true,sha256:true,entregableId:true,
      entregable:{select:{versionActual:true,actividad:{select:{
        estado:true,cobertura:true,acuerdoAdicionalId:true}}}}}});
  if(!v||v.id!==d.versionId||v.proyectoId!==ev.proyectoId||v.entregableId!==d.entregableId ||
      v.numero!==d.numero||!hex(v.sha256))return resultado(ev,'VERSION_NO_VERIFICADA');
  if(v.numero!==v.entregable?.versionActual)return resultado(ev,'VERSION_REEMPLAZADA');
  const act=v.entregable?.actividad;
  if(!act||['COMPLETADA','CANCELADA'].includes(act.estado) ||
     !['PENDIENTE','EN_PROGRESO','EN_REVISION'].includes(act.estado))
    return resultado(ev,'ACTIVIDAD_NO_OPERATIVA');
  if(act.cobertura==='ADICIONAL'){
    if(!integer(act.acuerdoAdicionalId))return resultado(ev,'ACUERDO_NO_VIGENTE');
    const acuerdo=await db.acuerdoAdicionalProyecto.findFirst({where:{id:act.acuerdoAdicionalId,
      proyectoId:ev.proyectoId,estado:'HABILITADO'},select:{id:true}});
    if(!acuerdo)return resultado(ev,'ACUERDO_NO_VIGENTE');
  } else if (act.cobertura!=='BASE')return resultado(ev,'COBERTURA_NO_VERIFICADA');
  // Identidad estable, SIN contenido documental, nombres, citas ni criterios.
  return {...resultado(ev,'CANDIDATA_NO_DESPACHADA'),identidad:`${ev.proyectoId}:${v.id}:${v.sha256}`};
}
async function descubrir(db,{desdeEventoId,limite=20}={}){
  validarCursor(desdeEventoId,limite);
  for(const name of ['eventoProyecto','proyectoConsultoria','documentoVersionProyecto','acuerdoAdicionalProyecto'])
    if(!db||!db[name])throw new TypeError('IA253_BASE_NO_DISPONIBLE');
  const eventos=await db.eventoProyecto.findMany({
    where:{accion:ACCION,id:{gt:desdeEventoId}},orderBy:{id:'asc'},take:limite,
    select:{id:true,proyectoId:true,accion:true,detalle:true}});
  if(!Array.isArray(eventos)||eventos.length>limite)throw new Error('IA253_RESPUESTA_EVENTOS_INVALIDA');
  const items=[];let cursor=desdeEventoId;const seen=new Set();
  for(const ev of eventos){
    if(!integer(ev.id)||ev.id<=cursor)throw new Error('IA253_ORDEN_EVENTOS_INVALIDO');
    const item=await evaluar(db,ev);cursor=ev.id;
    if(item.identidad){
      if(seen.has(item.identidad))items.push({...item,estado:'DUPLICADA_EN_LOTE',identidad:undefined});
      else {seen.add(item.identidad);items.push(item);}
    }else items.push(item);
  }
  return {etapa:'F3-ANA-253',modo:'SOLO_LECTURA_SIN_DESPACHO',desdeEventoId,
    cursorSugerido:cursor,limite,items};
}
module.exports={ACCION,MAX_LOTE,validarCursor,evaluar,descubrir};
