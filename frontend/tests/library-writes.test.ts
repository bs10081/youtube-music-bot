import { expect, test, vi } from 'vitest';
import { useLibraryStore } from '../src/stores/libraryStore';
import * as db from '../src/services/library-db';
test('concurrent initializers load the snapshot once', async () => {
 useLibraryStore.setState({ready:false,snapshot:null});
 const load=vi.spyOn(db,'loadLibrarySnapshot').mockResolvedValue(db.createInitialLibrarySnapshot());
 await Promise.all([useLibraryStore.getState().initialize(),useLibraryStore.getState().initialize()]);
 expect(load).toHaveBeenCalledTimes(1);
});

test('concurrent playlist writes retain both edits instead of overwriting stale snapshots', async () => {
 useLibraryStore.setState({ready:true,snapshot:db.createInitialLibrarySnapshot()});
 vi.spyOn(db,'saveLibrarySnapshot').mockResolvedValue();
 await Promise.all([useLibraryStore.getState().createPlaylist('第一張'),useLibraryStore.getState().createPlaylist('第二張')]);
 expect(useLibraryStore.getState().snapshot?.playlists.map(p=>p.name).sort()).toEqual(['第一張','第二張'].sort());
});
