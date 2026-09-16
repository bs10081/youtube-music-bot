import { expect, test } from '@playwright/test';
test('glass navigation fills its bounded surface', async ({page}) => {
 await page.goto('/');
 await page.locator('.listening-lens').waitFor();
 await expect.poll(async()=> (await page.getByRole('navigation', {name:'主要導覽'}).boundingBox())?.width).toBeGreaterThan(330);
});

test('real responsive shell has a single navigation and persistent player', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', {name:'主要導覽'})).toHaveCount(1);
  await expect(page.getByRole('region', {name:'持續播放控制'})).toBeVisible();
  await page.getByRole('button', {name:'歌詞', exact:true}).click();
  await expect(page.getByRole('heading', {name:'正在播放',exact:true})).toBeVisible();
  await page.getByRole('button', {name:'搜尋',exact:true}).click();
  await expect(page.getByPlaceholder(/搜尋歌曲/)).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('navigation', {name:'主要導覽'})).toHaveCount(1);
  await expect(page.getByRole('region', {name:'持續播放控制'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.listening-lens')).toHaveCount(0);
});
