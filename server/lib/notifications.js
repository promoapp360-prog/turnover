'use strict';
/*
 * Notifiche email / WhatsApp.
 * Nessuna notifica viene simulata: se il provider non è configurato, il messaggio viene registrato
 * nel log con stato "non_configurato" e il gestionale lo mostra chiaramente.
 */
const db = require('./db');
const log = require('./log');
const U = require('./util');

const DEFAULT_TEMPLATES = [
  { key: 'booking_confirmed', label: 'Conferma prenotazione', marketing: false,
    subject: 'Prenotazione confermata – {{salone}}',
    body: 'Ciao {{nome}}, la tua prenotazione da {{salone}} è confermata per {{data}} alle {{ora}} ({{servizi}}). Per modificare o annullare: {{link}}' },
  { key: 'booking_pending', label: 'Prenotazione ricevuta (da confermare)', marketing: false,
    subject: 'Richiesta ricevuta – {{salone}}',
    body: 'Ciao {{nome}}, abbiamo ricevuto la tua richiesta per {{data}} alle {{ora}} ({{servizi}}). Ti confermeremo al più presto. Dettagli: {{link}}' },
  { key: 'reminder', label: 'Promemoria appuntamento', marketing: false,
    subject: 'Promemoria: ti aspettiamo {{data}} alle {{ora}}',
    body: 'Ciao {{nome}}, ti ricordiamo l’appuntamento da {{salone}} {{data}} alle {{ora}}. Se non puoi venire, avvisaci qui: {{link}}' },
  { key: 'rescheduled', label: 'Appuntamento modificato', marketing: false,
    subject: 'Appuntamento modificato – {{salone}}',
    body: 'Ciao {{nome}}, il tuo appuntamento è stato spostato a {{data}} alle {{ora}}. Dettagli: {{link}}' },
  { key: 'cancelled', label: 'Appuntamento annullato', marketing: false,
    subject: 'Appuntamento annullato – {{salone}}',
    body: 'Ciao {{nome}}, l’appuntamento di {{data}} alle {{ora}} è stato annullato. Puoi prenotare di nuovo qui: {{sito}}' },
  { key: 'review_request', label: 'Richiesta recensione', marketing: true,
    subject: 'Com’è andata da {{salone}}?',
    body: 'Ciao {{nome}}, grazie per essere passata/o da {{salone}}! Ci lasceresti una recensione? {{recensione}}' },
  { key: 'birthday', label: 'Auguri di compleanno', marketing: true,
    subject: 'Buon compleanno da {{salone}}!',
    body: 'Tanti auguri {{nome}}! Per festeggiare ti aspettiamo da {{salone}} con un pensiero speciale. Prenota: {{sito}}' },
  { key: 'waitlist_slot', label: 'Lista d’attesa: si è liberato un posto', marketing: false,
    subject: 'Si è liberato un posto da {{salone}}',
    body: 'Ciao {{nome}}, si è liberato un posto il {{data}} alle {{ora}}. Prenota subito: {{sito}}/prenota' },
  { key: 'promo', label: 'Comunicazione promozionale', marketing: true,
    subject: '{{titolo}} – {{salone}}',
    body: 'Ciao {{nome}}, {{messaggio}} {{sito}}' },
];
const TEMPLATE_META = Object.fromEntries(DEFAULT_TEMPLATES.map(t => [t.key, t]));

function providers() {
  const email = process.env.RESEND_API_KEY ? 'resend' : process.env.BREVO_API_KEY ? 'brevo' : null;
  const whatsapp = process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID ? 'whatsapp_cloud' : null;
  return { email, whatsapp, email_from: process.env.EMAIL_FROM || null };
}

async function ensureTemplates(tenantId, q = db) {
  for (const t of DEFAULT_TEMPLATES) {
    for (const channel of ['email', 'whatsapp']) {
      await q.query(`INSERT INTO notification_templates(tenant_id, key, channel, subject, body)
                     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, key, channel) DO NOTHING`,
        [tenantId, t.key, channel, channel === 'email' ? t.subject : null, t.body]);
    }
  }
}

async function sendEmail(to, subject, text, tenant) {
  const p = providers();
  const from = p.email_from || `${tenant.settings.brand.name} <noreply@example.com>`;
  const htmlBody = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222">${U.escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>')}</div>`;
  let r;
  if (p.email === 'resend') {
    r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, html: htmlBody, reply_to: tenant.settings.contact.email || undefined }),
    });
  } else if (p.email === 'brevo') {
    const m = /^(.*)<(.+)>$/.exec(from);
    r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: m ? { name: m[1].trim(), email: m[2] } : { email: from }, to: [{ email: to }], subject, textContent: text, htmlContent: htmlBody }),
    });
  } else return { status: 'non_configurato' };
  if (!r.ok) return { status: 'errore', error: `HTTP ${r.status}: ${(await r.text()).slice(0, 300)}` };
  return { status: 'inviato' };
}

async function sendWhatsApp(to, text, tpl, vars) {
  if (!providers().whatsapp) return { status: 'non_configurato' };
  const num = U.normPhone(to).replace('+', '');
  let payload;
  if (tpl.wa_template) {
    // Template approvato su Meta: parametri nell'ordine {{1}} nome, {{2}} data, {{3}} ora, {{4}} servizi, {{5}} link
    payload = { messaging_product: 'whatsapp', to: num, type: 'template', template: {
      name: tpl.wa_template, language: { code: process.env.WHATSAPP_LANG || 'it' },
      components: [{ type: 'body', parameters: ['nome', 'data', 'ora', 'servizi', 'link'].map(k => ({ type: 'text', text: String(vars[k] || '-') })) }] } };
  } else {
    // Messaggio libero: consentito da Meta solo entro 24h dall'ultimo messaggio del cliente
    payload = { messaging_product: 'whatsapp', to: num, type: 'text', text: { body: text } };
  }
  const r = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!r.ok) return { status: 'errore', error: `HTTP ${r.status}: ${(await r.text()).slice(0, 300)}` };
  return { status: 'inviato' };
}

function baseUrl(tenant) {
  return (process.env.PUBLIC_BASE_URL || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : '')).replace(/\/$/, '');
}

async function appointmentVars(tenant, appt) {
  const svc = await db.many('SELECT name FROM appointment_services WHERE appointment_id=$1 ORDER BY sort', [appt.id]);
  const staff = await db.one('SELECT name FROM staff WHERE id=$1', [appt.staff_id]);
  const base = baseUrl(tenant);
  return {
    data: U.fmtDateIt(new Date(appt.starts_at)), ora: U.fmtTimeIt(new Date(appt.starts_at)),
    servizi: svc.map(s => s.name).join(', '), operatore: staff ? staff.name : '',
    link: `${base}/prenotazione/${appt.manage_token}`, totale: U.euro(appt.total_cents),
  };
}

/**
 * Invia una notifica su tutti i canali attivi.
 * @param {object} tenant
 * @param {string} key  chiave template
 * @param {object} ctx  { customer, appointment, vars }
 */
async function notify(tenant, key, { customer, appointment, vars = {}, channels } = {}) {
  const ns = tenant.settings.notifications;
  const meta = TEMPLATE_META[key] || {};
  if (!customer) return [];
  const all = { email: ns.email_enabled, whatsapp: ns.whatsapp_enabled };
  const chs = (channels || ['email', 'whatsapp']).filter(ch => all[ch]);
  const results = [];
  const base = baseUrl(tenant);
  const v = {
    nome: customer.first_name, cognome: customer.last_name || '', salone: tenant.settings.brand.name,
    sito: base, recensione: ns.review_url || base, telefono: tenant.settings.contact.phone,
    ...(appointment ? await appointmentVars(tenant, appointment) : {}), ...vars,
  };
  for (const ch of chs) {
    const tpl = await db.one('SELECT * FROM notification_templates WHERE tenant_id=$1 AND key=$2 AND channel=$3', [tenant.id, key, ch]);
    if (!tpl || !tpl.active) continue;
    const to = ch === 'email' ? customer.email : customer.phone;
    const text = U.renderTemplate(tpl.body, v);
    const subject = tpl.subject ? U.renderTemplate(tpl.subject, v) : null;
    let res;
    if (customer.anonymized) res = { status: 'senza_recapito' };
    else if (!to) res = { status: 'senza_recapito' };
    else if (meta.marketing && !customer.consent_marketing) res = { status: 'senza_consenso' };
    else {
      try { res = ch === 'email' ? await sendEmail(to, subject, text, tenant) : await sendWhatsApp(to, text, tpl, v); }
      catch (e) { res = { status: 'errore', error: e.message }; }
    }
    await db.query(`INSERT INTO notification_log(tenant_id, customer_id, appointment_id, template_key, channel, to_addr, subject, body, status, error)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tenant.id, customer.id, appointment ? appointment.id : null, key, ch, to || null, subject, text, res.status, res.error || null]);
    if (res.status === 'errore') log.warn(`Notifica ${key}/${ch} fallita`, res.error);
    results.push({ channel: ch, ...res });
  }
  return results;
}

async function notifyOwner(tenant, subject, text) {
  const to = tenant.settings.notifications.owner_email;
  if (!to || !providers().email) return;
  try { await sendEmail(to, subject, text, tenant); } catch (e) { log.warn('Email titolare non inviata', e.message); }
}

// Link WhatsApp manuale (wa.me): funziona sempre, senza API, aprendo WhatsApp sul dispositivo del salone
function waLink(phone, text) {
  const n = U.normPhone(phone);
  return n ? `https://wa.me/${n.replace('+', '')}?text=${encodeURIComponent(text)}` : null;
}

module.exports = { DEFAULT_TEMPLATES, TEMPLATE_META, providers, ensureTemplates, notify, notifyOwner, waLink, appointmentVars, baseUrl };
