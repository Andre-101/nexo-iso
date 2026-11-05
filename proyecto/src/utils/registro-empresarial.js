'use strict';
const crypto=require('node:crypto');
/** Contrato interno de identidad registral. Nunca inventa resultados de un proveedor. */
const limpiar = v => typeof v === 'string' ? v.trim() : '';
const textoComparable = v => limpiar(v).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]/g, '');
function normalizarNit(nit) {
  if (typeof nit !== 'string' || !nit.trim() || nit.length > 32) return null;
  const valor = nit.trim().toUpperCase().replace(/[.\s]/g, '');
  return /^[A-Z0-9-]{4,32}$/.test(valor) ? valor : null;
}
function normalizarDatos(datos) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return null;
  const nombre = limpiar(datos.nombre), sector = limpiar(datos.sector), tamano = limpiar(datos.tamano);
  if (!nombre || nombre.length > 200 || !sector || sector.length > 160 || tamano.length > 100) return null;
  return { nombre, sector, tamano:tamano || null };
}
function referenciaSuficiente(ref) {
  return typeof ref === 'string' && ref.trim().length >= 10 && ref.trim().length <= 2000;
}
function clasificarConsulta(respuesta, nitSolicitado) {
  if (!respuesta || typeof respuesta !== 'object') return { tipo:'ERROR', codigo:'RESPUESTA_INVALIDA' };
  if (respuesta.tipo === 'ENCONTRADA') {
    const nit = normalizarNit(respuesta.datos?.nit);
    const datos = normalizarDatos(respuesta.datos);
    if (!nit || !datos || nit !== nitSolicitado) return {tipo:'ERROR',codigo:'DATOS_INVALIDOS_O_NIT_DIFERENTE'};
    return {tipo:'ENCONTRADA',codigo:'OK',datos:{nit,...datos}};
  }
  if (respuesta.tipo === 'NO_ENCONTRADA') return {tipo:'NO_ENCONTRADA',codigo:'SIN_COINCIDENCIA'};
  if (respuesta.tipo === 'ERROR') {
    // No persistir texto arbitrario, trazas o tokens enviados por proveedor.
    const codigo = limpiar(respuesta.codigo).toUpperCase();
    return {tipo:'ERROR',codigo:/^[A-Z0-9_]{1,64}$/.test(codigo) ? codigo : 'ERROR_DESCONOCIDO'};
  }
  return {tipo:'ERROR',codigo:'RESPUESTA_INVALIDA'};
}
function comparar(manuales, externos) {
  if (!manuales || !externos) return {coincide:false,diferencias:['DATOS_INCOMPLETOS']};
  const dif = [];
  for (const campo of ['nit','nombre','sector','tamano']) {
    // Solo se cotejan campos que el proveedor realmente devuelve.
    if (externos[campo] != null && textoComparable(manuales[campo]) !== textoComparable(externos[campo])) dif.push(campo);
  }
  return { coincide:dif.length === 0,diferencias:dif };
}
function planVinculacion({nit,consulta,datosProvisionales,referenciaExterna}) {
  const n = normalizarNit(nit);
  if (!n) return {error:'NIT_INVALIDO'};
  const c = clasificarConsulta(consulta,n);
  if (c.tipo === 'ENCONTRADA') {
    if(datosProvisionales != null) {
      const manual=normalizarDatos(datosProvisionales);
      if(!manual) return {error:'DATOS_PROVISIONALES_INVALIDOS'};
      const comparacion=comparar({nit:n,...manual},c.datos);
      if(!comparacion.coincide) {
        if(!referenciaSuficiente(referenciaExterna)) return {error:'SUSTENTO_DISCREPANCIA_REQUERIDO',codigoConsulta:'DIFERENCIA'};
        return {
          estado:'ADMIN_CONCILIADO',nombre:manual.nombre,nit:n,sector:manual.sector,tamano:manual.tamano,
          fuente:c.datos,manual:{nit:n,...manual},codigoConsulta:'DIFERENCIA_REVISADA',
          huellaDecisionFuente:huellaFuente(c.datos),diferencias:comparacion.diferencias,
          estadoEmpresa:'APROBADA',bloqueo:false,
        };
      }
    }
    return {
      estado:'FUENTE', nombre:c.datos.nombre, nit:n, sector:c.datos.sector, tamano:c.datos.tamano,
      fuente:c.datos, manual:null, codigoConsulta:'OK', estadoEmpresa:'APROBADA', bloqueo:false,
    };
  }
  const manual = normalizarDatos(datosProvisionales);
  if (!manual || !referenciaSuficiente(referenciaExterna))
    return {error:'SUSTENTO_PROVISIONAL_REQUERIDO',codigoConsulta:c.codigo};
  return {
    estado:'ADMIN_PROVISIONAL', nombre:manual.nombre, nit:n, sector:manual.sector, tamano:manual.tamano,
    fuente:null, manual:{nit:n,...manual}, codigoConsulta:c.codigo,
    estadoEmpresa:'APROBADA', bloqueo:false,
  };
}
/** Una recuperación discrepante nunca cambia silenciosamente la representación o el dato externo. */
function huellaFuente(datos) {
  if(!datos) return null;
  return crypto.createHash('sha256').update(JSON.stringify(
    ['nit','nombre','sector','tamano'].map(k=>datos[k]??null))).digest('hex');
}
function planReconsulta(empresa, respuesta) {
  const consulta=clasificarConsulta(respuesta,empresa.nit);
  if(consulta.tipo === 'NO_ENCONTRADA' && empresa.origenDatos !== 'ADMIN_PROVISIONAL')
    return {accion:'DISCREPANCIA_SIN_RESULTADO',codigo:consulta.codigo,bloqueo:true};
  if(consulta.tipo !== 'ENCONTRADA') return {
    accion:'ERROR',codigo:consulta.codigo, nuevoError:consulta.codigo !== empresa.codigoConsulta,
  };
  const huella=huellaFuente(consulta.datos);
  if (empresa.origenDatos === 'ADMIN_CONCILIADO' && empresa.huellaDecisionFuente === huella)
    return {accion:'YA_REVISADA',codigo:'OK',fuente:consulta.datos,diferencias:[]};
  if(empresa.origenDatos === 'FUENTE' && !empresa.datosManual) {
    const diferencia=comparar(empresa.datosFuente||{},consulta.datos).diferencias;
    return diferencia.length===0 ? {accion:'FUENTE_SIN_CAMBIOS',codigo:'OK',fuente:consulta.datos,diferencias:[]}
      : {accion:'DISCREPANCIA',codigo:'OK',fuente:consulta.datos,diferencias:diferencia,bloqueo:true};
  }
  const comparacion=comparar(empresa.datosManual || {nit:empresa.nit,nombre:empresa.nombre,sector:empresa.sector,tamano:empresa.tamano},consulta.datos);
  if(comparacion.coincide) return {accion:'CONCILIADA',codigo:'OK',fuente:consulta.datos,diferencias:[]};
  return {accion:'DISCREPANCIA',codigo:'OK',fuente:consulta.datos,diferencias:comparacion.diferencias,
    // SOL-47: cualquier diferencia sustancial conserva el antecedente y detiene nuevas altas.
    bloqueo:true};
}
module.exports={normalizarNit,normalizarDatos,clasificarConsulta,referenciaSuficiente,comparar,huellaFuente,planVinculacion,planReconsulta};
