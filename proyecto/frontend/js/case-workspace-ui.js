/* Presentación de acciones del expediente. No sustituye autorizaciones del backend. */
(function (root, factory) {
  'use strict';
  const ui=factory();
  if (typeof module==='object' && module.exports) module.exports=ui;
  if (root && root.document) root.NexoCaseWorkspaceUI=ui;
})(typeof globalThis!=='undefined' ? globalThis : null, function () {
  'use strict';
  const descriptors=[
    {key:'breach',form:'brechaForm',panel:'caseBreachPanel',button:'caseStartBreach'},
    {key:'task',form:'taskForm',panel:'caseTaskPanel',button:'caseStartActivity'},
    {key:'plan',forms:['planProposalForm','planWithdrawForm','planAcceptanceForm','planRegularizationForm','planRejectionForm'],panel:'casePlanPanel',button:'caseStartPlan'},
    {key:'additional',forms:['additionalProposalForm','additionalConfirmForm','additionalChangeForm','additionalAcceptanceForm'],panel:'caseAdditionalPanel'},
  ];
  function create(doc) {
    const byId=id=>doc.getElementById(id);
    // La caja desplegable no forma parte del permiso: se oculta precisamente
    // cuando el formulario no está disponible. No permitir que esa ocultación
    // cree una dependencia circular e impida que vuelva a aparecer al cambiar rol.
    function visible(form) {
      if(!form || form.classList.contains('g1-hide'))return false;
      for(let parent=form.parentElement;parent;parent=parent.parentElement){
        if(parent.classList.contains('case-action-disclosure'))continue;
        if(parent.classList.contains('g1-hide')||parent.hasAttribute('hidden'))return false;
      }
      return true;
    }
    function permitted(config) {
      const forms=(config.forms||[config.form]).map(byId);
      return forms.some(visible);
    }
    function sync() {
      const detail=byId('projectDetail');
      const active=Boolean(detail&&!detail.classList.contains('g1-hide'));
      let shortcuts=0;
      for (const config of descriptors) {
        const available=active&&permitted(config);
        const panel=byId(config.panel),button=config.button?byId(config.button):null;
        if (panel) {
          panel.classList.toggle('g1-hide',!available);
          if(!available)panel.open=false;
        }
        if(button){button.classList.toggle('g1-hide',!available);if(available)shortcuts++;}
      }
      byId('caseActionHub')?.classList.toggle('g1-hide',!shortcuts);
    }
    function open(key,{focus=true}={}) {
      const config=descriptors.find(item=>item.key===key);
      if(!config||!permitted(config))return false;
      const panel=byId(config.panel);
      if(!panel||panel.classList.contains('g1-hide'))return false;
      panel.open=true;
      panel.scrollIntoView({block:'start',behavior:'instant'});
      if(focus) {
        const heading=(config.form?byId(config.form):panel)?.querySelector('h3,h4') || panel.querySelector('summary');
        if(heading){if(!heading.hasAttribute('tabindex')&&heading.tagName!=='SUMMARY')heading.tabIndex=-1;heading.focus({preventScroll:true});}
      }
      return true;
    }
    function reset() {
      for(const config of descriptors){const panel=byId(config.panel);if(panel)panel.open=false;}
    }
    for(const config of descriptors.filter(item=>item.button)) {
      byId(config.button)?.addEventListener('click',()=>open(config.key));
    }
    // Los permisos visibles se resuelven por los controladores existentes y pueden
    // cambiar tras una consulta de plan o acuerdos; no se consulta la API aquí.
    const observed=descriptors.flatMap(item=>item.forms||[item.form]).map(byId).filter(Boolean);
    observed.push(byId('consultorForms'),byId('projectDetail'));
    const observer=new MutationObserver(sync);
    for(const form of observed.filter(Boolean))observer.observe(form,{attributes:true,attributeFilter:['class']});
    sync();
    return {sync,open,reset};
  }
  return {create,descriptors};
});
