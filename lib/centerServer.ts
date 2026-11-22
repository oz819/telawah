import "server-only";
import { headers } from "next/headers";
import type { PublicCenter } from "@/lib/center";
import { DEMO, DEMO_INTERNAL_URL, demoFetch } from "@/lib/demo/fetch";

// Public centre lookups for server components (landing, registration, honor). They go through the
// anon-callable public_center RPC, so nothing private can leak through them. A centre whose public
// page is off counts as not found here, so all its public pages fall back to the platform's.
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  const url = DEMO ? DEMO_INTERNAL_URL : process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  try {
    const res = await (DEMO ? demoFetch : fetch)(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function visible(center: PublicCenter | null): PublicCenter | null {
  return center?.public_page ? center : null;
}

export async function centerBySlug(slug: string): Promise<PublicCenter | null> {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  return visible(await rpc<PublicCenter>("public_center", { p_slug: slug, p_domain: null }));
}

/** The centre this hostname belongs to (e.g. a centre's own .com), or the deployment's default. */
export async function centerForHost(): Promise<PublicCenter | null> {
  const host = ((await headers()).get("host") || "").split(":")[0].replace(/^www\./, "").toLowerCase();
  const byDomain = host ? visible(await rpc<PublicCenter>("public_center", { p_slug: null, p_domain: host })) : null;
  if (byDomain) return byDomain;
  const fallback = process.env.NEXT_PUBLIC_DEFAULT_CENTER;
  return fallback ? centerBySlug(fallback) : null;
}
