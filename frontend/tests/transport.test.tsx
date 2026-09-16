import { expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Transport } from '../src/components/listening/Transport';
import { usePlayerStore } from '../src/stores/playerStore';
import { api } from '../src/services/api';
import { ToastProvider } from '../src/components/ui/toast';

test('transport pauses through the real API contract and keeps server state authoritative', async () => {
  usePlayerStore.setState({connectionStatus: 'connected', isLoadingTrack: false});
  usePlayerStore.getState().updatePlaybackState({isPlaying: true, currentTrack: {videoId:'test',title:'Test',artist:'Artist',duration:120}, position:30, duration:120});
  const pause = vi.spyOn(api,'pause').mockResolvedValue({success:true});
  render(<ToastProvider><Transport /></ToastProvider>);
  await userEvent.click(screen.getByRole('button',{name:'暫停'}));
  await waitFor(() => expect(pause).toHaveBeenCalledTimes(1));
  expect(usePlayerStore.getState().playbackState.isPlaying).toBe(true);
});
test('queued tracks can restart playback when no current track remains', async () => {
  usePlayerStore.setState({connectionStatus:'connected',isLoadingTrack:false});
  usePlayerStore.getState().updatePlaybackState({currentTrack:null,isPlaying:false,queue:[{videoId:'test',title:'Queued',artist:'Artist',duration:120}]});
  const play = vi.spyOn(api,'play').mockResolvedValue({success:true});
  render(<ToastProvider><Transport /></ToastProvider>);
  await userEvent.click(screen.getByRole('button',{name:'播放',exact:true}));
  await waitFor(()=>expect(play).toHaveBeenCalledTimes(1));
});
