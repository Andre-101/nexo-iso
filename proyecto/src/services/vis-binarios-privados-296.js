'use strict';
/**
 * F3-ANA-296. Almacenamiento binario privado experimental para PDF de consultoria.
 * SIN HTTP, SIN autorizacion de usuario, SIN vinculo automatico a Prisma, SIN publicacion.
 * `directorioPrivado` se inyecta exclusivamente desde la configuracion confiable del servidor.
 * El comprobante es prueba criptografica de bytes, NO de revision, aprobacion o visibilidad.
 * Se exige un directorio preexistente exclusivo (0700), bajo volumen Docker no publico.
 */
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash, timingSafeEqual } = require('node:crypto');

const LIMITE_PDF_VIS = 16 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const fallo = codigo => Object.assign(new Error(codigo), {code:codigo});
const validoPdf = bytes => bytes.length >= 16 &&
  bytes.subarray(0,5).toString('ascii') === '%PDF-' &&
  /%%EOF\s*$/.test(bytes.subarray(Math.max(0,bytes.length-1024)).toString('latin1'));

async function directorioSeguro(directorioPrivado) {
  if (typeof directorioPrivado !== 'string' || !path.isAbsolute(directorioPrivado) ||
      path.normalize(directorioPrivado) !== directorioPrivado || directorioPrivado === path.parse(directorioPrivado).root)
    throw fallo('VIS296_DIRECTORIO_INVALIDO');
  let st;
  try { st=await fs.lstat(directorioPrivado); }
  catch { throw fallo('VIS296_DIRECTORIO_NO_DISPONIBLE'); }
  if(!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077)!==0)
    throw fallo('VIS296_DIRECTORIO_INSEGURO');
  // También niega enlaces simbólicos en cualquier componente antecesor.
  if(await fs.realpath(directorioPrivado) !== directorioPrivado)
    throw fallo('VIS296_DIRECTORIO_INSEGURO');
  return directorioPrivado;
}

async function comprobarHashArchivo(directorioPrivado, blobId, sha256, tamanoBytes) {
  await directorioSeguro(directorioPrivado);
  if(!UUID.test(blobId||'') || !SHA.test(sha256||'') ||
     !Number.isSafeInteger(tamanoBytes) || tamanoBytes<16 || tamanoBytes>LIMITE_PDF_VIS)
    throw fallo('VIS296_COMPROBANTE_INVALIDO');
  let fh;
  try {
    const nombre=path.join(directorioPrivado,blobId+'.pdf');
    fh=await fs.open(nombre, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const antes=await fh.stat();
    if(!antes.isFile() || antes.size!==tamanoBytes) return false;
    const h=createHash('sha256');
    const buf=Buffer.allocUnsafe(64*1024);
    let total=0;
    for(;;){
      const {bytesRead}=await fh.read(buf,0,buf.length,null);
      if(bytesRead===0) break;
      total+=bytesRead;
      if(total>tamanoBytes) return false;
      h.update(buf.subarray(0,bytesRead));
    }
    const despues=await fh.stat();
    if(total!==tamanoBytes || despues.size!==tamanoBytes ||
       antes.mtimeMs!==despues.mtimeMs || antes.ino!==despues.ino) return false;
    return timingSafeEqual(Buffer.from(h.digest('hex'),'hex'),Buffer.from(sha256,'hex'));
  } catch(e) {
    if(e?.code==='ENOENT' || e?.code==='ELOOP') return false;
    throw e;
  } finally { if(fh) await fh.close(); }
}

async function guardarPdfPrivadoVIS({directorioPrivado, contenido}={}) {
  await directorioSeguro(directorioPrivado);
  if(!Buffer.isBuffer(contenido) || contenido.length>LIMITE_PDF_VIS || !validoPdf(contenido))
    throw fallo('VIS296_PDF_NO_ADMITIDO');
  const blobId=randomUUID();
  const sha256=createHash('sha256').update(contenido).digest('hex');
  const ruta=path.join(directorioPrivado,blobId+'.pdf');
  let fh;
  let creado=false;
  try {
    fh=await fs.open(ruta,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW||0),0o600);
    creado=true;
    await fh.writeFile(contenido);
    await fh.sync();
    await fh.close(); fh=null;
    const ok=await comprobarHashArchivo(directorioPrivado,blobId,sha256,contenido.length);
    if(!ok) throw fallo('VIS296_ESCRITURA_NO_ACREDITADA');
    // El identificador no es un enlace de descarga y no confiere permiso de lectura.
    return Object.freeze({blobId,sha256,tamanoBytes:contenido.length,formato:'application/pdf'});
  } catch(e) {
    if(fh) await fh.close();
    if(creado) await fs.unlink(ruta).catch(()=>{});
    throw e;
  }
}
/**
 * F3-ANA-299. Lectura BINARIA PRIVADA con verificación en el MISMO descriptor
 * que suministra los bytes al proceso interno. NO autoriza divulgación.
 * El consumidor debe revalidar identidad, permisos, publicación y restricciones
 * de la versión inmediatamente antes de usar el resultado. No exponer esta
 * función desde HTTP ni entregar blobId al representante.
 *
 * Se carga como máximo 16 MiB para evitar depender de rutas/streams reabiertos
 * una vez comprobado el hash; el futuro endpoint necesitará control de
 * concurrencia/memoria, cierre de permisos y pruebas de no filtración.
 */
async function leerPdfPrivadoVerificadoVIS({directorioPrivado,blobId,sha256,tamanoBytes}={}) {
  await directorioSeguro(directorioPrivado);
  if(!UUID.test(blobId||'') || !SHA.test(sha256||'') ||
      !Number.isSafeInteger(tamanoBytes) || tamanoBytes<16 || tamanoBytes>LIMITE_PDF_VIS)
    throw fallo('VIS299_COMPROBANTE_INVALIDO');
  // En un sistema sin O_NOFOLLOW no existe garantia de no seguir symlinks.
  if(!Number.isInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW===0)
    throw fallo('VIS299_ENTORNO_NO_ADMITIDO');
  let fh;
  try {
    fh=await fs.open(path.join(directorioPrivado,blobId+'.pdf'),
      constants.O_RDONLY | constants.O_NOFOLLOW);
    const antes=await fh.stat();
    if(!antes.isFile() || antes.nlink!==1 || (antes.mode & 0o077)!==0 ||
       antes.size!==tamanoBytes)
      throw fallo('VIS299_ARCHIVO_INSEGURO_O_INTEGRO_NO_ACREDITADO');
    const contenido=Buffer.alloc(tamanoBytes);
    let total=0;
    while(total<tamanoBytes){
      const {bytesRead}=await fh.read(contenido,total,tamanoBytes-total,total);
      if(bytesRead===0) break;
      total+=bytesRead;
    }
    const despues=await fh.stat();
    if(total!==tamanoBytes || despues.size!==tamanoBytes ||
       antes.dev!==despues.dev || antes.ino!==despues.ino ||
       antes.mtimeMs!==despues.mtimeMs || antes.ctimeMs!==despues.ctimeMs ||
       antes.nlink!==despues.nlink || (despues.mode & 0o077)!==0 ||
       !validoPdf(contenido))
      throw fallo('VIS299_INTEGRIDAD_NO_ACREDITADA');
    const actual=createHash('sha256').update(contenido).digest();
    if(!timingSafeEqual(actual,Buffer.from(sha256,'hex')))
      throw fallo('VIS299_INTEGRIDAD_NO_ACREDITADA');
    // Un descriptor, una instantánea comprobada: la ruta nunca se devuelve.
    // La copia evita que el llamador comparta el buffer usado en la comprobación.
    return {contenido:Buffer.from(contenido),tamanoBytes,formato:'application/pdf'};
  }catch(e){
    if(e?.code==='ENOENT'||e?.code==='ELOOP') throw fallo('VIS299_NO_DISPONIBLE');
    throw e;
  }finally{if(fh) await fh.close();}
}
module.exports={guardarPdfPrivadoVIS,comprobarHashArchivo,leerPdfPrivadoVerificadoVIS,LIMITE_PDF_VIS};
