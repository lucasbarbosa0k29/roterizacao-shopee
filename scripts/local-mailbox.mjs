import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

export async function startMailbox(folder, token, onShutdown = () => {}) {
  const file = join(folder, 'mailbox.json');
  let messages = [];
  let pendingWrite = Promise.resolve();
  try { messages = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Não foi possível ler a caixa de e-mails local.'); }
  const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    if (!['127.0.0.1:8025', 'localhost:8025'].includes(request.headers.host)) { response.writeHead(403).end(); return; }
    if (request.method === 'GET' && request.url === '/health') {
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ service: 'rotta-local-mailbox' })); return;
    }
    if (request.method === 'POST' && ['/capture', '/shutdown'].includes(request.url)) {
      const provided = Buffer.from(String(request.headers['x-rotta-mail-token'] || ''));
      const expected = Buffer.from(token);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) { response.writeHead(401).end(); return; }
      if (request.url === '/shutdown') {
        response.writeHead(200).end('{}');
        setImmediate(onShutdown);
        return;
      }
      try {
        let body = '';
        for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 8192) { response.writeHead(413).end(); return; } }
        const message = JSON.parse(body);
        if (typeof message.to !== 'string' || message.to.length > 254 || typeof message.id !== 'string' || !/^\d{6}$/.test(message.code) || !['VERIFY_EMAIL', 'RESET_PASSWORD'].includes(message.purpose)) { response.writeHead(400).end(); return; }
        pendingWrite = pendingWrite.catch(() => {}).then(async () => {
          if (messages.some(item => item.id === message.id)) return;
          const next = [{ id: message.id, to: message.to, code: message.code, purpose: message.purpose, createdAt: new Date().toISOString() }, ...messages].slice(0, 200);
          await writeFile(file, JSON.stringify(next), { mode: 0o600 });
          messages = next;
        });
        await pendingWrite;
        response.writeHead(200).end('{}');
      } catch { response.writeHead(500).end('{}'); }
      return;
    }
    if (request.method !== 'GET' || request.url !== '/') { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    const rows = messages.map(message => `<article><p>${message.purpose === 'VERIFY_EMAIL' ? 'Confirmação de e-mail' : 'Recuperação de senha'} · ${escape(message.to)}</p><strong>${escape(message.code)}</strong><p>Capturado em ${escape(new Date(message.createdAt).toLocaleString('pt-BR'))}. Validade: 10 minutos desde a emissão no Rotta.</p></article>`).join('');
    response.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Rotta — e-mails locais</title><style>body{font:16px system-ui;max-width:820px;margin:40px auto;padding:0 20px;background:#f3f7f7;color:#17313b}article{background:white;padding:20px;margin:16px 0;border-radius:14px}strong{font-size:32px;letter-spacing:8px}a{color:#175a6b}</style><h1>E-mails locais do Rotta</h1><p>Mensagens simuladas. Nenhum e-mail é enviado pela internet.</p><p><a href="/">Atualizar mensagens</a> · <a href="http://localhost:3000/confirmar-email">Confirmar e-mail no Rotta</a></p>${rows || '<p>Nenhuma mensagem ainda. Cadastre uma conta fictícia ou solicite recuperação de senha.</p>'}</html>`);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8025, '127.0.0.1', resolve); });
  return server;
}
