import { createServer } from 'node:http';
import passwordHandler from './api/password.mjs';
import musicHandler from './api/music.mjs';

createServer(async (req, res) => {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => res.end(JSON.stringify(data));
  res.setHeader('Content-Type', 'application/json');
  let body = '';
  for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > (req.url==='/api/music'?600000:2048)) { res.statusCode = 413; res.end(); return; } }
  try { req.body = JSON.parse(body || '{}'); } catch { req.body = null; }
  if(req.url!=='/api/music'&&req.url!=='/api/password'){res.status(404).json({error:'not_found'});return;}
  await (req.url==='/api/music'?musicHandler:passwordHandler)(req,res);
}).listen(Number(process.env.PORT || 5174), '127.0.0.1');
