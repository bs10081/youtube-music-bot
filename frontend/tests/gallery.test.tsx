import { expect,test,vi } from 'vitest';
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GalleryView from '../src/components/listening/GalleryView';
import {useDiscoverStore} from '../src/stores/discoverStore';
import {usePlayerStore} from '../src/stores/playerStore';
import {api} from '../src/services/api';
import {ToastProvider} from '../src/components/ui/toast';
test('gallery renders real store data and queues the selected track via discover API',async()=>{
 const track={videoId:'test-video',title:'Store song',artist:'Store artist',duration:120};
 usePlayerStore.setState({connectionStatus:'connected'});
 useDiscoverStore.setState({initialized:true,initialize:vi.fn(),sections:[{id:'test',title:'測試推薦',items:[{kind:'track',id:track.videoId,title:track.title,artist:track.artist,duration:120,presentation:'song',track}]}],markets:[],moods:[],topRequested:[]});
 const queue=vi.spyOn(api,'queueDiscoverTrack').mockResolvedValue({success:true});
 vi.spyOn(useDiscoverStore.getState(),'refreshMarkets').mockResolvedValue(null);
 render(<ToastProvider><GalleryView /></ToastProvider>);
 expect(screen.getByRole('heading',{name:'測試推薦'})).toBeTruthy();
 await userEvent.click(screen.getByRole('button',{name:'加入佇列：Store song'}));
 await waitFor(()=>expect(queue).toHaveBeenCalledWith(track,undefined));
});
