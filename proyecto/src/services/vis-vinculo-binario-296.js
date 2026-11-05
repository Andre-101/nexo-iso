'use strict';
/** Enlace interno experimental de comprobante de bytes a una versión VIS295.
 * NO es endpoint, no concede permiso de carga al actor, NO publica ni autoriza descarga.
 * Solo es invocable desde un futuro servicio autorizado y con ruta privada confiable.
 * No confundir comprobante y aprobación documental: son decisiones independientes.
 */
const {comprobarHashArchivo}=require('./vis-binarios-privados-296');
const ID=x=>Number.isInteger(x)&&x>0&&x<=2147483647;
const SHA=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fallo=code=>Object.assign(new Error(code),{code});
const TX={isolationLevel:'Serializable',maxWait:5000,timeout:10000};
function datosComprobante(c){return c&&UUID.test(c.blobId||'')&&SHA.test(c.sha256||'')&&
  Number.isInteger(c.tamanoBytes)&&c.tamanoBytes>0&&c.tamanoBytes<=16*1024*1024&&
  c.formato==='application/pdf';}
async function vincularBinarioVIS({db,proyectoId,versionId,comprobante,directorioPrivado,intentos=3}={}){
 if(!db||typeof db.$transaction!=='function'||!ID(proyectoId)||!ID(versionId)||
   !datosComprobante(comprobante)||!Number.isInteger(intentos)||intentos<1||intentos>4)
   throw fallo('VIS296_VINCULO_INVALIDO');
 if(!await comprobarHashArchivo(directorioPrivado,comprobante.blobId,comprobante.sha256,comprobante.tamanoBytes))
   throw fallo('VIS296_BINARIO_NO_ACREDITADO');
 for(let i=0;i<intentos;i++){
  try {
   return await db.$transaction(async tx=>{
     const locks=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(291001, CAST(${proyectoId} AS INTEGER)) IS NULL) AS "bloqueoProyecto"`;
     if(!Array.isArray(locks)||locks.length!==1||typeof locks[0]?.bloqueoProyecto!=='boolean')
       throw fallo('VIS296_BLOQUEO_NO_ACREDITADO');
     const version=await tx.versionPiezaComunicableVIS.findUnique({
       where:{id_proyectoId:{id:versionId,proyectoId}},
       select:{id:true,proyectoId:true,piezaId:true,numero:true,sha256:true,tamanoBytes:true,estado:true}
     });
     if(!version||version.estado!=='BORRADOR'||version.sha256!==comprobante.sha256||
        version.tamanoBytes!==comprobante.tamanoBytes) throw fallo('VIS296_VERSION_NO_CONCUERDA');
     const pieza=await tx.piezaComunicableVIS.findUnique({
       where:{id_proyectoId:{id:version.piezaId,proyectoId}},
       select:{id:true,estado:true,clase:true,numeroActual:true}
     });
     if(!pieza||pieza.estado!=='BORRADOR'||pieza.clase!=='DOCUMENTO_CONSULTOR'||
        pieza.numeroActual!==version.numero)throw fallo('VIS296_PIEZA_NO_VIGENTE');
     const actual=await tx.archivoPrivadoVersionVIS.findUnique({where:{versionId},
       select:{id:true,proyectoId:true,blobId:true,sha256:true,tamanoBytes:true,formato:true}});
     if(actual){
       if(actual.proyectoId!==proyectoId||actual.blobId!==comprobante.blobId||
          actual.sha256!==comprobante.sha256||actual.tamanoBytes!==comprobante.tamanoBytes||
          actual.formato!==comprobante.formato)throw fallo('VIS296_VINCULO_EXISTENTE_DISTINTO');
       return Object.freeze({vinculado:true,yaExistia:true});
     }
     await tx.archivoPrivadoVersionVIS.create({data:{proyectoId,versionId,blobId:comprobante.blobId,
       sha256:comprobante.sha256,tamanoBytes:comprobante.tamanoBytes,formato:comprobante.formato}});
     return Object.freeze({vinculado:true,yaExistia:false});
   },TX);
  }catch(e){if(e?.code==='P2034'&&i+1<intentos)continue;throw e;}
 }
 throw fallo('VIS296_CONFLICTO_AGOTADO');
}
/** Revalidación de bytes y titularidad exclusivamente para procesos internos.
 * Incluso tras verificar, clasificable/publicacionVigente siguen siendo falsos. */
async function consultarBinarioVinculadoVIS({tx,proyectoId,versionId,directorioPrivado}={}){
 if(!tx||typeof tx.archivoPrivadoVersionVIS?.findUnique!=='function'||
    typeof tx.versionPiezaComunicableVIS?.findUnique!=='function'||!ID(proyectoId)||!ID(versionId))
  throw fallo('VIS296_LECTURA_INVALIDA');
 const a=await tx.archivoPrivadoVersionVIS.findUnique({where:{versionId},
  select:{proyectoId:true,versionId:true,blobId:true,sha256:true,tamanoBytes:true,formato:true}});
 if(!a||a.proyectoId!==proyectoId||a.versionId!==versionId||!datosComprobante(a))return null;
 const v=await tx.versionPiezaComunicableVIS.findUnique({
   where:{id_proyectoId:{id:versionId,proyectoId}},
   select:{sha256:true,tamanoBytes:true,estado:true}
 });
 if(!v || v.estado!=='BORRADOR'||v.sha256!==a.sha256||v.tamanoBytes!==a.tamanoBytes) return null;
 const ok=await comprobarHashArchivo(directorioPrivado,a.blobId,a.sha256,a.tamanoBytes);
 return Object.freeze({integridadAcreditada:ok,clasificable:false,publicacionVigente:false});
}
module.exports={vincularBinarioVIS,consultarBinarioVinculadoVIS};
