import { useEffect, useState } from 'react';
import { ArrowUpRight, Loader2, Music2, Plus, Radio, RefreshCw } from 'lucide-react';
import { useDiscoverStore } from '@/stores/discoverStore';
import { usePlayerStore } from '@/stores/playerStore';
import { getCurrentRequester, useLibraryStore } from '@/stores/libraryStore';
import { useAlbumDialogStore } from '@/stores/albumDialogStore';
import { usePlaylistDialogStore } from '@/stores/playlistDialogStore';
import { Avatar } from '@/components/ui/avatar';
import { OpenAlbumButton } from '@/components/album/OpenAlbumButton';
import { OpenArtistButton } from '@/components/artist/OpenArtistButton';
import { useToast } from '@/components/ui/toast';
import { api } from '@/services/api';
import { TrackActions } from './TrackActions';
import type { DiscoverItem, DiscoverMarketCode } from '@/types';

function GalleryCard({item}: {item: DiscoverItem}) {
  const [pending, setPending] = useState(false);
  const connected = usePlayerStore(s => s.connectionStatus === 'connected');
  const {showToast} = useToast();
  const act = async (mix = false) => {
    if (pending || !connected) return;
    setPending(true);
    try {
      const requester = getCurrentRequester(useLibraryStore.getState().snapshot);
      if (mix && item.kind === 'track') {
        const result = await api.createMix(item.track, requester);
        if (!result.success || !result.data) throw new Error(result.error || '建立 Mix 失敗');
        await useLibraryStore.getState().saveMix(item.track, result.data.tracks);
        showToast({message:`已建立 Mix，加入 ${result.data.count} 首`,type:'success'});
      } else {
        const result = item.kind === 'track' ? await api.queueDiscoverTrack(item.track, requester) : await api.queueDiscoverCollection(item.kind, item.id, requester);
        if (!result.success) throw new Error(result.error || '加入佇列失敗');
        showToast({message:`已加入佇列：${item.title}`,type:'success'});
      }
      void useDiscoverStore.getState().refreshMarkets();
    } catch (error) { showToast({message:error instanceof Error ? error.message : '操作失敗',type:'error'}); }
    finally { setPending(false); }
  };
  const open = () => {
    if (item.kind === 'album') useAlbumDialogStore.getState().openAlbum({id:item.id,name:item.title});
    else if (item.kind === 'playlist') usePlaylistDialogStore.getState().openPlaylist({id:item.id,name:item.title});
  };
  return <article className="gallery-card">
    <div className="gallery-cover">
      <Avatar src={item.thumbnail} alt={item.title} thumbnailQuality="sddefault" className="gallery-image" fallback={<Music2 size={38} />} />
      <span className="gallery-kind">{item.kind === 'track' ? item.presentation === 'video' ? 'MV' : 'SONG' : item.kind === 'album' ? 'ALBUM' : 'PLAYLIST'}</span>
      <button className="gallery-add" aria-label={`加入佇列：${item.title}`} disabled={pending || !connected} onClick={() => void act()}>{pending ? <Loader2 className="animate-spin" size={22} /> : <Plus size={22} />}</button>
    </div>
    <div className="gallery-card-title">{item.kind === 'track' ? <h3 title={item.title}>{item.title}</h3> : <button onClick={open}><h3 title={item.title}>{item.title}</h3><ArrowUpRight size={16} /></button>}</div>
    <p className="gallery-artist" title={item.artist}>{item.artist}</p>
    <div className="gallery-secondary">
      {item.kind === 'track' ? <><button aria-label={`建立 Mix：${item.title}`} disabled={pending || !connected} onClick={() => void act(true)}><Radio size={16} /><span>Mix</span></button><TrackActions track={item.track} /></> : <button onClick={open}>查看{item.kind === 'album' ? '專輯' : '歌單'}<ArrowUpRight size={15} /></button>}
    </div>
    <div className="gallery-detail-links"><OpenArtistButton artistId={item.artistId} artistName={item.artist} />{item.kind === 'track' && <OpenAlbumButton album={item.track.album} trackTitle={item.title} />}</div>
  </article>;
}

export default function GalleryView() {
  const store = useDiscoverStore();
  const initialize = store.initialize;
  useEffect(() => { void initialize(); }, [initialize]);
  const first = store.sections.flatMap(s => s.items).find(item => item.thumbnail);
  const localItems: DiscoverItem[] = store.topRequested.map(entry => ({kind:'track',id:entry.track.videoId,title:entry.track.title,artist:entry.track.artist,thumbnail:entry.track.thumbnail,duration:entry.track.duration,presentation:'song',track:entry.track}));
  const sections = [...(localItems.length ? [{id:'local-top',title:'大家最近在聽',subtitle:'本站真實點播排行',items:localItems}] : []), ...store.sections];
  return <div className="gallery-page">
    <header className="view-heading"><div><span className="eyebrow">A LITTLE DISCOVERY, EVERY DAY</span><h1>找到此刻的旋律。</h1><p>探索新聲音，也重逢那些一直喜歡的歌。</p></div><div className="gallery-market"><select aria-label="探索市場" value={store.selectedMarket} onChange={e => void store.selectMarket(e.target.value as DiscoverMarketCode)}>{store.markets.length ? store.markets.map(m => <option key={m.code} value={m.code}>{m.label}</option>) : <option value="TW">台灣</option>}</select><button aria-label="重新整理推薦" disabled={store.isFeedLoading} onClick={() => {void store.refreshMarkets(); void store.refreshFeed();}}><RefreshCw size={18} className={store.isFeedLoading ? 'animate-spin' : ''} /></button></div></header>
    <section className="gallery-hero" aria-label="探索精選">
      {first?.thumbnail && <img className="gallery-hero-image" src={first.thumbnail} alt="" decoding="async" />}
      <div className="gallery-hero-wash" />
      <div className="gallery-hero-copy"><span className="eyebrow">CURATED BY YOUTUBE MUSIC</span><h2>{store.selectedMoodKey ? store.moods.find(m=>m.key===store.selectedMoodKey)?.label || '跟著心情，換個節奏。' : '把世界調小，\n把音樂打開。'}</h2><p>{first ? `從「${first.title}」開始，發現更多值得留下的聲音。` : '從下方推薦挑一首，或搜尋你心裡的那首歌。'}</p><a href="#gallery-sections" className="action-primary">探索推薦 <ArrowUpRight size={17} /></a></div>
    </section>
    <div className="gallery-moods" role="group" aria-label="音樂心情"><button aria-pressed={!store.selectedMoodKey} onClick={()=>void store.selectMood(null)}>全部推薦</button>{store.moods.map(m=><button key={m.key} aria-pressed={store.selectedMoodKey===m.key} onClick={()=>void store.selectMood(m.key)}>{m.label}</button>)}</div>
    {(store.feedError || store.marketsError) && <div role="alert" className="listening-notice">{store.feedError || store.marketsError}<button onClick={()=>{void store.refreshMarkets();void store.refreshFeed();}}>重試</button></div>}
    {store.warnings.length > 0 && <details className="feed-warnings"><summary>來源狀態（{store.warnings.length}）</summary>{store.warnings.map((w,i)=><p key={i}>{w}</p>)}</details>}
    {store.isFeedLoading && <div role="status" className="gallery-loading"><Loader2 className="animate-spin" size={18} />正在更新推薦…</div>}
    <div id="gallery-sections">{sections.map(section=><section key={section.id} className="gallery-section"><div className="gallery-section-heading"><div><h2>{section.title}</h2>{section.subtitle && <p>{section.subtitle}</p>}</div><span>{section.items.length} 項</span></div><div className="gallery-rail" tabIndex={0} aria-label={section.title}>{section.items.map(item=><GalleryCard key={`${item.kind}:${item.id}`} item={item} />)}</div></section>)}</div>
    {!store.isFeedLoading && !sections.length && <div className="listening-empty"><Music2 size={34} /><h2>這裡還沒有推薦</h2><p>可切換市場、重新整理，或從搜尋開始。</p></div>}
    <footer className="gallery-footer">真實推薦 · 即時共享播放 · 你的私人音樂空間</footer>
  </div>;
}
