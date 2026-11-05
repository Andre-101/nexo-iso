/* Vista ADMIN centrada en operaciones, sin suplantar diagnóstico ni revisión técnica. */
(() => {
 'use strict';
 const nav=document.querySelector('.admin-workflow-nav');
 if(!nav || window.ISO?.getUser()?.rol!=='ADMIN')return;
 const sections=['cuentas','empresasAdmin','alertasAdmin'];
 const links=[...nav.querySelectorAll('a[href^="#"]')];
 let active='cuentas';
 function show(id,{historyUpdate=false,focus=false}={}){
   if(!sections.includes(id))id='cuentas';active=id;
   for(const section of sections){const el=document.getElementById(section);if(el)el.hidden=section!==id;}
   for(const link of links){const current=link.hash.slice(1)===id;link.classList.toggle('active',current);link.setAttribute('aria-current',current?'step':'false');}
   if(historyUpdate)history.replaceState(null,'','#'+id);
   if(focus){const section=document.getElementById(id);section?.querySelector('h2')?.setAttribute('tabindex','-1');section?.querySelector('h2')?.focus({preventScroll:true});section?.scrollIntoView({block:'start'});}
 }
 for(const link of links)link.addEventListener('click',event=>{event.preventDefault();show(link.hash.slice(1),{historyUpdate:true,focus:true});});
 window.addEventListener('hashchange',()=>show(location.hash.slice(1)));
 show(sections.includes(location.hash.slice(1))?location.hash.slice(1):'cuentas');
})();
