import type { Metadata } from "next";
import { redirect } from "next/navigation";
import CenterLanding from "@/components/center/CenterLanding";
import { centerBySlug } from "@/lib/centerServer";

// A centre's public page on the platform: /{slug}, e.g. /doha. Private (the default) or unknown
// centres send visitors to the platform's home page rather than saying the centre exists.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const center = await centerBySlug((await params).slug);
  return { title: center?.name ?? "المركز غير موجود", robots: { index: false, follow: false } };
}

export default async function CenterPage({ params }: Props) {
  const center = await centerBySlug((await params).slug);
  if (!center) redirect("/");
  return <CenterLanding center={center} base={`/${center.slug}`} />;
}
