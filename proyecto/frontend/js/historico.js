/* Certificaciones heredadas: solo consultar, nunca simular acreditación oficial. */
(() => {
  const root=document.getElementById('historyItems');if(!root)return;
  const status=document.getElementById('historyMessage');
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
  async function load(){
    root.replaceChildren();status.textContent='Consultando registros existentes…';
    try {
      const rows=await window.ISO.api('/certificaciones');
      if(!Array.isArray(rows))throw new Error('El servidor devolvió un formato inesperado.');
      status.textContent=`${rows.length} registro(s) histórico(s). No son certificaciones oficiales.`;
      if(!rows.length)root.append(el('p','No existen registros históricos disponibles para esta cuenta.','g1-muted'));
      for(const row of rows){
        const card=el('article',undefined,'g1-card');
        card.append(el('h3',`Registro interno #${row.id}`),el('p',`Estado histórico: ${row.estado||'Sin estado'}`),el('p',`Empresa: ${row.evaluacion?.empresa?.nombre||'No disponible'}`,'g1-muted'),el('p',row.advertencia||'Registro histórico interno, no constituye certificado oficial.','g1-muted'));
        root.append(card);
      }
    }catch(err){status.textContent=err.message;status.className='inline-alert error';}
  }
  document.getElementById('historyRefresh').addEventListener('click',load);load();
})();
