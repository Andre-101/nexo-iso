'use strict';
const {normalizarNit}=require('../utils/registro-empresarial');
const {consultarFuenteExterna348}=require('./proveedor-registral-externo-348');
const {dataMode}=require('../utils/data-mode');
/** Same HTTP interface for dedicated synthetic DB adapter and authorized external gateway. */
async function consultar(nit,{env=process.env,fetchImpl=fetch}={}){
 const clave=normalizarNit(nit);
 if(!clave)return {tipo:'ERROR',codigo:'NIT_INVALIDO'};
 const mode=dataMode(env);
 if(mode==='production'&&!/^[0-9]{6,12}(?:-[0-9])?$/.test(clave))return {tipo:'ERROR',codigo:'NIT_REAL_INVALIDO'};
 if(mode==='demo'&&!/^SIM-[0-9]{4}$/.test(clave))return {tipo:'ERROR',codigo:'NIT_DE_PRUEBA_REQUERIDO'};
 try{return await consultarFuenteExterna348(clave,{env,fetchImpl,mode});}
 catch{return {tipo:'ERROR',codigo:'PROVEEDOR_NO_CONFIGURADO'};}
}
module.exports={consultar};
