// Actual application capture. No mocked model responses, telemetry or success labels.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
const root=process.cwd(),out=resolve('demo-video/source'),origin='http://127.0.0.1:8386';
const py=resolve('.venv/Scripts/python.exe');
await mkdir(out+'/raw',{recursive:true});
const server=spawn(py,['demo-video/tools/server.py'],{cwd:root,env:{...process.env,AETHER_STATIC_DIR:resolve('output/demo-video-build'),APP_ROOT_PATH:''},stdio:['ignore','ignore','pipe']});
let serverErrors='';server.stderr.on('data',b=>serverErrors+=b);
const evidence={capturedAt:new Date().toISOString(),clips:{},errors:[]};
let browser;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function clip(name,fn){
 const context=await browser.newContext({viewport:{width:1600,height:900},deviceScaleFactor:1,recordVideo:{dir:out+'/raw',size:{width:1600,height:900}}});
 const page=await context.newPage(),video=page.video(),start=Date.now(),marks={};
 const mark=(n,data={})=>{marks[n]={seconds:(Date.now()-start)/1000,...data};console.log(name,n,JSON.stringify(data));};
 page.on('pageerror',e=>evidence.errors.push({clip:name,message:e.message}));
 await page.addInitScript(()=>{
  addEventListener('DOMContentLoaded',()=>{
   const el=document.createElement('div');el.id='demo-pointer';Object.assign(el.style,{position:'fixed',width:'18px',height:'18px',border:'2px solid #d4f28a',background:'#ffffff40',borderRadius:'50%',pointerEvents:'none',zIndex:'2147483647',transform:'translate(-50%,-50%)',left:'120px',top:'100px',boxShadow:'0 0 16px #d4f244'});document.body.append(el);
   addEventListener('mousemove',e=>{el.style.left=e.clientX+'px';el.style.top=e.clientY+'px';});
   addEventListener('mousedown',()=>{el.animate([{scale:1,opacity:1},{scale:2.8,opacity:.2},{scale:1,opacity:1}],{duration:500});});
  });
 });
 try{await fn(page,mark);}
 catch(e){mark('error',{message:e.message});evidence.errors.push({clip:name,message:e.message});await page.screenshot({path:out+'/'+name+'-error.png'});}
 finally{mark('end');await context.close();await video.saveAs(out+'/'+name+'.webm');evidence.clips[name]=marks;await writeFile(out+'/evidence.json',JSON.stringify(evidence,null,2));}
}
try{
 let ready=false;for(let n=0;n<100;n++){try{ready=(await fetch(origin+'/api/health')).ok;}catch{}if(ready)break;await sleep(100);}
 if(!ready)throw Error('Recording server not ready: '+serverErrors.slice(-1000));
 browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling']});
 await clip('agent',async(page,mark)=>{
  await page.goto(origin);await page.getByRole('heading',{name:'What should we work on?'}).waitFor();
  const close=page.getByRole('button',{name:'Close sidebar',exact:true});if(await close.isVisible())await close.click();
  mark('ready');await sleep(1200);
  await page.getByLabel('Agent provider').selectOption('openai');
  const prompt='Prepare a Mars rover safety check. Read AGENTS.md and search PID physics. Write rover_checks.py with braking_distance(v,a)=v*v/(2*a). Write test_rover_checks.py: 1.1 m/s at 0.6 m/s2 needs about 1.01 m; zero speed needs zero distance. Run these tests. Save a short artifacts/report.md, stating rover reflex/A* is local and server agents use Decisions API/Responses. No docking.';
  await page.getByRole('textbox',{name:'Message Aether'}).pressSequentially(prompt,{delay:13});mark('typed');
  const created=page.waitForResponse(r=>r.url()===origin+'/api/harness/runs'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Start agent',exact:true}).click();const run=await(await created).json();mark('submitted');
  let state;
  for(let i=0;i<210;i++){
   state=await(await fetch(origin+'/api/harness/runs/'+run.id)).json();
   if(!['queued','running','created'].includes(state.status))break;
   await sleep(1000);
  }
  const tools=(state.events||[]).filter(e=>e.type==='tool_end').map(e=>({name:e.data.name,ok:e.data.ok,result:e.data.result}));
  const routing=(state.events||[]).filter(e=>e.type==='reflex').map(e=>({name:e.data.name,answers:e.data.result?.answers}));
  await writeFile(out+'/agent-results.json',JSON.stringify({status:state.status,summary:state.summary,steps:state.steps,tokens:state.tokens,tools,routing},null,2));
  mark('result',{status:state.status,toolCount:tools.length,decisionsCalls:routing.length});await sleep(2500);
  const report=page.getByRole('button',{name:'Report',exact:true});if(await report.count()){await report.click();mark('report');await sleep(5000);}
  await page.screenshot({path:out+'/agent-result.png'});
 });
 await clip('rover',async(page,mark)=>{
  await page.goto(origin);await page.getByRole('heading',{name:'What should we work on?'}).waitFor();
  const close=page.getByRole('button',{name:'Close sidebar',exact:true});if(await close.isVisible())await close.click();
  await page.getByRole('button',{name:/Download Rover autonomy,/}).first().click();
  await page.locator('.card-rover').getByRole('button',{name:'Open',exact:true}).click({timeout:30000});
  await page.locator('.scene-loading').waitFor({state:'detached',timeout:45000});mark('ready');
  await sleep(4000);mark('driving',{readouts:await page.locator('.scene-readouts').innerText()});
  await page.getByRole('button',{name:'Unmapped boulder',exact:true}).click();mark('boulder');
  await page.getByText('New plan adopted',{exact:true}).first().waitFor({timeout:20000});mark('replanned',{feed:await page.locator('.stack-feed').innerText()});
  await page.screenshot({path:out+'/rover-detour.png'});await sleep(2500);
  await page.locator('.scene-speeds').getByRole('button',{name:/^10/}).click();mark('accelerated',{playback:'10x simulated time'});
  let reached=false;
  try{await page.getByText('Goal reached',{exact:true}).first().waitFor({timeout:35000});reached=true;}catch{}
  mark('result',{goalReached:reached,readouts:await page.locator('.scene-readouts').innerText(),feed:await page.locator('.stack-feed').innerText()});
  if(reached){await page.getByRole('button',{name:'Pause',exact:true}).click();}
  await sleep(4500);await page.screenshot({path:out+'/rover-result.png'});
 });
 await clip('voice',async(page,mark)=>{
  const query=[...await readFile(out+'/audio/query.wav')];
  await page.addInitScript(({wav})=>{
   let feed,queued=false;
   window.__audioParts=[];window.__voiceEvents=[];
   const Native=window.RTCPeerConnection;
   window.RTCPeerConnection=class extends Native{
    constructor(...args){super(...args);this.addEventListener('track',e=>{
     const recorder=new MediaRecorder(e.streams[0],{mimeType:'audio/webm;codecs=opus'});window.__recorder=recorder;
     recorder.ondataavailable=async ev=>window.__audioParts.push([...new Uint8Array(await ev.data.arrayBuffer())]);recorder.start(200);
    });}
    createDataChannel(...args){const dc=super.createDataChannel(...args);dc.addEventListener('message',e=>{
     const event=JSON.parse(e.data);window.__voiceEvents.push({type:event.type,at:performance.now(),delta:event.delta});
     if(event.type==='session.started'&&!queued){queued=true;setTimeout(()=>feed?.(),4500);}
    });return dc;}
   };
   navigator.mediaDevices.getUserMedia=async()=>{
    const ctx=new AudioContext(),dest=ctx.createMediaStreamDestination();const buffer=await ctx.decodeAudioData(new Uint8Array(wav).buffer);
    feed=()=>{const source=ctx.createBufferSource();source.buffer=buffer;source.connect(dest);source.start();window.__queryAt=performance.now();};
    return dest.stream;
   };
  },{wav:query});
  await page.goto(origin);await page.getByRole('heading',{name:'What should we work on?'}).waitFor();mark('ready');
  await page.getByRole('button',{name:'Talk to Aether',exact:true}).first().click();mark('clicked');
  await page.locator('.voice-overlay.live').waitFor({timeout:45000});mark('live');
  await sleep(19000);mark('response',{captions:await page.locator('.voice-captions').innerText()});
  await page.screenshot({path:out+'/voice-result.png'});
  await page.getByRole('button',{name:'End voice conversation'}).click();await sleep(700);
  await page.evaluate(async()=>{if(window.__recorder?.state==='recording'){window.__recorder.stop();await new Promise(r=>setTimeout(r,500));}});
  const chunks=await page.evaluate(()=>window.__audioParts);
  await writeFile(out+'/voice-audio.webm',Buffer.concat(chunks.map(c=>Buffer.from(c))));
  await writeFile(out+'/voice-events.json',JSON.stringify(await page.evaluate(()=>window.__voiceEvents),null,2));mark('closed');
 });
}finally{if(browser)await browser.close();server.kill();await writeFile(out+'/evidence.json',JSON.stringify(evidence,null,2));}
