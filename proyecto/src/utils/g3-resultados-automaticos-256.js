/**
 * F3-ANA-256: frontera de publicación de revisión ligera automática MIC-74.
 * Estrictamente experimental. Sin endpoints ni cron; NO reemplaza revisión humana.
 * Crea un registro distinto de G3 manual: no inventa solicitante o autorización.
 */
'use strict';
const {liquidar,reservarUna}=require('./g3-reservas-255');
const CATALOGO='MIC-74-V1';
const METODO='COMPARACION_LITERAL';
const PERFIL='MIC-74-04';
const TIPOS=new Set(['MIC-74-01','MIC-74-02','MIC-74-03','MIC-74-04']);
const ID=x=>Number.isSafeInteger(x)&&x>0;
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const normalize=x=>String(x).replace(/\s+/g,' ').trim();
const fail=code=>{const e=new Error(code);e.code=code;return e;};
/** Nunca publicar hallazgos sin cita verificable contra texto extraído de ESA versión. */
function validarObservaciones(output,paginas){
  if(!output||typeof output!=='object'||Array.isArray(output)||
     Object.keys(output).length!==1||!Array.isArray(output.observaciones)||
     output.observaciones.length>8||!Array.isArray(paginas)||paginas.length<1||paginas.length>12||
     !paginas.every(p=>typeof p==='string'&&p.length<=16000))throw fail('IA256_FORMATO_NO_ACREDITADO');
  const observed=[];const seen=new Set();
  for(const v of output.observaciones){
    if(!v||typeof v!=='object'||Array.isArray(v)||
       Object.keys(v).sort().join(',')!=='cita,descripcion,tipo' || !TIPOS.has(v.tipo) ||
       typeof v.descripcion!=='string'||normalize(v.descripcion).length<15||v.descripcion.length>600||
       typeof v.cita!=='string'||normalize(v.cita).length<12||v.cita.length>240)
      throw fail('IA256_OBSERVACION_INVALIDA');
    const cita=normalize(v.cita),pagina=paginas.findIndex(p=>normalize(p).includes(cita));
    if(pagina<0)throw fail('IA256_CITA_NO_VERIFICADA');
    const k=`${v.tipo}:${pagina}:${cita.toLowerCase()}`;
    if(seen.has(k))throw fail('IA256_OBSERVACION_DUPLICADA');
    seen.add(k);
    observed.push({tipo:v.tipo,descripcion:normalize(v.descripcion),cita,pagina:pagina+1});
  }
  return observed;
}
/** El callback corre BAJO el candado de liquidar() y en la MISMA transacción. */
function prepararPublicacion({observaciones,versionId,sha256}){
  if(!ID(versionId)||!SHA(sha256)||!Array.isArray(observaciones)||
     observaciones.some(o=>!o||o.tipo!==PERFIL))throw fail('IA261_METODO_NO_ACREDITADO');
  return async(tx,{trabajoId,proyectoId,versionId:actual,sha256:actualSha})=>{
    if(!tx?.resultadoAutomaticoIA||actual!==versionId||actualSha!==sha256)
      throw fail('IA256_IDENTIDAD_CAMBIADA');
    await tx.resultadoAutomaticoIA.create({data:{registroId:trabajoId,proyectoId,versionId,
      sha256,catalogo:CATALOGO,metodo:METODO,perfil:PERFIL,observaciones}});
    return true;
  };
}
/**
 * Una unidad de despacho controlada. No arranca sola, no monta API/cron.
 * `extraer` debe ser un adaptador de extracción con SHA del documento,
 * `analizar` un adaptador MIC-74 sin acceso a escritura; no se admite payload
 * ni función de terceros desde HTTP. Los resultados solo se hacen visibles a
 * través de un endpoint futuro con permisos de consultor vigentes.
 */
async function ejecutarUna(db,{extraer,analizar,ahora=new Date(),duracionMs=600000}={}){
  if(typeof extraer!=='function'||typeof analizar!=='function')throw fail('IA256_ADAPTADORES_REQUERIDOS');
  const lease=await reservarUna(db,{limite:10,ahora,duracionMs});
  if(lease.estado!=='RESERVADO')return {estado:lease.estado};
  const args=Object.freeze({proyectoId:lease.proyectoId,versionId:lease.versionId,
    sha256:lease.sha256});
  try{
    const extraction=await extraer(args);
    if(!extraction||extraction.sha256!==lease.sha256||!Array.isArray(extraction.paginas))
      throw fail('IA256_EXTRACCION_INTEGRIDAD_FALLIDA');
    const output=await analizar(Object.freeze({paginas:[...extraction.paginas],catalogo:CATALOGO}),args);
    const observations=validarObservaciones(output,extraction.paginas);
    // La procedencia NO proviene del LLM ni de un callback no confiable.
    // Comprobar nuevamente contra el oráculo literal de la MISMA versión;
    // una sugerencia parcial, modificada o de otro perfil no se acredita.
    const {analizarDuplicadosDeterminista}=require('./g3-ollama-mic74-257');
    const certificado=validarObservaciones(
      analizarDuplicadosDeterminista(extraction.paginas),extraction.paginas);
    if(JSON.stringify(observations)!==JSON.stringify(certificado))
      throw fail('IA261_METODO_NO_ACREDITADO');
    const result=await liquidar(db,{trabajoId:lease.trabajoId,proyectoId:lease.proyectoId,
      token:lease.token,ahora:new Date(),publicar:prepararPublicacion({observaciones:observations,
        versionId:lease.versionId,sha256:lease.sha256})});
    return {estado:result.estado,publicado:result.publicado===true};
  }catch(e){
    // Ningún dato del documento, respuesta del modelo, stack o prompt se registra.
    // Un commit SQL de resultado incierto NO se reconcilia reintentando a ciegas.
    const failure=typeof e?.code==='string'&&/^(?:IA(?:256)?|PDF)_[A-Z0-9_]{3,72}$/.test(e.code)
      ?'IA256_ANALISIS_NO_VALIDADO':'IA256_EJECUCION_FALLIDA';
    try{
      const result=await liquidar(db,{trabajoId:lease.trabajoId,proyectoId:lease.proyectoId,
        token:lease.token,ahora:new Date(),falloCodigo:failure});
      return {estado:result.estado,publicado:false,errorCodigo:failure};
    }catch{
      // El fallo al liquidar no autoriza borrar reserva ni marcarla a mano.
      return {estado:'ESTADO_INCIERTO',publicado:false,errorCodigo:'IA256_COMMIT_NO_CONFIRMADO'};
    }
  }
}
module.exports={CATALOGO,TIPOS,METODO,PERFIL,validarObservaciones,prepararPublicacion,ejecutarUna};
