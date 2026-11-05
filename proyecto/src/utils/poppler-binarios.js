'use strict';
/**
 * Resolver único de las herramientas Poppler para G3 y el laboratorio BE01.
 * POPPLER_BIN es una carpeta ABSOLUTA del operador, nunca un argumento del PDF.
 * No modifica PATH, instala paquetes ni inicia procesos por sí mismo.
 */
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const VALIDOS=new Set(['pdfinfo','pdftotext']);
function rutaPoppler(nombre,{env=process.env,platform=process.platform}={}) {
  if(!VALIDOS.has(nombre))throw new Error('POPPLER_BINARIO_NO_PERMITIDO');
  const folder=env.POPPLER_BIN;
  if(folder===undefined||folder==='')return nombre;
  const sistema=platform==='win32'?path.win32:path.posix;
  if(typeof folder!=='string'||!sistema.isAbsolute(folder)||folder.includes('\0'))
    throw new Error('POPPLER_DIRECTORIO_INVALIDO');
  return sistema.join(folder,nombre+(platform==='win32'?'.exe':''));
}
function popplerDisponible({env=process.env,platform=process.platform,exec=spawnSync}={}) {
  try{
    return [...VALIDOS].every(nombre=>{
      const res=exec(rutaPoppler(nombre,{env,platform}),['-v'],{
        encoding:'utf8',timeout:5000,windowsHide:true,
      });
      return !res.error&&!res.signal&&res.status===0;
    });
  }catch{return false;}
}
module.exports={rutaPoppler,popplerDisponible};
