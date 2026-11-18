# Integrazioni esterne

Il gestionale funziona completamente senza servizi esterni. Le integrazioni seguenti richiedono account, chiavi API, approvazioni o costi del fornitore. **Finché non sono configurate, il gestionale lo mostra chiaramente** e non simula invii o pagamenti.

## Email (conferme, promemoria, campagne)
Provider supportati (uno a scelta):

| Provider | Secret su Replit | Note |
|---|---|---|
| Resend (resend.com) | `RESEND_API_KEY`, `EMAIL_FROM` | Piano gratuito ~3.000 email/mese. Verificare il dominio mittente. |
| Brevo (brevo.com) | `BREVO_API_KEY`, `EMAIL_FROM` | Azienda europea, piano gratuito ~300 email/giorno. |

`EMAIL_FROM` esempio: `Turn Over by Zaira <prenotazioni@turnoverbyzaira.it>` (dominio verificato presso il provider).
Poi attivare **Messaggi → Canali → Invia email** e provare con **Messaggio di prova**.

## WhatsApp Business Platform (Meta Cloud API)
Requisiti:
1. Account Meta Business verificato e app su developers.facebook.com con prodotto WhatsApp.
2. Numero di telefono dedicato (non può essere usato contemporaneamente sull'app WhatsApp Business del telefono).
3. **Template approvati** da Meta per i messaggi inviati per primi dal salone (conferma, promemoria…). Parametri attesi nel template: `{{1}}` nome, `{{2}}` data, `{{3}}` ora, `{{4}}` servizi, `{{5}}` link. Indicare il nome del template in **Messaggi → Testi**.
4. Secrets: `WHATSAPP_TOKEN` (token permanente di sistema), `WHATSAPP_PHONE_NUMBER_ID`, opzionale `WHATSAPP_LANG` (default `it`).

Costi: Meta addebita le conversazioni secondo il proprio listino. Senza template, Meta consente solo risposte entro 24 ore dall'ultimo messaggio del cliente.

**Alternativa senza costi**: il pulsante WhatsApp in agenda, in lista d'attesa e nella scheda cliente apre WhatsApp sul telefono del salone con il messaggio già scritto (link `wa.me`).

## Acconto / pagamento anticipato online
Non attivo. Integrazione consigliata: **Stripe Checkout** (o SumUp / Satispay Business) con:
- account del salone e chiavi `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`;
- creazione della sessione di pagamento alla prenotazione e conferma tramite webhook;
- registrazione automatica dell'acconto come pagamento `acconto` nel conto.

La struttura dati è già predisposta (metodo di pagamento `acconto`, impostazioni `deposit_enabled`/`deposit_percent`).

## Documenti fiscali (scontrino elettronico)
Il modulo cassa **non emette documenti commerciali validi**. Per l'invio dei corrispettivi all'Agenzia delle Entrate serve un **registratore telematico** omologato o un **servizio certificato** (es. soluzioni “RT in cloud” / API di fornitori abilitati). L'integrazione andrà collegata alla chiusura del conto (`POST /api/admin/sales/:id/close`).

## Recensioni Google
Il link per la richiesta di recensione si imposta in **Messaggi → Canali** (link “Scrivi una recensione” dal profilo Google Business). L'importazione automatica delle recensioni Google richiede l'API Google Business Profile (accesso su approvazione).

## Cron esterno (automazioni con Replit Autoscale)
Creare un job gratuito su cron-job.org ogni 10 minuti verso `https://<dominio>/api/cron/tick?key=<CRON_SECRET>` dopo aver impostato il Secret `CRON_SECRET`.
