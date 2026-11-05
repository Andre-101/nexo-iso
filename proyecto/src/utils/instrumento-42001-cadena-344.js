'use strict';
/** Cadena de revisiones PREPARATORIAS; no autoriza ni publica instrumentos ISO 42001. */
const {compararBorradores42001}=require('./instrumento-42001-comparacion-343');
const SHA=/^[a-f0-9]{64}$/;
function rastrearRevisiones42001(revisiones){
 if(!Array.isArray(revisiones)||revisiones.length<2||revisiones.length>20)
  throw Error('I42001_344_CADENA_INVALIDA');
 const hashes=new Set(),pasos=[];
 for(let i=0;i<revisiones.length-1;i++){
  const a=revisiones[i],b=revisiones[i+1];
  const d=compararBorradores42001(a,b); // valida huella y proyecto de AMBOS extremos
  if(i===0)hashes.add(a.hashExpediente);
  if(!SHA.test(b.hashExpediente)||hashes.has(b.hashExpediente))
   throw Error('I42001_344_CICLO_O_REPETICION');
  hashes.add(b.hashExpediente);
  pasos.push(Object.freeze({ordinal:i+1,desde:d.antes,hasta:d.despues,
   agregados:d.agregados.length,retirados:d.retirados.length,
   modificados:d.modificados.length,estado:'REVISION_NORMATIVA_PENDIENTE'}));
 }
 return Object.freeze({proyectoId:revisiones[0].proyectoId,pasos:Object.freeze(pasos),
  inicio:revisiones[0].hashExpediente,fin:revisiones.at(-1).hashExpediente,
  puedePublicarse:false,puedeEjecutarDiagnostico:false,
  estado:'CADENA_PREPARATORIA_NO_APROBADA'});
}
module.exports={rastrearRevisiones42001};
