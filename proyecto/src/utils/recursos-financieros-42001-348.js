'use strict';
const DAY=86400000;
const {dataMode,externalUrl,longToken}=require('./data-mode');
function problema(code,status=503){return Object.assign(new Error(code),{code,status});}
function origenFinanciero(env=process.env){
 const mode=dataMode(env);
 if(mode==='demo'){
  if(!longToken(env.FINANCE_ADAPTER_TOKEN))throw problema('FUENTE_FINANCIERA_CREDENCIAL_AUSENTE');
  return {source:'demo',url:'http://finance-demo:8090',token:env.FINANCE_ADAPTER_TOKEN};
 }
 if(env.FINANCE_INTEGRATION_ENABLED!=='1')return null; // Desactivado, nunca inventar cifras.
 if(env.FINANCE_LEGAL_BASIS_CONFIRMED!=='1')throw problema('FUENTE_FINANCIERA_NO_AUTORIZADA');
 const url=externalUrl(env.FINANCE_REAL_URL);
 if(!url)throw problema('FUENTE_FINANCIERA_TLS_OBLIGATORIO');
 if(!longToken(env.FINANCE_REAL_TOKEN))throw problema('FUENTE_FINANCIERA_CREDENCIAL_AUSENTE');
 return {source:'external',url,token:env.FINANCE_REAL_TOKEN};
}
function alertasDeRecursos(data,{fecha=new Date(),fuente='demo'}={}){
 if(!data)return [{codigo:'SIN_REGISTRO',nivel:'revision',mensaje:'Sin información financiera de recursos IA: solicitar evidencia a la empresa.'}];
 for(const key of ['presupuestoAprobado','costoProyectado','reservaContingencia'])
  if(!Number.isSafeInteger(data[key])||data[key]<0||data[key]>1e14)throw problema('RESPUESTA_FINANCIERA_INVALIDA');
 if(data.moneda!=='COP'||!/^[0-9]{4}$/.test(data.periodo||'')||!/^\d{4}-\d{2}-\d{2}$/.test(data.vigenteHasta||'')||
   !/^\d{4}-\d{2}-\d{2}$/.test(data.actualizadoEl||''))throw problema('RESPUESTA_FINANCIERA_INVALIDA');
 if(!Number.isFinite(Date.parse(data.vigenteHasta))||!Number.isFinite(Date.parse(data.actualizadoEl)))throw problema('RESPUESTA_FINANCIERA_INVALIDA');
 const a=[];
 const hoy=new Date(fecha).getTime();
 if(Date.parse(data.vigenteHasta+'T00:00:00Z')<hoy)
  a.push({codigo:'VIGENCIA_VENCIDA',nivel:'revision',mensaje:'El periodo de recursos documentado ya venció.'});
 if(hoy-Date.parse(data.actualizadoEl+'T00:00:00Z')>180*DAY)
  a.push({codigo:'DATOS_DESACTUALIZADOS',nivel:'revision',mensaje:'La constancia de recursos requiere actualización.'});
 if(data.presupuestoAprobado===0)a.push({codigo:'SIN_PRESUPUESTO_IDENTIFICADO',nivel:'revision',mensaje:'No se identifica presupuesto aprobado para actividades de IA.'});
 if(data.costoProyectado>data.presupuestoAprobado)
  a.push({codigo:'BRECHA_DE_RECURSOS',nivel:'revision',mensaje:'El costo proyectado supera el presupuesto declarado; requiere explicación y decisión humana.'});
 if(data.reservaContingencia===0)
  a.push({codigo:'CONTINGENCIA_NO_DOCUMENTADA',nivel:'informativa',mensaje:'No se documentó reserva para contingencias de IA.'});
 if(fuente==='demo'||data.origen==='SINTETICO')
  a.push({codigo:'FUENTE_SINTETICA',nivel:'informativa',mensaje:'Datos inventados; no representan la situación financiera de una empresa.'});
 a.push({codigo:'REVISION_HUMANA_REQUERIDA',nivel:'informativa',mensaje:'El contexto, evidencia y suficiencia de recursos deben revisarse profesionalmente; no hay decisión automática.'});
 return a;
}
async function consultarRecursos(nit,{env=process.env,fetchImpl=fetch,nombreEsperado=null}={}){
 if(typeof nit!=='string'||!/^[0-9A-Za-z-]{3,32}$/.test(nit))throw problema('NIT_NO_VALIDO',422);
 const mode=dataMode(env);
 if(mode==='production'&&!/^[0-9]{6,12}(?:-[0-9])?$/.test(nit))throw problema('NIT_REAL_INVALIDO',422);
 if(mode==='demo'&&!/^SIM-[0-9]{4}$/.test(nit))throw problema('NIT_DE_PRUEBA_REQUERIDO',422);
 const source=origenFinanciero(env);
 if(!source)return {estado:'NO_CONFIGURADO',alertas:[{codigo:'PROVEEDOR_DESACTIVADO',nivel:'revision',mensaje:'El proveedor financiero está desactivado.'}]};
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),4000);
 try{
  const r=await fetchImpl(`${source.url}/v1/recursos?nit=${encodeURIComponent(nit)}`,{
   headers:{'x-adapter-token':source.token,'Accept':'application/json'},signal:controller.signal,redirect:'error'});
  if(r.status===404)return {estado:'SIN_REGISTRO',fuente:source.source,alertas:alertasDeRecursos(null)};
  if(!r.ok)throw problema('FUENTE_FINANCIERA_NO_DISPONIBLE');
  const body=await r.text();if(body.length>12000)throw problema('RESPUESTA_FINANCIERA_INVALIDA');
  let data;try{data=JSON.parse(body);}catch{throw problema('RESPUESTA_FINANCIERA_INVALIDA');}
  if(!data||typeof data!=='object'||Array.isArray(data)||data.nit!==nit||
     typeof data.nombre!=='string'||!data.nombre.trim()||data.nombre.length>200||
     (source.source==='external'&&data.origen==='SINTETICO'))throw problema('RESPUESTA_FINANCIERA_INVALIDA');
  const alertas=alertasDeRecursos(data,{fuente:source.source});
  const comparable=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const identidadDivergente=nombreEsperado!=null&&comparable(nombreEsperado)!==comparable(data.nombre);
  if(identidadDivergente)alertas.unshift({codigo:'IDENTIDAD_EMPRESA_DIVERGENTE',nivel:'revision',mensaje:'El nombre de la empresa no coincide entre NEXO y la fuente financiera; requiere conciliación humana.'});
  return {estado:identidadDivergente?'DATOS_DIVERGENTES':'INFORMATIVO_REQUIERE_VALIDACION',fuente:source.source,nit:data.nit,nombre:data.nombre,
   periodo:data.periodo,moneda:data.moneda,presupuestoAprobado:data.presupuestoAprobado,
   costoProyectado:data.costoProyectado,reservaContingencia:data.reservaContingencia,
   vigenteHasta:data.vigenteHasta,actualizadoEl:data.actualizadoEl,
   referenciaEvidencia:typeof data.evidencia==='string'?data.evidencia.slice(0,100):null,
   verificado:false,conclusionAutomatica:false,alertas};
 }catch(e){if(e.code)throw e;throw problema('FUENTE_FINANCIERA_NO_DISPONIBLE');}
 finally{clearTimeout(timer);}
}
module.exports={consultarRecursos,alertasDeRecursos,origenFinanciero};
