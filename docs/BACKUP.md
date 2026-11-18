# Backup e ripristino

## Backup automatici di Replit
Il database PostgreSQL di Replit (Neon) conserva automaticamente la cronologia e permette il **ripristino a un punto nel tempo** dal pannello *Database* del progetto. È la prima linea di difesa.

## Backup manuale / esterno
Dalla Shell di Replit:

```bash
npm run backup
```

Crea `backups/backup-AAAAMMGG-HHMM.sql.gz` (vengono mantenuti gli ultimi 14). Scaricare periodicamente il file su un archivio esterno (Google Drive, NAS), perché la cartella del progetto non è un luogo sicuro per i backup.

## Ripristino

```bash
gunzip -c backups/backup-AAAAMMGG-HHMM.sql.gz | psql "$DATABASE_URL"
```

Ripristinare su un database **vuoto** (crearne uno nuovo dal pannello Database, aggiornare `DATABASE_URL`, eseguire il comando, riavviare).

## Migrazioni
Lo schema è versionato in `server/migrations/`. All'avvio il server applica automaticamente solo le migrazioni nuove (tabella `schema_migrations`), ognuna in una transazione.
