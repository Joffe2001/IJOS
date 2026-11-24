# Contributing to IJOS

Thanks for helping. IJOS is a small, local-first app. Please keep it simple.

## Ground rules

- **No personal data in issues, commits or pull requests.** Do not attach `data/`, backups, `study.db` files or real course material. Reproduce problems with the sample data (Settings → Sample data) or with `test/make_fixtures.mjs`.
- **No new runtime dependencies** without discussion. The app runs on Node.js built-ins plus vendored KaTeX.
- **No network calls** from the app. IJOS must keep working offline and must never send user data anywhere.
- Hebrew is the primary UI language, and the layout is RTL-first. Use logical CSS properties (`inline-start` / `inline-end`), and `<bdi>` / `dir="auto"` for user text.
- Never invent user facts (dates, grades, lecturer details) in code or sample data. Sample content must be synthetic and labelled "דוגמה".

## Running

```
node --version        # 22.13 or newer
npm start             # http://127.0.0.1:4321, data in ./data
npm test              # server and unit tests, on temporary folders
bash test/run_e2e.sh  # browser walkthrough (needs: pip install playwright && python -m playwright install chromium)
```

Use `IJOS_DATA=<folder>` to run against a throwaway data folder while developing.

## Changes to the data model

- Bump `SCHEMA_VERSION` in `server/db.js` and add a migration step that keeps every existing record.
- Add a test that opens a database from the previous schema and checks that the data survives (see `makeV1` in `test/server.test.js`).
- Backups from older versions must keep restoring.

## Pull requests

Keep them focused. Describe what changed, how you tested it (Windows, browser, Node version), and include screenshots for UI changes, made with synthetic data.
