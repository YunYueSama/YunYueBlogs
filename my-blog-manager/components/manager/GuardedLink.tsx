'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useNavigationGuard } from '../../context/NavigationGuardContext';

export default function GuardedLink(props: React.ComponentProps<typeof Link>) {
  const router = useRouter();
  const { navigate, blocked } = useNavigationGuard();
  return <Link {...props} onNavigate={(event) => {
    props.onNavigate?.(event);
    if (!blocked()) return;
    event.preventDefault();
    const href = typeof props.href === 'string' ? props.href : String(props.href.pathname || '/');
    navigate(() => router.push(href));
  }} />;
}
