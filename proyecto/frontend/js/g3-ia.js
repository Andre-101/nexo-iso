// G3: interfaz de autorización y revisión. Nunca inserta contenido del modelo como HTML.
(() => {
  const root=document.getElementById('g3Area');if(!root)return;
  const byId=id=>document.getElementById(id);
  let project=null,user=null,loadVersion=0;
  let aiConfig=null;
  const client=window.ISO;
  function n(tag,text,cls){const x=document.createElement(tag);if(text!==undefined)x.textContent=String(text);if(cls)x.className=cls;return x;}
  function button(text,cb){
    const b=n('button',text);b.type='button';
    b.addEventListener('click',async()=>{
      if(b.disabled)return;
      b.disabled=true;
      try{await cb();}finally{b.disabled=false;}
    });
    return b;
  }
  function msg(text,error=false){const el=byId('g3Msg');el.textContent=text;el.className=`g1-alert ${error?'error':'ok'}`;}
  async function api(endpoint,data){
    const projectId=project?.id;
    if(!projectId)throw Error('Selecciona un proyecto válido.');
    return client.api(`/proyectos/${projectId}${endpoint}`,data===undefined?{}:{method:'POST',body:JSON.stringify(data)});
  }
  const isClient=()=>user?.rol==='EMPRESARIO'&&project?.empresa?.usuarioId===user.id;
  const isConsultant=()=>user?.rol==='EVALUADOR'&&project?.participaciones?.some(p=>p.usuarioId===user.id&&p.activo!==false);
  async function perform(fn){const current=project;try{await fn();}catch(e){if(project===current)msg(e.message,true);}}
  async function load(){
    if(!project)return;
    const current=project, version=loadVersion;
    const area=byId('g3Docs');area.replaceChildren(n('p','Consultando documentos…','g1-muted'));
    aiConfig=await api('/ia/configuracion');
    const isRemote=aiConfig.proveedor==='anthropic';
    const providerLabel=aiConfig.descripcion;
    const canAuthorize=aiConfig.habilitada&&(!isRemote||aiConfig.transferenciaHabilitada);
    area.append(n('p',`Proveedor IA: ${providerLabel}. ${aiConfig.habilitada?'Habilitado':'Deshabilitado'}.`, 'g1-muted'));
    const deliveries=await api('/entregables');
    if(project!==current||version!==loadVersion)return;
    if(!Array.isArray(deliveries))throw Error('La API devolvió un listado documental inválido.');
    area.replaceChildren();
    area.append(n('p',`Proveedor de análisis: ${providerLabel}. ${aiConfig.habilitada?'Activo':'Inactivo'}.`, 'g1-muted'));
    let count=0;
    for(const e of deliveries){
      const docVersion=e.versiones?.[0];if(!docVersion)continue;count++;
      const card=n('article',undefined,'g1-card');card.append(n('h3',`${e.titulo} · Versión ${docVersion.numero}`));
      const status=n('p','Estado de autorización: consultando...','g1-muted');card.append(status);
      area.append(card);
      const endpoint=`/ia/versiones/${docVersion.id}`;
      let permission;
      try{permission=await api(`${endpoint}/autorizacion`);}catch(e){if(project===current&&version===loadVersion)status.textContent=e.message;continue;}
      if(project!==current||version!==loadVersion)return;
      const active=Boolean(permission.permiso?.autorizado===true&&!permission.permiso?.revocadoEn);
      status.textContent=`Versión #${docVersion.id} · ${active?'Autorizada por el cliente':'No autorizada'} · ${permission.esActual?'Actual':'Obsoleta'}`;
      if(isClient()&&project.estado==='ACTIVO'&&permission.esActual){
        if(!active&&canAuthorize){
          const classification=n('select');for(const val of ['PUBLICO','INTERNO']){const o=n('option',val);o.value=val;classification.append(o);}
          const purpose=n('input');purpose.placeholder='Finalidad: revisión documental asistida';purpose.value='Revision documental asistida para preparar el SGSI';purpose.maxLength=240;
          const label=n('label');const check=n('input');check.type='checkbox';
          label.append(check,n('span',isRemote?
           ' Autorizo expresamente el envío del texto extraído del PDF y los criterios a Anthropic (proveedor externo), para esta versión y finalidad.':
           ' Autorizo expresamente el análisis mediante Ollama local para esta versión.'));
          card.append(n('p',isRemote?
           'ATENCIÓN: el texto del PDF y los criterios se transmitirán a Anthropic. No autorice secretos, información personal o empresarial real en este entorno demo.':
           'Confirme que el PDF no contiene datos personales, contraseñas, secretos ni información de alta sensibilidad.','g1-muted'),classification,purpose,label);
          card.append(button(isRemote?'Autorizar análisis externo con Anthropic':'Autorizar IA local',()=>perform(async()=>{
            if(!check.checked){msg('Debe otorgar autorización expresa.',true);return;}
            if(purpose.value.trim().length<10){msg('Describe la finalidad del análisis con al menos 10 caracteres.',true);purpose.focus();return;}
            await api(`${endpoint}/autorizar`,{acepto:true,clasificacion:classification.value,finalidad:purpose.value,proveedorAceptado:aiConfig.proveedor});msg('Autorización registrada.');await load();
          })));
        }else if(!active)card.append(n('p','Autorización pendiente: proveedor deshabilitado o no autorizado por el operador.','g1-muted'));
        else card.append(button('Revocar autorización',()=>perform(async()=>{
          await api(`${endpoint}/revocar`,{});msg('Autorización revocada.');await load();
        })));
      }
      if(isConsultant()&&project.estado==='ACTIVO'&&permission.esActual&&active&&aiConfig.habilitada){
        const rules=n('textarea');rules.placeholder='Escriba criterios propios verificables, uno por línea; no copie texto ISO sin licencia.';
        rules.rows=3;rules.maxLength=1700;card.append(rules);
        const runLabel=isRemote?'Analizar PDF con Anthropic (externo)':'Analizar PDF con Ollama local';
        const run=button(runLabel,()=>perform(async()=>{
          const criterios=rules.value.split('\n').map(x=>x.trim()).filter(Boolean);
          if(criterios.length<1||criterios.length>5||criterios.some(x=>x.length<12||x.length>320)||new Set(criterios).size!==criterios.length){
            msg('Escribe entre 1 y 5 criterios distintos, de 12 a 320 caracteres cada uno.',true);rules.focus();return;
          }
          run.disabled=true;run.textContent='Analizando (puede tardar)...';
          try{const result=await api(`${endpoint}/analizar`,{criterios});msg(`Análisis #${result.id} registrado. ${result.hallazgos.length} hallazgo(s) preliminar(es).`);await renderHistory(card,endpoint);}finally{run.textContent=runLabel;}
        }));card.append(run);
      }
      card.append(button('Consultar análisis previos',()=>perform(()=>renderHistory(card,endpoint))));
    }
    if(!count)area.append(n('p','Todavía no hay versiones documentales para analizar.'));
  }
  async function renderHistory(card,endpoint){
    const current=project,version=loadVersion;
    card.querySelector('.g3-history')?.remove();
    const history=n('section',undefined,'g3-history');card.append(history);
    history.append(n('p','Consultando análisis anteriores…','g1-muted'));
    const data=await api(`${endpoint}/analisis`);
    if(project!==current||version!==loadVersion)return;
    history.replaceChildren();
    if(!data.analisis.length){history.append(n('p','No existen análisis previos.'));return;}
    for(const a of data.analisis){
      const box=n('div',undefined,'g1-panel');
      box.append(n('strong',`Análisis #${a.id} · ${a.estado} · ${a.modelo}`));
      if(a.advertencia)box.append(n('p',`Advertencia: ${a.advertencia}`,'g1-muted'));
      if(a.errorCodigo)box.append(n('p',`Error: ${a.errorCodigo}`,'g1-muted'));
      if(a.estado==='LISTO'&&!a.hallazgos.length)box.append(n('p','Sin citas que fundamenten hallazgos; esto NO demuestra cumplimiento.','g1-muted'));
      for(const h of a.hallazgos){
        const line=n('div',undefined,'g1-card');
        line.append(n('strong',`${h.estado} · página ${h.pagina}`),n('p',`Criterio: ${h.criterio}`),n('p',h.observacion),n('p',`Cita verificada: «${h.cita}»`,'g1-muted'),n('p',`Sugerencia: ${h.sugerencia}`));
        if(isConsultant()&&h.estado==='PENDIENTE'&&project.estado==='ACTIVO'){
          const reason=n('textarea');reason.placeholder='Motivo profesional, mínimo 12 caracteres';reason.maxLength=1200;line.append(reason);
          for(const [decision,label] of [['CONFIRMADO','Confirmar'],['DESCARTADO','Descartar']])line.append(button(label,()=>perform(async()=>{
            if(reason.value.trim().length<12){msg('Explica tu decisión con al menos 12 caracteres.',true);reason.focus();return;}
            await api(`/ia/hallazgos/${h.id}/revisar`,{decision,motivo:reason.value});msg('Revisión profesional registrada.');await renderHistory(card,endpoint);
          })));
        }
        box.append(line);
      }
      history.append(box);
    }
  }
  document.addEventListener('iso:g2:proyecto',event=>{
    project=event.detail.proyecto;user=event.detail.usuario;loadVersion++;
    root.classList.remove('g1-hide');
    perform(load);
  });
})();
