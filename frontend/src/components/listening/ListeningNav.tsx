import { Compass, Search, Library, AudioLines } from 'lucide-react';
export type ListeningView = 'discover' | 'search' | 'library' | 'player';
export function ListeningNav({ view, onNavigate }: { view: ListeningView; onNavigate: (view: ListeningView) => void }) {
  return <nav aria-label="主要導覽" className="listening-nav">
    {([
      ['discover', '探索', Compass], ['search', '搜尋', Search],
      ['library', '曲庫', Library], ['player', '歌詞', AudioLines],
    ] as const).map(([id, label, Icon]) => <button key={id} type="button" aria-current={view === id ? 'page' : undefined} onClick={() => onNavigate(id)}>
      <Icon size={19} aria-hidden="true" /><span>{label}</span>
    </button>)}
  </nav>;
}
