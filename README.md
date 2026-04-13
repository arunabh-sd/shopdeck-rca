# ShopDeck RCA Console

## Files
- `server.js` — backend server (handles Metabase + Claude API calls)
- `index.html` — the entire UI
- `package.json` — project config

## Deploy to Railway

1. Upload this folder to a GitHub repo (drag and drop all 3 files)
2. Go to railway.app → New Project → Deploy from GitHub repo
3. Select your repo
4. Go to Variables and add:
   - `METABASE_URL` = `https://metabase.kaip.in`
   - `METABASE_API_KEY` = your Metabase API key
   - `ANTHROPIC_API_KEY` = your Anthropic API key
5. Railway will deploy and give you a URL

## Making changes
- **Design or prompt changes**: edit `index.html`, push to GitHub, Railway auto-redeploys in ~60 seconds
- **New Metabase questions**: add question IDs in the Settings panel in the UI — no code change needed
- **Criteria changes**: edit directly in the Settings panel in the UI — no code change needed
