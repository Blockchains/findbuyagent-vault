// Aggregates ratings from public GitHub issues titled "Rating: <slug>" whose body has {"slug","stars"}.
// One vote per GitHub account per service (the latest counts). No seed data. Writes ratings.json.
import fs from 'node:fs';
const repo = process.env.GITHUB_REPOSITORY || 'Blockchains/findbuyagent-vault', tok = process.env.GITHUB_TOKEN;
const slugs = new Set(JSON.parse(fs.readFileSync('market.json', 'utf8')).services.map((s) => s.slug));
const votes = new Map();
for (let page = 1; page < 30; page++) {
  const r = await fetch(`https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=${page}&sort=created&direction=asc`, { headers: { accept: 'application/vnd.github+json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) } });
  if (!r.ok) throw new Error('issues ' + r.status); const a = await r.json(); if (!a.length) break;
  for (const i of a) {
    if (i.pull_request || !/^rating:/i.test(i.title)) continue;
    const m = (i.body || '').match(/\{[\s\S]*?\}/); let j; try { j = JSON.parse(m?.[0]); } catch { continue; }
    const stars = Math.round(Number(j.stars)); if (!slugs.has(j.slug) || !(stars >= 1 && stars <= 5)) continue;
    votes.set(j.slug + '|' + i.user.login.toLowerCase(), { slug: j.slug, stars, by: i.user.login, agent: i.user.type === 'Bot' || /agent/i.test(j.via || ''), at: i.created_at, issue: i.number });
  }
}
const out = {};
for (const v of votes.values()) { const o = (out[v.slug] ||= { count: 0, sum: 0, dist: [0, 0, 0, 0, 0], last: null }); o.count++; o.sum += v.stars; o.dist[v.stars - 1]++; o.last = v.at > (o.last || '') ? v.at : o.last; }
for (const o of Object.values(out)) { o.avg = Math.round((o.sum / o.count) * 100) / 100; delete o.sum; }
fs.writeFileSync('ratings.json', JSON.stringify({ generatedAt: new Date().toISOString(), method: 'One vote per GitHub account per service, from issues titled "Rating: <slug>" in ' + repo + '. Unrated services are absent.', ratings: out }, null, 1));
console.log('votes', votes.size, 'services rated', Object.keys(out).length);
