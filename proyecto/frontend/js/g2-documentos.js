// G2: gestion documental por proyecto. La autoridad real se verifica en el backend.
(() => {
  const $ = id => document.getElementById(id);
  const client = window.ISO;
  const reviewUI = window.NexoDocumentReviewUI;
  const followupUI = window.NexoDocumentFollowupUI;
  const verificationUI = window.NexoVerificationUI;
  const token = client.getToken();
  if (!token || !$('g2Area')) return;
  let project = null, user = null, consultor = false, lider = false;
  let activities = null, deliveriesCache = [];
  let pendingAffectedReport = null;
  let docState = 'TODAS', docSearch = '', docOrder = 'prioridad', docOnlyMine = false;
  let docCards = new Map(), docLoaded = false, refreshId = 0;
  // La vista previa usa un Blob temporal recibido por API con sesión autenticada.
  // Se libera al cerrar o cambiar de expediente, sin cachear ni compartir enlaces.
  let pdfRequestId = 0, pdfObjectUrl = null, pdfDownloadAction = null;
  const pdfDialog = $('g2PdfPreviewDialog');
  const pdfFrame = $('g2PdfPreviewFrame');
  function releasePdf() {
    ++pdfRequestId;
    pdfFrame.removeAttribute('src');
    pdfFrame.hidden = true;
    if (pdfObjectUrl) URL.revokeObjectURL(pdfObjectUrl);
    pdfObjectUrl = null;
    pdfDownloadAction = null;
  }
  pdfDialog.addEventListener('close', releasePdf);
  $('g2PdfPreviewClose').addEventListener('click', () => pdfDialog.close());
  $('g2PdfPreviewDownload').addEventListener('click', () => { if (pdfDownloadAction) pdfDownloadAction(); });
  async function previewPdf(delivery, version) {
    if (!project || !version?.id) return;
    const current = project;
    const sequence = ++pdfRequestId;
    const uri = `/entregables/${delivery.id}/versiones/${version.id}/descargar`;
    if (pdfObjectUrl) { pdfFrame.removeAttribute('src'); URL.revokeObjectURL(pdfObjectUrl); pdfObjectUrl=null; }
    pdfFrame.hidden = true;
    $('g2PdfPreviewTitle').textContent = `${delivery.titulo} · Versión ${version.numero}`;
    $('g2PdfPreviewStatus').textContent = 'Descargando la versión autorizada para consulta…';
    pdfDownloadAction = () => download(uri, version.nombreOriginal);
    if (!pdfDialog.open) pdfDialog.showModal();
    try {
      const blob = await req(uri, {binary:true});
      if (sequence !== pdfRequestId || project !== current || !pdfDialog.open) return;
      const url = URL.createObjectURL(blob);
      pdfObjectUrl = url;
      pdfFrame.src = url;
      pdfFrame.hidden = false;
      $('g2PdfPreviewStatus').textContent = 'Versión cargada. Revisa su contenido antes de tomar una decisión. Si no se visualiza, descarga el PDF.';
    } catch (error) {
      if (sequence === pdfRequestId && project === current && pdfDialog.open)
        $('g2PdfPreviewStatus').textContent = `No fue posible mostrar el PDF: ${error.message}. Puedes intentar descargarlo.`;
    }
  }
  function uploadContext() {
    return {active:project?.estado==='ACTIVO', role:user?.rol, userId:user?.id,
      companyUserId:project?.empresa?.usuarioId, consultor, lider};
  }
  function myCorrection(delivery) {
    return followupUI.needsMyCorrection(delivery, activities?.get(Number(delivery.actividadId)), uploadContext());
  }
  function updateDocumentWorkspace() {
    if (!docLoaded || !project) return;
    const totals = reviewUI.counts(deliveriesCache);
    $('g2DocumentLoading').textContent = '';
    for (const button of $('g2Area').querySelectorAll('[data-doc-state]')) {
      const state = button.dataset.docState;
      button.setAttribute('aria-pressed', String(state === docState));
      button.querySelector('[data-doc-count]').textContent = String(totals[state] || 0);
    }
    const ownedCount = deliveriesCache.filter(myCorrection).length;
    const ownedControl = $('g2MyCorrectionsRow');
    ownedControl.hidden = !activities || !project || project.estado !== 'ACTIVO' || !(user?.rol === 'EMPRESARIO' || (consultor && !lider));
    $('g2MyCorrectionsCount').textContent = `(${ownedCount})`;
    $('g2MyCorrections').checked = docOnlyMine;
    const matching = docOnlyMine ? deliveriesCache.filter(myCorrection) : deliveriesCache;
    const displayed = reviewUI.visible(matching, {state: docState, search: docSearch, order: docOrder});
    const shown = new Set(displayed.map(d => String(d.id)));
    const root = $('g2Entregables');
    // Mover tarjetas existentes conserva formularios, PDF seleccionados, details y listeners.
    for (const item of displayed) {
      const card = docCards.get(String(item.id));
      if (card) { card.hidden = false; root.append(card); }
    }
    for (const [id, card] of docCards) {
      if (!shown.has(id)) { card.hidden = true; root.append(card); }
    }
    $('g2DocumentEmpty').hidden = !deliveriesCache.length || displayed.length > 0;
    $('g2DocumentEmpty').textContent = docOnlyMine ?
      'No hay correcciones asignadas pendientes de nuevo PDF con estos filtros. Las versiones ya enviadas aparecen en «Pendientes de revisión».' :
      'No hay entregables que coincidan con estos filtros.';
    $('g2DocumentSummary').textContent = `${displayed.length} de ${totals.TODAS} entregables visibles · ${totals.CORRECCION_REQUERIDA} con corrección solicitada · ${totals.PENDIENTE} pendientes de revisión.${docOnlyMine?' Filtro de mis correcciones activo.':''}`;
  }
  $('g2Area').querySelectorAll('[data-doc-state]').forEach(button => {
    button.addEventListener('click', () => { docState = button.dataset.docState; updateDocumentWorkspace(); });
  });
  $('g2DocumentSearch').addEventListener('input', event => {
    docSearch = event.target.value; updateDocumentWorkspace();
  });
  $('g2DocumentOrder').addEventListener('change', event => {
    docOrder = event.target.value; updateDocumentWorkspace();
  });
  $('g2MyCorrections').addEventListener('change', event => {
    docOnlyMine = event.target.checked; updateDocumentWorkspace();
  });
  $('g2ClearDocumentFilters').addEventListener('click', () => {
    docState = 'TODAS'; docSearch = ''; docOrder = 'prioridad'; docOnlyMine = false;
    $('g2DocumentSearch').value = '';
    $('g2DocumentOrder').value = 'prioridad';
    $('g2MyCorrections').checked = false;
    updateDocumentWorkspace();
  });
  function el(tag, value, cls) {
    const node = document.createElement(tag);
    if (value != null) node.textContent = String(value);
    if (cls) node.className = cls;
    return node;
  }
  function show(message, bad=false) {
    const target = $('g2Status');target.textContent=message;
    target.className=`g1-alert ${bad?'error':'ok'}`;
  }
  async function req(endpoint, {form, data, method='GET', binary=false}={}) {
    const body=form || (data ? JSON.stringify(data) : undefined);
    const projectId=project?.id;
    if(!projectId)throw Error('Selecciona primero un expediente.');
    return client.api(`/proyectos/${projectId}${endpoint}`,{method,body,binary});
  }
  function fields(form) { return Object.fromEntries(new FormData(form).entries()); }
  // Un fallo de escritura se comunica junto al formulario que lo originó.
  // La edición posterior retira el aviso anterior; no borra los valores introducidos.
  const feedbackBound = new WeakSet();
  function feedback(form, message) {
    if (!form || !form.isConnected) return;
    form.querySelector('.form-operation-feedback')?.remove();
    const note=el('p',message,'form-operation-feedback error');
    note.setAttribute('role','alert');
    note.tabIndex=-1;
    form.prepend(note);
    note.focus({preventScroll:true});
    if (!feedbackBound.has(form)) {
      feedbackBound.add(form);
      const clear=()=>form.querySelector('.form-operation-feedback')?.remove();
      form.addEventListener('input',clear);
      form.addEventListener('change',clear);
    }
  }
  async function run(job, form=null) {
    if(!project)return;
    const submit=form?.querySelector('[type=submit],button:not([type])');
    const finish=window.NexoOperationUI.begin(form,submit,'Guardando…');
    if(!finish)return;
    form?.querySelector('.form-operation-feedback')?.remove();
    const current=project;
    try {
      await job();
      if(project!==current)return;
      show('Operación registrada. Actualizando documentos…');
      const refreshed=await refresh();
      if(project!==current || refreshed===null)return;
      if(refreshed){
        show('Operación registrada y documentos actualizados.');
        document.dispatchEvent(new CustomEvent('iso:g2:actualizado',{detail:{proyectoId:current.id}}));
      }else show('Operación registrada, pero no se pudo actualizar la bandeja. Vuelve a abrir el expediente para consultar el estado más reciente.',true);
    }catch(error){
      if(project===current){show(error.message,true);feedback(form,error.message);}
    }finally{finish();}
  }
  async function download(uri, filename) {
    const current=project;
    try {
      const blob=await req(uri,{binary:true});
      if(project!==current)return;
      const url=URL.createObjectURL(blob);
      const anchor=el('a');anchor.href=url;anchor.download=filename||'documento.pdf';
      document.body.append(anchor);anchor.click();anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),2000);
    } catch(error) {if(project===current)show(error.message,true)}
  }
  function action(label, handler) {
    const b=el('button',label);b.type='button';b.addEventListener('click',handler);return b;
  }
  function card(parent, name, info) {
    const box=el('article',null,'g1-card');box.append(el('h3',name),el('p',info,'g1-muted'));parent.append(box);return box;
  }
  function renderDeliveries(rows) {
    const root=$('g2Entregables');root.replaceChildren();docCards = new Map();
    if (!rows.length)root.append(el('p','Todavía no hay entregables registrados.'));
    for (const e of rows) {
      const box=card(root,`#${e.id} · ${e.titulo}`,`Actividad #${e.actividadId} · ${e.versiones?.length||0} versión(es) · Criterio: ${e.criterio}`);
      box.classList.add('document-card');
      docCards.set(String(e.id), box);
      const reviewState=reviewUI.reviewState(e);
      const stateLine=el('div',null,'document-review-summary');
      const stateLabel=el('span',reviewUI.LABELS[reviewState],`document-review-state document-review-${reviewState.toLowerCase()}`);
      stateLine.append(stateLabel,el('p',reviewUI.description(e),'g1-muted'));
      box.append(stateLine);
      const versions=e.versiones||[];
      const last=versions[0];
      const followUp = followupUI.followUp(e);
      if (followUp) {
        const notice = el('section',null,`document-followup document-followup-${followUp.kind}`);
        notice.append(el('strong',followUp.heading),el('p',followUp.message));
        if (followUp.kind === 'resubmitted' && followUp.observation) {
          const previous = el('details',null,'document-prior-feedback');
          previous.append(el('summary',`Ver observación de versión ${followUp.reference.numero}`),
            el('p',followUp.observation));
          notice.append(previous);
        }
        box.append(notice);
      }
      if (last) {
        const coLabel={NO_DECLARADA:'No declarada',DECLARADA:'Declarada; pendiente de confirmación',
          CONFIRMADA:'Confirmada',RECHAZADA:'Rechazada; requiere aclaración en nueva versión'};
        box.append(el('p',`Versión actual: ${last.numero} · ${last.estadoRevision} · Coelaboración: ${coLabel[last.estadoCoelaboracion]||'No declarada'}`,'g1-muted'));
        if (last.revision?.observacion) {
          const note = el('section',null,'document-observation');
          note.append(el('strong','Observación de la última revisión'),el('p',last.revision.observacion));
          box.append(note);
        }
        const quickActions=el('div',null,'document-quick-actions');
        quickActions.append(action(`Consultar versión ${last.numero} (PDF)`,()=>previewPdf(e,last)),
          action('Descargar versión actual',()=>download(`/entregables/${e.id}/versiones/${last.id}/descargar`,last.nombreOriginal)));
        box.append(quickActions);
        // El backend lista TODAS las versiones, no solo la última. Cada PDF es recuperable
        // por ID y se descarga tras autenticar y comprobar acceso en la API.
        const history=el('details',null,'document-history');
        const summary=el('summary',`Historial documental (${versions.length} versión(es))`);
        history.append(summary);
        for (const version of versions) {
          const row=el('div',null,'document-version');
          const info=el('div');
          info.append(el('strong',`Versión ${version.numero} · ${version.estadoRevision}`),
            el('p',`Archivo: ${version.nombreOriginal||'Documento PDF'}`,'g1-muted'),
            el('p',`SHA-256: ${version.sha256||'no disponible'}`,'g1-muted'));
          if(version.estadoCoelaboracion && version.estadoCoelaboracion!=='NO_DECLARADA')
            info.append(el('p',`Coelaboración: ${coLabel[version.estadoCoelaboracion]||version.estadoCoelaboracion} · Consultor #${version.consultorCoautorId||'?'} · ${version.observacionCoelaboracion||''}`,'g1-muted'));
          if(version.revision)info.append(el('p',`Revisión: ${version.revision.resultado||version.estadoRevision}. ${version.revision.observacion||'Sin observaciones'}`,'g1-muted'));
          const versionActions=el('div',null,'document-version-actions');
          versionActions.append(action(`Consultar versión ${version.numero}`,()=>previewPdf(e,version)),
            action(`Descargar versión ${version.numero}`,()=>download(`/entregables/${e.id}/versiones/${version.id}/descargar`,version.nombreOriginal)));
          row.append(info,versionActions);
          history.append(row);
        }
        box.append(history);
      }
      const responsible=activities?.get(Number(e.actividadId));
      const canUpload = followupUI.mayUpload(responsible, uploadContext());
      const clientOwnTask=canUpload && responsible?.tipoResponsable==='CLIENTE';
      const consultantOwnTask=canUpload && responsible?.tipoResponsable==='CONSULTORA';
      // DEC-Q56: una declaración pendiente del consultor retirado se conserva
      // intacta. Solo un nuevo PDF con aclaración explícita permite seguir.
      const retiradoSinResponder=last?.estadoCoelaboracion==='DECLARADA' &&
        last?.estadoRevision==='PENDIENTE' && !!last.consultorCoautorId &&
        (!project.participaciones.some(p=>p.usuarioId===last.consultorCoautorId) ||
         (responsible?.consultorRevisorId && responsible.consultorRevisorId!==last.consultorCoautorId));
      const reemplazoAsignado=!!responsible?.consultorRevisorId &&
        responsible.consultorRevisorId!==last?.consultorCoautorId &&
        project.participaciones.some(p=>p.usuarioId===responsible.consultorRevisorId && p.usuario?.activo!==false);
      if(retiradoSinResponder)box.append(el('p',
        'Q-56: la declaración del anterior encargado permanece sin confirmar. ' +
        (reemplazoAsignado ? 'La empresa debe adjuntar una nueva versión aclarada; la anterior queda en el historial.' :
         'El principal debe designar un nuevo encargado antes de recibir una versión aclarada.'),
        'inline-alert error'));
      if (canUpload) {
        const panel=el('details',null,'document-upload-panel');
        const correction=reviewState==='CORRECCION_REQUERIDA';
        panel.append(el('summary', correction ? 'Presentar PDF corregido' : last ? 'Presentar nueva versión del PDF' : 'Presentar primera versión del PDF'));
        // Mantener visible el siguiente paso cuando el revisor solicitó una corrección.
        panel.open=correction;
        const form=el('form',null,'g1-form');
        form.append(el('p', correction ?
          'Antes de enviar: revisa la observación, modifica el documento y adjunta el PDF actualizado. La nueva versión no borra la anterior.' :
          'Adjunta el PDF. El sistema asigna el número de versión y conserva el historial.', 'document-upload-hint'));
        const label=el('label',correction ? 'PDF corregido (máximo 10 MB)' : 'Entregar nueva versión (PDF, máximo 10 MB)');
        const input=el('input');input.type='file';input.name='archivo';input.accept='application/pdf,.pdf';input.required=true;
        label.append(input);
        const selected = el('p','Ningún archivo seleccionado.','document-file-selection');
        selected.setAttribute('role','status');selected.setAttribute('aria-live','polite');
        input.addEventListener('change',()=>{
          const file=input.files?.[0];
          selected.textContent=file ? `${file.name} · ${(file.size/1024/1024).toFixed(2)} MB` : 'Ningún archivo seleccionado.';
        });
        form.append(label,selected);
        if(clientOwnTask) {
          const co=el('label');
          const checkbox=el('input');checkbox.type='checkbox';checkbox.name='coelaboracion';checkbox.value='SI';
          co.append(checkbox,document.createTextNode(' Este documento fue elaborado conjuntamente con el consultor encargado'));
          form.append(co);
          form.append(el('p',responsible?.consultorRevisorId
            ? `Si declaras coelaboración, el consultor #${responsible.consultorRevisorId} deberá confirmarla y el principal revisará el documento.`
            : 'Todavía no se ha designado consultor revisor. Solicita su designación al principal antes de declarar coelaboración.','g1-muted'));
        }
        if(clientOwnTask && retiradoSinResponder){
          const clarificationLabel=el('label','Aclaración de nueva versión (obligatoria por retiro del consultor)');
          const explanation=el('textarea');explanation.name='aclaracionCoelaboracion';
          explanation.required=true;explanation.maxLength=2000;explanation.rows=3;
          explanation.placeholder='Explica qué se corrigió y cómo se declara ahora la participación en este documento';
          clarificationLabel.append(explanation);form.append(clarificationLabel);
        }
        const submit=el('button',correction ? 'Enviar versión corregida a revisión' : 'Subir versión');
        if(clientOwnTask && retiradoSinResponder && !reemplazoAsignado){
          submit.disabled=true;submit.title='Primero debe designarse un nuevo encargado';
        }
        form.append(submit);
        form.addEventListener('submit',event=>{event.preventDefault();
          const file=input.files?.[0];
          if(!file||file.size>10*1024*1024||!file.name.toLowerCase().endsWith('.pdf')){
            show('Selecciona un PDF válido de hasta 10 MB.',true);return;
          }
          if(!form.reportValidity())return;
          run(async()=>{
            const fd=new FormData(form);
            if(!fd.has('coelaboracion'))fd.set('coelaboracion','NO');
            await req(`/entregables/${e.id}/versiones`,{method:'POST',form:fd});form.reset();
          },form);
        });panel.append(form);box.append(panel);
      }
      // Q-55: solamente el consultor señalado por el representante confirma/rechaza.
      if(consultor && !lider && last?.estadoCoelaboracion==='DECLARADA' &&
          last?.consultorCoautorId===user.id && last.estadoRevision==='PENDIENTE' &&
          responsible?.consultorRevisorId===user.id && project.estado==='ACTIVO') {
        const form=el('form',null,'g1-form');
        form.append(el('p','La empresa declaró coelaboración contigo. Confirma o rechaza antes de enviar a revisión del principal.'));
        const l=el('label','Decisión sobre la coelaboración');const choice=el('select');choice.name='decision';
        for(const [value,title] of [['CONFIRMADA','Confirmar participación'],['RECHAZADA','Rechazar participación']]) {
          const op=el('option',title);op.value=value;choice.append(op);
        }l.append(choice);
        const obsLabel=el('label','Observación (obligatoria al rechazar)');
        const obs=el('textarea');obs.name='observacion';obs.maxLength=2000;obs.rows=2;obsLabel.append(obs);
        const save=el('button','Registrar respuesta');form.append(l,obsLabel,save);
        form.addEventListener('submit',event=>{event.preventDefault();
          if(choice.value==='RECHAZADA'&&!obs.value.trim()) {show('Explica el desacuerdo antes de rechazar.',true);obs.focus();return;}
          run(()=>req(`/entregables/${e.id}/versiones/${last.id}/coelaboracion`,{method:'POST',data:fields(form)}),form);
        });box.append(form);
      }
      // El backend solo permite revisar la versión actual y aún pendiente.
      if (consultor && last?.estadoRevision==='PENDIENTE' && project.estado==='ACTIVO' &&
          last.subidoPorId!==user.id && (
            (responsible?.tipoResponsable==='CLIENTE' && (
              (last.estadoCoelaboracion==='CONFIRMADA' && lider && last.consultorCoautorId!==user.id) ||
              ((!last.estadoCoelaboracion || last.estadoCoelaboracion==='NO_DECLARADA') &&
               !lider && responsible.consultorRevisorId===user.id)
            )) || (responsible?.tipoResponsable==='CONSULTORA' && lider))) {
        const panel=el('details',null,'document-review-panel');
        panel.append(el('summary',`Revisar versión ${last.numero} · decisión pendiente`));
        const form=el('form',null,'g1-form');
        form.append(el('p',`Versión ${last.numero} de ${last.nombreOriginal||'documento PDF'} · Revisa el criterio del entregable y el archivo antes de decidir.`, 'g1-muted'));
        form.append(action(`Consultar PDF de versión ${last.numero}`,()=>previewPdf(e,last)));
        const label=el('label','Decisión documental');const choice=el('select');choice.name='resultado';choice.required=true;
        const placeholder=el('option','Selecciona una decisión');placeholder.value='';placeholder.disabled=true;choice.append(placeholder);
        for (const [value,title] of [['ACEPTADA','Aceptar documentalmente'],['CORRECCION_REQUERIDA','Solicitar correcciones']]) {
          const opt=el('option',title);opt.value=value;choice.append(opt);
        }
        choice.value='';label.append(choice);
        const guidance=el('p','Selecciona una decisión tras revisar el PDF. La verificación de implementación se realiza por separado.','document-decision-guidance');
        guidance.setAttribute('role','status');guidance.setAttribute('aria-live','polite');
        const obsLabel=el('label','Observación de la revisión');
        const obs=el('textarea');obs.name='observacion';obs.maxLength=5000;obs.rows=4;
        obs.placeholder='Indica los hallazgos y qué debe corregirse, si corresponde.';obsLabel.append(obs);
        function syncDecision() {
          obs.required=choice.value==='CORRECCION_REQUERIDA';
          guidance.textContent=reviewUI.decisionGuide(choice.value);
          obsLabel.firstChild.textContent=obs.required?'Observación de la revisión (obligatoria para corrección)':'Observación de la revisión (opcional al aceptar)';
        }
        choice.addEventListener('change',syncDecision);
        const save=el('button','Registrar decisión documental');
        form.append(label,guidance,obsLabel,el('p','La decisión se registra únicamente sobre esta versión vigente; no acredita implementación ni emite certificación.','g1-muted'),save);
        syncDecision();
        form.addEventListener('submit',event=>{event.preventDefault();
          if(!form.reportValidity())return;
          if(choice.value==='CORRECCION_REQUERIDA'&&!obs.value.trim()){
            show('Describe qué debe corregirse antes de guardar la revisión.',true);obs.focus();return;
          }
          run(()=>req(`/entregables/${e.id}/versiones/${last.id}/revisar`,{method:'POST',data:fields(form)}),form);
        });panel.append(form);box.append(panel);
      }
    }
    updateDocumentWorkspace();
  }
  function renderReports(rows) {
    const root=$('g2Informes');root.replaceChildren();
    if (!rows.length)root.append(el('p','Todavía no hay informes publicados.'));
    for (const report of rows) {
      const box=card(root,`Informe interno #${report.numero}`,report.resumen);
      const estado=report.vigenciaDocumental||'VIGENTE';
      box.append(el('p',estado==='REQUIERE_ACTUALIZACION'?'Requiere actualización profesional (SOL-35)':
        estado==='SUSTITUIDO'?`Histórico, sustituido por informe ID ${report.informacionVigencia?.sustituidoPorId||'?'}`:
        'Informe vigente según historial documental; no es certificación oficial.','g1-muted'));
      if(lider && project?.estado==='ACTIVO' && estado==='VIGENTE'){
        box.append(action('Declarar afectación de conclusiones',async()=>{
          pendingAffectedReport={id:report.id,proyectoId:project.id};
          $('reportAffectedContext').textContent=`Informe #${report.numero}`;
          $('reportAffectedForm').reset();const select=$('reportAffectedBreach');select.replaceChildren();
          try{
            const expected=project;
            const brechas=await req('/brechas');if(project!==expected)return;
            for(const b of brechas){const opt=el('option',`#${b.id} · ${b.titulo}`);opt.value=b.id;select.append(opt);}
            $('reportAffectedDialog').showModal();
          }catch(error){show('No se pudo cargar las brechas: '+error.message,true);}
        }));
      }
      const pending=report.instantanea||{};
      box.append(el('p',`Brechas abiertas: ${pending.brechasAbiertas ?? '?'} · Entregables pendientes: ${pending.entregablesPendientes ?? '?'}`,'g1-muted'));
      box.append(action('Descargar informe PDF',()=>download(`/informes-preparacion/${report.id}/pdf`,`informe-preparacion-${report.numero}.pdf`)));
    }
    const pendientes=rows.filter(x=>x.vigenciaDocumental==='REQUIERE_ACTUALIZACION');
    const row=$('g2ReportReplacementRow'),select=$('g2ReportReplacement');
    row.classList.toggle('g1-hide',!pendientes.length);select.required=Boolean(pendientes.length);
    select.replaceChildren();
    if(pendientes.length){const empty=el('option','Selecciona el informe afectado');empty.value='';select.append(empty);}
    for(const r of pendientes){const opt=el('option',`Informe #${r.numero}`);opt.value=r.id;select.append(opt);}
  }
  async function refresh(){
    if(!project)return;
    const current=project, sequence=++refreshId;
    $('g2Entregables').setAttribute('aria-busy','true');
    $('g2DocumentLoading').textContent='Actualizando documentos…';
    try {
      const [deliveries,reports]=await Promise.all([req('/entregables'),req('/informes-preparacion')]);
      if(project!==current || sequence!==refreshId)return null;
      if(!Array.isArray(deliveries)||!Array.isArray(reports))throw Error('La API devolvió datos documentales inválidos.');
      deliveriesCache=deliveries;docLoaded=true;renderDeliveries(deliveries);renderReports(reports);
      document.dispatchEvent(new CustomEvent('iso:g2:entregables', {detail:{proyectoId:current.id, entregables:deliveries}}));
      return true;
    }catch(error){if(project===current && sequence===refreshId){
      $('g2DocumentLoading').textContent='No se pudo actualizar';
      $('g2DocumentSummary').textContent='La información documental no se ha podido actualizar. Reintenta desde el expediente.';
      show(error.message,true);
      document.dispatchEvent(new CustomEvent('iso:g2:entregables-error',{detail:{proyectoId:current.id}}));
    }
    return project===current && sequence===refreshId?false:null;
    }
    finally{if(project===current && sequence===refreshId)$('g2Entregables').setAttribute('aria-busy','false')}
  }
  const verifyForm=$('g2Verificacion');
  const verifyResult=verifyForm.elements.resultado;
  const verifyEvidence=verifyForm.elements.evidencia;
  function syncVerificationEvidence(){
    verifyEvidence.required=verifyResult.value==='VERIFICADA';
    verifyEvidence.setAttribute('aria-required',String(verifyEvidence.required));
    verifyEvidence.placeholder=verifyEvidence.required?'Describe la evidencia observada para una verificación favorable':'Opcional en verificaciones no favorables';
  }
  verifyResult.addEventListener('change',syncVerificationEvidence);
  syncVerificationEvidence();
  verifyForm.addEventListener('reset',()=>queueMicrotask(syncVerificationEvidence));
  const verificationHistory=$('g2VerificationHistory');
  const verificationContext=$('g2VerificationActivityContext');
  let verificationSequence=0, verificationRestoreId='';
  function clearVerificationHistory(message='Selecciona una actividad para consultar antecedentes.') {
    ++verificationSequence;
    verificationHistory.setAttribute('aria-busy','false');
    verificationHistory.replaceChildren(el('p',message,'g1-muted'));
  }
  async function loadVerificationHistory() {
    const sequence=++verificationSequence, current=project;
    const selectedId=verifyForm.elements.actividadId.value;
    const activity=activities?.get(Number(selectedId));
    verificationContext.textContent=verificationUI.selectionMessage(activity || null);
    if (!current || !consultor || current.estado!=='ACTIVO' || !selectedId) {
      clearVerificationHistory(); return;
    }
    verificationHistory.setAttribute('aria-busy','true');
    verificationHistory.replaceChildren(el('p','Consultando antecedentes operativos…','g1-muted'));
    try {
      const entries=await req(`/actividades/${encodeURIComponent(selectedId)}/verificaciones`);
      if (sequence!==verificationSequence || current!==project || verifyForm.elements.actividadId.value!==selectedId)return;
      verificationUI.renderHistory(verificationHistory,entries);
    }catch(error){
      if (sequence===verificationSequence && current===project && verifyForm.elements.actividadId.value===selectedId)
        verificationHistory.replaceChildren(el('p',`No fue posible consultar las verificaciones: ${error.message}`,'inline-alert error'));
    }finally{
      if(sequence===verificationSequence && current===project) verificationHistory.setAttribute('aria-busy','false');
    }
  }
  verifyForm.elements.actividadId.addEventListener('change',loadVerificationHistory);

  $('reportAffectedCancel').addEventListener('click',()=>$('reportAffectedDialog').close());
  $('reportAffectedDialog').addEventListener('close',()=>{pendingAffectedReport=null;});
  $('reportAffectedForm').addEventListener('submit',event=>{
    event.preventDefault();const pending=pendingAffectedReport;
    if(!pending || !project || project.id!==pending.proyectoId){$('reportAffectedDialog').close();return;}
    const brechaId=Number($('reportAffectedBreach').value);
    const justificacion=$('reportAffectedReason').value.trim();
    if(!brechaId || justificacion.length<10)return;
    $('reportAffectedDialog').close();
    run(()=>req(`/informes-preparacion/${pending.id}/afectacion`,{
      method:'POST',data:{brechaId,justificacion}}));
  });
  const forms={
    g2CrearEntregable:form=>{
      const data=fields(form);const actividadId=Number(data.actividadId);delete data.actividadId;
      return req(`/actividades/${actividadId}/entregables`,{method:'POST',data});
    },
    g2Verificacion:form=>{
      const data=fields(form);const actividadId=Number(data.actividadId);delete data.actividadId;
      return req(`/actividades/${actividadId}/verificaciones`,{method:'POST',data});
    },
    g2CerrarBrecha:form=>{
      const data=fields(form);const brechaId=Number(data.brechaId);delete data.brechaId;
      return req(`/brechas/${brechaId}/cerrar`,{method:'POST',data});
    },
    g2PublicarInforme:form=>req('/informes-preparacion',{method:'POST',data:fields(form)}),
  };
  for (const [id,send] of Object.entries(forms)){
    $(id).addEventListener('submit',event=>{
      event.preventDefault();const form=event.currentTarget;
      if(!form.reportValidity())return;
      run(async()=>{
        const current=project;
        const selectedActivity=id==='g2Verificacion'?form.elements.actividadId.value:null;
        await send(form);
        if(project!==current)return;
        form.reset();
        // Mostrar la verificación recién registrada en la actividad consultada,
        // sin tratar el POST como una aprobación documental ni cambiar estados.
        if(selectedActivity){
          form.elements.actividadId.value=selectedActivity;
          form.dispatchEvent(new Event('change',{bubbles:true}));
        }
      },form);
    });
  }
  document.addEventListener('iso:g2:proyecto',event=>{
    // Cambio de expediente: invalidar de inmediato Blob y solicitud en vuelo.
    releasePdf();
    if (pdfDialog.open) pdfDialog.close();
    ++refreshId;
    const sameProject=project && String(project.id)===String(event.detail.proyecto.id);
    verificationRestoreId=sameProject ? verifyForm.elements.actividadId.value : '';
    const preserveOperations=Boolean(sameProject && $('g2Operations').open);
    clearVerificationHistory();
    verifyForm.reset();
    verificationContext.textContent=verificationUI.selectionMessage(null);
    project=event.detail.proyecto;user=event.detail.usuario;activities=null;deliveriesCache=[];docCards.clear();docLoaded=false;
    docState='TODAS';docSearch='';docOrder='prioridad';docOnlyMine=false;
    $('g2DocumentSearch').value='';$('g2DocumentOrder').value='prioridad';$('g2MyCorrections').checked=false;
    $('g2MyCorrectionsRow').hidden=true;
    $('g2DocumentEmpty').hidden=true;
    $('g2DocumentLoading').textContent='Cargando documentos…';
    $('g2DocumentSummary').textContent='Consultando entregables…';
    for(const b of $('g2Area').querySelectorAll('[data-doc-state]')){
      b.setAttribute('aria-pressed', String(b.dataset.docState==='TODAS'));
      b.querySelector('[data-doc-count]').textContent='—';
    }
    consultor=user.rol==='EVALUADOR' && project.participaciones.some(p=>p.usuarioId===user.id);
    lider=consultor && project.participaciones.some(p=>p.usuarioId===user.id&&p.principal);
    $('g2Operations').classList.toggle('g1-hide',!consultor||project.estado!=='ACTIVO');
    $('g2Operations').open=preserveOperations;
    $('g2CrearEntregable').classList.toggle('g1-hide',!consultor||project.estado!=='ACTIVO');
    $('g2Verificacion').classList.toggle('g1-hide',!consultor||project.estado!=='ACTIVO');
    $('g2CerrarBrecha').classList.toggle('g1-hide',!lider||project.estado!=='ACTIVO');
    $('g2PublicarInforme').classList.toggle('g1-hide',!lider||project.estado!=='ACTIVO');
    $('g2Entregables').replaceChildren(el('p','Cargando entregables…','g1-muted'));
    $('g2Informes').replaceChildren();
    refresh();
  });
  // Salto desde la bandeja del principal: busca la tarjeta exacta sin inventar endpoints.
  document.addEventListener('iso:attention:abrir-entregable',event=>{
    if(!project || String(project.id)!==String(event.detail.proyectoId) || !docLoaded)return;
    const id=String(event.detail.entregableId), delivery=deliveriesCache.find(d=>String(d.id)===id);
    if(!delivery)return;
    docState=reviewUI.reviewState(delivery);docSearch='';docOnlyMine=false;
    $('g2DocumentSearch').value='';$('g2MyCorrections').checked=false;
    updateDocumentWorkspace();
    const box=docCards.get(id);
    if(box && !box.hidden){
      $('g2Area').scrollIntoView({block:'start',behavior:'instant'});
      const heading=box.querySelector('h3');
      if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});heading.scrollIntoView({block:'center',behavior:'instant'});}
    }
  });
  document.addEventListener('iso:g2:actividades',event=>{
    if(!project || event.detail.proyectoId!==project.id)return;
    activities=new Map(event.detail.actividades.map(a=>[Number(a.id),a]));
    const select=verifyForm.elements.actividadId;
    if(verificationRestoreId && Array.from(select.options).some(o=>o.value===verificationRestoreId)){
      select.value=verificationRestoreId;
      verificationRestoreId='';
      loadVerificationHistory();
    }else{
      verificationRestoreId='';
      verificationContext.textContent=verificationUI.selectionMessage(activities.get(Number(select.value)) || null);
    }
    renderDeliveries(deliveriesCache);
  });
})();
