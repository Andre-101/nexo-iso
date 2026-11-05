'use strict';
const {dataMode,externalUrl,longToken}=require('../utils/data-mode');
/** Contract GET /v1/empresas?nit=... and x-adapter-token; never scrapes sites. */
async function consultarFuenteExterna348(nit,{env=process.env,fetchImpl=fetch,mode=dataMode(env)}={}){
 if(!nit)return {tipo:'ERROR',codigo:'NIT_INVALIDO'};
 let origin,token;
 if(mode==='demo'){
  origin='http://registry-demo:8091';token=env.REGISTRY_DEMO_TOKEN;
 }else if(mode==='production'){
  if(env.REGISTRY_INTEGRATION_ENABLED!=='1')return {tipo:'ERROR',codigo:'PROVEEDOR_NO_CONFIGURADO'};
  if(env.REGISTRY_LEGAL_BASIS_CONFIRMED!=='1')return {tipo:'ERROR',codigo:'FUENTE_NO_AUTORIZADA'};
  origin=externalUrl(env.REGISTRY_ADAPTER_URL);token=env.REGISTRY_ADAPTER_TOKEN;
 }else{return {tipo:'ERROR',codigo:'PROVEEDOR_NO_CONFIGURADO'};}
 if(!origin||!longToken(token))return {tipo:'ERROR',codigo:'PROVEEDOR_NO_CONFIGURADO'};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
 try{
  const response=await fetchImpl(origin+'/v1/empresas?nit='+encodeURIComponent(nit),{
   headers:{'x-adapter-token':token,Accept:'application/json'},signal:controller.signal,redirect:'error'});
  if(response.status===404)return {tipo:'NO_ENCONTRADA'};
  if(!response.ok)return {tipo:'ERROR',codigo:'PROVEEDOR_INDISPONIBLE'};
  const body=await response.text();if(body.length>10000)throw new Error('exceso');
  const parsed=JSON.parse(body);
  if(parsed?.nit!==nit||typeof parsed.nombre!=='string'||!parsed.nombre.trim()||parsed.nombre.length>200||
    typeof parsed.sector!=='string'||!parsed.sector.trim()||parsed.sector.length>160||
    typeof parsed.tamano!=='string'||!parsed.tamano.trim()||parsed.tamano.length>100)
   return {tipo:'ERROR',codigo:'FUENTE_RESPUESTA_INVALIDA'};
  return {tipo:'ENCONTRADA',datos:{nit,nombre:parsed.nombre,sector:parsed.sector,tamano:parsed.tamano}};
 }catch{return {tipo:'ERROR',codigo:'PROVEEDOR_INDISPONIBLE'};}
 finally{clearTimeout(timer);}
}
module.exports={consultarFuenteExterna348};
