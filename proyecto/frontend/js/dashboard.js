/* Tablero basado en tareas y permisos por rol; no infiere certificación ni progreso normativo. */
(() => {
 'use strict';
 const $ = id => document.getElementById(id);
 const client = window.ISO;
 if (!client?.getToken() || !$('dashboardProjects')) return;
 const user=client.getUser();
 const firstName=(user?.nombre||'equipo').trim().split(/\s+/)[0];
 $('welcomeName').textContent=firstName;
 const profiles={
  ADMIN:{label:'ADMINISTRACIÓN / COORDINACIÓN',caption:'Coordina cuentas, empresas y apertura de expedientes',title:'Prepara el espacio de trabajo para cada proyecto.',text:'Gestiona la representación empresarial, la habilitación de cuentas y la creación de proyectos. Las respuestas del cliente y las conclusiones técnicas corresponden a sus responsables.',primary:['Abrir administración','admin.html'],flow:['Validar empresa','Vincular representante','Crear proyecto','Designar equipo'],actions:[['Empresas y cuentas','Gestionar accesos y representación','admin.html','01'],['Expedientes','Crear y consultar los proyectos de servicio','proyectos.html','02']]},
  EVALUADOR:{label:'CONSULTORÍA / ACOMPAÑAMIENTO',caption:'Tu cartera de proyectos y revisión técnica',title:'Tu trabajo técnico vive dentro de cada expediente.',text:'Encuentra los proyectos que tienes asignados. Revisa información disponible, coordina o ejecuta actividades según tu vinculación y deja evidencia de las decisiones que te corresponden.',primary:['Abrir mis expedientes','proyectos.html'],flow:['Revisar diagnóstico','Proponer plan','Acompañar actividades','Revisar evidencias'],actions:[['Mis expedientes','Acceso a proyectos en los que participas','proyectos.html','01'],['Áreas de referencia','Consulta del instrumento legado, no respuestas de la empresa','areas.html','02']]},
  EMPRESARIO:{label:'EMPRESA / PARTICIPACIÓN',caption:'Proyectos y aportes de tu organización',title:'Tu participación tiene un lugar definido.',text:'Consulta los expedientes habilitados para tu empresa, responde los diagnósticos correspondientes y aporta la información que te solicite el equipo consultor.',primary:['Ver mis diagnósticos','evaluaciones.html'],flow:['Consultar proyecto','Responder diagnóstico','Revisar plan','Aportar evidencias'],actions:[['Mis diagnósticos','Responder las evaluaciones que correspondan','evaluaciones.html','01'],['Mis proyectos','Ver etapas, documentos y avances publicados','proyectos.html','02'],['Datos de mi empresa','Consultar la organización vinculada','empresario.html','03']]}
 };
 const view=profiles[user.rol];if(!view)return;
 $('dashboardLabel').textContent=view.label;
 $('dashboardContext').textContent=view.caption;
 $('serviceIntroTitle').textContent=view.title;
 $('serviceIntroText').textContent=view.text;
 $('dashboardPrimary').href='./'+view.primary[1];$('dashboardPrimary').firstChild.textContent=view.primary[0]+' ';
 $('dashboardFlowTitle').textContent='Una secuencia con responsables';
 for(const [i,item] of view.flow.entries()){
   const li=document.createElement('li');const num=document.createElement('span');num.textContent=String(i+1).padStart(2,'0');
   const text=document.createElement('strong');text.textContent=item;li.append(num,text);$('dashboardProcess').append(li);
 }
 for(const [title,desc,href,index] of view.actions){
   const a=document.createElement('a');a.className='dv-action';a.href='./'+href;
   const marker=document.createElement('span');marker.textContent=index;marker.className='dv-index';
   const heading=document.createElement('strong');heading.textContent=title;
   const detail=document.createElement('small');detail.textContent=desc;
   const arrow=document.createElement('span');arrow.textContent='↗';arrow.className='dv-arrow';arrow.setAttribute('aria-hidden','true');
   a.append(marker,heading,detail,arrow);$('dashboardActions').append(a);
 }
 function node(tag,text,cls){const el=document.createElement(tag);if(text!=null)el.textContent=String(text);if(cls)el.className=cls;return el;}
 function metric(title,value,hint){const item=node('article',null,'dv-metric');item.append(node('span',title),node('strong',value),node('small',hint));$('dashboardMetrics').append(item);}
 function projectCard(p){const card=node('article',null,'dv-project-card');
  const tag=node('div',null,'dv-project-tag');tag.append(node('span',`EXPEDIENTE ${p.id}`),node('span',p.estado||'Estado no disponible','status-pill'));
  card.append(tag,node('h3',p.nombre||`Proyecto ${p.id}`),node('p',p.empresa?.nombre||'Información de empresa no disponible','muted'));
  const link=node('a','Entrar al expediente →','dv-project-link');link.href=`./proyectos.html?id=${encodeURIComponent(p.id)}`;card.append(link);return card;
 }
 let version=0;
 async function load(){
  const request=++version;
  $('dashboardMetrics').replaceChildren();$('dashboardProjects').replaceChildren();
  $('dashboardStatus').textContent='Consultando expedientes…';
  const jobs=[client.api('/proyectos')];
  if(user.rol==='ADMIN')jobs.push(client.api('/empresas'),client.api('/usuarios'));
  if(user.rol==='EMPRESARIO')jobs.push(client.api('/empresas'));
  const results=await Promise.allSettled(jobs);if(request!==version)return;
  if(results[0].status!=='fulfilled'||!Array.isArray(results[0].value)){
    $('dashboardStatus').textContent='No se pudieron consultar los proyectos; no se muestran valores estimados.';
    const retry=node('div',null,'dv-empty');retry.append(node('strong','No hay datos disponibles ahora'),node('p','Verifica la conexión e inténtalo otra vez.'));
    const button=node('button','Reintentar','secondary');button.type='button';button.addEventListener('click',load);retry.append(button);$('dashboardProjects').append(retry);return;
  }
  const projects=results[0].value;
  metric('Expedientes accesibles',projects.length,'Según tus permisos actuales');
  metric('En estado ACTIVO',projects.filter(p=>p.estado==='ACTIVO').length,'Estado registrado en el servidor');
  metric('Otros estados',projects.filter(p=>p.estado!=='ACTIVO').length,'Sin valoración de conformidad');
  if(user.rol==='ADMIN'){
    if(results[1]?.status==='fulfilled'&&Array.isArray(results[1].value))metric('Empresas registradas',results[1].value.length,'Consulta administrativa');
    if(results[2]?.status==='fulfilled'&&Array.isArray(results[2].value))metric('Cuentas disponibles',results[2].value.length,'Consulta administrativa');
  }else if(user.rol==='EMPRESARIO'&&results[1]?.status==='fulfilled'&&Array.isArray(results[1].value))metric('Empresas vinculadas',results[1].value.length,'Según autorización del servidor');
  $('dashboardStatus').textContent=`${projects.length} expediente(s) disponibles.`;
  if(!projects.length){const empty=node('div',null,'dv-empty');empty.append(node('strong','Aún no hay proyectos habilitados para tu cuenta'),node('p',user.rol==='ADMIN'?'Utiliza Administración para gestionar cuentas y vincular empresas antes de abrir proyectos.':'Cuando te vinculen a un proyecto, aparecerá en este espacio.'));$('dashboardProjects').append(empty);return;}
  for(const project of projects.slice(0,6))$('dashboardProjects').append(projectCard(project));
 }
 $('refreshDashboard')?.addEventListener('click',()=>load());load();
})();
