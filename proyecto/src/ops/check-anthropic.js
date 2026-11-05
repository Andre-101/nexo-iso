'use strict';
// Prueba manual opt-in con texto 100% ficticio; puede generar coste mínimo de API.
const {pedirHaiku,estado}=require('../utils/proveedor-ia-348');
async function main(){
 const config=estado();
 if(!config.habilitada||!config.externo||!config.transferenciaHabilitada){
  console.error('NEXO_AI_CHECK: CONFIGURACION_NO_HABILITADA');process.exitCode=2;return;
 }
 await pedirHaiku({
  prompt:'PRUEBA TECNICA CON DATOS INVENTADOS. Criterio: "Se registran los cambios en el registro ficticio". Documento inventado: "Cada cambio tiene un registro fechado". Responde exclusivamente {"hallazgos":[]}.',
  criteria:['Se registran los cambios en el registro ficticio'],
  validateOutput:(result)=>{
   if(!result||!Array.isArray(result.hallazgos)||result.hallazgos.length!==0)throw Object.assign(new Error('IA_PRUEBA_FORMATO_NO_CONFORME'),{code:'IA_PRUEBA_FORMATO_NO_CONFORME'});
   return result;
  }
 });
 console.log('NEXO_AI_CHECK: API_ANTHROPIC_OK (solicitud real sintética, respuesta estructurada validada; no comprueba datos de clientes)');
}
main().catch(e=>{console.error('NEXO_AI_CHECK:',e.code||'IA_ERROR_CONTROLADO');process.exitCode=1;});
