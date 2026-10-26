/** One line on the receipt review screen. */
export type ReviewLine = {
  key: string;
  /** Text as printed on the receipt. Null for typed lists, which teach no product aliases. */
  raw_text: string | null;
  include: boolean;
  ingredient_name: string;
  packages: number;
  /** Size of one package. Null means a plain count (3 onions). */
  size_quantity: number | null;
  /** '' for a count. */
  size_unit: string;
  sold_by_weight: boolean;
  price: number | null;
  /** known: matched a product this user confirmed before. new: first time. uncertain: Claude guessed. */
  status: 'known' | 'new' | 'uncertain';
  /** True when this ingredient is unchecked on an open grocery list. */
  on_list: boolean;
};

export type ParsedReceipt = {
  store_name: string | null;
  purchased_on: string | null;
  lines: ReviewLine[];
};

export type ConfirmResult =
  | { ok: true; added: number; checkedOff: number }
  | { ok: false; problems: Record<string, string> };
