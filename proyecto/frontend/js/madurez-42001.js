/* Análisis orientativo local, sin dictamen, sin guardar en el servidor y sin datos ficticios en el UI. */
(() => {
  'use strict';
  if (!document.getElementById('maturityQuestions')) return;
  const api = window.ISO;
  const model = window.NexoMaturityModel;
  const answers = new Map();
  let questions = [];
  let financeVersion = 0;
  const $ = id => document.getElementById(id);
  const node = (tag, text, attributes = {}) => {
    const element = document.createElement(tag);
    if (text !== null && text !== undefined) element.textContent = String(text);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  };
  function progress() {
    const current = model.summary(questions, answers);
    $('maturityProgress').textContent = `${current.completed} de ${questions.length} respondidas${current.invalidNA ? ` · ${current.invalidNA} N/A sin justificación suficiente` : ''} (sin calificación automática)`;
    $('maturityMeter').max = questions.length || 1;
    $('maturityMeter').value = current.completed;
    return current;
  }
  function render() {
    const root = $('maturityQuestions');
    root.replaceChildren();
    const indexRoot = $('maturityIndex');
    indexRoot.replaceChildren();
    let domain = '';
    let sectionNumber = 0;
    questions.forEach((q, index) => {
      if (q.dominio !== domain) {
        domain = q.dominio;
        const id = `maturity-domain-${++sectionNumber}`;
        root.append(node('h3', domain, {id}));
        const jump = node('a', domain, {href:`#${id}`});
        indexRoot.append(jump);
      }
      const field = node('fieldset');
      field.className = 'maturity-question';
      field.append(node('legend', `${q.id} · ${q.pregunta}`));
      field.append(node('p', `Evidencia sugerida: ${q.evidenciaSugerida}`, {'class':'g1-muted'}));
      const prefix = `maturity-${index}`;
      const select = node('select', null, {'id':`${prefix}-level`});
      for (const [value, label] of [
        ['', 'Sin responder'], ['0', '0 · No identificada'], ['1', '1 · Inicial'],
        ['2', '2 · Parcialmente documentada'], ['3', '3 · Aplicada y verificada'],
        ['4', '4 · Medida y mejorada'], ['NA', 'No aplica (justificar)'],
      ]) {
        const option = node('option', label); option.value = value; select.append(option);
      }
      const evidence = node('input', null, {
        'id':`${prefix}-evidence`, 'type':'text', 'maxlength':'180',
        'placeholder':'Referencia de evidencia (sin datos sensibles)',
      });
      const reason = node('textarea', null, {
        'id':`${prefix}-reason`, 'rows':'2', 'maxlength':'500',
        'placeholder':'Justificación, brecha o comentario',
        'aria-describedby':`${prefix}-hint`,
      });
      const hint = node('p', 'Si eliges «No aplica», explica el motivo con al menos 10 caracteres.', {
        'id':`${prefix}-hint`, 'class':'g1-muted maturity-hint',
      });
      const state = model.normalizeAnswer(answers.get(q.id));
      select.value = state.valor; evidence.value = state.evidencia; reason.value = state.justificacion;
      function check() {
        const answer = {
          valor:select.value, evidencia:evidence.value.trim(), justificacion:reason.value.trim(),
        };
        answers.set(q.id, answer);
        const invalid = answer.valor === 'NA' && !model.isComplete(answer);
        reason.setAttribute('aria-invalid', String(invalid));
        hint.classList.toggle('maturity-hint-error', invalid);
        progress();
      }
      select.addEventListener('change', check);
      evidence.addEventListener('input', check);
      reason.addEventListener('input', check);
      const control = (label, id, input) => {
        field.append(node('label', label, {'for': id}), input);
      };
      control('Nivel observado', `${prefix}-level`, select);
      control('Referencia', `${prefix}-evidence`, evidence);
      control('Justificación', `${prefix}-reason`, reason);
      field.append(hint);
      root.append(field);
    });
    progress();
  }
  async function projects() {
    const select = $('maturityProject');
    try {
      const response = await api.api('/proyectos');
      const rows = Array.isArray(response) ? response : response?.proyectos;
      if (!Array.isArray(rows)) throw new Error('Formato inesperado de proyectos.');
      const options = rows.filter(p => p.normaCodigo === 'ISO_42001' && p.edicionNormativa === '2023');
      for (const project of options) {
        const option = node('option', project.nombre || `Proyecto ${project.id}`);
        option.value = String(project.id); select.append(option);
      }
      $('maturityProjectState').textContent = options.length
        ? 'Selecciona un expediente ISO/IEC 42001 autorizado. El borrador local no se agrega automáticamente al expediente.'
        : 'No hay proyectos ISO/IEC 42001 accesibles. Puedes responder un borrador orientativo sin asociar un expediente.';
    } catch {
      $('maturityProjectState').textContent = 'No se pudieron consultar proyectos. No se presupone acceso ni existencia de expedientes.';
    }
  }
  $('maturityProject').addEventListener('change', () => {
    financeVersion++;
    $('financeBox').hidden = !$('maturityProject').value;
    $('financeCheck').disabled = false;
    $('financeStatus').textContent = '';
    $('financeAlerts').replaceChildren();
  });
  $('financeCheck').addEventListener('click', async () => {
    const id = $('maturityProject').value;
    if (!/^\d+$/.test(id)) return;
    const request = ++financeVersion;
    const button = $('financeCheck');
    button.disabled = true;
    $('financeStatus').textContent = 'Consultando la fuente financiera configurada…';
    $('financeAlerts').replaceChildren();
    try {
      const result = await api.api(`/proyectos/${id}/42001/recursos-financieros`);
      if (request !== financeVersion || id !== $('maturityProject').value) return;
      $('financeStatus').textContent = `Estado: ${result.estado}. Fuente: ${result.fuente || 'no configurada'}. Sin conclusión automática.`;
      for (const item of (Array.isArray(result.alertas) ? result.alertas : [])) {
        $('financeAlerts').append(node('li', `${item.nivel}: ${item.mensaje}`));
      }
    } catch {
      if (request === financeVersion) $('financeStatus').textContent = 'No es posible obtener datos financieros autorizados. No se presume suficiencia de recursos.';
    } finally {
      if (request === financeVersion) button.disabled = false;
    }
  });
  $('maturityExport').addEventListener('click', () => {
    if (!questions.length) {
      $('maturityFeedback').textContent = 'El cuestionario no está disponible para exportación.';
      return;
    }
    const assessment = model.exportDraft(questions, answers, $('maturityProject').value);
    const content = JSON.stringify(assessment, null, 2);
    const href = URL.createObjectURL(new Blob([content], {type:'application/json'}));
    const link = document.createElement('a');
    link.href = href; link.download = 'madurez-42001-borrador.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    $('maturityFeedback').textContent = `Borrador local exportado: ${assessment.conteo.completas} completas y ${assessment.conteo.pendientes} pendientes. Sin envío al servidor, firma ni validación normativa.`;
  });
  $('maturityClear').addEventListener('click', () => {
    if (!confirm('¿Descartar las respuestas de esta sesión?')) return;
    answers.clear(); render();
    $('maturityFeedback').textContent = 'Se descartaron las respuestas locales.';
  });
  fetch('../data/madurez-42001.json', {cache:'no-store'})
    .then(response => { if (!response.ok) throw new Error(); return response.json(); })
    .then(data => {
      if (data.aprobado !== false || !Array.isArray(data.preguntas) ||
          !data.preguntas.every(q => typeof q.id === 'string' && typeof q.dominio === 'string' &&
            typeof q.pregunta === 'string' && typeof q.evidenciaSugerida === 'string') ||
          new Set(data.preguntas.map(q => q.id)).size !== data.preguntas.length) throw new Error();
      questions = data.preguntas; render();
    })
    .catch(() => { $('maturityFeedback').textContent = 'Instrumento orientativo no disponible o inválido.'; });
  void projects();
})();
