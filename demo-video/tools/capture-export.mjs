// Record the actual film component and live rover simulation for MP4 export.
import { spawn } from 'node:child_process';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
const out=resolve('demo-video/source/export'), origin='http://127.0.0.1:8607';
await mkdir(out,{recursive:true});
const code="import uvicorn; from backend.main import app; from backend.harness import service; from pathlib import Path; service.RUNS_ROOT=Path('.aether/demo-video/runs'); uvicorn.run(app,host='127.0.0.1',port=8607,log_level='warning')";
const server=spawn(resolve('.venv/Scripts/python.exe'),['-c',code],{env:{...process.env,AETHER_STATIC_DIR:resolve('output/demo-video-build'),APP_ROOT_PATH:''},stdio:['ignore','ignore','pipe']});
let err='';server.stderr.on('data',b=>err+=b);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let browser;
try{
 let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(origin+'/api/health')).ok;}catch{}if(ready)break;await sleep(100);}
 if(!ready)throw Error('Server unavailable: '+err.slice(-600));
 browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling']});
 const context=await browser.newContext({viewport:{width:1440,height:810},deviceScaleFactor:1,recordVideo:{dir:out,size:{width:1440,height:810}}});
 const started=Date.now(),page=await context.newPage(),video=page.video();let goal=false,fault=false,replan=false;const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/demo');await page.getByText('Play the Aether film').waitFor();
 await page.addStyleTag({content:'.film-bar{display:none!important}.demo-film{cursor:none}.film-stage:after{content:"AI-generated narration";position:absolute;right:18px;bottom:14px;z-index:999;color:rgba(255,255,255,.72);font:12px system-ui;text-shadow:0 1px 5px #000;pointer-events:none}'});
 await page.getByText('Play the Aether film').click();const offset=(Date.now()-started)/1000;
 console.log('Recording 86-second film; opening offset',offset.toFixed(2),'s');
 for(let i=0;i<87;i++){
  await sleep(1000);
  const feed=await page.locator('.stack-feed').innerText().catch(()=>'');
  goal ||= feed.includes('Goal reached');fault ||= feed.includes('unmapped boulder');replan ||= feed.includes('New plan adopted');
  if(i===32)await page.screenshot({path:'demo-video/source/export/rover.png'});
  if(i===59)await page.screenshot({path:'demo-video/source/export/architecture.png'});
  if(i%20===19)console.log('Recorded',i+1,'seconds');
 }
 await context.close();await video.saveAs(out+'/film.webm');
 const report={offset,goal,fault,replan,errors};await writeFile(out+'/capture.json',JSON.stringify(report,null,2));console.log('Capture checks',JSON.stringify(report));
 if(!goal||!fault||!replan||errors.length)throw Error('Live scene checks did not pass; inspect the capture report');
}finally{if(browser)await browser.close();server.kill();}
