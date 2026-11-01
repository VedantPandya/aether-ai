import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 40000, workers: 1, retries: 0,
  use: { baseURL: 'http://127.0.0.1:8000', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', launchOptions: { executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] } },
  reporter: 'list',
});
