'use strict';
/**
 * Motor PURO y experimental del calendario VIS (no activa publicaciones).
 * Negocio: VIS189-D01, CFG193-D01-A, CFG194-D01, CFG197-D01-A.
 * No presupone horario laboral, fechas festivas ni aprobaciones de Puerta C.
 * Colombia: zona America/Bogota (UTC-05:00 sin transición estacional en el
 * alcance de este motor); la política y catálogos se reciben de un sistema
 * administrativo que aún debe implementarse y verificarse.
 *
 * Rango soportado: 2020-2099. Falla en cerrado ante configuración ausente,
 * origen temporal ambiguo, feriados anuales no acreditados o cálculo excesivo.
 */
const DIA = 86_400_000;
const MINUTO = 60_000;
const DESFASE_BOGOTA = 5 * 60 * MINUTO;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;
function error(codigo) { const e = new Error(codigo); e.code = codigo; return e; }
function assert(cond, codigo) { if (!cond) throw error(codigo); }
function fechaValida(fecha) {
  if (typeof fecha !== 'string' || !FECHA.test(fecha)) return false;
  const dt = new Date(fecha + 'T00:00:00.000Z');
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === fecha;
}
function hhmm(hora) {
  const m = typeof hora === 'string' && hora.match(HORA);
  assert(Boolean(m), 'VIS_FRANJA_HORA_INVALIDA');
  return Number(m[1]) * 60 + Number(m[2]);
}
function instante(valor) {
  assert(typeof valor === 'string' && INSTANTE.test(valor), 'VIS_INSTANTE_SIN_ZONA');
  assert(fechaValida(valor.slice(0, 10)), 'VIS_INSTANTE_INVALIDO');
  const zona = valor.slice(-6);
  if (zona !== 'Z' && /^[+-]/.test(zona)) {
    const [horas, minutos] = zona.slice(1).split(':').map(Number);
    assert(horas < 14 || minutos === 0, 'VIS_INSTANTE_INVALIDO');
  }
  const dt = new Date(valor);
  assert(Number.isFinite(dt.getTime()) && dt.toISOString().slice(0, 4) >= '2020' &&
    dt.toISOString().slice(0, 4) <= '2099', 'VIS_INSTANTE_INVALIDO');
  return dt.getTime();
}
function validarCalendario(calendario) {
  assert(calendario && typeof calendario === 'object' && !Array.isArray(calendario), 'VIS_CALENDARIO_AUSENTE');
  assert(calendario.zonaHoraria === 'America/Bogota', 'VIS_ZONA_NO_ADMITIDA');
  assert(typeof calendario.version === 'string' && calendario.version.trim().length > 0 &&
    calendario.version.length <= 100, 'VIS_VERSION_CALENDARIO_AUSENTE');
  const franjas = calendario.franjas;
  assert(franjas && typeof franjas === 'object' && !Array.isArray(franjas), 'VIS_FRANJAS_AUSENTES');
  assert(Object.keys(franjas).every(k => /^[1-7]$/.test(k)), 'VIS_DIA_INVALIDO');
  const franjasDia = {};
  let alguna = false;
  for (let dia = 1; dia <= 7; dia++) {
    const entradas = franjas[dia] || [];
    assert(Array.isArray(entradas) && entradas.length <= 12, 'VIS_FRANJAS_INVALIDAS');
    franjasDia[dia] = entradas.map(par => {
      assert(Array.isArray(par) && par.length === 2, 'VIS_FRANJA_INVALIDA');
      const [inicio, fin] = par.map(hhmm);
      assert(fin > inicio, 'VIS_FRANJA_NO_POSITIVA');
      return [inicio, fin];
    }).sort((a, b) => a[0] - b[0]);
    assert(franjasDia[dia].every((x, i) => !i || x[0] >= franjasDia[dia][i - 1][1]),
      'VIS_FRANJAS_SOLAPADAS');
    if (franjasDia[dia].length) alguna = true;
  }
  assert(alguna, 'VIS_SIN_HORARIO_LABORAL');
  assert(Array.isArray(calendario.cierres) && calendario.cierres.every(fechaValida), 'VIS_CIERRES_INVALIDOS');
  assert(calendario.festivosPorAnio && typeof calendario.festivosPorAnio === 'object' &&
    !Array.isArray(calendario.festivosPorAnio), 'VIS_FESTIVOS_SIN_FUENTE');
  const feriados = new Map();
  for (const [anio, catalogo] of Object.entries(calendario.festivosPorAnio)) {
    assert(/^20\d{2}$/.test(anio) && catalogo && typeof catalogo === 'object' &&
      Array.isArray(catalogo.fechas) && catalogo.fechas.length > 0 &&
      typeof catalogo.fuente === 'string' && catalogo.fuente.trim().length >= 8 &&
      fechaValida(catalogo.verificadoEn), 'VIS_CATALOGO_SIN_VERIFICAR');
    assert(catalogo.fechas.every(x => fechaValida(x) && x.startsWith(anio + '-')),
      'VIS_FESTIVO_FECHA_INVALIDA');
    assert(new Set(catalogo.fechas).size === catalogo.fechas.length, 'VIS_FESTIVO_DUPLICADO');
    feriados.set(anio, new Set(catalogo.fechas));
  }
  return { franjasDia, feriados, cierres: new Set(calendario.cierres), version: calendario.version };
}
function diaLocal(ms) {
  const local = new Date(ms - DESFASE_BOGOTA);
  const fecha = local.toISOString().slice(0, 10);
  const weekday = local.getUTCDay() || 7;
  const medianocheLocalMs = Date.parse(fecha + 'T00:00:00.000Z') + DESFASE_BOGOTA;
  return {fecha, weekday, medianocheLocalMs};
}
function franjasDiaVigentes(dia, config) {
  const anio = dia.fecha.slice(0, 4);
  assert(config.feriados.has(anio), 'VIS_CATALOGO_ANUAL_NO_ACREDITADO');
  if (config.feriados.get(anio).has(dia.fecha) || config.cierres.has(dia.fecha)) return [];
  return config.franjasDia[dia.weekday];
}
function duracionValida(minutos) {
  assert(Number.isInteger(minutos) && minutos >= 30 && minutos <= 480, 'VIS_DURACION_FUERA_DE_RANGO');
}
/** Retorna fecha ISO UTC, minutos usados y versión configurada al iniciar ciclo. */
function calcularVencimientoVIS({inicio, duracionMinutos = 60, calendario} = {}) {
  duracionValida(duracionMinutos);
  const comienzo = instante(inicio);
  const config = validarCalendario(calendario);
  let cursor = comienzo;
  let restante = duracionMinutos * MINUTO;
  for (let i = 0; i < 735; i++) {
    const dia = diaLocal(cursor);
    const periodos = franjasDiaVigentes(dia, config);
    for (const [a, b] of periodos) {
      const primero = Math.max(cursor, dia.medianocheLocalMs + a * MINUTO);
      const ultimo = dia.medianocheLocalMs + b * MINUTO;
      const disponible = ultimo - primero;
      if (disponible <= 0) continue;
      if (restante <= disponible) return {
        inicio: new Date(comienzo).toISOString(),
        venceEn: new Date(primero + restante).toISOString(),
        duracionMinutos, versionCalendario: config.version,
      };
      restante -= disponible;
    }
    cursor = dia.medianocheLocalMs + DIA;
    assert(Number.isSafeInteger(cursor), 'VIS_FECHA_FUERA_DE_RANGO');
  }
  throw error('VIS_CALENDARIO_SIN_CAPACIDAD');
}
module.exports = { calcularVencimientoVIS, validarCalendario, fechaValida };
