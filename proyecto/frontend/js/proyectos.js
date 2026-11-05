// G1: interfaz simple para el flujo por proyectos. API valida todos los permisos.
(() => {
  const client = window.ISO;
  const token = client.getToken();
  let user;
  user = client.getUser();
  if (!token || !user) { location.replace('./login.html'); return; }
  const $ = id => document.getElementById(id);
  $('identity').textContent = `${user.nombre} · ${user.rol}`;
  const admin = user.rol === 'ADMIN', consultor = user.rol === 'EVALUADOR';
  const guideLabel=$('projectGuideLabel'), guideTitle=$('projectGuideHeading');
  const guideText=$('projectGuideDescription'), guideNav=$('projectGuideLinks');
  const roleGuide={
    ADMIN:{label:'ADMINISTRACIÓN · APERTURA',title:'Primero habilita el expediente, después coordina el servicio.',
      text:'La vinculación empresarial y la designación del equipo son tareas administrativas. Las encuestas las responde la empresa y los consultores conducen su revisión.',
      links:[['Vincular empresa','#adminArea'],['Crear proyecto','#projectForm'],['Consultar expedientes','#projectCollection']]},
    EVALUADOR:{label:'CONSULTORÍA · EJECUCIÓN',title:'Selecciona un proyecto para trabajar en su expediente.',
      text:'Dentro del expediente encontrarás diagnóstico, plan, brechas, actividades, evidencia documental e informes según tu asignación. La función de consultor principal depende de cada proyecto.',
      links:[['Mis proyectos','#projectCollection']]},
    EMPRESARIO:{label:'EMPRESA · PARTICIPACIÓN',title:'Tu organización responde; el equipo consultor revisa.',
      text:'Localiza tu expediente, responde los diagnósticos correspondientes y consulta las actividades o documentos que estén autorizados para la empresa.',
      links:[['Mis proyectos','#projectCollection'],['Mis diagnósticos','./evaluaciones.html']]},
  }[user.rol];
  if(roleGuide&&guideNav){
    guideLabel.textContent=roleGuide.label;guideTitle.textContent=roleGuide.title;guideText.textContent=roleGuide.text;
    guideNav.replaceChildren();
    for(const [title,href] of roleGuide.links){const a=document.createElement('a');a.href=href;a.textContent=title+' →';guideNav.append(a);}
  }

  $('adminArea').classList.toggle('g1-hide', !admin);
  function status(message, error=false) {
    const el = $('feedback');
    el.textContent=message;
    el.className=`g1-alert ${error?'error':'ok'}`;
    el.setAttribute('role',error?'alert':'status');
    el.setAttribute('aria-live',error?'assertive':'polite');
  }
  // Retroalimentación contextual: los fallos de escritura se presentan junto al
  // formulario que los produjo, no exclusivamente al principio del expediente.
  const boundFeedbackForms=new WeakSet();
  function clearFormFeedback(form) {
    form?.querySelector('.form-operation-feedback')?.remove();
  }
  function formFeedback(form,message,error=true,focusError=true) {
    if(!form)return;
    clearFormFeedback(form);
    const note=elt('p',message,`form-operation-feedback ${error?'error':'ok'}`);
    note.setAttribute('role',error?'alert':'status');
    note.setAttribute('aria-live',error?'assertive':'polite');
    if(error)note.tabIndex=-1;
    const title=form.querySelector('h2,h3,h4,legend');
    if(title)title.insertAdjacentElement('afterend',note);
    else form.prepend(note);
    if(error && focusError){note.focus({preventScroll:true});note.scrollIntoView({block:'nearest'});}
    if(!boundFeedbackForms.has(form)) {
      boundFeedbackForms.add(form);
      const clear=()=>clearFormFeedback(form);
      form.addEventListener('input',clear);
      form.addEventListener('change',clear);
    }
  }
  async function api(path, opts={}) { return client.api(path,opts); }
  function field(form,name){ return new FormData(form).get(name); }
  function elt(tag,text,className='') {
    const e=document.createElement(tag);if(text!=null)e.textContent=String(text);if(className)e.className=className;return e;
  }
  function card(parent,title,lines) {
    const d=elt('article',null,'g1-card');d.appendChild(elt('h3',title));
    for(const line of lines)d.appendChild(elt('p',line,'g1-muted'));parent.appendChild(d);return d;
  }
  function choices(id, rows, label, empty='No hay opciones disponibles') {
    const select=$(id);if(!select)return;
    const previous=select.value;select.replaceChildren();
    const placeholder=elt('option',rows.length?'Selecciona una opción':empty);
    placeholder.value='';select.append(placeholder);
    for(const x of rows){const option=elt('option',label(x));option.value=String(x.id);select.append(option);}
    if(rows.some(x=>String(x.id)===previous))select.value=previous;
  }
  let accounts=[];
  async function adminOptions() {
    if(!admin)return;
    try {
      const [people, companies]=await Promise.all([api('/usuarios'),api('/empresas')]);
      accounts=people;
      choices('representanteSelect',people.filter(x=>x.activo&&x.rol==='EMPRESARIO'),x=>`${x.nombre} · ${x.email}`,'No hay representantes activos');
      choices('consultorPrincipalSelect',people.filter(x=>x.activo&&x.rol==='EVALUADOR'),x=>`${x.nombre} · ${x.email}`,'No hay consultores activos');
      choices('consultorAsignarSelect',people.filter(x=>x.activo&&x.rol==='EVALUADOR'),x=>`${x.nombre} · ${x.email}`,'No hay consultores activos');
      choices('empresaSelect',companies.filter(window.NexoRegistroUI.admiteProyecto),x=>`${x.nombre} · ${x.nit}${x.origenDatos==='ADMIN_PROVISIONAL'?' (provisional)':''}`,'No hay empresas aptas para nuevos proyectos');
    } catch(e){status('No se pudieron cargar los selectores: '+e.message,true);}
  }
  let currentAssignees=[];
  function responsibleChoices(){
    const type=$('taskForm').elements.tipoResponsable.value;
    choices('taskResponsableSelect',currentAssignees.filter(x=>x.tipo===type),x=>x.nombre,'No hay responsables para este tipo');
  }
  $('taskForm').elements.tipoResponsable.addEventListener('change',responsibleChoices);
  const taskWizard=window.NexoTaskFormUI.initTaskWizard($('taskForm'));
  const caseWorkspace=window.NexoCaseWorkspaceUI.create(document);
  const verificationHints=window.NexoTaskFormUI.initVerificationHints($('g2Verificacion'));
  let additionalAgreements=[];
  function continuityChoices(){
    const extra=$('taskCoverage').value==='ADICIONAL';
    $('taskOriginRow').classList.toggle('g1-hide',!extra);
    $('taskOriginHelp').classList.toggle('g1-hide',!extra);
    const choicesOld=tasksLoaded.filter(t=>extra && t.cobertura==='ADICIONAL' &&
      ['EN_PROGRESO','EN_REVISION'].includes(t.estado) &&
      additionalAgreements.some(a=>a.id===t.acuerdoAdicionalId&&['CANCELADO','MODIFICADO'].includes(a.estado)));
    const select=$('taskOriginId'), previous=select.value;
    select.replaceChildren();const blank=elt('option','Nueva actividad sin antecedente');blank.value='';select.append(blank);
    for(const t of choicesOld){const option=elt('option',`#${t.id} · ${t.titulo}`);option.value=String(t.id);select.append(option);}
    select.value=choicesOld.some(t=>String(t.id)===previous)?previous:'';
  }
  function coverageChoices(){
    const extra=$('taskCoverage').value==='ADICIONAL';
    $('taskAdditionalRow').classList.toggle('g1-hide',!extra);
    $('taskAdditionalId').required=extra;
    if(!extra)$('taskAdditionalId').value='';
    continuityChoices();
  }
  $('taskCoverage').addEventListener('change',coverageChoices);
  function additionalOptions(id,items){
    const select=$(id);select.replaceChildren();
    const empty=elt('option',items.length?'Selecciona un acuerdo':'No hay acuerdos en este estado');empty.value='';select.append(empty);
    for(const agreement of items){const opt=elt('option',`#${agreement.id} · ${agreement.titulo}`);opt.value=String(agreement.id);select.append(opt);}
  }
  async function showAdditional(p,version){
    const leader=user.rol==='EVALUADOR'&&(p.participaciones||[]).some(x=>x.usuarioId===user.id&&x.principal&&x.activo!==false);
    const allowed=admin||leader,section=$('additionalSection');section.classList.toggle('g1-hide',!allowed);
    $('additionalProposalForm').classList.toggle('g1-hide',!leader||p.estado!=='ACTIVO');
    $('additionalConfirmForm').classList.toggle('g1-hide',!admin||p.estado!=='ACTIVO');
    $('additionalAcceptanceForm').classList.toggle('g1-hide',!leader||p.estado!=='ACTIVO');
    $('additionalChangeForm').classList.toggle('g1-hide',!admin||p.estado!=='ACTIVO');
    additionalAgreements=[];
    additionalOptions('taskAdditionalId',[]);
    coverageChoices();
    if(!allowed)return;
    const root=$('additionalList');root.textContent='Consultando acuerdos adicionales…';
    try {
      const items=await api(`/proyectos/${p.id}/acuerdos-adicionales`);
      if(version!==detailVersion)return;
      if(!Array.isArray(items))throw Error('Respuesta no válida del registro de acuerdos adicionales.');
      additionalAgreements=items;root.replaceChildren();
      if(!items.length)root.append(elt('p','No se han registrado propuestas de servicio adicional.','g1-muted'));
      for(const x of items){card(root,`#${x.id} · ${x.titulo}`,[`Estado: ${x.estado}`,x.descripcion,
        x.referenciaAcuerdo?`Contrato o anexo: ${x.referenciaAcuerdo}`:'Sin confirmación comercial',
        x.referenciaAceptacion?`Alcance aceptado: ${x.referenciaAceptacion}`:'Aceptación externa pendiente',
        x.referenciaCambio?`Cambio comercial: ${x.referenciaCambio}`:'',
        ['CANCELADO','MODIFICADO'].includes(x.estado)?'El trabajo pendiente está bloqueado; se conserva el historial.':'']);}
      additionalOptions('additionalToConfirm',items.filter(x=>x.estado==='PROPUESTO'));
      additionalOptions('additionalToAccept',items.filter(x=>x.estado==='CONFIRMADO'));
      additionalOptions('additionalToChange',items.filter(x=>['CONFIRMADO','HABILITADO'].includes(x.estado)));
      additionalOptions('taskAdditionalId',items.filter(x=>x.estado==='HABILITADO'));
      taskWizard.refresh();
      continuityChoices();
      if(tasksReadyVersion===version && selected?.id===p.id)renderTasks();
    } catch(e){if(version===detailVersion)root.textContent='No se pudo consultar acuerdos: '+e.message;}
  }

  let planPending=null;
  async function showPlan(p,version){
    const label=$('planStatus'), root=$('planHistory');
    label.textContent='Consultando versiones del plan…';root.replaceChildren();
    const leader=user.rol==='EVALUADOR' && (p.participaciones||[]).some(x=>x.usuarioId===user.id&&x.principal&&x.activo!==false);
    for(const id of ['planProposalForm','planAcceptanceForm','planRejectionForm','planWithdrawForm','planRegularizationForm'])$(id).classList.add('g1-hide');
    try{
      const rows=await api(`/proyectos/${p.id}/planes`);
      if(version!==detailVersion)return;
      if(!Array.isArray(rows))throw Error('Respuesta de plan inválida.');
      const current=rows[0];planPending=current?.estado==='PROPUESTO'?current:null;
      label.textContent=current?`Última versión: ${current.numero} · ${current.estado}. Actividades propuestas: ${current.actividadIds?.length||0}.`:
        'No existe un plan aceptado en esta plataforma. Las actividades nuevas no están autorizadas para ejecución.';
      if(!rows.length)root.append(elt('p','No hay propuestas registradas.','g1-muted'));
      for(const x of rows){const panel=card(root,`Versión ${x.numero} · ${x.estado}`,[x.contenido,
        `Actividades incluidas en esta versión: ${(x.actividadIds||[]).join(', ')||'ninguna'}`,
        `Presentación: ${x.referenciaPresentacion}`,
        x.referenciaAceptacion?`Aceptación externa: ${x.referenciaAceptacion}`:'',
        x.constanciaAceptacion?`Constancia: ${x.constanciaAceptacion}`:'',
        x.motivoNoAceptacion?`No aceptación externa: ${x.motivoNoAceptacion}`:'',
        x.motivoRetiro?`Retiro técnico: ${x.motivoRetiro}`:'',
        x.regularizacionHistorica?`Q-75 · aceptación histórica ${new Date(x.regularizacionHistorica.fechaAceptacionHistorica).toLocaleString('es-CO')} · registro ${new Date(x.regularizacionHistorica.registradoEn).toLocaleString('es-CO')}`:'',
        x.regularizacionHistorica?`PDF SHA-256: ${x.regularizacionHistorica.sha256Evidencia}`:'']);
        if(x.regularizacionHistorica){const b=elt('button','Consultar evidencia PDF','secondary');b.type='button';b.addEventListener('click',async()=>{
          b.disabled=true;try{const blob=await api(`/proyectos/${p.id}/planes/${x.id}/evidencia-historica`,{binary:true});
            const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`Q75-evidencia-plan-${x.numero}.pdf`;a.click();
            setTimeout(()=>URL.revokeObjectURL(url),2000);
          }catch(e){status('No se pudo verificar/descargar la evidencia: '+e.message,true);}finally{b.disabled=false;}
        });panel.append(b);}
      }
      if(leader && p.estado==='ACTIVO'){
        $('planProposalForm').classList.toggle('g1-hide',Boolean(planPending));
        $('planAcceptanceForm').classList.toggle('g1-hide',!planPending);
        $('planRejectionForm').classList.toggle('g1-hide',!planPending);
        $('planWithdrawForm').classList.toggle('g1-hide',!planPending);
        // No se reconocen actividades por simple estado: la lista proviene de la
        // instantánea cerrada capturada por la migración Q75.
        try {
          const eligible=await api(`/proyectos/${p.id}/planes/regularizacion/elegibles`);
          if(version!==detailVersion)return;
          const target=$('planRegularizationCandidates');target.replaceChildren();
          for(const task of eligible){const lbl=elt('label',null,'g1-muted');const cb=elt('input');cb.type='checkbox';cb.name='actividadHistorica';cb.value=String(task.id);
            lbl.append(cb,document.createTextNode(` #${task.id} · ${task.titulo} (${task.estado})`));target.append(lbl);}
          $('planRegularizationForm').classList.toggle('g1-hide',!eligible.length || Boolean(planPending));
        }catch(error){if(version===detailVersion)status('No se pudieron consultar actividades históricas Q-75: '+error.message,true);}

      }
    }catch(e){if(version===detailVersion)label.textContent='No se pudo consultar el plan: '+e.message;}
  }

  let selected=null;
  let selectedDiagnosis=null;
  let diagnosisDraftComments=new Map();
  let diagnosisRequestId=0;
  let breachesLoaded=[];
  let projectsLoaded=[];
  let tasksLoaded=[];
  let breachResults = null, breachCards = new Map();
  function openBreachActivity(taskId) {
    if (!selected) return;
    $('taskSearch').value = ''; $('taskFilter').value = 'TODAS'; $('myTasks').checked = false;
    renderTasks();
    const target = Array.from($('tasks').querySelectorAll('.activity-card'))
      .find(card => card.dataset.taskId === String(taskId));
    const heading = target?.querySelector('h4');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'center', behavior: 'instant' }); }
  }
  function updateBreaches() {
    const metrics = $('breachMetrics');metrics.replaceChildren();
    if (!breachResults) return;
    for (const [name,count] of [
      ['Total',breachResults.total], ['Abiertas',breachResults.statuses.ABIERTA],
      ['En tratamiento',breachResults.statuses.EN_TRATAMIENTO],
      ['Cierre propuesto',breachResults.statuses.PROPUESTA_CIERRE],
      ['Cerradas',breachResults.statuses.CERRADA]]) {
      const metric = elt('div',null,'breach-metric');
      metric.append(elt('strong',count),elt('span',name)); metrics.append(metric);
    }
    let visible = 0;
    for (const item of breachResults.items) {
      const origin=$('breachOriginFilter').value;
      const hasOrigin=item.breach.origenEvaluacionId!==null && item.breach.origenEvaluacionId!==undefined;
      const originMatches=origin==='TODAS'||(origin==='SIN_ORIGEN'&&!hasOrigin)||(hasOrigin&&String(item.breach.origenEvaluacionId)===origin);
      const show = originMatches && window.NexoBreachUI.matches(item,$('breachSearch').value,$('breachFilter').value,$('breachFollowup').checked);
      const card = breachCards.get(String(item.breach.id));
      if (card) { card.hidden = !show; if (show) visible++; }
    }
    $('breachSummary').textContent = `${visible} de ${breachResults.total} brechas visibles. ${breachResults.currentLinks} vínculos de actividad vigentes en total (pueden compartir actividad).`;
    $('breachWorkspace').setAttribute('aria-busy','false');
  }
  for (const [id,event] of [['breachSearch','input'],['breachFilter','change'],['breachOriginFilter','change'],['breachFollowup','change']])
    $(id).addEventListener(event,updateBreaches);
  $('clearBreachFilters').addEventListener('click',()=>{
    $('breachSearch').value='';$('breachFilter').value='TODAS';$('breachOriginFilter').value='TODAS';$('breachFollowup').checked=false;
    updateBreaches();$('breachSearch').focus();
  });
  let tasksReadyVersion=0;
  let detailVersion=0;
  let attentionDocuments=null, attentionDocsError=false, attentionExpanded=false;
  let pendingDateChange=null;
  let pendingClosure=null, pendingBreachReopen=null;
  let pendingMemberRemoval=null, pendingTaskReassignment=null, pendingTeamAdd=null, pendingActivityAnnul=null, pendingBranchRetire=null, pendingLinkExclusion=null, pendingCompletedScope=null;
  const normalize = value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
  function renderProjectList() {
    const query=normalize($('searchProjects').value.trim());
    const filter=$('filterProjectState').value;
    const rows=projectsLoaded.filter(p=>{
      const matches=normalize(`${p.id} ${p.nombre} ${p.empresa?.nombre||''}`).includes(query);
      return matches && (filter==='TODOS'||(filter==='ACTIVO'&&p.estado==='ACTIVO')||(filter==='OTROS'&&p.estado!=='ACTIVO'));
    });
    const root=$('projects');root.replaceChildren();
    $('projectsSummary').textContent=`${rows.length} de ${projectsLoaded.length} proyectos disponibles.`;
    if(!rows.length) {
      const empty=elt('p',projectsLoaded.length?'Ningún proyecto coincide con los filtros.':'No hay proyectos asociados a esta cuenta.','empty-list');
      root.append(empty);
      if(projectsLoaded.length && (query || filter!=='TODOS')) {
        const reset=elt('button','Restablecer búsqueda','secondary');reset.type='button';
        reset.addEventListener('click',()=>{
          $('searchProjects').value='';$('filterProjectState').value='TODOS';
          renderProjectList();$('searchProjects').focus();
        });
        root.append(reset);
      }
      return;
    }
    for(const p of rows) {
      const div=card(root,p.nombre,[`Proyecto #${p.id} · ${p.estado}`,`Empresa: ${p.empresa?.nombre||'No disponible'}`]);
      if(selected?.id===p.id) div.classList.add('project-selected');
      const b=elt('button',selected?.id===p.id?'Proyecto abierto':'Abrir expediente');b.type='button';
      b.setAttribute('aria-pressed',String(selected?.id===p.id));
      b.addEventListener('click',async()=>{
        if(await detail(p.id)){
          $('projectDetail').scrollIntoView({block:'start',behavior:'instant'});
          $('projectTitle').focus({preventScroll:true});
        }
      });div.append(b);
    }
  }
  let projectsRequestId=0;
  async function projects(){
    const request=++projectsRequestId;
    const root=$('projects');
    root.setAttribute('aria-busy','true');$('projectsSummary').textContent='Consultando proyectos…';
    root.replaceChildren(elt('p','Cargando proyectos…','loading-state'));
    try {
      const data=await api('/proyectos');
      if(request!==projectsRequestId)return false;
      if(!Array.isArray(data))throw Error('La API devolvió proyectos en un formato inválido.');
      projectsLoaded=data;
      if(admin)choices('proyectoAsignarSelect',data,x=>`${x.nombre} · #${x.id}`);
      // Si un proyecto deja de estar autorizado, no conserva su expediente en pantalla.
      if(selected && !data.some(p=>p.id===selected.id)) {
        selected=null;detailVersion++;tasksLoaded=[];$('projectDetail').classList.add('g1-hide');
        history.replaceState(null,'','./proyectos.html');
      }
      renderProjectList();
      if($('feedback').classList.contains('error'))status('Proyectos actualizados.');
      const requested=Number(new URLSearchParams(location.search).get('id'));
      if(!selected && Number.isSafeInteger(requested)&&requested>0 && data.some(p=>p.id===requested))await detail(requested);
      else if(requested&&!data.some(p=>p.id===requested)) {
        status('El proyecto solicitado no se encuentra entre tus proyectos accesibles.',true);
        history.replaceState(null,'','./proyectos.html');
      }
      return true;
    }catch(e){
      if(request!==projectsRequestId)return false;
      projectsLoaded=[];selected=null;tasksLoaded=[];detailVersion++;$('projectDetail').classList.add('g1-hide');
      const error=elt('div',null,'retry-panel');error.setAttribute('role','alert');
      error.append(elt('strong','No se pudieron cargar los proyectos.'),elt('p',e.message));
      const retry=elt('button','Reintentar consulta','secondary');retry.type='button';
      retry.addEventListener('click',()=>projects());error.append(retry);
      root.replaceChildren(error);
      $('projectsSummary').textContent='No fue posible actualizar los proyectos.';
      status(e.message,true);return false;
    }finally{if(request===projectsRequestId)root.setAttribute('aria-busy','false')}
  }
  $('searchProjects').addEventListener('input',renderProjectList);
  $('filterProjectState').addEventListener('change',renderProjectList);
  // Navegación del expediente: solo se ofrecen destinos visibles y operables.
  function updateCaseIndex(){
    const nav=$('caseIndex');
    for(const link of nav.querySelectorAll('a[href^="#"]')){
      const target=document.getElementById(link.getAttribute('href').slice(1));
      const available=!!target && !target.classList.contains('g1-hide') &&
        !target.closest('.g1-hide');
      link.hidden=!available;
      if(!available)link.removeAttribute('aria-current');
    }
  }
  // Resumen derivado de las actividades ya obtenidas del backend: nunca estima avances ni permisos.
  // Una sola vista de seguimiento; nunca confunde sugerencias con permisos del backend.
  function updateAttention(){
    const surface=$('attentionWorkspace');
    const leader=Boolean(selected && selected.estado==='ACTIVO' && consultor &&
      selected.participaciones?.some(p=>String(p.usuarioId)===String(user.id) && p.principal && p.activo!==false && p.usuario?.activo!==false));
    surface.classList.toggle('g1-hide',!leader);
    if(!leader){surface.setAttribute('aria-busy','false');return;}
    if(tasksReadyVersion!==detailVersion){surface.setAttribute('aria-busy','true');return;}
    const result=window.NexoAttentionUI.summarize(tasksLoaded,attentionDocuments,selected);
    surface.setAttribute('aria-busy','false');
    $('attentionStatus').textContent=result.documentsLoaded?'Actividades y documentos actualizados':
      (attentionDocsError?'Documentos no disponibles: consulta el módulo documental.':'Esperando documentos…');
    const metrics=$('attentionMetrics');metrics.replaceChildren();
    for(const group of result.order){
      const metric=elt('div',null,'attention-metric');
      metric.append(elt('strong',result.documentsLoaded || !['documentos','correcciones'].includes(group)?result.counts[group]:'—'),
        elt('span',result.labels[group]));metrics.append(metric);
    }
    const rows=$('attentionRows');rows.replaceChildren();
    const limit=attentionExpanded?result.records.length:8;
    if(!result.records.length)rows.append(elt('p',result.documentsLoaded?
      'No se identifican pendientes en estas categorías. Revisa igualmente el expediente completo.':
      'No hay actividades en estas categorías. Esperando el estado documental.','attention-empty'));
    for(const item of result.records.slice(0,limit)){
      const row=elt('article',null,'attention-item');
      const copy=elt('div',null,'attention-item-copy');
      copy.append(elt('span',result.labels[item.group],'attention-item-type'),
        elt('h4',`#${item.id} · ${item.title}`),elt('p',item.detail));
      const button=elt('button',item.kind==='documento'?'Abrir entregable':'Abrir actividad','secondary');button.type='button';
      button.setAttribute('aria-label',`${item.kind==='documento'?'Abrir entregable':'Abrir actividad'} #${item.id}: ${item.title}`);
      button.addEventListener('click',()=>{
        if(item.kind==='documento')document.dispatchEvent(new CustomEvent('iso:attention:abrir-entregable',
          {detail:{proyectoId:selected.id,entregableId:item.id}}));
        else{
          $('taskSearch').value='';$('taskFilter').value='TODAS';$('myTasks').checked=false;
          renderTasks();
          const target=Array.from($('tasks').querySelectorAll('.activity-card'))
            .find(card=>card.dataset.taskId===item.id);
          const heading=target?.querySelector('h4');
          if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});heading.scrollIntoView({block:'center',behavior:'instant'});}
        }
      });
      row.append(copy,button);rows.append(row);
    }
    const more=$('attentionMore');more.hidden=result.records.length<=8;
    more.textContent=attentionExpanded?'Mostrar menos':`Mostrar todos (${result.records.length})`;
    $('attentionSummary').textContent=`${result.records.length} asuntos de seguimiento${!attentionExpanded&&result.records.length>8?' · mostrando los primeros 8':''}. La API valida cada acción.`;
    updateCaseIndex();
  }
  $('attentionMore').addEventListener('click',()=>{attentionExpanded=!attentionExpanded;updateAttention();});
  document.addEventListener('iso:g2:entregables',event=>{
    if(!selected || String(event.detail.proyectoId)!==String(selected.id))return;
    attentionDocuments=event.detail.entregables;attentionDocsError=false;updateAttention();
  });
  document.addEventListener('iso:g2:entregables-error',event=>{
    if(!selected || String(event.detail.proyectoId)!==String(selected.id))return;
    attentionDocuments=null;attentionDocsError=true;updateAttention();
  });
  function updateCaseOverview(){
    const counts=tasksLoaded.reduce((result,task)=>{
      result[task.estado]=(result[task.estado]||0)+1;return result;
    },{});
    for(const counter of $('caseOverview').querySelectorAll('[data-task-count]')){
      const state=counter.dataset.taskCount;
      counter.textContent=String(state==='TODAS'?tasksLoaded.length:(counts[state]||0));
    }
    for(const button of $('caseOverview').querySelectorAll('[data-task-state]')){
      button.setAttribute('aria-pressed',String(button.dataset.taskState===$('taskFilter').value));
    }
    $('caseOverviewStatus').textContent=tasksLoaded.length?`${tasksLoaded.length} actividades registradas`:'Sin actividades registradas';
    $('caseOverview').setAttribute('aria-busy','false');
  }
  $('caseOverview').addEventListener('click',event=>{
    const button=event.target.closest('button[data-task-state]');
    if(!button || !event.currentTarget.contains(button))return;
    $('taskFilter').value=button.dataset.taskState;
    renderTasks();
    $('actividades').scrollIntoView({block:'start',behavior:'instant'});
    const heading=$('actividades').querySelector('h2,h3');
    if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});}
  });
  $('clearProjectFilters').addEventListener('click',()=>{
    $('searchProjects').value='';$('filterProjectState').value='TODOS';
    renderProjectList();$('searchProjects').focus();
  });
  $('returnToProjects').addEventListener('click',()=>{
    $('projectCollection').scrollIntoView({block:'start',behavior:'instant'});
    $('projectsHeading').focus({preventScroll:true});
  });
  $('caseIndex').addEventListener('click',event=>{
    const link=event.target.closest('a[href^="#"]');
    if(!link||link.hidden)return;
    const section=document.getElementById(link.hash.slice(1));
    if(!section || section.closest('.g1-hide')){event.preventDefault();return;}
    for(const item of $('caseIndex').querySelectorAll('a'))item.removeAttribute('aria-current');
    link.setAttribute('aria-current','location');
  });
  const caseIndexObserver=new MutationObserver(updateCaseIndex);
  for(const id of ['projectDetail','attentionWorkspace','additionalSection','retentionSection','g3Area'])
    caseIndexObserver.observe($(id),{attributes:true,attributeFilter:['class']});
  updateCaseIndex();

  // SOL-52: mostrar dependencia operativa antes de retirar un colaborador.
  function openActivitiesByAssignee(id) {
    return tasksLoaded.filter(t=>t.asignadoAId===id && !['COMPLETADA','CANCELADA'].includes(t.estado));
  }
  function renderTeam(){
    const team=$('projectTeam');team.replaceChildren();
    const p=selected;
    const lider=consultor && p?.participaciones?.some(x=>x.usuarioId===user.id && x.principal && x.usuario?.activo!==false);
    const manager=admin||lider;
    team.classList.toggle('g1-hide',!manager||!p);
    if(!manager||!p)return;
    team.append(elt('h3','Equipo del proyecto'));
    if(lider && p.estado==='ACTIVO'){
      const add=elt('button','Incorporar colaborador','secondary');add.type='button';
      add.addEventListener('click',()=>openTeamAdd(p.id));team.append(add);
    }
    const members=elt('div',null,'g1-actions');
    for(const member of p.participaciones||[]){
      const wrap=elt('div',null,'team-member');
      const displayName=member.usuario?.nombre||accounts.find(x=>x.id===member.usuarioId)?.nombre||`Consultor #${member.usuarioId}`;
      const assigned=openActivitiesByAssignee(member.usuarioId);
      wrap.append(elt('strong',displayName),elt('span',member.principal?'Consultor principal':'Consultor asignado','g1-muted'));
      if(member.usuario?.activo===false)wrap.append(elt('span','Cuenta bloqueada: requiere reemplazo o resolución de acceso.','inline-alert error'));
      if(assigned.length)wrap.append(elt('span',`${assigned.length} actividad(es) pendiente(s) bajo su responsabilidad`,'g1-muted'));
      if(manager && !member.principal && p.estado==='ACTIVO'){
        const revoke=elt('button','Retirar del proyecto','secondary');revoke.type='button';
        revoke.addEventListener('click',()=>{
          pendingMemberRemoval={projectId:p.id,usuarioId:member.usuarioId,version:detailVersion};
          $('teamRemovalContext').textContent=`${displayName} · Proyecto #${p.id}`;
          $('teamRemovalPending').textContent=assigned.length
            ? `ATENCIÓN: ${assigned.length} actividad(es) pendiente(s) requerirán reasignación explícita por el principal. No se reasignan automáticamente.`
            : 'No se encontraron actividades pendientes a su cargo.';
          $('teamRemovalDialog').showModal();
        });wrap.append(revoke);
      }
      members.append(wrap);
    }
    if(!(p.participaciones||[]).length)members.append(elt('p','No hay consultores activos.'));
    team.append(members);
    const orphaned=tasksLoaded.filter(t=>t.tipoResponsable==='CONSULTORA' && !['COMPLETADA','CANCELADA'].includes(t.estado)
      && !(p.participaciones||[]).some(m=>m.usuarioId===t.asignadoAId&&m.usuario?.activo!==false));
    if(orphaned.length)team.append(elt('p',`${orphaned.length} actividad(es) de consultora requieren designar un encargado con acceso vigente.`, 'inline-alert error'));
  }
  async function openTeamAdd(projectId) {
    if (!selected || selected.id!==projectId) return;
    const version=detailVersion;
    const requestToken={projectId,version};pendingTeamAdd=requestToken;
    const dialog=$('teamAddDialog'),select=$('teamAddUser');
    select.replaceChildren(elt('option','Cargando consultores…'));
    select.disabled=true;
    $('teamAddContext').textContent=`Proyecto #${projectId} · Selecciona un consultor activo de la consultora.`;
    const submit=$('teamAddForm').querySelector('[type="submit"]');submit.disabled=true;
    dialog.showModal();
    try {
      const candidates=await api(`/proyectos/${projectId}/consultores-disponibles`);
      if (!dialog.open || pendingTeamAdd!==requestToken || selected?.id!==projectId || version!==detailVersion) return;
      if (!Array.isArray(candidates)) throw Error('No se pudo consultar el directorio de consultores.');
      select.replaceChildren();
      const placeholder=elt('option',candidates.length?'Selecciona un consultor':'No hay consultores disponibles');
      placeholder.value='';select.append(placeholder);
      for(const c of candidates){const option=elt('option',c.nombre||`Consultor #${c.id}`);option.value=String(c.id);select.append(option);}
      select.disabled=!candidates.length;submit.disabled=!candidates.length;
    } catch(e) {
      if(dialog.open && pendingTeamAdd===requestToken && selected?.id===projectId){
        select.replaceChildren(elt('option','No disponible'));status(e.message,true);
      }
    }
  }
  function beginTaskReassignment(task){
    if(!selected)return;
    const eligible=(selected.participaciones||[]).filter(x=>x.usuario?.activo!==false && x.usuario?.rol==='EVALUADOR' && x.usuarioId!==task.asignadoAId);
    const select=$('activityReassignUser');select.replaceChildren();
    const placeholder=elt('option',eligible.length?'Selecciona un encargado':'No hay otros consultores activos');placeholder.value='';select.append(placeholder);
    for(const c of eligible){const opt=elt('option',c.usuario?.nombre||`Consultor #${c.usuarioId}`);opt.value=c.usuarioId;select.append(opt);}
    $('activityReassignForm').reset();
    $('activityReassignContext').textContent=`Actividad #${task.id} · ${task.titulo} · Estado: ${task.estado}`;
    pendingTaskReassignment={projectId:selected.id,actividadId:task.id,esperadoResponsableId:task.asignadoAId,version:detailVersion};
    $('activityReassignForm').querySelector('[type="submit"]').disabled=!eligible.length;
    $('activityReassignDialog').showModal();
  }
  function beginDateChange(task) {
    if(!selected)return;
    pendingDateChange={projectId:selected.id,activityId:task.id,version:detailVersion,
      fechaAnteriorEsperada:task.fechaObjetivo ? String(task.fechaObjetivo).slice(0,10) : null};
    $('dateChangeContext').textContent=`Actividad #${task.id} · ${task.titulo} · Fecha anterior: ${pendingDateChange.fechaAnteriorEsperada||'sin fecha'}`;
    $('dateChangeForm').reset();
    $('dateChangeNew').value=pendingDateChange.fechaAnteriorEsperada||'';
    $('dateChangeDialog').showModal();
  }
  // DEC-Q57: la bandeja solo es visible para el representante y se actualiza
  // periódicamente mientras la pestaña está activa. La API filtra por identidad.
  let lastNotificationRequest=0;
  async function refreshNotifications() {
    const request=++lastNotificationRequest;
    if(user.rol!=='EMPRESARIO')return;
    const root=$('notificationsList');
    root.setAttribute('aria-busy','true');
    try{
      const response=await api('/proyectos/notificaciones/mias');
      if(request!==lastNotificationRequest)return;
      if(!Array.isArray(response.notificaciones))throw Error('Respuesta de avisos inválida.');
      root.replaceChildren();
      $('notificationsCount').textContent=`${response.pendientes} aviso(s) pendientes de lectura. Se muestran ${response.notificaciones.length} avisos, primero los pendientes.`;
      if(!response.notificaciones.length)root.append(elt('p','No tienes notificaciones pendientes.','g1-muted'));
      for(const n of response.notificaciones){
        const previous=n.fechaAnterior?String(n.fechaAnterior).slice(0,10):'sin fecha';
        const next=n.fechaNueva?String(n.fechaNueva).slice(0,10):'sin fecha';
        const date=n.creadaEn?new Date(n.creadaEn).toLocaleString('es-CO'):'';
        const termination=n.tipo==='TERMINACION_ANTICIPADA_ABANDONO';
        const item=card(root,termination?'Terminación anticipada del servicio':(n.actividad?.titulo||`Actividad #${n.actividadId}`), termination?[
          `${n.proyecto?.nombre||'Proyecto'} · ${date}`,
          'El servicio ha terminado anticipadamente por abandono. Consulta el expediente y las comunicaciones contractuales aplicables.',
          n.justificacion,
          n.origenNotificacionId ? `Aviso reemitido por sustitución de representante · aviso original #${n.origenNotificacionId}. La constancia contractual anterior no cambia.` : 'Aviso emitido al representante vigente',
          n.leidaEn?'Leída':'Pendiente de lectura',
        ]:[
          `${n.proyecto?.nombre||'Proyecto'} · ${date}`,
          `Fecha anterior: ${previous} · Nueva: ${next}`,
          `Justificación: ${n.justificacion}`,
          n.origenNotificacionId ? `Aviso reemitido por cambio de representante · aviso original #${n.origenNotificacionId}` : 'Aviso emitido al representante vigente',
          n.leidaEn?'Leída':'Pendiente de lectura',
        ]);
        if(!n.leidaEn){
          item.classList.add('notification-unread');
          const mark=elt('button','Marcar como leída','secondary');mark.type='button';
          mark.addEventListener('click',async()=>{
            if(mark.disabled)return;mark.disabled=true;
            try{await api(`/proyectos/notificaciones/${n.id}/leida`,{method:'PATCH',body:'{}'});await refreshNotifications();}
            catch(err){status(err.message,true);mark.disabled=false;}
          });item.append(mark);
        }
        const open=elt('button','Abrir proyecto','secondary');open.type='button';
        open.addEventListener('click',()=>{detail(n.proyectoId);});item.append(open);
      }
    }catch(e){if(request!==lastNotificationRequest)return; $('notificationsCount').textContent='No fue posible consultar las notificaciones.';
      root.replaceChildren(elt('p',e.message,'inline-alert error'));}
    finally{if(request===lastNotificationRequest)root.setAttribute('aria-busy','false');}
  }
  if(user.rol==='EMPRESARIO'){
    $('notificationsArea').classList.remove('g1-hide');
    $('notificationsReload').addEventListener('click',refreshNotifications);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshNotifications();});
    // Sin WebSocket ni dependencia de servicios externos: sondeo moderado.
    setInterval(()=>{if(!document.hidden)refreshNotifications();},30000);
    refreshNotifications();
  }
  async function detail(id){
    const originalBreachOrigin=selected&&String(selected.id)===String(id)?$('breachOriginSelect').value:'';
    const version=++detailVersion;tasksReadyVersion=0;
    breachResults=null;breachCards.clear();
    breachesLoaded=[];selectedDiagnosis=null;diagnosisDraftComments.clear();diagnosisRequestId++;
    $('diagnosisDetail').setAttribute('aria-busy','false');
    $('diagnosisDetail').classList.add('g1-hide');$('diagnosisAnswers').replaceChildren();
    $('breachOriginFilter').replaceChildren();$('breachOriginSelect').replaceChildren();
    $('breachWorkspace').setAttribute('aria-busy','true');
    $('breachSummary').textContent='Cargando brechas…'; $('breachMetrics').replaceChildren();
    $('breaches').replaceChildren();
    $('breachSearch').value='';$('breachFilter').value='TODAS';$('breachOriginFilter').value='TODAS';$('breachFollowup').checked=false;
    attentionDocuments=null;attentionDocsError=false;attentionExpanded=false;
    $('attentionWorkspace').classList.add('g1-hide');$('attentionWorkspace').setAttribute('aria-busy','true');
    for(const id of ['breachClosureDialog','teamRemovalDialog','teamAddDialog','activityReassignDialog','activityAnnulDialog','branchRetireDialog','breachReopenDialog','dateChangeDialog'])if($(id).open)$(id).close();
    $('caseOverview').setAttribute('aria-busy','true');
    $('caseOverviewStatus').textContent='Cargando actividades…';
    $('feedback').textContent='Abriendo expediente…';$('feedback').className='g1-alert';
    try {
      const p=await api(`/proyectos/${id}`);
      if(version!==detailVersion)return false;
      if(selected && String(selected.id)!==String(p.id)){
        caseWorkspace.reset();$('taskForm').reset();$('brechaForm').reset();coverageChoices();
        $('projectDetail').querySelectorAll('.form-operation-feedback').forEach(note=>note.remove());
      }
      selected=p;$('projectDetail').classList.remove('g1-hide');
      updateAttention();
      showAdditional(p,version);
      showPlan(p,version);
      if(admin && $('proyectoAsignarSelect').querySelector(`option[value="${p.id}"]`))$('proyectoAsignarSelect').value=String(p.id);
      renderProjectList();
      $('projectTitle').textContent=`${p.nombre} · #${p.id}`;
      updateCaseIndex();
      document.dispatchEvent(new CustomEvent('iso:g2:proyecto', { detail: { proyecto: p, usuario: user } }));
      document.dispatchEvent(new CustomEvent('iso:q60:proyecto', { detail: { proyecto: p, usuario: user } }));
      $('projectDesc').textContent=`Empresa ${p.empresa.nombre} · ${p.estado} · Alcance SGSI propuesto: ${p.alcanceSGSIPropuesto||'por definir'}`;
      if(new URLSearchParams(location.search).get('id')!==String(p.id))history.replaceState(null,'',`?id=${encodeURIComponent(p.id)}`);
      const assigned=consultor && p.participaciones.some(x=>x.usuarioId===user.id);
      $('consultorForms').classList.toggle('g1-hide',!assigned || p.estado!=='ACTIVO');
      const projectLeader=assigned && p.participaciones.some(x=>x.usuarioId===user.id&&x.principal&&x.usuario?.activo!==false);
      $('taskForm').classList.toggle('g1-hide',!projectLeader || p.estado!=='ACTIVO');
      caseWorkspace.sync();
      $('newDiagnosis').classList.toggle('g1-hide', p.estado!=='ACTIVO' || !['EMPRESARIO','ADMIN'].includes(user.rol));
      $('newDiagnosis').textContent=admin?'Habilitar diagnóstico para la empresa':'Iniciar mi diagnóstico';
      const [brechas,tareas,diagnosticos]=await Promise.all([
        api(`/proyectos/${id}/brechas`),api(`/proyectos/${id}/actividades`),api(`/proyectos/${id}/diagnosticos`)]);
      if(version!==detailVersion)return false;
      if(!Array.isArray(brechas)||!Array.isArray(tareas)||!Array.isArray(diagnosticos))throw Error('El servidor devolvió datos incompletos del expediente.');
      breachesLoaded=brechas;
      const originCreate=$('breachOriginSelect'),originFilter=$('breachOriginFilter');
      const createBlank=elt('option','Sin diagnóstico de origen documentado');createBlank.value='';originCreate.append(createBlank);
      for(const [value,title] of [['TODAS','Todos los diagnósticos'],['SIN_ORIGEN','Sin diagnóstico vinculado']]){
        const option=elt('option',title);option.value=value;originFilter.append(option);
      }
      for(const d of diagnosticos){
        const createOption=elt('option',`Diagnóstico #${d.id} · ${d.estado}`);createOption.value=String(d.id);originCreate.append(createOption);
        const filterOption=elt('option',`Diagnóstico #${d.id}`);filterOption.value=String(d.id);originFilter.append(filterOption);
      }
      if(diagnosticos.some(d=>String(d.id)===originalBreachOrigin))originCreate.value=originalBreachOrigin;
      breachResults=window.NexoBreachUI.summarize(brechas,tareas);
      tasksLoaded=tareas;tasksReadyVersion=version;
      updateAttention();
      updateCaseOverview();
      renderTeam();
      $('breaches').replaceChildren();$('tasks').replaceChildren();$('diagnoses').replaceChildren();
      const brechaField=$('taskBrechaSelect');brechaField.replaceChildren();
      for(const b of brechas.filter(x=>x.estado!=='CERRADA')){const o=elt('option',`#${b.id} · ${b.titulo}`);o.value=String(b.id);brechaField.append(o);}
      currentAssignees=[...p.participaciones.filter(x=>x.activo!==false&&x.usuario?.activo!==false).map(x=>({id:x.usuarioId,nombre:x.usuario?.nombre||accounts.find(a=>a.id===x.usuarioId)?.nombre||'Consultor #'+x.usuarioId,tipo:'CONSULTORA'})),{id:p.empresa.usuarioId,nombre:p.empresa.nombre+' · representante',tipo:'CLIENTE'}];
      responsibleChoices();
      for(const selId of ['g2CrearEntregable','g2Verificacion']) {
        const form=$(selId), field=form?.elements.actividadId;
        if(field && field.tagName==='SELECT') {
          const prev=field.value;field.replaceChildren();const empty=elt('option','Selecciona actividad');empty.value='';field.append(empty);
          const eligible=tareas.filter(a=>selId==='g2Verificacion'?a.estado==='EN_REVISION':!['COMPLETADA','CANCELADA'].includes(a.estado));for(const act of eligible){const opt=elt('option',`#${act.id} · ${act.titulo}`);opt.value=act.id;field.append(opt);}if(eligible.some(a=>String(a.id)===prev))field.value=prev;
        }
      }
      document.dispatchEvent(new CustomEvent('iso:g2:actividades', {detail: {proyectoId:id, actividades:tareas}}));
      verificationHints.refresh();
      const closeField=$('g2CerrarBrecha')?.elements.brechaId;
      if(closeField && closeField.tagName==='SELECT'){
        closeField.replaceChildren();const empty=elt('option','Selecciona brecha propuesta');empty.value='';closeField.append(empty);
        for(const b of brechas.filter(x=>x.estado==='PROPUESTA_CIERRE')){const o=elt('option',`#${b.id} · ${b.titulo}`);o.value=b.id;closeField.append(o);}
      }
      $('diagnosisDetail').classList.add('g1-hide');selectedDiagnosis=null;diagnosisDraftComments.clear();
      const leader=assigned && p.participaciones.some(x=>x.usuarioId===user.id&&x.principal);
      brechas.forEach(b=>{
        // DEC-Q70/Q71: orientaciones de continuidad; la API valida auditorías
        // Q68 y evidencia de TODAS las ramas en la propuesta y en el cierre.
        const relacionadas=tareas.filter(t=>(t.brechas||[]).some(x=>x.brechaId===b.id && !x.excluidaEn));
        const exclusiones=tareas.filter(t=>(t.brechas||[]).some(x=>x.brechaId===b.id && x.excluidaEn));
        function rutasDesde(actual,previos=new Set()){
          if(previos.has(actual.id))return {rutas:[],error:true};
          if(actual.estado!=='CANCELADA')return {rutas:[[actual.id]],error:actual.estado!=='COMPLETADA'};
          const siguientes=relacionadas.filter(t=>t.actividadOrigenId===actual.id);
          // Una hoja CANCELADA podría ser un retiro Q72, pero solo la API
          // puede confirmar que existe constancia comercial y evento válido.
          if(!siguientes.length)return {rutas:[[actual.id]],error:false,pendienteAuditoria:true};
          const rutas=[];let error=false,pendienteAuditoria=false;
          for(const siguiente of siguientes){
            const r=rutasDesde(siguiente,new Set([...previos,actual.id]));
            rutas.push(...r.rutas.map(camino=>[actual.id,...camino]));
            error ||= r.error;pendienteAuditoria ||= Boolean(r.pendienteAuditoria);
          }
          return {rutas,error,pendienteAuditoria};
        }
        const canceladas=relacionadas.filter(t=>t.estado==='CANCELADA');
        const reglas=canceladas.map(origen=>{
          const {rutas,error,pendienteAuditoria}=rutasDesde(origen);
          const ramificada=rutas.length>1;
          const cadena=rutas.map(r=>r.map(x=>'#'+x).join(' → ')).join(' | ');
          return error
            ? `Continuidad ${cadena}: hay ramas incompletas o vínculos inválidos; el cierre permanecerá bloqueado.`
            : pendienteAuditoria
              ? `Continuidad ${cadena}: hay una rama CANCELADA sin sucesora. Solo el servidor puede validar su exclusión auditada Q-72; no cuenta como cumplida y la cobertura restante exige confirmación.`
            : ramificada
              ? `Continuidad ramificada ${cadena}: todas las ramas requieren evidencias y verificación; el principal debe confirmar expresamente la cobertura (Q-71).`
              : `Continuidad ${cadena}: última actividad completada. El servidor verifica auditorías y evidencias (Q-70).`;
        });
        const c=card($('breaches'),`#${b.id} · ${b.titulo}`,[b.estado,b.descripcion,`Criterio: ${b.criterio}`, ...(exclusiones.length?[`Vínculos excluidos de esta brecha (Q-73, no son cumplimiento): ${exclusiones.map(x=>'#'+x.id).join(', ')}`]:[]),...reglas]);
        c.classList.add('breach-card');c.dataset.breachId=String(b.id);
        if(b.origenEvaluacionId!==null && b.origenEvaluacionId!==undefined){
          const source=elt('button',`Consultar diagnóstico de origen #${b.origenEvaluacionId}`,'secondary');source.type='button';
          source.addEventListener('click',()=>diagnosis(b.origenEvaluacionId));c.append(source);
        }
        breachCards.set(String(b.id),c);
        const overview=breachResults.items.find(item=>String(item.breach.id)===String(b.id));
        c.insertBefore(window.NexoBreachUI.createProgress(document,overview,openBreachActivity),c.firstChild.nextSibling);

        // SOL-34: los cierres previos permanecen auditados; la reapertura
        // necesita motivo, actividad COMPLETADA original y nueva corrección.
        if(b.estado==='EN_TRATAMIENTO')c.append(elt('p','En tratamiento: comprueba el historial antes de proponer otro cierre.','g1-muted'));
        const historialBtn=elt('button','Historial de cierres y reaperturas');historialBtn.type='button';
        historialBtn.addEventListener('click',async()=>{
          try{
            const entries=await api(`/proyectos/${id}/brechas/${b.id}/historial`);
            if(detailVersion!==version||selected?.id!==id)return;
            const existing=c.querySelector('.breach-audit-history');if(existing)existing.remove();
            const history=elt('div',null,'breach-audit-history');
            history.append(elt('h4','Historial del cierre'));
            if(!entries.length)history.append(elt('p','No hay eventos de cierre o reapertura registrados.','g1-muted'));
            for(const e of entries){
              const description=e.accion==='BRECHA_REABIERTA_SOL34'
                ? `Reapertura · ${new Date(e.creadoEn).toLocaleString('es-CO')} · ${e.detalle?.motivo||''} · nueva actividad #${e.detalle?.actividadCorrectivaId||'?'}; cierre previo conservado`
                : `Cierre · ${new Date(e.creadoEn).toLocaleString('es-CO')} · ${e.detalle?.justificacion||''}`;
              history.append(elt('p',description,'g1-muted'));
            }
            c.append(history);
          }catch(error){if(detailVersion===version)status('No se pudo consultar el historial: '+error.message,true);}
        });c.append(historialBtn);
        if(leader && p.estado==='ACTIVO' && b.estado==='CERRADA'){
          const previous=relacionadas.filter(t=>t.estado==='COMPLETADA');
          const reopenBtn=elt('button','Reabrir por corrección');reopenBtn.type='button';
          reopenBtn.disabled=!previous.length;
          reopenBtn.addEventListener('click',()=>{
            pendingBreachReopen={projectId:id,brechaId:b.id,version,previous};
            $('breachReopenForm').reset();
            $('breachReopenContext').textContent=`Brecha #${b.id} · ${b.titulo}`;
            const original=$('breachReopenOriginal');original.replaceChildren();
            for(const act of previous){const opt=elt('option',`#${act.id} · ${act.titulo}`);opt.value=String(act.id);original.append(opt);}
            const responsible=$('breachReopenResponsible');responsible.replaceChildren();
            for(const person of currentAssignees){
              const opt=elt('option',`${person.nombre} · ${person.tipo==='CLIENTE'?'Empresa':'Consultor'}`);
              opt.value=`${person.tipo}:${person.id}`;responsible.append(opt);
            }
            const updateReopenOrigin=()=>{
              const activity=previous.find(x=>String(x.id)===$('breachReopenOriginal').value);
              const extra=activity?.cobertura==='ADICIONAL';
              $('breachReopenAgreementRow').classList.toggle('g1-hide',!extra);
              $('breachReopenAgreement').required=extra;
              additionalOptions('breachReopenAgreement',extra?additionalAgreements.filter(x=>x.estado==='HABILITADO'):[]);
              for(const option of responsible.options)option.hidden=extra&&!option.value.startsWith('CONSULTORA:');
              if(extra&&responsible.value.startsWith('CLIENTE:'))responsible.value='';
            };
            $('breachReopenOriginal').onchange=updateReopenOrigin;
            updateReopenOrigin();
            $('breachReopenDialog').showModal();
          });c.append(reopenBtn);
        }
        if(assigned && p.estado==='ACTIVO' && !['CERRADA','PROPUESTA_CIERRE'].includes(b.estado)){
          const btn=elt('button','Proponer cierre');btn.type='button';btn.addEventListener('click',()=>{
            pendingClosure={projectId:id,brechaId:b.id,version};
            $('breachClosureContext').textContent=`Brecha #${b.id} · ${b.titulo}`;
            $('breachClosureForm').reset();$('breachClosureDialog').showModal();
          });c.appendChild(btn);
        }
      });
      updateBreaches();
      renderTasks();
      continuityChoices();
      diagnosticos.forEach(d=>{
        const c=card($('diagnoses'),`Diagnóstico #${d.id}`,[d.estado,`Resultado orientativo: ${d.puntajePromedio??'no calculado'}`]);
        const originCount=window.NexoDiagnosisUI.relatedBreaches(brechas,d.id).length;
        c.append(elt('p',`${originCount} brecha(s) registradas con este diagnóstico como origen explícito.`, 'g1-muted'));
        const b=elt('button','Ver respuestas');b.onclick=()=>diagnosis(d.id);c.appendChild(b);
        if(originCount){const originButton=elt('button',`Ver brechas originadas (${originCount})`,'secondary');originButton.type='button';
          originButton.addEventListener('click',()=>openDiagnosisBreaches(d.id));c.append(originButton);}
        if(user.rol==='EMPRESARIO' && d.estado==='BORRADOR'){
          const cont=elt('a','Continuar borrador');cont.href=`./evaluaciones.html?diagnostico=${encodeURIComponent(d.id)}`;
          c.appendChild(cont);
        }
      });
      $('feedback').className='g1-alert g1-hide';
      return true;
    }catch(e){if(version===detailVersion){
      $('breachWorkspace').setAttribute('aria-busy','false');
      $('breachSummary').textContent='No se pudieron cargar las brechas del expediente.';
      status(e.message,true);
    }return false;}
  }
  const taskUI=window.NexoActivityUI;
  const taskResponsibleName=t=>taskUI.responsibleName(t,selected,accounts);
  // Conserva los paneles abiertos cuando el usuario ajusta filtros u ordenación.
  const expandedTasks=new Map();
  let expandedProjectId=null;
  function renderTasks() {
    const root=$('tasks');
    if(String(expandedProjectId)!==String(selected?.id)){
      expandedTasks.clear();expandedProjectId=selected?.id??null;
    }
    root.replaceChildren();
    updateCaseOverview();
    const term=normalize($('taskSearch').value.trim());
    const state=$('taskFilter').value;
    const mine=$('myTasks').checked;
    const p=selected;
    const rows=tasksLoaded.filter(t=>{
      const matches=normalize(`${t.id} ${t.titulo} ${t.asignadoAId} ${taskResponsibleName(t)} ${(t.brechas||[]).map(b=>b.brechaId).join(' ')}`).includes(term);
      return matches&&(state==='TODAS'||t.estado===state)&&(!mine||String(t.asignadoAId)===String(user.id));
    });
    // Orden únicamente de presentación: no cambia prioridades, estados ni autorizaciones.
    const taskSort=$('taskSort').value;
    const stateOrder=['PENDIENTE','EN_PROGRESO','EN_REVISION','COMPLETADA','CANCELADA'];
    rows.sort((a,b)=>{
      if(taskSort==='FECHA'){
        const aDate=a.fechaObjetivo?String(a.fechaObjetivo).slice(0,10):'9999-12-31';
        const bDate=b.fechaObjetivo?String(b.fechaObjetivo).slice(0,10):'9999-12-31';
        if(aDate!==bDate)return aDate.localeCompare(bDate);
      }else if(taskSort==='ESTADO'){
        const delta=stateOrder.indexOf(a.estado)-stateOrder.indexOf(b.estado);
        if(delta)return delta;
      }else if(taskSort==='TITULO'){
        const delta=String(a.titulo||'').localeCompare(String(b.titulo||''),'es');
        if(delta)return delta;
      }
      return Number(a.id)-Number(b.id);
    });
    const counts=tasksLoaded.reduce((a,t)=>(a[t.estado]=(a[t.estado]||0)+1,a),{});
    $('tasksSummary').textContent=`${rows.length} de ${tasksLoaded.length} actividades · ${(counts.EN_REVISION||0)} en revisión · ${(counts.COMPLETADA||0)} completadas.`;
    if(!rows.length){root.append(elt('p',tasksLoaded.length?'Ninguna actividad coincide con los filtros.':'Este proyecto aún no tiene actividades.','empty-list'));return;}
    const assigned=consultor && p?.participaciones?.some(x=>x.usuarioId===user.id);
    for(const t of rows){
      const type=t.tipoResponsable==='CLIENTE'?'Empresa cliente':'Consultora';
      const name=taskResponsibleName(t);
      const date=t.fechaObjetivo?String(t.fechaObjetivo).slice(0,10):'Sin fecha definida';
      const lines=[`Estado: ${t.estado.replace(/_/g,' ')} · ${type}`,`Responsable: ${name}`,`Fecha objetivo: ${date}`,`Brechas: ${(t.brechas||[]).map(x=>'#'+x.brechaId+(x.excluidaEn?' (excluida Q-73)':'')).join(', ')||'No registradas'}`];
      if(t.actividadOrigenId)lines.push(`Continuación de actividad #${t.actividadOrigenId}; nueva revisión independiente (Q-67).`);
      const sucesoras=tasksLoaded.filter(x=>x.actividadOrigenId===t.id);
      if(sucesoras.length)lines.push(`Continuidad registrada en ${sucesoras.map(x=>'#'+x.id).join(', ')}. La anulación del antecedente es explícita (Q-68); el historial permanece.`);
      if(t.tipoResponsable==='CLIENTE') {
        const r=p.participaciones?.find(x=>x.usuarioId===t.consultorRevisorId);
        lines.push(`Consultor revisor designado: ${r?.usuario?.nombre || (t.consultorRevisorId ? '#'+t.consultorRevisorId : 'Pendiente de designación')}`);
      }
      if(t.descripcion)lines.push(`Descripción: ${t.descripcion}`);
      const {root:c,actions,verifyTools,managementTools}=taskUI.createCard(document,{
        task:t,type,name,date,lines,expanded:expandedTasks.get(String(t.id)),
        onToggle:(key,open)=>{
          const state=expandedTasks.get(String(t.id))||{};
          state[key]=open;expandedTasks.set(String(t.id),state);
        }
      });
      root.append(c);
      const showVerify=elt('button','Ver verificaciones operativas','secondary');showVerify.type='button';
      showVerify.addEventListener('click',async()=>{
        const old=c.querySelector('.verifications');if(old){old.remove();return;}
        const openedProject=p?.id,version=detailVersion;
        const panel=elt('div',null,'verifications');panel.setAttribute('aria-live','polite');panel.append(elt('p','Consultando verificaciones…','g1-muted'));verifyTools.append(panel);
        showVerify.disabled=true;
        try{
          const entries=await api(`/proyectos/${openedProject}/actividades/${t.id}/verificaciones`);
          if(detailVersion!==version||selected?.id!==openedProject||!panel.isConnected)return;
          panel.replaceChildren();
          if(!Array.isArray(entries))throw Error('Respuesta de verificaciones inválida.');
          if(!entries.length)panel.append(elt('p','Todavía no hay verificaciones operativas.','g1-muted'));
          for(const entry of entries){const box=elt('div',null,'verification-entry');box.append(elt('strong',entry.resultado),elt('p',`Método: ${entry.metodo}`,'g1-muted'),elt('p',entry.justificacion,'g1-muted'));if(entry.evidencia)box.append(elt('p',`Evidencia: ${entry.evidencia}`,'g1-muted'));panel.append(box);}
        }catch(e){if(panel.isConnected)panel.replaceChildren(elt('p',e.message,'inline-alert error'));}
        finally{showVerify.disabled=false;}
      });verifyTools.append(showVerify);
      const leader=consultor && p?.participaciones?.some(x=>x.usuarioId===user.id&&x.principal&&x.usuario?.activo!==false);
      if(leader && p.estado==='ACTIVO' && t.cobertura==='ADICIONAL' &&
          ['EN_PROGRESO','EN_REVISION'].includes(t.estado)) {
        const candidatas=sucesoras.filter(x=>x.cobertura==='ADICIONAL' && x.estado!=='CANCELADA' &&
          x.acuerdoAdicionalId!==t.acuerdoAdicionalId &&
          additionalAgreements.some(a=>a.id===x.acuerdoAdicionalId && a.estado==='HABILITADO'));
        if(candidatas.length){
          const btn=elt('button','Anular antecedente (Q-68)','secondary');btn.type='button';
          btn.addEventListener('click',()=>{
            pendingActivityAnnul={projectId:p.id,activityId:t.id,estadoEsperado:t.estado,version:detailVersion};
            $('activityAnnulContext').textContent=`Actividad #${t.id} · ${t.titulo} · Estado ${t.estado}. Se conservará su historial.`;
            const select=$('activityAnnulSuccessor');select.replaceChildren();
            const empty=elt('option','Selecciona la actividad sucesora');empty.value='';select.append(empty);
            for(const successor of candidatas){const option=elt('option',`#${successor.id} · ${successor.titulo}`);option.value=String(successor.id);select.append(option);}
            $('activityAnnulReason').value='';$('activityAnnulDialog').showModal();
          });managementTools.append(btn);
        }
      }
      // DEC-Q72: el principal registra explícitamente el retiro de una rama
      // terminal cuyo acuerdo fue cambiado formalmente. El servidor vuelve a
      // comprobar la aceptación externa y la topología dentro de la transacción.
      if(leader && p.estado==='ACTIVO' && t.cobertura==='ADICIONAL' &&
        t.actividadOrigenId && ['PENDIENTE','EN_PROGRESO','EN_REVISION'].includes(t.estado) &&
        additionalAgreements.some(a=>a.id===t.acuerdoAdicionalId&&['CANCELADO','MODIFICADO'].includes(a.estado))) {
        const vinculadas=(t.brechas||[]).filter(b=>!b.excluidaEn).map(b=>b.brechaId);
        const origen=tasksLoaded.find(x=>x.id===t.actividadOrigenId);
        const hermanas=tasksLoaded.filter(x=>x.id!==t.id&&x.actividadOrigenId===t.actividadOrigenId);
        const brechasValidas=brechas.filter(b=>vinculadas.length===1 && b.id===vinculadas[0] &&
          ['ABIERTA','EN_TRATAMIENTO'].includes(b.estado) && origen?.estado==='CANCELADA' &&
          hermanas.some(x=>(x.brechas||[]).some(y=>y.brechaId===b.id)));
        const habilitados=additionalAgreements.filter(a=>a.id!==t.acuerdoAdicionalId &&
          a.estado==='HABILITADO'&&a.referenciaAceptacion&&a.constanciaAceptacion);
        if(brechasValidas.length && habilitados.length && !tasksLoaded.some(x=>x.actividadOrigenId===t.id)) {
          const btn=elt('button','Retirar rama del alcance (Q-72)','secondary');btn.type='button';
          btn.addEventListener('click',()=>{
            pendingBranchRetire={projectId:p.id,activityId:t.id,estadoEsperado:t.estado,version:detailVersion};
            $('branchRetireContext').textContent=`Actividad #${t.id} · ${t.titulo}. La rama será cancelada pero no se considerará cumplida.`;
            const selB=$('branchRetireBreach');selB.replaceChildren();
            for(const b of brechasValidas){const option=elt('option',`#${b.id} · ${b.titulo}`);option.value=String(b.id);selB.append(option);}
            const selA=$('branchRetireAgreement');selA.replaceChildren();
            const blank=elt('option','Selecciona acuerdo nuevo aceptado');blank.value='';selA.append(blank);
            for(const a of habilitados){const option=elt('option',`#${a.id} · ${a.titulo}`);option.value=String(a.id);selA.append(option);}
            $('branchRetireReason').value='';$('branchRetireDialog').showModal();
          });managementTools.append(btn);
        }
      }
      // Q-73: una actividad compartida sigue vigente para otras brechas.
      // Solo el vínculo elegido se marca excluido, nunca el estado global.
      if(leader && p.estado==='ACTIVO' && t.cobertura==='ADICIONAL' &&
        ['PENDIENTE','EN_PROGRESO','EN_REVISION'].includes(t.estado) &&
        !tasksLoaded.some(x=>x.actividadOrigenId===t.id) &&
        additionalAgreements.some(a=>a.id===t.acuerdoAdicionalId&&['CANCELADO','MODIFICADO'].includes(a.estado))) {
        const vigentes=(t.brechas||[]).filter(x=>!x.excluidaEn);
        const brechasExcluibles=brechas.filter(b=>vigentes.length>1 && vigentes.some(x=>x.brechaId===b.id) &&
          ['ABIERTA','EN_TRATAMIENTO'].includes(b.estado));
        const habilitados=additionalAgreements.filter(a=>a.id!==t.acuerdoAdicionalId&&
          a.estado==='HABILITADO'&&a.referenciaAceptacion&&a.constanciaAceptacion);
        if(brechasExcluibles.length && habilitados.length){
          const btn=elt('button','Excluir vínculo con una brecha (Q-73)','secondary');btn.type='button';
          btn.addEventListener('click',()=>{
            pendingLinkExclusion={projectId:p.id,activityId:t.id,estadoEsperado:t.estado,version:detailVersion};
            $('linkExclusionContext').textContent=`Actividad #${t.id} · ${t.titulo}. Su estado y los vínculos con otras brechas NO se modifican.`;
            const selB=$('linkExclusionBreach');selB.replaceChildren();
            for(const b of brechasExcluibles){const op=elt('option',`#${b.id} · ${b.titulo}`);op.value=String(b.id);selB.append(op);}
            const selA=$('linkExclusionAgreement');selA.replaceChildren();
            const empty=elt('option','Selecciona el acuerdo aceptado');empty.value='';selA.append(empty);
            for(const a of habilitados){const op=elt('option',`#${a.id} · ${a.titulo}`);op.value=String(a.id);selA.append(op);}
            $('linkExclusionReason').value='';$('linkExclusionDialog').showModal();
          });managementTools.append(btn);
        }
      }
      // Q-74: una tarea COMPLETADA no puede excluirse retroactivamente.
      // La única intervención aquí es una constancia de alcance posterior.
      if(t.estado==='COMPLETADA' && t.cobertura==='ADICIONAL'){
        const log=elt('button','Ver constancias de alcance (Q-74)','secondary');log.type='button';
        log.addEventListener('click',async()=>{
          const old=c.querySelector('.completed-scope-log');if(old){old.remove();return;}
          const v=detailVersion,projectId=p.id;
          const panel=elt('div',null,'completed-scope-log');panel.setAttribute('aria-live','polite');
          panel.append(elt('p','Consultando constancias…','g1-muted'));verifyTools.append(panel);log.disabled=true;
          try{
            const list=await api(`/proyectos/${projectId}/actividades/${t.id}/constancias-alcance`);
            if(v!==detailVersion||selected?.id!==projectId||!panel.isConnected)return;
            if(!Array.isArray(list))throw Error('Respuesta de constancias inválida.');
            panel.replaceChildren();
            if(!list.length)panel.append(elt('p','No existen constancias posteriores.','g1-muted'));
            for(const ev of list){const box=elt('div',null,'verification-entry');
              box.append(elt('strong',`Brecha #${ev.detalle?.brechaId} · acuerdo #${ev.detalle?.acuerdoNuevoId}`),
                elt('p',ev.detalle?.impactoEvaluacion||'Sin información','g1-muted'));
              panel.append(box);
            }
          }catch(e){if(panel.isConnected)panel.replaceChildren(elt('p',e.message,'inline-alert error'));}
          finally{log.disabled=false;}
        });verifyTools.append(log);
        if(leader && p.estado==='ACTIVO' &&
          additionalAgreements.some(a=>a.id===t.acuerdoAdicionalId&&['CANCELADO','MODIFICADO'].includes(a.estado))){
          const vigentes=(t.brechas||[]).filter(x=>!x.excluidaEn);
          const referenciables=brechas.filter(b=>vigentes.length>1 && vigentes.some(v=>v.brechaId===b.id));
          const habilitados=additionalAgreements.filter(a=>a.id!==t.acuerdoAdicionalId &&
            a.estado==='HABILITADO' && a.referenciaAceptacion && a.constanciaAceptacion);
          if(referenciables.length && habilitados.length){
            const btn=elt('button','Documentar cambio posterior (Q-74)','secondary');btn.type='button';
            btn.addEventListener('click',()=>{
              pendingCompletedScope={projectId:p.id,activityId:t.id,version:detailVersion};
              $('completedScopeContext').textContent=`Actividad #${t.id} · ${t.titulo}. El cumplimiento histórico se conservará íntegramente.`;
              const selB=$('completedScopeBreach');selB.replaceChildren();
              for(const b of referenciables){const opt=elt('option',`#${b.id} · ${b.titulo}`);opt.value=String(b.id);selB.append(opt);}
              const selA=$('completedScopeAgreement');selA.replaceChildren();
              const blank=elt('option','Selecciona acuerdo posterior');blank.value='';selA.append(blank);
              for(const a of habilitados){const opt=elt('option',`#${a.id} · ${a.titulo}`);opt.value=String(a.id);selA.append(opt);}
              $('completedScopeImpact').value='';$('completedScopeDialog').showModal();
            });managementTools.append(btn);
          }
        }
      }
      if(leader && p.estado==='ACTIVO' && t.tipoResponsable==='CLIENTE' && !['COMPLETADA','CANCELADA'].includes(t.estado)) {
        const panel=elt('form',null,'g1-form');
        const label=elt('label','Designar consultor encargado de revisar el aporte empresarial');
        const select=elt('select');select.required=true;
        const empty=elt('option','Selecciona un colaborador activo');empty.value='';select.append(empty);
        for(const c of p.participaciones.filter(x=>!x.principal && x.usuario?.activo!==false && x.usuario?.rol==='EVALUADOR')) {
          const option=elt('option',c.usuario.nombre||`Consultor #${c.usuarioId}`);option.value=c.usuarioId;select.append(option);
        }
        label.append(select);
        const reasonLabel=elt('label','Motivo de la designación o cambio');
        const reason=elt('textarea');reason.required=true;reason.maxLength=2000;reason.rows=2;reasonLabel.append(reason);
        const submit=elt('button',t.consultorRevisorId?'Cambiar revisor':'Designar revisor');submit.type='submit';
        panel.append(label,reasonLabel,submit);
        panel.addEventListener('submit',evt=>{
          evt.preventDefault();if(!panel.reportValidity())return;
          perform(()=>api(`/proyectos/${p.id}/actividades/${t.id}/revisor`,{
            method:'PATCH',body:JSON.stringify({consultorId:Number(select.value),
              esperadoConsultorId:t.consultorRevisorId ?? null,motivo:reason.value.trim()})
          }),submit);
        });
        managementTools.append(panel);
      }
      if(leader && p.estado==='ACTIVO' && !['COMPLETADA','CANCELADA'].includes(t.estado)) {
        const dateButton=elt('button','Cambiar fecha objetivo','secondary');dateButton.type='button';
        dateButton.addEventListener('click',()=>beginDateChange(t));managementTools.append(dateButton);
      }
      if(leader && p.estado==='ACTIVO' && t.tipoResponsable==='CONSULTORA' && !['COMPLETADA','CANCELADA'].includes(t.estado)){
        const eligible=p.participaciones.some(x=>x.usuarioId!==t.asignadoAId&&x.usuario?.activo!==false);
        const reassign=elt('button','Reasignar responsable','secondary');reassign.type='button';reassign.disabled=!eligible;
        if(!eligible)reassign.title='Se necesita otro consultor activo en el proyecto';
        reassign.addEventListener('click',()=>beginTaskReassignment(t));managementTools.append(reassign);
      }
      // Atajo de presentación hacia el registro G2 existente (GET/POST vigentes).
      // El servidor conserva el control de quién puede verificar esta actividad.
      if (assigned && p.estado==='ACTIVO' && t.estado==='EN_REVISION') {
        const gotoVerification=elt('button','Registrar verificación operativa','secondary');
        gotoVerification.type='button';
        gotoVerification.addEventListener('click',()=>{
          if(String(selected?.id)!==String(p.id))return;
          const form=$('g2Verificacion'), select=form.elements.actividadId;
          if(form.classList.contains('g1-hide') || !Array.from(select.options).some(o=>String(o.value)===String(t.id)))return;
          $('g2Operations').open=true;
          select.value=String(t.id);
          select.dispatchEvent(new Event('change',{bubbles:true}));
          const heading=form.querySelector('h3');
          heading.tabIndex=-1;
          heading.focus({preventScroll:true});
          heading.scrollIntoView({block:'center',behavior:'instant'});
        });
        actions.append(gotoVerification);
      }
      const canUpdate=p?.estado==='ACTIVO'&&(assigned||(user.rol==='EMPRESARIO'&&t.asignadoAId===user.id));
      if(!canUpdate||['COMPLETADA','CANCELADA'].includes(t.estado)){
        actions.append(elt('p', ['COMPLETADA','CANCELADA'].includes(t.estado)?'Actividad finalizada o cancelada. Consulta el historial para ver los detalles.':'Consulta el estado y los permisos del proyecto para conocer las acciones disponibles.','activity-action-hint'));
        if(managementTools.children.length===1)managementTools.remove();
        continue;
      }
      const transitions={PENDIENTE:['EN_PROGRESO'],EN_PROGRESO:['EN_REVISION'],EN_REVISION:assigned?['EN_PROGRESO','COMPLETADA']:[]};
      if(t.estado==='EN_REVISION' && canUpdate)actions.append(elt('p','Para completar, se requieren los entregables documentales aceptados y una verificación operativa favorable. La API comprobará ambas condiciones.','activity-action-hint'));
      for(const next of transitions[t.estado]||[]){
        const label={EN_PROGRESO:t.estado==='EN_REVISION'?'Devolver a progreso':'Iniciar trabajo',EN_REVISION:'Enviar a revisión',COMPLETADA:'Completar actividad'}[next]||next;
        const btn=elt('button',label,next==='EN_PROGRESO'&&t.estado==='EN_REVISION'?'secondary':'');btn.type='button';
        btn.addEventListener('click',()=>perform(()=>api(`/proyectos/${p.id}/actividades/${t.id}`,{method:'PATCH',body:JSON.stringify({estado:next})}),btn));actions.append(btn);
      }
      if(managementTools.children.length===1)managementTools.remove();
    }
  }
  for(const [id,event] of [['taskSearch','input'],['taskFilter','change'],['myTasks','change'],['taskSort','change']])$(id).addEventListener(event,renderTasks);
  $('clearTaskFilters').addEventListener('click',()=>{
    $('taskSearch').value='';$('taskFilter').value='TODAS';$('myTasks').checked=false;
    $('taskSort').value='FECHA';renderTasks();$('taskSearch').focus();
  });
  $('dateChangeCancel').addEventListener('click',()=>$('dateChangeDialog').close());
  $('dateChangeDialog').addEventListener('close',()=>{pendingDateChange=null;});
  $('dateChangeForm').addEventListener('submit',async event=>{
    event.preventDefault();const pending=pendingDateChange;
    if(!pending||selected?.id!==pending.projectId||detailVersion!==pending.version){
      status('El expediente cambió. Abre de nuevo la actividad.',true);$('dateChangeDialog').close();return;
    }
    if(!event.currentTarget.reportValidity())return;
    const newDate=$('dateChangeNew').value,reason=$('dateChangeReason').value.trim();
    if(newDate===pending.fechaAnteriorEsperada){status('Debes elegir una fecha diferente.',true);return;}
    if(!reason){$('dateChangeReason').focus();return;}
    const submit=event.currentTarget.querySelector('[type="submit"]');
    $('dateChangeDialog').close();
    await perform(()=>api(`/proyectos/${pending.projectId}/actividades/${pending.activityId}/fecha-objetivo`,{
      method:'PATCH',body:JSON.stringify({fechaAnteriorEsperada:pending.fechaAnteriorEsperada,fechaObjetivo:newDate,justificacion:reason})
    }),submit);
  });
  $('teamAddCancel').addEventListener('click',()=>$('teamAddDialog').close());
  $('teamAddDialog').addEventListener('close',()=>{pendingTeamAdd=null;});
  $('teamAddForm').addEventListener('submit',async e=>{
    e.preventDefault();const pending=pendingTeamAdd;
    if(!pending || selected?.id!==pending.projectId || detailVersion!==pending.version){
      status('El expediente cambió. Selecciona de nuevo el proyecto.',true);$('teamAddDialog').close();return;
    }
    if(!e.currentTarget.reportValidity())return;
    const consultorId=Number($('teamAddUser').value);
    const submit=e.currentTarget.querySelector('[type="submit"]');
    $('teamAddDialog').close();
    await perform(()=>api(`/proyectos/${pending.projectId}/consultores`,{
      method:'POST',body:JSON.stringify({usuarioId:consultorId,principal:false}),
    }),submit);
  });
  $('teamRemovalCancel').addEventListener('click',()=>$('teamRemovalDialog').close());
  $('teamRemovalDialog').addEventListener('close',()=>{pendingMemberRemoval=null;});
  $('teamRemovalForm').addEventListener('submit',async e=>{
    e.preventDefault();const pending=pendingMemberRemoval;
    if(!pending||selected?.id!==pending.projectId||detailVersion!==pending.version){status('El expediente cambió. Actualiza y vuelve a intentarlo.',true);$('teamRemovalDialog').close();return;}
    const submit=e.currentTarget.querySelector('[type="submit"]');
    $('teamRemovalDialog').close();
    await perform(()=>api(`/proyectos/${pending.projectId}/consultores/${pending.usuarioId}`,{method:'DELETE'}),submit);
  });
  $('activityAnnulCancel').addEventListener('click',()=>$('activityAnnulDialog').close());
  $('activityAnnulDialog').addEventListener('close',()=>{pendingActivityAnnul=null;});
  $('activityAnnulForm').addEventListener('submit',async e=>{
    e.preventDefault();const pending=pendingActivityAnnul;
    if(!pending||selected?.id!==pending.projectId||detailVersion!==pending.version){
      status('El expediente cambió. Selecciona de nuevo el antecedente.',true);$('activityAnnulDialog').close();return;
    }
    if(!e.currentTarget.reportValidity())return;
    const justificacion=$('activityAnnulReason').value.trim();
    if(justificacion.length<10){$('activityAnnulReason').focus();return;}
    const payload={actividadSucesoraId:Number($('activityAnnulSuccessor').value),
      estadoEsperado:pending.estadoEsperado,justificacion};
    const submit=e.currentTarget.querySelector('[type="submit"]');
    $('activityAnnulDialog').close();
    await perform(()=>api(`/proyectos/${pending.projectId}/actividades/${pending.activityId}/anular`,{
      method:'POST',body:JSON.stringify(payload)}),submit);
  });
  $('branchRetireCancel').addEventListener('click',()=>$('branchRetireDialog').close());
  $('branchRetireDialog').addEventListener('close',()=>{pendingBranchRetire=null;});
  $('branchRetireForm').addEventListener('submit',async e=>{
    e.preventDefault();const pending=pendingBranchRetire;
    if(!pending||selected?.id!==pending.projectId||detailVersion!==pending.version){
      status('El expediente cambió. Selecciona la rama de nuevo.',true);$('branchRetireDialog').close();return;
    }
    if(!e.currentTarget.reportValidity())return;
    const payload={brechaId:Number($('branchRetireBreach').value),
      acuerdoNuevoId:Number($('branchRetireAgreement').value),estadoEsperado:pending.estadoEsperado,
      justificacion:$('branchRetireReason').value.trim()};
    if(payload.justificacion.length<10){$('branchRetireReason').focus();return;}
    const submit=e.currentTarget.querySelector('[type="submit"]');
    $('branchRetireDialog').close();
    await perform(()=>api(`/proyectos/${pending.projectId}/actividades/${pending.activityId}/retirar-rama`,{
      method:'POST',body:JSON.stringify(payload)}),submit);
  });
  $('linkExclusionCancel').addEventListener('click',()=>$('linkExclusionDialog').close());
  $('linkExclusionDialog').addEventListener('close',()=>{pendingLinkExclusion=null;});
  $('linkExclusionForm').addEventListener('submit',async e=>{
    e.preventDefault();const pending=pendingLinkExclusion;
    if(!pending||selected?.id!==pending.projectId||detailVersion!==pending.version){
      status('El expediente cambió. Vuelve a seleccionar el vínculo.',true);$('linkExclusionDialog').close();return;
    }
    if(!e.currentTarget.reportValidity())return;
    const body={brechaId:Number($('linkExclusionBreach').value),
      acuerdoNuevoId:Number($('linkExclusionAgreement').value),estadoEsperado:pending.estadoEsperado,
      justificacion:$('linkExclusionReason').value.trim()};
    if(body.justificacion.length<10){$('linkExclusionReason').focus();return;}
    const submit=e.currentTarget.querySelector('[type="submit"]');
    $('linkExclusionDialog').close();
    await perform(()=>api(`/proyectos/${pending.projectId}/actividades/${pending.activityId}/excluir-brecha`,{
      method:'POST',body:JSON.stringify(body)}),submit);
  });
  $('completedScopeCancel').addEventListener('click',()=>$('completedScopeDialog').close());
  $('completedScopeDialog').addEventListener('close',()=>{pendingCompletedScope=null;});
  $('completedScopeForm').addEventListener('submit',async e=>{
    e.preventDefault();const pending=pendingCompletedScope;
    if(!pending||selected?.id!==pending.projectId||detailVersion!==pending.version){
      status('El expediente cambió. Vuelve a abrir el formulario.',true);$('completedScopeDialog').close();return;
    }
    if(!e.currentTarget.reportValidity())return;
    const body={brechaId:Number($('completedScopeBreach').value),
      acuerdoNuevoId:Number($('completedScopeAgreement').value),estadoEsperado:'COMPLETADA',
      impactoEvaluacion:$('completedScopeImpact').value.trim()};
    if(body.impactoEvaluacion.length<10){$('completedScopeImpact').focus();return;}
    const submit=e.currentTarget.querySelector('[type="submit"]');
    $('completedScopeDialog').close();
    await perform(()=>api(`/proyectos/${pending.projectId}/actividades/${pending.activityId}/constancias-alcance`,{
      method:'POST',body:JSON.stringify(body)}),submit);
  });
  $('activityReassignCancel').addEventListener('click',()=>$('activityReassignDialog').close());
  $('activityReassignDialog').addEventListener('close',()=>{pendingTaskReassignment=null;});
  $('activityReassignForm').addEventListener('submit',async e=>{
    e.preventDefault();const pending=pendingTaskReassignment;
    if(!pending||selected?.id!==pending.projectId||detailVersion!==pending.version){status('El expediente cambió. Vuelve a seleccionar la actividad.',true);$('activityReassignDialog').close();return;}
    if(!e.currentTarget.reportValidity())return;
    const body={usuarioId:Number($('activityReassignUser').value),esperadoResponsableId:pending.esperadoResponsableId,
      justificacion:$('activityReassignReason').value.trim()};
    if(body.justificacion.length<10){$('activityReassignReason').focus();return;}
    const submit=e.currentTarget.querySelector('[type="submit"]');
    $('activityReassignDialog').close();
    await perform(()=>api(`/proyectos/${pending.projectId}/actividades/${pending.actividadId}/responsable`,{method:'PATCH',body:JSON.stringify(body)}),submit);
  });
  $('breachReopenCancel').addEventListener('click',()=>$('breachReopenDialog').close());
  $('breachReopenDialog').addEventListener('close',()=>{pendingBreachReopen=null;});
  $('breachReopenForm').addEventListener('submit',async event=>{
    event.preventDefault();const choice=pendingBreachReopen;
    if(!choice||selected?.id!==choice.projectId||detailVersion!==choice.version){
      status('El expediente cambió. Selecciona nuevamente la brecha.',true);$('breachReopenDialog').close();return;
    }
    if(!event.currentTarget.reportValidity())return;
    const [tipoResponsable,rawId]=$('breachReopenResponsible').value.split(':');
    const body={actividadAnteriorId:Number($('breachReopenOriginal').value),
      justificacion:$('breachReopenReason').value.trim(),
      correccionRequerida:$('breachReopenCorrection').value.trim(),
      tituloActividad:$('breachReopenTitleActivity').value.trim(),
      tipoResponsable,asignadoAId:Number(rawId),cobertura:pendingBreachReopen.previous.find(x=>String(x.id)===$('breachReopenOriginal').value)?.cobertura==='ADICIONAL'?'ADICIONAL':'BASE'};
    if(body.cobertura==='ADICIONAL')body.acuerdoAdicionalId=Number($('breachReopenAgreement').value);
    if(body.justificacion.length<10||body.correccionRequerida.length<10)return;
    const submit=event.currentTarget.querySelector('[type="submit"]');
    $('breachReopenDialog').close();
    await perform(()=>api(`/proyectos/${choice.projectId}/brechas/${choice.brechaId}/reabrir`,{
      method:'POST',body:JSON.stringify(body)}),submit);
  });
  $('breachClosureCancel').addEventListener('click',()=>$('breachClosureDialog').close());
  $('breachClosureDialog').addEventListener('close',()=>{pendingClosure=null;});
  $('breachClosureForm').addEventListener('submit',async event=>{
    event.preventDefault();const choice=pendingClosure;
    if(!choice||selected?.id!==choice.projectId||detailVersion!==choice.version){status('El proyecto cambió. Abre de nuevo la propuesta.',true);$('breachClosureDialog').close();return;}
    const reason=$('breachClosureReason').value.trim();if(!reason){$('breachClosureReason').focus();return;}
    const submit=event.currentTarget.querySelector('[type="submit"]');
    if(submit.disabled)return;
    $('breachClosureDialog').close();
    await perform(()=>api(`/proyectos/${choice.projectId}/brechas/${choice.brechaId}/proponer-cierre`,{method:'POST',body:JSON.stringify({justificacion:reason})}),submit);
  });
  document.addEventListener('iso:g2:actualizado',event=>{
    if(selected?.id===event.detail.proyectoId)detail(selected.id);
  });
  function openDiagnosisBreaches(diagnosisId) {
    if(!selected || !$('breachOriginFilter').querySelector(`option[value="${String(diagnosisId)}"]`))return;
    $('breachSearch').value='';$('breachFilter').value='TODAS';$('breachFollowup').checked=false;
    $('breachOriginFilter').value=String(diagnosisId);updateBreaches();
    $('brechas').scrollIntoView({block:'start',behavior:'instant'});
    $('breachOriginFilter').focus({preventScroll:true});
  }
  function renderDiagnosisAnswers() {
    const d=selectedDiagnosis;if(!d)return;
    const answers=Array.isArray(d.respuestas)?d.respuestas:[];
    const ui=window.NexoDiagnosisUI,metrics=ui.summarize(answers);
    const wrap=$('diagnosisMetrics');wrap.replaceChildren();
    for(const [label,value] of [['Respuestas existentes',metrics.total],['Con nivel declarado',metrics.declared],
      ['Con observación',metrics.observed],['Sin observación',metrics.withoutObservation]]){
      const box=elt('div',null,'diagnosis-metric');box.append(elt('strong',value),elt('span',label));wrap.append(box);
    }
    const root=$('diagnosisAnswers');root.replaceChildren();
    const canReview=consultor&&selected?.estado==='ACTIVO'&&['ENVIADA','EN_REVISION'].includes(d.estado) &&
      (selected.participaciones||[]).some(p=>String(p.usuarioId)===String(user.id)&&p.activo!==false);
    let visible=0;
    for(const answer of answers){
      if(!ui.matches(answer,$('diagnosisSearch').value,$('diagnosisFilter').value))continue;
      visible++;
      const c=card(root,answer.pregunta?.texto||`Pregunta #${answer.preguntaId}`,[
        `Nivel autodeclarado: ${answer.valor??'Sin nivel declarado'}`,
        `Observación registrada del consultor: ${answer.comentarioEvaluador||'Sin observación'}`,
        `Última modificación: ${answer.actualizadaPor?.nombre||'anterior a Q-59 (autor no verificable)'}`]);
      c.classList.add('diagnosis-answer');c.dataset.questionId=String(answer.preguntaId);
      if(canReview){
        const label=elt('label','Nueva observación profesional (opcional)');
        const box=elt('textarea');box.maxLength=3000;box.rows=2;box.dataset.preguntaId=String(answer.preguntaId);
        box.placeholder='Describe una observación sustentada, sin concluir cumplimiento automático';
        box.value=diagnosisDraftComments.get(String(answer.preguntaId))||'';
        label.append(box);c.append(label);
      }
    }
    if(!visible)root.append(elt('p','No hay respuestas que coincidan con estos filtros.','g1-muted'));
    $('diagnosisSummary').textContent=`${visible} de ${answers.length} respuestas visibles. Las observaciones no certifican el cumplimiento.`;
    $('saveReview').classList.toggle('g1-hide',!canReview);
  }
  function closeDiagnosis(){
    selectedDiagnosis=null;diagnosisDraftComments.clear();diagnosisRequestId++;$('diagnosisDetail').classList.add('g1-hide');
    $('diagnosisAnswers').replaceChildren();$('diagnosisRelated').replaceChildren();
    $('diagnosisDetail').setAttribute('aria-busy','false');
  }
  $('diagnosisClose').addEventListener('click',closeDiagnosis);
  for(const [id,event] of [['diagnosisSearch','input'],['diagnosisFilter','change']])$(id).addEventListener(event,renderDiagnosisAnswers);
  $('clearDiagnosisFilters').addEventListener('click',()=>{
    $('diagnosisSearch').value='';$('diagnosisFilter').value='TODAS';renderDiagnosisAnswers();$('diagnosisSearch').focus();
  });
  $('diagnosisAnswers').addEventListener('input',event=>{
    const field=event.target.closest('textarea[data-pregunta-id]');if(!field)return;
    diagnosisDraftComments.set(field.dataset.preguntaId,field.value);
  });
  async function diagnosis(id) {
    if(!selected)return;
    const currentId=selected.id,version=detailVersion,requestId=++diagnosisRequestId;
    $('diagnosisDetail').setAttribute('aria-busy','true');
    try {
      const d=await api(`/proyectos/${currentId}/diagnosticos/${id}`);
      if(requestId!==diagnosisRequestId||version!==detailVersion || String(selected?.id)!==String(currentId))return false;
      selectedDiagnosis=d;diagnosisDraftComments.clear();
      $('diagnosisSearch').value='';$('diagnosisFilter').value='TODAS';
      $('diagnosisDetail').classList.remove('g1-hide');$('diagnosisTitle').textContent=`Diagnóstico #${id} · ${d.estado}`;
      const root=$('diagnosisRelated');root.replaceChildren();
      const related=window.NexoDiagnosisUI.relatedBreaches(breachesLoaded,id);
      root.append(elt('strong',`${related.length} brecha(s) con origen en este diagnóstico`));
      root.append(elt('p','Esta relación fue registrada explícitamente por un consultor. No vincula preguntas individuales ni determina incumplimiento.','g1-muted'));
      if(related.length){const b=elt('button','Consultar brechas originadas','secondary');b.type='button';
        b.addEventListener('click',()=>openDiagnosisBreaches(id));root.append(b);}
      const allowed=consultor && selected.estado==='ACTIVO' && (selected.participaciones||[]).some(p=>
        String(p.usuarioId)===String(user.id)&&p.activo!==false);
      if(allowed){const b=elt('button','Registrar brecha con este origen','secondary');b.type='button';
        b.addEventListener('click',()=>{
          if(!selected || String(selected.id)!==String(currentId))return;
          $('breachOriginSelect').value=String(id);
          if(!caseWorkspace.open('breach',{focus:false}))return;
          const heading=$('brechaForm').querySelector('h3');heading.tabIndex=-1;heading.focus({preventScroll:true});
          $('brechaForm').scrollIntoView({block:'center',behavior:'instant'});
        });root.append(b);}
      renderDiagnosisAnswers();
      $('diagnosisTitle').focus({preventScroll:true});
      $('diagnosisDetail').scrollIntoView({block:'start',behavior:'instant'});
      return true;
    }catch(e){if(requestId===diagnosisRequestId&&version===detailVersion)status(e.message,true)}
    finally{if(requestId===diagnosisRequestId&&version===detailVersion)$('diagnosisDetail').setAttribute('aria-busy','false');}
    return false;
  }
  $('saveReview').addEventListener('click',()=>{
    if(!selected || !selectedDiagnosis)return;
    const questionIds=new Set((selectedDiagnosis.respuestas||[]).map(a=>String(a.preguntaId)));
    const comentarios=Array.from(diagnosisDraftComments.entries()).filter(([id,comment])=>
      questionIds.has(id)&&comment.trim()).map(([id,comment])=>({preguntaId:Number(id),comentario:comment.trim()}));
    if(!comentarios.length){status('Escribe al menos una observación.',true);return;}
    const projectId=selected.id,diagnosisId=selectedDiagnosis.id;
    perform(()=>api(`/proyectos/${projectId}/diagnosticos/${diagnosisId}/comentarios`,
      {method:'POST',body:JSON.stringify({comentarios})}),$('saveReview'));
  });
  async function perform(fn, control=null, sourceForm=null){
    const finish=window.NexoOperationUI.begin(sourceForm,control,'Guardando…');
    if(!finish)return;
    if(sourceForm)clearFormFeedback(sourceForm);
    const openingProjectId=selected?.id,openingVersion=detailVersion;
    // Los avisos de una operación anterior no se deben mostrar en otro expediente.
    const sameScope=()=> !openingProjectId || String(selected?.id)===String(openingProjectId);
    try {
      await fn();
      if(!sameScope() || (openingProjectId && detailVersion!==openingVersion))return;
      const currentId=selected?.id;
      const updated=await projects();
      if(!sameScope())return;
      let detailUpdated=true;
      if(updated && currentId && projectsLoaded.some(p=>String(p.id)===String(currentId)))detailUpdated=await detail(currentId);
      if(!sameScope())return;
      if(updated && detailUpdated)status('Operación registrada y datos actualizados.');
      else {
        const message='Operación registrada, pero no se pudo actualizar toda la vista. Pulsa «Actualizar».';
        status(message,true);formFeedback(sourceForm,message,true);
      }
    }catch(e){
      if(!sameScope() || (openingProjectId && detailVersion!==openingVersion))return;
      status(e.message,true);formFeedback(sourceForm,e.message,true);
    } finally {finish();}
  }
  function runForm(e,job){
    e.preventDefault();const form=e.currentTarget;
    if(window.NexoOperationUI.isBusy(form))return;
    clearFormFeedback(form);
    if(!form.reportValidity()){
      formFeedback(form,'Revisa los campos obligatorios o el formato indicado antes de continuar.',true,false);
      return;
    }
    const submit=form.querySelector('[type=submit],button:not([type])');
    perform(job,submit,form);
  }
  $('reload').addEventListener('click',projects);
  // DEC-REG239-A: ADMIN vincula al representante. El servidor consulta el NIT y
  // únicamente admite manuales separados cuando ADMIN indica origen y sustento.
  function alternarDatosProvisionales() {
    const activos=$('usarDatosProvisionales').checked;
    $('camposProvisionales').classList.toggle('g1-hide',!activos);
    for(const control of $('camposProvisionales').querySelectorAll('input,textarea')) {
      control.disabled=!activos;
      control.required=activos;
    }
  }
  $('usarDatosProvisionales').addEventListener('change',alternarDatosProvisionales);
  alternarDatosProvisionales();
  $('empresaFormG1').addEventListener('submit',e=>{const f=e.currentTarget;runForm(e,async()=>{
    const vinculo=window.NexoRegistroUI.vinculacion({
      usuarioId:field(f,'usuarioId'),nit:field(f,'nit'),
      constanciaRepresentacion:field(f,'constanciaRepresentacion'),
      usarProvisional:$('usarDatosProvisionales').checked,
      nombreProvisional:field(f,'nombreProvisional'),sectorProvisional:field(f,'sectorProvisional'),
      tamanoProvisional:field(f,'tamanoProvisional'),referenciaExterna:field(f,'referenciaExterna'),
    });
    await api(vinculo.path,{method:'POST',body:JSON.stringify(vinculo.body)});
    f.reset();alternarDatosProvisionales();await adminOptions();
  })});
  $('projectForm').addEventListener('submit',e=>{const f=e.currentTarget;runForm(e,async()=>{
    const data=window.NexoRegistroUI.nuevoProyecto({
      servicioNormativo:field(f,'servicioNormativo'),
      empresaId:field(f,'empresaId'),consultorPrincipalId:field(f,'consultorPrincipalId'),
      nombre:field(f,'nombre'),referenciaContrato:field(f,'referenciaContrato'),
      alcanceContractual:field(f,'alcanceContractual'),alcanceSGSIPropuesto:field(f,'alcanceSGSIPropuesto'),
    });
    await api('/proyectos',{method:'POST',body:JSON.stringify(data)});f.reset();
  })});
  $('assignForm').addEventListener('submit',e=>{const f=e.currentTarget;runForm(e,async()=>{
    await api(`/proyectos/${field(f,'proyectoId')}/consultores`,{method:'POST',body:JSON.stringify({usuarioId:Number(field(f,'usuarioId')),principal:f.elements.principal.checked})});
  })});
  $('brechaForm').addEventListener('submit',e=>{const f=e.currentTarget;if(!selected){e.preventDefault();return;}runForm(e,async()=>{
    await api(`/proyectos/${selected.id}/brechas`,{method:'POST',body:JSON.stringify({titulo:field(f,'titulo'),descripcion:field(f,'descripcion'),criterio:field(f,'criterio'),
      origenEvaluacionId:field(f,'origenEvaluacionId')?Number(field(f,'origenEvaluacionId')):null})});f.reset();
  })});
  $('taskForm').addEventListener('submit',e=>{const f=e.currentTarget;if(!selected){e.preventDefault();return;}runForm(e,async()=>{
    const brechaIds=Array.from(f.elements.brechaIds.selectedOptions).map(o=>Number(o.value));
    const cobertura=field(f,'cobertura');
    const acuerdoAdicionalId=cobertura==='ADICIONAL'?Number(field(f,'acuerdoAdicionalId')):null;
    const actividadOrigenId=cobertura==='ADICIONAL'&&field(f,'actividadOrigenId')?Number(field(f,'actividadOrigenId')):null;
    await api(`/proyectos/${selected.id}/actividades`,{method:'POST',body:JSON.stringify({titulo:field(f,'titulo'),brechaIds,tipoResponsable:field(f,'tipoResponsable'),asignadoAId:Number(field(f,'asignadoAId')),fechaObjetivo:field(f,'fechaObjetivo'),cobertura,acuerdoAdicionalId,actividadOrigenId})});f.reset();coverageChoices();
  })});
  $('additionalProposalForm').addEventListener('submit',e=>{const f=e.currentTarget;if(!selected){e.preventDefault();return;}runForm(e,async()=>{
    await api(`/proyectos/${selected.id}/acuerdos-adicionales`,{method:'POST',body:JSON.stringify({titulo:field(f,'titulo'),descripcion:field(f,'descripcion')})});f.reset();
  })});
  $('additionalConfirmForm').addEventListener('submit',e=>{const f=e.currentTarget;if(!selected){e.preventDefault();return;}runForm(e,async()=>{
    await api(`/proyectos/${selected.id}/acuerdos-adicionales/${field(f,'acuerdoId')}/confirmar`,{method:'POST',body:JSON.stringify({referenciaAcuerdo:field(f,'referenciaAcuerdo'),constanciaValidacion:field(f,'constanciaValidacion')})});f.reset();
  })});
  $('additionalAcceptanceForm').addEventListener('submit',e=>{const f=e.currentTarget;if(!selected){e.preventDefault();return;}runForm(e,async()=>{
    await api(`/proyectos/${selected.id}/acuerdos-adicionales/${field(f,'acuerdoId')}/aceptacion`,{method:'POST',body:JSON.stringify({referenciaAceptacion:field(f,'referenciaAceptacion'),constanciaAceptacion:field(f,'constanciaAceptacion')})});f.reset();
  })});
  $('additionalChangeForm').addEventListener('submit',e=>{const f=e.currentTarget;if(!selected){e.preventDefault();return;}runForm(e,async()=>{
    const id=Number(field(f,'acuerdoId'));
    const acuerdo=additionalAgreements.find(a=>a.id===id);
    if(!acuerdo||!['HABILITADO','CONFIRMADO'].includes(acuerdo.estado))throw Error('Acuerdo ya no habilitado para cambios. Actualiza el expediente.');
    await api(`/proyectos/${selected.id}/acuerdos-adicionales/${id}/cambio`,{method:'POST',body:JSON.stringify({
      tipo:field(f,'tipo'),estadoEsperado:acuerdo.estado,referenciaCambio:field(f,'referenciaCambio'),
      constanciaCambio:field(f,'constanciaCambio'),justificacionCambio:field(f,'justificacionCambio')
    })});f.reset();
  })});
  $('planWithdrawForm').addEventListener('submit',e=>{const f=e.currentTarget;if(!selected){e.preventDefault();return;}runForm(e,async()=>{
    if(!planPending)throw Error('No hay propuesta pendiente.');
    await api(`/proyectos/${selected.id}/planes/${planPending.id}/retirar`,{method:'POST',body:JSON.stringify({justificacion:field(f,'justificacion')})});f.reset();
  })});
  $('planProposalForm').addEventListener('submit',e=>{const f=e.currentTarget;if(!selected){e.preventDefault();return;}runForm(e,async()=>{
    await api(`/proyectos/${selected.id}/planes`,{method:'POST',body:JSON.stringify({contenido:field(f,'contenido'),referenciaPresentacion:field(f,'referenciaPresentacion')})});f.reset();
  })});
  $('planAcceptanceForm').addEventListener('submit',e=>{const f=e.currentTarget;if(!selected){e.preventDefault();return;}runForm(e,async()=>{
    if(!planPending)throw Error('No hay propuesta pendiente.');
    await api(`/proyectos/${selected.id}/planes/${planPending.id}/aceptacion-externa`,{method:'POST',body:JSON.stringify({referenciaAceptacion:field(f,'referenciaAceptacion'),constanciaAceptacion:field(f,'constanciaAceptacion')})});f.reset();
  })});
  $('planRegularizationForm').addEventListener('submit',e=>{const f=e.currentTarget;if(!selected){e.preventDefault();return;}runForm(e,async()=>{
    const data=new FormData(f);
    const ids=[...f.querySelectorAll('input[name="actividadHistorica"]:checked')].map(x=>Number(x.value));
    if(!ids.length)throw Error('Debe seleccionar al menos una actividad del corte histórico Q-75.');
    const local=field(f,'fechaAceptacionHistorica');const moment=new Date(local);
    if(!Number.isFinite(moment.getTime())||moment>new Date())throw Error('Ingrese una fecha de aceptación real y anterior al registro actual.');
    const pdf=f.elements.evidencia.files[0];if(!pdf||pdf.size>10*1024*1024)throw Error('Adjunte un PDF de hasta 10 MB.');
    data.set('fechaAceptacionHistorica',moment.toISOString());data.set('actividadIds',JSON.stringify(ids));
    // No duplicar los checks como campos sueltos fuera del contrato.
    data.delete('actividadHistorica');
    await api(`/proyectos/${selected.id}/planes/regularizacion`,{method:'POST',body:data});f.reset();
  })});
  $('planRejectionForm').addEventListener('submit',e=>{const f=e.currentTarget;if(!selected){e.preventDefault();return;}runForm(e,async()=>{
    if(!planPending)throw Error('No hay propuesta pendiente.');
    await api(`/proyectos/${selected.id}/planes/${planPending.id}/no-aceptacion`,{method:'POST',body:JSON.stringify({motivoNoAceptacion:field(f,'motivoNoAceptacion')})});f.reset();
  })});
  $('newDiagnosis').addEventListener('click',()=>{if(!selected)return;perform(async()=>{
    await api(`/proyectos/${selected.id}/diagnosticos`,{method:'POST',body:'{}'});
    status(admin?'Diagnóstico habilitado para la empresa. Su representante responde desde Mis diagnósticos.':'Diagnóstico creado. Puedes responder desde Mis diagnósticos.');
  })});
  adminOptions().then(projects);
})();
