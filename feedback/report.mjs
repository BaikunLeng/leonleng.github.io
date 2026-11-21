import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
const tokenPath = process.env.LEON_FEEDBACK_TOKEN_FILE || join(homedir(), '.codex/private/leonleng-feedback-admin-token');
const token = process.env.LEON_FEEDBACK_ADMIN_TOKEN || (await readFile(tokenPath, 'utf8')).trim();
const response = await fetch('https://leonleng-portrait-feedback.caramel-terrier.workers.dev/admin/report', { headers: { Authorization: 'Bearer ' + token } });
if (!response.ok) throw new Error('Could not read feedback report: HTTP ' + response.status);
const { rows } = await response.json();
const quoted = value => '"' + String(value).replaceAll('"', '""') + '"';
const csv = ['phrase_id,text,impressions,likes,dislikes', ...rows.map(r => [r.id, r.text, r.impressions, r.likes, r.dislikes].map(quoted).join(','))].join('\n') + '\n';
if (process.argv[2]) { await writeFile(process.argv[2], csv); console.log('Saved feedback report with ' + rows.length + ' phrases.'); }
else process.stdout.write(csv);
