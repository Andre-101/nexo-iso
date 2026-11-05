'use strict';
/**
 * F3-ANA-261 | Coordinador de UN ciclo de laboratorio sintético, sin cron,
 * API, servicio de fondo ni descarga de modelos. La interfaz pública real
 * NO importa este módulo. Cualquier uso fuera de BE01 devuelve INACTIVO.
 *
 * Únicamente une componentes ya existentes: evento G2 confirmado -> bandeja
 * durable -> reserva con fencing -> extracción íntegra -> oráculo MIC-74-04 ->
 * publicación atómica. No decide reintentos ni convierte IA en aprobación.
 */
const {registrarLote}=require('./g3-bandeja-eventos-254');
const {ejecutarUna}=require('./g3-resultados-automaticos-256');
const {crearAdaptadores}=require('./g3-ollama-mic74-257');
function habilitado(entorno){
  return entorno?.NODE_ENV==='test' && entorno?.BE01_MIGRATION_LAB==='1' &&
    entorno?.BE01_PG_INTEGRATION==='1' && typeof entorno.BE01_RUN_ID==='string' &&
    /^[a-f0-9]{12}$/.test(entorno.BE01_RUN_ID);
}
function validarLimite(limite){
  if(!Number.isSafeInteger(limite)||limite<1||limite>10)
    throw new TypeError('IA261_LIMITE_INVALIDO');
}
async function ejecutarCicloSintetico(db,{entorno=process.env,limite=5,extraerPdf,
  registrar=registrarLote,despachar=ejecutarUna,crear=crearAdaptadores}={}){
  // Corte ANTES de leer o escribir cualquier fila cuando no es el
  // laboratorio autorizado; no equivale a una autorización de datos reales.
  if(!habilitado(entorno))return {estado:'INACTIVO',procesados:0,publicado:false};
  validarLimite(limite);
  if(!db||typeof registrar!=='function'||typeof despachar!=='function'||typeof crear!=='function')
    throw TypeError('IA261_DEPENDENCIAS_INVALIDAS');
  // No se acepta analizar() ni una función suministrada por un usuario HTTP.
  // El propio publicador IA256 vuelve a acreditar el resultado determinista.
  const adaptadores=crear(db,extraerPdf===undefined?{}:{extraerPdf});
  if(typeof adaptadores?.extraer!=='function'||typeof adaptadores?.analizar!=='function')
    throw TypeError('IA261_ADAPTADORES_INVALIDOS');
  const ingesta=await registrar(db,{limite});
  if(!ingesta||!Array.isArray(ingesta.items)||!Number.isSafeInteger(ingesta.procesados) ||
     ingesta.procesados<0||ingesta.procesados>limite||ingesta.items.length!==ingesta.procesados)
    throw Error('IA261_INGESTA_NO_CONFIRMADA');
  if(ingesta.items.some(i=>i?.estado==='CONFLICTO_REINTENTABLE'))
    return {estado:'CONFLICTO_INGESTA',procesados:ingesta.procesados,publicado:false};
  // Un SOLO intento controlado; no recorre la cola en bucle. Un próximo ciclo
  // es una operación distinta y NO reencola estados terminales.
  const result=await despachar(db,{extraer:adaptadores.extraer,analizar:adaptadores.analizar});
  const permitidos=new Set(['SIN_TRABAJOS','CANCELADO','LISTO','FALLIDO','OBSOLETO',
    'LEASE_VENCIDO','ESTADO_INCIERTO']);
  if(!permitidos.has(result?.estado))throw Error('IA261_RESULTADO_DESCONOCIDO');
  return {estado:result.estado,procesados:ingesta.procesados,publicado:result.estado==='LISTO'&&result.publicado===true};
}
module.exports={habilitado,ejecutarCicloSintetico};
