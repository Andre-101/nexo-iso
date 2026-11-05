/* Navegación derivada de responsabilidades del producto: NO confiere permisos. */
(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root && root.document) root.NexoWorkspace = model;
})(typeof globalThis !== 'undefined' ? globalThis : null, function(){
  'use strict';
  const routes = Object.freeze([
    { href:'dashboard.html', title:'Mi inicio', icon:'⌂', group:'PRINCIPAL', roles:['ADMIN','EVALUADOR','EMPRESARIO'] },
    { href:'proyectos.html', title:'Expedientes', icon:'▦', group:'PRINCIPAL', roles:['ADMIN','EVALUADOR','EMPRESARIO'] },
    { href:'admin.html', title:'Empresas y cuentas', icon:'⚙', group:'ADMINISTRACIÓN', roles:['ADMIN'] },
    { href:'evaluaciones.html', title:'Mis diagnósticos', icon:'▤', group:'MI ORGANIZACIÓN', roles:['EMPRESARIO'] },
    { href:'empresario.html', title:'Datos de mi empresa', icon:'▣', group:'MI ORGANIZACIÓN', roles:['EMPRESARIO'] },
    { href:'madurez-42001.html', title:'Borrador SGIA · 42001', icon:'◇', group:'MI ORGANIZACIÓN', roles:['EMPRESARIO'] },
    { href:'historico.html', title:'Consulta histórica', icon:'▧', group:'CONSULTA', roles:['ADMIN','EMPRESARIO'] },
    // Se conserva la ruta técnica /areas.html para enlaces legados autorizados,
    // pero NO se presenta como tarea principal ni se confunde con responder diagnósticos.
    { href:'areas.html', title:'Áreas de referencia', icon:'☷', group:'CONSULTA', roles:['EVALUADOR','EMPRESARIO'] },
  ]);
  function available(role){return routes.filter(route=>route.roles.includes(role));}
  function allowed(role,page){const route=routes.find(route=>route.href===page);return Boolean(route&&route.roles.includes(role));}
  function menu(role){return available(role).filter(route=>route.group && (route.href!=='areas.html'||role==='EVALUADOR'));}
  return { routes, available, allowed, menu };
});
