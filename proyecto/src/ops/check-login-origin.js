/** Non-credentialed HTTP security smoke through Nginx, using each approved browser Origin. */
async function check(){
  const port=process.env.WEB_PORT||'8080';
  const allowed=[`http://localhost:${port}`,`http://127.0.0.1:${port}`];
  const actual=new URL(process.env.FRONTEND_URL||allowed[0]);
  if(!['localhost','127.0.0.1'].includes(actual.hostname)){
    allowed.length=0;allowed.push(actual.origin);
  }
  const cases=[...allowed.map(origin=>({origin,expected:401})),
    {origin:'https://malicious-site.invalid',expected:403}];
  for(const {origin,expected} of cases){
    const response=await fetch('http://web:8080/api/auth/login',{
      method:'POST',headers:{'Content-Type':'application/json',Origin:origin},
      body:JSON.stringify({email:'no-such-account@invalid.test',password:'wrong-test-only'}),
      signal:AbortSignal.timeout(7000),redirect:'manual'
    });
    if(response.status!==expected)throw Error(`Origin ${origin}: HTTP ${response.status}, esperado ${expected}`);
    const allow=response.headers.get('access-control-allow-origin');
    if(expected===401&&allow!==origin)throw Error('Falta permiso CORS para el navegador en '+origin);
    if(expected===403&&allow)throw Error('Un origen externo recibió permiso CORS');
  }
  console.log('Acceso HTTP: localhost y 127.0.0.1 autorizados; origen externo rechazado.');
}
check().catch(e=>{console.error('NEXO_LOGIN_CHECK:',e.message);process.exitCode=1;});
