'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{Worker:NodeWorker}=require('node:worker_threads');
let JSDOM;
try{({JSDOM}=require('jsdom'));}catch{({JSDOM}=require(path.join(process.env.LOCALAPPDATA,'Temp/ming-world-test-tools/node_modules/jsdom')));}
const base=path.resolve(__dirname,'..');
const markup=fs.readFileSync(path.join(base,'index.html'),'utf8');
const dom=new JSDOM(markup,{url:'https://ming.local/',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window,$=id=>w.document.getElementById(id),downloads=[],blobMap=new Map();
let canvasPaints=0,workerErrors=[],liveWorkers=new Set(),decorationCalls={arcs:0,lines:0};
w.structuredClone=structuredClone;
w.ImageData=class ImageData{constructor(data,width,height){this.data=data;this.width=width;this.height=height;}};
w.URL.createObjectURL=blob=>{const url='blob:ming-'+blobMap.size;blobMap.set(url,blob);return url;};
w.URL.revokeObjectURL=()=>{};
w.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,blob:blobMap.get(this.href)});};
w.HTMLCanvasElement.prototype.getContext=function(){return{
  putImageData:image=>{assert.equal(image.data.length,image.width*image.height*4);canvasPaints++;},
  save(){},restore(){},beginPath(){},arc(){decorationCalls.arcs++;},stroke(){},moveTo(){},lineTo(){decorationCalls.lines++;},fillRect(){},fillText(){},
  createLinearGradient(){return{addColorStop(){}};}
};};
w.HTMLCanvasElement.prototype.toBlob=function(callback){callback(new w.Blob(['canvas-png-test'],{type:'image/png'}));};
const nativeError=w.console.error;w.console.error=(...args)=>{workerErrors.push(args.join(' '));nativeError(...args);};
w.Worker=class Worker{
  constructor(){
    this.stopped=false;
    const bridge="const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:(message,transfer)=>parentPort.postMessage(message,transfer)};";
    this.native=new NodeWorker(bridge+w.MingTerrain.workerSource+";parentPort.on('message',data=>self.onmessage({data}));",{eval:true});
    this.native.on('message',data=>{if(!this.stopped)this.onmessage?.({data});});
    this.native.on('error',error=>{if(!this.stopped)this.onerror?.({message:error.message});});
    liveWorkers.add(this);
  }
  postMessage(message){this.native.postMessage(structuredClone(message));}
  terminate(){this.stopped=true;liveWorkers.delete(this);this.native.terminate();}
};
for(const name of ['terrain.js','app.js'])w.eval(fs.readFileSync(path.join(base,name),'utf8'));
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function ready(seed){
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){if(w.mingApp.error)throw Error(w.mingApp.error);if(w.mingApp.ready&&(!seed||w.mingApp.stats.seed===seed)&&$('map-state').textContent==='世界已就绪')return;await delay(50);}
  throw Error('preview did not finish; status='+$('map-state').textContent);
}
function event(id,type){$(id).dispatchEvent(new w.Event(type,{bubbles:true}));}
async function generate(seed){$('generate').click();await delay(20);await ready(seed);}
(async()=>{
  await ready('MING-0207');
  assert.equal($('meta-ratio').textContent,'15.0% / 85.0%');
  assert.ok(canvasPaints>0);
  assert.equal($('map-height-tip'),null,'the removed elevation inspection UI is absent');
  assert.deepEqual([$('ocean').min,$('ocean').max],['10','20']);
  assert.deepEqual([$('centralIslandSize').min,$('centralIslandSize').max,$('centralIslandSize').step],['0.1','1','0.1']);
  assert.deepEqual([$('light-height').min,$('light-height').max],['10','40']);
  decorationCalls={arcs:0,lines:0};w.mingApp.drawDecoration($('map').getContext('2d'),1280,{...w.MingTerrain.defaults(),ticks:true,legend:false});
  assert.equal(decorationCalls.arcs,2,'the tick layer draws the outer circle and half-radius ring');
  assert.equal(decorationCalls.lines,184,'the tick layer draws four eight-way axes and 180 rim ticks');
  assert.equal($('light-angle-value').textContent,'315° · 西北');
  let paints=canvasPaints;$('light-angle').value='90';event('light-angle','input');
  assert.equal($('map-state').textContent,'待生成 · 点击“生成世界”应用修改');assert.equal(canvasPaints,paints);
  await generate();
  assert.equal(w.mingApp.getSettings().lightAngle,90);
  assert.equal($('light-direction-dial').getAttribute('aria-valuenow'),'90');
  const dial=$('light-direction-dial');dial.setPointerCapture=()=>{};
  dial.getBoundingClientRect=()=>({left:0,top:0,width:128,height:128});
  dial.dispatchEvent(new w.MouseEvent('pointerdown',{clientX:64,clientY:16,bubbles:true}));
  dial.dispatchEvent(new w.MouseEvent('pointerup',{clientX:64,clientY:16,bubbles:true}));
  assert.equal($('map-state').textContent,'待生成 · 点击“生成世界”应用修改');await generate();
  assert.equal(w.mingApp.getSettings().lightAngle,0);
  $('mountainStretch').value='90';event('mountainStretch','input');
  assert.deepEqual(['mountainNetwork','mountainChain','mountainStretch'].map(id=>Number($(id).value)),[5,5,90]);
  assert.equal(['mountainNetwork','mountainChain','mountainStretch'].reduce((sum,id)=>sum+Number($(id).value),0),100);
  assert.equal(canvasPaints,paints+2);await generate();
  assert.equal(w.mingApp.getSettings().mountainStretch,90);
  assert.ok($('mountainStretch-value').textContent.endsWith('%'));
  $('coastStretch').value='71';event('coastStretch','input');assert.equal(canvasPaints,paints+3);await generate();
  assert.equal(w.mingApp.getSettings().coastStretch,71);
  $('light-mode').value='top';event('light-mode','change');
  assert.equal($('light-direction-dial').disabled,true);assert.equal($('light-height').disabled,false);
  $('light-height').value='80';event('light-height','input');assert.equal(canvasPaints,paints+4);await generate();
  assert.equal(w.mingApp.getSettings().lightMode,'top');assert.equal(w.mingApp.getSettings().lightHeight,40);
  $('light-mode').value='orbit';event('light-mode','change');assert.equal($('light-height').disabled,true);await generate();
  $('hillshade').checked=false;event('hillshade','change');
  assert.equal($('light-angle').disabled,true);
  $('hillshade').checked=true;event('hillshade','change');await generate();
  w.document.querySelector('[data-tab="palette"]').click();
  assert.ok($('panel-palette').classList.contains('active'));
  w.document.querySelector('[data-preset="parchment"]').click();await generate();
  assert.equal(w.mingApp.getSettings().preset,'parchment');
  assert.ok($('color-stops').children.length>=10);
  paints=canvasPaints;$('ocean').value='62';event('ocean','input');assert.equal($('ocean').value,'20');assert.equal(canvasPaints,paints);assert.equal($('map-state').textContent,'待生成 · 点击“生成世界”应用修改');await generate();
  assert.ok(Math.abs(w.mingApp.stats.ocean-20)<.001);
  $('seed').value='界面复现测试';$('generate').click();await delay(20);await ready('界面复现测试');
  $('save-project').click();assert.ok(downloads.at(-1).name.endsWith('.json'));
  const settings=w.mingApp.getSettings();
  const imported={format:'ming-world-atelier',...settings,seed:'import-test',ocean:19,contours:true};
  Object.defineProperty($('project-file'),'files',{value:[{size:1000,text:async()=>JSON.stringify(imported)}],configurable:true});
  await $('project-file').onchange({target:$('project-file')});await delay(20);await ready('import-test');
  assert.equal(w.mingApp.getSettings().ocean,19);
  assert.equal($('contours').checked,true);
  assert.equal(w.mingApp.getSettings().stops.length,settings.stops.length);
  // Unsupported versions must not silently produce a different world.
  Object.defineProperty($('project-file'),'files',{value:[{size:1000,text:async()=>JSON.stringify({...imported,version:'99.0.0',seed:'wrong-version'})}],configurable:true});
  await $('project-file').onchange({target:$('project-file')});
  assert.equal(w.mingApp.getSettings().seed,'import-test');
  assert.ok($('toast').textContent.includes('版本'));
  const old={format:'ming-world-atelier',...imported,version:'1.0.0',seed:'legacy-mountains'};
  Object.defineProperty($('project-file'),'files',{value:[{size:1000,text:async()=>JSON.stringify(old)}],configurable:true});
  await $('project-file').onchange({target:$('project-file')});await delay(20);await ready('legacy-mountains');
  assert.deepEqual([w.mingApp.getSettings().mountainNetwork,w.mingApp.getSettings().mountainChain,w.mingApp.getSettings().mountainStretch],[100,0,0]);
  Object.defineProperty($('project-file'),'files',{value:[{size:1000,text:async()=>JSON.stringify(imported)}],configurable:true});
  await $('project-file').onchange({target:$('project-file')});await delay(20);await ready('import-test');
  $('export-size').value='1536';event('export-size','change');
  const exportTask=w.mingApp.exportMap('png');
  assert.equal($('generate').disabled,true);
  await exportTask;
  assert.equal($('generate').disabled,false);
  assert.ok(downloads.at(-1).name.endsWith('-1536px.png'));
  assert.equal(downloads.at(-1).blob.type,'image/png');
  await delay(20);await ready('import-test');
  // Export uses pending settings while leaving the preview untouched until Generate World.
  paints=canvasPaints;$('ocean').value='12';event('ocean','input');
  await w.mingApp.exportMap('png');
  assert.equal(canvasPaints,paints+1);assert.ok(Math.abs(w.mingApp.stats.ocean-19)<.001);
  assert.equal($('map-state').textContent,'待生成 · 点击“生成世界”应用修改');
  $('reset').click();await delay(20);await ready('MING-0207');
  assert.equal(w.mingApp.getSettings().ocean,15);
  // Narrow valid color ranges still allow adding nodes, and the last sea node is protected.
  const narrow={format:'ming-world-atelier',...w.mingApp.getSettings(),stops:[[-1,'#0000ff'],[0,'#00ff00'],[1,'#ff0000'],[2,'#ffffff']]};
  Object.defineProperty($('project-file'),'files',{value:[{size:1000,text:async()=>JSON.stringify(narrow)}],configurable:true});
  await $('project-file').onchange({target:$('project-file')});await delay(20);await ready();
  const onlySea=$('color-stops').querySelector('input[type=number]');onlySea.value='3';onlySea.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(onlySea.value,'-1');
  paints=canvasPaints;$('add-stop').click();assert.equal(canvasPaints,paints);await generate();
  const heights=w.mingApp.getSettings().stops.map(s=>s[0]);
  assert.equal(heights.length,5);assert.equal(new Set(heights).size,5);
  assert.equal(workerErrors.length,0);
  console.log('Passed explicit generation, linked mountain shares, stretched coast weight, both light modes, UI initialization, palette editing, seed, project migration and export lock.');
})().then(()=>{for(const worker of liveWorkers)worker.terminate();dom.window.close();},error=>{for(const worker of liveWorkers)worker.terminate();dom.window.close();console.error(error);process.exitCode=1;});
