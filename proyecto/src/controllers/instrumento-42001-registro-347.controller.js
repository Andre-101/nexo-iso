'use strict';
const prisma=require('../config/prisma');
const {registrarBorrador42001_347}=require('../utils/instrumento-42001-registro-347');
async function registrar(req,res){
 try{
  const r=await registrarBorrador42001_347(prisma,{proyectoId:Number(req.params.proyectoId),
   actorId:req.usuario?.id,items:req.body?.items,huellaAnterior:req.body?.huellaAnterior??null});
  res.set('Cache-Control','no-store');return res.status(r.reutilizado?200:201).json(r);
 }catch(e){
  if([400,403,409,422].includes(e?.status))return res.status(e.status).json({code:e.message});
  throw e;
 }
}
module.exports={registrar};
