import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
// Contract fixtures only: these tests never start audio or mutate the live queue.
async function playerFixture(page: Page, position = 12) {
  const sockets: WebSocketRoute[]=[];
  const calls: {path:string; body:Record<string, number>}[]=[];
  const track={videoId:'fixture0001',title:'測試歌曲',artist:'測試藝人',duration:200};
  const lyrics=Array.from({length:18},(_,i)=>({time:i*10,text:`測試歌詞第 ${i+1} 句`}));
  const state={isPlaying:true,currentTrack:track,position,duration:200,volume:0,queue:[{...track,videoId:'fixture0002',title:'佇列測試二'},{...track,videoId:'fixture0003',title:'佇列測試三'}],radioEnabled:false,lastPlayedTrack:null,playbackSettings:{crossfadeEnabled:true,crossfadeDurationSeconds:4,volumeNormalizationEnabled:true}};
  const emit=(message:object)=>sockets.forEach(ws=>ws.send(JSON.stringify(message)));
  await page.routeWebSocket(url=>url.pathname === '/ws', ws=>{
    sockets.push(ws); ws.send(JSON.stringify({type:'playback_state',state})); ws.send(JSON.stringify({type:'lyrics',lyrics}));
  });
  await page.route('**/api/**',async route=>{
    const req=route.request(), path=new URL(req.url()).pathname;
    if (req.method()==='GET') return route.continue();
    const body=req.postDataJSON() || {}; calls.push({path,body});
    if(path==='/api/seek') { state.position=body.position; emit({type:'playback_progress',progress:{trackId:track.videoId,position:state.position,duration:200,isPlaying:state.isPlaying}}); }
    if(path==='/api/pause'||path==='/api/play') { state.isPlaying=path.endsWith('/play'); emit({type:state.isPlaying?'play':'pause'}); }
    if(req.method()==='DELETE' && path.startsWith('/api/queue/')) { state.queue.splice(Number(path.split('/').at(-1)),1); emit({type:'queue_updated',queue:state.queue}); }
    await route.fulfill({json:{success:true}});
  });
  return {calls,emit};
}
test('fixture: synced lyrics seek and transport use real message handlers', async ({page})=>{
  const fixture=await playerFixture(page);
  await page.goto('/?view=player');
  await expect(page.getByRole('region',{name:'同步歌詞'})).toBeVisible();
  await expect(page.locator('[data-lyric-index]')).toHaveCount(18);
  await page.locator('[data-lyric-index="4"]').getByRole('button',{name:'測試歌詞第 5 句',exact:true}).click();
  await expect.poll(()=>fixture.calls.some(c=>c.path==='/api/seek'&&c.body.position===40)).toBe(true);
  await expect(page.getByRole('slider',{name:'播放進度'})).toHaveValue('40');
  await page.getByRole('button',{name:'暫停',exact:true}).click();
  await expect(page.getByRole('button',{name:'播放',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'播放',exact:true}).click();
  await expect(page.getByRole('button',{name:'暫停',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:/播放佇列，/}).click();
  await expect(page.getByText('佇列測試二',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'移除',exact:true}).first().click();
  await expect(page.getByText('佇列測試二',{exact:true})).toHaveCount(0);
});
test('fixture: reduced motion aligns lyrics without a scroll animation', async ({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  // Capture from before mount: observing an already-running alignment is racy.
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    Object.defineProperty(Element.prototype, 'scrollTop', {
      ...descriptor,
      set(value: number) {
        if (this instanceof HTMLElement && this.closest('.focus-lyrics-content')) {
          const values = JSON.parse(this.getAttribute('data-scroll-samples') || '[]');
          const active = this.querySelector<HTMLElement>('[data-lyric-index="12"]');
          if (active) {
            const target = Math.min(Math.max(active.offsetTop - this.clientHeight / 2 + active.offsetHeight / 2, 0), Math.max(0, this.scrollHeight - this.clientHeight));
            values.push({ value, distance: Math.abs(value - target) });
          }
          this.setAttribute('data-scroll-samples', JSON.stringify(values));
        }
        descriptor.set!.call(this, value);
      },
    });
  });
  await playerFixture(page, 120);
  await page.goto('/?view=player');
  const scroll = page.locator('.focus-lyrics-content .overflow-y-auto');
  await expect.poll(async () => JSON.parse(await scroll.getAttribute('data-scroll-samples') || '[]').some((sample: {value: number}) => sample.value > 1)).toBe(true);
  await page.evaluate(async()=>{for(let i=0;i<6;i++)await new Promise(requestAnimationFrame);});
  const samples: {value: number; distance: number}[] = JSON.parse((await scroll.getAttribute('data-scroll-samples'))!);
  // Layout may resize, but every assignment must jump directly to its target.
  expect(Math.max(...samples.map(sample => sample.distance))).toBeLessThan(2);
});
test('solid mode persists on tailnet HTTP and reduced motion disables refraction', async ({page})=>{
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button',{name:'開啟設定'}).click();
  await page.getByRole('checkbox',{name:/不透明介面/}).check();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-material','solid');
  await expect(page.locator('.listening-lens')).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('button',{name:'開啟設定'}).click();
  await page.getByRole('checkbox',{name:/不透明介面/}).uncheck();
  await page.keyboard.press('Escape');
  await expect(page.locator('.listening-glass')).toHaveClass(/is-solid/);
  expect(errors).toEqual([]);
});
test('library playlist persists after reload over HTTP', async ({page})=>{
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?view=library');
  await page.getByRole('tab',{name:'自定歌單',exact:true}).click();
  await page.getByPlaceholder('例如：深夜放鬆、開車、工作中').fill('本機測試歌單');
  await page.getByRole('button',{name:'建立歌單',exact:true}).click();
  await expect(page.getByText('本機測試歌單',{exact:true}).first()).toBeVisible();
  await page.reload();
  await page.getByRole('tab',{name:'自定歌單',exact:true}).click();
  await expect(page.getByText('本機測試歌單',{exact:true}).first()).toBeVisible();
  expect(errors).toEqual([]);
});
