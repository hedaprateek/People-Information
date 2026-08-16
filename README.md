# Society Directory

A resident/committee directory for a housing society. Static files, no build step.

## Quick start (about 5 minutes)

1. **Open** [supabase.com/dashboard](https://supabase.com/dashboard) → your project → **SQL Editor**
   → **New query**. Paste everything from `supabase/migration.sql`, press **Run**.
   The result panel prints two tokens — ignore them, the admin tool shows them anyway.
2. **Copy your key**: same dashboard → **Project Settings** → **API Keys** → `service_role`
   → **Reveal** → copy.
3. **Double-click `local-admin/admin.html`.** Paste the key, click Unlock.
4. **Society tab**: type your society's name → Save.
   **Members tab**: + Add member, fill the row, Save changes.
5. **Share links tab** → click **Open ↗** on a link. That is your directory.

Everything after that is optional: Excel import, deploying to a public URL, expiring links.

---

```
index.html                 <- DEPLOY THIS. Read-only viewer, opened via a share link.
local-admin/admin.html     <- NEVER DEPLOY. Runs on your machine to edit data.
supabase/migration.sql     <- Run once in the Supabase SQL editor.
```

## Security model

The public page holds only the **anon** key. Every table has RLS enabled with **no policies**,
so that key can read nothing directly. The page's single entry point is
`get_directory(token)`, a `SECURITY DEFINER` function that looks the token up in `share_links`
and returns only what that link's scope permits. Editing the URL cannot widen access, because
the scope decision happens inside the database.

All writing is done from `local-admin/admin.html` using the **service_role** key, which you paste
at runtime. It is never written into the file and never leaves your machine.

| | Public link | Residents link | Admin tool |
|---|---|---|---|
| Society name, address | ✓ | ✓ | ✓ |
| Committee + roles + phones | ✓ | ✓ | ✓ |
| Emergency & vendor contacts | ✓ | ✓ | ✓ |
| Full resident roster, flats, phones | ✗ | ✓ | ✓ |
| Any editing | ✗ | ✗ | ✓ |

## Setup

**1. Run the migration.** Supabase Dashboard → SQL Editor → New query → paste all of
`supabase/migration.sql` → Run. It creates the schema, converts the broken numeric `contact`
column to text, locks down every table, and prints two share tokens.

**1b. Check it worked.** Run `node verify-lockdown.js`. It probes with the public anon key and
must print all PASS. Until it does, do not share any link. (Before the migration it reports
failures — that is the point.) It only sends requests matching no rows, and removes the one
test row it creates.

**2. Open the admin tool.** Double-click `local-admin/admin.html`. Paste your service_role key
from Dashboard → Project Settings → API Keys → `service_role` (click Reveal).

**3. Fill in the Society tab.** The name you enter replaces every heading on the public page.

**4. Add people.** Either type them in the Members tab, or go to Import / Export → download the
blank template → fill it in Excel → import it back. Tick **Cttee** on office bearers so they
appear on the public link.

**5. Deploy `index.html`.** Drag it onto [app.netlify.com/drop](https://app.netlify.com/drop),
or push to GitHub Pages. Upload **only** `index.html` — not `local-admin/`.

**6. Share.** In the Share links tab, paste your deployed URL into the base-URL box, then copy
the Public or Residents link. Revoke instantly kills a link for everyone holding it.

## Excel import

Import never writes blind. The flow is: read the sheet → map your column names to fields
(auto-guessed, "Mobile No." finds `phone`) → choose how duplicates are matched (phone, block+flat,
name, or nothing) → see a colour-coded preview of every new/updated/skipped row → Apply.
Cancel at any point and nothing is touched.

Phone numbers are read as raw text throughout, so `+91`, leading zeros, and spaces survive
the round trip instead of being mangled into numbers by Excel.

## Notes

- The residents link exposes the full roster to anyone who receives it. Treat it as
  semi-private: share it in the residents' group, and rotate it if it leaks (create a new link,
  revoke the old one).
- Links support optional `expires_at` — set it directly in the `share_links` table if you want a
  link that dies on its own.
- To rotate the anon key later, replace `SUPABASE_KEY` in `index.html`. To rotate the
  service_role key, do it in the dashboard; the admin tool just asks for it again.
