'use strict';
/** F3-ANA-342 — Preparación de expediente técnico, NO cuestionario homologado.
 * No añade controles normativos, activación automática ni dictámenes.
 * Solo aceptamos borradores vinculados a proyecto 42001:2023 y fuentes trazables.
 */
const {createHash}=require('node:crypto');
const ID=/^[A-Z][A-Z0-9_-]{2,39}$/;
const SHA=/^[a-f0-9]{64}$/;
const ALLOWED=new Set(['idInterno','tituloTrabajo','fuenteId','fuenteSha256','notasPreparacion']);
function texto(s,max){return typeof s==='string'&&s.trim()===s&&s.length>=3&&s.length<=max&&!/[\u0000-\u001f]/.test(s);}
function prepararExpediente42001(proyecto,items){
  if(!proyecto||!Number.isSafeInteger(proyecto.id)||proyecto.id<=0||
     proyecto.normaCodigo!=='ISO_42001'||proyecto.edicionNormativa!=='2023')
    throw Error('I42001_IDENTIDAD_NO_VALIDA');
  if(!Array.isArray(items)||items.length<1||items.length>100)throw Error('I42001_ITEMS_INVALIDOS');
  const ids=new Set();
  const rows=items.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||
      Object.keys(item).some(k=>!ALLOWED.has(k)))throw Error('I42001_CAMPOS_NO_ACREDITADOS');
    if(!ID.test(item.idInterno)||ids.has(item.idInterno)||
      !texto(item.tituloTrabajo,160)||!texto(item.fuenteId,160)||
      !SHA.test(item.fuenteSha256)||
      (item.notasPreparacion!==undefined&&!texto(item.notasPreparacion,500)))
      throw Error('I42001_TRAZABILIDAD_INVALIDA');
    ids.add(item.idInterno);
    return Object.freeze({idInterno:item.idInterno,tituloTrabajo:item.tituloTrabajo,
      fuenteId:item.fuenteId,fuenteSha256:item.fuenteSha256,
      notasPreparacion:item.notasPreparacion||null,estado:'BORRADOR_NO_VALIDADO'});
  });
  // Hash reproducible independiente del orden de entrada, sin texto de norma.
  const ordered=rows.slice().sort((a,b)=>a.idInterno.localeCompare(b.idInterno,'en'));
  const sha256=createHash('sha256').update(JSON.stringify({proyectoId:proyecto.id,
    norma:'ISO_42001',edicion:'2023',items:ordered})).digest('hex');
  return Object.freeze({proyectoId:proyecto.id,normaCodigo:'ISO_42001',edicionNormativa:'2023',
    estado:'BORRADOR_NO_VALIDADO',hashExpediente:sha256,items:Object.freeze(ordered),
    puedePublicarse:false,puedeEjecutarDiagnostico:false,
    requiere:'REVISION_NORMATIVA_COMPETENTE_Y_APROBACION_FORMAL'});
}
module.exports={prepararExpediente42001};
