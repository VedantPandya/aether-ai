import { test, expect } from '@playwright/test';
for (const mission of ['Orbital transfer','Rotating rendezvous','Lunar pathfinder','First light']) {
  test(`${mission}: plan, fly, and export a completed mission`, async ({ page }) => {
    const errors: string[]=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto('/');
    await page.locator('.mission-nav').getByRole('button',{name:mission,exact:true}).click();
    await page.getByRole('button',{name:'Plan this mission',exact:true}).click();
    await expect(page.getByRole('button',{name:'Execute mission',exact:true})).toBeEnabled();
    await page.getByLabel('Playback speed').selectOption('fast');
    await page.getByRole('button',{name:'Execute mission',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('Mission complete.',{timeout:20000});
    const download=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download report'}).click();
    expect((await download).suggestedFilename()).toMatch(/^aether-.*\.json$/);
    expect(errors).toEqual([]);
  });
}
test('fuel anomaly blocks execution, restoring nominal settings recovers', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Plan this mission'}).click();
  await expect(page.getByRole('button',{name:'Execute mission',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Inject fuel leak'}).click();
  await expect(page.getByText('MISSION ON HOLD',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Execute mission',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Mission settings',exact:true}).click();
  await page.getByLabel('Fuel (kg)',{exact:true}).fill('120');
  await page.getByRole('button',{name:'Save configuration'}).click();
  await page.getByRole('button',{name:'Plan this mission'}).click();
  await expect(page.getByRole('button',{name:'Execute mission',exact:true})).toBeEnabled();
});
test('knowledge graph navigation and trace inspection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button',{name:/Physics library/}).click();
  await page.getByLabel('Search physics library').fill('rocket');
  await page.getByRole('button',{name:/Propulsion The rocket equation/}).click();
  await expect(page.locator('.equation')).toContainText('ln(m0/mf)');
  await page.locator('.graph-children').getByRole('button',{name:'PD flight control'}).click();
  await expect(page.locator('.topic-content h2')).toHaveText('PD flight control');
  await page.getByRole('button',{name:'Mission control',exact:true}).click();
  await page.getByRole('button',{name:'Plan this mission'}).click();
  await expect(page.getByRole('button',{name:'Execute mission',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:/Flight log/}).click();
  await expect(page.getByText('plan_mission',{exact:true})).toBeVisible();
});
test('mobile layout stays inside the viewport', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.getByRole('button',{name:'Plan this mission'}).click();
  await expect(page.getByRole('button',{name:'Execute mission',exact:true})).toBeEnabled();
  const dimensions=await page.evaluate(()=>({content:document.documentElement.scrollWidth,viewport:window.innerWidth}));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
});
