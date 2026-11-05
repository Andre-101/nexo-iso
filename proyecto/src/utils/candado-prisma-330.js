/**
 * F3-ANA-330: candado transaccional tipado para Prisma 5.22 y PostgreSQL.
 * IMPORTANTE: debe invocarse sobre `tx` dentro de `$transaction`, no sobre el cliente global.
 * PostgreSQL devuelve SQL `void` para pg_advisory_xact_lock: nunca seleccionar ese valor crudo.
 * La expresion IS NOT NULL fue contrastada con PostgreSQL real en F3-ANA-329.
 * Si el resultado no es el booleano esperado se aborta la transaccion (fail-closed).
 */
'use strict';
const ESPACIOS = Object.freeze({ EMPRESA:27182, PROYECTO:27183, CUENTA:38941, IDENTIDAD:27184 });
async function tomarCandadoPrisma330(tx, espacio, id){
  const namespace=ESPACIOS[espacio];
  if(!Object.prototype.hasOwnProperty.call(ESPACIOS,espacio) || !Number.isSafeInteger(id) || id<1 || typeof tx?.$queryRaw!=='function'){
    const e=new Error('Candado no acreditado: argumentos o transaccion invalidos.');e.code='CANDADO_330_NO_ACREDITADO';throw e;
  }
  let filas;
  if(espacio==='EMPRESA')filas=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27182, CAST(${id} AS INTEGER)) IS NOT NULL) AS "bloqueoTomado"`;
  else if(espacio==='IDENTIDAD')filas=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27184, CAST(${id} AS INTEGER)) IS NOT NULL) AS "bloqueoTomado"`;
  else if(espacio==='PROYECTO')filas=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27183, CAST(${id} AS INTEGER)) IS NOT NULL) AS "bloqueoTomado"`;
  else filas=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(38941, CAST(${id} AS INTEGER)) IS NOT NULL) AS "bloqueoTomado"`;
  if(!Array.isArray(filas) || filas.length!==1 || filas[0]?.bloqueoTomado!==true){
    const e=new Error('Candado no acreditado: respuesta SQL invalida.');e.code='CANDADO_330_NO_ACREDITADO';throw e;
  }
}
module.exports={tomarCandadoPrisma330,ESPACIOS};
