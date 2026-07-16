'use client';
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) { return <section className="console-panel"><h1>页面加载失败</h1><p className="console-note">{error.message || '发生未知错误。'}</p><button className="console-action" type="button" onClick={reset}>重新加载</button></section>; }
