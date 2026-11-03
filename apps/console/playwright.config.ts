import { defineConfig } from '@playwright/test';
const port=process.env.E2E_CONSOLE_PORT||'5173';
export default defineConfig({
  testDir:'./tests/e2e', fullyParallel:false, workers:1, retries:0, reporter:'list',
  outputDir:'test-results',
  use:{baseURL:`http://127.0.0.1:${port}`,channel:'chrome',headless:true,trace:'off',viewport:{width:1440,height:1000}},
  webServer:{command:'node tests/preview-server.mjs',url:`http://127.0.0.1:${port}`,env:{CONSOLE_PREVIEW_PORT:port,CONSOLE_LOCAL_REVIEW:'0'},timeout:60000,reuseExistingServer:false},
});
