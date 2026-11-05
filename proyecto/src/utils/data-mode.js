'use strict';
const net=require('node:net');
/** Controlled selection of synthetic or contracted external sources. No implicit fallback. */
function dataMode(env=process.env){
 const raw=env.DATA_MODE;
 if(raw===undefined||raw===''){
  if(['external','disabled'].includes(env.REGISTRY_SOURCE)||['external','disabled'].includes(env.FINANCE_SOURCE))
   throw Object.assign(new Error('DATA_MODE_REQUERIDO_PARA_CONFIGURACION_LEGADA'),{code:'DATA_MODE_REQUERIDO'});
  return 'demo'; // compatibility with existing installations of the old demo distribution
 }
 if(raw==='demo'||raw==='production')return raw;
 throw Object.assign(new Error('DATA_MODE_INVALIDO'),{code:'DATA_MODE_INVALIDO'});
}
function externalUrl(raw){
 let u;try{u=new URL(raw);}catch{return null;}
 if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!u.hostname.includes('.'))return null;
 if(net.isIP(u.hostname)||u.hostname.endsWith('.local')||u.hostname.endsWith('.internal')||u.hostname.endsWith('.localhost')||
    ['localhost','host.docker.internal','finance-demo','registry-demo','finance-db-demo','registry-db-demo'].includes(u.hostname))return null;
 return u.origin;
}
function longToken(value){return typeof value==='string'&&value.length>=32&&!/\s/.test(value);}
function checkMode(env=process.env){
 const mode=dataMode(env);
 if(mode==='production'){
  for(const name of ['REGISTRY_INTEGRATION_ENABLED','FINANCE_INTEGRATION_ENABLED'])
   if(!['0','1',undefined].includes(env[name]))throw Object.assign(new Error('INDICADOR_INTEGRACION_INVALIDO'),{code:'INDICADOR_INTEGRACION_INVALIDO'});
  // Sin gateway contratado: función no disponible. NUNCA simular datos en producción.
  if(env.REGISTRY_INTEGRATION_ENABLED==='1'&&
     (!externalUrl(env.REGISTRY_ADAPTER_URL)||!longToken(env.REGISTRY_ADAPTER_TOKEN)||env.REGISTRY_LEGAL_BASIS_CONFIRMED!=='1'))
    throw Object.assign(new Error('REGISTRO_REAL_NO_CONFIGURADO'),{code:'REGISTRO_REAL_NO_CONFIGURADO'});
  if(env.FINANCE_INTEGRATION_ENABLED==='1'&&
     (!externalUrl(env.FINANCE_REAL_URL)||!longToken(env.FINANCE_REAL_TOKEN)||env.FINANCE_LEGAL_BASIS_CONFIRMED!=='1'))
    throw Object.assign(new Error('FINANZAS_REALES_NO_CONFIGURADAS'),{code:'FINANZAS_REALES_NO_CONFIGURADAS'});
 }else{
  if(!longToken(env.REGISTRY_DEMO_TOKEN)||!longToken(env.FINANCE_ADAPTER_TOKEN))throw Object.assign(new Error('TOKENS_DEMO_NO_CONFIGURADOS'),{code:'TOKENS_DEMO_NO_CONFIGURADOS'});
 }
 return mode;
}
module.exports={dataMode,externalUrl,longToken,checkMode};
