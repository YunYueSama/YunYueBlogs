export async function mapMusicChecks<T, R>(items: T[], task: (item: T) => Promise<R>, limit = 3, signal?: AbortSignal): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      // 离开管理页后不再派发后续歌曲；进行中的请求使用同一 signal 取消。
      signal?.throwIfAborted();
      const index = cursor++;
      output[index] = await task(items[index]);
    }
  }));
  return output;
}
