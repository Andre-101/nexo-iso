/* Shell accesible, navegación por roles y comprobación de identidad remota. */
(() => {
  'use strict';
  if (!document.body.hasAttribute('data-protected')) return;
  const client = window.ISO;
  const user = client.getUser();
  if (!client.getToken() || !user) { client.clearSession(); location.replace('./login.html'); return; }
  const page = location.pathname.split('/').pop();
  const model = window.NexoWorkspace;
  if (!model) throw new Error('No se pudo inicializar el mapa de navegación.');
  const links = model.available(user.rol).map(item=>[item.href,item.title,item.icon,item.roles]);
  // Una sola matriz para navegación y acceso directo por URL. Esto protege la
  // presentación; la API sigue siendo la autoridad de autorización real.
  const currentPage = model.routes.find(item => item.href === page);
  if (currentPage && !model.allowed(user.rol,page)) {
    location.replace('./dashboard.html'); return;
  }
  const root = document.querySelector('body > main');
  if (!root) return;
  // Los accesos contextuales de las páginas siguen la MISMA matriz del menú.
  // Evita ofrecer al consultor enlaces que terminan redirigiéndolo fuera de
  // Diagnósticos u otras páginas reservadas. No sustituye controles de API.
  for (const anchor of root.querySelectorAll('a[href^="./"]')) {
    const target = anchor.getAttribute('href').slice(2).split(/[?#]/, 1)[0];
    const destination = model.routes.find(item => item.href === target);
    if (destination && !model.allowed(user.rol,target)) anchor.remove();
  }
  const skip = document.createElement('a'); skip.href = '#contenido'; skip.className='skip-link'; skip.textContent='Saltar al contenido';
  const wrapper = document.createElement('div'); wrapper.className='app-shell';
  const aside = document.createElement('aside'); aside.className='app-sidebar'; aside.id='appNavigation';
  const backdrop = document.createElement('div'); backdrop.className='nav-backdrop';
  backdrop.setAttribute('aria-hidden','true');
  const mobileClose = document.createElement('button'); mobileClose.type='button';
  mobileClose.className='nav-mobile-close secondary'; mobileClose.textContent='Cerrar menú';
  mobileClose.setAttribute('aria-label','Cerrar menú de navegación');
  const brand = document.createElement('a'); brand.href='./dashboard.html'; brand.className='shell-brand';
  const emblem = document.createElement('span'); emblem.className='brand-mark'; emblem.textContent='✳'; emblem.setAttribute('aria-hidden','true');
  const brandCopy = document.createElement('span');
  const bn = document.createElement('strong'); bn.textContent='NEXO';
  const bs = document.createElement('small'); bs.textContent='ISO/IEC 27001 + 42001';
  brandCopy.append(bn,bs);brand.append(emblem,brandCopy);aside.append(brand,mobileClose);
  const nav = document.createElement('nav');nav.className='side-nav';nav.setAttribute('aria-label','Navegación principal');
  const roleCaption = {ADMIN:'COORDINACIÓN DEL SERVICIO',EVALUADOR:'EQUIPO CONSULTOR',EMPRESARIO:'REPRESENTANTE DE EMPRESA'}[user.rol];
  const roleTag = document.createElement('p');roleTag.className='sidebar-role-tag';roleTag.textContent=roleCaption;
  aside.append(roleTag);
  let currentGroup='';
  for (const item of model.menu(user.rol)) {
    const {href,title,icon,group} = item;
    if (group !== currentGroup) {
      const section=document.createElement('p');section.className='nav-section-label';section.textContent=group;nav.append(section);currentGroup=group;
    }
    const a=document.createElement('a');a.href='./'+href;a.className='side-nav-link';
    if(page===href){a.setAttribute('aria-current','page');a.classList.add('active');}
    const glyph=document.createElement('span');glyph.className='nav-glyph';glyph.textContent=icon;glyph.setAttribute('aria-hidden','true');
    a.append(glyph,document.createTextNode(title));nav.append(a);
  }
  aside.append(nav);
  const asideBottom=document.createElement('div');asideBottom.className='side-footer';
  const reminder=document.createElement('p');reminder.textContent='Herramienta de preparación. La certificación la decide un organismo independiente.';
  const support=document.createElement('small');support.textContent='Expedientes y permisos definidos por la API';asideBottom.append(reminder,support);aside.append(asideBottom);
  const container=document.createElement('div');container.className='app-content';
  const header=document.createElement('header');header.className='app-topbar';
  const toggle=document.createElement('button');toggle.type='button';toggle.className='nav-toggle';toggle.setAttribute('aria-controls','appNavigation');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Abrir menú de navegación');toggle.textContent='☰';
  const mobileLayout = window.matchMedia('(max-width:850px)');
  const focusableInMenu = () => [...aside.querySelectorAll('a[href],button:not([disabled])')]
    .filter(el => !el.hidden && el.getClientRects().length > 0);
  function syncNavigation(){
    const mobile=mobileLayout.matches;
    const open=mobile&&wrapper.classList.contains('nav-open');
    aside.inert=mobile&&!open;
    container.inert=open;
    document.body.classList.toggle('nav-overlay-open',open);
    toggle.setAttribute('aria-expanded',String(open));
    toggle.setAttribute('aria-label',open?'Cerrar menú de navegación':'Abrir menú de navegación');
    if (open) {
      aside.setAttribute('role','dialog'); aside.setAttribute('aria-modal','true');
      aside.setAttribute('aria-label','Menú de navegación');
    } else {
      aside.removeAttribute('role'); aside.removeAttribute('aria-modal');
      aside.removeAttribute('aria-label');
    }
  }
  function closeNavigation({restoreFocus=false}={}) {
    const wasOpen=wrapper.classList.contains('nav-open');
    wrapper.classList.remove('nav-open'); syncNavigation();
    if (wasOpen&&restoreFocus&&mobileLayout.matches) toggle.focus();
  }
  function openNavigation(){
    if (!mobileLayout.matches) return;
    wrapper.classList.add('nav-open');syncNavigation();
    mobileClose.focus();
  }
  toggle.addEventListener('click',()=>{
    if(wrapper.classList.contains('nav-open'))closeNavigation({restoreFocus:true});
    else openNavigation();
  });
  mobileClose.addEventListener('click',()=>closeNavigation({restoreFocus:true}));
  backdrop.addEventListener('click',()=>closeNavigation({restoreFocus:true}));
  nav.addEventListener('click',event=>{if(event.target.closest('a'))closeNavigation();});
  document.addEventListener('keydown',event=>{
    if(!wrapper.classList.contains('nav-open') || !mobileLayout.matches) return;
    if(event.key==='Escape'){
      event.preventDefault();closeNavigation({restoreFocus:true});return;
    }
    if(event.key==='Tab'){
      const candidates=focusableInMenu();
      if (!candidates.length) {event.preventDefault();mobileClose.focus();return;}
      const first=candidates[0],last=candidates[candidates.length-1];
      if(event.shiftKey && (document.activeElement===first || !aside.contains(document.activeElement))){
        event.preventDefault();last.focus();
      }else if(!event.shiftKey && (document.activeElement===last || !aside.contains(document.activeElement))){
        event.preventDefault();first.focus();
      }
    }
  });
  mobileLayout.addEventListener('change',()=>{closeNavigation();syncNavigation();});
  syncNavigation();
  const crumbs=document.createElement('div');crumbs.className='breadcrumbs';crumbs.textContent='Espacio de trabajo  /  '+(model.routes.find(l=>l.href===page)?.title||'General');
  // Navegador de secciones: las opciones respetan la misma visibilidad por rol del menú.
  const availableLinks=model.menu(user.rol).map(item=>[item.href,item.title,item.icon,item.roles]);
  const quickButton=document.createElement('button');
  quickButton.type='button';quickButton.className='quick-nav-trigger secondary';
  quickButton.textContent='Buscar sección';quickButton.setAttribute('aria-keyshortcuts','Control+K');
  quickButton.setAttribute('aria-haspopup','dialog');
  const quickDialog=document.createElement('dialog');quickDialog.className='quick-nav-dialog';
  quickDialog.setAttribute('aria-label','Buscar sección de la aplicación');
  const quickHeading=document.createElement('h2');quickHeading.textContent='Ir a una sección';
  const quickHint=document.createElement('p');quickHint.className='g1-muted';quickHint.textContent='Busca por nombre. Usa las flechas para elegir y Enter para abrir.';
  const quickInput=document.createElement('input');quickInput.type='search';quickInput.placeholder='Escribe una sección…';
  quickInput.setAttribute('aria-label','Buscar sección');quickInput.setAttribute('autocomplete','off');
  const quickResults=document.createElement('div');quickResults.className='quick-nav-results';
  const quickClose=document.createElement('button');quickClose.type='button';quickClose.className='secondary';quickClose.textContent='Cerrar';
  quickDialog.append(quickHeading,quickHint,quickInput,quickResults,quickClose);
  let selectedIndex=0;
  function visibleLinks(){const q=quickInput.value.trim().toLocaleLowerCase('es');return availableLinks.filter(item=>item[1].toLocaleLowerCase('es').includes(q));}
  function renderQuickResults(){
    const found=visibleLinks();selectedIndex=Math.min(selectedIndex,Math.max(0,found.length-1));
    quickResults.replaceChildren();
    if(!found.length){const empty=document.createElement('p');empty.className='empty-list';empty.textContent='No hay secciones que coincidan con la búsqueda.';quickResults.append(empty);return;}
    found.forEach(([href,name],index)=>{
      const link=document.createElement('a');link.href='./'+href;link.className='quick-nav-result';
      link.textContent=name;if(href===page)link.setAttribute('aria-current','page');
      if(index===selectedIndex)link.classList.add('is-selected');
      link.addEventListener('mouseenter',()=>{selectedIndex=index;renderSelection();});
      quickResults.append(link);
    });
  }
  function renderSelection(){quickResults.querySelectorAll('.quick-nav-result').forEach((a,i)=>a.classList.toggle('is-selected',i===selectedIndex));}
  function openQuickNav(){
    if(quickDialog.open)return;
    closeNavigation();quickInput.value='';selectedIndex=0;renderQuickResults();
    quickDialog.showModal();quickInput.focus();
  }
  quickButton.addEventListener('click',openQuickNav);
  quickClose.addEventListener('click',()=>quickDialog.close());
  quickInput.addEventListener('input',()=>{selectedIndex=0;renderQuickResults();});
  quickInput.addEventListener('keydown',event=>{
    const found=visibleLinks();
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();if(!found.length)return;
      selectedIndex=(selectedIndex+(event.key==='ArrowDown'?1:-1)+found.length)%found.length;renderSelection();
    } else if(event.key==='Enter'&&found.length){event.preventDefault();location.assign('./'+found[selectedIndex][0]);}
  });
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.altKey||event.shiftKey)return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){
      event.preventDefault();if(quickDialog.open)quickDialog.close();else openQuickNav();
    }
  });
  document.body.append(quickDialog);
  const acct=document.createElement('div');acct.className='top-account';
  const initial=document.createElement('span');initial.className='account-avatar';initial.textContent=user.nombre.trim().charAt(0).toUpperCase()||'U';initial.setAttribute('aria-hidden','true');
  const who=document.createElement('span');who.className='account-copy';who.textContent=user.nombre;
  const roleName={ADMIN:'Administración',EMPRESARIO:'Representante de empresa',EVALUADOR:'Consultor'}[user.rol];
  const role=document.createElement('small');role.textContent=roleName;who.append(role);
  acct.setAttribute('role','group');
  acct.setAttribute('aria-label',`Sesión de ${user.nombre}. Rol: ${roleName}`);
  const mobileRole=document.createElement('span');mobileRole.className='mobile-session-role';
  mobileRole.textContent={ADMIN:'Admin',EMPRESARIO:'Representante',EVALUADOR:'Consultor'}[user.rol];
  mobileRole.setAttribute('aria-hidden','true');
  const exit=document.createElement('button');exit.type='button';exit.className='top-logout';exit.textContent='Salir';exit.setAttribute('aria-label','Cerrar sesión');
  exit.addEventListener('click',()=>{client.clearSession();location.replace('./login.html');});
  if(user.rol==='EMPRESARIO'){
    const notifications=document.createElement('a');
    notifications.href='./proyectos.html#notificationsArea';
    notifications.className='shell-notification-link';
    notifications.textContent='Avisos';
    notifications.setAttribute('aria-label','Ver avisos de cambios de plazo');
    header.append(notifications);
    let requestNumber=0;
    async function checkUnread(){
      const request=++requestNumber;
      try {
        const result=await client.api('/proyectos/notificaciones/mias');
        if(request!==requestNumber)return;
        const count=Number(result.pendientes);
        if(Number.isInteger(count) && count>=0){
          notifications.textContent=count>0?`Avisos pendientes (${count})`:'Avisos';
          notifications.setAttribute('aria-label',count>0?`${count} avisos pendientes. Abrir bandeja`:'Abrir bandeja de avisos');
        }
      }catch { /* No se confunde un fallo de red con cero avisos. */
        if(request===requestNumber)notifications.textContent='Avisos (sin conexión)';
      }
    }
    checkUnread();
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkUnread();});
    window.addEventListener('focus',checkUnread);
  }
  acct.append(initial,who,mobileRole,exit);header.append(toggle,crumbs,quickButton,acct);
  root.id='contenido';root.setAttribute('tabindex','-1');container.append(header,root);wrapper.append(backdrop,aside,container);document.body.prepend(skip,wrapper);
  // Asociación de etiquetas heredadas de formularios G0; no modifica datos.
  let labelCounter = 0;
  for (const label of root.querySelectorAll('.form label:not([for])')) {
    const next = label.nextElementSibling;
    if (next && ['INPUT','SELECT','TEXTAREA'].includes(next.tagName) && !next.closest('label')) {
      next.id ||= `form-field-${++labelCounter}`;
      label.htmlFor = next.id;
    }
  }
  const expire=()=>{client.clearSession();location.replace('./login.html?sesion=expirada');};
  window.addEventListener('iso:session-expired', expire);
  client.api('/auth/me').then(result=>{
    const actual=result?.usuario;
    if(!actual || actual.id!==user.id || actual.rol!==user.rol) expire();
    else { client.setSession({token:client.getToken(),usuario:{...user,...actual}}); }
  }).catch(error=>{
    if(error.status===401||error.status===403)expire();
    else {const banner=document.createElement('p');banner.className='connection-warning';banner.setAttribute('role','alert');banner.textContent='No se pudo verificar la sesión con el servidor. Reintenta cuando esté disponible.';header.after(banner);}
  });
})();
