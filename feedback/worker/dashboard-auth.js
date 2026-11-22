import dashboardHtml from './dashboard.html';
const cookieName = '__Host-leon_feedback';
const ttl = 7 * 24 * 60 * 60;
const encoder = new TextEncoder();
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' };
const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
const signingKey = secret => crypto.subtle.importKey('raw', encoder.encode('dashboard-session:' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign','verify']);
async function correctKey(candidate, expected) {
 if (!expected || !candidate || candidate.length > 128) return false;
 const [a,b] = await Promise.all([candidate,expected].map(s => crypto.subtle.digest('SHA-256', encoder.encode(s))));
 let diff = 0; const x = new Uint8Array(a), y = new Uint8Array(b);
 for (let i=0;i<x.length;i++) diff |= x[i]^y[i];
 return diff === 0;
}
async function signedSession(secret) {
 const payload = Math.floor(Date.now()/1000 + ttl) + '.' + crypto.randomUUID();
 return payload + '.' + hex(await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(payload)));
}
async function authenticated(request, secret) {
 if (!secret) return false;
 const value = (request.headers.get('Cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
 const match = /^(\d{10})\.([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(value || '');
 if (!match) return false;
 const now = Date.now()/1000;
 if (+match[1] <= now || +match[1] > now + ttl + 60) return false;
 const signature = new Uint8Array(match[3].match(/../g).map(pair => Number.parseInt(pair,16)));
 return crypto.subtle.verify('HMAC', await signingKey(secret), signature, encoder.encode(match[1] + '.' + match[2]));
}
function html(content, status=200, csrf) {
 const nonce = crypto.randomUUID();
 return new Response(content.replaceAll('__NONCE__', nonce), { status, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', ...(csrf ? { 'Set-Cookie': '__Host-leon_feedback_form=' + csrf + '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=' + ttl } : {}), 'Content-Security-Policy': `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` } });
}
function loginPage(error=false, csrf) {
 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private feedback · Leon Leng</title><style> *{box-sizing:border-box}body{margin:0;color:#1f2937;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:420px;margin:16vh auto;padding:24px}small{color:#64748b}h1{font-size:28px;letter-spacing:-.035em;margin:10px 0}p{color:#64748b}label{display:block;margin:28px 0 8px}input{width:100%;font:inherit;padding:12px;border:1px solid #cbd5e1;border-radius:7px}button{margin-top:14px;padding:10px 20px;border:0;border-radius:7px;background:#1f2937;color:white;font:inherit;cursor:pointer}.error{color:#b91c1c}</style><main><small>LEON LENG · PRIVATE</small><h1>Feedback dashboard</h1><p>Sign in to view message impressions and votes.</p><form method="post" action="/dashboard/login"><input type="hidden" name="csrf" value="${csrf}"><label for="key">Access key</label><input id="key" name="key" type="password" autocomplete="current-password" required maxlength="128" autofocus><button type="submit">Sign in</button>${error?'<p class="error" role="alert">The access key was not accepted.</p>':''}</form><p><small>Your sign-in lasts seven days on this browser.</small></p></main></html>`;
}
const redirect = cookie => new Response(null, { status: 303, headers: { ...headers, Location: '/dashboard', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
export async function dashboard(request, env) {
 const url = new URL(request.url), path = url.pathname;
 if (!(path === '/dashboard' || path.startsWith('/dashboard/'))) return null;
 const signedIn = await authenticated(request, env.ADMIN_TOKEN);
 if (request.method === 'POST') {
  const origin = request.headers.get('Origin');
  if (origin && origin !== 'null' && origin !== url.origin) return new Response('Forbidden', { status:403, headers });
  if (+request.headers.get('Content-Length') > 512) return new Response('Too large', { status:413, headers });
  const body = await request.text();
  if (body.length > 512) return new Response('Too large', { status:413, headers });
  const form = new URLSearchParams(body);
  const csrfCookie = (request.headers.get('Cookie') || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-leon_feedback_form='))?.slice('__Host-leon_feedback_form='.length);
  if (!await correctKey(form.get('csrf') || '', csrfCookie)) return new Response('Forbidden', { status:403, headers });
  if (path === '/dashboard/logout') return redirect(cookieName + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  if (path !== '/dashboard/login') return new Response('Not found', { status:404, headers });
  const key = form.get('key') || '';
  if (!await correctKey(key, env.ADMIN_TOKEN)) { const csrf = crypto.randomUUID(); return html(loginPage(true,csrf),403,csrf); }
  return redirect(cookieName + '=' + await signedSession(env.ADMIN_TOKEN) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + ttl);
 }
 if (request.method !== 'GET') return new Response('Method not allowed', { status:405, headers });
 if (path === '/dashboard' || path === '/dashboard/') { const csrf = crypto.randomUUID(); return html(signedIn ? dashboardHtml.replaceAll('__CSRF__',csrf) : loginPage(false,csrf),200,csrf); }
 if (!signedIn) return Response.json({ error:'Sign in required' }, { status:401, headers });
 if (!['/dashboard/data','/dashboard/export'].includes(path)) return new Response('Not found', { status:404, headers });
 const result = await env.FEEDBACK.get(env.FEEDBACK.idFromName('live')).fetch(new Request('https://internal/report'));
 const data = await result.json();
 if (path === '/dashboard/data') return Response.json(data, { headers });
 const quote = value => '"' + String(value).replaceAll('"','""') + '"';
 const csv = '\uFEFF' + ['phrase_id,text,impressions,likes,dislikes',...data.rows.map(r => [r.id,r.text,r.impressions,r.likes,r.dislikes].map(quote).join(','))].join('\n');
 return new Response(csv, { headers: { ...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="portrait-feedback.csv"' } });
}
