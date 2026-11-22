import { DurableObject } from 'cloudflare:workers';
import catalog from './catalog.json';
import { dashboard } from './dashboard-auth.js';
const json = (value, status = 200) => Response.json(value, { status });
export class PortraitFeedback extends DurableObject {
 constructor(ctx, env) {
  super(ctx, env);
  this.sql = ctx.storage.sql;
  this.sql.exec('CREATE TABLE IF NOT EXISTS impressions (visitor TEXT NOT NULL, phrase TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(visitor, phrase))');
  this.sql.exec("CREATE TABLE IF NOT EXISTS votes (visitor TEXT NOT NULL, phrase TEXT NOT NULL, vote TEXT NOT NULL CHECK(vote IN ('like','dislike')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(visitor, phrase))");
 }
 async fetch(request) {
  if (request.method === 'GET') {
   const views = new Map(this.sql.exec('SELECT phrase, COUNT(*) AS n FROM impressions GROUP BY phrase').toArray().map(r => [r.phrase, r.n]));
   const votes = this.sql.exec("SELECT phrase, SUM(vote='like') AS likes, SUM(vote='dislike') AS dislikes FROM votes GROUP BY phrase").toArray();
   const byPhrase = new Map(votes.map(r => [r.phrase, r]));
   return json({ rows: Object.entries(catalog).map(([id, text]) => ({ id, text, impressions: views.get(id) || 0, likes: byPhrase.get(id)?.likes || 0, dislikes: byPhrase.get(id)?.dislikes || 0 })) });
  }
  const body = await request.json();
  if (!catalog[body.phrase_id] || !/^[a-f0-9]{64}$/.test(body.visitor || '') || !['impression','vote'].includes(body.kind)) return json({ error: 'Invalid event' }, 400);
  const { visitor, phrase_id: phrase } = body;
  if (body.kind === 'impression') {
   this.sql.exec('INSERT OR IGNORE INTO impressions(visitor, phrase) VALUES(?, ?)', visitor, phrase);
   return json({ recorded: true });
  }
  if (!['like','dislike'].includes(body.vote)) return json({ error: 'Invalid vote' }, 400);
  if (!this.sql.exec('SELECT 1 FROM impressions WHERE visitor=? AND phrase=?', visitor, phrase).toArray().length) return json({ error: 'Show the message before voting' }, 409);
  this.sql.exec('INSERT OR IGNORE INTO votes(visitor, phrase, vote) VALUES(?, ?, ?)', visitor, phrase, body.vote);
  const saved = this.sql.exec('SELECT vote FROM votes WHERE visitor=? AND phrase=?', visitor, phrase).toArray()[0];
  return json({ recorded: true, vote: saved.vote });
 }
}
export default {
 async fetch(request, env) {
  const dashboardResponse = await dashboard(request, env);
  if (dashboardResponse) return dashboardResponse;
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowed = ['https://leonleng.com','https://www.leonleng.com'];
  if (env.ALLOW_LOCAL === '1') allowed.push('http://127.0.0.1:8782','http://localhost:8782');
  const cors = { 'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'https://leonleng.com', 'Vary': 'Origin', 'Cache-Control': 'no-store' };
  if (url.pathname === '/health') return json({ ok: true, phrases: Object.keys(catalog).length });
  const admin = url.pathname.startsWith('/admin/');
  if (admin && (!env.ADMIN_TOKEN || request.headers.get('Authorization') !== 'Bearer ' + env.ADMIN_TOKEN)) return json({ error: 'Unauthorized' }, 401);
  if (!admin && !allowed.includes(origin)) return json({ error: 'Origin not allowed' }, 403);
  if (request.method === 'OPTIONS' && url.pathname === '/events') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
  const isReport = url.pathname === '/admin/report';
  const isTest = url.pathname === '/admin/test/events' || url.pathname === '/admin/test/report';
  if (!(url.pathname === '/events' || isReport || isTest)) return json({ error: 'Not found' }, 404);
  if (request.method !== (isReport || url.pathname.endsWith('/report') ? 'GET' : 'POST')) return json({ error: 'Method not allowed' }, 405);
  let internal;
  if (request.method === 'POST') {
   if (Number(request.headers.get('Content-Length')) > 1024) return json({ error: 'Event too large' }, 413);
   const text = await request.text();
   if (text.length > 1024) return json({ error: 'Event too large' }, 413);
   let body; try { body = JSON.parse(text); } catch { return json({ error: 'Invalid JSON' }, 400); }
   if (!/^[a-f0-9-]{36}$/.test(body.visitor_id || '')) return json({ error: 'Invalid visitor' }, 400);
   const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.visitor_id));
   body.visitor = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
   delete body.visitor_id;
   internal = new Request('https://internal/events', { method: 'POST', body: JSON.stringify(body) });
  } else internal = new Request('https://internal/report');
  const store = env.FEEDBACK.get(env.FEEDBACK.idFromName(isTest ? 'test' : 'live'));
  const result = await store.fetch(internal);
  return new Response(result.body, { status: result.status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
 }
};
