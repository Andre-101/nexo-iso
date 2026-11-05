'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = p => fs.readFileSync(path.join(root,p), 'utf8');
const {loadSecrets, environmentForChild} = require('../proyecto/src/config/load-secrets');
const {loginThrottle, failedLogin, successfulLogin, MAX_FAILURES} = require('../proyecto/src/middleware/login-throttle');
const {externalUrl} = require('../proyecto/src/utils/data-mode');
const {validarEntorno} = require('../proyecto/src/config/security');

test('VPS: despliegue independiente y aislado, sin puertos ni red v4nex', () => {
  const c=source('compose.vps.yaml');
  assert.doesNotMatch(c, /^\s+ports\s*:/m);
  assert.doesNotMatch(c, /name: app_edge/);
  assert.doesNotMatch(c, /^  proxy:/m);
  assert.match(c, /name: nexo/);
  assert.match(c, /networks: \[app, data, egress\]/); // la API necesita egress HTTPS sin exponer puertos
  assert.match(c, /driver: bridge/);
  assert.match(c, /DATA_MODE: production/);
  for(const name of ['web','api','db','bootstrap'])assert.match(c, new RegExp('^  '+name+':', 'm'));
  for(const demo of ['registry-demo','finance-demo','registry-db-demo','finance-db-demo'])assert.doesNotMatch(c,new RegExp('^  '+demo+':','m'));
  assert.match(c,/profiles: \[bootstrap\]/);
  assert.match(c,/mem_limit: 768m/);
  assert.match(c,/no-new-privileges:true/);
  assert.match(c,/cap_drop: \[ALL\]/);
  assert.match(c,/NEXO_WEB_IMAGE/);
  assert.match(c,/REGISTRY_INTEGRATION_ENABLED: "0"/);
  assert.match(c,/FINANCE_INTEGRATION_ENABLED: "0"/);
});

test('VPS: imágenes con separaciones reales, no compilación del servidor, runtime no root', () => {
  const d=source('infra/Dockerfile.vps'), w=source('infra/Dockerfile.web.vps');
  assert.match(d,/AS dependencies/);
  assert.match(d,/AS production-dependencies/);
  assert.match(d,/AS api/);
  assert.match(d,/AS bootstrap/);
  assert.match(d,/npm prune --omit=dev/);
  assert.match(d,/USER node:node/);
  assert.match(d,/poppler-utils/);
  assert.match(w,/FROM nginx:1\.30\.6-alpine/);
  assert.match(w,/USER 101:101/);
  assert.match(source('infra/nginx.vps.conf'),/limit_req zone=auth_budget/);
  assert.match(source('.github/workflows/vps-images.yml'),/npm audit --omit=dev/);
  assert.match(source('.github/workflows/vps-images.yml'),/trivy-action/);
});

test('secreto: obligatorio en /run/secrets, no sobrescribe env y falla cerrado', () => {
  const a={JWT_SECRET_FILE:'/run/secrets/jwt'};
  loadSecrets(a,()=> 'a'.repeat(48)+'\n');
  assert.equal(a.JWT_SECRET,'a'.repeat(48));
  assert.throws(()=>loadSecrets({JWT_SECRET:'value',JWT_SECRET_FILE:'/run/secrets/jwt'},()=> 'x'), /no combinar/);
  assert.throws(()=>loadSecrets({JWT_SECRET_FILE:'/etc/passwd'},()=> 'x'), /ruta de secreto/);
  assert.throws(()=>loadSecrets({JWT_SECRET_FILE:'/run/secrets/jwt'},()=> 'x\ny\n'), /malformado/);
});

test('auth: bloqueo por 10 fallos de un mismo correo, independencia de mayúsculas', () => {
  const req={body:{email:'ALICE.TEST@EXAMPLE.ORG'}, loginThrottleKey:null};
  function response(){return {code:0, headers:{}, set(k,v){this.headers[k]=v;return this;},status(v){this.code=v;return this;},json(obj){this.body=obj;return this;}};}
  let nextCount=0;
  for(let i=0;i<MAX_FAILURES;i++){
    loginThrottle(req,response(),()=>{nextCount++;});
    failedLogin(req);
  }
  assert.equal(nextCount,MAX_FAILURES);
  const blocked=response();
  loginThrottle({body:{email:'alice.test@example.org'}},blocked,()=>{throw Error('No debe continuar');});
  assert.equal(blocked.code,429);
  assert.ok(Number(blocked.headers['Retry-After'])>0);
  successfulLogin(req);
  const allowed=response();
  loginThrottle(req,allowed,()=>{nextCount++;});
  assert.equal(nextCount,MAX_FAILURES+1);
});

test('URLs de integraciones: excluyen HTTP, direcciones literales y dominios locales', () => {
  assert.equal(externalUrl('https://169.254.169.254'),null);
  assert.equal(externalUrl('https://127.0.0.1'),null);
  assert.equal(externalUrl('http://proveedor.example.org'),null);
  assert.equal(externalUrl('https://intranet.local'),null);
  assert.equal(externalUrl('https://api.example.org'), 'https://api.example.org');
});

test('API: en producción solo origen HTTPS y JWT secretos fuertes', () => {
  const cfg={ NODE_ENV:'production', DATA_MODE:'production', JWT_SECRET:'token-89aacddbb434d1ff76d4f44772e8589721f101a36af80cc87c3f516fe376ccca', DATABASE_URL:'postgresql://u:p@db:5432/nexo',FRONTEND_URL:'https://consultoria.v4nex.com' };
  assert.doesNotThrow(()=>validarEntorno(cfg));
  assert.throws(()=>validarEntorno({...cfg, FRONTEND_URL:'http://consultoria.v4nex.com'}),/HTTPS/);
  assert.throws(()=>validarEntorno({...cfg, JWT_SECRET:'secret'}),/JWT_SECRET/);
  const auth=source('proyecto/src/middleware/auth.middleware.js');
  assert.match(auth,/algorithms: \['HS256'\]/);
  assert.match(auth,/audience: 'nexo-web'/);
});


test('Despliegue local limitado a 127.0.0.1:8080 y con Docker build', () => {
  const c=source('compose.local.yaml');
  assert.match(c,/name: nexo_local/);
  assert.match(c,/127\.0\.0\.1:\$\{NEXO_LOCAL_PORT:-8080\}:8080/);
  assert.match(c,/dockerfile: infra\/Dockerfile\.vps/);
  assert.match(c,/dockerfile: infra\/Dockerfile\.web\.vps/);
});

test('IPv6 añadida posteriormente sin acoplar la API ni DB a v4nex', () => {
  const nginx=source('infra/nginx.vps.conf');
  const bridge=source('compose.bridge-ipv6.yaml');
  assert.match(nginx,/listen \[::\]:8080 ipv6only=on/);
  assert.match(bridge,/name: \$\{NEXO_SHARED_NETWORK/);
  assert.match(bridge,/ipv6_address: \$\{NEXO_IPV6_ADDRESS/);
  assert.doesNotMatch(bridge,/^  api:/m);
  assert.doesNotMatch(bridge,/^  db:/m);
  assert.doesNotMatch(bridge,/^\s+ports:/m);
});

test('Fuente registral y financiera desactivadas sin datos ficticios en modo production', async () => {
  const env={DATA_MODE:'production',REGISTRY_INTEGRATION_ENABLED:'0',FINANCE_INTEGRATION_ENABLED:'0'};
  const {checkMode}=require('../proyecto/src/utils/data-mode');
  assert.equal(checkMode(env),'production');
  const {consultarFuenteExterna348}=require('../proyecto/src/services/proveedor-registral-externo-348');
  const reg=await consultarFuenteExterna348('900123456',{env,mode:'production',fetchImpl:()=>{throw Error('No debe llamar servidor real');}});
  assert.deepEqual(reg,{tipo:'ERROR',codigo:'PROVEEDOR_NO_CONFIGURADO'});
  const {origenFinanciero}=require('../proyecto/src/utils/recursos-financieros-42001-348');
  assert.equal(origenFinanciero(env),null);
  assert.throws(()=>checkMode({...env, REGISTRY_INTEGRATION_ENABLED:'1'}),/REGISTRO_REAL_NO_CONFIGURADO/);
  assert.throws(()=>checkMode({...env, FINANCE_INTEGRATION_ENABLED:'1'}),/FINANZAS_REALES_NO_CONFIGURADAS/);
});

test('Producción independiente del subdominio HTTPS futuro; si se especifica, validar origen', () => {
  const cfg={NODE_ENV:'production',DATA_MODE:'production',JWT_SECRET:'token-89aacddbb434d1ff76d4f44772e8589721f101a36af80cc87c3f516fe376ccca',DATABASE_URL:'postgresql://nexo:123@db:5432/nexo'};
  assert.doesNotThrow(()=>validarEntorno(cfg));
  assert.throws(()=>validarEntorno({...cfg,FRONTEND_URL:'http://invalid.example.org'}),/HTTPS/);
  const app=source('proyecto/src/app.js');
  assert.match(app,/if \(process\.env\.NODE_ENV !== 'production'\)/);
});


test('montajes tmpfs compatibles con Docker Compose del usuario', () => {
  for (const compose of ['compose.local.yaml', 'compose.vps.yaml']) {
    const value = source(compose);
    assert.doesNotMatch(value, /\/tmp:rw,noexec,nosuid/);
    assert.doesNotMatch(value, /tmpfs: \[\/tmp:rw/);
    assert.match(value, /\/tmp:size=32m/);
  }
  const workflow = source('.github/workflows/vps-images.yml');
  assert.match(workflow, /ADMIN persistente tras reiniciar PostgreSQL/);
  assert.match(workflow, /CI_ADMIN_PASS=.*openssl rand -hex 24/);
  assert.match(source('scripts/create-admin-local.ps1'), /bootstrap-admin\.js --interactive/);
  assert.match(source('scripts/create-admin-vps.sh'), /bootstrap-admin\.js --interactive/);
});


test('regresión bootstrap: la segunda precarga Node no rechaza secretos ya cargados en el padre', () => {
  const {spawnSync} = require('node:child_process');
  const loader = path.join(root, 'proyecto/src/config/load-secrets.js');
  const parent = {NODE_OPTIONS: '--require='+loader,
    DATABASE_URL_FILE:'/run/secrets/nexo_database_url',
    JWT_SECRET_FILE:'/run/secrets/nexo_jwt_secret'};
  loadSecrets(parent, filename => filename.endsWith('nexo_database_url')
    ? 'postgresql://nexo:test@db:5432/nexo\n' : 'z'.repeat(48)+'\n');
  assert.equal(parent.DATABASE_URL_FILE, '/run/secrets/nexo_database_url');
  const child = environmentForChild(parent);
  assert.equal(child.DATABASE_URL, 'postgresql://nexo:test@db:5432/nexo');
  assert.equal(child.JWT_SECRET, 'z'.repeat(48));
  assert.equal(child.DATABASE_URL_FILE, undefined);
  assert.equal(child.JWT_SECRET_FILE, undefined);
  assert.equal(parent.DATABASE_URL_FILE, '/run/secrets/nexo_database_url');
  assert.equal(parent.JWT_SECRET_FILE, '/run/secrets/nexo_jwt_secret');
  const result = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(!!process.env.DATABASE_URL))'],
    {encoding:'utf8',env:child});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout,'true');
  const init = source('proyecto/src/ops/init-schema.js');
  assert.match(init,/spawnSync\(command,args,\{stdio:'inherit',env:environmentForChild\(\)\}\)/);
});


test('Nginx sin root y read_only utiliza rutas temporales en tmpfs escribible', () => {
  const nginx = source('infra/nginx.vps.conf');
  assert.match(nginx, /pid \/tmp\/nginx\.pid;/);
  for (const directive of ['client_body_temp_path', 'proxy_temp_path', 'fastcgi_temp_path', 'uwsgi_temp_path', 'scgi_temp_path']) {
    assert.match(nginx, new RegExp('^  ' + directive + '\\s+\\/tmp\\/', 'm'));
  }
  for (const compose of ['compose.local.yaml', 'compose.vps.yaml']) {
    const c = source(compose);
    assert.match(c, /read_only: true/);
    assert.match(c, /\/tmp:size=32m/);
    assert.doesNotMatch(c, /\/var\/cache\/nginx:size=/);
  }
});
