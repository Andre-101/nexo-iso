// Ejecutar manualmente UNA VEZ. No reescribe contraseñas de cuentas existentes.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { validarEntorno } = require('../src/config/security');
const prisma = new PrismaClient();
async function requestInteractive(label,{secret=false}={}) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function')
    throw new Error('Se requiere una terminal interactiva para introducir credenciales sin exponerlas.');
  return await new Promise(resolve => {
    let value='';
    process.stdout.write(label);
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    function finish(){process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');resolve(value);}
    function onData(chunk){
      for(const c of chunk){
        if(c==='\u0003') { process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdout.write('\n');process.exit(130); }
        if(c==='\r'||c==='\n'){finish();return;}
        if(c==='\u007f'||c==='\b') { if(value.length){value=value.slice(0,-1);if(!secret)process.stdout.write('\b \b');}continue; }
        if(c==='\u001b'||c.charCodeAt(0)<32||value.length>=254)continue;
        value+=c;if(!secret)process.stdout.write(c);
      }
    }
    process.stdin.on('data',onData);
  });
}
async function readInteractive() {
  const email=(await requestInteractive('Correo del administrador: ')).trim().toLowerCase();
  const password=await requestInteractive('Contraseña (mínimo 16 caracteres; oculta): ',{secret:true});
  const repeat=await requestInteractive('Repetir contraseña (oculta): ',{secret:true});
  if(password!==repeat)throw Error('Las contraseñas no coinciden. No se creó el administrador.');
  return {email,password};
}
async function verifyLogin(email,password){
  // Comprobación real; ni password ni JWT se registran en consola o .env.
  const port=Number(process.env.WEB_PORT||8080);
  const base=new URL(process.env.FRONTEND_URL||`http://localhost:${port}`);
  const origins=(base.hostname==='localhost'||base.hostname==='127.0.0.1')
    ? [`http://localhost:${port}`,`http://127.0.0.1:${port}`] : [base.origin];
  for(const origin of origins){
    const response=await fetch('http://api:3000/api/auth/login',{
      method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
      body:JSON.stringify({email,password}),signal:AbortSignal.timeout(6000)
    });
    const data=await response.json().catch(()=>null);
    if(response.status!==200||data?.usuario?.rol!=='ADMIN'||typeof data?.token!=='string')
      throw Error('Cuenta creada, pero el login real no pasó la verificación desde '+origin+'. No repita el alta.');
  }
  console.log('Login ADMIN verificado por API interna; no se imprimieron tokens.');
}
async function main() {
  validarEntorno();
  // El instalador envía credenciales efímeras por stdin: no figuran en argv ni .env.
  let credentials = {};
  if (process.argv.includes('--interactive')) {
    credentials = await readInteractive();
  } else if (process.env.BOOTSTRAP_ADMIN_STDIN === '1') {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 4096) throw new Error('Datos de inicializacion demasiado largos.');
    }
    try { credentials = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Entrada de inicializacion invalida.'); }
  } else {
    credentials = { email: process.env.BOOTSTRAP_ADMIN_EMAIL, password: process.env.BOOTSTRAP_ADMIN_PASSWORD };
  }
  const email = credentials.email;
  const password = credentials.password;
  if (!email || !/^\S+@\S+\.\S+$/.test(email) ||
      !password || password.length < 16 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Indique correo valido y contraseña inicial de al menos 16 caracteres.');
  }
  const cuenta = await prisma.usuario.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (cuenta) throw new Error('La cuenta ya existe; bootstrap cancelado para proteger las credenciales.');
  const admins = await prisma.usuario.count({ where: { rol: 'ADMIN' } });
  if (admins) throw new Error('Ya existe un administrador; bootstrap deshabilitado.');
  await prisma.usuario.create({ data: {
    nombre: 'Administrador', email: email.trim().toLowerCase(),
    passwordHash: await bcrypt.hash(password, 12), rol: 'ADMIN', activo: true,
  } });
  console.log('Cuenta administrativa inicial creada.');
  if(process.argv.includes('--interactive')) await verifyLogin(email.trim().toLowerCase(),password);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
