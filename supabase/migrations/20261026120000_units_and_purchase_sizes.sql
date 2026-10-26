-- =============================================================================
-- PHASE 1: base units, container sizes, purchase sizes.
--
-- All math (aggregation, pantry deduction, pantry comparison) converts amounts
-- into one base unit per ingredient: grams, or a count for countable items.
-- Recipes keep their stored units untouched; these tables only describe how to
-- convert them.
--
-- Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- INGREDIENTS: base unit + purchase defaults
-- -----------------------------------------------------------------------------

alter table ingredients add column if not exists base_unit       text not null default 'g';
alter table ingredients add column if not exists count_unit      text;     -- what one count is called: 'clove', 'bunch'; null = each
alter table ingredients add column if not exists grams_per_count numeric;  -- weight of one item, bridges count <-> weight
alter table ingredients add column if not exists purchase_unit   text;     -- 'bag', 'can', 'bottle'; null = buy by weight / count
alter table ingredients add column if not exists purchase_size   numeric;  -- base amount (g or count) in one purchase unit
alter table ingredients add column if not exists purchase_label  text;     -- '1 kg', '500 ml', shown next to the package

do $$ begin
  alter table ingredients add constraint ingredients_base_unit_check check (base_unit in ('g', 'count'));
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- INGREDIENT_CONVERSIONS: "1 <unit> of <ingredient> = base_per_unit base units"
-- Rows with user_id null are standard (recipe container sizes like a can of
-- chickpeas). Rows with a user_id are sizes that user supplied when a
-- conversion was missing, and override the standard row.
-- Special keys: 'ml' (base per ml, a density for any volume unit), 'g' (base
-- per gram, for count ingredients measured by weight), 'each' (base per item).
-- -----------------------------------------------------------------------------

create table if not exists ingredient_conversions (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references auth.users(id) on delete cascade,
  ingredient_id   uuid not null references ingredients(id) on delete cascade,
  unit            text not null,
  base_per_unit   numeric not null check (base_per_unit > 0),
  created_at      timestamptz not null default now()
);

create unique index if not exists ic_standard_uniq on ingredient_conversions (ingredient_id, unit) where user_id is null;
create unique index if not exists ic_user_uniq     on ingredient_conversions (user_id, ingredient_id, unit) where user_id is not null;

alter table ingredient_conversions enable row level security;

drop policy if exists "conversions: read standard and own" on ingredient_conversions;
create policy "conversions: read standard and own"
  on ingredient_conversions for select
  to authenticated
  using (user_id is null or user_id = auth.uid());

drop policy if exists "conversions: owner writes" on ingredient_conversions;
create policy "conversions: owner writes"
  on ingredient_conversions for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- USER_PURCHASE_SIZES: what this user actually buys. Kept apart from recipe
-- container sizes so a recipe's "1 can" stays accurate when the user buys a
-- bigger can.
-- -----------------------------------------------------------------------------

create table if not exists user_purchase_sizes (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  ingredient_id   uuid not null references ingredients(id) on delete cascade,
  unit            text not null,
  size            numeric not null check (size > 0),  -- base amount per unit
  label           text,
  updated_at      timestamptz not null default now(),
  unique (user_id, ingredient_id)
);

alter table user_purchase_sizes enable row level security;

drop policy if exists "purchase sizes: owner only" on user_purchase_sizes;
create policy "purchase sizes: owner only"
  on user_purchase_sizes for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- RECIPE_INGREDIENTS: the name as written, so a recipe displays "fine sea salt"
-- even when it maps to the canonical "salt".
-- -----------------------------------------------------------------------------

alter table recipe_ingredients add column if not exists display_name text;

-- -----------------------------------------------------------------------------
-- SHOPPING_ITEMS: amounts are now stored in the ingredient's base unit.
-- gross_base is the need before pantry subtraction (so a later conversion can
-- recompute), unresolved holds parts with no known conversion yet,
-- e.g. [{"quantity": 1, "unit": "can"}].
-- -----------------------------------------------------------------------------

alter table shopping_items add column if not exists gross_base numeric;
alter table shopping_items add column if not exists unresolved jsonb not null default '[]'::jsonb;

-- -----------------------------------------------------------------------------
-- PANTRY: purchase date of the oldest stock still on hand.
-- -----------------------------------------------------------------------------

alter table pantry add column if not exists purchased_at date;

-- Writes that the app now makes on ingredients it created (Claude fills base
-- unit, density and purchase size for new ingredients).
drop policy if exists "ingredients updatable by authenticated" on ingredients;
create policy "ingredients updatable by authenticated"
  on ingredients for update
  to authenticated
  using (true)
  with check (true);

-- =============================================================================
-- SEED DATA
-- =============================================================================

insert into ingredients (canonical_name, category, default_unit, shelf_life_days) values
  ('kosher salt',              'spice',   'tsp',  null),
  ('sweetened condensed milk', 'dairy',   null,   365),
  ('evaporated milk',          'dairy',   null,   365),
  ('black beans',              'pantry',  null,   730),
  ('kidney beans',             'pantry',  null,   730),
  ('cannellini beans',         'pantry',  null,   730),
  ('pinto beans',              'pantry',  null,   730),
  ('diced tomatoes',           'pantry',  null,   730),
  ('coconut milk',             'pantry',  null,   730),
  ('tomato paste',             'pantry',  'tbsp', 730),
  ('water',                    'other',   'cup',  null)
on conflict (canonical_name) do nothing;

-- base_unit, count_unit, density, grams_per_count, purchase unit/size/label.
-- Density only fills where currently null so manual values survive.
update ingredients i set
  base_unit        = d.base_unit,
  count_unit       = coalesce(i.count_unit, d.count_unit),
  density_g_per_ml = coalesce(i.density_g_per_ml, d.density),
  grams_per_count  = coalesce(i.grams_per_count, d.gpc),
  purchase_unit    = coalesce(i.purchase_unit, d.p_unit),
  purchase_size    = coalesce(i.purchase_size, d.p_size),
  purchase_label   = coalesce(i.purchase_label, d.p_label)
from (values
  -- name                      base     count_unit density gpc   p_unit     p_size  p_label
  ('salt',                     'g',     null,      1.20,   null, 'bag',     1000,   '1 kg'),
  ('kosher salt',              'g',     null,      0.54,   null, 'box',     1361,   '3 lb'),
  ('black pepper',             'g',     null,      0.50,   null, 'jar',     56,     '2 oz'),
  ('cumin',                    'g',     null,      0.45,   null, 'jar',     56,     '2 oz'),
  ('coriander',                'g',     null,      0.40,   null, 'jar',     56,     '2 oz'),
  ('turmeric',                 'g',     null,      0.50,   null, 'jar',     56,     '2 oz'),
  ('garam masala',             'g',     null,      0.40,   null, 'jar',     56,     '2 oz'),
  ('red chili powder',         'g',     null,      0.50,   null, 'jar',     56,     '2 oz'),
  ('paprika',                  'g',     null,      0.45,   null, 'jar',     56,     '2 oz'),
  ('cinnamon',                 'g',     null,      0.50,   null, 'jar',     56,     '2 oz'),
  ('cardamom',                 'g',     null,      0.45,   null, 'jar',     56,     '2 oz'),
  ('za''atar',                 'g',     null,      0.35,   null, 'jar',     56,     '2 oz'),
  ('sumac',                    'g',     null,      0.40,   null, 'jar',     56,     '2 oz'),
  ('saffron',                  'g',     null,      null,   null, 'jar',     1,      '1 g'),
  ('garlic',                   'count', 'clove',   null,   5,    'head',    10,     null),
  ('ginger',                   'g',     null,      null,   50,   null,      null,   null),
  ('onion',                    'count', null,      null,   150,  null,      null,   null),
  ('tomato',                   'count', null,      null,   120,  null,      null,   null),
  ('cilantro',                 'count', 'bunch',   null,   60,   null,      null,   null),
  ('mint',                     'count', 'bunch',   null,   30,   null,      null,   null),
  ('parsley',                  'count', 'bunch',   null,   60,   null,      null,   null),
  ('lemon',                    'count', null,      null,   100,  null,      null,   null),
  ('olive oil',                'g',     null,      0.92,   null, 'bottle',  460,    '500 ml'),
  ('vegetable oil',            'g',     null,      0.92,   null, 'bottle',  1306,   '48 fl oz'),
  ('basmati rice',             'g',     null,      0.85,   null, 'bag',     907,    '2 lb'),
  ('white rice',               'g',     null,      0.85,   null, 'bag',     907,    '2 lb'),
  ('all-purpose flour',        'g',     null,      0.55,   null, 'bag',     2268,   '5 lb'),
  ('brown lentils',            'g',     null,      0.82,   null, 'bag',     454,    '1 lb'),
  ('chickpeas',                'g',     null,      0.68,   null, 'can',     439,    '15.5 oz'),
  ('chicken thighs',           'g',     null,      null,   120,  null,      null,   null),
  ('chicken breast',           'g',     null,      null,   225,  null,      null,   null),
  ('ground beef',              'g',     null,      null,   null, null,      null,   null),
  ('salmon',                   'g',     null,      null,   170,  null,      null,   null),
  ('eggs',                     'count', null,      null,   50,   'carton',  12,     '12'),
  ('yogurt',                   'g',     null,      1.03,   null, 'tub',     907,    '32 oz'),
  ('butter',                   'g',     null,      0.91,   null, 'package', 454,    '1 lb'),
  ('milk',                     'g',     null,      1.03,   null, 'carton',  1951,   'half gallon'),
  ('sugar',                    'g',     null,      0.85,   null, 'bag',     1814,   '4 lb'),
  ('brown sugar',              'g',     null,      0.85,   null, 'bag',     907,    '2 lb'),
  ('baking powder',            'g',     null,      0.90,   null, 'can',     230,    '8.1 oz'),
  ('baking soda',              'g',     null,      2.20,   null, 'box',     454,    '1 lb'),
  ('vanilla extract',          'g',     null,      0.88,   null, 'bottle',  52,     '2 fl oz'),
  ('tahini',                   'g',     null,      1.10,   null, 'jar',     454,    '16 oz'),
  ('sweetened condensed milk', 'g',     null,      1.30,   null, 'can',     397,    '14 oz'),
  ('evaporated milk',          'g',     null,      1.07,   null, 'can',     379,    '12 fl oz'),
  ('black beans',              'g',     null,      0.68,   null, 'can',     425,    '15 oz'),
  ('kidney beans',             'g',     null,      0.68,   null, 'can',     425,    '15 oz'),
  ('cannellini beans',         'g',     null,      0.68,   null, 'can',     425,    '15 oz'),
  ('pinto beans',              'g',     null,      0.68,   null, 'can',     425,    '15 oz'),
  ('diced tomatoes',           'g',     null,      1.00,   null, 'can',     411,    '14.5 oz'),
  ('coconut milk',             'g',     null,      0.97,   null, 'can',     388,    '13.5 fl oz'),
  ('tomato paste',             'g',     null,      1.10,   null, 'can',     170,    '6 oz'),
  ('water',                    'g',     null,      1.00,   null, null,      null,   null)
) as d(name, base_unit, count_unit, density, gpc, p_unit, p_size, p_label)
where lower(i.canonical_name) = d.name;

-- Standard recipe container sizes (base units per container).
insert into ingredient_conversions (ingredient_id, unit, base_per_unit)
select i.id, c.unit, c.base
from ingredients i
join (values
  ('sweetened condensed milk', 'can',   397),
  ('evaporated milk',          'can',   379),
  ('chickpeas',                'can',   439),
  ('black beans',              'can',   425),
  ('kidney beans',             'can',   425),
  ('cannellini beans',         'can',   425),
  ('pinto beans',              'can',   425),
  ('diced tomatoes',           'can',   411),
  ('coconut milk',             'can',   388),
  ('tomato paste',             'can',   170),
  ('butter',                   'stick', 113),
  ('garlic',                   'head',  10),
  ('garlic',                   'ml',    0.2029),  -- minced: about 1 clove per tsp
  ('ginger',                   'inch',  15),
  ('saffron',                  'pinch', 0.05)
) as c(name, unit, base) on lower(i.canonical_name) = c.name
on conflict do nothing;

-- Aliases. Kosher salt stays its own ingredient (about half the weight of
-- table salt per teaspoon).
insert into ingredient_aliases (ingredient_id, alias)
select i.id, a.alias
from ingredients i
join (values
  ('salt',                     'table salt'),
  ('salt',                     'fine salt'),
  ('salt',                     'fine sea salt'),
  ('salt',                     'iodized salt'),
  ('kosher salt',              'diamond crystal kosher salt'),
  ('kosher salt',              'coarse kosher salt'),
  ('butter',                   'unsalted butter'),
  ('butter',                   'salted butter'),
  ('milk',                     'whole milk'),
  ('chickpeas',                'garbanzo beans'),
  ('chickpeas',                'canned chickpeas'),
  ('sweetened condensed milk', 'condensed milk'),
  ('diced tomatoes',           'canned diced tomatoes'),
  ('coconut milk',             'full-fat coconut milk'),
  ('coconut milk',             'canned coconut milk')
) as a(name, alias) on lower(i.canonical_name) = a.name
on conflict do nothing;

-- =============================================================================
-- REPAIR: ingredients created with the unit stuck in the name.
-- The link importer did not recognise plural units, so "2 teaspoons kosher
-- salt" was saved as an ingredient called "teaspoons kosher salt" with no unit.
-- Move those rows onto the real ingredient and restore the unit.
-- =============================================================================

do $$
declare
  bad record;
  clean_name text;
  unit_word text;
  unit_canon text;
  target uuid;
begin
  for bad in
    select id, canonical_name from ingredients
    where canonical_name ~* '^(teaspoons?|tablespoons?|cups|ounces?|pounds?|lbs|grams|kilograms?|liters?|litres?|milliliters?|cans?|tins?|sticks?|cloves|heads|packages?|pinches|bunches|quarts?|pints?)\s+\S'
  loop
    unit_word  := lower((regexp_match(bad.canonical_name, '^(\S+)\s+'))[1]);
    clean_name := trim(regexp_replace(bad.canonical_name, '^\S+\s+', ''));
    unit_canon := case
      when unit_word in ('teaspoon', 'teaspoons') then 'tsp'
      when unit_word in ('tablespoon', 'tablespoons') then 'tbsp'
      when unit_word = 'cups' then 'cup'
      when unit_word in ('ounce', 'ounces') then 'oz'
      when unit_word in ('pound', 'pounds', 'lbs') then 'lb'
      when unit_word = 'grams' then 'g'
      when unit_word in ('kilogram', 'kilograms') then 'kg'
      when unit_word in ('liter', 'liters', 'litre', 'litres') then 'l'
      when unit_word = 'milliliters' then 'ml'
      when unit_word in ('can', 'cans', 'tin', 'tins') then 'can'
      when unit_word in ('stick', 'sticks') then 'stick'
      when unit_word = 'cloves' then 'clove'
      when unit_word = 'heads' then 'head'
      when unit_word in ('package', 'packages') then 'package'
      when unit_word = 'pinches' then 'pinch'
      when unit_word = 'bunches' then 'bunch'
      when unit_word in ('quart', 'quarts') then 'quart'
      when unit_word in ('pint', 'pints') then 'pint'
    end;

    select ingredient_id into target from ingredient_aliases where lower(alias) = lower(clean_name) limit 1;
    if target is null then
      select id into target from ingredients where lower(canonical_name) = lower(clean_name) limit 1;
    end if;
    if target is null then
      insert into ingredients (canonical_name, category) values (lower(clean_name), 'other') returning id into target;
    end if;

    update recipe_ingredients
      set ingredient_id = target,
          unit          = coalesce(unit, unit_canon),
          display_name  = coalesce(display_name, clean_name)
      where ingredient_id = bad.id;

    update shopping_items set ingredient_id = target where ingredient_id = bad.id;

    -- Pantry rows move only when the user has no row for the target yet.
    update pantry p set ingredient_id = target
      where p.ingredient_id = bad.id
        and not exists (select 1 from pantry q where q.user_id = p.user_id and q.ingredient_id = target);

    update price_history set ingredient_id = target where ingredient_id = bad.id;

    if not exists (select 1 from recipe_ingredients where ingredient_id = bad.id)
       and not exists (select 1 from pantry where ingredient_id = bad.id)
       and not exists (select 1 from shopping_items where ingredient_id = bad.id) then
      delete from ingredients where id = bad.id;
    end if;

    target := null;
  end loop;
end $$;
