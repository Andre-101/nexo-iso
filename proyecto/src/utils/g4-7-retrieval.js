'use strict';
/** G4.7, isolated evaluation only: deterministic retrieval, ONE classification LLM call.
 * Quotes remain exact source excerpts and preserve their source page. Labels/fixtures
 * NEVER enter this module; they are evaluated separately in the test harness.
 */
const {norm}=require('./g4-3-two-stage');
const STOP=new Set(('los las del una unas unos para como esta este estos estas debe deben tener tienen existe existen cada solo ' +
 'documento documentada documentado registro registros evidencia evidencias mediante sobre antes despues entre ' +
 'responsable responsables del durante ellas ellos son con por sus que se del al cual esta parte algun').split(' '));
const UNCERTAIN=/\b(no (?:precisa|aclara|especifica|describe|afirma|niega|confirma|indica|aborda|presenta|menciona)|sin informacion|no hay informacion|se desconoce|no queda claro|no se (?:sabe|puede inferir))\b/u;
const NEGATED=/\b(nunca|ningun[ao]?|no se (?:registr|realiz|revis|ejecut|document|conserv|control|prueb|archiv|verific|aprueb)|no exist|no hay (?:verific|prueb|registr|evidencia)|sin (?:autorizacion|prueba|registro|revision)|carece|inexistente)\b/u;
function roots(text){return [...new Set((norm(text).match(/[a-z0-9]{4,}/gu)||[]).map(w=>w.replace(/(?:aciones|adores|adora|ados|adas|acion|iones|mente|ando|iendo|ados|adas|ado|ada|idos|idas|ico|ica|os|as|es|s)$/u,'')).filter(w=>w.length>=3&&!STOP.has(w)))];}
function sentences(text){
 const records=[];
 for(const [i,page] of text.split('\f').entries()){
  const flat=page.replace(/\r/g,'').replace(/\n+/g,' ');
  for(const raw of flat.split(/(?<=[.!?;])\s+(?=[A-ZÁÉÍÓÚÑa-záéíóúñ0-9])/u)){
   const cita=raw.replace(/\s+/gu,' ').trim();
   if(cita.length>=25&&cita.length<=450)records.push({pagina:i+1,cita});
  }
 }
 return records;
}
function retrieveEvidence(text,criterion,{limit=7}={}){
 if(typeof text!=='string'||typeof criterion!=='string'||text.length>16000||criterion.length>320||!Number.isInteger(limit)||limit<1||limit>7)throw Error('G47_ENTRADA_INVALIDA');
 const query=roots(criterion),all=sentences(text),occ=new Map();
 for(const row of all){row.terms=new Set(roots(row.cita));for(const w of row.terms)occ.set(w,(occ.get(w)||0)+1);}
 const n=all.length;const ranked=all.map((r,i)=>{
   const common=query.filter(w=>r.terms.has(w));
   const coverage=query.length?common.length/query.length:0;
   const rarity=common.reduce((a,w)=>a+Math.log(1+(n+1)/(1+(occ.get(w)||0))),0);
   const t=norm(r.cita),uncertain=UNCERTAIN.test(t),negative=NEGATED.test(t);
   // Scope-bounded but recall-oriented: uncertainty is demoted, never thrown away.
   const score=coverage*12+rarity*2 + (negative?1.5:0) - (uncertain?2.0:0);
   return {...r,score,coverage,uncertain,negative,originalIndex:i};
 }).sort((a,b)=>b.score-a.score||a.originalIndex-b.originalIndex);
 const chosen=[],seen=new Set(),pageCount=new Map();
 // Include document-wide candidates. A page cap is relaxed in a second pass.
 for(const pass of [0,1]){if(chosen.length>=limit)break;for(const r of ranked){
   const key=norm(r.cita);if(seen.has(key))continue;
   if(pass===0 && (pageCount.get(r.pagina)||0)>=Math.max(2,Math.ceil(limit/3)))continue;
   seen.add(key);pageCount.set(r.pagina,(pageCount.get(r.pagina)||0)+1);
   chosen.push(r);if(chosen.length>=limit)break;
 }}
 return chosen.slice(0,limit).map((r,i)=>({id:`E${i+1}`,pagina:r.pagina,cita:r.cita,score:Number(r.score.toFixed(4))}));
}
function retrievalCoverage(evidence,anchors){
 if(!Array.isArray(evidence)||!Array.isArray(anchors))throw Error('G47_ANOTACION_INVALIDA');
 const per=anchors.map(a=>{
  if(!Number.isInteger(a.page)||a.page<1||typeof a.contains!=='string'||a.contains.length<12)throw Error('G47_ANOTACION_INVALIDA');
  const matching=evidence.filter(e=>e.pagina===a.page&&norm(e.cita).includes(norm(a.contains)));
  return {page:a.page,contains:a.contains,hit:matching.length>0,ids:matching.map(e=>e.id)};
 });
 return {hits:per.filter(x=>x.hit).length,total:per.length,recall:per.length?per.filter(x=>x.hit).length/per.length:null,per};
}
module.exports={retrieveEvidence,retrievalCoverage,roots,sentences};
