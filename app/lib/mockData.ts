import type { Recipe } from './types';

export const MOCK_RECIPES: Recipe[] = [
  {
    id: 'chicken-biryani',
    name: 'Chicken Biryani',
    author: 'Samira Aunty',
    category: 'meat',
    cuisine: 'Pakistani',
    servings_yield: 6,
    total_time_min: 90,
    image_path: 'https://images.unsplash.com/photo-1633945274405-b6c8b0050ea1?auto=format&fit=crop&w=1200&q=80',
    tags: ['family', 'weekend', 'festive'],
    ingredients: [
      { quantity: 2,    unit: 'lb',   name: 'chicken thighs, bone-in' },
      { quantity: 3,    unit: 'cup',  name: 'basmati rice, soaked 30 min' },
      { quantity: 2,    unit: null,   name: 'yellow onions, thinly sliced' },
      { quantity: 1,    unit: 'cup',  name: 'plain yogurt' },
      { quantity: 4,    unit: null,   name: 'garlic cloves, crushed' },
      { quantity: 1,    unit: 'tbsp', name: 'ginger, grated' },
      { quantity: 2,    unit: 'tsp',  name: 'garam masala' },
      { quantity: 1,    unit: 'tsp',  name: 'turmeric' },
      { quantity: 1,    unit: 'tsp',  name: 'red chili powder' },
      { quantity: 1,    unit: 'pinch', name: 'saffron, soaked in warm milk' },
      { quantity: 1,    unit: 'bunch', name: 'cilantro and mint, chopped' }
    ],
    steps: [
      'Marinate the chicken with yogurt, ginger, garlic, garam masala, turmeric, and chili powder for at least 1 hour.',
      'Fry the sliced onions in oil until deeply golden. Reserve half for the layering.',
      'Cook the marinated chicken in the remaining onion oil over medium heat until tender, about 25 minutes.',
      'Parboil the soaked rice in salted water with whole spices until 70 percent cooked. Drain.',
      'Layer rice over the chicken, top with fried onions, saffron milk, cilantro, and mint.',
      'Cover tightly, place on lowest heat, and steam (dum) for 20 minutes. Rest 10 minutes before serving.'
    ],
    notes: 'Best with raita and kachumber salad. Saffron milk goes only on top, not mixed in.'
  },
  {
    id: 'mujadara',
    name: 'Mujadara',
    author: 'Personal',
    category: 'vegetarian',
    cuisine: 'Levantine',
    servings_yield: 4,
    total_time_min: 60,
    image_path: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=1200&q=80',
    tags: ['weeknight', 'pantry'],
    ingredients: [
      { quantity: 1,    unit: 'cup',  name: 'brown lentils, rinsed' },
      { quantity: 1,    unit: 'cup',  name: 'long-grain rice, rinsed' },
      { quantity: 3,    unit: null,   name: 'large onions, thinly sliced' },
      { quantity: 1,    unit: 'tsp',  name: 'ground cumin' },
      { quantity: 0.5,  unit: 'cup',  name: 'olive oil' },
      { quantity: 1,    unit: 'tsp',  name: 'salt' }
    ],
    steps: [
      'Cook the lentils in 3 cups of water until just tender, about 20 minutes. Reserve cooking liquid.',
      'In a deep skillet, fry the onions in olive oil over medium-low heat for 25 to 30 minutes until very dark brown and crisp.',
      'Remove two thirds of the onions and set aside on paper towels.',
      'To the remaining onions, add the rice, lentils, cumin, salt, and 2 cups of the reserved lentil liquid.',
      'Cover and cook on low for 18 minutes. Rest off heat for 10 minutes.',
      'Fluff and top with the reserved crispy onions.'
    ],
    source_url: 'https://example.com/mujadara'
  },
  {
    id: 'salmon-zaatar',
    name: "Za'atar Roasted Salmon",
    author: 'Sohla El-Waylly',
    author_handle: '@sohlae',
    category: 'meat',
    cuisine: 'Mediterranean',
    servings_yield: 4,
    total_time_min: 25,
    image_path: 'https://images.unsplash.com/photo-1485921325833-c519f76c4927?auto=format&fit=crop&w=1200&q=80',
    tags: ['quick', 'weeknight', 'healthy'],
    ingredients: [
      { quantity: 1.5,  unit: 'lb',   name: 'salmon fillet, skin on' },
      { quantity: 2,    unit: 'tbsp', name: "za'atar" },
      { quantity: 2,    unit: 'tbsp', name: 'olive oil' },
      { quantity: 1,    unit: null,   name: 'lemon, half juiced, half sliced' },
      { quantity: 0.5,  unit: 'tsp',  name: 'flaky sea salt' }
    ],
    steps: [
      'Heat the oven to 425°F.',
      "Pat the salmon dry. Rub with olive oil, then press the za'atar evenly across the top.",
      'Place lemon slices around the fish. Roast for 12 to 14 minutes until just opaque at the center.',
      'Finish with lemon juice and flaky salt. Serve immediately.'
    ],
    source_url: 'https://nytcooking.com/example'
  },
  {
    id: 'olive-oil-cake',
    name: 'Olive Oil & Citrus Cake',
    author: 'Claire Saffitz',
    author_handle: '@csaffitz',
    category: 'baked_goods',
    cuisine: 'Mediterranean',
    servings_yield: 8,
    total_time_min: 75,
    image_path: 'https://images.unsplash.com/photo-1565958011703-44f9829ba187?auto=format&fit=crop&w=1200&q=80',
    tags: ['baking', 'dessert-adjacent'],
    ingredients: [
      { quantity: 1.25, unit: 'cup',  name: 'all-purpose flour' },
      { quantity: 1,    unit: 'cup',  name: 'granulated sugar' },
      { quantity: 0.75, unit: 'cup',  name: 'extra virgin olive oil' },
      { quantity: 3,    unit: null,   name: 'large eggs' },
      { quantity: 1,    unit: null,   name: 'orange, zested and juiced' },
      { quantity: 1,    unit: 'tsp',  name: 'baking powder' },
      { quantity: 0.5,  unit: 'tsp',  name: 'fine salt' }
    ],
    steps: [
      'Heat the oven to 350°F. Grease a 9-inch round pan and line with parchment.',
      'Whisk eggs and sugar until pale and thick, about 3 minutes.',
      'Slowly stream in the olive oil while whisking. Whisk in orange zest and juice.',
      'Fold in the flour, baking powder, and salt until just combined.',
      'Bake 40 to 45 minutes until a toothpick comes out clean. Cool in the pan 15 minutes before turning out.'
    ],
    source_url: 'https://example.com/olive-oil-cake'
  },
  {
    id: 'kunafa',
    name: 'Kunafa Nabulsiyya',
    author: 'Mom',
    category: 'desserts',
    cuisine: 'Levantine',
    servings_yield: 10,
    total_time_min: 50,
    image_path: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=1200&q=80',
    tags: ['festive', 'eid'],
    ingredients: [
      { quantity: 1,    unit: 'lb',   name: 'kataifi (shredded phyllo), thawed' },
      { quantity: 0.75, unit: 'cup',  name: 'unsalted butter, melted' },
      { quantity: 1,    unit: 'lb',   name: 'akkawi cheese, soaked and drained' },
      { quantity: 1.5,  unit: 'cup',  name: 'sugar' },
      { quantity: 0.75, unit: 'cup',  name: 'water' },
      { quantity: 1,    unit: 'tsp',  name: 'lemon juice' },
      { quantity: 1,    unit: 'tsp',  name: 'orange blossom water' },
      { quantity: 2,    unit: 'tbsp', name: 'crushed pistachios' }
    ],
    steps: [
      'Make the syrup: simmer sugar, water, and lemon juice for 10 minutes. Stir in orange blossom water. Cool completely.',
      'Pulse the kataifi in a food processor until fine. Toss thoroughly with melted butter.',
      'Press half the kataifi into a buttered 12-inch round pan. Layer the drained cheese. Top with remaining kataifi.',
      'Bake at 400°F for 30 to 35 minutes until deeply golden underneath.',
      'Invert onto a serving platter. Pour cooled syrup evenly over the hot kunafa. Garnish with pistachios.'
    ],
    notes: 'Use Nabulsi if you can find it. Soak the cheese twice if it tastes salty.'
  },
  {
    id: 'qahwa',
    name: 'Arabic Qahwa with Cardamom',
    author: 'Personal',
    category: 'drinks',
    cuisine: 'Levantine',
    servings_yield: 4,
    total_time_min: 10,
    image_path: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1200&q=80',
    tags: ['morning', 'guests'],
    ingredients: [
      { quantity: 4,    unit: 'cup',  name: 'water' },
      { quantity: 4,    unit: 'tbsp', name: 'finely ground Arabic coffee' },
      { quantity: 6,    unit: null,   name: 'cardamom pods, crushed' },
      { quantity: 1,    unit: 'pinch', name: 'saffron threads (optional)' }
    ],
    steps: [
      'Bring water to a boil in a small pot.',
      'Stir in the coffee and cardamom. Reduce heat and simmer uncovered for 5 minutes.',
      'Add saffron in the final minute if using.',
      'Pour through a fine strainer into small cups. Serve with dates.'
    ]
  },
  {
    id: 'shawarma',
    name: 'Chicken Shawarma',
    author: 'Mom',
    category: 'meat',
    cuisine: 'Levantine',
    servings_yield: 4,
    total_time_min: 40,
    image_path: 'https://images.unsplash.com/photo-1633321702518-7feccafb94d5?auto=format&fit=crop&w=1200&q=80',
    tags: ['weeknight', 'family'],
    ingredients: [
      { quantity: 2,    unit: 'lb',   name: 'boneless chicken thighs' },
      { quantity: 3,    unit: 'tbsp', name: 'olive oil' },
      { quantity: 1,    unit: 'tbsp', name: 'shawarma spice mix' },
      { quantity: 1,    unit: 'tbsp', name: 'lemon juice' },
      { quantity: 3,    unit: null,   name: 'garlic cloves, crushed' },
      { quantity: 1,    unit: 'tsp',  name: 'salt' }
    ],
    steps: [
      'Mix oil, spices, lemon, garlic, and salt. Coat the chicken and marinate for at least 2 hours.',
      'Heat a heavy skillet over medium-high. Sear the chicken in a single layer until charred at the edges, about 6 minutes per side.',
      'Rest 5 minutes, then slice thinly against the grain.',
      'Serve with garlic toum, pickles, and warm pita.'
    ]
  },
  {
    id: 'banana-bread',
    name: 'Tahini Banana Bread',
    author: '@halfbakedharvest',
    author_handle: '@halfbakedharvest',
    category: 'baked_goods',
    cuisine: 'American',
    servings_yield: 8,
    total_time_min: 70,
    image_path: 'https://images.unsplash.com/photo-1606101205445-bbb1be17ee85?auto=format&fit=crop&w=1200&q=80',
    tags: ['breakfast', 'snack'],
    ingredients: [
      { quantity: 3,    unit: null,   name: 'very ripe bananas, mashed' },
      { quantity: 0.5,  unit: 'cup',  name: 'tahini' },
      { quantity: 0.5,  unit: 'cup',  name: 'brown sugar' },
      { quantity: 2,    unit: null,   name: 'large eggs' },
      { quantity: 1.5,  unit: 'cup',  name: 'all-purpose flour' },
      { quantity: 1,    unit: 'tsp',  name: 'baking soda' },
      { quantity: 0.5,  unit: 'tsp',  name: 'salt' },
      { quantity: 0.25, unit: 'cup',  name: 'sesame seeds' }
    ],
    steps: [
      'Heat oven to 350°F. Grease a 9x5 loaf pan.',
      'Whisk bananas, tahini, brown sugar, and eggs until smooth.',
      'Fold in flour, baking soda, and salt. Pour into the pan and top with sesame seeds.',
      'Bake 55 to 60 minutes until a skewer comes out clean. Cool in the pan 15 minutes.'
    ],
    source_url: 'https://halfbakedharvest.com/example'
  }
];

export function getRecipeById(id: string): Recipe | undefined {
  return MOCK_RECIPES.find(r => r.id === id);
}

export function getAllCuisines(): string[] {
  return Array.from(new Set(MOCK_RECIPES.map(r => r.cuisine))).sort();
}

export function getAllAuthors(): string[] {
  return Array.from(new Set(MOCK_RECIPES.map(r => r.author))).sort();
}
