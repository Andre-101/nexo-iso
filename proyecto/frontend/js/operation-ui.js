/* Estado visual compartido de escrituras: no decide reglas ni realiza solicitudes.
 * begin() es un cerrojo por formulario y devuelve una función idempotente de limpieza.
 * En operaciones sin formulario se usa la deshabilitación del botón como cerrojo.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.NexoOperationUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';
  const active = new WeakSet();
  function begin(form, control, label = 'Guardando…') {
    if ((form && active.has(form)) || (control && control.disabled)) return null;
    if (form) active.add(form);
    const previous = control ? {disabled:control.disabled, text:control.textContent, ariaDisabled:control.getAttribute('aria-disabled')} : null;
    const busyBefore = form?.getAttribute('aria-busy');
    let notice = null, ended = false;
    if (form) {
      form.setAttribute('aria-busy', 'true');
      notice = form.ownerDocument.createElement('p');
      notice.className = 'form-operation-progress';
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      notice.textContent = label;
      if (control && form.contains(control)) control.insertAdjacentElement('beforebegin', notice);
      else form.append(notice);
    }
    if (control) {
      control.disabled = true;
      control.setAttribute('aria-disabled', 'true');
      control.textContent = label;
    }
    return function finish() {
      if (ended) return;
      ended = true;
      if (form) {
        active.delete(form);
        if (busyBefore === null) form.removeAttribute('aria-busy');
        else form.setAttribute('aria-busy', busyBefore);
      }
      notice?.remove();
      if (control) {
        control.disabled = previous.disabled;
        control.textContent = previous.text;
        if (previous.ariaDisabled === null) control.removeAttribute('aria-disabled');
        else control.setAttribute('aria-disabled', previous.ariaDisabled);
      }
    };
  }
  function isBusy(form) { return Boolean(form && active.has(form)); }
  return {begin, isBusy};
});
