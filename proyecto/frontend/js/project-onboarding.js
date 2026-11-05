/* Apertura administrativa explícita: cuentas en ADMIN, vinculación/proyecto/equipo en su propia secuencia. */
(() => {
 'use strict';
 const area=document.getElementById('adminArea');
 if(!area||window.ISO?.getUser()?.rol!=='ADMIN')return;
 const opener=document.getElementById('nexoOpenAdminArea');
 if(opener)opener.classList.remove('g1-hide');
 const info=document.createElement('div');info.className='admin-case-intro';
 info.innerHTML=`<span class="eyebrow">APERTURA DE SERVICIO · USO ADMINISTRATIVO</span><h3>Configurar un proyecto contratado</h3><p>Trabaja en orden. La creación de una cuenta no crea una empresa ni acredita representación; un proyecto se abre solo cuando el servicio y su alcance han sido contratados por los canales autorizados.</p><a href="./admin.html#cuentas" class="text-link">Ir a cuentas y permisos →</a>`;
 area.querySelector('h2')?.after(info);
 const nav=document.createElement('nav');nav.className='admin-case-tabs';nav.setAttribute('aria-label','Pasos de apertura');
 const steps=[{id:'empresaFormG1',title:'1. Empresa y representante',hint:'NIT y constancia de facultades'},
 {id:'projectForm',title:'2. Abrir expediente',hint:'Norma, contrato y consultor principal'},
 {id:'assignForm',title:'3. Ampliar equipo',hint:'Participaciones vigentes'}];
 const buttons=new Map();
 for(const step of steps){const button=document.createElement('button');button.type='button';button.className='admin-case-step';
 button.innerHTML=`<strong>${step.title}</strong><small>${step.hint}</small>`;
 button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>show(step.id,{focus:true}));
 nav.append(button);buttons.set(step.id,button);}
 info.after(nav);
 const exit=document.createElement('button');exit.type='button';exit.className='secondary';exit.textContent='Cerrar apertura y volver a expedientes';
 exit.addEventListener('click',()=>{area.dataset.adminCollapsed='true';opener?.focus();history.replaceState(null,'',location.href.split('#')[0]);});
 nav.after(exit);
 function show(id,{focus=false}={}){
   if(!buttons.has(id))id=steps[0].id;
   for(const step of steps){
     const node=document.getElementById(step.id);node.hidden=step.id!==id;
     buttons.get(step.id).setAttribute('aria-pressed',String(step.id===id));
   }
   if(focus){document.getElementById(id)?.querySelector('h3')?.setAttribute('tabindex','-1');document.getElementById(id)?.querySelector('h3')?.focus({preventScroll:true});area.scrollIntoView({block:'start'});}
 }
 function openFromHash(){
   const hash=location.hash.slice(1);
   const showArea=hash==='adminArea'||steps.some(x=>x.id===hash);
   area.dataset.adminCollapsed=String(!showArea);
   if(showArea)show(steps.some(x=>x.id===hash)?hash:'empresaFormG1');
 }
 opener?.addEventListener('click',()=>{area.dataset.adminCollapsed='false';show('empresaFormG1');});
 document.getElementById('projectGuideLinks')?.addEventListener('click',e=>{
   const a=e.target.closest('a[href^="#"]');if(!a)return;
   const id=a.hash.slice(1);
   if(id==='adminArea'||steps.some(x=>x.id===id)){area.dataset.adminCollapsed='false';show(steps.some(x=>x.id===id)?id:'empresaFormG1');}
 });
 window.addEventListener('hashchange',openFromHash);
 show('empresaFormG1');openFromHash();
})();
