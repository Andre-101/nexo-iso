/* Guided diagnosis; presentation only, answers still saved explicitly via existing API. */
(() => {
  'use strict';
  const root=document.getElementById('respuestasContainer');
  const panel=document.getElementById('respuestasPanel');
  if(!root||!panel)return;
  const intro=document.createElement('div');intro.className='diagnosis-guide';intro.hidden=true;
  intro.innerHTML=`<div><span class="eyebrow">CUESTIONARIO DE LA EMPRESA</span><h3>Responde por área, a tu ritmo</h3><p class="muted">Selecciona un nivel por pregunta. Guardar registra lo diligenciado en el servidor; cambiar de área no guarda automáticamente. Un diagnóstico enviado no equivale a aprobación.</p></div>
  <div class="diagnosis-progress"><span id="nexoAnswerCount" role="status" aria-live="polite"></span><progress id="nexoAnswerProgress" max="1" value="0" aria-label="Preguntas con nivel declarado"></progress><span id="nexoDraftWarning" class="muted">Sin cambios nuevos</span></div>
  <nav id="nexoAreaNav" class="diagnosis-area-nav" aria-label="Áreas del cuestionario"></nav>
  <div class="diagnosis-controls"><button class="secondary" id="nexoAreaPrev" type="button">← Área anterior</button><span id="nexoAreaPosition" class="muted"></span><button class="secondary" id="nexoAreaNext" type="button">Siguiente área →</button><button class="secondary" id="nexoAreaAll" type="button" aria-pressed="false">Ver todas las áreas</button></div>`;
  root.before(intro);
  let index=0,all=false,dirty=false,pending=false;
  let areas=[];
  const nav=intro.querySelector('#nexoAreaNav');
  const count=intro.querySelector('#nexoAnswerCount');
  const progress=intro.querySelector('#nexoAnswerProgress');
  const prev=intro.querySelector('#nexoAreaPrev');
  const next=intro.querySelector('#nexoAreaNext');
  const position=intro.querySelector('#nexoAreaPosition');
  const allButton=intro.querySelector('#nexoAreaAll');
  const warn=intro.querySelector('#nexoDraftWarning');
  const stats=()=>{
    const items=[...root.querySelectorAll('select[data-field="valor"]')];
    const answered=items.filter(select=>select.value!=='').length;
    count.textContent=`${answered} de ${items.length} preguntas con nivel declarado (no representa conformidad)`;
    progress.max=Math.max(1,items.length);progress.value=answered;
    for(const [i,button] of [...nav.children].entries()){
      const sels=[...areas[i].querySelectorAll('select[data-field="valor"]')];
      const ready=sels.filter(s=>s.value!=='').length;
      const num=button.querySelector('small');if(num)num.textContent=`${ready}/${sels.length} respondidas`;
    }
    warn.textContent=dirty?'Cambios sin guardar':'Sin cambios nuevos';warn.classList.toggle('has-unsaved',dirty);
  };
  function draw({focus=false}={}){
    areas.forEach((area,i)=>{area.hidden=!all && i!==index;});
    for(const [i,btn] of [...nav.children].entries())btn.setAttribute('aria-current',!all&&i===index?'step':'false');
    position.textContent=all?`Todas las áreas · ${areas.length}`:`Área ${index+1} de ${areas.length}`;
    prev.disabled=all||index===0;next.disabled=all||index===areas.length-1;
    allButton.setAttribute('aria-pressed',String(all));allButton.textContent=all?'Ver una sola área':'Ver todas las áreas';
    stats();
    if(focus){const heading=areas[index]?.querySelector('h3');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});intro.scrollIntoView({block:'start'});}}
  }
  function setup(){
    areas=[...root.querySelectorAll(':scope > section.question-area')];
    if(!areas.length){intro.hidden=true;dirty=false;return;}
    index=0;all=false;dirty=false;intro.hidden=false;
    nav.replaceChildren();
    areas.forEach((area,i)=>{
      const title=area.querySelector('h3')?.textContent||`Área ${i+1}`;
      const button=document.createElement('button');button.type='button';button.className='diagnosis-area-button';
      const name=document.createElement('strong');name.textContent=title;
      const amount=document.createElement('small');button.append(name,amount);
      button.addEventListener('click',()=>{all=false;index=i;draw({focus:true});});nav.append(button);
    });
    draw();
  }
  const observer=new MutationObserver(records=>{
    if(!records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1 && (node.matches?.('.question-area')||node.querySelector?.('.question-area')))))return;
    if(pending)return;pending=true;queueMicrotask(()=>{pending=false;setup();});
  });
  observer.observe(root,{childList:true});
  root.addEventListener('change',event=>{if(event.target.matches('[data-question-id]')){dirty=true;stats();}});
  root.addEventListener('input',event=>{if(event.target.matches('[data-field="comentario"]')){dirty=true;stats();}});
  prev.addEventListener('click',()=>{index=Math.max(0,index-1);draw({focus:true});});
  next.addEventListener('click',()=>{index=Math.min(areas.length-1,index+1);draw({focus:true});});
  allButton.addEventListener('click',()=>{all=!all;draw();});
  window.addEventListener('beforeunload',event=>{if(!dirty)return;event.preventDefault();event.returnValue='';});
  document.getElementById('evaluacionesContainer')?.addEventListener('click',event=>{
    if(!dirty)return;
    const button=event.target.closest('button[data-action]');
    if(!button || !['responder','enviar'].includes(button.dataset.action))return;
    if(button.dataset.action==='enviar'){
      event.preventDefault();event.stopImmediatePropagation();
      warn.textContent='Guarda o descarta tus cambios antes de enviar el diagnóstico.';
      warn.setAttribute('role','alert');intro.scrollIntoView({block:'start'});return;
    }
    if(!window.confirm('Hay respuestas sin guardar. ¿Quieres abrir otra evaluación y descartar esos cambios?')){
      event.preventDefault();event.stopImmediatePropagation();return;
    }
    dirty=false;
  },true);
  setup();
})();
