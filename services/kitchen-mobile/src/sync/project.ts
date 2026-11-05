import {
  KitchenError, MEALS, UNSORTED_SECTION, ingredientGroups, kitchenAction, parseDay, parseGroups,
  parseIngredientInput, parseLeftoverServings, parseLines, parseMeal, parseRecipeInput,
  parseRecipeUses, parseServings, parseStockAmount, requiredName, scaledLines, weekStart,
  type KitchenSnapshot, type KitchenSync, type RecipeLine, type RecipeLineInput,
} from "@tools-platform/service/kitchen-contract";
import type { OutboxItem, QueuedAction } from "./model";

type Reducers = {
  [Type in QueuedAction["type"]]: (
    kitchen: KitchenSnapshot, action: Extract<QueuedAction, { type: Type }>,
  ) => KitchenSnapshot;
};

function find<T extends { id: string }>(items: readonly T[], id: string): T {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new KitchenError("This item does not exist.", "not_found");
  return item;
}

function unusedId(items: readonly { id: string }[], id: string | undefined): string {
  if (!id || items.some((item) => item.id === id)) throw new KitchenError("This ID is already in use.", "conflict");
  return id;
}

function uniqueName(items: readonly { id: string; name: string }[], name: string, id?: string): void {
  if (items.some((item) => item.id !== id && item.name.toLowerCase() === name.toLowerCase())) {
    throw new KitchenError("This name is already in use.", "conflict");
  }
}

function linesFor(kitchen: KitchenSnapshot, lines: readonly RecipeLineInput[]): readonly RecipeLine[] {
  return lines.map((line) => {
    const ingredient = find(kitchen.ingredients, line.ingredientId);
    return { ...line, ingredient: ingredient.name, unit: ingredient.unit };
  });
}

function round(amount: number): number {
  return Math.round(amount * 1000) / 1000;
}

function stockAmount(kitchen: KitchenSnapshot, ingredientId: string, amount: number): KitchenSnapshot {
  const ingredient = find(kitchen.ingredients, ingredientId);
  return {
    ...kitchen,
    stock: [...kitchen.stock.filter((item) => item.ingredientId !== ingredientId), {
      ingredientId, ingredient: ingredient.name, unit: ingredient.unit, section: ingredient.section, amount,
    }].filter((item) => item.amount > 0),
  };
}

function derived(kitchen: KitchenSnapshot): KitchenSnapshot {
  return {
    ...kitchen,
    ingredients: kitchen.ingredients.map((ingredient) => ({
      ...ingredient,
      recipeCount: kitchen.recipes.filter((recipe) => recipe.lines.some((line) => line.ingredientId === ingredient.id)).length,
    })),
    recipes: kitchen.recipes.map((recipe) => ({ ...recipe, lines: linesFor(kitchen, recipe.lines) })),
    plan: kitchen.plan.map((entry) => {
      const recipe = find(kitchen.recipes, entry.recipeId);
      return {
        ...entry, recipe: recipe.name,
        lines: entry.custom ? linesFor(kitchen, entry.lines) : scaledLines({ ...recipe, lines: linesFor(kitchen, recipe.lines) }, entry.servings),
      };
    }),
    stock: kitchen.stock.filter((item) => item.amount > 0).map((item) => {
      const ingredient = find(kitchen.ingredients, item.ingredientId);
      return { ...item, ingredient: ingredient.name, unit: ingredient.unit, section: ingredient.section };
    }),
  };
}

const reducers = {
  "ingredient.save": (kitchen, action) => {
    const input = parseIngredientInput({ ...action, nutrition: {
      kcal: action.kcal, protein: action.protein, carbs: action.carbs, fat: action.fat,
    } });
    const uses = parseRecipeUses(action.addToRecipes ?? []);
    uniqueName(kitchen.ingredients, input.name, action.id);
    const current = action.id ? find(kitchen.ingredients, action.id) : undefined;
    const id = current?.id ?? unusedId(kitchen.ingredients, action.createId);
    for (const use of uses) {
      if (find(kitchen.recipes, use.recipeId).lines.some((line) => line.ingredientId === id)) {
        throw new KitchenError("This recipe already has the ingredient.", "conflict");
      }
    }
    const convert = current && current.unit !== input.unit && (
      current.recipeCount > 0 || kitchen.stock.some((item) => item.ingredientId === id && item.amount > 0)
      || kitchen.plan.some((entry) => entry.custom && entry.lines.some((line) => line.ingredientId === id))
    );
    if (convert && action.oldPerNew === undefined) throw new KitchenError("A unit conversion is required.");
    const convertLine = (line: RecipeLine): RecipeLine => convert && line.ingredientId === id
      ? { ...line, amount: Math.max(0.001, round(line.amount / action.oldPerNew!)) } : line;
    const groups = [...kitchen.kitchen.groups];
    for (const group of ingredientGroups(input)) {
      if (group !== UNSORTED_SECTION && !groups.includes(group)) groups.push(group);
    }
    return {
      ...kitchen,
      kitchen: { ...kitchen.kitchen, groups },
      ingredients: [...kitchen.ingredients.filter((item) => item.id !== id), { ...input, id, recipeCount: 0 }],
      recipes: kitchen.recipes.map((recipe) => {
        const use = uses.find((item) => item.recipeId === recipe.id);
        const lines = recipe.lines.map(convertLine);
        return { ...recipe, lines: use ? [...lines, { ingredientId: id, ingredient: input.name, unit: input.unit, amount: use.amount, note: "" }] : lines };
      }),
      plan: kitchen.plan.map((entry) => entry.custom ? { ...entry, lines: entry.lines.map(convertLine) } : entry),
      stock: kitchen.stock.map((item) => convert && item.ingredientId === id
        ? { ...item, amount: round(item.amount / action.oldPerNew!) } : item),
    };
  },
  "ingredient.delete": (kitchen, action) => {
    if (find(kitchen.ingredients, action.id).recipeCount) throw new KitchenError("Recipes still use this ingredient.", "conflict");
    return {
      ...kitchen,
      ingredients: kitchen.ingredients.filter((item) => item.id !== action.id),
      stock: kitchen.stock.filter((item) => item.ingredientId !== action.id),
      plan: kitchen.plan.map((entry) => ({ ...entry, lines: entry.lines.filter((line) => line.ingredientId !== action.id) })),
    };
  },
  "recipe.save": (kitchen, action) => {
    const input = parseRecipeInput(action);
    uniqueName(kitchen.recipes, input.name, action.id);
    const current = action.id ? find(kitchen.recipes, action.id) : undefined;
    const id = current?.id ?? unusedId(kitchen.recipes, action.createId);
    const recipe = { ...input, id, lines: linesFor(kitchen, input.lines), updatedAt: current?.updatedAt ?? "" };
    return { ...kitchen, recipes: [...kitchen.recipes.filter((item) => item.id !== id), recipe] };
  },
  "recipe.delete": (kitchen, action) => {
    find(kitchen.recipes, action.id);
    return { ...kitchen, recipes: kitchen.recipes.filter((item) => item.id !== action.id), plan: kitchen.plan.filter((entry) => entry.recipeId !== action.id) };
  },
  "plan.add": (kitchen, action) => {
    const recipe = find(kitchen.recipes, action.recipeId);
    const entry = {
      id: unusedId(kitchen.plan, action.createId), day: parseDay(action.day), meal: parseMeal(action.meal),
      recipeId: recipe.id, recipe: recipe.name, servings: parseServings(action.servings), cooked: false, custom: false, lines: [],
    };
    return { ...kitchen, plan: [...kitchen.plan, entry] };
  },
  "plan.update": (kitchen, action) => {
    const current = find(kitchen.plan, action.id);
    const day = parseDay(action.day);
    const meal = parseMeal(action.meal);
    const servings = parseServings(action.servings);
    return { ...kitchen, plan: kitchen.plan.map((entry) => entry.id === current.id ? {
      ...entry, day, meal, servings,
      lines: entry.custom ? scaledLines({ servings: entry.servings, lines: entry.lines }, servings) : entry.lines,
    } : entry) };
  },
  "plan.remove": (kitchen, action) => {
    find(kitchen.plan, action.id);
    return { ...kitchen, plan: kitchen.plan.filter((entry) => entry.id !== action.id) };
  },
  "plan.customize": (kitchen, action) => {
    const lines = linesFor(kitchen, parseLines(action.lines));
    if (find(kitchen.plan, action.id).cooked) throw new KitchenError("A cooked meal cannot change its ingredients.");
    return { ...kitchen, plan: kitchen.plan.map((entry) => entry.id === action.id ? { ...entry, custom: true, lines } : entry) };
  },
  "plan.reset": (kitchen, action) => {
    find(kitchen.plan, action.id);
    return { ...kitchen, plan: kitchen.plan.map((entry) => entry.id === action.id ? { ...entry, custom: false } : entry) };
  },
  "plan.cook": (kitchen, action) => {
    const entry = find(kitchen.plan, action.id);
    if (entry.cooked) throw new KitchenError("This meal is already cooked.");
    const leftover = action.leftover ? {
      id: action.leftover.createId ?? `local:leftover:${entry.id}`, name: requiredName(entry.recipe, "leftover"),
      servings: parseLeftoverServings(action.leftover.servings), useBy: parseDay(action.leftover.useBy),
    } : undefined;
    const amounts = new Map(entry.lines.map((line) => [line.ingredientId, line.amount]));
    return {
      ...kitchen,
      plan: kitchen.plan.map((item) => item.id === entry.id ? { ...item, cooked: true } : item),
      stock: kitchen.stock.map((item) => ({ ...item, amount: Math.max(0, item.amount - (amounts.get(item.ingredientId) ?? 0)) })),
      leftovers: leftover ? [...kitchen.leftovers, leftover] : kitchen.leftovers,
    };
  },
  "stock.set": (kitchen, action) => stockAmount(kitchen, action.ingredientId, parseStockAmount(action.amount)),
  "stock.add": (kitchen, action) => stockAmount(kitchen, action.ingredientId,
    (kitchen.stock.find((item) => item.ingredientId === action.ingredientId)?.amount ?? 0) + parseStockAmount(action.amount)),
  "leftover.add": (kitchen, action) => ({
    ...kitchen, leftovers: [...kitchen.leftovers, {
      id: unusedId(kitchen.leftovers, action.createId), name: requiredName(action.name, "leftover"),
      servings: parseLeftoverServings(action.servings), useBy: parseDay(action.useBy),
    }],
  }),
  "leftover.eat": (kitchen, action) => {
    const servings = find(kitchen.leftovers, action.id).servings - parseLeftoverServings(action.servings);
    return { ...kitchen, leftovers: kitchen.leftovers.map((item) => item.id === action.id ? { ...item, servings } : item).filter((item) => item.servings > 0.001) };
  },
  "leftover.remove": (kitchen, action) => ({ ...kitchen, leftovers: kitchen.leftovers.filter((item) => item.id !== action.id) }),
  "extra.add": (kitchen, action) => ({
    ...kitchen, extras: [...kitchen.extras, {
      id: unusedId(kitchen.extras, action.createId), name: requiredName(action.name, "item"),
      everyWeek: action.everyWeek ?? false, boughtWeek: null,
    }],
  }),
  "extra.mark": (kitchen, action) => {
    const extra = find(kitchen.extras, action.id);
    if (!extra.everyWeek) throw new KitchenError("This item is not an every-week item.");
    const week = weekStart(action.week);
    return { ...kitchen, extras: kitchen.extras.map((item) => item.id === action.id ? {
      ...item, boughtWeek: action.bought ? week : item.boughtWeek === week ? null : item.boughtWeek,
    } : item) };
  },
  "extra.remove": (kitchen, action) => ({ ...kitchen, extras: kitchen.extras.filter((item) => item.id !== action.id) }),
  "groups.set": (kitchen, action) => ({ ...kitchen, kitchen: { ...kitchen.kitchen, groups: parseGroups(action.groups) } }),
} satisfies Reducers;

function apply<Type extends QueuedAction["type"]>(kitchen: KitchenSnapshot, action: Extract<QueuedAction, { type: Type }>): KitchenSnapshot {
  const table: Reducers = reducers;
  return derived(table[action.type](kitchen, action));
}

const compare = (a: string, b: string): number => a.localeCompare(b);
const byName = (a: { name: string }, b: { name: string }): number => compare(a.name.toLowerCase(), b.name.toLowerCase());
const createdItems = {
  "ingredient.save": (kitchen: KitchenSnapshot) => kitchen.ingredients,
  "recipe.save": (kitchen: KitchenSnapshot) => kitchen.recipes,
  "plan.add": (kitchen: KitchenSnapshot) => kitchen.plan,
  "leftover.add": (kitchen: KitchenSnapshot) => kitchen.leftovers,
  "extra.add": (kitchen: KitchenSnapshot) => kitchen.extras,
};

export function project(snapshot: KitchenSync, outbox: readonly OutboxItem[]): KitchenSync {
  let kitchens = snapshot.kitchens;
  for (const item of [...outbox].sort((a, b) => a.seq - b.seq)) {
    const index = kitchens.findIndex((kitchen) => kitchen.kitchen.id === item.kitchenId);
    if (index === -1) continue;
    const parsed = kitchenAction.safeParse(item.action);
    if (!parsed.success || parsed.data.type === "recipe.copy") continue;
    if ("createId" in parsed.data && parsed.data.createId && !("id" in parsed.data && parsed.data.id)) {
      const items = createdItems[parsed.data.type];
      const createId = parsed.data.createId;
      if (kitchens.some((kitchen) => items(kitchen).some((existing) => existing.id === createId))) continue;
    }
    const action = {
      ...parsed.data,
      createId: ("createId" in parsed.data ? parsed.data.createId : undefined) ?? `local:${item.clientActionId}`,
    };
    try {
      const kitchen = apply(kitchens[index]!, action);
      kitchens = kitchens.map((current, position) => position === index ? kitchen : current);
    } catch (error) {
      if (!(error instanceof KitchenError)) throw error;
    }
  }
  return {
    ...snapshot,
    kitchens: kitchens.map((kitchen) => ({
      ...kitchen,
      ingredients: [...kitchen.ingredients].sort(byName),
      // The outbox has no server timestamp. New recipes use the snapshot day until sync.
      recipes: kitchen.recipes.map((recipe) => ({
        ...recipe, updatedAt: recipe.updatedAt || `${snapshot.today}T00:00:00.000Z`,
      })).sort(byName),
      plan: kitchen.plan.filter((entry) => entry.day >= snapshot.planFrom).sort((a, b) =>
        compare(a.day, b.day) || MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal)),
      stock: [...kitchen.stock].sort((a, b) => compare(a.section, b.section) || compare(a.ingredient.toLowerCase(), b.ingredient.toLowerCase())),
      leftovers: [...kitchen.leftovers].sort((a, b) => compare(a.useBy, b.useBy)),
    })),
  };
}
