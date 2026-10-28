/* Ming World Atelier · deterministic procedural terrain · no external dependencies. */
(function(root,factory){
  const engine=factory();
  engine.workerSource='const MingTerrain=('+factory.toString()+')();('+workerMain.toString()+')();';
  if(typeof module==='object'&&module.exports)module.exports=engine;
  else root.MingTerrain=engine;
  function workerMain(){
    let preview=null;
    self.onmessage=async function(event){
      const {id,type,size,settings}=event.data;
      const progress=(value,detail)=>self.postMessage({id,type:'progress',value,detail});
      try{
        const key=MingTerrain.terrainKey(settings,size);
        let field=preview&&preview.key===key?preview:null;
        if(!field)field=await MingTerrain.generate(size,settings,progress);
        if(type==='preview')preview=field;
        if(type==='height'){
          progress(.91,'编码 16 位高度图…');
          const bytes=await MingTerrain.heightPNG(field);
          self.postMessage({id,type:'height',bytes,stats:field.stats},[bytes.buffer]);
        }else{
          const pixels=await MingTerrain.render(field,settings,progress);
          const payload={id,type:'result',pixels,size,stats:field.stats};
          const transfer=[pixels.buffer];
          self.postMessage(payload,transfer);
        }
      }catch(error){self.postMessage({id,type:'error',error:error.message||String(error)});}
    };
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION='1.4.0';
  // The old radius was .474 of the square width. .495 is the largest
  // practical expansion that keeps the circle inside every square export.
  const MAP_RADIUS=.495;
  const TAU=Math.PI*2;
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
  const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
  function hashSeed(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
  function random(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
  class Noise{
    constructor(seed){const rng=random(seed),p=new Uint8Array(256);for(let i=0;i<256;i++)p[i]=i;for(let i=255;i>0;i--){const j=Math.floor(rng()*(i+1));[p[i],p[j]]=[p[j],p[i]];}this.p=new Uint8Array(512);for(let i=0;i<512;i++)this.p[i]=p[i&255];}
    n(x,y){
      const F=.3660254037844386,G=.21132486540518713,s=(x+y)*F,i=Math.floor(x+s),j=Math.floor(y+s),t=(i+j)*G;
      const x0=x-(i-t),y0=y-(j-t),i1=x0>y0?1:0,j1=1-i1,x1=x0-i1+G,y1=y0-j1+G,x2=x0-1+2*G,y2=y0-1+2*G;
      const p=this.p,ii=i&255,jj=j&255;
      let v=0,q=.5-x0*x0-y0*y0;if(q>0){q*=q;v=q*q*this.dot(p[ii+p[jj]],x0,y0);}
      q=.5-x1*x1-y1*y1;if(q>0){q*=q;v+=q*q*this.dot(p[ii+i1+p[jj+j1]],x1,y1);}
      q=.5-x2*x2-y2*y2;if(q>0){q*=q;v+=q*q*this.dot(p[ii+1+p[jj+1]],x2,y2);}
      return 70*v;
    }
    dot(h,x,y){switch(h&7){case 0:return x+y;case 1:return -x+y;case 2:return x-y;case 3:return -x-y;case 4:return x;case 5:return -x;case 6:return y;default:return -y;}}
    fbm(x,y,octaves=5){let sum=0,a=.5;for(let i=0;i<octaves;i++){sum+=a*this.n(x,y);const nx=x*1.78-y*.92,ny=x*.92+y*1.78;x=nx+17.13;y=ny+9.21;a*=.5;}return sum;}
    ridge(x,y){let sum=0,a=.52,weight=1;for(let i=0;i<7;i++){let v=1-Math.abs(this.n(x,y));v*=v;v*=weight;weight=clamp(v*2.15);sum+=v*a;const xx=x*1.82-y*.84+11.9;y=x*.84+y*1.82+4.2;x=xx;a*=.51;}return sum;}
  }
  const presets={
    atlas:{name:'现代地形',background:'#eeede8',stops:[[-6000,'#245b75'],[-2400,'#347895'],[-800,'#579bb3'],[-180,'#a5cad0'],[-1,'#c4dad4'],[0,'#dddcc0'],[110,'#b5c18b'],[400,'#a7b17a'],[850,'#d1c797'],[1500,'#bcaa87'],[2400,'#998777'],[3300,'#c3bcb0'],[4300,'#f2f0e7']]},
    parchment:{name:'古典羊皮纸',background:'#e7d7b5',stops:[[-6000,'#385e61'],[-2400,'#557b78'],[-700,'#789b8e'],[-160,'#a8bba4'],[-1,'#c6cead'],[0,'#dcd4a9'],[130,'#c8cc9d'],[500,'#bbb885'],[1100,'#c5af7b'],[2000,'#a88c65'],[3100,'#856b53'],[4200,'#e4d8b6']]},
    ice:{name:'极地冰原',background:'#eff1f0',stops:[[-6000,'#18394f'],[-2200,'#285c76'],[-600,'#548f9f'],[-1,'#a9ced0'],[0,'#b4c6bc'],[300,'#b6c5c3'],[900,'#c8d2cb'],[1800,'#9eafab'],[2800,'#7f9194'],[3600,'#d8e2dd'],[4600,'#f8faf5']]},
    ember:{name:'赭土荒原',background:'#eee5d4',stops:[[-6000,'#253d4a'],[-2200,'#385d66'],[-600,'#658f8c'],[-1,'#b2bda0'],[0,'#dbcda5'],[200,'#cfc091'],[750,'#c0a16c'],[1500,'#b8865b'],[2600,'#996a50'],[3500,'#745347'],[4600,'#e1ccb2']]}
  };
  function defaults(){return{version:VERSION,seed:'MING-0207',ocean:15,coast:66,coastStretch:24,centralIslandSize:.5,mountains:68,mountainRadius:79,mountainVariance:10,mountainNetwork:40,mountainChain:44,mountainStretch:16,islands:48,relief:64,lightMode:'orbit',lightAngle:315,lightHeight:25,preset:'atlas',stops:presets.atlas.stops.map(s=>s.slice()),background:presets.atlas.background,colorMode:'smooth',hillshade:true,shade:62,contours:false,contourInterval:400,bathymetry:true,coastline:true,texture:true,ticks:false,legend:false,fade:12,exportSize:2880,transparent:false};}
  function validate(input){
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('项目格式不正确。');
    const out=defaults();
    if(typeof input.seed==='string')out.seed=input.seed.trim().slice(0,80)||out.seed;
    const bounds={ocean:[10,20],coast:[0,100],coastStretch:[0,100],centralIslandSize:[.1,1],mountains:[0,100],mountainRadius:[45,93],mountainVariance:[0,25],mountainNetwork:[0,100],mountainChain:[0,100],mountainStretch:[0,100],islands:[0,100],relief:[0,100],lightAngle:[0,359],lightHeight:[10,40],shade:[0,100],fade:[0,70]};
    for(const [k,[a,b]]of Object.entries(bounds))if(Number.isFinite(input[k]))out[k]=clamp(input[k],a,b);
    if(input.lightMode==='orbit'||input.lightMode==='top')out.lightMode=input.lightMode;
    for(const k of ['hillshade','contours','bathymetry','coastline','texture','ticks','legend','transparent'])if(typeof input[k]==='boolean')out[k]=input[k];
    if([200,400,800].includes(input.contourInterval))out.contourInterval=input.contourInterval;
    if([1536,2880,4096].includes(input.exportSize))out.exportSize=input.exportSize;
    if(['smooth','bands'].includes(input.colorMode))out.colorMode=input.colorMode;
    if(typeof input.background==='string'&&/^#[\da-f]{6}$/i.test(input.background))out.background=input.background;
    if(input.stops!==undefined){
      if(!Array.isArray(input.stops)||input.stops.length<4||input.stops.length>24)throw Error('色带需要 4～24 个有效高度节点。');
      out.stops=input.stops.map(s=>{if(!Array.isArray(s)||!Number.isFinite(s[0])||s[0]<-8000||s[0]>8000||!/^#[\da-f]{6}$/i.test(s[1]))throw Error('高度节点或颜色格式不正确。');return[s[0],s[1]];}).sort((a,b)=>a[0]-b[0]);
      if(out.stops.some((s,i)=>i&&s[0]===out.stops[i-1][0]))throw Error('高度节点不能重复。');
      if(!out.stops.some(s=>s[0]===0)||!out.stops.some(s=>s[0]<0)||!out.stops.some(s=>s[0]>0))throw Error('色带须包含 0 米、负高度和正高度。');
    }
    out.preset=presets[input.preset]?input.preset:'custom';
    if(out.mountainNetwork+out.mountainChain+out.mountainStretch<=0){out.mountainNetwork=40;out.mountainChain=44;out.mountainStretch=16;}
    return out;
  }
  function terrainKey(s,size){return JSON.stringify([VERSION,size,s.seed,s.ocean,s.coast,s.coastStretch,s.centralIslandSize,s.mountains,s.mountainRadius,s.mountainVariance,s.islands,s.relief,s.mountainNetwork,s.mountainChain,s.mountainStretch]);}
  function makeModel(s){
    const seed=hashSeed(s.seed),noise=new Noise(seed),detail=new Noise(seed^0xABC98388),rng=random(seed^0x642B1B3F),phase=rng()*TAU;
    const co=s.coast/100,isl=s.islands/100;
    const centralArea=s.centralIslandSize/100,islandRadius=Math.sqrt(centralArea);
    const targetEdgeRadius=Math.min(.91,Math.max(.28,Math.sqrt(s.ocean/100)+.08));
    let islandAngle=phase+1.1,coastRadius=targetEdgeRadius,chainStart=islandRadius*1.12+.02,chainEnd=targetEdgeRadius;
    // Low-frequency continental lobes plus domain-warped, scale-separated coast detail.
    function baseScore(x,y,r,includeIslets=true){
      if(r>=.974)return 10;
      const wx=noise.n(x*2.0+19.4,y*2.0+8.7),wy=noise.n(x*2.0-11.2,y*2.0-7.3);
      const u=x+wx*.065,v=y+wy*.065;
      const large=noise.n(u*2.45+21.8,v*2.45+3.1);
      const medium=noise.n(u*7.5-12.7,v*7.5+8.3);
      const fine=noise.fbm(u*23.8+15.3,v*23.8-2.8,5);
      let value=r+large*(.13+.31*co)+medium*(.008+.105*co)+fine*(.003+.11*co);
      if(includeIslets){
        const coastZone=Math.exp(-Math.pow((r-Math.sqrt(s.ocean/100))/.23,2));
        const islet=detail.fbm(u*45.0+6.3,v*45.0+5.6,3);
        value+=islet*(.001+.17*Math.pow(isl,.8))*coastZone;
      }
      return value;
    }
    function coastJitter(angle,salt){
      const x=Math.cos(angle),y=Math.sin(angle);
      return noise.n(x*3.2+salt,y*3.2-salt*.31)*(.025+.085*co)
        +detail.n(x*9.7-salt*.47,y*9.7+salt)*(.012+.07*co)
        +detail.n(x*25.3+salt*1.31,y*25.3-salt*.83)*(.006+.035*co);
    }
    function coastFold(x,y,r){
      const coastWeight=s.coastStretch/100;if(!coastWeight)return 0;
      const wx=noise.n(x*2.0+19.4,y*2.0+8.7),wy=noise.n(x*2.0-11.2,y*2.0-7.3),u=x+wx*.065,v=y+wy*.065;
      const bend=phase+.42*noise.n(u*1.7+8.4,v*1.7+21.2),cb=Math.cos(bend),sb=Math.sin(bend),along=u*cb+v*sb,across=-u*sb+v*cb;
      const fold=detail.ridge(along*10+across*1.8+23,across*34-along*1.7-11),modulation=detail.fbm(along*3.2+17,across*4.5-8,3)*.5+.5;
      const coastZone=Math.exp(-Math.pow((r-Math.sqrt(s.ocean/100))/.23,2));
      return(fold-.38)*(.015+.16*coastWeight)*coastZone*(.55+.45*modulation);
    }
    function mainlandScore(x,y,r){return baseScore(x,y,r,false)+coastFold(x,y,r);}
    const chainCount=Math.max(3,Math.round(3+isl*10)),chainRadius=.006+.011*isl+.004*co;
    function alignChain(threshold){
      let bestGap=Infinity,bestAngle=islandAngle,bestRadius=targetEdgeRadius;
      const rays=360,step=.004,maxRadius=.94;
      for(let i=0;i<rays;i++){
        const angle=i/rays*TAU,edge=islandRadius*(1+coastJitter(angle,17.4));
        let previous=Math.max(.12,edge*1.12),found=false;
        for(let r=previous;r<=maxRadius;r+=step){
          if(mainlandScore(Math.cos(angle)*r,Math.sin(angle)*r,r)>=threshold){
            let lo=previous,hi=r;
            for(let k=0;k<5;k++){const mid=(lo+hi)*.5;if(mainlandScore(Math.cos(angle)*mid,Math.sin(angle)*mid,mid)>=threshold)hi=mid;else lo=mid;}
            const gap=hi-edge;
            if(gap>0&&gap<bestGap){bestGap=gap;bestAngle=angle;bestRadius=hi;}
            found=true;break;
          }
          previous=r;
        }
        if(!found)continue;
      }
      islandAngle=bestAngle;coastRadius=bestRadius;
      chainStart=Math.max(islandRadius*1.12+chainRadius*.75,islandRadius+.012);
      chainEnd=Math.max(chainStart,coastRadius-chainRadius*1.15);
    }
    function centerFeatures(x,y){
      const islandEdge=islandRadius*(1+coastJitter(Math.atan2(y,x),17.4));
      const islandShape=smooth(1.06,.72,Math.hypot(x,y)/Math.max(.006,islandEdge));
      const chainWobble=.008+.012*isl;
      let chainShape=0;
      for(let i=1;i<=chainCount;i++){
        const t=chainCount===1?chainStart:chainStart+(i-1)/(chainCount-1)*(chainEnd-chainStart),wobble=chainWobble*noise.n(i*1.73+19.4,phase*1.7+i*2.1),cx=Math.cos(islandAngle)*t+Math.cos(islandAngle+Math.PI/2)*wobble,cy=Math.sin(islandAngle)*t+Math.sin(islandAngle+Math.PI/2)*wobble;
        const dx=x-cx,dy=y-cy,angle=Math.atan2(dy,dx),blobRadius=chainRadius*(.78+.22*detail.n(i*2.1+7.3,phase-4.8)*.5+.11*co)*(1+coastJitter(angle,31.7+i*4.9));
        chainShape=Math.max(chainShape,smooth(1.05,.68,Math.hypot(dx,dy)/Math.max(.004,blobRadius)));
      }
      return{islandShape,chainShape,mask:Math.max(islandShape,chainShape)};
    }
    function score(x,y,r){
      const features=centerFeatures(x,y);
      let value=baseScore(x,y,r);
      // Anisotropic coastal folds recreate the elongated shoreline look of
      // stretched mountain ridges without introducing disconnected lakes.
      const coastWeight=s.coastStretch/100;
      if(coastWeight&&features.mask<.22){
        value+=coastFold(x,y,r);
      }
      // The center island is hard-land; the chain is made from separate blobs
      // so it reads as an archipelago and never inherits stretched coast folds.
      value+=features.islandShape*(2.0+.35*Math.sqrt(centralArea))*(1+detail.n(x*55+7.8,y*55-4.3)*(.08+.12*co));
      value+=features.chainShape*(.92+.24*isl);
      if(r<.30)value-=smooth(.30,0,r)*.95*(1-Math.max(features.islandShape,features.chainShape));
      value+=smooth(.91,.974,r)*.36;
      return value;
    }
    const rawMix=[s.mountainNetwork,s.mountainChain,s.mountainStretch],mixTotal=rawMix[0]+rawMix[1]+rawMix[2],mix=rawMix.map(v=>v/mixTotal);
    // Coherent regions are randomly assigned to one of three ridge families.
    // Soft assignment keeps overlapping ranges as a continuous height field.
    function mountainBlend(x,y){
      const wx=noise.n(x*2.3+34.2,y*2.3-6.1)*.065,wy=noise.n(x*2.3-18.7,y*2.3+12.5)*.065;
      const u=x+wx,v=y+wy;
      const a=mix[0]*Math.exp(detail.n(u*3.15+12.1,v*3.15+41.3)*3.6);
      const b=mix[1]*Math.exp(detail.n(u*3.15-36.8,v*3.15+4.7)*3.6);
      const c=mix[2]*Math.exp(detail.n(u*3.15+7.4,v*3.15-21.9)*3.6);
      const sum=a+b+c;return[a/sum,b/sum,c/sum];
    }
    function elevation(x,y,r,landDelta,coastDistance){
      const wx=noise.n(x*3.1+31.2,y*3.1-8.2),wy=noise.n(x*3.1-4.1,y*3.1+18.4);
      const u=x+wx*.018,v=y+wy*.018;
      const rr=Math.hypot(u,v),a=Math.atan2(v,u),density=s.mountains/100;
      const meanRadius=s.mountainRadius/100,variance=s.mountainVariance/100;
      const radialShift=variance*(.56*Math.sin(a*3+phase)+.25*Math.sin(a*7-phase)+.19*noise.n(Math.cos(a)*4.2+17.4,Math.sin(a)*4.2-12.3));
      const arc=clamp(meanRadius+radialShift,.20,.93);
      const beltWidth=.055+.045*density+variance*.22;
      const belt=Math.exp(-Math.pow((rr-arc)/beltWidth,2));
      const patches=noise.fbm(u*3.1+22.5,v*3.1+5.4,3)*.5+.5;
      const continuity=smooth(.40-.10*density,.71-.12*density,patches);
      let mass=(belt*(.10+.90*continuity)+smooth(.69-.12*density,.91-.08*density,patches)*.22)*density*1.8;
      mass=clamp(mass);
      const foothills=noise.fbm(u*9.3-4.7,v*9.3+13.9,4)*.5+.5;
      const upland=smooth(.37,.79,noise.fbm(u*3.8-18.2,v*3.8+22.1,3)*.5+.5)*780;
      const plains=45+foothills*430+smooth(0,.13,coastDistance)*(105+upland);
      const [wn,wc,ws]=mountainBlend(u,v);
      // Retained original, cross-linked seven-octave network.
      const network=wn?clamp(detail.ridge(u*26+2.8,v*26-9.6)):0;
      // A wandering primary spine joins each chain segment, while fine spurs
      // fade into the surrounding foothills instead of forming a grid.
      const cross=rr-arc+.018*noise.n(Math.cos(a)*4+17,Math.sin(a)*4-12)
        +(wc?.009*detail.n(u*12+5,v*12-3):0);
      const chainAxis=wc?Math.exp(-Math.pow(cross/.026,2)):0;
      const chainFlanks=wc?Math.exp(-Math.pow(cross/.097,2)):0;
      const chainSpurs=wc?detail.ridge(u*19+31,v*19+7):0;
      const chain=wc?clamp(.10+chainAxis*(.65+.27*detail.fbm(u*15+4,v*15-9,3))+.30*chainFlanks*chainSpurs):0;
      // Anisotropic ridges intentionally recover the earlier elongated look.
      // A slowly varying regional direction avoids concentric or radial bands.
      const stretchBend=phase+(ws?.48*noise.n(u*1.5+8,v*1.5+21):0);
      const ca=Math.cos(stretchBend),sa=Math.sin(stretchBend);
      const along=u*ca+v*sa,across=-u*sa+v*ca;
      const stretched=ws?clamp((.32+.68*detail.ridge(along*10+across*1.6+19,across*32-along*1.8-13))*(.68+.32*(detail.fbm(along*3+18,across*4-6,3)*.5+.5))):0;
      // Blend both the base uplift and ridge relief; this avoids hard seams
      // even where independent mountain fields would otherwise overlap.
      const ridge=clamp(wn*network+wc*chain+ws*stretched);
      const rise=mass*(.20+.80*Math.pow(ridge,1.1))*(1900+s.relief*34);
      const coastRamp=smooth(0,.017,coastDistance);
      const h=(plains+rise)*(.22+.78*coastRamp);
      return Math.max(1,h*smooth(0,.007,coastDistance));
    }
      return{noise,detail,score,elevation,seed,protect:(x,y)=>centerFeatures(x,y).mask>.18,alignChain};
  }
  // 4-connected flood is used deliberately: diagonally touching seas do not form a channel.
  function flood(scores,size,threshold,mask,queue,guard){
    mask.fill(0);let head=0,tail=0,center=(size>>1)*size+(size>>1),start=center;
    // The center is intentionally land now. Find the nearest valid water
    // pixel so the central sea remains connected around the forced island.
    // Pick the deepest available water pixel in the inner basin instead of
    // the first perimeter pixel: the latter can be a one-pixel pocket beside
    // a protected island/chain at high resolution and strand the flood fill.
    if(scores[start]>=threshold){
      let found=false,best=Infinity;const centerCoord=size>>1,innerRadius=Math.floor(size*.18),r2=innerRadius*innerRadius;
      for(let dy=-innerRadius;dy<=innerRadius;dy++)for(let dx=-innerRadius;dx<=innerRadius;dx++){
        if(dx*dx+dy*dy>r2)continue;
        const p=(centerCoord+dy)*size+centerCoord+dx;
        if(!guard?.[p]&&scores[p]<threshold&&scores[p]<best){start=p;best=scores[p];found=true;}
      }
      // At unusually low thresholds, fall back to the nearest wet pixel.
      for(let radius=1;radius<size*.46&&!found;radius++){
        for(let dx=-radius;dx<=radius&&!found;dx++)for(const dy of [-radius,radius]){
          const x=centerCoord+dx,y=centerCoord+dy;if(x<0||x>=size||y<0||y>=size)continue;
          const p=y*size+x;if(!guard?.[p]&&scores[p]<threshold){start=p;found=true;break;}
        }
        for(let dy=-radius+1;dy<radius&&!found;dy++)for(const dx of [-radius,radius]){
          const x=centerCoord+dx,y=centerCoord+dy;if(x<0||x>=size||y<0||y>=size)continue;
          const p=y*size+x;if(!guard?.[p]&&scores[p]<threshold){start=p;found=true;break;}
        }
      }
      if(!found)return 0;
    }
    mask[start]=1;queue[tail++]=start;
    while(head<tail){
      const p=queue[head++],x=p%size;
      let q=p-1;if(x>0&&!mask[q]&&!guard?.[q]&&scores[q]<threshold){mask[q]=1;queue[tail++]=q;}
      q=p+1;if(x+1<size&&!mask[q]&&!guard?.[q]&&scores[q]<threshold){mask[q]=1;queue[tail++]=q;}
      q=p-size;if(q>=0&&!mask[q]&&!guard?.[q]&&scores[q]<threshold){mask[q]=1;queue[tail++]=q;}
      q=p+size;if(q<scores.length&&!mask[q]&&!guard?.[q]&&scores[q]<threshold){mask[q]=1;queue[tail++]=q;}
    }
    return tail;
  }
  function expandConnectedSea(scores,size,water,count,target,guard){
    if(count>=target)return count;
    const heap=[],total=scores.length;
    const offer=p=>{
      if(water[p]!==0||scores[p]>=9||(guard&&guard[p]))return;
      water[p]=2;
      let i=heap.length;heap.push(p);
      while(i>0){const parent=(i-1)>>1,q=heap[parent];if(scores[q]<=scores[p])break;heap[i]=q;i=parent;}
      heap[i]=p;
    };
    const offerNeighbors=p=>{
      const x=p%size;
      if(x)offer(p-1);
      if(x+1<size)offer(p+1);
      if(p>=size)offer(p-size);
      if(p+size<total)offer(p+size);
    };
    for(let p=0;p<total;p++)if(water[p]===1)offerNeighbors(p);
    while(count<target&&heap.length){
      const first=heap[0],last=heap.pop();
      if(heap.length){
        let i=0;
        while(true){let child=i*2+1;if(child>=heap.length)break;if(child+1<heap.length&&scores[heap[child+1]]<scores[heap[child]])child++;if(scores[last]<=scores[heap[child]])break;heap[i]=heap[child];i=child;}
        heap[i]=last;
      }
      water[first]=1;count++;offerNeighbors(first);
    }
    for(let p=0;p<total;p++)if(water[p]===2)water[p]=0;
    if(count!==target)throw Error('无法在正圆地图内扩展中央海域。');
    return count;
  }
  function calibrate(model,s){
    const n=320,total=n*n,score=new Float32Array(total),guard=new Uint8Array(total),mask=new Uint8Array(total),queue=new Uint32Array(total);let inside=0;
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){const xx=(x+.5-n/2)/(n*MAP_RADIUS),yy=(y+.5-n/2)/(n*MAP_RADIUS),r=Math.hypot(xx,yy),i=y*n+x;score[i]=r<=1?model.score(xx,yy,r):10;guard[i]=r<=1&&model.protect(xx,yy)?1:0;if(r<=1)inside++;}
    let lo=.20,hi=1.40,count=0,threshold=0;
    for(let k=0;k<17;k++){threshold=(lo+hi)/2;count=flood(score,n,threshold,mask,queue,guard);if(count/inside<s.ocean/100)lo=threshold;else hi=threshold;}
    return threshold;
  }
  // Chamfer distance to the nearest sea pixel, in units of 1/3 pixel. This also
  // makes coastal heights rise continuously after enclosed low basins are filled.
  function coastDistances(mask,n,toWater=true){
    const d=new Uint16Array(mask.length);for(let i=0;i<d.length;i++)d[i]=(!!mask[i]===toWater)?0:60000;
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=y*n+x;if(!d[i])continue;let v=d[i];if(x)v=Math.min(v,d[i-1]+3);if(y){v=Math.min(v,d[i-n]+3);if(x)v=Math.min(v,d[i-n-1]+4);if(x+1<n)v=Math.min(v,d[i-n+1]+4);}d[i]=v;}
    for(let y=n-1;y>=0;y--)for(let x=n-1;x>=0;x--){const i=y*n+x;if(!d[i])continue;let v=d[i];if(x+1<n)v=Math.min(v,d[i+1]+3);if(y+1<n){v=Math.min(v,d[i+n]+3);if(x)v=Math.min(v,d[i+n-1]+4);if(x+1<n)v=Math.min(v,d[i+n+1]+4);}d[i]=v;}
    return d;
  }
  async function generate(n,settings,onProgress=()=>{}){
    if(!Number.isInteger(n)||n<128||n>4096)throw Error('地图分辨率须为 128～4096。');
    const s=validate(settings),model=makeModel(s),length=n*n,scores=new Float32Array(length),heights=new Float32Array(length),guard=new Uint8Array(length),radius=n*MAP_RADIUS;
    onProgress(.02,'构建大陆骨架…');let threshold=calibrate(model,s);model.alignChain(threshold);threshold=calibrate(model,s);await pause();
    let inside=0;
    for(let y=0;y<n;y++){
      const yy=(y+.5-n/2)/radius;
      for(let x=0;x<n;x++){const xx=(x+.5-n/2)/radius,r=Math.hypot(xx,yy),i=y*n+x;if(r<=1){scores[i]=model.score(xx,yy,r);guard[i]=model.protect(xx,yy)?1:0;inside++;}else scores[i]=10;}
      if(y%48===0){onProgress(.05+.27*y/n,'刻画半岛、海湾与群岛…');await pause();}
    }
    onProgress(.34,'校准中央海域面积与连通性…');await pause();
    const water=new Uint8Array(length),queue=new Uint32Array(length),targetCount=Math.round(s.ocean/100*inside);
    let span=.055,lo,hi,count=0;
    lo=threshold-span;hi=threshold+span;
    let lowCount=flood(scores,n,lo,water,queue,guard),highCount=flood(scores,n,hi,water,queue,guard);
    for(let k=0;k<5&&lowCount>=targetCount;k++){
      hi=lo;highCount=lowCount;span*=2;lo-=span;lowCount=flood(scores,n,lo,water,queue,guard);
    }
    for(let k=0;k<5&&highCount<targetCount;k++){
      lo=hi;lowCount=highCount;span*=2;hi+=span;highCount=flood(scores,n,hi,water,queue,guard);
    }
    if(lowCount>=targetCount||highCount<targetCount)throw Error('无法校准中央海域面积，请更换种子。 ('+lowCount+'/'+highCount+'，目标 '+targetCount+')');
    let bestThreshold=lo,bestCount=lowCount;
    for(let k=0;k<8&&bestCount<targetCount;k++){
      threshold=(lo+hi)/2;count=flood(scores,n,threshold,water,queue,guard);
      if(count<=targetCount){lo=threshold;bestThreshold=threshold;bestCount=count;}
      else hi=threshold;
      await pause();
    }
    count=flood(scores,n,bestThreshold,water,queue,guard);
    if(count>targetCount)throw Error('中央海域校准超出目标面积。');
    count=expandConnectedSea(scores,n,water,count,targetCount,guard);
    const distance=coastDistances(water,n),seaDistance=coastDistances(water,n,false);let maximum=0,landCount=0,mountainCount=0;
    for(let y=0;y<n;y++){
      const yy=(y+.5-n/2)/radius;
      for(let x=0;x<n;x++){
        const xx=(x+.5-n/2)/radius,r=Math.hypot(xx,yy),i=y*n+x;
        if(r>1){heights[i]=-9000;continue;}
        const delta=scores[i]-threshold;
        if(water[i]){
          const d=seaDistance[i]/(radius*3),shelf=smooth(0,.32,d),undulation=model.noise.fbm(xx*5.1+9.2,yy*5.1-3.4,3);
          heights[i]=-Math.max(2,15+4900*Math.pow(shelf,.73)+undulation*280*smooth(0,.05,d));
        }else{
          const coastDistance=distance[i]/(radius*3),h=model.elevation(xx,yy,r,Math.max(0,delta),coastDistance);
          heights[i]=h;maximum=Math.max(maximum,h);landCount++;if(h>1500)mountainCount++;
        }
      }
      if(y%36===0){onProgress(.42+.40*y/n,'雕刻山脊与低地地形…');await pause();}
    }
    const stats={seed:s.seed,size:n,ocean:count/inside*100,land:landCount/inside*100,maximum:Math.round(maximum),mountainArea:mountainCount/Math.max(1,landCount)*100,inside,waterPixels:count,threshold,version:VERSION};
    onProgress(.84,'完成地形，准备设色…');return{key:terrainKey(s,n),size:n,heights,stats};
  }
  function rgb(hex){return[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];}
  function colorTable(stops,mode){
    const sorted=stops.slice().sort((a,b)=>a[0]-b[0]).map(([h,c])=>[h,rgb(c)]),lut=new Uint8Array(16001*3);
    // Separate sea and land stops to retain a crisp 0 m coastline.
    const sea=sorted.filter(s=>s[0]<0),land=sorted.filter(s=>s[0]>=0);
    for(let h=-8000;h<=8000;h++){
      const a=h<0?sea:land;let i=0;while(i<a.length-1&&h>=a[i+1][0])i++;
      const b=a[Math.min(i+1,a.length-1)],c=a[i];let t=b[0]===c[0]?0:clamp((h-c[0])/(b[0]-c[0]));if(mode==='bands')t=0;
      const p=(h+8000)*3;for(let k=0;k<3;k++)lut[p+k]=Math.round(c[1][k]+(b[1][k]-c[1][k])*t);
    }return lut;
  }
  async function render(field,settings,onProgress=()=>{}){
    const s=validate(settings),n=field.size,h=field.heights,pixels=new Uint8ClampedArray(n*n*4),lut=colorTable(s.stops,s.colorMode),bg=rgb(s.background),radius=n*MAP_RADIUS,px=1/radius;
    const strength=s.hillshade?s.shade/100:0,seed=hashSeed(s.seed),interval=s.contourInterval;
    // Compass bearing: 0° north, 90° east. Orbit mode keeps the legacy
    // fixed-radius source; top mode places it above the map center.
    const bearing=s.lightAngle*Math.PI/180;
    const sourceX=s.lightMode==='top'?0:Math.sin(bearing)*.8;
    const sourceY=s.lightMode==='top'?0:-Math.cos(bearing)*.8;
    // Compress the vertical response in center-top mode; large heights add
    // directionality without driving the diffuse term toward white.
    const sourceZ=s.lightMode==='top'?.18+1.15*Math.sqrt(s.lightHeight/100):.8;
    const sample=(x,y,fallback)=>{const v=h[clamp(y,0,n-1)*n+clamp(x,0,n-1)];return v<-8000?fallback:v;};
    for(let y=0;y<n;y++){
      const yy=(y+.5-n/2)/radius;
      for(let x=0;x<n;x++){
        const xx=(x+.5-n/2)/radius,r=Math.hypot(xx,yy),i=y*n+x,p=i*4,z=h[i];
        if(r>1){pixels[p]=bg[0];pixels[p+1]=bg[1];pixels[p+2]=bg[2];pixels[p+3]=s.transparent?0:255;continue;}
        const land=z>=0;
        let colorZ=z;if(!land){if(!s.bathymetry)colorZ=-2800;else if(s.colorMode==='smooth')colorZ=Math.min(-1,Math.round(z/260)*260);}
        const c=(clamp(Math.round(colorZ),-8000,8000)+8000)*3;
        let red=lut[c],green=lut[c+1],blue=lut[c+2];
        const left=sample(x-1,y,z),right=sample(x+1,y,z),up=sample(x,y-1,z),down=sample(x,y+1,z);
        let tint=1;
        if(land&&strength){
          const lightDistance=Math.hypot(sourceX-xx,sourceY-yy,sourceZ);
          const lightX=(sourceX-xx)/lightDistance,lightY=(sourceY-yy)/lightDistance,lightZ=sourceZ/lightDistance;
          const dx=(right-left)/(2*px*135000),dy=(down-up)/(2*px*135000);
          const normal=Math.sqrt(dx*dx+dy*dy+1),light=(-dx*lightX-dy*lightY+lightZ)/normal;
          const step=Math.max(2,Math.round(n/240));
          const dx2=(sample(x+step,y,z)-sample(x-step,y,z))/(2*step*px*135000),dy2=(sample(x,y+step,z)-sample(x,y-step,z))/(2*step*px*135000);
          const light2=(-dx2*lightX-dy2*lightY+lightZ)/Math.sqrt(dx2*dx2+dy2*dy2+1);
          const lightGain=s.lightMode==='top'?.68:.90,detailGain=s.lightMode==='top'?.20:.30;
          tint=1+strength*((light-.68)*lightGain+(light2-.68)*detailGain);
          if(s.lightMode==='top')tint=clamp(tint,.70,1.28);
          // High-frequency curvature gives fine branching ridges a small ambient shadow.
          const concavity=clamp((left+right+up+down-4*z)/90,-.13,.16);
          tint-=Math.max(0,concavity)*strength*.24;
        }
        if(s.texture){let q=Math.imul((x+seed)^(y*374761393),668265263);q=(q^(q>>>13))>>>0;tint+=((q&255)/255-.5)*(s.preset==='parchment'?.036:.019);}
        red*=tint;green*=tint;blue*=tint;
        if(s.contours&&land&&z>45){
          const gradient=Math.max(1,Math.hypot(right-left,down-up)*.5),difference=Math.abs(z-Math.round(z/interval)*interval);
          const width=(.43+.23*Math.max(0,Math.round(z/interval)%5===0))*n/1280;
          const alpha=clamp(width+.5-difference/gradient)*.25;
          red=red*(1-alpha)+61*alpha;green=green*(1-alpha)+70*alpha;blue=blue*(1-alpha)+57*alpha;
        }
        if(s.coastline){
          const crosses=land&&(left<0||right<0||up<0||down<0);
          if(crosses){const a=.40;red=red*(1-a)+225*a;green=green*(1-a)+227*a;blue=blue*(1-a)+192*a;}
        }
        if(s.fade&&r>.88){const a=smooth(.88,1,r)*s.fade/100;red=red*(1-a)+bg[0]*a;green=green*(1-a)+bg[1]*a;blue=blue*(1-a)+bg[2]*a;}
        const coverage=clamp((1-r)*radius+.5);
        if(s.transparent){pixels[p]=red;pixels[p+1]=green;pixels[p+2]=blue;pixels[p+3]=Math.round(255*coverage);}else{pixels[p]=red*coverage+bg[0]*(1-coverage);pixels[p+1]=green*coverage+bg[1]*(1-coverage);pixels[p+2]=blue*coverage+bg[2]*(1-coverage);pixels[p+3]=255;}
      }
      if(y%48===0){onProgress(.85+.14*y/n,'绘制分层设色与地形晕渲…');await pause();}
    }
    onProgress(1,'地图已就绪');return pixels;
  }
  function crc32(bytes){let crc=0xFFFFFFFF;for(let i=0;i<bytes.length;i++){crc^=bytes[i];for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xEDB88320:0);}return(crc^0xFFFFFFFF)>>>0;}
  function chunk(type,data){const out=new Uint8Array(data.length+12),view=new DataView(out.buffer);view.setUint32(0,data.length);for(let i=0;i<4;i++)out[4+i]=type.charCodeAt(i);out.set(data,8);view.setUint32(out.length-4,crc32(out.subarray(4,out.length-4)));return out;}
  async function heightPNG(field){
    if(typeof CompressionStream==='undefined')throw Error('当前浏览器不支持 16 位 PNG 压缩，请使用新版 Edge 或 Chrome。');
    const n=field.size,stride=n*2+1,raw=new Uint8Array(stride*n);for(let y=0;y<n;y++){let p=y*stride+1;for(let x=0;x<n;x++){const z=field.heights[y*n+x],v=z<-8000?0:Math.round(clamp((z+8000)/16000)*65535);raw[p++]=v>>>8;raw[p++]=v&255;}}
    const compressed=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    const header=new Uint8Array(13),view=new DataView(header.buffer);view.setUint32(0,n);view.setUint32(4,n);header[8]=16;header[9]=0;
    const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('tEXt',new TextEncoder().encode('Description\0Ming heightmap; grayscale16; meters = value / 65535 * 16000 - 8000; outside=0; version='+VERSION)),chunk('IDAT',compressed),chunk('IEND',new Uint8Array(0))];
    const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}return out;
  }
  return{VERSION,MAP_RADIUS,Noise,presets,defaults,validate,terrainKey,generate,render,heightPNG,hashSeed,rgb,colorTable};
});
