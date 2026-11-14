// Dipanggil game: baca screenshot dengan Claude (vision) ATAU terima nama+nominal manual, lalu cocokkan dengan donasi asli dari webhook.
// Screenshot saja tidak membuktikan apa-apa; yang menentukan adalah ada-tidaknya donasi yang cocok di server.
//
// Versi Vercel (port dari Netlify). Penyimpanan: Upstash Redis (pengganti Netlify Blobs).
// Format data donasi yang dibaca fungsi ini (ditulis oleh webhook Saweria):
//   key   : "don:<id unik>"
//   value : { name: string, amount: number, ts: number (ms), claimed?: boolean }
import { Redis } from "@upstash/redis";

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const WINDOW = Number(process.env.CLAIM_WINDOW_HOURS || 24) * 36e5; // donasi harus baru masuk dalam jendela ini

// Integrasi Upstash di Vercel mengisi KV_REST_API_URL / KV_REST_API_TOKEN (atau UPSTASH_REDIS_REST_*).
let redis;
const db = () => (redis ||= new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
}));

// Ambil semua key berawalan prefix (pengganti store.list di Netlify Blobs).
async function listKeys(prefix) {
  const keys = []; let cursor = "0";
  do {
    const [next, batch] = await db().scan(cursor, { match: `${prefix}*`, count: 100 });
    keys.push(...batch); cursor = String(next);
  } while (cursor !== "0");
  return keys;
}

// Upstash biasanya sudah mengubah JSON jadi objek; jaga-jaga kalau yang tersimpan berupa string.
const asObj = (v) => { if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } } return v; };

async function readShot(b64) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.VISION_MODEL || "claude-haiku-5-5", max_tokens: 300,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
        { type: "text", text: 'Ini screenshot bukti pembayaran donasi (halaman sukses Saweria, atau struk e-wallet/bank/QRIS yang menunjukkan transaksi berhasil). Balas HANYA JSON: {"is_payment_success":boolean,"amount":number,"donor_name":string|null,"date":string|null}. "amount" dalam rupiah tanpa titik atau koma. donor_name isi null bila tidak tertulis. Jika ini bukan bukti pembayaran yang berhasil, atau tidak terbaca, isi is_payment_success=false.' },
      ] }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const text = (await res.json()).content?.find((c) => c.type === "text")?.text || "";
  return JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
}

export default {
  async fetch(req) {
    if (req.method !== "POST") return json({ ok: false }, 405);
    let body; try { body = await req.json(); } catch { return json({ ok: false }, 400); }
    const manual = !body.image; // jalur tanpa screenshot: nama (kolom "Dari") + nominal, tanpa AI
    let info;
    if (manual) {
      info = { is_payment_success: true, amount: Number(body.amount), donor_name: String(body.name || "").trim().slice(0, 60) };
      if (!info.donor_name || !(info.amount > 0)) return json({ ok: false, reason: "unreadable" }, 422);
    } else {
      const b64 = String(body.image || "").replace(/^data:image\/\w+;base64,/, "");
      if (b64.length < 1000 || b64.length > 4_000_000) return json({ ok: false, reason: "unreadable" }, 422);
      // Batas pemeriksaan AI per hari, supaya tagihan API tidak jebol kalau ada yang spam.
      const capKey = `cap:${new Date().toISOString().slice(0, 10)}`;
      const used = await db().incr(capKey);
      if (used === 1) await db().expire(capKey, 172800);
      if (used > Number(process.env.MAX_CHECKS_PER_DAY || 200)) return json({ ok: false, reason: "busy" }, 429);
      try { info = await readShot(b64); } catch (e) { console.error(e); return json({ ok: false, reason: "error" }, 502); }
      if (!info.is_payment_success || !(Number(info.amount) > 0)) return json({ ok: false, reason: "unreadable" }, 422);
    }

    const keys = await listKeys("don:");
    // Cocokkan nominal dengan donasi asli yang baru masuk & belum diklaim. Nama di struk sering tidak ada,
    // jadi hanya dipakai untuk memilih bila ada beberapa donasi bernominal sama.
    let hit = null, claimed = false;
    for (const key of keys) {
      const r = asObj(await db().get(key));
      if (!r || Date.now() - r.ts > WINDOW || Number(r.amount) !== Number(info.amount)) continue;
      const score = info.donor_name && norm(r.name) === norm(info.donor_name) ? 0 : 1;
      if (manual && score) continue; // tanpa screenshot, nama wajib cocok
      if (r.claimed) { claimed = true; continue; }
      if (!hit || score < hit.score || (score === hit.score && r.ts < hit.r.ts)) hit = { key, r, score };
    }
    if (!hit) return claimed ? json({ ok: false, reason: "claimed" }, 409) : json({ ok: false, reason: "nomatch" }, 404);
    await db().set(hit.key, { ...hit.r, claimed: true, claimedAt: Date.now() });
    return json({ ok: true });
  },
};
