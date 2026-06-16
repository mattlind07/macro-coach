# Macro Coach

A full-stack macro & calorie calculator. Enter your **weight**, **typical daily
calories**, and a **goal** (lose / maintain / gain); it returns a daily calorie
target and a protein / carbs / fat split. An AI wrapper (Google Gemini API) does the
personalization, with a deterministic formula as a fallback so the app works even
before you add a key.

- **Frontend:** React + Vite (plain JS)
- **Backend:** one Vercel serverless function (`/api/calculate.js`, Node)
- **Database:** Supabase Postgres via `postgres` npm package (transaction pooler, port 6543)
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
(optionally your average calories) week to week. Once there's at least two days of
data, the backend stops *assuming* your maintenance and starts *measuring* it from
how your weight actually moved:

```
TDEE ≈ avgIntake − (weightChangeLbs × 3500 / days)
```

It then re-runs the goal math off that measured number and updates your target and
macros. Each update is damped to ±250 kcal so a single water-weight blip can't
swing your plan around. This is in `lib/db.js` (`recalibrate`).
