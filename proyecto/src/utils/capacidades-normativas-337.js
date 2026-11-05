'use strict';
/**
 * F3-ANA-337 — Contrato de capacidades POR PROYECTO, no dictamen ISO.
 * La mera presencia de un código ISO no acredita un cuestionario normativo.
 * No se reciben permisos/capacidades por HTTP: se derivan de la identidad persistida.
 * No habilita publicar, certificar ni ejecutar cuestionarios ISO/IEC 42001.
 */
const EDICIONES=Object.freeze({ISO_27001:'2022',ISO_42001:'2023'});
const IDENTIDAD_NO_ACREDITADA='IDENTIDAD_NO_ACREDITADA';
function capacidadesProyecto(proyecto){
  const codigo=proyecto?.normaCodigo;
  const edicion=proyecto?.edicionNormativa;
  const reconocida=typeof codigo==='string'&&Object.hasOwn(EDICIONES,codigo)&&
    edicion===EDICIONES[codigo];
  const identidad=reconocida?'IDENTIFICADA':IDENTIDAD_NO_ACREDITADA;
  // El instrumento 42001 no tiene validación B2-V y jamás hereda 27001.
  // Un diagnóstico 27001 de legado tampoco equivale a un instrumento acreditado.
  return Object.freeze({
    normaCodigo:reconocida?codigo:null,
    edicionNormativa:reconocida?edicion:null,
    identidad,
    instrumento:{estado:reconocida&&codigo==='ISO_27001'
      ?'LEGADO_ORIENTATIVO_NO_ACREDITADO':'PENDIENTE_VALIDACION',
      habilitadoNormativamente:false,heredaInstrumentoDeOtraNorma:false},
    evaluacionAutomaticaFavorable:false,
    publicacionDocumentalHabilitada:false,
    certificacionEmitidaPorPlataforma:false,
    // Es una descripción del proyecto, no una autorización de ejecutar IA.
    iaConfigurada:proyecto?.iaEstado==='HABILITADA'
  });
}
module.exports={capacidadesProyecto,IDENTIDAD_NO_ACREDITADA};
