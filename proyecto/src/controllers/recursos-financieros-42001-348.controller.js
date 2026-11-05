'use strict';
const {autorizar}=require('../utils/proyecto-acceso');
const {consultarRecursos}=require('../utils/recursos-financieros-42001-348');
async function consultar(req,res){
 const acceso=await autorizar(req,res);if(!acceso)return;
 if(acceso.proyecto.normaCodigo!=='ISO_42001'||acceso.proyecto.edicionNormativa!=='2023')
  return res.status(409).json({code:'PROYECTO_NO_ES_42001'});
 if(!acceso.rol.admin&&!acceso.rol.lider)return res.status(403).json({code:'FINANZAS_ROL_NO_AUTORIZADO'});
 res.set('Cache-Control','no-store');
 try{return res.json(await consultarRecursos(acceso.proyecto.empresa.nit,{nombreEsperado:acceso.proyecto.empresa.nombre}));}
 catch(e){return res.status(e.status===422?422:503).json({code:e.code||'FUENTE_FINANCIERA_NO_DISPONIBLE',
  alertas:[{codigo:'FUENTE_NO_DISPONIBLE',nivel:'revision',mensaje:'Verificar la información de recursos mediante evidencia autorizada; no se puede inferir su suficiencia.'}]});}
}
module.exports={consultar};
