'use strict';
/**
 * F3-ANA-341. Laboratorio INTERNO de coordinación de una lectura VIS.
 * Mantiene una única transacción durante la revalidación de identidad/cuenta,
 * corte ALT, permisos, publicación y bytes PDF íntegros de F340. El resultado
 * NO concede acceso, NO devuelve bytes/ruta/token y NO es un endpoint HTTP.
 *
 * Orden de candados: IDENTIDAD(27184) -> CUENTA(38941) -> VIS/ALT(291001).
 * Los escritores de estado de cuenta usan IDENTIDAD -> CUENTA; Q58 usa
 * IDENTIDAD. El candado VIS/ALT se vuelve a tomar dentro de F340, en la MISMA
 * transacción, no en una transacción anidada. Ningún candado SQL permanece
 * después de que esta función resuelve; por eso NO es una autorización futura.
 *
 * PENDIENTE: coordinar revocaciones del principal/responsable, restricciones
 * del recurso, cancelación de trabajo y bytes de una futura respuesta HTTP.
 */
const { tomarCandadoPrisma330 } = require('../utils/candado-prisma-330');
const { preseleccionarConIntegridadFisicaVIS340 } = require('./vis-preseleccion-lectura-339');
const ID=x=>Number.isInteger(x)&&x>0&&x<=2147483647;
const fallo=code=>Object.assign(new Error(code),{code});
const TX=Object.freeze({isolationLevel:'ReadCommitted',maxWait:5000,timeout:20000});
const negar=()=>Object.freeze({acreditada:false,codigo:'VIS341_NO_ACREDITADA_SIN_ENTREGA'});

async function comprobarLecturaCoordinadaInternaVIS341({db,proyectoId,recursoId,
  representanteId,directorioPrivado,reloj=()=>new Date(),intentos=2}={}){
  if(typeof db?.$transaction!=='function'||![proyectoId,recursoId,representanteId].every(ID)||
    typeof directorioPrivado!=='string'||directorioPrivado.length===0||
    typeof reloj!=='function'||!Number.isInteger(intentos)||intentos<1||intentos>3)
    throw fallo('VIS341_ENTRADA_INVALIDA');
  for(let n=0;n<intentos;n++){
    try {
      return await db.$transaction(async tx=>{
        if(typeof tx?.$queryRaw!=='function'||typeof tx?.usuario?.findUnique!=='function')
          throw fallo('VIS341_BD_NO_ACREDITADA');
        await tomarCandadoPrisma330(tx,'IDENTIDAD',representanteId);
        await tomarCandadoPrisma330(tx,'CUENTA',representanteId);
        // F340 exige contrato de $transaction. Este adaptador solo comparte la
        // transacción ya abierta; no abre una segunda conexión, ni hace COMMIT.
        const mismaTransaccion=Object.freeze({$transaction:async fn=>fn(tx)});
        const resultado=await preseleccionarConIntegridadFisicaVIS340({
          db:mismaTransaccion,proyectoId,recursoId,representanteId,directorioPrivado,
          reloj,intentos:1
        });
        if(resultado?.seleccionable!==true||
           resultado.codigo!=='INTEGRIDAD_FISICA_CONFIRMADA_SIN_ENTREGA')return negar();
        // No propagar IDs, SHA, blobId, URLs, rutas ni material binario.
        return Object.freeze({acreditada:true,codigo:'VIS341_LECTURA_INTERNA_COORDINADA_SIN_ENTREGA'});
      },TX);
    } catch(e) {
      if(e?.code==='P2034'&&n+1<intentos)continue;
      throw e;
    }
  }
  throw fallo('VIS341_CONFLICTOS_AGOTADOS');
}
module.exports={comprobarLecturaCoordinadaInternaVIS341};
