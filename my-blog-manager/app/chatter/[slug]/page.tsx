import { redirect } from 'next/navigation';

export default async function LegacyChatterDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/editor?id=${encodeURIComponent(slug)}&type=chatter`);
}
