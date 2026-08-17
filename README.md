# Society Directory

A public web page that reads its content from an Excel file. Two files, no database,
no login, no build step.

```
index.html      the public page
admin.html      the editor (edit, import/export Excel, upload files, publish)
data.xlsx       the data — every sheet becomes a section
materials/      uploaded documents, listed via the Documents sheet
_headers        cache rules for Cloudflare Pages / Netlify
```

**Live at:** https://hedaprateek.github.io/People-Information/

## Hosting on Cloudflare Pages (nicer URL)

To serve the same repo from `something.pages.dev` instead of a github.io address:

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** →
   **Pages** → **Connect to Git**
2. Authorise GitHub and pick **People-Information**
3. Build settings — this is a plain static site, so leave the build empty:
   - Framework preset: **None**
   - Build command: **blank**
   - Build output directory: **`/`**
4. Set the **project name** — that becomes the subdomain, e.g. `greenvalley` gives
   `greenvalley.pages.dev`
5. **Save and Deploy**

Every push to `main` redeploys automatically, so publishing from the admin panel still
works unchanged: it commits `data.xlsx` to GitHub, and Cloudflare rebuilds within a minute.
Both URLs keep working — GitHub Pages stays live unless you turn it off.

## Updating the directory

1. Download `data.xlsx` (or edit your local copy).
2. Change it in Excel and save.
3. On GitHub: open `data.xlsx` → **Add file → Upload files** → drop the new one → **Commit**.

The site picks it up within a minute. Anyone with the link sees the update — no
accounts, no passwords, nothing to log into.

## How the spreadsheet maps to the page

**Every sheet tab becomes a section**, in the order the tabs appear, and the tab name
becomes the heading. Add a tab, get a section. Rename a tab, rename the section.

The one special tab is **`About`** — a two-column `Field` / `Value` sheet that fills the
page header rather than becoming a section:

| Field | Value |
|---|---|
| Society Name | Green Valley Residency |
| Tagline | A Co-operative Housing Society |
| Address | Plot 14, Sector 22, Kharghar |
| City | Navi Mumbai |
| Pincode | 410210 |
| Registration No | NBOM/HSG/1284/2009 |

A tab named `Emergency` (or anything containing "emerg") is styled red and pinned with
an alert icon.

### Columns

Column names are matched by meaning, so you don't have to use exact headings:

| Role on the card | Headings that match |
|---|---|
| Heading | `Name`, `Service`, `Person`, `Label`, or the first column |
| Call button | `Phone`, `Mobile`, `Contact No`, `Cell`, `Tel`, `Number` |
| Email button | `Email`, `Mail` |
| Small caps label | `Role`, `Designation`, `Post`, `Type`, `Category` |
| Grey subtitle | `Flat`, `Block`, `Wing`, `Tower`, `Unit`, `Floor`, `Address` |
| Extra lines | anything else, shown as `Heading: value` |

Multiple phone columns each get their own call button. Blank cells are skipped.

**Keep phone numbers as text in Excel** — format the column as Text before typing, or
Excel eats the leading `0` and turns `+91 98…` into a number.

## Notes

- The page has a search box covering every column of every sheet, a section nav bar,
  click-to-call links, a share button, and a light/dark toggle.
- Opening `index.html` by double-clicking will show a load error — browsers block
  local file reads. Use the **Open an Excel file from this device** button to preview,
  or just use the live URL.
- Anything you put in `data.xlsx` is public. Don't include what you wouldn't post on
  the noticeboard.

The earlier Supabase version is in git history; `git show 7d7c701` has it if ever needed.
