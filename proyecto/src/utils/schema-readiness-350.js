'use strict';
// Distingue schema antiguo/parcial de una DB inicializada; solo lectura.
const fs=require('node:fs');
const path=require('node:path');
const schema=fs.readFileSync(path.resolve(__dirname,'../../prisma/schema.prisma'),'utf8');
const models=Object.freeze([...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map(x=>x[1]));
if(models.length<45 || new Set(models).size!==models.length){
 throw Error('SCHEMA_READINESS_MODELOS_INVALIDOS');
}
async function checkSchemaReadiness(prisma){
 const rows=await prisma.$queryRaw`SELECT table_name::text AS nombre FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`;
 const present=new Set(rows.map(x=>x.nombre));
 return {models:models.length,missing:models.filter(x=>!present.has(x))};
}
module.exports={checkSchemaReadiness};
