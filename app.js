(function(){
  'use strict';
  const $=id=>document.getElementById(id),Engine=window.MingTerrain,STORE='ming-world-atelier-v1';
  function freshSettings(){const defaults=Engine.defaults(),preset=document.documentElement.dataset.theme==='light'?'blueprint':'technical',p=Engine.presets[preset];return{...defaults,preset,stops:p.stops.map(s=>s.slice()),contourStops:structuredClone(p.contourStops||defaults.contourStops),background:p.background,colorMode:'contours',lightMode:'top',fade:20,coastline:true,transparent:true};}
  let settings=freshSettings(),appliedSettings=null,worker=null,workerURL=null,pending=new Map(),serial=0,debounce=null,recolorTimer=null,recolorPending=null,recolorRunning=false,toastTimer=null,previewStats=null,exporting=false,previewTicket=0,recolorTicket=0,styleRevision=0,previewSettingsKey=null,dirty=false;
  let view={zoom:1,x:0,y:0},drag=null;
  const ranges=['ocean','coast','coastStretch','centralIslandSize','mountains','mountainRadius','mountainVariance','islands','relief'];
  const mixRanges=['mountainNetwork','mountainChain','mountainStretch'];
  const bools=['hillshade','contours','bathymetry','ticks'];
  const status=$('map-state'),canvas=$('map'),generationLoading=$('generation-loading'),generationProgress=$('generation-progress'),generationBars=document.querySelector('.generation-bars'),workspace=document.querySelector('.map-workspace');
  const mapScale=$('map-scale'),mapScaleEnd=$('map-scale-end'),mapScaleLine=mapScale.querySelector('.map-scale-line');
  $('centralIslandSize').min='0';$('centralIslandSize').max='0.1';$('centralIslandSize').step='0.01';
  function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4200);}
  function saveLocal(){try{localStorage.setItem(STORE,JSON.stringify({draft:settings,applied:appliedSettings}));}catch{}}
  function previewKey(value){const copy=structuredClone(value);delete copy.exportSize;delete copy.transparent;return JSON.stringify(copy);}
  try{const saved=JSON.parse(localStorage.getItem(STORE));if(saved?.draft&&saved?.applied){settings=Engine.validate(saved.draft);appliedSettings=Engine.validate(saved.applied);}}catch{}
  settings.lightMode='top';settings.fade=20;settings.coastline=true;settings.transparent=true;
  appliedSettings=appliedSettings||structuredClone(settings);
  appliedSettings.lightMode='top';appliedSettings.fade=20;appliedSettings.coastline=true;appliedSettings.transparent=true;
  function tab(name){for(const button of document.querySelectorAll('[data-tab]')){const active=button.dataset.tab===name;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}for(const panel of document.querySelectorAll('.panel')){const active=panel.id==='panel-'+name;panel.classList.toggle('active',active);panel.hidden=!active;}}
  function syncTheme(){const light=document.documentElement.dataset.theme==='light';$('theme-label').textContent=light?'深色':'浅色';$('theme-toggle').title=$('theme-toggle').ariaLabel=light?'切换至深色模式':'切换至浅色模式';document.querySelector('meta[name="theme-color"]').content=light?'#f3f5f8':'#1a1b1f';const logo=document.querySelector('.brand-logo');if(logo){logo.src=logo.dataset[light?'lightSrc':'darkSrc'];}}
  $('theme-toggle').onclick=()=>{const theme=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=theme;try{localStorage.setItem('ming-interface-theme',theme);}catch{}syncTheme();};
  syncTheme();
  function sliderLabel(id){const input=$(id);$(id+'-value').textContent=input.value+'%';input.style.setProperty('--range',((input.value-input.min)/(input.max-input.min)*100)+'%');}
  function boundedValue(id){const input=$(id),value=Math.max(Number(input.min),Math.min(Number(input.max),Number(input.value)));input.value=String(value);return value;}
  function syncStatus(){const generating=workspace.classList.contains('generating');status.textContent=generating?'正在生成':dirty?'待生成 · 点击“生成世界”应用修改':'世界已就绪';status.dataset.state=generating?'busy':dirty?'dirty':'ready';}
  function markDirty(){clearTimeout(debounce);settings.seed=$('seed').value.trim()||'MING-0207';dirty=!appliedSettings||Engine.terrainKey(settings,1280)!==Engine.terrainKey(appliedSettings,1280);saveLocal();syncStatus();}
  const styleKeys=['preset','stops','background','colorMode','hillshade','shade','lightMode','lightAngle','lightHeight','contours','contourInterval','bathymetry','ticks','contourStops'];
  function applyStyle(){styleRevision++;for(const key of styleKeys)if(key in settings)appliedSettings[key]=structuredClone(settings[key]);settings.coastline=appliedSettings.coastline=true;settings.fade=appliedSettings.fade=20;settings.transparent=appliedSettings.transparent=true;dirty=Engine.terrainKey(settings,1280)!==Engine.terrainKey(appliedSettings,1280);saveLocal();syncStatus();requestRecolor();}
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
    const unlit=!settings.hillshade||settings.colorMode==='contours',input=$('light-height');
    input.value=settings.lightHeight;$('light-height-value').textContent=settings.lightHeight+'%';input.disabled=unlit;
    input.style.setProperty('--range',((Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100)+'%');
    $('light-mode-note').textContent=unlit?'当前风格不使用晕渲。':'中心上方光源高度。';
  }
  function syncLayerControls(){
    const contour=settings.colorMode==='contours';
    // Show effective layer states without losing the choices used by color palettes.
    for(const id of ['hillshade','contours','bathymetry']){$(id).disabled=contour;$(id).checked=!contour&&settings[id];}
    $('shade').disabled=contour;
    syncLightDirection();
  }
  function syncRenderMode(){
    const select=$('color-mode'),fixed=!!Engine.presets[settings.preset]?.colorMode;
    for(const option of [...select.options])if(option.value==='contours')option.hidden=!fixed;
    if(fixed){settings.colorMode='contours';select.value='contours';select.disabled=true;}
    else{select.disabled=false;if(settings.colorMode==='contours')settings.colorMode='smooth';select.value=settings.colorMode;}
    syncLayerControls();
  }
  function syncUI(){
    normalizeMountainMix();
    $('seed').value=settings.seed;
    for(const id of ranges){$(id).value=settings[id];sliderLabel(id);}
    $('shade').value=settings.shade;sliderLabel('shade');
    syncMountainMix();
    for(const id of bools)$(id).checked=settings[id];
    $('contour-interval').value=settings.contourInterval;$('color-mode').value=settings.colorMode;$('export-size').value=settings.exportSize;
    presetUI();syncRenderMode();paletteUI();
  }
  function presetUI(){
    const group=$('preset-grid');group.replaceChildren();
    for(const [id,p]of Object.entries(Engine.presets)){
      const button=document.createElement('button');button.className='preset-card'+(settings.preset===id?' active':'');button.dataset.preset=id;button.setAttribute('aria-pressed',String(settings.preset===id));
      const swatches=document.createElement('span');swatches.className='preset-swatches';swatches.setAttribute('aria-hidden','true');if(!p.colorMode)for(const stop of p.stops.filter((_,i)=>i%2===0)){const color=document.createElement('i');color.style.background=stop[1];swatches.append(color);}button.append(swatches,document.createTextNode(p.name));
      button.onclick=()=>{settings.preset=id;settings.stops=p.stops.map(s=>s.slice());settings.contourStops=structuredClone(p.contourStops||Engine.defaults().contourStops);settings.background=p.background;settings.colorMode=p.colorMode||'smooth';settings.fade=20;settings.coastline=true;settings.transparent=true;syncUI();applyStyle();};group.append(button);
    }
  }
  function paletteUI(){
    const list=$('color-stops');list.replaceChildren();
    const contour=settings.colorMode==='contours',entries=contour?['sea','land'].flatMap(side=>(settings.contourStops?.[side]||[]).map((stop,index)=>({side,index,stop}))):settings.stops.map((stop,index)=>({side:null,index,stop}));
    entries.sort((a,b)=>a.stop[0]-b.stop[0]);
    entries.forEach(({side,index,stop})=>{
      const stops=side?settings.contourStops[side]:settings.stops;
      const row=document.createElement('div');row.className='color-stop';
      const height=document.createElement('input');height.type='number';height.value=stop[0];height.min=side==='sea'?-8000:side==='land'?0:-8000;height.max=side==='sea'?-1:8000;height.step=1;height.setAttribute('aria-label','色带 '+(index+1)+' 高度');if(stop[0]===0){height.readOnly=true;height.title='海平面节点固定为 0 米';}
      const picker=document.createElement('input');picker.type='color';picker.value=stop[1];picker.setAttribute('aria-label',stop[0]+' 米的颜色');
      const hex=document.createElement('input');hex.type='text';hex.value=stop[1];hex.maxLength=7;hex.spellcheck=false;hex.setAttribute('aria-label',stop[0]+' 米的十六进制颜色');
      const remove=document.createElement('button');remove.className='remove-stop';remove.textContent='×';remove.setAttribute('aria-label','删除 '+stop[0]+' 米节点');remove.disabled=side?stops.length<=2:stop[0]===0||stops.length<=4||(stop[0]<0&&stops.filter(node=>node[0]<0).length===1)||(stop[0]>0&&stops.filter(node=>node[0]>0).length===1);
      height.onchange=()=>{const value=Number(height.value),lower=side==='sea'?-8000:side==='land'?0:-8000,upper=side==='sea'?-1:8000,candidate=stops.map((node,position)=>position===index?[value,node[1]]:node);if(height.readOnly||!height.value.trim()||!Number.isInteger(value)||value<lower||value>upper||stops.some((node,position)=>position!==index&&node[0]===value)||(!side&&(!candidate.some(node=>node[0]<0)||!candidate.some(node=>node[0]>0)))){height.value=stop[0];toast(side?'海底色带须在 −8000～−1 米，陆地色带须在 0～8000 米，节点不可重复。':'须保留海平面、海底和陆地节点，且高度为不重复的整数。');return;}stop[0]=value;stops.sort((a,b)=>a[0]-b[0]);if(!side)settings.preset='custom';paletteUI();presetUI();applyStyle();};
      picker.oninput=()=>{stop[1]=picker.value;hex.value=picker.value;if(!side)settings.preset='custom';presetUI();applyStyle();};
      hex.onchange=()=>{if(!/^#[\da-f]{6}$/i.test(hex.value)){hex.value=stop[1];toast('请输入 #RRGGBB 格式的颜色。');return;}stop[1]=hex.value;picker.value=hex.value;if(!side)settings.preset='custom';presetUI();applyStyle();};
      remove.onclick=()=>{if(remove.disabled)return;stops.splice(index,1);if(!side)settings.preset='custom';paletteUI();presetUI();applyStyle();};row.append(height,picker,hex,remove);list.append(row);
    });$('add-stop').textContent=contour?'＋ 添加陆地节点':'＋ 添加高度节点';$('add-stop').disabled=(contour?settings.contourStops.land.length:settings.stops.length)>=24;
    $('add-sea-stop').hidden=!contour;$('add-sea-stop').disabled=contour&&settings.contourStops.sea.length>=24;
  }
  function progress(value){const amount=Math.min(99,Math.max(0,Math.floor(value*100)));generationProgress.textContent=String(amount);if(generationBars)generationBars.style.setProperty('--generation-progress',amount+'%');}
  function showGeneration(){workspace.classList.add('generating');generationLoading.hidden=false;progress(0);}
  function hideGeneration(){workspace.classList.remove('generating');generationLoading.hidden=true;}
  function getWorker(){
    if(worker)return worker;
    if(!window.Worker)throw Error('此浏览器不支持后台线程。');
    if(!workerURL)workerURL=URL.createObjectURL(new Blob([Engine.workerSource],{type:'text/javascript'}));
    worker=new Worker(workerURL);
    worker.onmessage=event=>{const msg=event.data,task=pending.get(msg.id);if(!task)return;if(msg.type==='progress'){if(task.showProgress&&task.generationTicket===previewTicket&&workspace.classList.contains('generating'))progress(msg.value);if(task.showExportProgress){const percent=Math.min(99,Math.floor(msg.value*100));$('export-progress').hidden=false;$('export-progress-detail').textContent=msg.detail;$('export-progress-value').textContent=percent+'%';$('export-progress-bar').style.width=percent+'%';}return;}pending.delete(msg.id);if(msg.type==='error')task.reject(Error(msg.error));else task.resolve(msg);};
    worker.onerror=event=>{for(const task of pending.values())task.reject(Error(event.message||'地图线程加载失败。请使用 Edge 或 Chrome。'));pending.clear();if(worker)worker.terminate();worker=null;};return worker;
  }
  function compute(type,size,s){
    const id=++serial;
    return new Promise((resolve,reject)=>{try{const w=getWorker();pending.set(id,{resolve,reject,generationTicket:previewTicket,showProgress:type==='preview',showExportProgress:type==='height'||type==='export'});w.postMessage({id,type,size,settings:s});}catch(error){pending.delete(id);reject(error);}});
  }
  function collectSeed(){const value=$('seed').value.trim();settings.seed=value||'MING-0207';$('seed').value=settings.seed;}
  function requestPreview(immediate=false){
    if(exporting)return;
    clearTimeout(debounce);
    if(immediate){renderPreview();return;}
    markDirty();
  }
  async function renderPreview(initialSettings=null){
    if(exporting)return;clearTimeout(recolorTimer);recolorTimer=null;recolorPending=null;if(!initialSettings)collectSeed();settings.fade=20;settings.coastline=true;settings.transparent=true;saveLocal();const snapshot=structuredClone(initialSettings||settings),ticket=++previewTicket,startStyleRevision=styleRevision;++recolorTicket;
    window.mingApp.error=null;status.textContent='正在生成';status.dataset.state='busy';showGeneration();
    try{
      const result=await compute('preview',1280,snapshot);if(ticket!==previewTicket)return;
      let displaySettings,displayResult=result,revision;
      do{
        revision=styleRevision;displaySettings=structuredClone(snapshot);
        if(!initialSettings||revision!==startStyleRevision)for(const key of styleKeys)if(key in settings)displaySettings[key]=structuredClone(settings[key]);
        if(revision!==startStyleRevision)displayResult=await compute('render',1280,displaySettings);
        if(ticket!==previewTicket)return;
      }while(revision!==styleRevision);
      paint(canvas,displayResult.pixels,displayResult.size,displaySettings);appliedSettings=structuredClone(displaySettings);previewStats=result.stats;previewSettingsKey=previewKey(displaySettings);dirty=Engine.terrainKey(displaySettings,1280)!==Engine.terrainKey(settings,1280);
      $('meta-seed').textContent=snapshot.seed;$('meta-seed').title=snapshot.seed;$('meta-ratio').textContent=result.stats.ocean.toFixed(1)+'% / '+result.stats.land.toFixed(1)+'%';$('meta-height').textContent=result.stats.maximum.toLocaleString()+' m';$('meta-resolution').textContent=result.size+' × '+result.size;hideGeneration();syncStatus();saveLocal();window.mingApp.stats=previewStats;window.mingApp.ready=true;
    }catch(error){if(ticket!==previewTicket||error.name==='AbortError')return;hideGeneration();window.mingApp.ready=!!previewStats;status.textContent=window.mingApp.ready?(dirty?'待生成 · 点击“生成世界”应用修改':'世界已就绪'):'生成失败';status.dataset.state=window.mingApp.ready?(dirty?'dirty':'ready'):'error';toast('生成失败：'+error.message);console.error(error);window.mingApp.error=error.message;}
  }
  function requestRecolor(){
    if(!window.mingApp?.ready||!appliedSettings)return;
    const ticket=++recolorTicket;
    if(workspace.classList.contains('generating')){clearTimeout(recolorTimer);recolorTimer=null;recolorPending=null;return;}
    recolorPending={snapshot:structuredClone(appliedSettings),ticket};
    clearTimeout(recolorTimer);if(!exporting)recolorTimer=setTimeout(runRecolor,60);
  }
  async function runRecolor(){
    recolorTimer=null;if(recolorRunning||!recolorPending||exporting||workspace.classList.contains('generating'))return;
    const job=recolorPending;recolorPending=null;recolorRunning=true;
    try{const result=await compute('render',1280,job.snapshot);if(job.ticket===recolorTicket&&!exporting&&!workspace.classList.contains('generating')){paint(canvas,result.pixels,result.size,job.snapshot);previewSettingsKey=previewKey(job.snapshot);window.mingApp.stats=result.stats;}}
    catch(error){if(error.name!=='AbortError')console.error(error);}
    finally{recolorRunning=false;if(recolorPending&&!exporting&&!workspace.classList.contains('generating'))recolorTimer=setTimeout(runRecolor,60);}
  }
  function paint(target,pixels,size,s){target.width=size;target.height=size;const ctx=target.getContext('2d');ctx.putImageData(new ImageData(pixels,size,size),0,0);drawDecoration(ctx,size,s);}
  function drawDecoration(ctx,n,s){
    const c=n/2,r=n*Engine.MAP_RADIUS,dark=Engine.rgb(s.background).reduce((sum,v)=>sum+v,0)<384,ink=s.colorMode==='contours'?(dark?'#65d6fc':'#354f65'):s.preset==='parchment'?'#57452d':'#263f37';ctx.save();ctx.globalCompositeOperation='source-atop';ctx.strokeStyle=ink;ctx.globalAlpha=.78;ctx.lineWidth=n/3000;ctx.beginPath();ctx.arc(c,c,r,0,Math.PI*2);ctx.stroke();
    if(s.ticks){
      ctx.globalAlpha=.38;ctx.lineWidth=n/2400;
      for(let i=0;i<4;i++){const a=i*Math.PI/4,x=Math.cos(a)*r,y=Math.sin(a)*r;ctx.beginPath();ctx.moveTo(c-x,c-y);ctx.lineTo(c+x,c+y);ctx.stroke();}
      ctx.globalAlpha=.62;ctx.beginPath();ctx.arc(c,c,r*.5,0,Math.PI*2);ctx.stroke();
      ctx.globalAlpha=.88;ctx.lineWidth=n/2600;
      for(let i=0;i<180;i++){const a=i/180*Math.PI*2,length=n*(i%15===0?.008:i%5===0?.0045:.002);ctx.beginPath();ctx.moveTo(c+Math.cos(a)*r,c+Math.sin(a)*r);ctx.lineTo(c+Math.cos(a)*(r-length),c+Math.sin(a)*(r-length));ctx.stroke();}
    }
    ctx.restore();
  }
  function filename(s,ending){return'ming-'+s.seed.replace(/[^\p{L}\p{N}_-]/gu,'-').slice(0,50)+ending;}
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);}
  function setExportBusy(busy){exporting=busy;for(const el of document.querySelectorAll('.sidebar input,.sidebar select,.sidebar button,#export-top,#panel-export input,#panel-export select,#panel-export button')){if(busy){el.dataset.wasDisabled=String(el.disabled);el.disabled=true;}else{el.disabled=el.dataset.wasDisabled==='true';delete el.dataset.wasDisabled;}}}
  async function exportMap(type){
    if(exporting||!window.mingApp.ready||!appliedSettings)return;clearTimeout(recolorTimer);recolorTimer=null;recolorPending=null;++recolorTicket;clearTimeout(debounce);const s=structuredClone(appliedSettings);s.exportSize=settings.exportSize;setExportBusy(true);$('export-progress').hidden=false;$('export-progress-value').textContent='0%';$('export-progress-bar').style.width='0%';$('export-progress-detail').textContent='按目标像素重新计算细节…';
    try{
      const result=await compute(type==='height'?'height':'export',s.exportSize,s);
      if(type==='height'){download(new Blob([result.bytes],{type:'image/png'}),filename(s,'-height16-'+s.exportSize+'.png'));toast('16 位高度图已导出。');}
      else{const out=document.createElement('canvas');paint(out,result.pixels,result.size,s);const blob=await new Promise((resolve,reject)=>out.toBlob(b=>b?resolve(b):reject(Error('PNG 编码失败。')),'image/png'));download(blob,filename(s,'-'+result.size+'px.png'));toast(result.size+' × '+result.size+' 高清地图已导出。');out.width=1;out.height=1;}
    }catch(error){if(error.name!=='AbortError'){toast('导出失败：'+error.message);console.error(error);}}finally{
      setExportBusy(false);$('export-progress').hidden=true;if(previewSettingsKey!==previewKey(appliedSettings))requestRecolor();
    }
  }
  for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>tab(button.dataset.tab));
  document.querySelector('.tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const buttons=[...document.querySelectorAll('[data-tab]')],index=buttons.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;tab(buttons[next].dataset.tab);buttons[next].focus();});
  $('seed').addEventListener('input',markDirty);
  for(const id of ranges)$(id).addEventListener('input',()=>{settings[id]=boundedValue(id);sliderLabel(id);markDirty();});
  for(const id of mixRanges)$(id).addEventListener('input',()=>{rebalanceMountainMix(id);syncMountainMix();markDirty();});
  $('light-height').addEventListener('input',()=>{settings.lightHeight=boundedValue('light-height');syncLightDirection();applyStyle();});
  $('shade').addEventListener('input',()=>{settings.shade=boundedValue('shade');sliderLabel('shade');applyStyle();});
  for(const id of bools)$(id).addEventListener('change',()=>{if($(id).disabled)return;settings[id]=$(id).checked;if(id==='hillshade')syncLayerControls();applyStyle();});
  $('contour-interval').onchange=()=>{settings.contourInterval=Number($('contour-interval').value);applyStyle();};$('color-mode').onchange=()=>{settings.colorMode=$('color-mode').value;syncRenderMode();paletteUI();applyStyle();};$('export-size').onchange=()=>{settings.exportSize=Number($('export-size').value);saveLocal();};
  const addSeaStop=document.createElement('button');addSeaStop.id='add-sea-stop';addSeaStop.className='secondary-button full-width';addSeaStop.textContent='＋ 添加海底节点';$('add-stop').after(addSeaStop);
  function addPaletteStop(side){const target=side?settings.contourStops[side]:settings.stops,min=side==='land'?0:-8000,max=side==='sea'?-1:8000,sorted=target.slice().sort((a,b)=>a[0]-b[0]);if(target.length>=24)return;let value=null,biggestGap=1;for(let index=1;index<sorted.length;index++){const gap=sorted[index][0]-sorted[index-1][0];if(gap>biggestGap){biggestGap=gap;value=Math.floor((sorted[index][0]+sorted[index-1][0])/2);}}if(value===null||target.some(stop=>stop[0]===value)){value=null;for(let candidate=min;candidate<=max;candidate++)if(!target.some(stop=>stop[0]===candidate)){value=candidate;break;}}if(value===null)return;target.push([value,side==='sea'?'#52d2f8':'#b7bd94']);target.sort((a,b)=>a[0]-b[0]);if(!side)settings.preset='custom';paletteUI();presetUI();applyStyle();}
  $('add-stop').onclick=()=>addPaletteStop(settings.colorMode==='contours'?'land':null);
  addSeaStop.onclick=()=>{if(settings.colorMode==='contours')addPaletteStop('sea');};
  $('generate').onclick=()=>{collectSeed();requestPreview(true);};
  $('random-seed').onclick=()=>{
    if(exporting)return;
    const randomValue=crypto.getRandomValues(new Uint32Array(1))[0];
    $('seed').value='MING-'+randomValue.toString(36).toUpperCase();
    requestPreview(true);
  };
  $('export-top').onclick=()=>$('export-dialog').showModal();$('close-export').onclick=()=>$('export-dialog').close();$('export-png').onclick=()=>exportMap('png');$('export-height').onclick=()=>exportMap('height');
  $('save-project').onclick=()=>{const snapshot=structuredClone(appliedSettings);snapshot.exportSize=settings.exportSize;download(new Blob([JSON.stringify({format:'ming-world-atelier',...snapshot},null,2)],{type:'application/json'}),filename(snapshot,'.json'));toast('项目参数已保存。');};$('load-project').onclick=()=>$('project-file').click();
  $('project-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>100000)throw Error('项目文件过大。');const parsed=JSON.parse(await file.text());if(parsed.format!=='ming-world-atelier'||parsed.version!==Engine.VERSION)throw Error('项目版本与当前生成器不一致，无法保证复现。');settings=Engine.validate(parsed);settings.fade=20;settings.coastline=true;settings.transparent=true;syncUI();fit();requestPreview(true);toast('项目已导入。');}catch(error){toast('导入失败：'+error.message);}e.target.value='';};
  $('reset').onclick=()=>{settings=freshSettings();syncUI();fit();requestPreview(true);toast('已恢复初始设置。');};$('help-button').onclick=()=>$('help-dialog').showModal();$('close-help').onclick=()=>$('help-dialog').close();for(const id of ['help-dialog','export-dialog'])$(id).addEventListener('click',e=>{if(e.target!==$(id))return;const rect=e.target.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)e.target.close();});
  function formatScaleDistance(kilometers){const rounded=Number(kilometers.toPrecision(3));return rounded.toLocaleString('zh-CN',{maximumFractionDigits:2});}
  function updateMapScale(){
    const holder=$('map-holder'),mapRect=holder.getBoundingClientRect();
    const diameterPixels=mapRect.width*2*Engine.MAP_RADIUS;if(!diameterPixels)return;
    const fullDiameterKm=Engine.MAP_DIAMETER_KM*Engine.MAP_SCALE_DISPLAY_FACTOR,kmPerPixel=fullDiameterKm/diameterPixels;
    const targetPixels=Math.min(108,Math.max(72,window.innerWidth*.28)),rawDistance=kmPerPixel*targetPixels,unit=10**Math.floor(Math.log10(rawDistance)),ratio=rawDistance/unit;
    const distance=(ratio>=5?5:ratio>=2?2:1)*unit,width=distance/kmPerPixel,end=formatScaleDistance(distance);
    mapScale.style.width=width+'px';mapScaleLine.style.width=width+'px';mapScaleEnd.textContent=end+' km';
    mapScale.dataset.distanceKm=String(distance);mapScale.setAttribute('aria-label','比例尺：0 至 '+end+' 千米；全图直径 '+formatScaleDistance(fullDiameterKm)+' 千米');
  }
  function transform(){$('map-holder').style.transform='translate('+view.x+'px,'+view.y+'px) scale('+view.zoom+')';updateMapScale();}function fit(){view={zoom:1,x:0,y:0};transform();}function zoom(factor,cx=0,cy=0){const old=view.zoom;view.zoom=Math.max(.65,Math.min(6,view.zoom*factor));const ratio=view.zoom/old;view.x=cx-(cx-view.x)*ratio;view.y=cy-(cy-view.y)*ratio;transform();}
  window.addEventListener('resize',updateMapScale);if(window.ResizeObserver){const scaleObserver=new ResizeObserver(updateMapScale);scaleObserver.observe($('viewport'));scaleObserver.observe($('map-holder'));}
  $('zoom-fit').onclick=fit;$('zoom-in').onclick=()=>zoom(1.25);$('zoom-out').onclick=()=>zoom(.8);
  $('viewport').addEventListener('wheel',e=>{e.preventDefault();const rect=e.currentTarget.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.0015),e.clientX-rect.left-rect.width/2,e.clientY-rect.top-rect.height/2);},{passive:false});$('viewport').addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,vx:view.x,vy:view.y};e.currentTarget.setPointerCapture(e.pointerId);});$('viewport').addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;view.x=drag.vx+e.clientX-drag.x;view.y=drag.vy+e.clientY-drag.y;transform();});$('viewport').addEventListener('pointerup',()=>drag=null);$('viewport').addEventListener('pointercancel',()=>drag=null);$('viewport').addEventListener('dblclick',fit);
  window.mingApp={ready:false,error:null,stats:null,getSettings:()=>structuredClone(settings),getAppliedSettings:()=>structuredClone(appliedSettings),generate:()=>renderPreview(),exportMap,drawDecoration,paint};syncUI();updateMapScale();renderPreview(appliedSettings);
})();
