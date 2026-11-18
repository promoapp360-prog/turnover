'use strict';
// Server-Sent Events: aggiorna in tempo reale l'agenda degli altri utenti collegati.
// Nota: funziona per singola istanza. Con più istanze i client si riallineano comunque col polling di sicurezza.
const clients = new Map(); // tenantId -> Set(res)

function subscribe(tenantId, req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 5000\n\n');
  if (!clients.has(tenantId)) clients.set(tenantId, new Set());
  clients.get(tenantId).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.get(tenantId)?.delete(res); });
}

function publish(tenantId, type, data = {}) {
  const set = clients.get(tenantId);
  if (!set) return;
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) { try { res.write(payload); } catch (_) { /* ignore */ } }
}

module.exports = { subscribe, publish };
