# PromoApp Salon Suite · Turn Over by Zaira

Sito pubblico, prenotazioni online e gestionale completo per saloni unisex (donna, uomo, bambino).
Prima installazione: **Turn Over by Zaira**, Via Antonio Vivaldi 18, 20037 Paderno Dugnano (MI).

Il software è una base PromoApp **riutilizzabile e multi-salone**: ogni attività ha brand, servizi, utenti, dati e dominio separati.

---

## Accesso al gestionale

| | |
|---|---|
| Indirizzo | `https://<dominio>/admin` |
| Utente | `zaira` |
| Password iniziale | `Zaira` (oppure il valore del Secret `ADMIN_PASSWORD` al primo avvio) |

> Al primo accesso cambiare la password da **Cambia password** (menu laterale): con 8 tentativi errati l'account si blocca per 15 minuti.

---

## Avvio su Replit

1. Su Replit: **Create Repl → Import from GitHub** → `promoapp360-prog/turnover`.
2. Apri il pannello **Database** e crea un database **PostgreSQL**: Replit imposta da solo il Secret `DATABASE_URL`.
3. (Facoltativo) In **Secrets** aggiungi i valori di `.env.example` (es. `PUBLIC_BASE_URL`, `CRON_SECRET`, chiavi email/WhatsApp).
4. Premi **Run**. Al primo avvio il server crea le tabelle (migrazioni) e carica i dati reali del salone.
5. (Facoltativo) Per provare il gestionale con dati finti: nella Shell `npm run seed:demo`. Si eliminano poi da **Impostazioni → Dati e backup**.
6. Pubblica con **Deploy → Autoscale** (configurato in `.replit`). Collega il dominio da Deployments → Settings → Custom domain e inseriscilo anche in **Impostazioni → Dominio**.

### Automazioni con Autoscale
Con Autoscale il server può “addormentarsi” quando non ci sono visite. Promemoria, richieste di recensione e auguri vengono eseguiti:
- ogni 5 minuti mentre il server è attivo;
- **oppure** da un cron esterno gratuito (es. cron-job.org) che ogni 10 minuti chiama
  `https://<dominio>/api/cron/tick?key=<CRON_SECRET>`.

In alternativa usare un deployment **Reserved VM** (sempre acceso, costo mensile maggiore).

---

## Cosa c'è

**Sito pubblico** (generato lato server, ottimizzato SEO con dati strutturati `HairSalon`): home con copertina, servizi donna/uomo/bambino, listino aggiornato dal gestionale, chi siamo, team, galleria, promozioni, pacchetti, recensioni (solo se approvate), gift card, orari, mappa Google, telefono, WhatsApp, social, pulsante **Prenota ora**, pagine privacy/cookie/condizioni, barra mobile.

**Prenotazione online**: categoria → servizi multipli (prezzo e durata totale) → operatore preferito o “primo disponibile” → solo orari realmente liberi → dati e consensi → conferma. Link personale per spostare/annullare entro le regole del salone. Lista d'attesa automatica quando non ci sono posti.

**Motore prenotazioni** (`server/lib/booking.js`)
- servizi consecutivi con lo stesso operatore;
- **tempi di posa**: durante la posa l'operatore è libero e può servire un altro cliente;
- pause/pulizia dopo il servizio, orari salone ∩ turni operatore, ferie, assenze, ritardi, chiusure straordinarie;
- assegnazione automatica all'operatore meno carico;
- **nessuna doppia prenotazione**, anche con conferme simultanee: lock transazionale per operatore + vincolo di esclusione PostgreSQL (`busy_blocks`). Collaudato con due prenotazioni contemporanee sullo stesso orario: una sola riesce.

**Gestionale** (`/admin`, PWA installabile sullo smartphone)
- **Dashboard**: prenotazioni di oggi/settimana, da confermare, clienti in salone, incassi giorno/mese con confronto, clienti nuovi/abituali, cancellazioni, assenze, servizi più richiesti, operatori più impegnati, scontrino medio, prodotti più venduti, grafico incassi; filtri per date, operatore, categoria. Tutti i valori sono calcolati dai dati registrati.
- **Agenda**: vista giorno (colonne per operatore), settimana, mese; colori per operatore; **drag & drop** e ridimensionamento della durata; inserimento rapido cliccando sull'orario; ricerca; note; stati (da confermare, confermato, arrivato, in lavorazione, completato, cancellato, non presentato); appuntamenti ricorrenti; orari chiusi e assenze evidenziati; aggiornamento in tempo reale tra più dispositivi (SSE) con **controllo di versione** (nessuna sovrascrittura silenziosa).
- **Clienti / CRM**: scheda completa, storico appuntamenti e acquisti, frequenza visite, preferenze, **schede tecniche e formule colore**, foto prima/dopo (solo con consenso), pacchetti, gift card, punti, consensi privacy/marketing/foto; filtri inattivi, mai venuti, nuovi, compleanni; unione duplicati; export CSV; **GDPR**: export dati e anonimizzazione.
- **Staff e turni**: profilo, foto, colore, servizi abilitati, turni settimanali, ferie/assenze/chiusure, provvigioni.
- **Cassa**: apertura/chiusura cassa con quadratura contanti, conto da appuntamento, servizi e prodotti, sconti, promozioni e coupon, punti fedeltà, gift card, pacchetti prepagati, pagamenti misti, storno completo, storico.
- **Magazzino**: prodotti, categorie, fornitori, costi e prezzi, giacenze, scorta minima con avvisi, carico/scarico/uso nei trattamenti, vendita al banco, movimenti, valore magazzino, più venduti.
- **Promo e fedeltà**: promozioni a tempo, % o importo fisso, su singoli servizi, coupon, promo compleanno, pacchetti/abbonamenti a sedute, gift card digitali, programma punti configurabile, campagne a segmenti (inattivi, donna, uomo…).
- **Messaggi**: conferma, promemoria, modifica, cancellazione, recensione, compleanno, lista d'attesa, campagne. Testi modificabili, registro invii con esiti ed errori, consensi rispettati. Pulsante WhatsApp manuale sempre disponibile.
- **Report**: incassi per giorno, servizio, operatore (con provvigioni), metodo di pagamento, tipologia, spese, risultato, chiusure di cassa, export CSV.
- **Impostazioni**: dati salone, orari, regole di prenotazione, moduli attivabili/disattivabili, utenti e ruoli, domini, dati demo, registro attività. Logo, colori, font e contenuti del sito da **Sito pubblico**.

**Ruoli**: Amministratore · Responsabile salone · Receptionist · Operatore (vede l'agenda, gestisce lo stato dei *propri* appuntamenti e le schede tecniche; nessun accesso a cassa e report). I permessi sono verificati **sul server**.

---

## Architettura

```
server/
  index.js            server HTTP (Node.js, senza framework), sicurezza, routing
  lib/db.js           PostgreSQL (driver pg), transazioni, migrazioni automatiche
  lib/booking.js      motore disponibilità e prenotazioni
  lib/auth.js         password scrypt, sessioni su DB, ruoli e permessi
  lib/tenant.js       multi-tenant: risoluzione per dominio, impostazioni predefinite
  lib/notifications.js email (Resend/Brevo) e WhatsApp Cloud API
  lib/scheduler.js    promemoria, recensioni, compleanni
  routes/             API pubbliche, gestionale, sito SSR
  migrations/         schema SQL versionato
public/
  assets/             CSS/JS del sito e della prenotazione
  admin/              gestionale (SPA a moduli ES, nessun build necessario)
test/e2e.test.js      test end-to-end su PostgreSQL reale
```

- **Unica dipendenza**: `pg`. Nessun passaggio di build: su Replit basta `npm install` e `npm start`.
- **Multi-tenant**: tutte le tabelle hanno `tenant_id` e ogni query filtra per tenant; le sessioni valgono solo per il tenant in cui sono state create. Tenant risolto dal dominio (tabella `domains`) o da `DEFAULT_TENANT`. Predisposto per più sedi (`locations`).
- **Immagini** caricate dal gestionale salvate nel database (persistono anche su Autoscale), ridimensionate nel browser e verificate lato server; le foto dei clienti sono private.
- **Sicurezza**: password con scrypt + salt, cookie di sessione HttpOnly/SameSite/Secure, blocco dopo tentativi falliti, rate limiting su login e prenotazioni, protezione CSRF (origin + header), CSP restrittiva, validazione di tutti gli input, prevenzione CSV injection, honeypot anti-spam, registro attività.
- **Dati demo** separati (`is_demo`) ed eliminabili con un clic; le automazioni non inviano mai messaggi ai clienti demo.

## Test

```bash
TEST_DATABASE_URL=postgres://... npm test   # ATTENZIONE: svuota il database indicato
```
I test coprono: disponibilità e orari, prenotazione simultanea (anti doppia prenotazione), posa, privacy obbligatoria, spostamento/annullamento cliente, login e password, CSRF, agenda con controllo di versione, cassa con pagamento misto/magazzino/punti, gift card, dashboard e report, ruoli, GDPR, pagine pubbliche.

## Da completare / verificare con il salone

- **Listino**: i prezzi “Fiala curativa” (5 €), “Barba” (5 €) e “Trattamento curativo” (10 €) sono quelli pubblicati online; **tutti gli altri prezzi e le durate sono indicativi** e vanno confermati da Zaira in *Servizi e listino*.
- **Orari**: impostati da Google (mar–ven 9–18, sab 9–17). Treatwell indica 9–18:30: verificare in *Impostazioni → Orari*.
- **Foto**: le immagini attuali sono foto di repertorio Pexels, da sostituire con quelle del salone (*Sito pubblico* e *Staff*).
- **Social, email, P.IVA**: da inserire in *Impostazioni → Salone*.
- **Recensioni**: aggiungere solo quelle autorizzate.
- **Testi privacy**: generati automaticamente con i dati del salone, da far verificare a un consulente.

Integrazioni che richiedono account esterni: vedi [docs/INTEGRAZIONI.md](docs/INTEGRAZIONI.md). Backup: [docs/BACKUP.md](docs/BACKUP.md).

---
Realizzato da **PromoApp** – software gestionali personalizzati.
