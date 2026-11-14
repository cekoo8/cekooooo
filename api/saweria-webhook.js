// Dipanggil Saweria setiap ada donasi: simpan catatan donasi asli (dipakai untuk mencocokkan screenshot).
// Versi Vercel (port dari Netlify). Penyimpanan: Upstash Redis (pengganti Netlify Blobs).
import { createHmac, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";

// Integrasi Upstash di Vercel mengisi KV_REST_API_URL / KV_REST_API_TOKEN (atau UPSTASH_REDIS_REST_*).
let redis;
const db = () => (redis ||= new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
}));

// Rumus tanda tangan: HMAC-SHA256(stream key, version+id+amount_raw+donator_name+donator_email), hex.
// (Dari ingatan, belum teruji. Kalau webhook uji kena 401, cek log fungsi ini.)
function verify(p, sig, key) {
  const msg = `${p.version}${p.id}${p.amount_raw}${p.donator_name}${p.donator_email}`;
  const a = Buffer.from(createHmac("sha256", key).update(msg).digest("hex"));
  const b = Buffer.from(String(sig || "").toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

export default {
  async fetch(req) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    if (process.env.WEBHOOK_KEY && new URL(req.url).searchParams.get("key") !== process.env.WEBHOOK_KEY) return new Response("forbidden", { status: 403 });

    let p;
    try { p = JSON.parse(await req.text()); } catch { return new Response("bad json", { status: 400 }); }

    if (process.env.VERIFY_SIGNATURE !== "false" && !verify(p, req.headers.get("saweria-callback-signature"), process.env.SAWERIA_STREAM_KEY || "")) {
      console.error("Tanda tangan tidak cocok untuk donasi", p.id);
      return new Response("invalid signature", { status: 401 });
    }
    if (p.type !== "donation") return new Response("ignored");
    if (Number(p.amount_raw) < Number(process.env.MIN_AMOUNT || 0)) return new Response("below minimum");

    if (await db().get(`don:${p.id}`)) return new Response("duplicate"); // Saweria bisa mengirim ulang
    await db().set(`don:${p.id}`, { name: p.donator_name, amount: p.amount_raw, ts: Date.now(), claimed: false });
    return new Response("ok");
  },
};
