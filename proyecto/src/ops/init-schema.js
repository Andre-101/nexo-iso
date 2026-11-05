/** One-shot, local-only schema initialization. Existing databases are NEVER migrated by start.
 * Runs only in isolated bootstrap container, and only when localdb profile is active.
 */
const { spawnSync } = require('node:child_process');
const { environmentForChild } = require('../config/load-secrets');
const prisma = require('../config/prisma');
const {checkSchemaReadiness}=require('../utils/schema-readiness-350');
async function main(){
  const counts = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS total
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')`);
  const total=Number(counts?.[0]?.total);
  if(!Number.isInteger(total)||total<0)throw Error('No se pudo comprobar la base sin modificarla.');
  if(total===0){
    console.log('Base nueva y vacía: inicializando el esquema y el catálogo de preguntas.');
    await prisma.$disconnect();
    for(const [command,args] of [
      ['node',['node_modules/prisma/build/index.js','db','push','--skip-generate']],
      ['node',['prisma/seed.js']]
    ]){
      const result=spawnSync(command,args,{stdio:'inherit',env:environmentForChild()});
      if(result.status!==0||result.error)throw Error('Inicialización interrumpida. No se borraron datos; requiere revisión antes de reintentar.');
    }
    console.log('Base preparada sin usuarios predeterminados.');
    return;
  }
  const readiness=await checkSchemaReadiness(prisma);
  if(readiness.missing.length){
    console.error('La base existente carece de '+readiness.missing.length+' tablas requeridas. No se aplicaron migraciones.');
    process.exitCode=1; return;
  }
  console.log('Base existente completa: se conservan datos y estructura.');
}
main().catch(e=>{console.error('NEXO_DB:',e.message);process.exitCode=1;}).finally(()=>prisma.$disconnect().catch(()=>{}));
