import { redirect } from "next/navigation";
import HonorBoard, { metadata } from "@/components/HonorBoard";
import { centerBySlug } from "@/lib/centerServer";

export const dynamic = "force-dynamic";
export { metadata };

export default async function CenterHonorPage({ params }: { params: Promise<{ slug: string }> }) {
  const center = await centerBySlug((await params).slug);
  if (!center) redirect("/");
  return <HonorBoard center={center} />;
}
