# Sufra Update Spec (October 2026)

Hand this file to Claude Code from the root of the Sufra repo. Commit it to the repo as `docs/sufra-update-spec.md` so it stays with the code.

## Instructions for Claude Code

Read the codebase before changing anything, especially the units library (including `subtractWithDensity()` and `convertToType()`), the grocery list generation, the pantry logic, the ingredients and alias tables, and the recipe ingestion route that calls the Anthropic API. Then report back on two things before writing code: the cause of the grocery list bug described in Phase 1, and a short plan for each phase listing the files and schema changes involved. Build in the phase order below, since each phase depends on the one before it. Write all Supabase schema changes as migration files. Keep the existing stack (Next.js 14 App Router, TypeScript, Supabase, Vercel, Anthropic API) and design (maroon #5C1A1B, beige #FAF6F0, Fraunces display, Inter body). User-facing copy uses plain, direct phrasing and no em dashes.

## Phase 1: Unit conversion and grocery list fix

### The bug

When two recipes use the same ingredient in different units, the grocery list shows them as separate lines instead of one combined line. Example: recipe A calls for 2 tsp salt and recipe B calls for salt in another unit, and the list shows salt twice. Find the cause. Likely candidates are grouping by ingredient plus unit instead of by ingredient alone, missing conversions for container units like cans, or the two recipes matching to different canonical ingredients (such as "salt" and "kosher salt").

### How units should work

There are three display layers and one hidden math layer.

1. Recipes always display amounts exactly as originally entered. Never rewrite or convert a recipe's stored units.
2. All math (aggregation, pantry deduction, pantry comparison) converts every amount into one base unit per ingredient first: grams for anything with a known density or weight, and a count for countable items like eggs or onions. Users never see base units.
3. The pantry displays amounts in recipe-like cooking units (grams, cups, counts), close to how recipes describe them.
4. The grocery list displays purchase units, rounded up to whole packages. Example: if planned recipes need 500 g of sweetened condensed milk, the list says "2 cans," and if 15 g of salt is needed with none in the pantry, it says "1 bag (1 kg)" based on the usual purchase size. If the pantry already covers the need, the item does not appear.

### Data needed

Each canonical ingredient needs a base unit type (mass or count), density where relevant (already partly seeded), a default purchase unit and size, and standard sizes for container units recipes commonly use. Seed standard container sizes such as:

- Sweetened condensed milk can: 14 oz (397 g)
- Evaporated milk can: 12 oz
- Chickpeas and most beans can: 15 to 15.5 oz
- Diced tomatoes can: 14.5 oz
- Coconut milk can: 13.5 oz
- Tomato paste can: 6 oz
- Butter stick: 113 g

Recipe container sizes (standard, set once) and purchase sizes (learned from what the user actually buys) are stored separately, so a recipe's "1 can" stays accurate even if the user buys a larger can.

### Combining rule

The same canonical ingredient always appears as one grocery list line. If a needed conversion is missing (unknown density or container size), still show one line, such as "2 tsp + 1 can," and prompt the user once for the missing size instead of splitting the item.

## Phase 2: Receipt scanning for pantry updates

### Flow

1. From the pantry screen, the user photographs a receipt or uploads a digital receipt (image, PDF, or pasted email text).
2. The Anthropic API (same setup as recipe ingestion) extracts each line item, quantity, and any weight or size.
3. Each line is matched to a canonical ingredient through a product alias table that maps receipt text (for example "MORTON SALT" or "CHKN BRST BNLS") to an ingredient and package size.
4. Sufra compares the results against the open grocery list and checks off every matching item.
5. A review screen shows all matches, highlighting only new or low-confidence lines for the user to confirm or correct.
6. On confirm, the pantry increases by the amounts actually purchased, each item records its purchase date, and any product the user confirmed is saved to the alias table with its size so future receipts need no input for it.

The first time a packaged product appears, the user confirms what it is and its size. Produce sold by weight uses the printed weight. Multiples like "2 @ 3.99" count as two packages.

### Secondary entry methods

1. Quick text entry: the user types or dictates a list like "2 lb chicken, bag of rice, 3 onions, olive oil," which is parsed into the same review screen.
2. Manual grocery list check-off: tapping an item opens a prompt asking how much was bought, prefilled with the usual purchase size for that ingredient. The pantry increases by the amount bought, which can differ from the amount the list needed. Changing the number updates the usual size for next time. For an ingredient with no usual size yet, offer a few common sizes to pick from.

## Phase 3: What can I make

Compare every recipe in the library against the pantry, using the Phase 1 base unit math, and show:

1. Can make now: every ingredient is covered by the pantry.
2. Near misses: missing only one or two ingredients, with a one-tap button to add the missing items to the grocery list.
3. Use it up ranking: recipes that use ingredients that have been in the pantry longest (based on purchase date) rank higher within each group.
4. Claude suggestions: the user can ask Claude for dishes outside the library based on current pantry contents, and save any suggestion as a new recipe through the existing ingestion flow.

Basic staples like salt, water, and cooking oil are treated as always available so they don't block a match. Make the staples list editable.

## Phase 4: Keep-alive for Supabase

The Supabase free tier pauses projects after about a week of low activity. Add an API route that runs one lightweight query against Supabase, plus a Vercel cron entry in `vercel.json` that calls it every three days. Protect the route with a `CRON_SECRET` environment variable checked against the request's authorization header.

## Done when

1. Two recipes using the same ingredient in different units produce one combined grocery list line in purchase units.
2. Recipes display unchanged, the pantry shows cooking units, and the grocery list shows whole packages.
3. A receipt photo updates the pantry with purchased amounts and checks off matching grocery list items, asking only about new or uncertain lines.
4. Checking off an item manually adds the amount actually bought.
5. The what can I make view shows all four parts and its near-miss button adds items to the grocery list.
6. The keep-alive cron is deployed and runs on schedule.
