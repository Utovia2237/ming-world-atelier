'use strict';
// Development helper: node tests/render-sample.js [resolution] [output-name]
// Uses the optional sharp package from NODE_PATH, or the bundled desktop runtime.
const fs=require('node:fs'),path=require('node:path');
const E=require('../terrain.js');
let sharp;
try{sharp=require('sharp');}catch{
  sharp=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp'));
}
(async()=>{
  const n=Number(process.argv[2]||1280),base=path.resolve(__dirname,'..'),s=E.defaults(),start=Date.now();
  const field=await E.generate(n,s);
  const name=process.argv[3]||('示例地图-'+n+'.png');
  const pixels=await E.render(field,s);
  await sharp(Buffer.from(pixels),{raw:{width:n,height:n,channels:4}}).png().toFile(path.join(base,name));
  fs.writeFileSync(path.join(base,'示例项目.json'),JSON.stringify({format:'ming-world-atelier',...s},null,2));
  fs.writeFileSync(path.join(base,'tests','last-render.json'),JSON.stringify({...field.stats,elapsedSeconds:(Date.now()-start)/1000},null,2));
  console.log(field.stats,'elapsed seconds',(Date.now()-start)/1000);
})().catch(e=>{console.error(e);process.exitCode=1;});
