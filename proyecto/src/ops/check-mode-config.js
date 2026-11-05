'use strict';
try{
 const mode=require('../utils/data-mode').checkMode(process.env);
 console.log('NEXO_DATA_MODE: '+mode.toUpperCase()+'_CONFIG_OK');
}catch(e){console.error('NEXO_DATA_MODE:',e.code||'CONFIGURACION_INVALIDA');process.exitCode=2;}
