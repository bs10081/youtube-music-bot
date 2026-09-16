import { Music2, Search } from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';
import { AnimatedAvatar } from '@/components/ui/animated-avatar';
import { LyricsContent } from '@/components/lyrics/LyricsContent';
import { OpenAlbumButton } from '@/components/album/OpenAlbumButton';
import { TrackActions } from './TrackActions';
export default function FocusPlayer({onSearch}: {onSearch:()=>void}) {
  const track = usePlayerStore(s => s.playbackState.currentTrack);
  const playing = usePlayerStore(s => s.playbackState.isPlaying);
  const lyrics = usePlayerStore(s => s.lyrics);
  return <div className="focus-page">
    <header className="view-heading"><div><span className="eyebrow">YOUR LISTENING SPACE</span><h1>正在播放</h1></div><span className="muted">{playing ? '播放中' : track ? '已暫停' : '等待點播'}</span></header>
    {!track ? <div className="listening-empty"><Music2 size={48} /><h2>下一首，想聽什麼？</h2><p>加入歌曲後，封面與同步歌詞會出現在這裡。</p><button className="action-primary" onClick={onSearch}><Search size={18} />搜尋音樂</button></div> : <div className="focus-grid">
      <section className="focus-record" aria-label="歌曲資訊">
        <AnimatedAvatar src={track.thumbnail} alt={track.title} thumbnailQuality="maxresdefault" size="lg" className="focus-cover" />
        <div className="focus-metadata"><div><h2>{track.title}</h2><p>{track.artist}</p><OpenAlbumButton album={track.album} trackTitle={track.title} />{track.requestedBy?.profileName && <small>點歌者：{track.requestedBy.profileName}</small>}</div><TrackActions track={track} /></div>
        <p className="listening-caption">音訊由伺服器播放 · 所有裝置共享播放進度</p>
      </section>
      <section className="focus-lyrics" aria-label="同步歌詞"><div className="lyrics-label"><span className="eyebrow">LIVE LYRICS</span><span>{lyrics.length ? '點擊任一句跳轉播放' : '等待歌詞資料'}</span></div><div className="focus-lyrics-content"><LyricsContent isVisible variant="dark" /></div></section>
    </div>}
  </div>;
}
