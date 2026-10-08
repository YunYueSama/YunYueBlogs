'use client';

import Link from 'next/link';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="console-panel recovery-panel" role="alert"><h2>页面暂时无法读取</h2><p>请重试加载。如果问题持续，请检查工作区文件或重启控制台。</p><div className="console-page-actions"><button className="console-action" onClick={reset}>重新加载</button><Link className="console-action secondary" href="/admin">返回概览</Link></div></section>;
}
