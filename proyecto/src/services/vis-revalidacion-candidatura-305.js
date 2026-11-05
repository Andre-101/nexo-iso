'use strict';
/**
 * VIS305 — adaptador INTERNO y conservador, sin endpoints ni publicación.
 * Revalida metadatos, bytes, clasificación, inspección, aceptación, espera,
 * identidad y representación dentro de la MISMA transacción de VIS291.
 * La política ALT completa no existe aún: por defecto se DENIEGA la candidatura.
 * La futura integración ALT debe aportar un comprobante de reserva operativa
 * vinculado a proyecto y recurso. NUNCA pasarlo desde una solicitud HTTP.
 */
const {consultarFuenteAcreditadaVIS}=require('./vis-clasificacion-acreditada-300');
const {prepararCandidaturaVIS}=require('./vis-propuesta-transaccional-291');
const {consultarCorteALT}=require('./alt-corte-operativo-306');
const ID=x=>Number.isInteger(x)&&x>0&&x<=2147483647;
const error=code=>Object.assign(new Error(code),{code});
const exigir=(b,code)=>{if(!b)throw error(code)};
const fecha=d=>d instanceof Date&&Number.isFinite(d.getTime());
function vigente(u,rol){return u&&u.activo===true&&u.bloqueoUrgente!==true&&u.rol===rol;}
async function revalidarCandidaturaAcreditadaVIS({tx,proyectoId,recursoId,directorioPrivado,
  resolverReservaALT,ahora}={}){
  exigir(ID(proyectoId)&&ID(recursoId)&&fecha(ahora)&&typeof directorioPrivado==='string'&&
    directorioPrivado.length>0&&tx?.proyectoConsultoria&&tx?.piezaComunicableVIS&&
    tx?.gobiernoRecursoVIS&&tx?.cicloOperativoVIS&&tx?.inspeccionPrincipalVIS&&
    tx?.aceptacionDocumentalVIS&&tx?.usuario&&tx?.empresa&&tx?.participacionConsultor,
    'VIS305_BD_O_ENTRADA_NO_ACREDITADA');
  const fuente=await consultarFuenteAcreditadaVIS({tx,proyectoId,recursoId,directorioPrivado});
  exigir(fuente?.proyectoId===proyectoId&&fuente.recursoId===recursoId&&
    fuente.integridadAcreditada===true&&fuente.versionIntacta===true&&
    fuente.ultimaVersionVigente===true&&ID(fuente.versionId),
    'VIS305_PDF_O_VERSION_NO_ACREDITADA');
  const pieza=await tx.piezaComunicableVIS.findUnique({where:{id_proyectoId:{id:recursoId,proyectoId}},
    select:{id:true,proyectoId:true,responsableId:true,clase:true,estado:true,numeroActual:true}});
  exigir(pieza?.id===recursoId&&pieza.proyectoId===proyectoId&&
    pieza.clase==='DOCUMENTO_CONSULTOR'&&pieza.estado==='BORRADOR'&&
    pieza.numeroActual===fuente.numeroVersion&&pieza.responsableId===fuente.responsableId,
    'VIS305_PIEZA_NO_COMUNICABLE');
  const proyecto=await tx.proyectoConsultoria.findUnique({where:{id:proyectoId},
    select:{id:true,empresaId:true,estado:true,normaCodigo:true,edicionNormativa:true}});
  exigir(proyecto?.id===proyectoId&&proyecto.estado==='ACTIVO'&&ID(proyecto.empresaId),
    'VIS305_PROYECTO_NO_OPERABLE');
  // ALT306: la restricción del proyecto se consulta bajo el candado VIS.
  // Un callback sintético ALT NUNCA puede anular un corte formalizado.
  const corteALT=await consultarCorteALT(tx,proyectoId);
  exigir(corteALT.restringido===false,'VIS305_CORTE_ALT_VIGENTE');
  const gobierno=await tx.gobiernoRecursoVIS.findUnique({where:{proyectoId_recursoId:{proyectoId,recursoId}}});
  exigir(gobierno?.comunicable===true&&gobierno.restringido===false&&ID(gobierno.revision)&&
    gobierno.versionClasificadaId===fuente.versionId&&
    gobierno.numeroVersionClasificada===fuente.numeroVersion&&
    gobierno.sha256Clasificada===fuente.sha256,'VIS305_CLASIFICACION_NO_VIGENTE');
  const ciclo=await tx.cicloOperativoVIS.findUnique({where:{proyectoId_recursoId:{proyectoId,recursoId}}});
  exigir(ciclo?.proyectoId===proyectoId&&ciclo.recursoId===recursoId&&ciclo.estado==='EN_ESPERA'&&
    ciclo.versionId===fuente.versionId&&ciclo.numeroVersion===fuente.numeroVersion&&
    ciclo.sha256===fuente.sha256&&ciclo.revisionGobierno===gobierno.revision&&
    ID(ciclo.inspeccionId)&&fecha(ciclo.venceEn), 'VIS305_CICLO_INVALIDO_O_PAUSADO');
  const inspeccion=await tx.inspeccionPrincipalVIS.findUnique({where:{id:ciclo.inspeccionId}});
  exigir(inspeccion?.id===ciclo.inspeccionId&&inspeccion.proyectoId===proyectoId&&
    inspeccion.recursoId===recursoId&&inspeccion.versionId===fuente.versionId&&
    inspeccion.numeroVersion===fuente.numeroVersion&&inspeccion.sha256===fuente.sha256&&
    inspeccion.revisionGobierno===gobierno.revision&&
    fecha(inspeccion.inspeccionadaEn)&&fecha(inspeccion.venceEn)&&
    inspeccion.venceEn.getTime()===ciclo.venceEn.getTime()&&
    inspeccion.inspeccionadaEn<=inspeccion.venceEn&&
    typeof inspeccion.configuracionVersion==='string'&&!!inspeccion.configuracionVersion.trim()&&
    Number.isInteger(inspeccion.duracionMinutos)&&
    inspeccion.duracionMinutos>=30&&inspeccion.duracionMinutos<=480&&
    ID(inspeccion.principalId), 'VIS305_INSPECCION_NO_ACREDITADA');
  const aceptacion=await tx.aceptacionDocumentalVIS.findUnique({where:{versionId:fuente.versionId}});
  exigir(aceptacion?.proyectoId===proyectoId&&aceptacion.recursoId===recursoId&&
    aceptacion.versionId===fuente.versionId&&aceptacion.numeroVersion===fuente.numeroVersion&&
    aceptacion.sha256===fuente.sha256&&fecha(aceptacion.aceptadaEn)&&
    aceptacion.principalId===inspeccion.principalId&&
    aceptacion.aceptadaEn.getTime()<=ahora.getTime()&&
    inspeccion.inspeccionadaEn.getTime()<=ahora.getTime(),
    'VIS305_ACEPTACION_NO_ACREDITADA');
  // No basta el rol global: responsable y principal deben seguir participando.
  const responsable=await tx.usuario.findUnique({where:{id:pieza.responsableId},
    select:{id:true,activo:true,rol:true,bloqueoUrgente:true}});
  const principal=await tx.usuario.findUnique({where:{id:inspeccion.principalId},
    select:{id:true,activo:true,rol:true,bloqueoUrgente:true}});
  const [responsableParticipa,principalParticipa]=await Promise.all([
    tx.participacionConsultor.findFirst({where:{proyectoId,usuarioId:pieza.responsableId,activo:true},
      select:{usuarioId:true,activo:true}}),
    tx.participacionConsultor.findFirst({where:{proyectoId,usuarioId:inspeccion.principalId,
      principal:true,activo:true},select:{usuarioId:true,principal:true,activo:true}})
  ]);
  exigir(vigente(responsable,'EVALUADOR')&&responsableParticipa?.usuarioId===pieza.responsableId&&
    vigente(principal,'EVALUADOR')&&principalParticipa?.usuarioId===inspeccion.principalId&&
    principalParticipa.principal===true&&
    inspeccion.principalId!==pieza.responsableId,
    'VIS305_CONSULTORES_NO_VIGENTES');
  const empresa=await tx.empresa.findUnique({where:{id:proyecto.empresaId},
    select:{id:true,usuarioId:true}});
  exigir(empresa?.id===proyecto.empresaId&&ID(empresa.usuarioId),
    'VIS305_REPRESENTACION_NO_ACREDITADA');
  const representante=await tx.usuario.findUnique({where:{id:empresa.usuarioId},
    select:{id:true,rol:true,activo:true,bloqueoUrgente:true}});
  exigir(representante?.id===empresa.usuarioId&&vigente(representante,'EMPRESARIO'),
    'VIS305_REPRESENTANTE_NO_VIGENTE');
  // La reserva ALT todavía no tiene fuente operativa: no derivar un permiso
  // positivo de proyecto.estado='ACTIVO' ni de una promesa del navegador.
  let permitido=false;
  if(typeof resolverReservaALT==='function'){
    const reserva=await resolverReservaALT(tx,{proyectoId,recursoId,
      versionId:fuente.versionId,normaCodigo:proyecto.normaCodigo,
      edicionNormativa:proyecto.edicionNormativa});
    permitido=reserva?.autorizado===true&&reserva?.proyectoId===proyectoId&&
      reserva?.recursoId===recursoId&&reserva?.versionId===fuente.versionId;
  }
  return {
    version:{id:fuente.versionId,numero:fuente.numeroVersion,proyectoId,recursoId,
      clase:'DOCUMENTO_CONSULTOR',sha256:fuente.sha256},
    ciclo:{versionId:fuente.versionId,proyectoId,recursoId,estado:'EN_ESPERA',
      principalId:inspeccion.principalId,revisadaEn:inspeccion.inspeccionadaEn.toISOString(),
      venceEn:inspeccion.venceEn.toISOString(),
      versionCalendario:inspeccion.configuracionVersion,duracionMinutos:inspeccion.duracionMinutos},
    controles:{mismoProyecto:true,versionIntacta:true,principalVigente:true,
      representanteVigente:true,permisosActuales:true,proyectoOperable:true,
      sinPausa:true,comunicacionPermitida:permitido,
      sinRestriccionEspecial:true,aceptacionDocumentalVigente:true,
      aceptacionVersionId:fuente.versionId}
  };
}
/** Únicamente candidatura interna pendiente; no publicación ni descarga. */
async function prepararCandidaturaComprobadaVIS({db,proyectoId,recursoId,directorioPrivado,
  resolverReservaALT,reloj=()=>new Date(),intentos=3}={}){
  exigir(ID(proyectoId)&&ID(recursoId)&&typeof directorioPrivado==='string'&&
    !!directorioPrivado&&typeof reloj==='function', 'VIS305_ENTRADA_INVALIDA');
  const ahora=reloj();
  exigir(fecha(ahora),'VIS305_RELOJ_INVALIDO');
  return prepararCandidaturaVIS({db,proyectoId,recursoId,reloj:()=>ahora,intentos,
    revalidar:tx=>revalidarCandidaturaAcreditadaVIS({tx,proyectoId,recursoId,
      directorioPrivado,resolverReservaALT,ahora})});
}
module.exports={revalidarCandidaturaAcreditadaVIS,prepararCandidaturaComprobadaVIS};
