'use strict';
/** Tarea de una sola pasada; invocar por orquestador con periodicidad configurada.
 * Solo admite una base LOCAL y datos sintéticos. No hacer correr con variables de producción.
 * No lanza intervalos duplicados dentro de cada proceso Express.
 */
const {reconsultarUna}=require('./services/reconsulta-registral');
function preflight(env) {
  if(env.EXPERIMENTO_REGISTRAL_FICTICIO!=='SI') return {ok:false,codigo:'CONSENTIMIENTO_LAB_AUSENTE'};
  try {
    const url=new URL(env.DATABASE_URL||'');
    if(url.protocol!=='postgresql:' && url.protocol!=='postgres:') return {ok:false,codigo:'PROTOCOLO_INESPERADO'};
    if(!['127.0.0.1','localhost'].includes(url.hostname) || url.port!=='55433' ||
      url.pathname!=='/iso_be01_test') return {ok:false,codigo:'BASE_FUERA_LABORATORIO'};
    return {ok:true};
  }catch {return {ok:false,codigo:'URL_INVALIDA'};}
}
async function ejecutarLote(db,{ahora=new Date(),intervaloHoras=24,maximo=20}={}) {
  if(!Number.isFinite(intervaloHoras)||intervaloHoras<1||intervaloHoras>720 ||
      !Number.isSafeInteger(maximo)||maximo<1||maximo>100) throw new Error('CONFIG_INSEGURA');
  const corte=new Date(ahora.getTime()-intervaloHoras*3600_000);
  const empresas=await db.empresa.findMany({where:{
    origenDatos:{in:['FUENTE','ADMIN_PROVISIONAL','ADMIN_CONCILIADO']},
    OR:[{consultadaEn:null},{consultadaEn:{lte:corte}}]
  },select:{id:true},orderBy:{id:'asc'},take:maximo});
  const resultados=[];
  for(const {id} of empresas) {
    try{const r=await reconsultarUna(db,id);resultados.push({id,accion:r.accion});}
    catch(e){resultados.push({id,accion:'FALLO_CONTROLADO',codigo:'ERROR_INTERNO'});}
  }
  return {procesadas:resultados.length,resultados};
}
async function main(){
  const guard=preflight(process.env);
  if(!guard.ok){console.error('BLOQUEADO: '+guard.codigo);process.exitCode=2;return;}
  const prisma=require('./config/prisma');
  try {console.log(JSON.stringify(await ejecutarLote(prisma),null,2));}
  finally{await prisma.$disconnect();}
}
if(require.main===module)main().catch(()=>{console.error('BLOQUEADO: ERROR_INTERNO');process.exitCode=2;});
module.exports={preflight,ejecutarLote};
