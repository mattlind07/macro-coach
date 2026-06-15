# Macro Coach

A full-stack macro & calorie calculator. Enter your **weight**, **typical daily
calories**, and a **goal** (lose / maintain / gain); it returns a daily calorie
target and a protein / carbs / fat split. An AI wrapper (Google Gemini API) does the
personalization, with a deterministic formula as a fallback so the app works even
before you add a key.

- **Frontend:** React + Vite (plain JS)
- **Backend:** one Vercel serverless function (`/api/calculate.js`, Node)
- **Deploy:** Vercel (no server to manage)

## How it decides the numbers

It treats your *current typical intake* as your maintenance calories (a roughly
weight-stable person's intake ≈ their TDEE), then:

| Goal | Calories | Protein | Fat | Carbs |
|------|----------|---------|-----|-------|
| Lose | maintenance − ~400 | 1.0 g/lb | 0.38 g/lb | fill the rest |
| Maintain | maintenance | 0.8 g/lb | 0.35 g/lb | fill the rest |
| Gain | maintenance + ~250 | 0.9 g/lb | 0.35 g/lb | fill the rest |

Protein is set first, then fat, then carbs fill the remaining calories. Targets
are clamped to a safe floor (1500 kcal male / 1200 female) with a warning.

## Progress tracker & auto-recalibration (the coach part)

After calculating a plan, you can **start tracking** it and log your weight
(optionally your average calories) week to week. Once there's at least a week of
data, the backend stops *assuming* your maintenance and starts *measuring* it from
how your weight actually moved:

```
TDEE ≈ avgIntake − (weightChangeLbs × 3500 / days)
```

It then re-runs the goal math off that measured number and updates your target and
macros. Each update is damped to ±250 kcal so a single water-weight blip can't
swing your plan around. This is in `lib/db.js` (`recalibrate`).

No login: each browser gets a random anonymous id (localStorage) that keys its data
in Postgres. Swap in real auth later without changing the API.

### Enabling the tracker (Neon Postgres)

`@vercel/postgres` is deprecated — this uses the **Neon** integration + the
`@neondatabase/serverless` driver.

1. In your Vercel project: **Storage → Create Database → Neon** (Marketplace).
2. It auto-injects `DATABASE_URL` (and friends) into your project.
3. Redeploy. Tables are created automatically on first use — no migration step.

Without a database, the calculator still works fully; only the tracker is disabled.

## Run locally

Two options.

**A) Frontend only (uses the formula fallback, no key needed):**
```bash
npm install
npm run dev          # http://localhost:5173
```
Note: `npm run dev` alone serves the React app but NOT the `/api` route, so calls
fall through to an error. For the full thing locally, use option B.

**B) Full stack locally (frontend + serverless function):**
```bash
npm install
npm i -g vercel      # one time
vercel dev           # runs React + /api together
```
Add your key first: copy `.env.example` to `.env.local` and fill in
`GEMINI_API_KEY`. Without it, `/api/calculate` returns the formula estimate.

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. On vercel.com: **New Project** → import the repo. Vercel auto-detects Vite.
3. **Settings → Environment Variables** → add `GEMINI_API_KEY`
   (and optionally `GEMINI_MODEL`; default is `gemini-2.5-flash`, free tier).
4. Deploy. Done — the `/api` function is created automatically.

Or from the CLI:
```bash
vercel            # preview
vercel --prod     # production
```

## Where to change things

- **Macro math / goal adjustments:** `lib/macros.js`
- **Recalibration logic + DB access:** `lib/db.js`
- **AI prompt + model + JSON validation:** `api/calculate.js`
- **Plan save/load:** `api/plan.js` · **Weigh-ins + recalibrate:** `api/weighin.js`
- **UI / colors / fonts:** `src/index.css` (design tokens at the top)
- **Form fields:** `src/components/InputForm.jsx`
- **Result display:** `src/components/Results.jsx`
- **Tracker / chart:** `src/components/Tracker.jsx`

## Notes

- The AI is asked to return strict JSON; the backend validates the shape and
  falls back to the formula if anything is malformed or the call fails. The user
  never sees a hard error from a bad model response.
- This is general guidance, not medical or dietary advice.
