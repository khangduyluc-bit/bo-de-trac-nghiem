# Backup and restore

## Download the current website code
The latest source archive is available from GitHub:
https://github.com/khangduyluc-bit/bo-de-trac-nghiem/archive/refs/heads/main.zip

This archive contains:
- `index.html.gz.b64`: compressed current frontend. Render's build command reconstructs `index.html` from it.
- `supabase/functions/quiz-api/index.ts`: Edge Function API, including immediate answer checking and privacy enforcement.
- `database.sql`: schema for tests, results, application config, and the test statistics view.
- `README.md`: architecture and deployment notes.

## Restore the current live site
1. Extract the archive and commit its files to branch `main` of the same GitHub repository.
2. Deploy the `quiz-api` Edge Function to the existing Supabase project `bdbazlitbvavavzcmfsi`, with JWT verification disabled as configured today.
3. Deploy the existing Render Static Site from the latest `main` commit. Its build command is:
   `base64 -d index.html.gz.b64 | gunzip > index.html`
4. Keep the existing Supabase project secrets and database. Do not replace them with empty values.

You can also upload this ZIP to ChatGPT and ask to restore/deploy it to the existing website.

## What this code backup does not include
- The actual rows currently stored in the Supabase database (test papers and student results).
- Supabase server secrets, teacher password hashes, site passcode hash/salt, or session-signing secret.

The live database is separate from the source archive. This backup can restore the website code, but it is not a full database-data backup if the Supabase project itself is deleted.
