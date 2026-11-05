'use strict';
const prisma=require('../config/prisma');
const {triajeAutorizadoIA347}=require('../utils/g3-triaje-autorizado-347');
function parseIds(s){if(typeof s!=='string'||s.length>550||!/^[1-9]\d*(,[1-9]\d*){0,49}$/.test(s))return null;
 const a=s.split(',').map(Number);return a.every(Number.isSafeInteger)&&new Set(a).size===a.length?a:null;}
async function consultar(req,res){
 const proyectoId=Number(req.params.proyectoId),trabajoIds=parseIds(req.query.ids);
 if(!trabajoIds||!Number.isSafeInteger(proyectoId)||proyectoId<1)return res.status(400).json({code:'IA347_PARAMETROS_INVALIDOS'});
 try{
  const resumen=await triajeAutorizadoIA347(prisma,{proyectoId,actorId:req.usuario?.id,trabajoIds});
  res.set('Cache-Control','no-store');return res.json(resumen);
 }catch(e){
  if(e?.status===400)return res.status(400).json({code:'IA347_PARAMETROS_INVALIDOS'});
  if(e?.status===403)return res.status(403).json({code:'IA347_ACCESO_DENEGADO'});
  throw e;
 }
}
module.exports={consultar};
