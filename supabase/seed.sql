-- =============================================================================
-- SUFRA — SUPPLEMENTARY SCHEMA
-- Run this AFTER schema.sql. Adds the email-lookup RPC and seeds common
-- ingredients with their aliases so the ingester has a head start.
-- =============================================================================

-- =============================================================================
-- RPC: get_user_id_by_email
-- Looks up a user by email for sharing. Marked SECURITY DEFINER so it can read
-- the auth.users table, but only returns the UUID (no other PII).
-- =============================================================================

create or replace function public.get_user_id_by_email(email_input text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result uuid;
begin
  select id into result
  from auth.users
  where lower(email) = lower(email_input)
  limit 1;
  return result;
end;
$$;

grant execute on function public.get_user_id_by_email(text) to authenticated;

-- =============================================================================
-- SEED CANONICAL INGREDIENTS
-- Common cooking ingredients with their categories and typical units.
-- =============================================================================

insert into ingredients (canonical_name, category, default_unit, shelf_life_days, density_g_per_ml) values
  ('salt',              'spice',     'tsp',  null, 1.20),
  ('black pepper',      'spice',     'tsp',  null, 0.50),
  ('cumin',             'spice',     'tsp',  730,  0.45),
  ('coriander',         'spice',     'tsp',  730,  0.40),
  ('turmeric',          'spice',     'tsp',  730,  0.50),
  ('garam masala',      'spice',     'tsp',  365,  0.40),
  ('red chili powder',  'spice',     'tsp',  365,  0.50),
  ('paprika',           'spice',     'tsp',  730,  0.45),
  ('cinnamon',          'spice',     'tsp',  730,  0.50),
  ('cardamom',          'spice',     'tsp',  730,  0.45),
  ('saffron',           'spice',     'pinch',730,  null),
  ('za''atar',          'spice',     'tsp',  365,  0.35),
  ('sumac',             'spice',     'tsp',  730,  0.40),
  ('garlic',            'produce',   null,   30,   null),
  ('ginger',            'produce',   null,   30,   null),
  ('onion',             'produce',   null,   30,   null),
  ('tomato',            'produce',   null,   7,    null),
  ('cilantro',          'produce',   'bunch',7,    null),
  ('mint',              'produce',   'bunch',7,    null),
  ('parsley',           'produce',   'bunch',7,    null),
  ('lemon',             'produce',   null,   21,   null),
  ('olive oil',         'pantry',    'tbsp', 540,  0.92),
  ('vegetable oil',     'pantry',    'tbsp', 365,  0.92),
  ('basmati rice',      'grain',     'cup',  730,  null),
  ('white rice',        'grain',     'cup',  730,  null),
  ('all-purpose flour', 'grain',     'cup',  365,  0.55),
  ('brown lentils',     'pantry',    'cup',  730,  null),
  ('chickpeas',         'pantry',    'cup',  730,  null),
  ('chicken thighs',    'protein',   'lb',   3,    null),
  ('chicken breast',    'protein',   'lb',   3,    null),
  ('ground beef',       'protein',   'lb',   3,    null),
  ('salmon',            'protein',   'lb',   2,    null),
  ('eggs',              'protein',   null,   30,   null),
  ('yogurt',            'dairy',     'cup',  14,   null),
  ('butter',            'dairy',     'tbsp', 90,   0.91),
  ('milk',              'dairy',     'cup',  10,   1.03),
  ('sugar',             'pantry',    'cup',  null, 0.85),
  ('brown sugar',       'pantry',    'cup',  730,  0.85),
  ('baking powder',     'pantry',    'tsp',  365,  0.90),
  ('baking soda',       'pantry',    'tsp',  730,  2.20),
  ('vanilla extract',   'pantry',    'tsp',  null, null),
  ('tahini',            'condiment', 'tbsp', 365,  1.10)
on conflict (canonical_name) do nothing;

-- =============================================================================
-- SEED ALIASES
-- Common variants that should map back to the canonical entry.
-- =============================================================================

insert into ingredient_aliases (ingredient_id, alias)
select id, alias from (
  select i.id, unnest(a.aliases) as alias
  from ingredients i
  join (values
    ('olive oil',         array['evoo','extra virgin olive oil','extra-virgin olive oil','e.v.o.o.']),
    ('garlic',            array['garlic clove','garlic cloves','minced garlic']),
    ('ginger',            array['fresh ginger','ginger root','grated ginger']),
    ('onion',             array['yellow onion','white onion','onions','yellow onions']),
    ('cilantro',          array['coriander leaves','fresh coriander','dhania']),
    ('all-purpose flour', array['ap flour','plain flour','flour']),
    ('chicken thighs',    array['boneless chicken thighs','bone-in chicken thighs']),
    ('eggs',              array['large eggs','egg']),
    ('za''atar',          array['zaatar','za atar']),
    ('cumin',             array['ground cumin','cumin powder']),
    ('turmeric',          array['ground turmeric','haldi']),
    ('garam masala',      array['garam masaala']),
    ('red chili powder',  array['chili powder','lal mirch','cayenne']),
    ('vegetable oil',     array['neutral oil','canola oil','sunflower oil']),
    ('basmati rice',      array['long-grain rice','long grain rice'])
  ) as a(canonical, aliases) on lower(i.canonical_name) = lower(a.canonical)
) sub
on conflict do nothing;
