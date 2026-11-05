const PDFDocument = require('pdfkit');

function formatearFecha(fecha) {
  if (!fecha) return '-';
  return new Date(fecha).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function construirPdfInforme({ stream, evaluacion, certificacion, preguntas, informe }) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(stream);

  const empresa = evaluacion.empresa?.nombre || `ID ${evaluacion.empresaId}`;
  const evaluadorNombre = informe?.creadoPor?.nombre || 'El evaluador asignado';
  doc.fontSize(20).text('Informe preliminar de preparacion ISO/IEC 27001', { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).text('No es una certificacion oficial ni sustituye una auditoria de un organismo certificador independiente.', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Empresa: ${empresa}`);
  doc.text(`Evaluacion #${evaluacion.id}`);
  doc.text(`Fecha: ${formatearFecha(new Date())}`);
  doc.moveDown();
  doc.text(`Evaluacion interna preparada por: ${evaluadorNombre}`);
  doc.text('El cuestionario y los criterios para determinar preparacion estan pendientes de validacion experta. El puntaje no autoriza un dictamen automatico de preparacion o certificabilidad.');
  doc.moveDown();

  if (informe) {
    doc.moveDown();
    doc.fontSize(13).text('Resumen del evaluador', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).text(informe.resumen || '-');
    doc.moveDown();
    doc.fontSize(13).text('Recomendaciones', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).text(informe.recomendaciones || '-');
  }

  doc.addPage();
  doc.fontSize(16).text('Respuestas y comentarios', {
    align: 'left',
  });
  doc.moveDown();

  preguntas.forEach((item, idx) => {
    const areaNombre = item.pregunta?.area?.nombre || 'Area sin nombre';
    const textoPregunta = item.pregunta?.texto || `Pregunta ${item.preguntaId}`;

    if (doc.y > 720) doc.addPage();

    doc.fontSize(11).text(`${idx + 1}. [${areaNombre}] ${textoPregunta}`, { continued: false });
    doc.fontSize(10).text(`Puntaje declarado: ${item.valor ?? '-'}`);
    doc.text(`Comentario de la empresa: ${item.comentario || '-'}`);
    doc.text(`Comentario evaluador: ${item.comentarioEvaluador || '-'}`);
    doc.moveDown(0.8);
  });

  doc.end();
}

module.exports = { construirPdfInforme };
