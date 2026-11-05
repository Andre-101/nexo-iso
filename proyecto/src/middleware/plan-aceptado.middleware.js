/** REQ-02: no ejecución de trabajo sin la versión expresamente aceptada.
 * El plan se verifica en servidor en cada intento de crear/revisar evidencia/IA.
 * A diferencia de la propuesta, la aceptación externa no la representa un JWT del cliente.
 */
const prisma=require('../config/prisma');
const {idValido}=require('../utils/access');
const {autorizar}=require('../utils/proyecto-acceso');
async function exigirPlanAceptado(req,res,next){
 const acceso=await autorizar(req,res,{activo:true});if(!acceso)return;
 const pid=acceso.proyecto.id;
 let activityId=idValido(req.params.actividadId);
 if(!activityId && req.params.entregableId){
  const e=await prisma.entregableProyecto.findFirst({where:{id:idValido(req.params.entregableId)||-1,proyectoId:pid},select:{actividadId:true}});
  activityId=e?.actividadId;
 }
 if(!activityId && req.params.versionId){
  const v=await prisma.documentoVersionProyecto.findFirst({where:{id:idValido(req.params.versionId)||-1,proyectoId:pid},include:{entregable:{select:{actividadId:true}}}});
  activityId=v?.entregable?.actividadId;
 }
 if(!activityId)return res.status(404).json({message:'No se encontró actividad asociada a la operación.'});
 const act=await prisma.actividadProyecto.findFirst({where:{id:activityId,proyectoId:pid},select:{planAceptadoId:true}});
 if(!act)return res.status(404).json({message:'Actividad no encontrada.'});
 if(!act.planAceptadoId)return res.status(409).json({message:'REQ-02: la actividad requiere constancia de aceptación externa en una versión del plan.'});
 const plan=await prisma.versionPlanProyecto.findFirst({where:{id:act.planAceptadoId,proyectoId:pid,estado:'ACEPTADO'},select:{id:true}});
 if(!plan)return res.status(409).json({message:'No existe plan aceptado que cubra la actividad.'});
 next();
}
async function exigirPlanBrecha(req,res,next){
 const acceso=await autorizar(req,res,{activo:true});if(!acceso)return;
 const pid=acceso.proyecto.id,bid=idValido(req.params.brechaId);
 if(!bid)return res.status(400).json({message:'Brecha inválida.'});
 const links=await prisma.actividadBrechaProyecto.findMany({where:{proyectoId:pid,brechaId:bid,excluidaEn:null},
  include:{actividad:{select:{id:true,estado:true,planAceptadoId:true}}}});
 const computables=links.map(x=>x.actividad).filter(x=>x.estado!=='CANCELADA');
 if(computables.some(x=>!x.planAceptadoId))return res.status(409).json({message:'REQ-02: hay actividades de esta brecha que no están cubiertas por un plan aceptado.'});
 const ids=[...new Set(computables.map(x=>x.planAceptadoId))];
 if(ids.length){
  const aprobadas=await prisma.versionPlanProyecto.count({where:{proyectoId:pid,id:{in:ids},estado:'ACEPTADO'}});
  if(aprobadas!==ids.length)return res.status(409).json({message:'Plan de actividades sin aceptación registrada.'});
 }
 next();
}
module.exports={exigirPlanAceptado,exigirPlanBrecha};
