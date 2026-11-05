/* REG239-A / F3-ANA-248: serialización UI de vinculación y proyectos.
 * No autoriza nada: el backend vuelve a comprobar todos los permisos y restricciones.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document)root.NexoRegistroUI=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
  'use strict';
  const NORMAS=Object.freeze({
    'ISO_27001/2022':Object.freeze({normaCodigo:'ISO_27001',edicionNormativa:'2022'}),
    'ISO_42001/2023':Object.freeze({normaCodigo:'ISO_42001',edicionNormativa:'2023'}),
  });
  function enteroPositivo(v){
    const id=Number(v);
    if(!Number.isSafeInteger(id)||id<=0)throw Error('Representante o empresa inválidos.');
    return id;
  }
  function vinculacion(datos){
    const id=enteroPositivo(datos.usuarioId);
    const body={nit:datos.nit,constanciaRepresentacion:datos.constanciaRepresentacion};
    if(datos.usarProvisional===true){
      body.datosProvisionales={nombre:datos.nombreProvisional,sector:datos.sectorProvisional,tamano:datos.tamanoProvisional};
      body.referenciaExterna=datos.referenciaExterna;
    }
    return {path:`/usuarios/${id}/vinculacion-empresa`,body};
  }
  function nuevoProyecto(datos){
    const identidad=NORMAS[datos.servicioNormativo];
    if(!identidad)throw Error('Selecciona explícitamente una norma y edición válidas.');
    return {
      empresaId:enteroPositivo(datos.empresaId),consultorPrincipalId:enteroPositivo(datos.consultorPrincipalId),
      normaCodigo:identidad.normaCodigo,edicionNormativa:identidad.edicionNormativa,
      nombre:datos.nombre,referenciaContrato:datos.referenciaContrato,
      alcanceContractual:datos.alcanceContractual,alcanceSGSIPropuesto:datos.alcanceSGSIPropuesto,
    };
  }
  function admiteProyecto(empresa){
    return !!empresa && empresa.estado==='APROBADA'&&
      ['FUENTE','ADMIN_PROVISIONAL','ADMIN_CONCILIADO'].includes(empresa.origenDatos)&&
      empresa.bloqueoNuevosProyectos!==true;
  }
  return {vinculacion,nuevoProyecto,admiteProyecto,NORMAS};
});
