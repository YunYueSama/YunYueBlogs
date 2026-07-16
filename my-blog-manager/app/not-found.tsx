import Link from 'next/link';
export default function NotFound() { return <section className="console-panel"><p className="console-note">404 / NOT FOUND</p><h1>没有找到这个控制台页面</h1><Link className="console-action" href="/admin">返回概览</Link></section>; }
