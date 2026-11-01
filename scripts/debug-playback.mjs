import { chromium } from '@playwright/test';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
await page.goto('http://127.0.0.1:8000');
await page.locator('.mission-nav').getByRole('button',{name:'Rotating rendezvous',exact:true}).click();
await page.getByRole('button',{name:'Plan this mission'}).click();
await page.getByRole('button',{name:'Execute mission',exact:true}).waitFor();
await page.getByLabel('Playback speed').selectOption('fast');
await page.getByRole('button',{name:'Execute mission',exact:true}).click();
const start=Date.now();
for(let i=0;i<6;i++){await page.waitForTimeout(2500);console.log(Date.now()-start,await page.locator('.mission-clock').textContent(),await page.locator('.mission-state').textContent(),await page.evaluate(()=>({date:Date.now(),perf:performance.now(),visibility:document.visibilityState})));}
await page.screenshot({path:'output/docking.png',fullPage:true});await browser.close();
