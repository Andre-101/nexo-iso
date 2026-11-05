'use strict';
/** F346: resumen operativo de SOLO LECTURA a partir de una inspeccion protegida.
 * Nunca usa ni retorna identificadores de trabajo, token, contenido o datos personales.
 * No modifica estados, inicia trabajos, ni decide reintentos. */
const {inspeccionarLoteIA345}=require('./g3-conciliacion-lote-345');
const MOTIVOS=new Set([
 'LEASE_INCONSISTENTE','LEASE_VENCIDO_REQUIERE_INTERVENCION','LEASE_RESIDUAL',
 'PENDIENTE_INCONSISTENTE','FIN_SIN_FECHA','RESULTADO_INCONSISTENTE',
 'IDENTIDAD_RESULTADO_INCONSISTENTE'
]);
const ESTADOS=new Set(['PENDIENTE','EN_PROCESO','LISTO','FALLIDO','CANCELADO','OMITIDO']);
const entero=n=>Number.isSafeInteger(n)&&n>=0;
function resumirInspeccionIA346(inspeccion){
 if(!inspeccion||inspeccion.estado!=='INSPECCION_LOTE_SOLO_LECTURA'||
   !entero(inspeccion.proyectoId)||inspeccion.proyectoId===0||
   !entero(inspeccion.totalSolicitado)||inspeccion.totalSolicitado<1||inspeccion.totalSolicitado>50||
   !Array.isArray(inspeccion.revisiones)||
   inspeccion.revisiones.length!==inspeccion.totalSolicitado||
   inspeccion.reintentosEjecutados!==0||inspeccion.escriturasEjecutadas!==0)
  throw Error('IA346_INSPECCION_INVALIDA');
 const motivos=new Map(),estados=new Map();let visibles=0,noVisibles=0,consistentes=0,requierenRevision=0;
 for(const item of inspeccion.revisiones){
  if(!item||typeof item!=='object')throw Error('IA346_ITEM_INVALIDO');
  if(item.estado==='NO_VISIBLE'){
   if(Object.keys(item).length!==1)throw Error('IA346_ITEM_INVALIDO');
   noVisibles++;continue;
  }
  if(item.estado!=='INSPECCIONADO'||item.proyectoId!==inspeccion.proyectoId||
    !ESTADOS.has(item.situacion)||typeof item.consistente!=='boolean'||
    typeof item.requiereRevision!=='boolean'||!Array.isArray(item.problemas)||
    new Set(item.problemas).size!==item.problemas.length||
    item.problemas.some(x=>!MOTIVOS.has(x))||
    item.consistente!==(item.problemas.length===0)||
    item.requiereRevision===item.consistente)
   throw Error('IA346_ITEM_INVALIDO');
  visibles++;estados.set(item.situacion,(estados.get(item.situacion)||0)+1);
  if(item.consistente)consistentes++;else requierenRevision++;
  for(const m of item.problemas)motivos.set(m,(motivos.get(m)||0)+1);
 }
 if(visibles!==inspeccion.visibles||noVisibles!==inspeccion.noVisibles||
   consistentes!==inspeccion.consistentes||requierenRevision!==inspeccion.requierenRevision)
  throw Error('IA346_TOTALES_INVALIDOS');
 const ordenar=map=>Object.freeze([...map].sort(([a],[b])=>a.localeCompare(b,'en'))
  .map(([clave,total])=>Object.freeze({clave,total})));
 return Object.freeze({estado:'RESUMEN_OPERATIVO_IA_SOLO_LECTURA',
  proyectoId:inspeccion.proyectoId,totalSolicitado:inspeccion.totalSolicitado,
  visibles,noVisibles,consistentes,requierenRevision,
  distribucion:ordenar(estados),motivosRevision:ordenar(motivos),
  reintentosEjecutados:0,escriturasEjecutadas:0,
  accionAutomaticaAutorizada:false,requiere:'REVISION_HUMANA_DE_ANOMALIAS'});
}
async function prepararResumenIA346(db,params){
 return resumirInspeccionIA346(await inspeccionarLoteIA345(db,params));
}
module.exports={resumirInspeccionIA346,prepararResumenIA346};
