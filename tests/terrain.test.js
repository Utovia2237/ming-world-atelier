'use strict';
const assert=require('node:assert/strict');
const zlib=require('node:zlib');
const vm=require('node:vm');
const Terrain=require('../terrain.js');

async function checkSeedOcean(seed,ocean,options={}){
  const settings={...Terrain.defaults(),seed,ocean,...options};
  const first=await Terrain.generate(192,settings);
  const second=await Terrain.generate(192,settings);
  assert.deepEqual(first.heights,second.heights,'same seed and options reproduce the exact height field');
  assert.ok(Math.abs(first.stats.ocean-ocean)<.01,'ocean ratio: wanted '+ocean+', got '+first.stats.ocean);
  const n=first.size,c=n/2,r=n*Terrain.MAP_RADIUS;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const radius=Math.hypot((x+.5-c)/r,(y+.5-c)/r);
    if(radius>=.974&&radius<1)assert.ok(first.heights[y*n+x]>0,'the circular coastline stays in contact all around the rim');
    if(radius>=1)assert.equal(first.heights[y*n+x],-9000,'pixels beyond the true circle are clipped');
  }
  const centerIndex=(n>>1)*n+(n>>1);
  assert.ok(first.heights[centerIndex]>0,'the forced central island always covers the exact map center');
  let seaStart=-1;
  for(let radius=1;radius<Math.floor(n*.30)&&seaStart<0;radius++){
    for(let dx=-radius;dx<=radius&&seaStart<0;dx++)for(const dy of [-radius,radius]){
      const x=(n>>1)+dx,y=(n>>1)+dy;if(x>=0&&x<n&&y>=0&&y<n&&first.heights[y*n+x]<0){seaStart=y*n+x;break;}
    }
    for(let dy=-radius+1;dy<radius&&seaStart<0;dy++)for(const dx of [-radius,radius]){
      const x=(n>>1)+dx,y=(n>>1)+dy;if(x>=0&&x<n&&y>=0&&y<n&&first.heights[y*n+x]<0){seaStart=y*n+x;break;}
    }
  }
  assert.ok(seaStart>=0,'the forced island is surrounded by the connected central sea');
  const visited=new Uint8Array(n*n),queue=new Uint32Array(n*n);
  let head=0,tail=1;queue[0]=seaStart;visited[queue[0]]=1;
  while(head<tail){
    const p=queue[head++],x=p%n;
    for(const q of [x?p-1:-1,x+1<n?p+1:-1,p-n,p+n]){
      if(q<0||q>=n*n||visited[q]||first.heights[q]>=0||first.heights[q]<-8000)continue;
      visited[q]=1;queue[tail++]=q;
    }
  }
  assert.equal(tail,first.stats.waterPixels,'every water pixel connects to the central sea; no isolated lakes');
  const rendered=await Terrain.render(first,settings);
  assert.equal(rendered.length,n*n*4);
  for(let i=3;i<rendered.length;i+=4)assert.equal(rendered[i],255);
  const transparent=await Terrain.render(first,{...settings,transparent:true});
  assert.equal(transparent[3],0,'the circular exterior can be transparent');
  assert.equal(transparent[((n>>1)*n+(n>>1))*4+3],255,'the world interior remains opaque');
  return first.stats;
}

function parsePNG(png){
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  let offset=8,ihdr=null,compressed=[];
  while(offset<png.length){
    const size=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8),data=png.subarray(offset+8,offset+8+size);
    assert.equal(png.readUInt32BE(offset+8+size),zlib.crc32(png.subarray(offset+4,offset+8+size)),'PNG chunk CRC: '+type);
    if(type==='IHDR')ihdr={width:data.readUInt32BE(0),height:data.readUInt32BE(4),depth:data[8],colorType:data[9]};
    if(type==='IDAT')compressed.push(data);
    offset+=size+12;if(type==='IEND')break;
  }
  return{ihdr,raw:zlib.inflateSync(Buffer.concat(compressed))};
}

(async()=>{
  const results=[];
  for(const seed of ['MING-0207','delta','isles'])for(const ocean of [10,15,20])results.push(await checkSeedOcean(seed,ocean));
  for(const ocean of [10,20])for(const coast of [0,100])for(const islands of [0,100])results.push(await checkSeedOcean('parameter-extremes',ocean,{coast,islands,mountains:coast,relief:islands}));
  const low=await Terrain.generate(192,{...Terrain.defaults(),mountains:5,seed:'hill-control'});
  const high=await Terrain.generate(192,{...Terrain.defaults(),mountains:95,seed:'hill-control'});
  assert.ok(high.stats.mountainArea>low.stats.mountainArea+8,'mountain density increases elevated land area');
  const baseMix={...Terrain.defaults(),seed:'mountain-families'};
  const onlyNetwork={...baseMix,mountainNetwork:100,mountainChain:0,mountainStretch:0};
  const onlyChain={...baseMix,mountainNetwork:0,mountainChain:100,mountainStretch:0};
  const onlyStretch={...baseMix,mountainNetwork:0,mountainChain:0,mountainStretch:100};
  const pure=await Promise.all([onlyNetwork,onlyChain,onlyStretch].map(s=>Terrain.generate(256,s)));
  const mixed=await Terrain.generate(256,baseMix);
  let distinct=0,mixedLand=0;
  for(let i=0;i<mixed.heights.length;i++){
    const heights=pure.map(f=>f.heights[i]),h=mixed.heights[i];
    if(h===-9000||h<0){assert.ok(heights.every(v=>v===h),'mountain choice never changes circle or coast');continue;}
    mixedLand++;if(Math.max(...heights)-Math.min(...heights)>100)distinct++;
    assert.ok(h>=Math.min(...heights)-.001&&h<=Math.max(...heights)+.001,'soft overlap stays between the three family heights');
  }
  assert.ok(distinct>mixedLand*.15,'the three mountain algorithms produce distinct landforms');
  assert.notEqual(Terrain.terrainKey(onlyNetwork,256),Terrain.terrainKey(onlyChain,256));
  const east={...baseMix,lightAngle:90},west={...baseMix,lightAngle:270};
  assert.equal(Terrain.terrainKey(east,256),Terrain.terrainKey(west,256),'moving light reuses the terrain field');
  const eastPixels=await Terrain.render(mixed,east),westPixels=await Terrain.render(mixed,west);
  let shadedDiff=0;for(let i=0;i<eastPixels.length;i+=4)if(eastPixels[i]!==westPixels[i])shadedDiff++;
  assert.ok(shadedDiff>mixedLand*.3,'opposite light bearings noticeably change shading');
  const unlitEast=await Terrain.render(mixed,{...east,hillshade:false}),unlitWest=await Terrain.render(mixed,{...west,hillshade:false});
  assert.deepEqual(unlitEast,unlitWest,'light bearing has no effect when hillshade is off');
  const ramp={size:128,heights:Float32Array.from({length:128*128},(_,i)=>1000+(i%128)*180)};
  const flatPalette={...baseMix,stops:[[-8000,'#808080'],[-1,'#808080'],[0,'#808080'],[8000,'#808080']],texture:false,coastline:false,fade:0};
  const westRamp=await Terrain.render(ramp,{...flatPalette,lightAngle:270}),eastRamp=await Terrain.render(ramp,{...flatPalette,lightAngle:90});
  assert.ok(westRamp[(64*128+64)*4]>eastRamp[(64*128+64)*4],'a slope rising eastward faces west and is brighter with a western source');
  const fallback=Terrain.validate({...baseMix,mountainNetwork:0,mountainChain:0,mountainStretch:0});
  assert.ok(fallback.mountainNetwork+fallback.mountainChain+fallback.mountainStretch>0);
  assert.equal(Terrain.validate({...baseMix,ocean:1}).ocean,10);
  assert.equal(Terrain.validate({...baseMix,ocean:30}).ocean,20);
  assert.equal(Terrain.validate({...baseMix,lightHeight:1}).lightHeight,10);
  assert.equal(Terrain.validate({...baseMix,lightHeight:80}).lightHeight,40);
  assert.equal(Terrain.validate({...baseMix,centralIslandSize:0}).centralIslandSize,.1);
  assert.equal(Terrain.validate({...baseMix,centralIslandSize:10}).centralIslandSize,1);
  const center=(256>>1)*256+(256>>1),islandField=await Terrain.generate(256,{...baseMix,centralIslandSize:1,islands:0});
  assert.ok(islandField.heights[center]>0,'the exact map center is always land');
  const nearCenter=Array.from({length:5},(_,i)=>islandField.heights[((128+i)*256)+128]);
  assert.ok(nearCenter.some(height=>height>0),'the forced center island has a connected land mass');
  assert.notEqual(Terrain.terrainKey({...baseMix,mountainRadius:60},256),Terrain.terrainKey({...baseMix,mountainRadius:82},256));
  assert.notEqual(Terrain.terrainKey({...baseMix,mountainVariance:0},256),Terrain.terrainKey({...baseMix,mountainVariance:20},256));
  assert.equal(Terrain.terrainKey({...baseMix,lightHeight:10},256),Terrain.terrainKey({...baseMix,lightHeight:40},256),'light height never changes the cached terrain field');
  const field=await Terrain.generate(128,{...Terrain.defaults(),seed:'png-test'});
  const separated={...Terrain.defaults(),stops:[[-8000,'#0000ff'],[-1,'#0000ff'],[0,'#ff0000'],[8000,'#ff0000']],hillshade:false,coastline:false,texture:false,fade:0};
  const seaPixels=await Terrain.render(field,separated);
  for(let i=0;i<field.heights.length;i++)if(field.heights[i]<0&&field.heights[i]>=-8000)assert.deepEqual([...seaPixels.subarray(i*4,i*4+3)],[0,0,255],'shallow water keeps sea colors');
  const bands=Terrain.colorTable([[-8000,'#0000ff'],[-1,'#00ffff'],[0,'#00ff00'],[100,'#ff0000'],[8000,'#ffffff']],'bands');
  assert.deepEqual([...bands.subarray(8100*3,8100*3+3)],[255,0,0],'a band starts at its exact height node');
  const contourPixels=await Terrain.render(field,{...Terrain.defaults(),contours:true});
  const plainPixels=await Terrain.render(field,Terrain.defaults());
  assert.notDeepEqual(contourPixels,plainPixels,'enabling contours changes the map');
  const png=parsePNG(Buffer.from(await Terrain.heightPNG(field)));
  assert.deepEqual(png.ihdr,{width:128,height:128,depth:16,colorType:0});
  assert.equal(png.raw.length,128*(128*2+1));
  const pngCenter=(128>>1)*128+(128>>1),row=(128>>1)*(128*2+1),offset=row+1+(128>>1)*2;
  const storedHeight=png.raw[offset]*256+png.raw[offset+1];
  assert.equal(storedHeight,Math.round(Math.max(0,Math.min(1,(field.heights[pngCenter]+8000)/16000))*65535),'the 16-bit PNG encodes elevation with the documented scale');
  assert.ok(results.every(r=>r.maximum>0));
  const messages=[],context={setTimeout,self:{postMessage:message=>messages.push(message)}};
  vm.runInNewContext(Terrain.workerSource,context);
  await context.self.onmessage({data:{id:7,type:'preview',size:128,settings:{...Terrain.defaults(),seed:'worker-test'}}});
  assert.ok(messages.some(message=>message.id===7&&message.type==='result'),'the generated web worker renders a preview result');
  assert.ok(!messages.find(message=>message.id===7&&message.type==='result').heights,'preview workers do not transfer an unused elevation buffer');
  assert.ok(messages.some(message=>message.id===7&&message.type==='progress'),'the generated web worker emits progress');
  console.log('Passed circular rim, precise area, connected sea, reproducibility and extreme-parameter cases; three mountain families with bounded soft overlap; movable light; 16-bit PNG CRC/data and Web Worker checks.');
})().catch(error=>{console.error(error);process.exitCode=1;});
