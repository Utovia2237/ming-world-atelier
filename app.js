(function(){
  'use strict';
  const $=id=>document.getElementById(id),Engine=window.MingTerrain,STORE='ming-world-atelier-v1';
  let settings=Engine.defaults(),worker=null,workerURL=null,pending=null,serial=0,debounce=null,toastTimer=null,previewStats=null,exporting=false,previewTicket=0,previewSettingsKey=null,dirty=false;
  let view={zoom:1,x:0,y:0},drag=null;
  const ranges=['ocean','coast','coastStretch','centralIslandSize','mountains','mountainRadius','mountainVariance','islands','relief','shade','fade'];
  const mixRanges=['mountainNetwork','mountainChain','mountainStretch'];
  const bools=['hillshade','contours','bathymetry','coastline','texture','ticks','legend','transparent'];
  const status=$('map-state'),canvas=$('map'),loading=$('loading');
  function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4200);}
  function saveLocal(){try{localStorage.setItem(STORE,JSON.stringify(settings));}catch{}}
  function previewKey(value){const copy=structuredClone(value);delete copy.exportSize;return JSON.stringify(copy);}
  function migrateProject(input){
    if(input.version==='1.0.0')return{...input,version:Engine.VERSION,mountainNetwork:100,mountainChain:0,mountainStretch:0,coastStretch:0,centralIslandSize:10,mountainRadius:79,mountainVariance:10,lightMode:'orbit',lightAngle:315,lightHeight:80};
    if(['1.1.0','1.2.0','1.3.0'].includes(input.version))return{...input,version:Engine.VERSION};
    return input;
  }
  try{const saved=localStorage.getItem(STORE);if(saved)settings=Engine.validate(migrateProject(JSON.parse(saved)));}catch{}
  function tab(name){for(const button of document.querySelectorAll('[data-tab]')){const active=button.dataset.tab===name;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));}for(const panel of document.querySelectorAll('.panel'))panel.classList.toggle('active',panel.id==='panel-'+name);}
  function sliderLabel(id){const input=$(id);$(id+'-value').textContent=input.value+'%';input.style.setProperty('--range',((input.value-input.min)/(input.max-input.min)*100)+'%');}
  function boundedValue(id){const input=$(id),value=Math.max(Number(input.min),Math.min(Number(input.max),Number(input.value)));input.value=String(value);return value;}
  function markDirty(){clearTimeout(debounce);dirty=true;saveLocal();status.textContent='待生成 · 点击“生成世界”应用修改';}
  function rebalanceMountainMix(changedId){
    const others=mixRanges.filter(id=>id!==changedId),value=Math.max(0,Math.min(100,Number($(changedId).value)));
    settings[changedId]=value;
    const remaining=100-value,total=others.reduce((sum,id)=>sum+settings[id],0);
    if(total<=0){settings[others[0]]=remaining;settings[others[1]]=0;}
    else{settings[others[0]]=Math.round(remaining*settings[others[0]]/total);settings[others[1]]=remaining-settings[others[0]];}
  }
  function normalizeMountainMix(){
    const total=mixRanges.reduce((sum,id)=>sum+settings[id],0);
    const first=Math.round(100*settings[mixRanges[0]]/total),second=Math.round(100*settings[mixRanges[1]]/total);
    settings[mixRanges[0]]=first;settings[mixRanges[1]]=second;settings[mixRanges[2]]=100-first-second;
  }
  function syncMountainMix(){
    for(const id of mixRanges){$(id).value=settings[id];$(id+'-value').textContent=settings[id].toFixed(1)+'%';$(id).style.setProperty('--range',settings[id]+'%');}
  }
  function syncLightDirection(){
    const angle=settings.lightAngle,cardinal=['北','东北','东','东南','南','西南','西','西北'][Math.round(angle/45)%8],radians=angle*Math.PI/180;
    const topMode=settings.lightMode==='top';
    $('light-mode').value=settings.lightMode;
    $('light-angle').value=angle;$('light-angle-value').textContent=angle+'° · '+cardinal;
    $('light-height').value=settings.lightHeight;$('light-height-value').textContent=settings.lightHeight+'%';
    $('light-dot').style.left='calc(50% + '+(48*Math.sin(radians)).toFixed(2)+'px)';
    $('light-dot').style.top='calc(50% - '+(48*Math.cos(radians)).toFixed(2)+'px)';
    $('light-direction-dial').setAttribute('aria-valuenow',String(angle));
    $('light-direction-dial').setAttribute('aria-valuetext',angle+'°，'+cardinal);
    $('light-angle').disabled=!settings.hillshade||topMode;$('light-direction-dial').disabled=!settings.hillshade||topMode;
    $('light-height').disabled=!settings.hillshade||!topMode;
    $('light-mode-note').textContent=topMode?'光源位于地图中心正上方；用高度滑块改变入射角。':'拖动圆周上的光点，或使用滑块。0° 为北，90° 为东。';
  }
  function syncUI(){
    normalizeMountainMix();
    $('seed').value=settings.seed;
    for(const id of ranges){$(id).value=settings[id];sliderLabel(id);}
    syncMountainMix();syncLightDirection();
    for(const id of bools)$(id).checked=settings[id];
    $('contour-interval').value=settings.contourInterval;$('color-mode').value=settings.colorMode;$('background-color').value=settings.background;$('export-size').value=settings.exportSize;
    paletteUI();presetUI();
  }
  function presetUI(){
    const group=$('preset-grid');group.replaceChildren();
    for(const [id,p]of Object.entries(Engine.presets)){
      const button=document.createElement('button');button.className='preset-card'+(settings.preset===id?' active':'');button.dataset.preset=id;button.setAttribute('aria-pressed',String(settings.preset===id));
      const swatches=document.createElement('span');swatches.className='preset-swatches';for(const stop of p.stops.filter((_,i)=>i%2===0)){const color=document.createElement('i');color.style.background=stop[1];swatches.append(color);}button.append(swatches,document.createTextNode(p.name));
      button.onclick=()=>{settings.preset=id;settings.stops=p.stops.map(s=>s.slice());settings.background=p.background;settings.texture=true;settings.fade=id==='parchment'?22:12;syncUI();markDirty();};group.append(button);
    }
  }
  function paletteUI(){
    const list=$('color-stops');list.replaceChildren();settings.stops.sort((a,b)=>a[0]-b[0]);
    settings.stops.forEach((stop,index)=>{
      const row=document.createElement('div');row.className='color-stop';
      const height=document.createElement('input');height.type='number';height.value=stop[0];height.min=-8000;height.max=8000;height.step=1;height.setAttribute('aria-label','色带 '+(index+1)+' 高度');if(stop[0]===0){height.readOnly=true;height.title='海平面节点固定为 0 米';}
      const picker=document.createElement('input');picker.type='color';picker.value=stop[1];picker.setAttribute('aria-label',stop[0]+' 米的颜色');
      const hex=document.createElement('input');hex.type='text';hex.value=stop[1];hex.maxLength=7;hex.spellcheck=false;hex.setAttribute('aria-label',stop[0]+' 米的十六进制颜色');
      const remove=document.createElement('button');remove.className='remove-stop';remove.textContent='×';remove.setAttribute('aria-label','删除 '+stop[0]+' 米节点');remove.disabled=stop[0]===0||settings.stops.length<=4||(stop[0]<0&&settings.stops.filter(s=>s[0]<0).length===1)||(stop[0]>0&&settings.stops.filter(s=>s[0]>0).length===1);
      height.onchange=()=>{const value=Number(height.value);if(!height.value.trim()||!Number.isFinite(value)||value<-8000||value>8000||settings.stops.some((s,i)=>i!==index&&s[0]===value)){height.value=stop[0];toast('高度须在 −8000～8000 米内，且节点不可重复。');return;}if((value>0&&stop[0]<0&&settings.stops.filter(s=>s[0]<0).length===1)||(value<0&&stop[0]>0&&settings.stops.filter(s=>s[0]>0).length===1)){height.value=stop[0];toast('海底和陆地须各保留至少一个颜色节点。');return;}stop[0]=value;settings.preset='custom';paletteUI();presetUI();markDirty();};
      picker.oninput=()=>{stop[1]=picker.value;hex.value=picker.value;settings.preset='custom';presetUI();markDirty();};
      hex.onchange=()=>{if(!/^#[\da-f]{6}$/i.test(hex.value)){hex.value=stop[1];toast('请输入 #RRGGBB 格式的颜色。');return;}stop[1]=hex.value;picker.value=hex.value;settings.preset='custom';presetUI();markDirty();};
      remove.onclick=()=>{settings.stops.splice(index,1);settings.preset='custom';paletteUI();presetUI();markDirty();};row.append(height,picker,hex,remove);list.append(row);
    });$('add-stop').disabled=settings.stops.length>=24;
  }
  function progress(value,detail,title){loading.classList.remove('hidden');$('progress').style.width=Math.max(3,Math.round(value*100))+'%';$('loading-detail').textContent=detail;if(title)$('loading-title').textContent=title;}
  function hideProgress(){loading.classList.add('hidden');}
  function abortTask(){if(worker){worker.terminate();worker=null;}if(pending){pending.reject(new DOMException('已取消','AbortError'));pending=null;}}
  function getWorker(){
    if(worker)return worker;
    if(!window.Worker)throw Error('此浏览器不支持后台线程。');
    if(!workerURL)workerURL=URL.createObjectURL(new Blob([Engine.workerSource],{type:'text/javascript'}));
    worker=new Worker(workerURL);
    worker.onmessage=event=>{const msg=event.data;if(!pending||msg.id!==pending.id)return;if(msg.type==='progress'){progress(msg.value,msg.detail);return;}const task=pending;pending=null;if(msg.type==='error')task.reject(Error(msg.error));else task.resolve(msg);};
    worker.onerror=event=>{if(pending){const task=pending;pending=null;task.reject(Error(event.message||'地图线程加载失败。请使用 Edge 或 Chrome。'));}if(worker)worker.terminate();worker=null;};return worker;
  }
  function compute(type,size,s){
    if(pending)abortTask();const id=++serial;
    return new Promise((resolve,reject)=>{try{const w=getWorker();pending={id,resolve,reject};w.postMessage({id,type,size,settings:s});}catch(error){reject(error);}});
  }
  function collectSeed(){const value=$('seed').value.trim();settings.seed=value||'MING-0207';$('seed').value=settings.seed;}
  function requestPreview(immediate=false){
    if(exporting)return;
    clearTimeout(debounce);
    if(immediate){renderPreview();return;}
    markDirty();
  }
  async function renderPreview(){
    if(exporting)return;collectSeed();saveLocal();const snapshot=structuredClone(settings),ticket=++previewTicket;
    window.mingApp.ready=false;window.mingApp.error=null;status.textContent='正在生成';progress(.01,'计算圆形大陆与中央海洋…','正在塑造世界');
    try{
      const result=await compute('preview',1280,snapshot);if(ticket!==previewTicket)return;
      paint(canvas,result.pixels,result.size,snapshot);previewStats=result.stats;previewSettingsKey=previewKey(snapshot);dirty=previewSettingsKey!==previewKey(settings);
      $('meta-seed').textContent=snapshot.seed;$('meta-seed').title=snapshot.seed;$('meta-ratio').textContent=result.stats.ocean.toFixed(1)+'% / '+result.stats.land.toFixed(1)+'%';$('meta-height').textContent=result.stats.maximum.toLocaleString()+' m';$('meta-resolution').textContent=result.size+' × '+result.size;status.textContent=dirty?'待生成 · 点击“生成世界”应用修改':'世界已就绪';hideProgress();window.mingApp.stats=previewStats;window.mingApp.ready=true;
    }catch(error){if(error.name==='AbortError')return;hideProgress();status.textContent='生成失败';toast('生成失败：'+error.message);console.error(error);window.mingApp.error=error.message;}
  }
  function paint(target,pixels,size,s){target.width=size;target.height=size;const ctx=target.getContext('2d');ctx.putImageData(new ImageData(pixels,size,size),0,0);drawDecoration(ctx,size,s);}
  function drawDecoration(ctx,n,s){
    const c=n/2,r=n*Engine.MAP_RADIUS,ink=s.preset==='parchment'?'#57452d':'#263f37';ctx.save();ctx.strokeStyle=ink;ctx.globalAlpha=.78;ctx.lineWidth=n/3000;ctx.beginPath();ctx.arc(c,c,r,0,Math.PI*2);ctx.stroke();
    if(s.ticks){
      ctx.globalAlpha=.38;ctx.lineWidth=n/2400;
      for(let i=0;i<4;i++){const a=i*Math.PI/4,x=Math.cos(a)*r,y=Math.sin(a)*r;ctx.beginPath();ctx.moveTo(c-x,c-y);ctx.lineTo(c+x,c+y);ctx.stroke();}
      ctx.globalAlpha=.62;ctx.beginPath();ctx.arc(c,c,r*.5,0,Math.PI*2);ctx.stroke();
      ctx.globalAlpha=.88;ctx.lineWidth=n/2600;
      for(let i=0;i<180;i++){const a=i/180*Math.PI*2,length=n*(i%15===0?.008:i%5===0?.0045:.002);ctx.beginPath();ctx.moveTo(c+Math.cos(a)*r,c+Math.sin(a)*r);ctx.lineTo(c+Math.cos(a)*(r-length),c+Math.sin(a)*(r-length));ctx.stroke();}
    }
    if(s.legend){const x=n*.045,y=n*.90,w=n*.20,h=n*.009;ctx.fillStyle=s.background;ctx.globalAlpha=.93;ctx.fillRect(x-n*.009,y-n*.02,w+n*.018,n*.063);ctx.globalAlpha=1;const gradient=ctx.createLinearGradient(x,y,x+w,y),colors=Engine.colorTable(s.stops,'smooth');for(let i=0;i<=20;i++){const z=-5000+10000*i/20,p=(Math.round(z)+8000)*3;gradient.addColorStop(i/20,'rgb('+colors[p]+','+colors[p+1]+','+colors[p+2]+')');}ctx.fillStyle=gradient;ctx.fillRect(x,y,w,h);ctx.font=(n*.009)+'px "Segoe UI",sans-serif';ctx.fillStyle='#576957';ctx.textBaseline='top';ctx.textAlign='left';ctx.fillText('−5000',x,y+h+n*.006);ctx.textAlign='center';ctx.fillText('0',x+w*.5,y+h+n*.006);ctx.textAlign='right';ctx.fillText('5000 m',x+w,y+h+n*.006);}
    ctx.restore();
  }
  function filename(s,ending){return'ming-'+s.seed.replace(/[^\p{L}\p{N}_-]/gu,'-').slice(0,50)+ending;}
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);}
  function setExportBusy(busy){exporting=busy;for(const el of document.querySelectorAll('.sidebar input,.sidebar select,.sidebar button,#export-top')){if(busy){el.dataset.wasDisabled=String(el.disabled);el.disabled=true;}else{el.disabled=el.dataset.wasDisabled==='true';delete el.dataset.wasDisabled;}}}
  async function exportMap(type){
    if(exporting)return;clearTimeout(debounce);collectSeed();saveLocal();const s=structuredClone(settings);setExportBusy(true);++previewTicket;status.textContent='高清渲染中';progress(.01,'按目标像素重新计算细节…',type==='height'?'正在导出高度图':'正在绘制高清地图');
    try{
      const result=await compute(type==='height'?'height':'export',s.exportSize,s);
      if(type==='height'){download(new Blob([result.bytes],{type:'image/png'}),filename(s,'-height16-'+s.exportSize+'.png'));toast('16 位高度图已导出。');}
      else{const out=document.createElement('canvas');paint(out,result.pixels,result.size,s);progress(1,'正在编码 PNG…');const blob=await new Promise((resolve,reject)=>out.toBlob(b=>b?resolve(b):reject(Error('PNG 编码失败。')),'image/png'));download(blob,filename(s,'-'+result.size+'px.png'));toast(result.size+' × '+result.size+' 高清地图已导出。');out.width=1;out.height=1;}status.textContent='世界已就绪';
    }catch(error){if(error.name!=='AbortError'){toast('导出失败：'+error.message);console.error(error);status.textContent='导出失败';}}finally{
      setExportBusy(false);hideProgress();
      if(previewSettingsKey!==previewKey(settings)){dirty=true;status.textContent='待生成 · 点击“生成世界”应用修改';}
      else if(window.mingApp.ready)status.textContent='世界已就绪';
    }
  }
  for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>tab(button.dataset.tab));
  $('seed').addEventListener('input',markDirty);
  for(const id of ranges)$(id).addEventListener('input',()=>{settings[id]=boundedValue(id);sliderLabel(id);markDirty();});
  for(const id of mixRanges)$(id).addEventListener('input',()=>{rebalanceMountainMix(id);syncMountainMix();markDirty();});
  $('light-angle').addEventListener('input',()=>{settings.lightAngle=Number($('light-angle').value);syncLightDirection();markDirty();});
  $('light-mode').addEventListener('change',()=>{settings.lightMode=$('light-mode').value;syncLightDirection();markDirty();});
  $('light-height').addEventListener('input',()=>{settings.lightHeight=boundedValue('light-height');syncLightDirection();markDirty();});
  const dial=$('light-direction-dial');let dialDragging=false;
  function pointLight(event){const rect=dial.getBoundingClientRect(),dx=event.clientX-(rect.left+rect.width/2),dy=event.clientY-(rect.top+rect.height/2);if(dx===0&&dy===0)return;settings.lightAngle=(Math.round(Math.atan2(dx,-dy)*180/Math.PI)+360)%360;syncLightDirection();markDirty();}
  dial.addEventListener('pointerdown',event=>{if(dial.disabled)return;dialDragging=true;dial.setPointerCapture(event.pointerId);pointLight(event);});
  dial.addEventListener('pointermove',event=>{if(dialDragging)pointLight(event);});
  for(const type of ['pointerup','pointercancel'])dial.addEventListener(type,()=>{dialDragging=false;});
  dial.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key)||dial.disabled)return;event.preventDefault();settings.lightAngle=(settings.lightAngle+(event.key==='ArrowRight'?5:355))%360;syncLightDirection();markDirty();});
  for(const id of bools)$(id).addEventListener('change',()=>{settings[id]=$(id).checked;if(id==='hillshade')syncLightDirection();markDirty();});
  $('contour-interval').onchange=()=>{settings.contourInterval=Number($('contour-interval').value);markDirty();};$('color-mode').onchange=()=>{settings.colorMode=$('color-mode').value;markDirty();};$('background-color').oninput=()=>{settings.background=$('background-color').value;markDirty();};$('export-size').onchange=()=>{settings.exportSize=Number($('export-size').value);saveLocal();};
  $('add-stop').onclick=()=>{const sorted=settings.stops.slice().sort((a,b)=>a[0]-b[0]);let gap=0,value=500;for(let i=1;i<sorted.length;i++)if(sorted[i][0]-sorted[i-1][0]>gap){gap=sorted[i][0]-sorted[i-1][0];value=Math.round((sorted[i][0]+sorted[i-1][0])/2);}if(settings.stops.some(s=>s[0]===value)){value=1;while(settings.stops.some(s=>s[0]===value))value++;}settings.stops.push([value,'#b7bd94']);settings.preset='custom';paletteUI();presetUI();markDirty();};
  $('generate').onclick=()=>{collectSeed();requestPreview(true);};$('seed').onkeydown=e=>{if(e.key==='Enter'){collectSeed();requestPreview(true);}};
  $('random-seed').onclick=()=>{const a=new Uint32Array(1);crypto.getRandomValues(a);settings.seed='MING-'+a[0].toString(36).toUpperCase();$('seed').value=settings.seed;fit();requestPreview(true);};
  $('export-top').onclick=()=>{tab('export');if(innerWidth<701)$('panel-export').scrollIntoView({behavior:'smooth',block:'start'});};$('export-png').onclick=()=>exportMap('png');$('export-height').onclick=()=>exportMap('height');
  $('save-project').onclick=()=>{collectSeed();download(new Blob([JSON.stringify({format:'ming-world-atelier',...settings},null,2)],{type:'application/json'}),filename(settings,'.json'));toast('项目参数已保存。');};$('load-project').onclick=()=>$('project-file').click();
  $('project-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>100000)throw Error('项目文件过大。');const parsed=JSON.parse(await file.text());if(parsed.format!=='ming-world-atelier')throw Error('请选择世界工坊保存的项目。');if(!['1.0.0','1.1.0','1.2.0',Engine.VERSION].includes(parsed.version))throw Error('项目版本与当前生成器不一致，无法保证复现。');settings=Engine.validate(migrateProject(parsed));syncUI();fit();requestPreview(true);toast(parsed.version==='1.0.0'?'旧项目已按原有山系模式导入。':'项目已导入。');}catch(error){toast('导入失败：'+error.message);}e.target.value='';};
  $('reset').onclick=()=>{settings=Engine.defaults();syncUI();fit();requestPreview(true);toast('已恢复初始设置。');};$('help-button').onclick=()=>$('help-dialog').showModal();$('close-help').onclick=()=>$('help-dialog').close();$('help-dialog').onclick=e=>{if(e.target===$('help-dialog')){const rect=e.target.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)e.target.close();}};
  function transform(){$('map-holder').style.transform='translate('+view.x+'px,'+view.y+'px) scale('+view.zoom+')';}function fit(){view={zoom:1,x:0,y:0};transform();}function zoom(factor,cx=0,cy=0){const old=view.zoom;view.zoom=Math.max(.65,Math.min(6,view.zoom*factor));const ratio=view.zoom/old;view.x=cx-(cx-view.x)*ratio;view.y=cy-(cy-view.y)*ratio;transform();}
  $('zoom-fit').onclick=fit;$('zoom-in').onclick=()=>zoom(1.25);$('zoom-out').onclick=()=>zoom(.8);
  $('viewport').addEventListener('wheel',e=>{e.preventDefault();const rect=e.currentTarget.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.0015),e.clientX-rect.left-rect.width/2,e.clientY-rect.top-rect.height/2);},{passive:false});$('viewport').addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,vx:view.x,vy:view.y};e.currentTarget.setPointerCapture(e.pointerId);});$('viewport').addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;view.x=drag.vx+e.clientX-drag.x;view.y=drag.vy+e.clientY-drag.y;transform();});$('viewport').addEventListener('pointerup',()=>drag=null);$('viewport').addEventListener('pointercancel',()=>drag=null);$('viewport').addEventListener('dblclick',fit);
  $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.querySelector('.map-workspace').requestFullscreen();fit();}catch{toast('浏览器不支持全屏，可用缩放查看。');}};
  window.mingApp={ready:false,error:null,stats:null,getSettings:()=>structuredClone(settings),generate:renderPreview,exportMap,drawDecoration,paint};syncUI();requestPreview(true);
})();
