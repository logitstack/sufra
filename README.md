# Sufra

Your recipe library, meal planner, and kitchen companion. Multi-device, sharing-friendly, designed for real cooking.

## What's in this build

Every feature you asked for, wired and working once Supabase + Anthropic are set up:

- **Recipe ingestion** from links (NYT Cooking, Serious Eats, blogs), pasted text (Instagram captions, emailed recipes, anything), and photos (cookbook pages, handwritten cards, screenshots). The ingester uses schema.org JSON-LD first for clean structured sources, then falls back to Claude Sonnet 4.5 for vision and messy text.
- **Library** sorted by cuisine OR by category (meat / vegetarian / baked goods / desserts / drinks) with search and filters. Every recipe is the same uniform layout: photo, byline, source link, ingredients list, numbered method, notes, tags.
- **Multi-device**: data lives in Postgres via Supabase, sync is automatic. Same view on phone, laptop, tablet.
- **Read-only sharing** by email. Recipients see a "Shared with you" badge and can fork into their own library with one tap.
- **Meal planner**: pick recipes, set how many times you want each one and how many servings per time, generate a single aggregated grocery list.
- **Pantry inventory** with categories (spices, produce, protein, dairy, grains, pantry, condiments). Add, edit, delete. Track expiration dates. Especially useful for spices that don't need re-buying often.
- **Auto-update**: when you check items off your shopping list, they get added to your pantry. When you mark a recipe as cooked, ingredients get deducted from your pantry scaled by servings made. You can manually edit anytime.

## Stack

- **Frontend**: Next.js 14 (App Router) + Tailwind CSS + TypeScript
- **Backend**: Supabase (Postgres + Auth + Storage)
- **AI**: Anthropic Claude Sonnet 4.5 (recipe extraction from URL/text/photo)
- **Hosting**: Vercel
- **Fonts**: Fraunces (display) + Inter (body)
- **Palette**: Maroon (#5C1A1B) + Beige (#FAF6F0) + White

## Setup, step by step

You need accounts on three services: Supabase (database + auth + storage), Anthropic (recipe ingestion), and Vercel (hosting). All free to start.

### 1. Install dependencies

```bash
cd sufra
npm install
```

### 2. Create your Supabase project

1. Go to https://app.supabase.com and sign up (or sign in)
2. Click **New project**. Pick a name (e.g. "sufra"), set a strong database password, pick the closest region
3. Wait about 2 minutes for it to provision

### 3. Run the schema

In your new project, click **SQL Editor** in the left sidebar, then **New query**.

Open `supabase/schema.sql` in your code editor, copy the entire file, paste it into the SQL Editor, click **Run**. This creates 11 tables with row-level security policies.

Then open `supabase/seed.sql`, do the same: copy, paste, run. This adds the email-lookup function used for sharing, plus 42 canonical ingredients with 60+ aliases (so "evoo" maps to "olive oil", "haldi" to "turmeric", etc).

### 4. Create the storage bucket

1. Click **Storage** in the sidebar
2. Click **New bucket**
3. Name it exactly: `recipe-images`
4. Toggle **Public bucket** ON
5. Click **Create bucket**

Then add an upload policy so authenticated users can upload to their own folder:

1. Click into the `recipe-images` bucket
2. Click **Policies** → **New policy** → **For full customization**
3. Set:
   - **Policy name**: Authenticated users upload to own folder
   - **Allowed operation**: INSERT
   - **Target roles**: authenticated
   - **Policy definition**:
     ```sql
     (bucket_id = 'recipe-images') AND ((storage.foldername(name))[1] = auth.uid()::text)
     ```
4. Click **Review** then **Save policy**

### 5. Enable email magic-link auth

1. Click **Authentication** in the sidebar, then **Providers**
2. Email is enabled by default. Make sure **Confirm email** is ON
3. Click **URL Configuration**
4. Set **Site URL** to `http://localhost:3000` (you'll update this to your Vercel URL after deploy)
5. Under **Redirect URLs**, add: `http://localhost:3000/auth/callback`

### 6. Get an Anthropic API key

1. Go to https://console.anthropic.com and sign in
2. Click **API Keys** in the sidebar
3. Click **Create Key**, name it "sufra", copy the key (starts with `sk-ant-...`)
4. Add at least $5 of credit in **Plans & Billing** so the ingester can actually work

### 7. Configure environment

```bash
cp .env.local.example .env.local
```

Open `.env.local` and fill in three values:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...
```

Get the Supabase values from **Settings → API** in your Supabase dashboard.

### 8. Run it locally

```bash
npm run dev
```

Open http://localhost:3000. You'll be redirected to `/login`. Enter your email, check your inbox, click the magic link, you're in. Try:

1. Click **Add** in the top right
2. Paste a recipe URL (like a NYT Cooking link) and click **Extract** — Sufra fills in the whole form
3. Edit anything that looks off, add a photo, save
4. Open **Pantry** and add a few items
5. Open **Plan**, pick the recipe, set how many times to make it, save
6. Click **Generate shopping list** — your pantry items get subtracted from what you need to buy
7. Tap items in the shopping list as you go; they get added to your pantry automatically
8. On the recipe page, click **I cooked this** and confirm servings — your pantry deducts the used ingredients

### 9. Deploy to Vercel

```bash
npx vercel
```

Follow the prompts. After deploy:

1. Go to your project in the Vercel dashboard
2. **Settings → Environment Variables**
3. Add the same three values from `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`
4. Redeploy: `npx vercel --prod`

Then back in Supabase:

1. **Authentication → URL Configuration**
2. Change **Site URL** to your Vercel URL (e.g. `https://sufra.vercel.app`)
3. Add to **Redirect URLs**: `https://sufra.vercel.app/auth/callback`

### 10. Install on your phone

The app works in any mobile browser, but for a near-native experience:

- **iPhone**: open the Vercel URL in Safari, tap the Share button, scroll down, tap **Add to Home Screen**
- **Android**: open in Chrome, tap the menu, tap **Install app** or **Add to Home Screen**

Sufra now lives on your home screen like a native app.

## How features work

### The ingester

When you click "Add recipe", three import options sit at the top of the page:

- **From a link**: paste a URL. Sufra fetches the page. If it has schema.org Recipe JSON-LD embedded (most modern recipe sites do), Sufra parses that directly — no AI cost. Otherwise it sends the page text to Claude Sonnet 4.5 with strict extraction instructions, getting structured JSON back.
- **Paste text**: drop any block of text. Instagram caption, email forward, blog excerpt. Goes to Claude with the same extraction prompt.
- **From a photo**: take or upload a photo of a cookbook page, handwritten card, screenshot. Claude's vision reads it.

In all three cases, the form fills in: name, author, category, cuisine, servings, time, ingredients with parsed quantities and units, steps, tags, source URL. You review and edit before saving.

### Library sorting

Three view modes at the top: **Cuisine**, **Category**, or **All**. Cuisine groups by Pakistani / Levantine / Mediterranean / etc. Category groups by Meat / Vegetarian / Baked Goods / Desserts / Drinks. You can also filter by author and search by name, ingredient, or tag.

### Meal planning + grocery list math

When you generate a shopping list from a plan:

1. For each plan item, Sufra scales the recipe's ingredients by `(times_per_period × servings_per_time) / recipe.servings_yield`
2. All scaled ingredients across all recipes get aggregated by canonical ingredient (so "1 cup flour" from one recipe plus "200g flour" from another get combined)
3. Quantities get normalized to base units (volumes → ml, weights → g) before summing
4. Your pantry quantities get subtracted from what's needed
5. The remainder becomes the shopping list, grouped by store section (produce, protein, dairy, etc)
6. Items where the pantry already covers the full need are omitted

### Pantry auto-updates

- **When you check off a shopping list item**: that quantity gets added to your pantry (creates a new entry or sums into existing)
- **When you click "I cooked this" on a recipe**: ingredients are scaled to servings made and deducted from your pantry (floored at zero — never goes negative)
- **Manual edits anytime**: tap any pantry item to edit its quantity, set/clear an expiration date, or delete it

### Sharing

When you share a recipe:

1. The recipient must already have a Sufra account (sharing tells you clearly if not)
2. They see the recipe under "Shared with me" in their library with a maroon "Shared" badge
3. They can read but not edit. RLS policies enforce this at the database level
4. They can tap "Save a copy to my library" to fork it — all ingredients, steps, image link copied — and edit their fork freely. Your original is untouched.

## Project structure

```
sufra/
├── app/
│   ├── (app)/                            Authenticated routes
│   │   ├── layout.tsx                    Top nav + user menu
│   │   ├── library/                      Library with cuisine/category sorting
│   │   ├── recipe/
│   │   │   ├── new/                      Add page with inline ingester
│   │   │   └── [id]/                     Detail page with share/cook/delete
│   │   ├── plan/                         Meal plans
│   │   ├── pantry/                       Inventory CRUD
│   │   └── shopping/                     Generated shopping lists
│   ├── auth/callback/                    Magic link handler
│   ├── login/                            Sign in
│   └── lib/
│       ├── supabase.ts                   Browser client
│       ├── supabase-server.ts            Server client
│       ├── anthropic.ts                  Claude API wrapper
│       ├── recipe-extractor.ts           JSON-LD + Claude ingester
│       ├── units.ts                      Unit conversion (ml/g base units)
│       ├── upload.ts                     Storage upload helper
│       └── types.ts                      Shared TypeScript types
├── components/
│   └── UserMenu.tsx                      Avatar + sign out
├── supabase/
│   ├── schema.sql                        11 tables with RLS policies
│   └── seed.sql                          Email RPC + canonical ingredients
├── middleware.ts                         Auth protection
└── (config files)
```

## Database schema highlights

- `recipes` + `recipe_ingredients` + `recipe_steps` — the recipe itself, with ingredients linked to a canonical `ingredients` table for cross-recipe aggregation
- `ingredient_aliases` — maps "evoo" / "extra-virgin olive oil" / etc. to the canonical entry
- `recipe_shares` — many-to-many for read-only sharing
- `pantry` — your inventory, scoped to your user_id with RLS
- `meal_plans` + `plan_items` — what you're planning to cook
- `shopping_lists` + `shopping_items` — generated from plans, checking items adds to pantry

Row-level security on every user-owned table ensures one user can never see another user's data, except through explicit `recipe_shares` entries.

## Roadmap (future phases)

| Phase | Status | What's in it |
|-------|--------|--------------|
| 1 | ✅ Done | Library, recipe detail, add/edit/delete, share, fork, multi-device, auth |
| 2 | ✅ Done | URL/text/photo ingestion via Claude, JSON-LD fast path |
| 3 | ✅ Done | Meal planner with frequency, aggregated grocery list, pantry-aware subtraction |
| 4 | ✅ Done | Pantry CRUD, auto-add on shopping check-off, auto-deduct on cook |
| 5 | Future | Receipt scanning, price history per ingredient, cheapest-basket optimizer across stores |
| 6 | Future | PWA: offline shopping list cache, install prompt, native share intent |

## Conventions

- No em dashes in copy
- Second person ("you", not "the user")
- Ingredients first, steps second, always
- Steps are imperative ("Heat the oven", not "The oven is heated")
- Source links live in the recipe header, not in notes
- Tags lowercase for consistency
