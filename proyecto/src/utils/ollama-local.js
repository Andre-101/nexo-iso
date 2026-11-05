'use strict';
/**
 * G3 local-only Ollama compatibility gate. No pull, no model execution and no
 * external endpoints. Validation of the server is NOT authentication of its
 * operator and does not authorize real documents (RB-05 remains open).
 */
const EXPECTED_MODEL='qwen2.5:1.5b';
const MIN_VERSION=[0,5,0]; // Ollama 0.5.0 introduced JSON schema structured outputs.
const REFERENCE_VERSION='0.40.11'; // Última versión observada en GitHub Releases, corte 26-10-2026; NO fija requisito de actualización.
const HOSTS=new Set(['127.0.0.1','localhost','host.docker.internal','ollama']);
function problem(code){const e=new Error(code);e.code=code;e.http=503;return e;}
function config(base=process.env.OLLAMA_URL||'http://host.docker.internal:11434',model=process.env.OLLAMA_MODEL||EXPECTED_MODEL){
  let url;
  try {url=new URL(base);}catch{throw problem('IA_OLLAMA_URL_INVALIDA');}
  if(url.protocol!=='http:'||!HOSTS.has(url.hostname)||url.username||url.password||
      url.pathname!=='/'||url.search||url.hash||!(Number(url.port||80)>0)||
      url.port!=='11434') throw problem('IA_OLLAMA_HOST_NO_PERMITIDO');
  if(model!==EXPECTED_MODEL)throw problem('IA_MODELO_G3_INCORRECTO');
  return {origin:url.origin,model};
}
function versionParts(s){
  const match=/^v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/.exec(String(s||''));
  if(!match)return null;
  const nums=match.slice(1,4).map(Number);
  return nums.every(Number.isSafeInteger)?nums:null;
}
function compareVersion(a,b){
  const x=versionParts(a),y=versionParts(b);if(!x||!y)return null;
  for(let i=0;i<3;i++)if(x[i]!==y[i])return Math.sign(x[i]-y[i]);
  return 0;
}
function compatible(version){
  const parts=versionParts(version);
  if(!parts)return false;
  for(let i=0;i<3;i++){if(parts[i]!==MIN_VERSION[i])return parts[i]>MIN_VERSION[i];}
  return true;
}
async function jsonRequest(url,{method='GET',body,fetchImpl=fetch,timeoutMs=5000}={}){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetchImpl(url,{method,redirect:'error',signal:controller.signal,
      headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok)throw problem('IA_OLLAMA_ENDPOINT_FALLIDO');
    if(!response.body?.getReader)throw problem('IA_OLLAMA_RESPUESTA_INVALIDA');
    const reader=response.body.getReader();let size=0;const parts=[];
    while(true){const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>128*1024){await reader.cancel();throw problem('IA_OLLAMA_RESPUESTA_EXCESIVA');}
      parts.push(Buffer.from(value));}
    const data=JSON.parse(Buffer.concat(parts).toString('utf8'));
    if(!data||typeof data!=='object'||Array.isArray(data))throw problem('IA_OLLAMA_RESPUESTA_INVALIDA');
    return data;
  }catch(e){if(e.code?.startsWith('IA_'))throw e;
    throw problem(e.name==='AbortError'?'IA_OLLAMA_TIEMPO_AGOTADO':'IA_OLLAMA_NO_DISPONIBLE');}
  finally{clearTimeout(timer);}
}
async function inspect({base,model,fetchImpl,timeoutMs}={}){
  const {origin,model:expected}=config(base,model);
  const opt={fetchImpl,timeoutMs};
  const v=await jsonRequest(`${origin}/api/version`,opt);
  const serverVersion=String(v.version||'');
  if(/-/.test(serverVersion))throw problem('IA_OLLAMA_VERSION_PRERRELEASE_NO_VALIDADA');
  if(!compatible(serverVersion))throw problem('IA_OLLAMA_VERSION_INCOMPATIBLE');
  const tags=await jsonRequest(`${origin}/api/tags`,opt);
  if(!Array.isArray(tags.models))throw problem('IA_OLLAMA_MODELOS_INVALIDOS');
  const match=tags.models.find(x=>x && (x.name===expected||x.model===expected));
  if(!match)throw problem('IA_OLLAMA_MODELO_NO_INSTALADO');
  // Confirm exact model family/size, not just a user-provided alias/tag.
  if(!/^sha256:?[a-f0-9]{64}$/i.test(String(match.digest||'')) && !/^[a-f0-9]{64}$/i.test(String(match.digest||'')))
    throw problem('IA_OLLAMA_DIGEST_INVALIDO');
  const info=await jsonRequest(`${origin}/api/show`,{...opt,method:'POST',body:{model:expected}});
  const details=info.details||{};
  if(!/^qwen2(?:\.5)?$/i.test(String(details.family||'')) || !/^1[.,]5\s*B$/i.test(String(details.parameter_size||'')))
    throw problem('IA_OLLAMA_MODELO_NO_CORRESPONDE');
  if(match.details?.family && String(match.details.family).toLowerCase()!==String(details.family).toLowerCase())
    throw problem('IA_OLLAMA_METADATOS_INCONSISTENTES');
  if(match.details?.parameter_size && String(match.details.parameter_size)!==String(details.parameter_size))
    throw problem('IA_OLLAMA_METADATOS_INCONSISTENTES');
  return {estado:'COMPATIBLE',endpoint:origin,version:serverVersion,
    versionReferenciaFecha:'2026-10-26',versionReferenciaGitHub:REFERENCE_VERSION,
    actualizacionDisponibleAlCorte:compareVersion(serverVersion,REFERENCE_VERSION)<0,modelo:expected,
    digest:String(match.digest),familia:String(details.family),parametros:String(details.parameter_size),
    informacion:'No se ejecutó inferencia; no acredita calidad, conectividad desde Docker ni datos reales.'};
}
/**
 * Sonda activa F3-ANA-252: SOLO texto ficticio fijo, no documentos, no PDF,
 * no base de datos, no cambio de configuración ni descargas de modelos.
 * Verifica contrato de /api/generate y estabilidad de identidad antes/después.
 * No sustituye pruebas de calidad ni autorización para clientes.
 */
async function probeSynthetic({base='http://127.0.0.1:11434',fetchImpl=fetch,timeoutMs=120000}={}){
  const before=await inspect({base,model:EXPECTED_MODEL,fetchImpl,timeoutMs:5000});
  const {origin,model}=config(base,EXPECTED_MODEL);
  const format={type:'object',additionalProperties:false,properties:{estado:{type:'string',enum:['LISTO']},
    prueba:{type:'string',enum:['FICTICIA']}},required:['estado','prueba']};
  // Ningún dato externo ni proporcionado por el usuario forma parte del prompt.
  const response=await jsonRequest(`${origin}/api/generate`,{fetchImpl,timeoutMs,method:'POST',body:{
    model,stream:false,format,options:{temperature:0,num_predict:80},
    system:'Prueba técnica local con datos inventados. Devuelve exclusivamente el JSON solicitado. No uses herramientas ni datos del equipo.',
    prompt:'Esta es una prueba FICTICIA, sin documentos ni clientes. Devuelve el objeto JSON exacto: {"estado":"LISTO","prueba":"FICTICIA"}.'
  }});
  if(response.model!==model)throw problem('IA_OLLAMA_RESPUESTA_MODELO_INCORRECTO');
  if(response.done!==true || (response.done_reason!==undefined && response.done_reason!=='stop'))
    throw problem('IA_OLLAMA_GENERACION_INCOMPLETA');
  if(typeof response.response!=='string'||response.response.length>3000)
    throw problem('IA_OLLAMA_SALIDA_INVALIDA');
  let output;try{output=JSON.parse(response.response);}catch{throw problem('IA_OLLAMA_JSON_INVALIDO');}
  if(!output||typeof output!=='object'||Array.isArray(output)||Object.keys(output).length!==2||
      output.estado!=='LISTO'||output.prueba!=='FICTICIA')throw problem('IA_OLLAMA_CONTRATO_SINTETICO_INVALIDO');
  const after=await inspect({base,model:EXPECTED_MODEL,fetchImpl,timeoutMs:5000});
  if(after.digest!==before.digest||after.version!==before.version)
    throw problem('IA_OLLAMA_IDENTIDAD_CAMBIO_DURANTE_PRUEBA');
  return {estado:'COMPATIBLE_INFERENCIA_SINTETICA',modelo:model,version:before.version,digest:before.digest,
    protocolo:'POST /api/generate; stream=false; JSON Schema',
    inferencia:'ESTRUCTURA_FICTICIA_VERIFICADA',
    alcance:'Sin PDF, sin datos reales, sin autorización de producción ni verificación de calidad documental.'};
}

module.exports={EXPECTED_MODEL,MIN_VERSION,REFERENCE_VERSION,config,versionParts,compareVersion,compatible,inspect,probeSynthetic,problem};
