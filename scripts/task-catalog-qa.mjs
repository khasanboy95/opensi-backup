// Manual visual QA for task categories with isolated sample records.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { fixture } from '../tests/helpers.mjs';

const f = await fixture();
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
try {
  const date = '2026-10-11T10:00:00.000Z';
  f.store.exec('INSERT INTO projects(id,user_id,title,environment,created_at,updated_at) VALUES(?,?,?,?,?,?)', 'prj_design', 'local-owner', 'Twins dizayni', 'cloud', date, date);
  for (const [id, status, prompt] of [
    ['run_qa1', 'running', 'Twins kirish sahifasini qayta yarating'],
    ['run_qa2', 'waiting_input', 'Ranglar palitrasini tanlang'],
    ['run_qa3', 'completed', 'IELTS reading PDF va HTML tayyorlang'],
    ['run_qa4', 'failed', 'Telegram botning webhookini sinang'],
  ]) f.store.exec('INSERT INTO runs(id,user_id,project_id,prompt,status,model,environment,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', id, 'local-owner', 'prj_design', prompt, status, 'qa-model', 'cloud', date, date);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(f.base + '/#/tasks');
  await page.getByText('4 ta vazifa', { exact: false }).first().waitFor();
  await page.screenshot({ path: 'task-catalog-desktop.png', fullPage: true });
  await page.getByRole('button', { name: /Sizni kutmoqda/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.task-row').length === 1);
  await page.getByText('Ranglar palitrasini tanlang').waitFor();
  assert.equal(await page.locator('.task-row').count(), 1);
  await page.getByRole('button', { name: /Barchasi/ }).click();
  await page.getByRole('textbox', { name: 'Vazifalarni qidirish' }).fill('IELTS');
  await page.waitForFunction(() => document.querySelectorAll('.task-row').length === 1);
  await page.getByText('IELTS reading PDF va HTML tayyorlang').waitFor();
  assert.equal(await page.locator('.task-row').count(), 1);
  await page.getByRole('button', { name: 'Filtrlarni tozalash' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('.sidebar')?.getBoundingClientRect().right <= 1);
  await page.screenshot({ path: 'task-catalog-mobile.png', fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow, 0, 'mobile page should not overflow horizontally');
  const innerOverflow = await page.evaluate(() => document.querySelector('.main-content').scrollWidth - document.querySelector('.main-content').clientWidth);
  assert.equal(innerOverflow, 0, 'mobile task content should not scroll horizontally');
  await page.setViewportSize({ width: 320, height: 740 });
  const narrowOverflow = await page.evaluate(() => document.querySelector('.main-content').scrollWidth - document.querySelector('.main-content').clientWidth);
  assert.equal(narrowOverflow, 0, 'narrow mobile task content should not scroll horizontally');
  await page.screenshot({ path: 'task-catalog-narrow.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Task catalog browser QA passed at 1440px and 390px.');
} finally { await browser.close(); await f.close(); }
