/* Ejecutar con: node --test tests/frontend-unit.test.js
 * No hace peticiones ni modifica bases de datos.
 */
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { createClient, parseUser } = require('../proyecto/frontend/js/core');
const maturity = require('../proyecto/frontend/js/maturity-model');

function fakeStorage() {
  const values = new Map();
  return {
    getItem: k => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, String(v)),
    removeItem: k => values.delete(k),
  };
}
function environment(fetch) {
  const sessionStorage = fakeStorage();
  const events = [];
  return {
    sessionStorage,
    __NEXO_SAME_ORIGIN__: true,
    location: {origin:'http://localhost:8080', protocol:'http:', hostname:'localhost'},
    fetch, events,
    dispatchEvent: event => events.push(event.type),
    CustomEvent: class { constructor(type) {this.type = type;} },
  };
}
const usuario = {id:5,rol:'EMPRESARIO',nombre:'Organización DEMO'};
test('sesión: solo usuarios con rol y ID válido', () => {
  assert.equal(parseUser(JSON.stringify(usuario)).id, 5);
  assert.equal(parseUser('{"id":0.2,"rol":"ADMIN","nombre":"x"}'), null);
  assert.equal(parseUser('{"id":1,"rol":"NO_EXISTE","nombre":"x"}'), null);
  assert.equal(parseUser('{inválido'), null);
});
test('HTTP: cabecera Bearer, mismo origen, JSON y no-store', async () => {
  let request;
  const env = environment(async (url, options) => {
    request = {url, ...options};
    return {ok:true,status:200,json:async () => ({id:123})};
  });
  const client = createClient(env);
  client.setSession({usuario,token:'solo-datos-sinteticos'});
  assert.deepEqual(await client.api('/proyectos',{method:'POST',body:'{}'}),{id:123});
  assert.equal(request.url,'http://localhost:8080/api/proyectos');
  assert.equal(request.headers.Authorization,'Bearer solo-datos-sinteticos');
  assert.equal(request.headers['Content-Type'],'application/json');
  assert.equal(request.cache,'no-store');
  assert.deepEqual(client.getUser(),usuario);
});
test('HTTP: bloquea rutas capaces de desviar JWT', async () => {
  let count = 0;
  const client = createClient(environment(async () => {count++;return {ok:true,json:async()=>({})};}));
  for (const path of ['//evil.example/','/../auth','/auth/%2e%2e/x','/a/%2f/b', '/%5c/', '/x\\example','http://example.com/','/a\nb']) {
    await assert.rejects(() => client.api(path),/Ruta de API inválida/);
  }
  assert.equal(count,0);
});
test('HTTP: 401 revoca sesión; 403 conserva sesión para error contextual', async () => {
  let code = 403;
  const env = environment(async () => ({ok:false,status:code,json:async()=>({message:'No autorizado'})}));
  const client = createClient(env);
  client.setSession({usuario,token:'token-de-prueba'});
  await assert.rejects(()=>client.api('/proyectos'),e=>e.status===403);
  assert.equal(client.getToken(),'token-de-prueba');
  code = 401;
  await assert.rejects(()=>client.api('/proyectos'),e=>e.status===401);
  assert.equal(client.getToken(),'');
  assert.deepEqual(env.events,['iso:session-expired']);
});
test('SGIA: N/A requiere motivo, niveles fuera de escala no acreditan respuesta', () => {
  assert.equal(maturity.isComplete({valor:'NA',justificacion:'Corto'}),false);
  assert.equal(maturity.isComplete({valor:'NA',justificacion:'La entidad no usa este recurso'}),true);
  assert.equal(maturity.isComplete({valor:'5'}),false);
  assert.equal(maturity.isComplete({valor:'0'}),true);
});
test('SGIA: exportación incompleta no presume aprobación ni autoría, conserva borrador', () => {
  const questions=[{id:'A'},{id:'B'},{id:'C'}];
  const answers = new Map([
    ['A',{valor:'4',evidencia:'Documento interno'}],
    ['B',{valor:'NA',justificacion:'Motivo'}],
  ]);
  const draft=maturity.exportDraft(questions,answers,'7');
  assert.deepEqual(draft.conteo,{total:3,completas:1,pendientes:2});
  assert.equal(draft.proyectoId,'7');
  assert.equal(draft.autoriaVerificada,false);
  assert.equal(draft.almacenamientoServidor,false);
  assert.equal(draft.tipo,'BORRADOR_ORIENTATIVO_NO_APROBADO');
  assert.equal(draft.respuestas[1].respuesta.valor,'NA');
  assert.equal(draft.respuestas[2].respuesta.valor,'');
  assert.equal(maturity.exportDraft([],new Map(),'x').proyectoId,null);
});

const publicRoot = path.resolve(__dirname, '../proyecto/frontend');
test('web: todos los archivos HTML tienen IDs únicos y recursos relativos presentes', () => {
  const pages = fs.readdirSync(path.join(publicRoot,'pages')).map(x=>path.join(publicRoot,'pages',x));
  pages.push(path.join(publicRoot,'index.html'));
  for (const file of pages) {
    const html=fs.readFileSync(file,'utf8');
    const ids=[...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1]);
    assert.equal(new Set(ids).size, ids.length, `ID duplicado en ${file}`);
    for (const [,name] of html.matchAll(/(?:src|href)\s*=\s*["'](\.\.?\/[^"'?#+]+)["']/gi)) {
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), name)), `Falta recurso ${name} en ${file}`);
    }
  }
});
test('web: JavaScript distribuido supera chequeo de sintaxis Node', () => {
  const files=fs.readdirSync(path.join(publicRoot,'js')).filter(x=>x.endsWith('.js'));
  assert.ok(files.length>=20);
  for (const name of files) execFileSync(process.execPath,['--check',path.join(publicRoot,'js',name)],{stdio:'pipe'});
});

// Nueva arquitectura de información: controlar presentación sin falsificar autorización API.
const workspace = require('../proyecto/frontend/js/workspace-model');
test('roles: ADMIN no recibe cuestionarios ni revisión técnica en navegación', () => {
  const admin = workspace.menu('ADMIN').map(x=>x.href);
  assert.ok(admin.includes('admin.html') && admin.includes('proyectos.html'));
  assert.ok(!admin.includes('evaluaciones.html') && !admin.includes('madurez-42001.html'));
  assert.equal(workspace.allowed('ADMIN','evaluaciones.html'),false);
  assert.equal(workspace.allowed('ADMIN','madurez-42001.html'),false);
});
test('roles: representante tiene diagnósticos; consultor revisa desde expediente', () => {
  assert.equal(workspace.allowed('EMPRESARIO','evaluaciones.html'),true);
  assert.equal(workspace.allowed('EMPRESARIO','madurez-42001.html'),true);
  assert.equal(workspace.allowed('EVALUADOR','evaluaciones.html'),false);
  assert.equal(workspace.allowed('EVALUADOR','proyectos.html'),true);
  assert.equal(workspace.allowed('EVALUADOR','admin.html'),false);
  assert.equal(workspace.allowed('EMPRESARIO','admin.html'),false);
  assert.equal(workspace.allowed('ROOT','dashboard.html'),false);
});
test('sitio público: seis secciones informativas y login de acceso sin registro público', () => {
  const names=['index.html','servicios.html','metodologia.html','para-empresas.html','preguntas.html'];
  for (const name of names) {
    const html=fs.readFileSync(path.join(publicRoot,name),'utf8');
    assert.match(html,/class="pv-nav"/);
    for(const target of names)assert.ok(html.includes('href="./'+target+'"'),`${name} sin enlace a ${target}`);
    assert.ok(!/name="telefono"|name="registro"/.test(html),`${name} solicita datos no autorizados`);
  }
  const login=fs.readFileSync(path.join(publicRoot,'pages/login.html'),'utf8');
  assert.match(login,/id="loginTab"/);
  assert.match(login,/autocomplete="current-password"/);
  assert.ok(!login.includes('name="rol"'));
  assert.ok(!login.includes('form id="registro"'));
});

// La página ADMIN no debe volver a exponer acciones de encuesta por un acceso secundario.
test('roles: Administración no incorpora accesos ocultos ni revisiones legadas', () => {
  const admin=fs.readFileSync(path.join(publicRoot,'pages/admin.html'),'utf8');
  const diagnostics=fs.readFileSync(path.join(publicRoot,'pages/evaluaciones.html'),'utf8');
  const app=fs.readFileSync(path.join(publicRoot,'js/app.js'),'utf8');
  assert.ok(!admin.includes('href="./evaluaciones.html"'));
  assert.ok(!admin.includes('href="./areas.html"'));
  assert.ok(!diagnostics.includes('id="evaluadorPanel"'));
  assert.ok(!app.includes('state.user.rol === "ADMIN" ? `<button data-action="revisar"'));
  assert.match(app,/const isEvaluador = rol === "EVALUADOR"/);
});
