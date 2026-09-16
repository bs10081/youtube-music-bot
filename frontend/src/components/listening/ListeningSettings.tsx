import { CrossfadeControl } from '@/components/player/CrossfadeControl';
import { VolumeNormalizationControl } from '@/components/player/VolumeNormalizationControl';
import { AudioOutputControl } from '@/components/player/AudioOutputControl';
import { FoliaBridgeControl } from '@/components/player/FoliaBridgeControl';
import { RadioToggleButton } from '@/components/player/RadioToggleButton';
import { VolumeControl } from '@/components/player/VolumeControl';
import { Header } from '@/components/layout/Header';
export default function ListeningSettings({solid, onSolidChange}: {solid:boolean; onSolidChange:(solid:boolean)=>void}) {
  return <div className="listening-settings">
    <label className="material-setting"><span><strong>不透明介面</strong><small>關閉模糊與折射，減少視覺干擾及繪圖負擔。</small></span><input type="checkbox" checked={solid} onChange={e => onSolidChange(e.target.checked)} /></label>
    <VolumeControl /><RadioToggleButton /><CrossfadeControl /><VolumeNormalizationControl compact /><AudioOutputControl compact /><FoliaBridgeControl compact />
    <div className="settings-about"><span>版本與更新資訊</span><Header compact /></div>
    <a className="legacy-link" href="?ui=legacy">切回舊版介面</a>
  </div>;
}
