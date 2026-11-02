// Finds x402 services in the Coinbase Bazaar and keeps only ones that answer live with a valid
// Base USDC price right now. Nothing here pays. Free APIs only. Writes market.json.
import fs from 'node:fs';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', API = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery';
const MAX = Number(process.env.MAX || 48), PROBE = Number(process.env.PROBE || 110);
const old = fs.existsSync('market.json') ? JSON.parse(fs.readFileSync('market.json', 'utf8')) : { services: [] };
const J = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); };
const ok = (a) => a && a.scheme === 'exact' && a.network === 'eip155:8453' && String(a.asset).toLowerCase() === USDC && /^\d+$/.test(String(a.amount)) && Number(a.amount) > 0 && Number(a.amount) <= 1e6 && /^0x[0-9a-fA-F]{40}$/.test(a.payTo || '');
const CATS = [['Weather & geo', /\b(weather|forecast|geocod)/], ['Finance & markets', /\b(fx|forex|stocks?|equit|polymarket|prediction|trading|cloud pricing|gpu pric|bid\/ask)/], ['Crypto & on-chain', /\b(token|wallet|defi|crypto|onchain|on-chain|blockchain|nft|swap|dex|solana|ethereum|erc-?20|block height|block number|gas price)/],
  ['Search & web', /\b(search|scrap|crawl|web|urls?|serp|news|headlines|tweets?|twitter)/], ['Images & media', /\b(image|photo|video|audio|tts|speech|music|render|screenshot)/], ['Data & analytics', /\b(data|analytics|leads?|company|enrich|stats|dataset|research|report)/], ['AI & LLM', /\b(ai|llm|gpt|chat|completion|model|inference|summar|prompt)\b/], ['Utilities', /./]];
const cat = (s) => CATS.find(([, r]) => r.test(s))[0];
const slug = (s) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
const QS = ['ai', 'image generation', 'weather', 'token price', 'wallet', 'search', 'news', 'leads', 'stock', 'translate', 'scrape', 'summarize', 'crypto', 'data', 'video', 'audio', 'email', 'sports', 'research', 'security'];
const pool = new Map();
const add = (i) => { const a = (i.accepts || []).find(ok); if (a && i.resource && !pool.has(i.resource)) pool.set(i.resource, { ...i, a }); };
for (const q of QS) { try { (await J(`${API}/search?query=${encodeURIComponent(q)}&limit=20`)).resources?.forEach(add); } catch (e) { console.log('search', q, e.message); } }
for (let o = 0; o < 300; o += 100) { try { (await J(`${API}/resources?limit=100&offset=${o}`)).items?.forEach(add); } catch (e) { console.log('resources', e.message); } }
const b64 = (s) => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
async function probe(i) {
  const m = (i.extensions?.bazaar?.info?.input?.method || (i.extensions?.bazaar?.info?.input?.bodyType ? 'POST' : 'GET')).toUpperCase();
  const t0 = Date.now();
  const r = await fetch(i.resource, { method: m, headers: m === 'GET' ? {} : { 'content-type': 'application/json' }, body: m === 'GET' || m === 'HEAD' ? undefined : '{}', signal: AbortSignal.timeout(12000), redirect: 'follow' });
  let pr = null; const h = r.headers.get('payment-required'); if (h) { try { pr = b64(h); } catch {} } if (!pr) { try { pr = await r.json(); } catch {} }
  const a = (pr?.accepts || []).find(ok);
  return { status: r.status, ms: Date.now() - t0, method: m, a, sameTerms: !!a && a.payTo.toLowerCase() === i.a.payTo.toLowerCase() };
}
async function doc(u) {
  const o = new URL(u).origin;
  const get = async (p) => { try { const r = await fetch(o + p, { signal: AbortSignal.timeout(6000), redirect: 'follow' }); return r.ok ? { ct: r.headers.get('content-type') || '', t: (await r.text()).slice(0, 4000) } : null; } catch { return null; } };
  let r = await get('/llms.txt'); if (r && !/html/i.test(r.ct) && !/^\s*</.test(r.t) && r.t.trim().length > 40) return o + '/llms.txt';
  for (const p of ['/openapi.json', '/.well-known/x402']) { r = await get(p); try { const j = JSON.parse(r?.t || 'x'); if (j.openapi || j.swagger || j.resources || j.x402Version || j.endpoints) return o + p; } catch {} }
  return null;
}
const ranked = [...pool.values()].filter((i) => i.description && i.description.length > 12).sort((x, y) => (y.quality?.l30DaysUniquePayers || 0) - (x.quality?.l30DaysUniquePayers || 0));
// Re-check everything listed last time first, then fill with new candidates.
const prev = new Set(old.services.map((s) => s.endpoint)); const order = [...ranked.filter((i) => prev.has(i.resource)), ...ranked.filter((i) => !prev.has(i.resource))].slice(0, PROBE);
const now = new Date().toISOString(), out = [], seenHost = new Map();
for (const i of order) {
  if (out.length >= MAX) break;
  const host = new URL(i.resource).host; if ((seenHost.get(host) || 0) >= 3) continue;
  let p; try { p = await probe(i); } catch (e) { p = { status: 0, error: String(e.message).slice(0, 80) }; }
  const was = old.services.find((s) => s.endpoint === i.resource);
  if (p.status !== 402 || !p.a) { if (was && (was.fails || 0) < 1) out.push({ ...was, fails: (was.fails || 0) + 1, lastCheck: now, lastStatus: p.status }); continue; }
  seenHost.set(host, (seenHost.get(host) || 0) + 1);
  const inp = i.extensions?.bazaar?.info?.input || {}, ex = i.extensions?.bazaar?.info?.output?.example;
  const name = (i.serviceName ? i.serviceName + ': ' : '') + (i.description.split(/[.!?\n](?:\s|$)/)[0].slice(0, 70));
  out.push({ slug: was?.slug || slug(host + new URL(i.resource).pathname), name: name.trim(), seller: i.serviceName || host, host, description: i.description.slice(0, 600), category: cat((i.tags || []).join(' ') + ' ' + i.description.toLowerCase()), tags: (i.tags || []).slice(0, 8),
    endpoint: i.resource, method: p.method, priceUsd: Number(p.a.amount) / 1e6, amount: p.a.amount, payTo: p.a.payTo, asset: 'USDC', network: 'eip155:8453', listedTermsMatch: p.sameTerms,
    input: { queryParams: inp.queryParams || null, body: inp.body || inp.bodyFields || null, bodyType: inp.bodyType || null }, outputExample: ex === undefined ? null : JSON.stringify(ex).slice(0, 1500),
    docs: was?.docs !== undefined && was.docsChecked > Date.now() - 864e5 * 7 ? was.docs : await doc(i.resource), docsChecked: Date.now(), payers30d: i.quality?.l30DaysUniquePayers ?? null, calls30d: i.quality?.l30DaysTotalCalls ?? null,
    firstSeen: was?.firstSeen || now, verifiedAt: now, latencyMs: p.ms, lastStatus: 402, fails: 0, source: 'Coinbase x402 Bazaar listing + live 402 probe' });
}
const dropped = old.services.filter((s) => !out.find((o) => o.endpoint === s.endpoint)).map((s) => s.slug);
fs.writeFileSync('market.json', JSON.stringify({ generatedAt: now, rule: 'Listed only if the endpoint answered HTTP 402 with an exact USDC price on Base (eip155:8453) at verifiedAt. A service that fails two checks in a row is dropped.', dropped, services: out }, null, 1));
console.log('pool', pool.size, 'probed', order.length, 'listed', out.length, 'dropped', dropped.length);
