# Asset Register

Studio/kit/IT/office asset register. Static front end (`public/`) + two Vercel functions (`api/`) + Supabase for data and photos.

## One-time setup
1. **Supabase**: create a project, open SQL Editor, run `supabase/schema.sql`.
2. **Vercel**: Import this GitHub repo (Framework preset: *Other*). Add environment variables:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` (Supabase → Project Settings → API)
   - `ANTHROPIC_API_KEY` (for photo identification / value estimates)
3. Deploy. Every push to `main` redeploys.

## Notes
- Access is open: anyone with the URL can read and write (matches the "open link" choice). `/api/identify` is also public and spends your Anthropic credits. Add Supabase Auth and tighten the policies in `schema.sql` to lock it down.
- QR labels encode the site URL where they were printed, so print them from the final domain.
