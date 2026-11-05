'use strict';
/**
 * F3-ANA-300 — adaptador INTERNO de clasificación de borradores VIS.
 * Las comprobaciones de identidad y bytes se realizan dentro de la transacción
 * invocada por VIS294; no se aceptan hechos ni callbacks de una solicitud HTTP.
 *
 * La clasificación no aprueba, publica, escanea ni autoriza descargar PDFs.
 * Antes de cualquier futura publicación hay que repetir todos los controles
 * de permisos, versiones, aceptación, tiempo y contenido no malicioso.
 */
const {consultarIdentidadPiezaVIS}=require('./vis-fuente-documental-295');
const {leerPdfPrivadoVerificadoVIS}=require('./vis-binarios-privados-296');
const {clasificarComunicableVIS}=require('./vis-gobierno-recurso-294');
const INT=x=>Number.isInteger(x)&&x>0&&x<=2147483647;
const fallo=code=>Object.assign(new Error(code),{code});

async function consultarFuenteAcreditadaVIS({tx,proyectoId,recursoId,directorioPrivado}={}){
  if(!INT(proyectoId)||!INT(recursoId)||
     typeof tx?.archivoPrivadoVersionVIS?.findUnique!=='function')
    throw fallo('VIS300_FUENTE_NO_DISPONIBLE');
  const fuente=await consultarIdentidadPiezaVIS({tx,proyectoId,recursoId});
  if(!fuente)return null;
  // Un registro de metadatos por sí solo NO acredita bytes ni clasificación.
  const comprobante=await tx.archivoPrivadoVersionVIS.findUnique({
    where:{versionId:fuente.versionId},
    select:{versionId:true,proyectoId:true,blobId:true,sha256:true,tamanoBytes:true,formato:true}
  });
  if(!comprobante||comprobante.proyectoId!==proyectoId||
     comprobante.versionId!==fuente.versionId||
     comprobante.sha256!==fuente.sha256||
     comprobante.tamanoBytes!==fuente.tamanoBytes||
     comprobante.formato!=='application/pdf'||
     !Number.isSafeInteger(comprobante.tamanoBytes)||comprobante.tamanoBytes<=0)
    return fuente;
  // La integridad se acredita sobre el MISMO descriptor de lectura. La copia de
  // bytes se descarta aquí: no debe retornar contenido ni identificadores internos.
  await leerPdfPrivadoVerificadoVIS({directorioPrivado,blobId:comprobante.blobId,
    sha256:comprobante.sha256,tamanoBytes:comprobante.tamanoBytes});
  return Object.freeze({...fuente,versionIntacta:true,clasificable:true,
    integridadAcreditada:true,publicacionVigente:false});
}

/** ÚNICA entrada interna confiable de clasificación a partir de la fuente canónica. */
async function clasificarPiezaVerificadaVIS({db,proyectoId,recursoId,actorId,directorioPrivado,
  reloj,intentos}={}){
  if(!INT(proyectoId)||!INT(recursoId)||!INT(actorId)||
     !db||typeof db.$transaction!=='function'||
     typeof directorioPrivado!=='string'||!directorioPrivado)
    throw fallo('VIS300_SOLICITUD_INVALIDA');
  return clasificarComunicableVIS({db,proyectoId,recursoId,actorId,reloj,intentos,
    revalidarFuente:tx=>consultarFuenteAcreditadaVIS({tx,proyectoId,recursoId,directorioPrivado})});
}
module.exports={consultarFuenteAcreditadaVIS,clasificarPiezaVerificadaVIS};
