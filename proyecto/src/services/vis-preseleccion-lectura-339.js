'use strict';
/**
 * F3-ANA-339 — Preselección INTERNA, sin entregar metadatos por HTTP ni bytes.
 * No autoriza una descarga. La futura lectura necesita reservar identidad/cuenta,
 * revalidar integridad física y revocación DURANTE el acceso a los bytes.
 *
 * No acepta callbacks de permiso, flags de acceso ni referencias de publicación
 * desde el cliente; solo IDs numéricos internos. Todas las consultas se realizan
 * después de obtener el candado de proyecto compartido con ALT306 y VIS.
 * Un registro histórico de publicación NO deroga una restricción posterior.
 */
const {consultarCorteALT}=require('./alt-corte-operativo-306');
const {leerPdfPrivadoVerificadoVIS}=require('./vis-binarios-privados-296');
const ID=x=>Number.isInteger(x)&&x>0&&x<=2147483647;
const SHA=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const FECHA=x=>x instanceof Date&&Number.isFinite(x.getTime());
const TX={isolationLevel:'ReadCommitted',maxWait:5000,timeout:12000};
const fallo=code=>Object.assign(new Error(code),{code});
const negar=()=>Object.freeze({seleccionable:false,codigo:'VIS339_NO_ACREDITADO'});
const okUsuario=(u,id,rol)=>u?.id===id&&u.rol===rol&&u.activo===true&&u.bloqueoUrgente!==true;
const vista=(tx,name)=>typeof tx?.[name]?.findUnique==='function';

async function ejecutarPreseleccionVIS({db,proyectoId,recursoId,representanteId,
  reloj=()=>new Date(),intentos=3,directorioPrivado,verificarIntegridadFisica=false}={}){
  if(typeof db?.$transaction!=='function'||!ID(proyectoId)||!ID(recursoId)||
    !ID(representanteId)||typeof reloj!=='function'||!Number.isInteger(intentos)||
    intentos<1||intentos>4)throw fallo('VIS339_ENTRADA_INVALIDA');
  if(verificarIntegridadFisica &&
    (typeof directorioPrivado!=='string'||!directorioPrivado))
    throw fallo('VIS340_DIRECTORIO_NO_CONFIGURADO');
  for(let i=0;i<intentos;i++){
    try{
      return await db.$transaction(async tx=>{
        if(typeof tx?.$queryRaw!=='function'||![
          'proyectoConsultoria','empresa','usuario','piezaComunicableVIS',
          'versionPiezaComunicableVIS','propuestaPublicacionVIS',
          'publicacionConfirmadaVIS','gobiernoRecursoVIS','cicloOperativoVIS',
          'inspeccionPrincipalVIS','aceptacionDocumentalVIS','registroCorteALT'
        ].every(n=>vista(tx,n))||typeof tx?.participacionConsultor?.findFirst!=='function')
          throw fallo('VIS339_BD_NO_ACREDITADA');
        // pg_advisory_xact_lock() retorna void: validar proyección tipada, NO su valor.
        const lock=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(291001, CAST(${proyectoId} AS INTEGER)) IS NOT NULL) AS "bloqueoProyecto"`;
        if(!Array.isArray(lock)||lock.length!==1||
          typeof lock[0]?.bloqueoProyecto!=='boolean')
          throw fallo('VIS339_CANDADO_NO_ACREDITADO');
        const ahora=reloj();
        if(!FECHA(ahora))throw fallo('VIS339_RELOJ_NO_ACREDITADO');
        const corte=await consultarCorteALT(tx,proyectoId);
        if(corte?.restringido!==false)return negar();
        const proyecto=await tx.proyectoConsultoria.findUnique({where:{id:proyectoId},
          select:{id:true,empresaId:true,estado:true}});
        if(proyecto?.id!==proyectoId||!ID(proyecto.empresaId)||proyecto.estado!=='ACTIVO')return negar();
        const empresa=await tx.empresa.findUnique({where:{id:proyecto.empresaId},
          select:{id:true,usuarioId:true}});
        if(empresa?.id!==proyecto.empresaId||empresa.usuarioId!==representanteId)return negar();
        const representante=await tx.usuario.findUnique({where:{id:representanteId},
          select:{id:true,rol:true,activo:true,bloqueoUrgente:true}});
        if(!okUsuario(representante,representanteId,'EMPRESARIO'))return negar();
        const propuesta=await tx.propuestaPublicacionVIS.findUnique({
          where:{proyectoId_recursoId:{proyectoId,recursoId}}});
        if(!ID(propuesta?.id)||propuesta.proyectoId!==proyectoId||
          propuesta.recursoId!==recursoId||propuesta.estado!=='PUBLICADA'||
          !ID(propuesta.revision)||!ID(propuesta.versionId)||
          !ID(propuesta.numeroVersion)||!SHA(propuesta.sha256))return negar();
        const publicacion=await tx.publicacionConfirmadaVIS.findUnique({
          where:{propuestaId_revision:{propuestaId:propuesta.id,revision:propuesta.revision}}});
        if(!ID(publicacion?.id)||publicacion.estado!=='CONFIRMADA'||
          publicacion.propuestaId!==propuesta.id||publicacion.proyectoId!==proyectoId||
          publicacion.recursoId!==recursoId||publicacion.revision!==propuesta.revision||
          publicacion.versionId!==propuesta.versionId||
          publicacion.numeroVersion!==propuesta.numeroVersion||
          publicacion.sha256!==propuesta.sha256||
          !FECHA(publicacion.confirmadaEn)||publicacion.confirmadaEn>ahora)return negar();
        const pieza=await tx.piezaComunicableVIS.findUnique({
          where:{id_proyectoId:{id:recursoId,proyectoId}}});
        if(pieza?.id!==recursoId||pieza.proyectoId!==proyectoId||
          pieza.clase!=='DOCUMENTO_CONSULTOR'||pieza.estado!=='BORRADOR'||
          pieza.numeroActual!==propuesta.numeroVersion||!ID(pieza.responsableId))return negar();
        const version=await tx.versionPiezaComunicableVIS.findUnique({
          where:{id_proyectoId:{id:propuesta.versionId,proyectoId}}});
        if(version?.id!==propuesta.versionId||version.proyectoId!==proyectoId||
          version.piezaId!==recursoId||version.numero!==propuesta.numeroVersion||
          version.sha256!==propuesta.sha256||version.estado!=='BORRADOR')return negar();
        const g=await tx.gobiernoRecursoVIS.findUnique({
          where:{proyectoId_recursoId:{proyectoId,recursoId}}});
        if(g?.proyectoId!==proyectoId||g.recursoId!==recursoId||
          g.comunicable!==true||g.restringido!==false||!ID(g.revision)||
          g.versionClasificadaId!==version.id||g.numeroVersionClasificada!==version.numero||
          g.sha256Clasificada!==version.sha256||
          publicacion.revisionGobierno!==g.revision)return negar();
        const ciclo=await tx.cicloOperativoVIS.findUnique({
          where:{proyectoId_recursoId:{proyectoId,recursoId}}});
        if(ciclo?.proyectoId!==proyectoId||ciclo.recursoId!==recursoId||
          ciclo.estado!=='EN_ESPERA'||ciclo.versionId!==version.id||
          ciclo.numeroVersion!==version.numero||ciclo.sha256!==version.sha256||
          ciclo.revisionGobierno!==g.revision||publicacion.revisionCiclo!==ciclo.revision||
          !ID(ciclo.inspeccionId)||!FECHA(ciclo.venceEn)||ciclo.venceEn>ahora)return negar();
        const inspeccion=await tx.inspeccionPrincipalVIS.findUnique({where:{id:ciclo.inspeccionId}});
        const aceptacion=await tx.aceptacionDocumentalVIS.findUnique({where:{versionId:version.id}});
        if(inspeccion?.id!==ciclo.inspeccionId||inspeccion.proyectoId!==proyectoId||
          inspeccion.recursoId!==recursoId||inspeccion.versionId!==version.id||
          inspeccion.numeroVersion!==version.numero||inspeccion.sha256!==version.sha256||
          inspeccion.revisionGobierno!==g.revision||!ID(inspeccion.principalId)||
          !FECHA(inspeccion.inspeccionadaEn)||inspeccion.inspeccionadaEn>ahora||
          !FECHA(inspeccion.venceEn)||inspeccion.venceEn.getTime()!==ciclo.venceEn.getTime()||
          aceptacion?.versionId!==version.id||aceptacion.proyectoId!==proyectoId||
          aceptacion.recursoId!==recursoId||aceptacion.numeroVersion!==version.numero||
          aceptacion.sha256!==version.sha256||aceptacion.principalId!==inspeccion.principalId||
          !FECHA(aceptacion.aceptadaEn)||aceptacion.aceptadaEn>ahora)return negar();
        const [principal,responsable,participaPrincipal,participaResponsable]=await Promise.all([
          tx.usuario.findUnique({where:{id:inspeccion.principalId}}),
          tx.usuario.findUnique({where:{id:pieza.responsableId}}),
          tx.participacionConsultor.findFirst({where:{proyectoId,usuarioId:inspeccion.principalId,activo:true,principal:true}}),
          tx.participacionConsultor.findFirst({where:{proyectoId,usuarioId:pieza.responsableId,activo:true}})
        ]);
        if(!okUsuario(principal,inspeccion.principalId,'EVALUADOR')||
          !okUsuario(responsable,pieza.responsableId,'EVALUADOR')||
          !participaPrincipal?.activo||participaPrincipal.principal!==true||
          participaPrincipal.usuarioId!==inspeccion.principalId||
          !participaResponsable?.activo||participaResponsable.usuarioId!==pieza.responsableId||
          inspeccion.principalId===pieza.responsableId)return negar();
        if(verificarIntegridadFisica){
          if(!vista(tx,'archivoPrivadoVersionVIS'))
            throw fallo('VIS340_BD_NO_ACREDITADA');
          const archivo=await tx.archivoPrivadoVersionVIS.findUnique({
            where:{versionId:version.id},select:{versionId:true,proyectoId:true,
              blobId:true,sha256:true,tamanoBytes:true,formato:true}});
          if(archivo?.versionId!==version.id||archivo.proyectoId!==proyectoId||
            archivo.sha256!==version.sha256||archivo.sha256!==publicacion.sha256||
            archivo.tamanoBytes!==version.tamanoBytes||
            !Number.isSafeInteger(archivo.tamanoBytes)||archivo.tamanoBytes<16||
            archivo.formato!=='application/pdf')return negar();
          // Verificar los bytes privados bajo el mismo candado de proyecto.
          // El buffer nunca sale de este servicio ni se convierte en capacidad.
          let pdf;
          try {
            pdf=await leerPdfPrivadoVerificadoVIS({directorioPrivado,
              blobId:archivo.blobId,sha256:archivo.sha256,tamanoBytes:archivo.tamanoBytes});
          }catch(e){
            if(typeof e?.code==='string'&&e.code.startsWith('VIS299_'))return negar();
            throw e;
          }finally{if(pdf?.contenido)pdf.contenido.fill(0);}
          return Object.freeze({seleccionable:true,
            codigo:'INTEGRIDAD_FISICA_CONFIRMADA_SIN_ENTREGA',proyectoId,recursoId,
            versionId:version.id,publicacionId:publicacion.id});
        }
        // F339 no acredita integridad de los bytes. Ninguna variante crea
        // una autorización duradera frente a revocación posterior al commit.
        return Object.freeze({seleccionable:true,codigo:'PRESELECCION_INTERNA_SIN_BYTES',
          proyectoId,recursoId,versionId:version.id,publicacionId:publicacion.id});
      },TX);
    }catch(e){if(e?.code==='P2034'&&i+1<intentos)continue;throw e;}
  }
  throw fallo('VIS339_CONFLICTOS_AGOTADOS');
}
function preseleccionarLecturaInternaVIS339(args){
  return ejecutarPreseleccionVIS({...args,verificarIntegridadFisica:false});
}
/** F340 — comprobar contenido real SIN publicarlo, ni servirlo por HTTP.
 * El directorio solo puede provenir de configuración de servidor confiable.
 * Un resultado positivo no sobrevive a futuras revocaciones o mutación de bytes.
 */
function preseleccionarConIntegridadFisicaVIS340(args){
  return ejecutarPreseleccionVIS({...args,verificarIntegridadFisica:true});
}
module.exports={preseleccionarLecturaInternaVIS339,preseleccionarConIntegridadFisicaVIS340};
