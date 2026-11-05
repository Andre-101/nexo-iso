'use strict';
/**
 * F3-ANA-279 — configuracion global VIS de la consultora.
 * Decision del 27/10/2026: horario de oficina inicial L-V 08:00-12:00,
 * 13:00-17:00, modificable SOLO por ADMIN. No es jornada legal individual,
 * horario de soporte, SLA contractual ni autorizacion de publicacion.
 * CFG193-D01-A: las versiones nuevas se capturan por ciclo sin retroactividad.
 */
const {validarCalendario, calcularVencimientoVIS} = require('./vis-calendario-laboral');
const {NACIONALES_2026,contrastarCalendarioVIS2026,FUENTES} = require('./vis-catalogo-festivos-2026');
const {randomUUID} = require('node:crypto');
const DIAS_LABORABLES = Object.freeze([1,2,3,4,5]);
const FRANJAS_INICIALES = Object.freeze([Object.freeze(['08:00','12:00']),Object.freeze(['13:00','17:00'])]);
const crearFranjasIniciales = () => Object.fromEntries(DIAS_LABORABLES.map(d => [d, FRANJAS_INICIALES.map(x => [...x])]));
function fallo(code) {return Object.assign(new Error(code), {code});}
function congelarRecursivo(x) {
  if (x && typeof x === 'object') {
    for (const v of Object.values(x)) congelarRecursivo(v);
    Object.freeze(x);
  }
  return x;
}
function comprobarAdmin(actor) {
  if (!actor || actor.rol !== 'ADMIN' || !Number.isSafeInteger(actor.id) || actor.id <= 0)
    throw fallo('VIS_SOLO_ADMIN');
}
function calendarioInicial({version = `VIS-${randomUUID()}`} = {}) {
  return {
    version, zonaHoraria:'America/Bogota',franjas:crearFranjasIniciales(),cierres:[],
    festivosPorAnio:{'2026':{
      fechas:[...NACIONALES_2026], fuente:FUENTES.join(' | '), verificadoEn:'2026-10-27',
    }},
  };
}
function comprobarConfiguracion({calendario,duracionMinutos}) {
  if (!Number.isInteger(duracionMinutos) || duracionMinutos < 30 || duracionMinutos > 480)
    throw fallo('VIS_DURACION_FUERA_DE_RANGO');
  validarCalendario(calendario);
  // La procedencia declarada por si sola NO demuestra integridad normativa.
  // Solo el oraculo 2026 ha sido contrastado; futuros anios necesitan su
  // propio contraste oficial antes de permitir activacion operativa.
  const anios=Object.keys(calendario.festivosPorAnio);
  if (!anios.includes('2026')) throw fallo('VIS_CATALOGO_2026_AUSENTE');
  if (anios.some(anio=>anio!=='2026')) throw fallo('VIS_CATALOGO_ANUAL_SIN_ORACULO_VERIFICADO');
  contrastarCalendarioVIS2026(calendario);
  return true;
}
function nuevaConfiguracion({actor,anterior = null, entrada, ahora = new Date(), idVersion = `VIS-${randomUUID()}`} = {}) {
  comprobarAdmin(actor);
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) throw fallo('VIS_SOLICITUD_INVALIDA');
  const camposPermitidos = new Set(['revisionEsperada','motivo','duracionMinutos','franjas','cierres','festivosPorAnio']);
  if (Object.keys(entrada).some(k => !camposPermitidos.has(k))) throw fallo('VIS_CAMPO_NO_MODIFICABLE');
  if (typeof entrada.motivo !== 'string' || entrada.motivo.trim().length < 20 || entrada.motivo.length > 2000)
    throw fallo('VIS_JUSTIFICACION_INSUFICIENTE');
  if (anterior && (!Number.isSafeInteger(anterior.id) || entrada.revisionEsperada !== anterior.id))
    throw fallo('VIS_REVISION_DESACTUALIZADA');
  if (!anterior && entrada.revisionEsperada !== null) throw fallo('VIS_REVISION_DESACTUALIZADA');
  if (!(ahora instanceof Date) || !Number.isFinite(ahora.getTime())) throw fallo('VIS_RELOJ_INVALIDO');
  const base = anterior ? structuredClone(anterior.calendario) : calendarioInicial({version:idVersion});
  base.version = idVersion;
  for (const campo of ['franjas','cierres','festivosPorAnio']) {
    if (Object.hasOwn(entrada,campo)) {
      if (entrada[campo] === undefined) throw fallo('VIS_SOLICITUD_INVALIDA');
      base[campo] = structuredClone(entrada[campo]);
    }
  }
  // La duracion anterior se conserva salvo cambio explicito por ADMIN.
  const duracionMinutos = Object.hasOwn(entrada,'duracionMinutos') ? entrada.duracionMinutos :
    anterior ? anterior.duracionMinutos : 60;
  comprobarConfiguracion({calendario:base,duracionMinutos});
  return {
    version:idVersion, calendario:base,duracionMinutos,
    creadoPorId:actor.id, motivo:entrada.motivo.trim(),vigenteDesde:ahora,
    estado:'ACTIVA',
  };
}
/** Captura inmutable del plazo al iniciar un ciclo NUEVO. Sin accesos a red ni escritura. */
function capturarCicloVIS({configuracion,inicio}) {
  if (!configuracion || configuracion.estado !== 'ACTIVA' ||
    configuracion.version !== configuracion.calendario?.version)
    throw fallo('VIS_CONFIGURACION_NO_ACTIVA');
  comprobarConfiguracion(configuracion);
  const calculo = calcularVencimientoVIS({inicio,
    duracionMinutos:configuracion.duracionMinutos,calendario:configuracion.calendario});
  return Object.freeze({
    ...calculo,configuracionId:configuracion.id ?? null,
    // No guardar una referencia mutable que ADMIN pueda cambiar a posteriori.
    calendarioCapturado:congelarRecursivo(JSON.parse(JSON.stringify(configuracion.calendario))),
  });
}
module.exports = {calendarioInicial,crearFranjasIniciales,comprobarConfiguracion,nuevaConfiguracion,capturarCicloVIS,comprobarAdmin};
