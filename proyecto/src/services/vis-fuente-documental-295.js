'use strict';
/**
 * F3-ANA-295 - lectura privada de identidad documental desde PostgreSQL.
 * NO es un repositorio binario, aprobador, publicador, ni autorizador HTTP.
 * Nunca aceptar `tx` ni la identidad del recurso directamente de un body HTTP.
 * La lectura no acredita integridad física del archivo: no elevar metadatos a
 * hechos de publicación, aceptación o autorización.
 */
const id = x => Number.isInteger(x) && x > 0 && x <= 2147483647;
const huella = x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const fallo = code => Object.assign(new Error(code), {code});

async function consultarIdentidadPiezaVIS({tx,proyectoId,recursoId}={}) {
  if (!id(proyectoId) || !id(recursoId) ||
      typeof tx?.piezaComunicableVIS?.findUnique !== 'function' ||
      typeof tx?.versionPiezaComunicableVIS?.findUnique !== 'function') {
    throw fallo('VIS295_CONSULTA_NO_ACREDITADA');
  }
  // Identidad compuesta, sin consulta por ID global y sin buscar un EntregableProyecto.
  const pieza=await tx.piezaComunicableVIS.findUnique({
    where:{id_proyectoId:{id:recursoId,proyectoId}},
    select:{id:true,proyectoId:true,responsableId:true,clase:true,estado:true,numeroActual:true}
  });
  if (!pieza || pieza.proyectoId !== proyectoId || pieza.id !== recursoId ||
      !id(pieza.responsableId) || pieza.clase !== 'DOCUMENTO_CONSULTOR' ||
      pieza.estado !== 'BORRADOR' || !id(pieza.numeroActual)) return null;
  const version=await tx.versionPiezaComunicableVIS.findUnique({
    where:{piezaId_numero:{piezaId:recursoId,numero:pieza.numeroActual}},
    select:{id:true,proyectoId:true,piezaId:true,numero:true,sha256:true,
      tamanoBytes:true,estado:true,creadoPorId:true}
  });
  if(!version || !id(version.id) || version.proyectoId !== proyectoId ||
      version.piezaId !== recursoId || version.numero !== pieza.numeroActual ||
      version.estado !== 'BORRADOR' || !huella(version.sha256) ||
      !Number.isSafeInteger(version.tamanoBytes) || version.tamanoBytes <= 0) return null;
  // A propósito no se devuelven rutas, blobs ni datos de descarga.
  return Object.freeze({
    proyectoId, recursoId, versionId:version.id, numeroVersion:version.numero,
    sha256:version.sha256, tamanoBytes:version.tamanoBytes, responsableId:pieza.responsableId,
    origenConsultor:true, ultimaVersionVigente:true,
    versionIntacta:false, clasificable:false, integridadAcreditada:false,
    estado:'BORRADOR', publicacionVigente:false
  });
}
module.exports={consultarIdentidadPiezaVIS};
