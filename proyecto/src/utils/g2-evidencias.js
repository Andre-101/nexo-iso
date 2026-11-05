// G2: estados independientes. No equivale a auditoria o certificacion ISO.
async function estadoDeActividad(db, proyectoId, actividadId) {
  const [entregables, verificaciones] = await Promise.all([
    db.entregableProyecto.findMany({
      where: { proyectoId, actividadId },
      include: { versiones: { select: { numero: true, estadoRevision: true, creadoEn: true, revision: { select: { revisadoEn: true } } } } },
    }),
    db.verificacionOperativaProyecto.findMany({
      where: { proyectoId, actividadId }, orderBy: [{ verificadoEn: 'desc' }, { id: 'desc' }], take: 1,
    }),
  ]);
  const sinAceptar = entregables.filter(e => !e.versionActual ||
    !e.versiones.some(v => v.numero === e.versionActual && v.estadoRevision === 'ACEPTADA'));
  const ultima = verificaciones[0] || null;
  const fechaUltimaAceptacion = Math.max(0, ...entregables.flatMap(e =>
    e.versiones.filter(v => v.numero === e.versionActual && v.estadoRevision === 'ACEPTADA')
      .map(v => new Date(v.revision?.revisadoEn || v.creadoEn).getTime())));
  const operativaValida = ultima && ['VERIFICADA','NO_APLICA'].includes(ultima.resultado) &&
    new Date(ultima.verificadoEn).getTime() >= fechaUltimaAceptacion;
  return {
    documentos: entregables.length,
    documentosPendientes: sinAceptar.length,
    resultadoOperativo: ultima?.resultado || 'PENDIENTE',
    listaParaCompletar: sinAceptar.length === 0 && Boolean(operativaValida),
  };
}
/**
 * DEC-Q69/Q70/Q71/Q72/Q73: los antecedentes CANCELADA no computan como ejecución.
 * Cada rama de la continuidad debe terminar en actividad COMPLETADA con
 * evidencias válidas. Los vínculos de origen y los eventos Q68 se verifican;
 * una sola anulación auditada acredita el estado CANCELADA del antecedente,
 * no una aprobación ni la ejecución de todas sus sucesoras.
 *
 * No cierra la brecha: el principal debe confirmar expresamente la cobertura
 * de una división de alcance en el cierre G2. Evaluación compartida dentro
 * de las transacciones serializables de propuesta y cierre.
 */
async function evaluarActividadesCierreBrecha(db, proyectoId, brecha) {
  const todos = Array.isArray(brecha?.actividades) ? brecha.actividades : [];
  // Q-73: jamás basta marcar la relación en BD para omitirla: debe existir
  // evento auditado con contrato anterior modificado y aceptación nueva.
  // Se cargan ambos conjuntos en la MISMA transacción de cierre.
  const excluidos = todos.filter(e => e.excluidaEn != null);
  const enlaces = todos.filter(e => e.excluidaEn == null);
  if (excluidos.length) {
    const eventosExclusion = await db.eventoProyecto.findMany({where:{
      proyectoId,accion:'ACTIVIDAD_BRECHA_EXCLUIDA_ALCANCE'},select:{detalle:true}});
    for (const e of excluidos) {
      const valido = eventosExclusion.some(ev => {
        const d = ev?.detalle;
        return d && !Array.isArray(d) && d.actividadId === e.actividadId &&
          d.brechaId === brecha.id && d.exclusionNoEquivaleACumplimiento === true &&
          Number.isSafeInteger(d.acuerdoAnteriorId) && Number.isSafeInteger(d.acuerdoNuevoId) &&
          d.acuerdoAnteriorId !== d.acuerdoNuevoId &&
          typeof d.referenciaCambio === 'string' && d.referenciaCambio.trim().length > 0 &&
          typeof d.referenciaAceptacion === 'string' && d.referenciaAceptacion.trim().length > 0 &&
          typeof d.justificacion === 'string' && d.justificacion.trim().length >= 10;
      });
      if (!valido) return {lista:false,motivo:'Una relación excluida carece de constancia comercial auditada.',
        continuidades:[],ramificaciones:[]};
    }
  }
  if (!enlaces.length) return { lista: false, motivo: 'La brecha no tiene actividades vinculadas.', continuidades: [], ramificaciones: [] };
  const continuidades = [];
  const ramificaciones = [];
  const porId = new Map();
  const hijos = new Map();
  for (const enlace of enlaces) {
    const act = enlace?.actividad;
    const id = enlace?.actividadId;
    if (!Number.isSafeInteger(id) || id <= 0 || !act || act.id !== id || porId.has(id))
      return { lista: false, motivo: 'La brecha contiene vínculos de actividades inválidos o duplicados.', continuidades, ramificaciones };
    porId.set(id, act);
  }
  for (const [id, act] of porId) {
    if (act.actividadOrigenId != null && porId.has(act.actividadOrigenId)) {
      if (!hijos.has(act.actividadOrigenId)) hijos.set(act.actividadOrigenId, []);
      hijos.get(act.actividadOrigenId).push(id);
    }
  }
  for (const ids of hijos.values()) ids.sort((a, b) => a - b);
  // Detectar ciclos aun cuando un eslabón aparezca erróneamente COMPLETADA;
  // los estados de trabajo no validan por sí mismos la topología del origen.
  const colores = new Map();
  function ciclo(id) {
    if (colores.get(id) === 1) return true;
    if (colores.get(id) === 2) return false;
    colores.set(id, 1);
    for (const hijo of hijos.get(id) || []) if (ciclo(hijo)) return true;
    colores.set(id, 2);
    return false;
  }
  for (const id of porId.keys()) {
    if (ciclo(id)) return { lista: false, motivo: 'Se detectó un ciclo en la continuidad de actividades.', continuidades, ramificaciones };
  }
  const eventos = await db.eventoProyecto.findMany({
    where: { proyectoId, accion: { in: ['ACTIVIDAD_ANULADA_CONTINUIDAD', 'ACTIVIDAD_RAMA_RETIRADA_ALCANCE'] } },
    select: { detalle: true },
  });
  // Q68 registra cuál era la sucesora conocida cuando el principal anuló el
  // antecedente. Q71 puede añadir más sucesoras después, pero no permite
  // interpretar el origen cancelado como trabajo realizado.
  const anulacionAuditada = (origenId, sucesoras) => eventos.some(e => {
    const d = e?.detalle;
    return d && !Array.isArray(d) && d.actividadId === origenId &&
      sucesoras.includes(d.actividadSucesoraId) && d.hasta === 'CANCELADA' &&
      d.anulacionNoEquivaleACumplimiento === true &&
      typeof d.justificacion === 'string' && d.justificacion.trim().length >= 10;
  });
  // Q72: una hoja CANCELADA sin sucesora solamente se excluye cuando existe
  // evento explícito creado tras verificar cambio comercial, aceptación externa
  // y exclusión de esa brecha. El evento no acredita cumplimiento.
  const retiradaAuditada = (id, act) => eventos.some(e => {
    const d = e?.detalle;
    return d && !Array.isArray(d) && d.actividadId === id &&
      d.brechaId === brecha.id && d.actividadOrigenId === act.actividadOrigenId && d.hasta === 'CANCELADA' &&
      d.retiroNoEquivaleACumplimiento === true &&
      d.acuerdoAnteriorId === act.acuerdoAdicionalId &&
      Number.isSafeInteger(d.acuerdoNuevoId) &&
      d.acuerdoNuevoId !== d.acuerdoAnteriorId &&
      typeof d.referenciaAceptacion === 'string' && d.referenciaAceptacion.trim().length >= 3 &&
      typeof d.justificacion === 'string' && d.justificacion.trim().length >= 10;
  });
  const verificados = new Map();
  async function completaYVerificada(id) {
    if (porId.get(id)?.estado !== 'COMPLETADA') return false;
    if (!verificados.has(id)) {
      const estado = await estadoDeActividad(db, proyectoId, id);
      verificados.set(id, Boolean(estado.listaParaCompletar));
    }
    return verificados.get(id);
  }
  const resultados = new Map();
  async function resolverCancelada(id, ancestros = new Set()) {
    if (ancestros.has(id)) return { error: 'Se detectó un ciclo en la continuidad de actividades.' };
    if (resultados.has(id)) return resultados.get(id);
    const act = porId.get(id);
    if (!act || act.cobertura !== 'ADICIONAL' || act.estado !== 'CANCELADA')
      return { error: 'Una anulación de la cadena no es una actividad adicional válida.' };
    const sucesoras = hijos.get(id) || [];
    if (!sucesoras.length) {
      if (act.actividadOrigenId != null && porId.has(act.actividadOrigenId) && retiradaAuditada(id, act))
        return { rutas: [], retiradas: [[id]] };
      return { error: 'Una actividad anulada carece de continuidad vinculada a esta brecha o de retiro de alcance autorizado.' };
    }
    if (!anulacionAuditada(id, sucesoras))
      return { error: 'La actividad anulada carece de una sucesora y justificación auditadas.' };
    const proximos = new Set(ancestros); proximos.add(id);
    const rutas = [];
    const retiradas = [];
    for (const siguienteId of sucesoras) {
      const siguiente = porId.get(siguienteId);
      if (!siguiente || siguiente.cobertura !== 'ADICIONAL' || siguiente.actividadOrigenId !== id)
        return { error: 'La rama contiene una sucesora con cobertura o vínculo incorrecto.' };
      if (proximos.has(siguienteId)) return { error: 'Se detectó un ciclo en la continuidad de actividades.' };
      if (siguiente.estado === 'CANCELADA') {
        const rama = await resolverCancelada(siguienteId, proximos);
        if (rama.error) return rama;
        for (const ruta of rama.rutas) rutas.push([id, ...ruta]);
        for (const ruta of rama.retiradas || []) retiradas.push([id, ...ruta]);
      } else {
        if (!(await completaYVerificada(siguienteId)))
          return { error: 'Todas las actividades terminales de la continuidad deben estar completadas y verificadas.' };
        rutas.push([id, siguienteId]);
      }
    }
    const respuesta = { rutas, retiradas };
    resultados.set(id, respuesta);
    return respuesta;
  }
  for (const enlace of enlaces) {
    const act = enlace.actividad;
    if (act.estado === 'CANCELADA') {
      const result = await resolverCancelada(enlace.actividadId);
      if (result.error) return { lista: false, motivo: result.error, continuidades, ramificaciones };
      if (result.rutas.length === 1 && !result.retiradas.length) {
        const recorrido = result.rutas[0];
        const continuidad = { actividadAnuladaId: enlace.actividadId,
          actividadSucesoraId: recorrido[1] };
        if (recorrido.length > 2) {
          continuidad.cadenaActividadIds = recorrido;
          continuidad.actividadTerminalId = recorrido[recorrido.length - 1];
        }
        continuidades.push(continuidad);
      } else {
        const continuidad = { actividadAnuladaId: enlace.actividadId,
          actividadesSucesorasIds: [...(hijos.get(enlace.actividadId) || [])],
          rutasActividadIds: result.rutas,
          ...(result.retiradas.length ? { rutasRetiradasActividadIds: result.retiradas,
            actividadesRetiradasIds: [...new Set(result.retiradas.map(r => r[r.length - 1]))].sort((a,b) => a-b) } : {}),
          actividadesTerminalesIds: [...new Set(result.rutas.map(r => r[r.length - 1]))].sort((a,b) => a-b),
          ramificacion: true };
        continuidades.push(continuidad);
        ramificaciones.push(continuidad);
      }
    } else if (!(await completaYVerificada(enlace.actividadId))) {
      return { lista: false, motivo: 'Persisten actividades sin completar o sin revisión válida.', continuidades, ramificaciones };
    }
  }
  // Eliminar TODAS las ramas no justifica declarar resuelta una brecha.
  // Debe quedar por lo menos una actividad efectiva completada y verificada.
  if (!verificados.size || ![...verificados.values()].some(Boolean))
    return { lista: false, motivo: 'No queda actividad cumplida y verificada que sustente el cierre de la brecha.', continuidades, ramificaciones };
  return { lista: true, continuidades, ramificaciones,
    exclusionesActividadIds: excluidos.map(e=>e.actividadId).sort((a,b)=>a-b) };
}
module.exports = { estadoDeActividad, evaluarActividadesCierreBrecha };
