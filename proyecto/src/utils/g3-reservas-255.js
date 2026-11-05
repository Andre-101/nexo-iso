/**
 * F3-ANA-255 | Protocolo experimental de reservas transaccionales para bandeja IA.
 * No se monta en API, cron, servidor ni Docker. No invoca Ollama ni lee PDFs.
 * PostgreSQL 007 DEBE validarse antes de conectar un consumidor automático.
 *
 * Fallos/vencimientos son terminales FALLIDO: sin reintento automático hasta que
 * la política de reintentos esté definida y validada; no existe reencolado implícito.
 * Un token distinto, vencido o proyecto cortado no puede publicar resultados.
 */
'use strict';
const {randomUUID}=require('node:crypto');
const {evaluar,ACCION}=require('./g3-elegibilidad-automatica-253');
const ESTADOS_FINALES=new Set(['LISTO','FALLIDO','CANCELADO','OMITIDO']);
const CONFLICTOS=new Set(['P2002','P2034']);
const ID=x=>Number.isSafeInteger(x)&&x>0;
const DATE=x=>x instanceof Date&&Number.isFinite(x.getTime());
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const TOKEN=x=>typeof x==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const CODIGO=x=>typeof x==='string'&&/^[A-Z0-9_]{3,80}$/.test(x);
function dbCheck(db){
  if(!db||typeof db.$transaction!=='function'||!db.registroEventoIA)
    throw TypeError('IA255_BD_NO_DISPONIBLE');
}
// Mismo candado acreditado para autorización, corte, bandeja y publicación.
// Rechaza resultados inválidos de Prisma; jamás continuar sin adquirirlo.
const lock=(tx,id)=>require('./candado-prisma-330').tomarCandadoPrisma330(tx,'PROYECTO',id);
function parametros({ahora=new Date(),duracionMs=600000}={}){
  if(!DATE(ahora)||!Number.isSafeInteger(duracionMs)||duracionMs<60000||duracionMs>900000)
    throw TypeError('IA255_PARAMETROS_INVALIDOS');
  return {ahora,duracionMs};
}
async function elegible(db,row){
  const e=await db.eventoProyecto.findUnique({where:{id:row.eventoId},
    select:{id:true,proyectoId:true,accion:true,detalle:true,creadoEn:true}});
  if(!e||e.proyectoId!==row.proyectoId||e.accion!==ACCION)
    return {ok:false,codigo:'IA255_EVENTO_NO_VIGENTE'};
  const result=await evaluar(db,e);
  if(result.estado!=='CANDIDATA_NO_DESPACHADA')return {ok:false,codigo:result.estado};
  if(result.versionId!==row.versionId||!SHA(row.sha256)||
     result.identidad!==`${row.proyectoId}:${row.versionId}:${row.sha256}`)
    return {ok:false,codigo:'IA255_IDENTIDAD_CAMBIADA'};
  return {ok:true};
}
async function reservarUna(db,{limite=10,ahora=new Date(),duracionMs=600000}={}){
  dbCheck(db);parametros({ahora,duracionMs});
  if(!Number.isSafeInteger(limite)||limite<1||limite>30)throw TypeError('IA255_LOTE_INVALIDO');
  const candidatas=await db.registroEventoIA.findMany({where:{estado:'PENDIENTE'},
    orderBy:{id:'asc'},take:limite,select:{id:true,proyectoId:true}});
  if(!Array.isArray(candidatas)||candidatas.length>limite)throw Error('IA255_SCAN_INVALIDO');
  for(const c of candidatas){
    if(!ID(c.id)||!ID(c.proyectoId))throw Error('IA255_FILA_INVALIDA');
    const token=randomUUID();
    try{
      const resultado=await db.$transaction(async tx=>{
        await lock(tx,c.proyectoId);
        const row=await tx.registroEventoIA.findUnique({where:{id:c.id}});
        if(!row||row.estado!=='PENDIENTE'||row.proyectoId!==c.proyectoId)return null;
        const eligible=await elegible(tx,row);
        if(!eligible.ok){
          const upd=await tx.registroEventoIA.updateMany({where:{id:row.id,estado:'PENDIENTE'},
            data:{estado:'CANCELADO',motivoCodigo:eligible.codigo,terminadoEn:ahora}});
          return upd.count===1?{estado:'CANCELADO',trabajoId:row.id,motivo:eligible.codigo}:null;
        }
        if(row.intentos!==0||row.leaseToken!==null||row.leaseHasta!==null)
          throw Error('IA255_PENDIENTE_ALTERADO');
        const leaseHasta=new Date(ahora.getTime()+duracionMs);
        const upd=await tx.registroEventoIA.updateMany({where:{id:row.id,estado:'PENDIENTE',intentos:0,
          leaseToken:null},data:{estado:'EN_PROCESO',intentos:1,leaseToken:token,
          leaseHasta,tomadoEn:ahora,terminadoEn:null}});
        return upd.count===1?{estado:'RESERVADO',trabajoId:row.id,proyectoId:row.proyectoId,
          versionId:row.versionId,sha256:row.sha256,token,leaseHasta}:null;
      },{isolationLevel:'Serializable'});
      if(resultado)return resultado;
    }catch(e){if(CONFLICTOS.has(e?.code))continue;throw e;}
  }
  return {estado:'SIN_TRABAJOS'};
}
/** Finalizar SOLO después de que el adaptador publique hallazgos dentro de ESTA transacción.
 * El callback debe devolver true exactamente; de lo contrario se hace rollback.
 * Ningún endpoint suministra callbacks; únicamente código interno confiable.
 */
async function liquidar(db,{trabajoId,proyectoId,token,ahora=new Date(),publicar,falloCodigo}={}){
  dbCheck(db);if(!ID(trabajoId)||!ID(proyectoId)||!TOKEN(token)||!DATE(ahora))
    throw TypeError('IA255_LIQUIDACION_INVALIDA');
  if(falloCodigo!==undefined && !CODIGO(falloCodigo))throw TypeError('IA255_CODIGO_INVALIDO');
  if(falloCodigo===undefined && typeof publicar!=='function')
    throw TypeError('IA255_PUBLICACION_TRANSACCIONAL_OBLIGATORIA');
  return db.$transaction(async tx=>{
    await lock(tx,proyectoId);
    const row=await tx.registroEventoIA.findUnique({where:{id:trabajoId}});
    if(!row||row.proyectoId!==proyectoId||row.estado!=='EN_PROCESO'||row.leaseToken!==token)
      return {estado:'OBSOLETO',publicado:false};
    if(!DATE(row.leaseHasta)||row.leaseHasta.getTime()<=ahora.getTime())
      return {estado:'LEASE_VENCIDO',publicado:false};
    const eligible=await elegible(tx,row);
    if(!eligible.ok){
      const r=await tx.registroEventoIA.updateMany({where:{id:trabajoId,estado:'EN_PROCESO',leaseToken:token},
        data:{estado:'CANCELADO',motivoCodigo:eligible.codigo,leaseToken:null,leaseHasta:null,terminadoEn:ahora}});
      if(r.count!==1)throw Error('IA255_CANCELACION_NO_CONFIRMADA');
      return {estado:'CANCELADO',publicado:false};
    }
    const where={id:trabajoId,estado:'EN_PROCESO',leaseToken:token};
    if(falloCodigo!==undefined){
      const r=await tx.registroEventoIA.updateMany({where,data:{estado:'FALLIDO',errorCodigo:falloCodigo,
        leaseToken:null,leaseHasta:null,terminadoEn:ahora}});
      return r.count===1?{estado:'FALLIDO',publicado:false}:{estado:'OBSOLETO',publicado:false};
    }
    // Las propuestas NO se consideran publicadas por un callback ausente o incompleto.
    if(await publicar(tx,{trabajoId,proyectoId,versionId:row.versionId,sha256:row.sha256})!==true)
      throw Error('IA255_PUBLICACION_NO_CONFIRMADA');
    const r=await tx.registroEventoIA.updateMany({where,data:{estado:'LISTO',
      leaseToken:null,leaseHasta:null,terminadoEn:ahora}});
    if(r.count!==1)throw Error('IA255_PUBLICACION_SIN_FENCING');
    return {estado:'LISTO',publicado:true};
  },{isolationLevel:'Serializable'});
}
/** Vencimiento fail-closed. NUNCA reencola: política general de reintentos pendiente. */
async function vencerUna(db,{trabajoId,proyectoId,ahora=new Date()}={}){
  dbCheck(db);if(!ID(trabajoId)||!ID(proyectoId)||!DATE(ahora))throw TypeError('IA255_VENCIMIENTO_INVALIDO');
  return db.$transaction(async tx=>{
    await lock(tx,proyectoId);
    const r=await tx.registroEventoIA.findUnique({where:{id:trabajoId}});
    if(!r||r.proyectoId!==proyectoId||r.estado!=='EN_PROCESO'||!DATE(r.leaseHasta)||r.leaseHasta>ahora)
      return {estado:'SIN_CAMBIO'};
    const changed=await tx.registroEventoIA.updateMany({where:{id:r.id,estado:'EN_PROCESO',leaseToken:r.leaseToken,
      leaseHasta:{lte:ahora}},data:{estado:'FALLIDO',errorCodigo:'IA255_LEASE_VENCIDO',
        leaseToken:null,leaseHasta:null,terminadoEn:ahora}});
    return {estado:changed.count===1?'FALLIDO':'SIN_CAMBIO'};
  },{isolationLevel:'Serializable'});
}
module.exports={reservarUna,liquidar,vencerUna,parametros,elegible,ESTADOS_FINALES};
