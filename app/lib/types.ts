export type Category = 'meat' | 'vegetarian' | 'baked_goods' | 'desserts' | 'drinks';

export const CATEGORY_LABEL: Record<Category, string> = {
  meat: 'Meat',
  vegetarian: 'Vegetarian',
  baked_goods: 'Baked Goods',
  desserts: 'Desserts',
  drinks: 'Drinks'
};

export type Ingredient = {
  quantity: number | null;
  unit: string | null;
  name: string;
  prep_note?: string;
};

export type Recipe = {
  id: string;
  name: string;
  author: string;
  author_handle?: string;
  category: Category;
  cuisine: string;
  servings_yield: number;
  total_time_min: number;
  source_url?: string;
  image_path: string | null;
  notes?: string;
  tags: string[];
  ingredients: Ingredient[];
  steps: string[];
};
