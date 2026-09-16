import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir:'e2e', timeout:30000, retries:0, workers:1, use:{baseURL:process.env.E2E_BASE_URL || 'http://127.0.0.1:5174', headless:true, viewport:{width:1440,height:1000}}, reporter:'list' });
