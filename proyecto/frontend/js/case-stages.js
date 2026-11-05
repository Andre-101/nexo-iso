/* Expediente orientado al proceso real, sin modificar autorizaciones ni contratos.
 * Las vistas son grupos de PRESENTACIÓN: cada operación conserva la validación del backend.
 */
(function (root, factory) {
  const model=factory();
  if (typeof module==='object' && module.exports) module.exports=model;
  if (root && root.document) root.NexoCaseStages=model;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
  'use strict';
  const STAGES=Object.freeze([
    {id:'resumen',title:'Resumen',subtitle:'Contexto, equipo y pendientes',description:'Consulta el contexto y las prioridades registradas. Este panel no determina conformidad normativa.'},
    {id:'diagnostico',title:'Diagnóstico',subtitle:'Respuestas y aclaraciones',description:'La empresa responde el diagnóstico; el equipo consultor analiza respuestas y registra observaciones dentro de sus competencias.'},
    {id:'plan',title:'Plan de trabajo',subtitle:'Versiones y aceptación',description:'Un plan propuesto no autoriza ejecución. La aceptación externa debe constar según las reglas aprobadas.'},
    {id:'ejecucion',title:'Ejecución',subtitle:'Actividades y brechas',description:'Gestiona actividades, responsables y brechas según tu participación y el alcance aceptado.'},
    {id:'documentos',title:'Evidencias e informes',subtitle:'Revisiones y documentación',description:'Las revisiones documentales, verificaciones y publicaciones son decisiones diferentes y conservan sus controles.'},
    {id:'gestion',title:'Gestión especial',subtitle:'Acuerdos y conservación',description:'Operaciones contractuales o excepcionales disponibles solo cuando el servidor y las funciones asignadas lo permiten.'}
  ]);
  function stageForNode(node){
    if(!node)return null;
    const id=node.id||'';
    if(['caseActionHub','caseOverview','attentionWorkspace','projectDesc','projectTeam'].includes(id))return 'resumen';
    if(id==='planSection')return 'plan';
    if(['consultorForms','brechas','breachWorkspace','breaches','actividades','tasksSummary','tasks'].includes(id))return 'ejecucion';
    if(['diagnosticos','diagnoses','diagnosisDetail'].includes(id))return 'diagnostico';
    if(['g2Area','g3Area'].includes(id))return 'documentos';
    if(['additionalSection','retentionSection'].includes(id))return 'gestion';
    if(node.classList?.contains('workspace-filter') || node.querySelector?.('#taskSearch'))return 'ejecucion';
    if(node.querySelector?.('#newDiagnosis'))return 'diagnostico';
    return null;
  }
  function stageForTarget(id){
    if(['caseBreachPanel','caseTaskPanel','taskForm','caseStartBreach','caseStartActivity'].includes(id))return 'ejecucion';
    if(['casePlanPanel','caseStartPlan'].includes(id))return 'plan';
    if(['attentionWorkspace'].includes(id))return 'resumen';
    if(['g3Area'].includes(id))return 'documentos';
    return null;
  }
  return {STAGES,stageForNode,stageForTarget};
});

(() => {
  'use strict';
  if (!document.body.hasAttribute('data-protected'))return;
  const detail=document.getElementById('projectDetail');
  if(!detail)return;
  const model=window.NexoCaseStages;
  const user=window.ISO?.getUser();
  if(!user)return;
  const visibleStages=model.STAGES.filter(x=>x.id!=='gestion'||user.rol!=='EMPRESARIO');
  const nav=document.createElement('nav');nav.id='nexoCaseFlow';nav.className='case-stage-nav';nav.setAttribute('aria-label','Etapas del expediente');
  const heading=document.createElement('div');heading.className='case-stage-intro';
  heading.innerHTML='<div><span class="eyebrow">RECORRIDO DEL EXPEDIENTE</span><h3 id="nexoStageTitle">Resumen</h3><p id="nexoStageDescription"></p></div><span class="case-stage-note">Navegar por etapas no cambia el estado del proyecto</span>';
  const steps=document.createElement('div');steps.className='case-stage-steps';
  const buttons=new Map();
  const stagesOnMenu=()=>visibleStages.filter(x=>!buttons.get(x.id)?.hidden);
  visibleStages.forEach((stage,index)=>{
    const b=document.createElement('button');b.type='button';b.className='case-stage-button';
    b.dataset.stage=stage.id;
    b.innerHTML=`<span class="case-stage-number">${String(index+1).padStart(2,'0')}</span><span><strong>${stage.title}</strong><small>${stage.subtitle}</small></span>`;
    b.setAttribute('aria-pressed','false');
    b.addEventListener('click',()=>activate(stage.id,{updateHistory:true,focus:true}));
    steps.append(b);buttons.set(stage.id,b);
  });
  nav.append(steps);
  const footer=document.createElement('div');footer.className='case-stage-footer';
  const prev=document.createElement('button');prev.className='secondary';prev.type='button';prev.textContent='← Etapa anterior';
  const next=document.createElement('button');next.className='secondary';next.type='button';next.textContent='Etapa siguiente →';
  const counter=document.createElement('span');counter.className='muted';counter.setAttribute('aria-live','polite');
  footer.append(prev,counter,next);
  // La lista y el expediente son contextos distintos: una vez abierto el caso,
  // la lista se compacta pero permanece recuperable sin perder el expediente.
  const collection=document.getElementById('projectCollection');
  const switcher=document.createElement('button');switcher.type='button';
  switcher.id='nexoChangeProject';switcher.className='secondary';switcher.textContent='Cambiar expediente';
  switcher.hidden=true;
  collection.querySelector('.g1-toolbar')?.append(switcher);
  function expandCollection(){collection.dataset.nexoCompact='false';switcher.hidden=true;collection.scrollIntoView({block:'start'});}
  switcher.addEventListener('click',expandCollection);
  document.getElementById('returnToProjects')?.addEventListener('click',expandCollection,true);
  const collectionObserver=new MutationObserver(()=>{
    if(detail.classList.contains('g1-hide')){collection.dataset.nexoCompact='false';switcher.hidden=true;}
    else if(collection.dataset.nexoCompact!=='false'){collection.dataset.nexoCompact='true';switcher.hidden=false;}
  });
  collectionObserver.observe(detail,{attributes:true,attributeFilter:['class']});
  const originalIndex=document.getElementById('caseIndex');originalIndex.hidden=true;
  originalIndex.insertAdjacentElement('beforebegin',heading);
  heading.insertAdjacentElement('afterend',nav);
  detail.append(footer);
  const targets=new Map();
  let current='resumen';
  function assignNodes(){
    for(const child of detail.children){
      if(child===heading||child===nav||child===footer||child===originalIndex)continue;
      const stage=model.stageForNode(child);
      if(stage){targets.set(child,stage);child.dataset.nexoStage=stage;}
    }
  }
  assignNodes();
  function syncSpecialStage(){
    const button=buttons.get('gestion');if(!button)return;
    const available=['additionalSection','retentionSection'].some(id=>{const el=document.getElementById(id);return el&&!el.classList.contains('g1-hide');});
    button.hidden=!available;
    if(!available&&current==='gestion')activate('resumen');
  }
  function allowedStage(id){return Boolean(buttons.has(id)&&!buttons.get(id).hidden);}
  function activate(id,{updateHistory=false,focus=false}={}){
    if(!allowedStage(id))id='resumen';
    current=id;const menu=stagesOnMenu();const currentModel=menu.find(s=>s.id===id);
    for(const [child,stage] of targets){child.dataset.nexoStageHidden=String(stage!==id);}
    for(const [stage,b] of buttons){
      b.setAttribute('aria-pressed',String(stage===id));
      b.classList.toggle('is-current',stage===id);
    }
    const i=menu.findIndex(x=>x.id===id);
    document.getElementById('nexoStageTitle').textContent=currentModel.title;
    document.getElementById('nexoStageDescription').textContent=currentModel.description;
    prev.disabled=i===0;next.disabled=i===menu.length-1;
    counter.textContent=`Etapa ${i+1} de ${menu.length}`;
    if(updateHistory)history.replaceState(null,'','#etapa-'+id);
    if(focus){document.getElementById('nexoStageTitle').setAttribute('tabindex','-1');document.getElementById('nexoStageTitle').focus({preventScroll:true});heading.scrollIntoView({block:'start'});}
  }
  prev.addEventListener('click',()=>{const list=stagesOnMenu();activate(list[Math.max(0,list.findIndex(x=>x.id===current)-1)].id,{updateHistory:true,focus:true});});
  next.addEventListener('click',()=>{const list=stagesOnMenu();activate(list[Math.min(list.length-1,list.findIndex(x=>x.id===current)+1)].id,{updateHistory:true,focus:true});});
  // Los accesos de acción del código heredado conservan su funcionalidad.
  detail.addEventListener('click',event=>{
    const action=event.target.closest('#caseStartBreach,#caseStartActivity,#caseStartPlan,[data-task-state]');
    if(!action)return;
    const stage=action.matches('[data-task-state]')?'ejecucion':model.stageForTarget(action.id);
    if(stage && current!==stage)activate(stage);
  },true);
  document.addEventListener('iso:attention:abrir-entregable',()=>activate('documentos'),true);
  // Un enlace legado a una subsección activa antes la etapa que la contiene.
  document.addEventListener('click',event=>{
    const link=event.target.closest('a[href^="#"]');if(!link)return;
    const id=decodeURIComponent(link.hash.slice(1));
    const target=document.getElementById(id);
    if(!target || !detail.contains(target))return;
    const direct=[...targets.keys()].find(node=>node===target||node.contains(target));
    const stage=targets.get(direct);
    if(stage && stage!==current)activate(stage);
  },true);
  // Permite abrir un enlace directo a una fase o sección en otra pestaña.
  function fromHash(){
    const hash=decodeURIComponent(location.hash.slice(1));
    if(hash.startsWith('etapa-') && allowedStage(hash.slice(6)))return hash.slice(6);
    const target=document.getElementById(hash);
    const direct=target&&[...targets.keys()].find(node=>node===target||node.contains(target));
    return targets.get(direct)||'resumen';
  }
  window.addEventListener('hashchange',()=>activate(fromHash()));
  // Al cambiar de expediente siempre vuelve al resumen, salvo destino profundo explícito.
  const stateObserver=new MutationObserver(()=>{
    if(detail.classList.contains('g1-hide'))return;
    const newId=detail.querySelector('#projectTitle')?.textContent||'';
    if(newId!==stateObserver.lastTitle){stateObserver.lastTitle=newId;collection.dataset.nexoCompact='true';switcher.hidden=false;activate(fromHash());}
  });
  stateObserver.observe(document.getElementById('projectTitle'),{childList:true,subtree:true,characterData:true});
  if(buttons.has('gestion')){
    const specialObserver=new MutationObserver(()=>syncSpecialStage());
    for(const id of ['additionalSection','retentionSection'])specialObserver.observe(document.getElementById(id),{attributes:true,attributeFilter:['class']});
  }
  syncSpecialStage();activate(fromHash());
})();
