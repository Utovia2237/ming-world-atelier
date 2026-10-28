'use strict';
// Development helper: render the same seed with each family and the default mix.
const path=require('node:path'),E=require('../terrain.js');
let sharp;try{sharp=require('sharp');}catch{sharp=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp'));}
(async()=>{
  const n=800,base=E.defaults(),variants=[
    ['NETWORK',{mountainNetwork:100,mountainChain:0,mountainStretch:0}],
    ['CHAIN',{mountainNetwork:0,mountainChain:100,mountainStretch:0}],
    ['STRETCH',{mountainNetwork:0,mountainChain:0,mountainStretch:100}],
    ['MIX',{}]
  ],layers=[];
  for(let i=0;i<variants.length;i++){
    const [label,ratios]=variants[i],s={...base,...ratios},field=await E.generate(n,s),pixels=await E.render(field,s);
    const image=await sharp(Buffer.from(pixels),{raw:{width:n,height:n,channels:4}}).png().toBuffer();
    const left=(i%2)*n,top=Math.floor(i/2)*n;
    layers.push({input:image,left,top});
    const svg=Buffer.from('<svg width="200" height="42"><rect width="200" height="42" fill="#f8f9f5" opacity="0.90"/><text x="14" y="29" fill="#324c42" font-family="Arial" font-size="22">'+label+'</text></svg>');
    layers.push({input:svg,left:left+22,top:top+22});
    console.log(label,field.stats.maximum,field.stats.mountainArea.toFixed(1)+'% mountains');
  }
  const output=path.resolve(__dirname,'..','山系样式对比.png');
  await sharp({create:{width:n*2,height:n*2,channels:4,background:'#eeede8'}}).composite(layers).png().toFile(output);
  console.log(output);
})().catch(error=>{console.error(error);process.exitCode=1;});
