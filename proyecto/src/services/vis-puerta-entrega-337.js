'use strict';
/**
 * Puerta PURA de seguridad para una entrega VIS futura. No accede a disco/DB,
 * no expone ruta ni bytes y NO genera evidencia de publicación. Recibe hechos
 * acreditados dentro de la misma transacción del futuro lector/publicador.
 * Una propuesta, una aprobación o un simple flag 'PUBLICADA' NO bastan.
 */
const {evaluarCandidatoVIS}=require('../utils/vis-politica-publicacion');
const ID=x=>Number.isInteger(x)&&x>0&&x<=2147483647;
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function denegar(codigo){return Object.freeze({entregable:false,codigo});}
function evaluarPuertaEntregaVIS({ahora,proyectoId,recursoId,version,ciclo,controles,
  propuesta,publicacion,acceso}={}){
  if(!ID(proyectoId)||!ID(recursoId)||!ID(version?.id)||
    version.proyectoId!==proyectoId||version.recursoId!==recursoId||!SHA(version.sha256))
    return denegar('IDENTIDAD_O_INTEGRIDAD_NO_ACREDITADA');
  // Una preparación NO es publicación. Exigir evento persistente de commit
  // proveniente de fuente autoritativa, con revisión y hash coincidentes.
  if(!ID(propuesta?.id)||propuesta.proyectoId!==proyectoId||
    propuesta.recursoId!==recursoId||propuesta.versionId!==version.id||
    propuesta.sha256!==version.sha256||!ID(propuesta.revision)||
    propuesta.estado!=='PUBLICADA' || !ID(publicacion?.id)||
    publicacion.propuestaId!==propuesta.id||publicacion.revision!==propuesta.revision||
    publicacion.versionId!==version.id||publicacion.sha256!==version.sha256||
    publicacion.estado!=='CONFIRMADA')
    return denegar('PUBLICACION_PERSISTENTE_NO_ACREDITADA');
  // La selección pública requiere revalidación de pertenencia y de consulta
  // independiente del mero hecho histórico de publicación.
  if(acceso?.representanteVigente!==true||acceso.mismoProyecto!==true||
    acceso.consultaPermitida!==true||acceso.sinBloqueoUrgente!==true||
    acceso.sinRestriccionActual!==true)
    return denegar('ACCESO_ACTUAL_NO_ACREDITADO');
  // Revalidación adicional: una publicación previa no hace a una versión
  // descargable si el proyecto fue restringido o sus permisos expiraron.
  const evaluacion=evaluarCandidatoVIS({ahora,version,ciclo,controles});
  if(!evaluacion.elegible)return denegar('CONTROLES_VIS_NO_VIGENTES');
  return Object.freeze({entregable:true,codigo:'ELEGIBILIDAD_TEORICA_INTERNA',
    versionId:version.id,proyectoId,recursoId});
}
module.exports={evaluarPuertaEntregaVIS};
