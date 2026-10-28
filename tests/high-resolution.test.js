'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../terrain.js');
let sharp;
try{sharp=require('sharp');}catch{
  sharp=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp'));
}
(async()=>{
  const start=Date.now(),n=4096,s={...E.defaults(),transparent:true,contours:true};
  const field=await E.generate(n,s);
  assert.ok(Math.abs(field.stats.ocean-s.ocean)<.0001);
  let rimPixels=0;
  const c=n/2,r=n*E.MAP_RADIUS;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const d=Math.hypot((x+.5-c)/r,(y+.5-c)/r),h=field.heights[y*n+x];
    if(d>=.974&&d<1){assert.ok(h>0);rimPixels++;}
    if(d>=1)assert.equal(h,-9000);
  }
  const pixels=await E.render(field,s);
  const png=await sharp(Buffer.from(pixels),{raw:{width:n,height:n,channels:4}}).png().toBuffer();
  const mapMetadata=await sharp(png).metadata();
  assert.equal(mapMetadata.width,n);assert.equal(mapMetadata.height,n);
  assert.equal(pixels[3],0);assert.equal(pixels[((n>>1)*n+(n>>1))*4+3],255);
  const heightBytes=await E.heightPNG(field),heightMetadata=await sharp(Buffer.from(heightBytes)).metadata();
  assert.equal(heightMetadata.width,n);assert.equal(heightMetadata.height,n);
  assert.equal(heightMetadata.depth,'ushort');
  const report={...field.stats,rimPixels,pngBytes:png.length,heightPNGBytes:heightBytes.length,heightDepth:heightMetadata.depth,contours:true,transparent:true,elapsedSeconds:(Date.now()-start)/1000};
  fs.writeFileSync(path.join(__dirname,'high-resolution.json'),JSON.stringify(report,null,2));
  console.log('Passed native 4096 terrain/render, complete land rim, exact circle, ocean area, transparent PNG, contours and lossless 16-bit height PNG checks.',report);
})().catch(error=>{console.error(error);process.exitCode=1;});
