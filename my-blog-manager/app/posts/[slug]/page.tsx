import { redirect } from 'next/navigation';

export default async function LegacyPostDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/editor?id=${encodeURIComponent(slug)}&type=post`);
}
