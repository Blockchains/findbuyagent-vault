// Finds x402 services in the Coinbase x402 Bazaar (full listing) and keeps only ones that answer live
// with a valid Base USDC 402 payment requirement right now and carry real metadata (description, provider,
// price, documented inputs/outputs). Nothing here pays: probes are unpaid requests that read the 402.
// Re-checks every listed service each run; a service that fails two checks in a row is dropped.
// Writes market.json (listed services, with per-service check history) and rejects.json (why candidates were not listed).
import fs from 'node:fs';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', API = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery';
const MAX = Number(process.env.MAX || 480), PROBE = Number(process.env.PROBE || 1400), HOSTCAP = Number(process.env.HOSTCAP || 4), CONC = Number(process.env.CONC || 24), HIST = 60;
const old = fs.existsSync('market.json') ? JSON.parse(fs.readFileSync('market.json', 'utf8')) : { services: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = async (u) => { for (let t = 0; ; t++) { try { const r = await fetch(u, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(u + ' ' + r.status); return await r.json(); } catch (e) { if (t >= 6) throw e; await sleep(2000 * 2 ** Math.min(t, 4)); } } };
const ok = (a) => a && a.scheme === 'exact' && a.network === 'eip155:8453' && String(a.asset).toLowerCase() === USDC && /^\d+$/.test(String(a.amount)) && Number(a.amount) > 0 && Number(a.amount) <= 1e7 && /^0x[0-9a-fA-F]{40}$/.test(a.payTo || '') && !/^0x0{40}$/i.test(a.payTo);
const CATS = [['Weather & geo', /\b(weather|forecast|geocod|geolocat|ip lookup|timezone|maps?)\b/], ['Finance & markets', /\b(fx|forex|stocks?|equit|polymarket|prediction market|trading|options|sec filing|earnings|macro|interest rate|cloud pricing|gpu pric|bid\/ask)/], ['Crypto & on-chain', /\b(token|wallet|defi|crypto|onchain|on-chain|blockchain|nft|swap|dex|solana|ethereum|erc-?20|block height|block number|gas price|airdrop|memecoin)/],
  ['Search & web', /\b(search|scrap|crawl|web|urls?|serp|news|headlines|tweets?|twitter|reddit|social)/], ['Images & media', /\b(image|photo|video|audio|tts|speech|music|render|screenshot|pdf|ocr)/], ['Security & compliance', /\b(security|vulnerab|phishing|malware|sanction|compliance|kyc|aml|risk score|audit)/], ['Data & analytics', /\b(data|analytics|leads?|company|enrich|stats|dataset|research|report|email|domain|dns)/], ['AI & LLM', /\b(ai|llm|gpt|chat|completion|model|inference|summar|prompt|agent|translat|embedding)/], ['Utilities', /./]];
const cat = (s) => CATS.find(([, r]) => r.test(s))[0];
const slug = (s) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70).replace(/-$/, '');
const JUNK = /\b(test(ing|net)?|demo|echo|hello[- ]?world|ping|placeholder|lorem|sample endpoint|example endpoint|dummy|todo|tbd|foo|bar baz|sandbox|staging|debug|health ?check|integration check|no external data|connectivity check)\b/i;
const BADHOST = /(^localhost|^\d+\.\d+\.\d+\.\d+|ngrok|trycloudflare|loca\.lt|\.local$|staging|sandbox|testnet|sepolia|\bdev-|\.test$)/i;
const INJECT = /(ignore (all |any )?(previous|prior|above) instructions|note to (ai )?agents|you (must|should) (first )?(pay|buy|send|transfer)|send (all|your) (funds|usdc|tokens)|disregard (all |any )?(previous|prior)|reveal your (private key|seed))/i;
const GENERIC = /^(paid|x402|payment required|premium|api|endpoint|resource)\b[^.]{0,40}(usdc|x402|payment|access)\b/i;
const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
const rejects = { counts: {}, injection: [] }; const rej = (why) => { rejects.counts[why] = (rejects.counts[why] || 0) + 1; };
// 1. Full Bazaar listing.
const pool = new Map(), dupKey = new Set(); let total = 0;
const first = await J(`${API}/resources?limit=100&offset=0`); const N = first.pagination?.total || 0;
const offs = []; for (let o = 0; o < N; o += 100) offs.push(o);
const raw = []; let k = 0;
await Promise.all(Array.from({ length: 4 }, async () => { while (k < offs.length) { const o = offs[k++]; try { raw.push(...((await J(`${API}/resources?limit=100&offset=${o}`)).items || [])); } catch (e) { console.log('page', o, e.message); } } }));
for (const i of raw) {
  total++;
  const a = (i.accepts || []).find(ok); if (!a) { rej('no valid Base USDC exact price in listing (other network/asset, testnet or zero)'); continue; }
  let u; try { u = new URL(i.resource); } catch { rej('invalid resource URL'); continue; }
  if (u.protocol !== 'https:' || BADHOST.test(u.hostname)) { rej('non-https, local, tunnel, staging or testnet host'); continue; }
  const d = (i.description || '').trim(), info = i.extensions?.bazaar?.info || {}, inp = info.input || {}, ex = info.output?.example;
  if (INJECT.test(d + ' ' + JSON.stringify(info).slice(0, 4000))) { rej('metadata contains instructions aimed at agents (ignored, not listed)'); rejects.injection.push(i.resource); continue; }
  if (d.length < 30 || d.split(/\s+/).length < 5) { rej('missing or too-short description'); continue; }
  if (GENERIC.test(d)) { rej('generic payment-only description'); continue; }
  if (JUNK.test(d) || JUNK.test(u.pathname) || JUNK.test(i.serviceName || '')) { rej('test, demo, echo or placeholder endpoint'); continue; }
  if (empty(ex) && empty(inp.queryParams) && empty(inp.body) && empty(inp.bodyFields)) { rej('no documented inputs, outputs or example'); continue; }
  const key = u.host + u.pathname.replace(/\/$/, ''), key2 = a.payTo.toLowerCase() + '|' + d.toLowerCase();
  if (pool.has(key) || dupKey.has(key2)) { rej('duplicate listing'); continue; }
  dupKey.add(key2); pool.set(key, { ...i, a });
}
// 2. Rank: everything listed last time first, then by real 30-day unique payers, with a per-host cap for diversity.
const prev = new Map(old.services.map((s) => [s.endpoint, s]));
for (const s of old.services) if (![...pool.values()].some((i) => i.resource === s.endpoint)) pool.set('old:' + s.endpoint, { resource: s.endpoint, old: s });
const ranked = [...pool.values()].sort((x, y) => (prev.has(y.resource) - prev.has(x.resource)) || ((y.quality?.l30DaysUniquePayers || 0) - (x.quality?.l30DaysUniquePayers || 0)) || ((y.quality?.l30DaysTotalCalls || 0) - (x.quality?.l30DaysTotalCalls || 0)));
const perHost = new Map(), order = [];
for (const i of ranked) { const h = new URL(i.resource).host; if (!prev.has(i.resource) && (perHost.get(h) || 0) >= HOSTCAP) { rej('over per-provider cap (' + HOSTCAP + ' per host)'); continue; } perHost.set(h, (perHost.get(h) || 0) + 1); order.push(i); }
for (const i of order.slice(PROBE)) if (!prev.has(i.resource)) rej('lower-ranked, not probed this run');
const toProbe = order.filter((i, n) => n < PROBE || prev.has(i.resource));
const b64 = (s) => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
async function probe(i) {
  const inp = i.extensions?.bazaar?.info?.input || {}, m = (i.old?.method || inp.method || (inp.bodyType || inp.body ? 'POST' : 'GET')).toUpperCase();
  const t0 = Date.now();
  const r = await fetch(i.resource, { method: m, headers: m === 'GET' || m === 'HEAD' ? {} : { 'content-type': 'application/json' }, body: m === 'GET' || m === 'HEAD' ? undefined : '{}', signal: AbortSignal.timeout(12000), redirect: 'follow' });
  let pr = null; const h = r.headers.get('payment-required'); if (h) { try { pr = b64(h); } catch {} } if (!pr) { try { pr = JSON.parse((await r.text()).slice(0, 200000)); } catch {} }
  const a = (pr?.accepts || []).find(ok);
  return { status: r.status, ms: Date.now() - t0, method: m, a, pr };
}
async function doc(u) {
  const o = new URL(u).origin;
  const get = async (p) => { try { const r = await fetch(o + p, { signal: AbortSignal.timeout(6000), redirect: 'follow' }); return r.ok ? { ct: r.headers.get('content-type') || '', t: (await r.text()).slice(0, 4000) } : null; } catch { return null; } };
  let r = await get('/llms.txt'); if (r && !/html/i.test(r.ct) && !/^\s*</.test(r.t) && r.t.trim().length > 40) return o + '/llms.txt';
  for (const p of ['/openapi.json', '/.well-known/x402']) { r = await get(p); try { const j = JSON.parse(r?.t || 'x'); if (j.openapi || j.swagger || j.resources || j.x402Version || j.endpoints) return o + p; } catch {} }
  return null;
}
const now = new Date().toISOString(), res = new Map(); let pk = 0;
await Promise.all(Array.from({ length: CONC }, async () => { while (pk < toProbe.length) { const i = toProbe[pk++]; let p; try { p = await probe(i); } catch (e) { p = { status: 0, error: String(e.message).slice(0, 80) }; } res.set(i.resource, p); } }));
const out = [], hist = (was, okk, ms, st) => [...(was?.history || []), { t: now, ok: okk, ms: ms ?? null, s: st }].slice(-HIST);
const docQ = [];
for (const i of toProbe) {
  if (out.length >= MAX && !prev.has(i.resource)) { rej('over listing cap'); continue; }
  const p = res.get(i.resource), was = prev.get(i.resource);
  if (p.status !== 402 || !p.a) {
    rej(p.status === 402 ? 'live 402 lacked a valid Base USDC price/payee' : p.status === 0 ? 'endpoint dead or timed out' : 'endpoint did not answer 402 (HTTP ' + p.status + ')');
    if (was && (was.fails || 0) < 1) out.push({ ...was, fails: (was.fails || 0) + 1, lastCheck: now, lastStatus: p.status, history: hist(was, false, p.ms, p.status) });
    continue;
  }
  if (i.old) { out.push({ ...was, method: p.method, priceUsd: Number(p.a.amount) / 1e6, amount: p.a.amount, payTo: p.a.payTo, verifiedAt: now, lastCheck: now, latencyMs: p.ms, lastStatus: 402, fails: 0, history: hist(was, true, p.ms, 402) }); continue; }
  const host = new URL(i.resource).host, info = i.extensions?.bazaar?.info || {}, live = p.pr?.extensions?.bazaar?.info || {};
  const inp = { ...(live.input || {}), ...(info.input || {}) }, ex = info.output?.example ?? live.output?.example;
  const name = (i.serviceName ? i.serviceName + ': ' : '') + (i.description.split(/(?<![A-Z])[.!?\n](?:\s|$)/)[0].slice(0, 70));
  const s = { slug: was?.slug || slug(host + new URL(i.resource).pathname), name: name.trim(), seller: i.serviceName || host, host, provider: new URL(i.resource).origin, description: i.description.trim().slice(0, 800), category: cat(((i.tags || []).join(' ') + ' ' + i.description).toLowerCase()), tags: (i.tags || []).slice(0, 8),
    endpoint: i.resource, method: p.method, payment: 'x402', priceUsd: Number(p.a.amount) / 1e6, amount: p.a.amount, payTo: p.a.payTo, asset: 'USDC', network: 'eip155:8453', maxTimeoutSeconds: p.a.maxTimeoutSeconds ?? null, listedTermsMatch: p.a.payTo.toLowerCase() === i.a.payTo.toLowerCase() && String(p.a.amount) === String(i.a.amount),
    input: { queryParams: empty(inp.queryParams) ? null : inp.queryParams, body: empty(inp.body) ? (empty(inp.bodyFields) ? null : inp.bodyFields) : inp.body, bodyType: inp.bodyType || null, headers: empty(inp.headers) ? null : inp.headers },
    outputType: info.output?.type || null, outputExample: ex === undefined || empty(ex) ? null : JSON.stringify(ex).slice(0, 2500), outputSchema: empty(info.output?.schema) ? null : JSON.stringify(info.output.schema).slice(0, 2500),
    iconUrl: i.iconUrl || null, docs: was?.docs, docsChecked: was?.docsChecked, payers30d: i.quality?.l30DaysUniquePayers ?? null, calls30d: i.quality?.l30DaysTotalCalls ?? null, lastCalledAt: i.quality?.lastCalledAt ?? null,
    firstSeen: was?.firstSeen || now, verifiedAt: now, lastCheck: now, latencyMs: p.ms, lastStatus: 402, fails: 0, history: hist(was, true, p.ms, 402), source: 'Coinbase x402 Bazaar listing + live 402 probe' };
  if (!was || !(was.docsChecked > Date.now() - 864e5 * 7)) docQ.push(s);
  out.push(s);
}
let dk = 0; await Promise.all(Array.from({ length: 12 }, async () => { while (dk < docQ.length) { const s = docQ[dk++]; s.docs = await doc(s.endpoint); s.docsChecked = Date.now(); } }));
for (const s of out) { const h = s.history || []; s.uptime = h.length ? { checks: h.length, ok: h.filter((x) => x.ok).length, pct: Math.round(1000 * h.filter((x) => x.ok).length / h.length) / 10, since: h[0].t } : null; }
const dropped = old.services.filter((s) => !out.find((o) => o.endpoint === s.endpoint)).map((s) => s.slug);
fs.writeFileSync('market.json', JSON.stringify({ generatedAt: now, rule: 'Listed only if the endpoint answered HTTP 402 with an exact USDC price on Base (eip155:8453) and a payee at verifiedAt, and its listing has a real description, a provider, and documented inputs/outputs or an example. Test, demo, echo, duplicate and testnet listings are excluded. A service that fails two checks in a row is dropped.', dropped, services: out }, null, 1));
fs.writeFileSync('rejects.json', JSON.stringify({ generatedAt: now, bazaarTotal: N, read: total, candidates: pool.size, probed: toProbe.length, listed: out.length, reasons: Object.fromEntries(Object.entries(rejects.counts).sort((a, b) => b[1] - a[1])), injectionAttempts: rejects.injection.slice(0, 200) }, null, 1));
if (total < N * 0.97) { console.log('Bazaar read incomplete (' + total + '/' + N + '); keeping previous list'); }
console.log('bazaar', N, 'read', total, 'candidates', pool.size, 'probed', toProbe.length, 'listed', out.length, 'dropped', dropped.length);
