export type DeployJob = { jobId: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; message: string; createdAt?: number };

export async function watchDeployJob(
  jobId: string,
  read: (id: string, signal: AbortSignal) => Promise<DeployJob>,
  onProgress: (job: DeployJob) => void,
  signal: AbortSignal,
  interval = 1_000,
  attempts = 120,
) {
  for (let index = 0; index < attempts; index += 1) {
    signal.throwIfAborted();
    const job = await read(jobId, signal);
    signal.throwIfAborted();
    onProgress(job);
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, interval);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  // 轮询到期不代表服务器任务失败，调用者保留任务并提供继续查看入口。
  return null;
}
