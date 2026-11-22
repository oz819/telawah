import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PublicShell from "@/components/PublicShell";
import RegisterForm from "@/components/RegisterForm";
import { centerBySlug } from "@/lib/centerServer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "تسجيل طالب جديد", robots: { index: false, follow: false } };

export default async function CenterRegisterPage({ params }: { params: Promise<{ slug: string }> }) {
  const center = await centerBySlug((await params).slug);
  if (!center) redirect("/");
  return (
    <PublicShell center={center}>
      <RegisterForm centerSlug={center.slug} open={center.registrations_open !== false} centerName={center.name} />
    </PublicShell>
  );
}
