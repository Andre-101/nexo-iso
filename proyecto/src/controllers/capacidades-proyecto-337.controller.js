'use strict';
/** Endpoint de CONSULTA exclusivamente: no activa instrumentos, VIS ni IA. */
const {autorizar}=require('../utils/proyecto-acceso');
const {capacidadesProyecto}=require('../utils/capacidades-normativas-337');
async function consultar(req,res){
  const acceso=await autorizar(req,res);
  if(!acceso)return;
  // No enviar empresa, participaciones, texto contractual ni identificadores de usuarios.
  res.set('Cache-Control','no-store');
  return res.json(capacidadesProyecto(acceso.proyecto));
}
module.exports={consultar};
