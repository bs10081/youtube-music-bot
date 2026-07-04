/**
 * 以 FIFO 淘汰的上限快取寫入:Map 的插入順序即最舊順序,
 * 重複寫入同 key 時先刪再插,讓該 key 變成最新。
 */
export function setCappedCacheValue<T>(
  cache: Map<string, T>,
  key: string,
  value: T,
  limit: number,
): void {
  if (cache.has(key)) {
    cache.delete(key);
  }

  cache.set(key, value);

  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    cache.delete(oldestKey);
  }
}
