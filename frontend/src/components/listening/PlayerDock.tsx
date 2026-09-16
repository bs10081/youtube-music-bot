import { AudioLines, ListMusic, Music2, Settings2 } from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';
import { Avatar } from '@/components/ui/avatar';
import { ProgressBar } from '@/components/player/ProgressBar';
import { VolumeControl } from '@/components/player/VolumeControl';
import { Transport } from './Transport';
import { TrackActions } from './TrackActions';
export function PlayerDock({onPlayer, onQueue, onSettings}: {onPlayer:()=>void; onQueue:()=>void; onSettings:()=>void}) {
  const track = usePlayerStore(s => s.playbackState.currentTrack);
  const count = usePlayerStore(s => s.playbackState.queue.length);
  const loading = usePlayerStore(s => s.isLoadingTrack);
  return <section className="listening-dock" aria-label="持續播放控制">
    <button className="dock-identity" onClick={onPlayer} aria-label="開啟正在播放與歌詞">
      <Avatar src={track?.thumbnail} alt="" className="dock-art" fallback={<Music2 />} />
      <span><strong>{track?.title || '讓音樂陪你一下'}</strong><small>{loading ? '正在載入歌曲…' : track?.artist || '從探索或搜尋加入第一首歌'}</small></span>
    </button>
    <div className="dock-playback"><Transport /><div className="dock-progress"><ProgressBar /></div></div>
    <div className="dock-tools">
      {track && <div className="dock-favorite"><TrackActions track={track} /></div>}
      <button aria-label="開啟歌詞" className="dock-lyrics-button" onClick={onPlayer}><AudioLines size={20} /></button>
      <button aria-label={`播放佇列，${count} 首`} onClick={onQueue}><ListMusic size={20} /><span className="queue-count">{count}</span></button>
      <button aria-label="播放設定" onClick={onSettings}><Settings2 size={19} /></button>
      <div className="dock-volume"><VolumeControl /></div>
    </div>
  </section>;
}
