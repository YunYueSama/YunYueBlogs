import { redirect } from 'next/navigation';

export default function LegacyAboutPage() {
  redirect('/editor?id=about&type=about');
}
