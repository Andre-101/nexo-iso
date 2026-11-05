/* Bandeja informativa del consultor principal. Datos obtenidos de endpoints ya existentes.
 * Clasificar no implica autorización; la API mantiene el control de permisos y transiciones.
 */
(function (root, factory) {
  'use strict';
  const ui=factory();
  if (typeof module === 'object' && module.exports) module.exports=ui;
  if (root && root.document) root.NexoAttentionUI=ui;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';
  const currentDate = now => {
    const d=now instanceof Date ? now : new Date(now);
    const part=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${part(d.getMonth()+1)}-${part(d.getDate())}`;
  };
  function summarize(activities, documents, project, now=new Date()) {
    const tasks=Array.isArray(activities)?activities:[];
    const records=[];
    const today=currentDate(now);
    const currentMembers=new Set((project?.participaciones||[])
      .filter(p=>p.activo!==false && p.usuario?.activo!==false && (!p.usuario?.rol || p.usuario.rol==='EVALUADOR'))
      .map(p=>String(p.usuarioId)));
    const active=t=>!['COMPLETADA','CANCELADA'].includes(t.estado);
    for(const t of tasks){
      if(!active(t))continue;
      const id=String(t.id), name=t.titulo||`Actividad #${id}`;
      if(t.tipoResponsable==='CONSULTORA' && (t.asignadoAId==null || !currentMembers.has(String(t.asignadoAId)))) {
        records.push({key:`responsable:${id}`,group:'responsables',kind:'actividad',id,
          title:name,detail:'Sin consultor encargado con participación activa. Revisa la asignación antes de continuar.'});
      }
      if(t.estado==='EN_REVISION')records.push({key:`revision:${id}`,group:'verificaciones',kind:'actividad',id,
        title:name,detail:'Actividad en revisión. Consulta entregables y verificaciones operativas independientes.'});
      const date=typeof t.fechaObjetivo==='string'?t.fechaObjetivo.slice(0,10):'';
      if(/^\d{4}-\d{2}-\d{2}$/.test(date) && date<today && ['PENDIENTE','EN_PROGRESO'].includes(t.estado))
        records.push({key:`fecha:${id}`,group:'vencimientos',kind:'actividad',id,
          title:name,detail:`Fecha objetivo ${date} vencida. Comprueba su seguimiento y estado real.`});
    }
    if(Array.isArray(documents))for(const d of documents){
      const v=Array.isArray(d.versiones)?d.versiones[0]:null;
      const state=v?.estadoRevision;
      const id=String(d.id),name=d.titulo||`Entregable #${id}`;
      if(state==='PENDIENTE') records.push({key:`documento:${id}`,group:'documentos',kind:'documento',id,
        title:name,detail:v.estadoCoelaboracion==='DECLARADA'
          ? 'Versión pendiente; la coelaboración declarada requiere respuesta antes de proseguir.'
          : 'Versión pendiente de revisión documental por el revisor autorizado.'});
      if(state==='CORRECCION_REQUERIDA')records.push({key:`correccion:${id}`,group:'correcciones',kind:'documento',id,
        title:name,detail:'Corrección solicitada a quien puede aportar una nueva versión. Da seguimiento a la observación.'});
    }
    const order=['responsables','documentos','verificaciones','correcciones','vencimientos'];
    const labels={responsables:'Asignación por resolver',documentos:'Revisión documental pendiente',
      verificaciones:'Actividades en revisión',correcciones:'Correcciones por seguir',vencimientos:'Fechas objetivo vencidas'};
    const counts=Object.fromEntries(order.map(key=>[key,records.filter(r=>r.group===key).length]));
    return {records:records.sort((a,b)=>order.indexOf(a.group)-order.indexOf(b.group)||a.title.localeCompare(b.title,'es')),
      counts,order,labels,documentsLoaded:Array.isArray(documents)};
  }
  return {summarize};
});
