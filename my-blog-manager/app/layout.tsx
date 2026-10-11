import type { Metadata } from 'next';
import 'katex/dist/katex.min.css';
import './globals.css';
import ConsoleShell from '../components/manager/ConsoleShell';
import { ToastProvider } from '../components/ToastProvider';
import { OperationProvider } from '../context/OperationContext';
import { NavigationGuardProvider } from '../context/NavigationGuardContext';
import CloudContentStatus from '../components/manager/CloudContentStatus';

export const metadata: Metadata = {
  title: { default: '星辉云端控制台', template: '%s | 星辉云端' },
  description: 'YunYueBlogs 本地内容、集成与发布控制台。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><NavigationGuardProvider><OperationProvider><ToastProvider><ConsoleShell><CloudContentStatus />{children}</ConsoleShell></ToastProvider></OperationProvider></NavigationGuardProvider></body>
    </html>
  );
}
