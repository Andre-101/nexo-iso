/* Experiencia de captura de actividades: navegación, validación visible y resumen.
 * Sin endpoints, cambios de estado de negocio ni decisiones de autorización.
 */
(function (root, factory) {
  'use strict';
  const ui = factory();
  if (typeof module === 'object' && module.exports) module.exports = ui;
  if (root && root.document) root.NexoTaskFormUI = ui;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';
  const descriptions = [
    'Paso 1 de 3: define la actividad.',
    'Paso 2 de 3: selecciona un responsable y, si corresponde, una fecha.',
    'Paso 3 de 3: confirma la cobertura y revisa el registro.',
  ];
  function selectedLabel(select, empty = 'Sin seleccionar') {
    if (!select || !select.value) return empty;
    return select.selectedOptions?.[0]?.textContent?.trim() || empty;
  }
  function summaryRows(form) {
    const elements = form.elements;
    const breaches = Array.from(elements.brechaIds.selectedOptions || []).map(o => o.textContent.trim());
    const extra = elements.cobertura.value === 'ADICIONAL';
    const rows = [
      ['Actividad', elements.titulo.value.trim() || 'Sin título'],
      ['Brechas', breaches.length ? breaches.join('; ') : 'Sin brechas vinculadas'],
      ['Tipo de responsable', selectedLabel(elements.tipoResponsable)],
      ['Persona responsable', selectedLabel(elements.asignadoAId)],
      ['Fecha objetivo', elements.fechaObjetivo.value || 'Sin fecha definida'],
      ['Cobertura', selectedLabel(elements.cobertura)],
    ];
    if (extra) {
      rows.push(['Acuerdo adicional', selectedLabel(elements.acuerdoAdicionalId)]);
      if (elements.actividadOrigenId.value) rows.push(['Antecedente', selectedLabel(elements.actividadOrigenId)]);
    }
    return rows;
  }
  function invalidControl(step) {
    const fields = step.querySelectorAll('input, select, textarea');
    return Array.from(fields).find(field => !field.disabled &&
      !field.closest('[hidden], .g1-hide') && !field.checkValidity());
  }
  function initTaskWizard(form) {
    if (!form) throw new Error('Falta el formulario de actividades');
    const steps = Array.from(form.querySelectorAll('[data-task-step]'));
    const markers = Array.from(form.querySelectorAll('[data-task-progress]'));
    const previous = form.querySelector('#taskStepPrevious');
    const next = form.querySelector('#taskStepNext');
    const submit = form.querySelector('#taskSubmitButton');
    const notice = form.querySelector('#taskWizardNotice');
    const summary = form.querySelector('#taskWizardSummary');
    if (steps.length !== 3 || markers.length !== 3 || !previous || !next || !submit || !notice || !summary)
      throw new Error('Estructura de creación de actividades incompleta');
    // Cada paso valida sus controles visibles. La validación HTML automática podría
    // intentar enfocar un campo oculto antes de que el usuario llegue al paso final.
    form.noValidate = true;
    let current = 0;
    function buildSummary() {
      summary.replaceChildren();
      const doc = form.ownerDocument;
      for (const [name, value] of summaryRows(form)) {
        const item = doc.createElement('div');
        const dt = doc.createElement('dt'); dt.textContent = name;
        const dd = doc.createElement('dd'); dd.textContent = value;
        item.append(dt, dd); summary.append(item);
      }
    }
    function showStep(number, focus = false) {
      current = Math.max(0, Math.min(steps.length - 1, number));
      steps.forEach((step, i) => { step.hidden = i !== current; });
      markers.forEach((marker, i) => {
        if (i === current) marker.setAttribute('aria-current', 'step');
        else marker.removeAttribute('aria-current');
        marker.dataset.complete = String(i < current);
      });
      previous.hidden = current === 0;
      next.hidden = current === steps.length - 1;
      submit.hidden = current !== steps.length - 1;
      notice.textContent = descriptions[current];
      notice.removeAttribute('data-error');
      if (current === steps.length - 1) buildSummary();
      if (focus) steps[current].querySelector('legend')?.focus();
    }
    function checkStep(i) {
      const field = invalidControl(steps[i]);
      if (!field) return true;
      showStep(i);
      notice.textContent = 'Completa o corrige el campo señalado para continuar.';
      notice.dataset.error = 'true';
      field.focus();
      field.reportValidity();
      return false;
    }
    function advance() {
      if (checkStep(current) && current < steps.length - 1) showStep(current + 1, true);
    }
    previous.addEventListener('click', () => showStep(current - 1, true));
    next.addEventListener('click', advance);
    // Intercepta Enter antes de los controladores de red. No envía el formulario
    // hasta la última etapa, y abre la etapa con el primer campo inválido.
    form.addEventListener('submit', event => {
      if (current < steps.length - 1) {
        event.preventDefault(); event.stopImmediatePropagation(); advance(); return;
      }
      for (let i = 0; i < steps.length; i++) {
        if (!checkStep(i)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      }
      // El controlador preexistente conserva el POST y su validación de backend.
    }, true);
    form.addEventListener('input', () => { if (current === steps.length - 1) buildSummary(); });
    form.addEventListener('change', () => { if (current === steps.length - 1) buildSummary(); });
    form.addEventListener('reset', () => showStep(0));
    showStep(0);
    return { resetView: () => showStep(0), refresh: () => { if (current === steps.length - 1) buildSummary(); }, currentStep: () => current };
  }
  function initVerificationHints(form) {
    if (!form) return { refresh: () => {} };
    const notice = form.querySelector('#g2VerificationGuide');
    const activity = form.elements.actividadId;
    const result = form.elements.resultado;
    if (!notice || !activity || !result) throw new Error('Formulario de verificación incompleto');
    function refresh() {
      const selected = activity.value ? `Actividad: ${selectedLabel(activity)}. ` :
        'Selecciona una actividad en revisión. ';
      const text = {
        VERIFICADA: 'Describe el método y la evidencia que sustenta el resultado.',
        NO_VERIFICADA: 'Describe lo observado y justifica por qué la implementación no está verificada.',
        NO_APLICA: 'Justifica expresamente por qué la verificación no aplica.',
      };
      notice.textContent = selected + (text[result.value] || 'Registra una justificación verificable.') +
        ' Esta verificación es independiente de la aceptación documental.';
    }
    form.addEventListener('change', refresh);
    form.addEventListener('reset', refresh);
    refresh();
    return { refresh };
  }
  return { initTaskWizard, initVerificationHints, summaryRows, selectedLabel, invalidControl };
});
