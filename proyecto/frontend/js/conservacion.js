/* DEC-Q60: sólo ADMIN registra; principal vigente consulta. El backend decide permisos. */
(() => {
  const el = id => document.getElementById(id);
  const section=el('retentionSection'), form=el('retentionForm');
  if (!section || !form) return;
  let projectId=null, expectedId=null, revision=0;
  let isAdmin=false, active=false;
  const node=(tag,value,klass) => { const n=document.createElement(tag);if(value!=null)n.textContent=String(value);if(klass)n.className=klass;return n; };
  const show=(text,problem=false) => {const n=el('retentionCurrent');n.replaceChildren(node('p',text,problem?'inline-alert error':'g1-muted'));};
  async function load(id,serial) {
    show('Consultando condiciones de conservación…');
    try {
      const [data,prevalidacion,termination]=await Promise.all([window.ISO.api(`/proyectos/${id}/conservacion`),window.ISO.api(`/proyectos/${id}/cierre/prevalidacion`).then(value=>({value}),error=>({error})),window.ISO.api(`/proyectos/${id}/cierre/anticipado`).then(value=>({value}),error=>({error}))]);
      if (serial!==revision || id!==projectId) return;
      if (!Array.isArray(data.historial)) throw Error('La API devolvió historial inválido.');
      const closureNode=el('retentionClosureStatus');closureNode.replaceChildren();
      closureNode.append(node('h3','Prevalidación de cierre satisfactorio'));
      if (prevalidacion.error || !Array.isArray(prevalidacion.value?.impedimentos) || prevalidacion.value.elegible !== false) {
        closureNode.append(node('p','No fue posible consultar las condiciones de cierre. Inténtalo más tarde.','inline-alert error'));
      } else {
        for (const item of prevalidacion.value.impedimentos) closureNode.append(node('p',item.mensaje,'g1-muted'));
      }
      closureNode.append(node('p','Esta consulta no cierra el servicio. La terminación anticipada se evalúa por separado.','g1-muted'));
      const current=data.vigente;expectedId=current?.id ?? null;
      const termStatus=el('earlyTerminationStatus'),termForm=el('earlyTerminationForm');
      termStatus.replaceChildren();
      if (termination.error || typeof termination.value?.terminadoAnticipadamente!=='boolean') {
        termStatus.append(node('p','No se pudo comprobar la terminación del servicio. No se permite actuar sin esta verificación.','inline-alert error'));
        termForm.classList.add('g1-hide');
      } else if (termination.value.terminadoAnticipadamente) {
        termStatus.append(node('p','Servicio terminado anticipadamente por abandono; no acredita cierre satisfactorio.'));
        termStatus.append(node('p',`Motivo registrado: ${termination.value.motivo||'No disponible'}`));
        const c=termination.value.comunicacion;
        termStatus.append(node('p',c ? `Constancia de comunicación: ${c.resultado} · ${c.canal||'sin canal aplicable'} · ${c.detalle}` : 'Sin constancia estructurada anterior a Q-63; requiere revisión administrativa.','g1-muted'));
        if (termination.value.avisoInternoRegistrado) termStatus.append(node('p','Aviso interno persistente registrado para el representante. No acredita entrega por canal externo.','g1-muted'));
        termStatus.append(node('p',termination.value.conservacionPendiente
          ? 'OBLIGACIÓN PENDIENTE: ADMIN debe registrar las condiciones contractuales de conservación.'
          : 'Las condiciones contractuales de conservación están registradas.',termination.value.conservacionPendiente?'inline-alert error':'g1-muted'));
        termForm.classList.add('g1-hide');
      } else {
        termStatus.append(node('p','Si la empresa abandona el servicio, ADMIN puede terminarlo con motivo; los pendientes históricos se conservan.','g1-muted'));
        termForm.classList.toggle('g1-hide',!isAdmin || !active);
        const check=termForm.elements.confirmarPendienteConservacion;
        check.checked=false;
        check.required=!current;
        if (!current) termStatus.append(node('p','Falta conservación contractual: para terminar será obligatorio confirmar expresamente la excepción.','inline-alert error'));
      }
      const root=el('retentionCurrent');root.replaceChildren();
      root.append(node('h3','Registro vigente'));
      if (!current) root.append(node('p','Aún no se han registrado condiciones del contrato. No se supone un período predeterminado.','g1-muted'));
      else {
        for (const [label,value] of [['Acuerdo',current.referenciaAcuerdo],['Período pactado',current.periodoPactado],['Condiciones',current.condiciones],['Validación registrada',current.constanciaValidacion],['Registrado por',current.registradoPor?.nombre||`Cuenta #${current.registradoPor?.id||'?'}`],['Fecha',current.creadaEn ? new Date(current.creadaEn).toLocaleString('es-CO') : 'No disponible']])
          root.append(node('p',`${label}: ${value||'No disponible'}`));
      }
      const history=el('retentionHistory');history.replaceChildren();
      if (!data.historial.length) history.append(node('p','Sin versiones registradas.','g1-muted'));
      for (const item of data.historial) {
        const card=node('article',null,'g1-card');card.append(node('h3',`Versión #${item.id}${item.id===expectedId?' · Vigente':''}`));
        for (const [label,value] of [['Acuerdo',item.referenciaAcuerdo],['Período',item.periodoPactado],['Condiciones',item.condiciones],['Constancia',item.constanciaValidacion],['Responsable',item.registradoPor?.nombre||'No disponible']])
          card.append(node('p',`${label}: ${value||'No disponible'}`,'g1-muted'));
        history.append(card);
      }
    }catch(error){if(serial===revision&&projectId===id) {show(error.message,true);el('retentionClosureStatus').textContent='No fue posible verificar las precondiciones de cierre.';}}
  }
  document.addEventListener('iso:q60:proyecto',event=>{
    const {proyecto,usuario}=event.detail;revision++;
    const leader=usuario.rol==='EVALUADOR'&&proyecto.participaciones?.some(x=>x.usuarioId===usuario.id&&x.principal&&x.usuario?.activo!==false);
    const allowed=usuario.rol==='ADMIN'||leader;
    isAdmin=usuario.rol==='ADMIN';active=['ACTIVO','SUSPENDIDO'].includes(proyecto.estado);
    section.classList.toggle('g1-hide',!allowed);
    form.classList.toggle('g1-hide',usuario.rol!=='ADMIN');
    expectedId=null;projectId=allowed?proyecto.id:null;form.reset();el('earlyTerminationForm').reset();
    el('earlyTerminationForm').classList.add('g1-hide');el('earlyTerminationStatus').replaceChildren();
    if (allowed) void load(proyecto.id,revision);
    else {el('retentionCurrent').replaceChildren();el('retentionHistory').replaceChildren();el('retentionClosureStatus').replaceChildren();}
  });
  const communicationResult=el('earlyCommunicationResult');
  const syncCommunication=()=>{
    const notApplicable=communicationResult.value==='NO_APLICA';
    const channel=el('earlyTerminationForm').elements.comunicacionCanal;
    const reference=el('earlyTerminationForm').elements.comunicacionReferencia;
    el('earlyCommunicationChannelRow').classList.toggle('g1-hide',notApplicable);
    el('earlyCommunicationReferenceRow').classList.toggle('g1-hide',notApplicable);
    channel.required=Boolean(communicationResult.value)&&!notApplicable;
    if(notApplicable){channel.value='';reference.value='';}
  };
  communicationResult.addEventListener('change',syncCommunication);
  syncCommunication();
  el('earlyTerminationForm').addEventListener('submit',async event=>{
    event.preventDefault();const termForm=event.currentTarget;
    if (!projectId || !isAdmin || !active || !termForm.reportValidity()) return;
    const id=projectId,serial=revision,submit=termForm.querySelector('[type="submit"]');
    const values=new FormData(termForm);
    // Confirmación de acción irreversible, además de aceptación explícita de excepción cuando corresponde.
    if (!window.confirm('¿Confirmas la terminación anticipada por abandono? El expediente pasará a solo lectura y no se concluirá preparación ISO.')) return;
    submit.disabled=true;
    try {
      const result=await window.ISO.api(`/proyectos/${id}/cierre/anticipado`,{method:'POST',body:JSON.stringify({
        motivo:values.get('motivo'),referenciaAbandono:values.get('referenciaAbandono'),
        confirmarPendienteConservacion:values.has('confirmarPendienteConservacion'),
        comunicacion:{resultado:values.get('comunicacionResultado'),
          canal:values.get('comunicacionResultado')==='NO_APLICA'?null:values.get('comunicacionCanal'),
          referencia:values.get('comunicacionResultado')==='NO_APLICA'?null:values.get('comunicacionReferencia'),
          detalle:values.get('comunicacionDetalle')},
      })});
      if (serial!==revision || id!==projectId) return;
      const feedback=el('feedback');feedback.className='g1-alert ok';
      feedback.textContent=result.conservacionPendiente
        ? 'Terminación registrada. Sigue pendiente registrar las condiciones de conservación del contrato.'
        : 'Terminación anticipada registrada. Se conservará el expediente histórico.';
      // Evita mostrar acciones de edición hasta obtener nuevamente los permisos y el estado del servidor.
      window.location.reload();
    }catch(error){if (serial===revision && id===projectId){
      const feedback=el('feedback');feedback.className='g1-alert error';feedback.textContent=error.message;
      await load(id,revision);
    }}finally{submit.disabled=false;}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if (!projectId||!form.reportValidity()) return;
    const id=projectId,serial=revision,button=form.querySelector('[type="submit"]');
    const data=new FormData(form);button.disabled=true;
    try {
      await window.ISO.api(`/proyectos/${id}/conservacion`,{method:'POST',body:JSON.stringify({
        referenciaAcuerdo:data.get('referenciaAcuerdo'),periodoPactado:data.get('periodoPactado'),
        condiciones:data.get('condiciones'),constanciaValidacion:data.get('constanciaValidacion'),esperadoId:expectedId,
      })});
      if (serial===revision && id===projectId) {
        form.reset(); await load(id,revision);
        const message=el('feedback');message.textContent='Condiciones contractuales registradas con historial.';message.className='g1-alert ok';
      }
    }catch(error){if (serial===revision&&id===projectId){
      await load(id,revision);
      const message=el('feedback');message.textContent=error.message;message.className='g1-alert error';
    }}
    finally{button.disabled=false;}
  });
})();
