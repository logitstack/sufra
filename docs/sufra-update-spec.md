# Sufra Update Spec (October 2026)

Hand this file to Claude Code from the root of the Sufra repo. Commit it to the repo as `docs/sufra-update-spec.md` so it stays with the code.

## Instructions for Claude Code

Read the codebase before changing anything, especially the units library (including `subtractWithDensity()` and `convertToType()`), the grocery list generation, the pantry logic, the "I cooked this" flow, the recipe form and recipe display, the ingredients and alias tables, and the recipe ingestion route that calls the Anthropic API. Then report back on two things before writing code: the cause of the grocery list bug described in Phase 1, and a short plan for each phase listing the files and schema changes involved. Build in the phase order below, since later phases depend on earlier ones. Write all Supabase schema changes as migration files. Keep the existing stack (Next.js 14 App Router, TypeScript, Supabase, Vercel, Anthropic API) and design (maroon #5C1A1B, beige #FAF6F0, Fraunces display, Inter body). User-facing copy uses plain, direct phrasing and no em dashes.

## Phase 0: Keep-alive for Supabase

Do this first since it's small and prevents the project from pausing again. The Supabase free tier pauses projects after about a week of low activity. Add an API route that runs one lightweight query against Supabase, plus a Vercel cron entry in `vercel.json` that calls it every three days. Protect the route with a `CRON_SECRET` environment variable checked against the request's authorization header.

## Phase 1: Units, pantry tracking modes, and fractions

### The bug

When two recipes use the same ingredient in different units, the grocery list shows them as separate lines instead of one combined line. Example: recipe A calls for 2 tsp salt and recipe B calls for salt in another unit, and the list shows salt twice. Find the cause. Likely candidates are grouping by ingredient plus unit instead of by ingredient alone, missing conversions for container units like cans, or the two recipes matching to different canonical ingredients (such as "salt" and "kosher salt").

### Two pantry tracking modes

Each canonical ingredient has a tracking mode.

1. Status tracked: the pantry records only "have it," "running low," or "out." Cooking a recipe never deducts these. This applies to spices, salt, oil, milk, eggs, tomato sauce, and sauces in general. Set this through an ingredient category flag so new spices and sauces default to status tracking, and let the user switch any ingredient between modes.
2. Measured: the pantry records an amount, and "I cooked this" deducts the amount used. This applies to everything else, such as meat, rice, flour, and produce.

After the user taps "I cooked this," show the status-tracked ingredients the recipe used with quick buttons to mark any of them as running low or out. Receipt scanning and manual purchases set status-tracked items back to "have it."

### How units should work

There are three display layers and one hidden math layer.

1. Recipes always display amounts as originally entered. Never rewrite or convert a recipe's stored units.
2. All math (aggregation, pantry deduction, pantry comparison) converts every amount into one base unit per ingredient first: grams for anything with a known density or weight, and a count for countable items like onions. Users never see base units.
3. The pantry displays measured amounts in recipe-like cooking units (grams, cups, counts), close to how recipes describe them. Status-tracked items display their status.
4. The grocery list displays purchase units, rounded up to whole packages. Example: if planned recipes need 500 g of sweetened condensed milk, the list says "2 cans." If the pantry already covers the need, the item does not appear as something to buy.

### Data needed

Each canonical ingredient needs a tracking mode, a base unit type (mass or count), density where relevant (already partly seeded), a default purchase unit and size, and standard sizes for container units recipes commonly use. Seed standard container sizes such as:

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

### Fractions in recipes

Recipe amounts in cups, tablespoons, and teaspoons display as fractions, never decimals. Round to the nearest common cooking fraction (1/8, 1/4, 1/3, 1/2, 2/3, 3/4) and show mixed numbers, so 1.5 cups reads "1 1/2 cups" and 0.333 tsp reads "1/3 tsp." This applies to recipes as entered, recipes ingested from links, text, or photos, and amounts after scaling servings. The recipe form accepts fractions, mixed numbers, and decimals as input.

## Phase 2: Grocery list generation and review

### Flow

1. The user builds a meal plan and taps "Generate grocery list."
2. Sufra opens a review screen grouped into sections, described below.
3. The user adjusts checks and substitutions, then taps OK.
4. The final shopping list contains only checked items, shown in purchase units.

### Review screen sections

1. To buy (checked by default): ingredients the plan needs that are not in the pantry, or where the pantry has less than needed. For a shortfall, show how much more is needed, rounded up to whole packages.
2. You may have something similar (unchecked by default): ingredients the plan needs that are not in the pantry, where the pantry holds a likely substitute. Examples: shallots needed and red onion in the pantry, heavy cream needed and half-and-half in the pantry. Use the Anthropic API once per list generation to propose substitutes from the current pantry contents. Each item shows its suggestions and lets the user pick a pantry item to use instead. Picking a substitute records it for that meal plan, so "I cooked this" later deducts from the substitute if it's measured. If the user would rather buy the original, they check it.
3. Running low (unchecked by default): status-tracked items marked running low or out, even if the plan doesn't need them, so the user can top up spices and staples while shopping. If the plan needs an item that is out, it goes in To buy instead.
4. Already have (collapsed): ingredients fully covered by the pantry, shown for reference only.

When the user taps OK, if any item in "You may have something similar" has neither a substitute picked nor a check, list those items and ask the user to resolve them before finishing.

## Phase 3: Receipt scanning for pantry updates

### Flow

1. From the pantry screen, the user photographs a receipt or uploads a digital receipt (image, PDF, or pasted email text).
2. The Anthropic API (same setup as recipe ingestion) extracts each line item, quantity, and any weight or size.
3. Each line is matched to a canonical ingredient through a product alias table that maps receipt text (for example "MORTON SALT" or "CHKN BRST BNLS") to an ingredient and package size.
4. Sufra compares the results against the open shopping list and checks off every matching item.
5. A review screen shows all matches, highlighting only new or low-confidence lines for the user to confirm or correct.
6. On confirm, measured items increase by the amounts actually purchased, status-tracked items are set to "have it," each item records its purchase date, and any product the user confirmed is saved to the alias table with its size so future receipts need no input for it.

The first time a packaged product appears, the user confirms what it is and its size. Produce sold by weight uses the printed weight. Multiples like "2 @ 3.99" count as two packages.

### Secondary entry methods

1. Quick text entry: the user types or dictates a list like "2 lb chicken, bag of rice, 3 onions, olive oil," which is parsed into the same review screen.
2. Manual shopping list check-off: tapping an item opens a prompt asking how much was bought, prefilled with the usual purchase size for that ingredient. The pantry increases by the amount bought, which can differ from the amount the list needed. Changing the number updates the usual size for next time. For an ingredient with no usual size yet, offer a few common sizes to pick from. Status-tracked items skip the prompt and are set to "have it."

## Phase 4: Recipe editing and photos

### Editing

Every saved recipe gets an Edit button that opens the recipe form with all fields editable: name, author, category, cuisine, servings, times, ingredients (add, remove, reorder, change amounts and units), steps (add, remove, reorder), tags, source link, and photo. On save, re-match ingredient lines to canonical ingredients. Existing meal plans that include the recipe use the updated version.

### Photos when none is uploaded

Replace the current shared placeholder image. When a recipe is saved without a photo, search a free stock photo API (Pexels or Unsplash) using the recipe name and cuisine. Use Claude vision to rank the top results by how well they match the dish, then set the best match as the photo and show up to six alternatives the user can swap to, along with options to search with different words or upload their own. Save the chosen image to Supabase Storage and store the photographer attribution the API requires, shown in small text on the recipe page. Backfill every existing recipe currently using the placeholder.

## Phase 5: What can I make

Compare every recipe in the library against the pantry, using the Phase 1 base unit math, and show:

1. Can make now: every ingredient is covered by the pantry.
2. Near misses: missing only one or two ingredients, with a one-tap button to add the missing items to the grocery list.
3. Use it up ranking: recipes that use ingredients that have been in the pantry longest (based on purchase date) rank higher within each group.
4. Claude suggestions: the user can ask Claude for dishes outside the library and save any suggestion as a new recipe through the existing ingestion flow.

### Suggestion prompt

The suggestions screen has a free-text box where the user describes what they want ("a dessert for a family gathering," "a quick weeknight soup," "something with the chicken I have"), plus quick-pick chips for dessert, breakfast, lunch, dinner, soup, baked goods, snack, and drinks. Add optional controls for how many servings, maximum total time, and whether to stick to the pantry, allow a few items to buy, or ignore the pantry entirely.

Use the current Claude Sonnet model with a system prompt that asks for the kind of recipe a skilled home cook would recommend in conversation: a short note on why the dish works, exact amounts, clear steps, and practical tips such as make-ahead options or what to watch for. Every suggestion must be halal (no pork, no alcohol in any form, including wine, beer, or alcohol-based extracts, even when cooked off, and no gelatin unless it's halal or plant-based). Include in the prompt the user's cuisine preferences inferred from their library and the names of recipes they've rated highly, so suggestions match their taste. Enable the Anthropic web search tool so Claude can draw on well-tested published recipes, and keep the source link when a suggestion is based on one. Show three suggestions at a time with a button for more, and let the user refine with a follow-up message ("less sweet," "no oven") without starting over.

Add a simple rating (thumbs up or a heart) to every recipe in the library so the suggestion prompt knows which recipes the user loves.

Status-tracked items marked "have it" or "running low" count as available, and items marked "out" count as missing. Water and anything on an editable always-available list never block a match.

## Done when

1. The keep-alive cron is deployed and runs on schedule.
2. Two recipes using the same ingredient in different units produce one combined grocery list line in purchase units.
3. Recipes display as entered with fractions for cups and spoons, the pantry shows cooking units or status, and the shopping list shows whole packages.
4. Cooking a recipe deducts measured ingredients only and offers quick status updates for status-tracked ones.
5. Generating a grocery list opens the review screen with all four sections, substitutes can be picked from the pantry, and OK produces the final shopping list from checked items.
6. A receipt photo updates the pantry with purchased amounts and checks off matching shopping list items, asking only about new or uncertain lines.
7. Checking off an item manually adds the amount actually bought.
8. Recipes can be edited, and recipes without uploaded photos get a matching photo with alternatives to choose from.
9. The what can I make view shows all four parts and its near-miss button adds items to the grocery list.
10. The suggestion prompt accepts free text and recipe-type chips, returns halal suggestions shaped by rated recipes, and supports follow-up refinements.
