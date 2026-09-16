import { expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

test('one responsive navigation offers explore, search, library and lyrics without duplicate trees', async () => {
  const { ListeningNav: Nav } = await import('../src/components/listening/ListeningNav');
  const change = vi.fn();
  render(<Nav view="discover" onNavigate={change} />);
  expect(screen.getAllByRole('navigation')).toHaveLength(1);
  expect(screen.getByRole('button', { name: '探索' }).getAttribute('aria-current')).toBe('page');
  await userEvent.click(screen.getByRole('button', { name: '歌詞' }));
  expect(change).toHaveBeenCalledWith('player');
  await userEvent.click(screen.getByRole('button', { name: '搜尋' }));
  expect(change).toHaveBeenCalledWith('search');
  expect(screen.getByRole('button', { name: '曲庫' })).toBeTruthy();
});
