import { randomUUID } from "node:crypto";
import postgres, { type Sql, type TransactionSql } from "postgres";
import type { PlatformPrincipal } from "#security";
import {
  addDays,
  type ExtraItem,
  type Ingredient,
  type IngredientInput,
  type IngredientUnit,
  type Kitchen,
  KitchenError,
  type Leftover,
  type Meal,
  type PlanEntry,
  type Recipe,
  type RecipeInput,
  type RecipeLineInput,
  type ShoppingLine,
  type StockItem,
  ingredientGroups,
  parseIngredientInput,
  parseLines,
  parseDay,
  parseGroups,
  parseLeftoverServings,
  parseMeal,
  parseRecipeInput,
  parseServings,
  parseStockAmount,
  requiredName,
  scaledLines,
  shoppingList,
  UNSORTED_SECTION
} from "./domain.js";

type Db = Sql | TransactionSql;
type Who = Pick<PlatformPrincipal, "role" | "subject">;

export type KitchenWeek = Readonly<{ start: string; entries: readonly PlanEntry[] }>;
export type KitchenShopping = Readonly<{ start: string; lines: readonly ShoppingLine[]; extras: readonly ExtraItem[] }>;
export type KitchenPerson = Readonly<{ id: string; email: string }>;

export interface KitchenStore {
  /** Kitchens the person can open: every kitchen for the admin, their own kitchens for a member. */
  list(who: Who): Promise<readonly Kitchen[]>;
  /** Opens one kitchen, or fails with not_found when the person may not open it. */
  open(who: Who, kitchenId: string): Promise<KitchenScope>;
  /** Admin-only kitchen management. */
  admin(who: Who): KitchenAdmin;
  /** Copies a recipe and the ingredients it uses into another kitchen the person can open. */
  copyRecipe(who: Who, fromKitchenId: string, recipeId: string, toKitchenId: string): Promise<Recipe>;
  readiness(): Promise<void>;
  close(): Promise<void>;
}

export interface KitchenAdmin {
  create(name: string): Promise<Kitchen>;
  rename(kitchenId: string, name: string): Promise<Kitchen>;
  remove(kitchenId: string): Promise<void>;
  /** Adds an invited person and grants them Kitchen, so the kitchen opens for them at once. */
  addMember(kitchenId: string, personId: string): Promise<Kitchen>;
  removeMember(kitchenId: string, personId: string): Promise<Kitchen>;
  people(): Promise<readonly KitchenPerson[]>;
}

export interface KitchenScope {
  readonly kitchen: Kitchen;
  /** Sets the order of the ingredient groups. */
  setGroups(groups: readonly string[]): Promise<void>;
  ingredients(): Promise<readonly Ingredient[]>;
  /**
   * Creates or changes an ingredient. To change the unit of an ingredient that recipes or stock use, give
   * `oldPerNew`, how much of the old unit one new unit holds. Those amounts then change to the new unit.
   */
  saveIngredient(id: string | undefined, input: IngredientInput, oldPerNew?: number): Promise<Ingredient>;
  /** Finds an ingredient by name, ignoring case, or creates it with the given unit. */
  ingredientNamed(name: string, unit: IngredientUnit): Promise<Ingredient>;
  deleteIngredient(id: string): Promise<void>;
  recipes(): Promise<readonly Recipe[]>;
  recipe(id: string): Promise<Recipe>;
  saveRecipe(id: string | undefined, input: RecipeInput): Promise<Recipe>;
  deleteRecipe(id: string): Promise<void>;
  week(start: string): Promise<KitchenWeek>;
  plan(input: { day: string; meal: Meal; recipeId: string; servings: number }): Promise<PlanEntry>;
  updatePlan(id: string, input: { day: string; meal: Meal; servings: number }): Promise<PlanEntry>;
  removePlan(id: string): Promise<void>;
  /**
   * Gives one planned meal its own ingredients, for its current servings. The recipe stays as it is.
   * The shopping list and cooking then use these lines.
   */
  customizePlan(id: string, lines: readonly RecipeLineInput[]): Promise<PlanEntry>;
  /** Lets a planned meal use its recipe's ingredients again. */
  resetPlan(id: string): Promise<PlanEntry>;
  /** Marks a meal as cooked, takes its ingredients out of stock, and keeps any leftover servings. */
  cook(id: string, leftover: { servings: number; useBy: string } | undefined): Promise<void>;
  stock(): Promise<readonly StockItem[]>;
  setStock(ingredientId: string, amount: number): Promise<void>;
  /** Adds a bought amount to what is at home. */
  addStock(ingredientId: string, amount: number): Promise<void>;
  leftovers(): Promise<readonly Leftover[]>;
  addLeftover(input: { name: string; servings: number; useBy: string }): Promise<Leftover>;
  /** Eats some servings of a leftover. The leftover goes away when none remain. */
  eatLeftover(id: string, servings: number): Promise<void>;
  removeLeftover(id: string): Promise<void>;
  shopping(start: string): Promise<KitchenShopping>;
  addExtra(name: string, everyWeek?: boolean): Promise<ExtraItem>;
  /** Marks an every-week item as bought, or not bought, for the week that starts on `week`. */
  markExtra(id: string, week: string, bought: boolean): Promise<void>;
  removeExtra(id: string): Promise<void>;
}

type IngredientRow = { id: string; name: string; unit: IngredientUnit; section: string; other_groups: string[]; kcal: number | null; protein: number | null; carbs: number | null; fat: number | null; notes: string; recipe_count: number };
type RecipeRow = { id: string; name: string; servings: number; minutes: number | null; instructions: string; updated_at: Date };
type LineRow = { recipe_id: string; ingredient_id: string; ingredient: string; unit: IngredientUnit; amount: number; note: string };
type PlanRow = { id: string; day: string; meal: Meal; recipe_id: string; recipe: string; servings: number; custom_servings: number | null; cooked_at: Date | null };
type PlanLineRow = { entry_id: string; ingredient_id: string; ingredient: string; unit: IngredientUnit; amount: number; note: string; base: number; servings: number };

export function createPostgresKitchenStore(databaseUrl: string, options: { readOnly?: boolean } = {}): KitchenStore {
  return kitchenStore(postgres(databaseUrl, { max: 3, idle_timeout: 120, connection: options.readOnly ? { default_transaction_read_only: true } : undefined }));
}

export function kitchenStore(sql: Sql): KitchenStore {
  async function kitchensWhere(db: Db, filter: postgres.PendingQuery<postgres.Row[]>): Promise<Kitchen[]> {
    const rows = await db<{ id: string; name: string; groups: string[]; members: { personId: string; email: string }[] }[]>`
      select k.id, k.name, k.groups,
        coalesce(json_agg(json_build_object('personId', p.id, 'email', p.email) order by p.email) filter (where p.id is not null), '[]') members
      from tools.kitchens k
      left join tools.kitchen_members m on m.kitchen_id = k.id
      left join tools.people p on p.id = m.person_id
      where ${filter}
      group by k.id order by lower(k.name), k.created_at`;
    return rows.map((row) => ({ id: row.id, name: row.name, members: row.members, groups: row.groups }));
  }

  function visibleTo(who: Who) {
    return who.role === "admin"
      ? sql`true`
      : sql`k.id in (select m.kitchen_id from tools.kitchen_members m join tools.people p on p.id = m.person_id where p.google_subject = ${who.subject})`;
  }

  async function openKitchen(who: Who, kitchenId: string): Promise<Kitchen> {
    if (!isUuid(kitchenId)) throw new KitchenError("This kitchen does not exist.", "not_found");
    const [kitchen] = await kitchensWhere(sql, sql`k.id = ${kitchenId} and ${visibleTo(who)}`);
    if (!kitchen) throw new KitchenError("This kitchen does not exist.", "not_found");
    return kitchen;
  }

  return {
    list: (who) => kitchensWhere(sql, visibleTo(who)),
    async open(who, kitchenId) {
      return scope(sql, await openKitchen(who, kitchenId));
    },
    admin(who) {
      if (who.role !== "admin") throw new KitchenError("Only the admin can manage kitchens.", "forbidden");
      const one = async (kitchenId: string) => {
        const [kitchen] = await kitchensWhere(sql, sql`k.id = ${kitchenId}`);
        if (!kitchen) throw new KitchenError("This kitchen does not exist.", "not_found");
        return kitchen;
      };
      return {
        async create(name) {
          const id = randomUUID();
          await sql`insert into tools.kitchens (id, name, created_at) values (${id}, ${requiredName(name, "kitchen")}, now())`;
          return one(id);
        },
        async rename(kitchenId, name) {
          await one(kitchenId);
          await sql`update tools.kitchens set name = ${requiredName(name, "kitchen")} where id = ${kitchenId}`;
          return one(kitchenId);
        },
        async remove(kitchenId) {
          await one(kitchenId);
          await sql`delete from tools.kitchens where id = ${kitchenId}`;
        },
        async addMember(kitchenId, personId) {
          await one(kitchenId);
          if (!isUuid(personId)) throw new KitchenError("This person is not invited.", "not_found");
          await sql.begin(async (tx) => {
            const [person] = await tx`select id from tools.people where id = ${personId}`;
            if (!person) throw new KitchenError("This person is not invited.", "not_found");
            await tx`insert into tools.kitchen_members (kitchen_id, person_id, added_at) values (${kitchenId}, ${personId}, now()) on conflict do nothing`;
            await tx`insert into tools.product_grants (person_id, product_id, granted_at) values (${personId}, 'kitchen', now()) on conflict do nothing`;
          });
          return one(kitchenId);
        },
        async removeMember(kitchenId, personId) {
          await one(kitchenId);
          if (isUuid(personId)) await sql`delete from tools.kitchen_members where kitchen_id = ${kitchenId} and person_id = ${personId}`;
          return one(kitchenId);
        },
        async people() {
          return sql<KitchenPerson[]>`select id, email from tools.people order by email`;
        }
      };
    },
    async copyRecipe(who, fromKitchenId, recipeId, toKitchenId) {
      const from = scope(sql, await openKitchen(who, fromKitchenId));
      const target = await openKitchen(who, toKitchenId);
      if (target.id === from.kitchen.id) throw new KitchenError("Choose another kitchen.");
      const recipe = await from.recipe(recipeId);
      const ingredients = new Map((await from.ingredients()).map((ingredient) => [ingredient.id, ingredient]));
      return sql.begin(async (tx) => {
        const into = scope(tx, target);
        const lines = [];
        for (const line of recipe.lines) {
          const source = ingredients.get(line.ingredientId)!;
          const existing = await findIngredient(tx, target.id, source.name);
          const id = existing?.id ?? (await into.saveIngredient(undefined, source)).id;
          lines.push({ ingredientId: id, amount: line.amount, note: line.note });
        }
        const name = await freeRecipeName(tx, target.id, recipe.name);
        return into.saveRecipe(undefined, { ...recipe, name, lines });
      });
    },
    async readiness() {
      await sql`select 1 from tools.kitchen_extras limit 1`;
    },
    close: () => sql.end()
  };
}

function scope(sql: Db, kitchen: Kitchen): KitchenScope {
  const k = kitchen.id;
  const begin = <T>(work: (tx: TransactionSql) => Promise<T>): Promise<T> =>
    "begin" in sql ? (sql as Sql).begin(work) as Promise<T> : work(sql as TransactionSql);

  async function ingredient(db: Db, id: string): Promise<Ingredient> {
    const [row] = isUuid(id) ? await db<IngredientRow[]>`${ingredientSelect(db, k)} and i.id = ${id} group by i.id` : [];
    if (!row) throw new KitchenError("This ingredient does not exist.", "not_found");
    return ingredientFromRow(row);
  }

  async function recipes(db: Db, id?: string): Promise<Recipe[]> {
    const rows = await db<RecipeRow[]>`select id, name, servings, minutes, instructions, updated_at from tools.kitchen_recipes
      where kitchen_id = ${k} ${id ? db`and id = ${id}` : db``} order by lower(name)`;
    if (!rows.length) return [];
    const lines = await db<LineRow[]>`select l.recipe_id, l.ingredient_id, i.name ingredient, i.unit, l.amount, l.note
      from tools.kitchen_recipe_lines l join tools.kitchen_ingredients i on i.kitchen_id = l.kitchen_id and i.id = l.ingredient_id
      where l.kitchen_id = ${k} ${id ? db`and l.recipe_id = ${id}` : db``} order by l.recipe_id, l.position`;
    const byRecipe = new Map<string, LineRow[]>();
    for (const line of lines) byRecipe.set(line.recipe_id, [...(byRecipe.get(line.recipe_id) ?? []), line]);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      servings: row.servings,
      minutes: row.minutes,
      instructions: row.instructions,
      updatedAt: new Date(row.updated_at).toISOString(),
      lines: (byRecipe.get(row.id) ?? []).map((line) => ({ ingredientId: line.ingredient_id, ingredient: line.ingredient, unit: line.unit, amount: line.amount, note: line.note }))
    }));
  }

  async function recipe(db: Db, id: string): Promise<Recipe> {
    const [found] = isUuid(id) ? await recipes(db, id) : [];
    if (!found) throw new KitchenError("This recipe does not exist.", "not_found");
    return found;
  }

  async function entry(db: Db, id: string): Promise<PlanEntry> {
    const [row] = isUuid(id) ? await db<PlanRow[]>`${planSelect(db, k)} and e.id = ${id}` : [];
    if (!row) throw new KitchenError("This meal is not in the plan.", "not_found");
    const [found] = await withLines(db, [row]);
    return found!;
  }

  /** Adds what each meal uses: its own lines when it has them, else its recipe's lines, scaled to its servings. */
  async function withLines(db: Db, rows: readonly PlanRow[]): Promise<PlanEntry[]> {
    const ids = rows.map((row) => row.id);
    const lines = ids.length ? await db<PlanLineRow[]>`
      select e.id entry_id, l.ingredient_id, i.name ingredient, i.unit, l.amount, l.note, l.position, r.servings base, e.servings
        from tools.kitchen_plan_entries e
        join tools.kitchen_recipes r on r.kitchen_id = e.kitchen_id and r.id = e.recipe_id
        join tools.kitchen_recipe_lines l on l.kitchen_id = e.kitchen_id and l.recipe_id = e.recipe_id
        join tools.kitchen_ingredients i on i.kitchen_id = l.kitchen_id and i.id = l.ingredient_id
        where e.kitchen_id = ${k} and e.id = any(${ids}::uuid[]) and e.custom_servings is null
      union all
      select e.id, p.ingredient_id, i.name, i.unit, p.amount, p.note, p.position, e.custom_servings, e.servings
        from tools.kitchen_plan_entries e
        join tools.kitchen_plan_lines p on p.entry_id = e.id
        join tools.kitchen_ingredients i on i.kitchen_id = p.kitchen_id and i.id = p.ingredient_id
        where e.kitchen_id = ${k} and e.id = any(${ids}::uuid[]) and e.custom_servings is not null
      order by 1, 7` : [];
    const byEntry = new Map<string, PlanLineRow[]>();
    for (const line of lines) byEntry.set(line.entry_id, [...(byEntry.get(line.entry_id) ?? []), line]);
    return rows.map((row) => {
      const own = byEntry.get(row.id) ?? [];
      const base = own[0]?.base ?? row.servings;
      const recipeLines = own.map((line) => ({ ingredientId: line.ingredient_id, ingredient: line.ingredient, unit: line.unit, amount: line.amount, note: line.note }));
      return { ...planFromRow(row), lines: scaledLines({ servings: base, lines: recipeLines }, row.servings) };
    });
  }

  async function stock(db: Db): Promise<StockItem[]> {
    const rows = await db<{ ingredient_id: string; ingredient: string; unit: IngredientUnit; section: string; amount: number }[]>`
      select s.ingredient_id, i.name ingredient, i.unit, i.section, s.amount from tools.kitchen_stock s
      join tools.kitchen_ingredients i on i.kitchen_id = s.kitchen_id and i.id = s.ingredient_id
      where s.kitchen_id = ${k} and s.amount > 0 order by i.section, lower(i.name)`;
    return rows.map((row) => ({ ingredientId: row.ingredient_id, ingredient: row.ingredient, unit: row.unit, section: row.section, amount: row.amount }));
  }

  async function rememberGroup(db: Db, group: string) {
    if (group === UNSORTED_SECTION) return;
    await db`update tools.kitchens set groups = array_append(groups, ${group}::text) where id = ${k} and not (${group}::text = any(groups))`;
  }

  /** Recipe and stock amounts are in the ingredient's unit, so a new unit needs new amounts. */
  async function convertAmounts(tx: Db, current: Ingredient, unit: IngredientUnit, oldPerNew: number | undefined) {
    const [{ used }] = await tx<[{ used: boolean }]>`select ${current.recipeCount > 0}::boolean
      or exists (select 1 from tools.kitchen_stock where kitchen_id = ${k} and ingredient_id = ${current.id} and amount > 0)
      or exists (select 1 from tools.kitchen_plan_lines where kitchen_id = ${k} and ingredient_id = ${current.id}) used`;
    if (!used) return;
    if (oldPerNew === undefined) {
      throw new KitchenError(`Recipes or stock use ${current.name} in ${current.unit}. Say how much ${current.unit} one ${unit} holds, so those amounts change too.`);
    }
    await tx`update tools.kitchen_recipe_lines set amount = greatest(round((amount / ${oldPerNew}::float8)::numeric, 3), 0.001)
      where kitchen_id = ${k} and ingredient_id = ${current.id}`;
    await tx`update tools.kitchen_plan_lines set amount = greatest(round((amount / ${oldPerNew}::float8)::numeric, 3), 0.001)
      where kitchen_id = ${k} and ingredient_id = ${current.id}`;
    await tx`update tools.kitchen_stock set amount = round((amount / ${oldPerNew}::float8)::numeric, 3), updated_at = now()
      where kitchen_id = ${k} and ingredient_id = ${current.id}`;
  }

  return {
    kitchen,
    async setGroups(groups) {
      await sql`update tools.kitchens set groups = ${parseGroups(groups) as string[]}::text[] where id = ${k}`;
    },
    async ingredients() {
      const rows = await sql<IngredientRow[]>`${ingredientSelect(sql, k)} group by i.id order by lower(i.name)`;
      return rows.map(ingredientFromRow);
    },
    async saveIngredient(id, raw, oldPerNew) {
      const input = parseIngredientInput(raw);
      return begin(async (tx) => {
        const clash = await findIngredient(tx, k, input.name);
        if (clash && clash.id !== id) throw new KitchenError(`${clash.name} already exists in this kitchen.`, "conflict");
        const n = input.nutrition;
        if (id) {
          const current = await ingredient(tx, id);
          if (current.unit !== input.unit) await convertAmounts(tx, current, input.unit, oldPerNew);
          await tx`update tools.kitchen_ingredients set name = ${input.name}, unit = ${input.unit}, section = ${input.section}, other_groups = ${[...input.otherGroups]}::text[],
            kcal = ${n.kcal}, protein = ${n.protein}, carbs = ${n.carbs}, fat = ${n.fat}, notes = ${input.notes}, updated_at = now() where kitchen_id = ${k} and id = ${id}`;
          for (const group of ingredientGroups(input)) await rememberGroup(tx, group);
          return ingredient(tx, id);
        }
        const created = randomUUID();
        await tx`insert into tools.kitchen_ingredients (id, kitchen_id, name, unit, section, other_groups, kcal, protein, carbs, fat, notes, updated_at)
          values (${created}, ${k}, ${input.name}, ${input.unit}, ${input.section}, ${[...input.otherGroups]}::text[], ${n.kcal}, ${n.protein}, ${n.carbs}, ${n.fat}, ${input.notes}, now())`;
        for (const group of ingredientGroups(input)) await rememberGroup(tx, group);
        return ingredient(tx, created);
      });
    },
    async ingredientNamed(name, unit) {
      const existing = await findIngredient(sql, k, requiredName(name, "ingredient"));
      if (existing) return ingredient(sql, existing.id);
      return this.saveIngredient(undefined, { name, unit, section: "", nutrition: { kcal: null, protein: null, carbs: null, fat: null }, notes: "" });
    },
    async deleteIngredient(id) {
      const found = await ingredient(sql, id);
      if (found.recipeCount) {
        throw new KitchenError(`${found.name} is used in ${found.recipeCount === 1 ? "1 recipe" : `${found.recipeCount} recipes`}. Remove it from them first.`, "conflict");
      }
      await sql`delete from tools.kitchen_ingredients where kitchen_id = ${k} and id = ${id}`;
    },
    recipes: () => recipes(sql),
    recipe: (id) => recipe(sql, id),
    async saveRecipe(id, raw) {
      const input = parseRecipeInput(raw);
      return begin(async (tx) => {
        const [clash] = await tx<{ id: string; name: string }[]>`select id, name from tools.kitchen_recipes where kitchen_id = ${k} and lower(name) = lower(${input.name})`;
        if (clash && clash.id !== id) throw new KitchenError(`${clash.name} already exists in this kitchen.`, "conflict");
        for (const line of input.lines) await ingredient(tx, line.ingredientId);
        const recipeId = id ?? randomUUID();
        if (id) {
          await recipe(tx, id);
          await tx`update tools.kitchen_recipes set name = ${input.name}, servings = ${input.servings}, minutes = ${input.minutes}, instructions = ${input.instructions}, updated_at = now()
            where kitchen_id = ${k} and id = ${id}`;
          await tx`delete from tools.kitchen_recipe_lines where kitchen_id = ${k} and recipe_id = ${id}`;
        } else {
          await tx`insert into tools.kitchen_recipes (id, kitchen_id, name, servings, minutes, instructions, updated_at)
            values (${recipeId}, ${k}, ${input.name}, ${input.servings}, ${input.minutes}, ${input.instructions}, now())`;
        }
        for (const [position, line] of input.lines.entries()) {
          await tx`insert into tools.kitchen_recipe_lines (kitchen_id, recipe_id, ingredient_id, position, amount, note)
            values (${k}, ${recipeId}, ${line.ingredientId}, ${position}, ${line.amount}, ${line.note})`;
        }
        return recipe(tx, recipeId);
      });
    },
    async deleteRecipe(id) {
      await recipe(sql, id);
      await sql`delete from tools.kitchen_recipes where kitchen_id = ${k} and id = ${id}`;
    },
    async week(day) {
      const start = parseDay(day);
      const rows = await sql<PlanRow[]>`${planSelect(sql, k)} and e.day >= ${start} and e.day < ${addDays(start, 7)}
        order by e.day, array_position(array['breakfast', 'lunch', 'dinner', 'snack'], e.meal), e.created_at`;
      return { start, entries: await withLines(sql, rows) };
    },
    async plan(input) {
      await recipe(sql, input.recipeId);
      const id = randomUUID();
      await sql`insert into tools.kitchen_plan_entries (id, kitchen_id, day, meal, recipe_id, servings, created_at)
        values (${id}, ${k}, ${parseDay(input.day)}, ${parseMeal(input.meal)}, ${input.recipeId}, ${parseServings(input.servings)}, now())`;
      return entry(sql, id);
    },
    async updatePlan(id, input) {
      await entry(sql, id);
      await sql`update tools.kitchen_plan_entries set day = ${parseDay(input.day)}, meal = ${parseMeal(input.meal)}, servings = ${parseServings(input.servings)} where kitchen_id = ${k} and id = ${id}`;
      return entry(sql, id);
    },
    async removePlan(id) {
      await entry(sql, id);
      await sql`delete from tools.kitchen_plan_entries where kitchen_id = ${k} and id = ${id}`;
    },
    async customizePlan(id, input) {
      const lines = parseLines(input);
      return begin(async (tx) => {
        const planned = await entry(tx, id);
        if (planned.cooked) throw new KitchenError("This meal is already cooked, so its ingredients cannot change.");
        await tx`update tools.kitchen_plan_entries set custom_servings = servings where kitchen_id = ${k} and id = ${id}`;
        await tx`delete from tools.kitchen_plan_lines where entry_id = ${id}`;
        for (const [position, line] of lines.entries()) {
          await tx`insert into tools.kitchen_plan_lines (kitchen_id, entry_id, ingredient_id, position, amount, note)
            values (${k}, ${id}, ${line.ingredientId}, ${position}, ${line.amount}, ${line.note})`;
        }
        return entry(tx, id);
      });
    },
    async resetPlan(id) {
      return begin(async (tx) => {
        await entry(tx, id);
        await tx`delete from tools.kitchen_plan_lines where entry_id = ${id}`;
        await tx`update tools.kitchen_plan_entries set custom_servings = null where kitchen_id = ${k} and id = ${id}`;
        return entry(tx, id);
      });
    },
    async cook(id, leftover) {
      await begin(async (tx) => {
        const [row] = isUuid(id)
          ? await tx<{ id: string }[]>`select id from tools.kitchen_plan_entries where kitchen_id = ${k} and id = ${id} and cooked_at is null for update`
          : [];
        if (!row) throw new KitchenError("This meal is not in the plan, or it is already cooked.", "not_found");
        const cooked = await entry(tx, id);
        for (const line of cooked.lines) {
          await tx`update tools.kitchen_stock set amount = greatest(0, amount - ${line.amount}), updated_at = now()
            where kitchen_id = ${k} and ingredient_id = ${line.ingredientId}`;
        }
        await tx`update tools.kitchen_plan_entries set cooked_at = now() where kitchen_id = ${k} and id = ${id}`;
        if (leftover) await scope(tx, kitchen).addLeftover({ name: cooked.recipe, ...leftover });
      });
    },
    stock: () => stock(sql),
    async setStock(ingredientId, amount) {
      await ingredient(sql, ingredientId);
      await sql`insert into tools.kitchen_stock (kitchen_id, ingredient_id, amount, updated_at) values (${k}, ${ingredientId}, ${parseStockAmount(amount)}, now())
        on conflict (kitchen_id, ingredient_id) do update set amount = excluded.amount, updated_at = now()`;
    },
    async addStock(ingredientId, amount) {
      await ingredient(sql, ingredientId);
      await sql`insert into tools.kitchen_stock (kitchen_id, ingredient_id, amount, updated_at) values (${k}, ${ingredientId}, ${parseStockAmount(amount)}, now())
        on conflict (kitchen_id, ingredient_id) do update set amount = tools.kitchen_stock.amount + excluded.amount, updated_at = now()`;
    },
    async leftovers() {
      const rows = await sql<{ id: string; name: string; servings: number; use_by: string }[]>`
        select id, name, servings, use_by::text from tools.kitchen_leftovers where kitchen_id = ${k} order by use_by, created_at`;
      return rows.map((row) => ({ id: row.id, name: row.name, servings: row.servings, useBy: row.use_by }));
    },
    async addLeftover(input) {
      const id = randomUUID();
      const name = requiredName(input.name, "leftover");
      const servings = parseLeftoverServings(input.servings);
      const useBy = parseDay(input.useBy);
      await sql`insert into tools.kitchen_leftovers (id, kitchen_id, name, servings, use_by, created_at) values (${id}, ${k}, ${name}, ${servings}, ${useBy}, now())`;
      return { id, name, servings, useBy };
    },
    async eatLeftover(id, servings) {
      const eaten = parseLeftoverServings(servings);
      const rows = isUuid(id)
        ? await sql`update tools.kitchen_leftovers set servings = servings - ${eaten} where kitchen_id = ${k} and id = ${id} returning servings`
        : [];
      if (!rows.length) throw new KitchenError("This leftover does not exist.", "not_found");
      await sql`delete from tools.kitchen_leftovers where kitchen_id = ${k} and id = ${id} and servings <= 0.001`;
    },
    async removeLeftover(id) {
      if (isUuid(id)) await sql`delete from tools.kitchen_leftovers where kitchen_id = ${k} and id = ${id}`;
    },
    async shopping(start) {
      const [{ entries }, items, sections, extras, [current]] = await Promise.all([
        this.week(start),
        stock(sql),
        sql<{ id: string; section: string }[]>`select id, section from tools.kitchen_ingredients where kitchen_id = ${k}`,
        sql<ExtraItem[]>`select id, name, every_week "everyWeek", (every_week and bought_week is not distinct from ${start}::date) bought
          from tools.kitchen_extras where kitchen_id = ${k} order by created_at`,
        sql<{ groups: string[] }[]>`select groups from tools.kitchens where id = ${k}`
      ]);
      return {
        start,
        lines: shoppingList(entries, items, new Map(sections.map((row) => [row.id, row.section])), current?.groups ?? []),
        extras: [...extras]
      };
    },
    async addExtra(name, everyWeek = false) {
      const id = randomUUID();
      const item = requiredName(name, "item");
      await sql`insert into tools.kitchen_extras (id, kitchen_id, name, every_week, created_at) values (${id}, ${k}, ${item}, ${everyWeek}, now())`;
      return { id, name: item, everyWeek, bought: false };
    },
    async markExtra(id, week, bought) {
      const rows = isUuid(id)
        ? await sql`update tools.kitchen_extras set bought_week = case when ${bought}::boolean then ${week}::date when bought_week = ${week}::date then null else bought_week end
            where kitchen_id = ${k} and id = ${id} and every_week returning id`
        : [];
      if (!rows.length) throw new KitchenError("This every-week item does not exist.", "not_found");
    },
    async removeExtra(id) {
      if (isUuid(id)) await sql`delete from tools.kitchen_extras where kitchen_id = ${k} and id = ${id}`;
    }
  };
}

function ingredientSelect(db: Db, kitchenId: string) {
  return db`select i.id, i.name, i.unit, i.section, i.other_groups, i.kcal, i.protein, i.carbs, i.fat, i.notes, count(l.recipe_id)::int recipe_count
    from tools.kitchen_ingredients i left join tools.kitchen_recipe_lines l on l.kitchen_id = i.kitchen_id and l.ingredient_id = i.id
    where i.kitchen_id = ${kitchenId}`;
}

function planSelect(db: Db, kitchenId: string) {
  return db`select e.id, e.day::text, e.meal, e.recipe_id, r.name recipe, e.servings, e.custom_servings, e.cooked_at from tools.kitchen_plan_entries e
    join tools.kitchen_recipes r on r.kitchen_id = e.kitchen_id and r.id = e.recipe_id where e.kitchen_id = ${kitchenId}`;
}

async function findIngredient(db: Db, kitchenId: string, name: string) {
  const [row] = await db<{ id: string; name: string }[]>`select id, name from tools.kitchen_ingredients where kitchen_id = ${kitchenId} and lower(name) = lower(${name.trim()})`;
  return row;
}

async function freeRecipeName(db: Db, kitchenId: string, name: string): Promise<string> {
  const taken = new Set((await db<{ name: string }[]>`select lower(name) name from tools.kitchen_recipes where kitchen_id = ${kitchenId}`).map((row) => row.name));
  if (!taken.has(name.toLowerCase())) return name;
  for (let copy = 2; ; copy += 1) {
    const candidate = `${name} (${copy})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function ingredientFromRow(row: IngredientRow): Ingredient {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    section: row.section,
    otherGroups: row.other_groups,
    nutrition: { kcal: row.kcal, protein: row.protein, carbs: row.carbs, fat: row.fat },
    notes: row.notes,
    recipeCount: row.recipe_count
  };
}

function planFromRow(row: PlanRow): Omit<PlanEntry, "lines"> {
  return { id: row.id, day: row.day, meal: row.meal, recipeId: row.recipe_id, recipe: row.recipe, servings: row.servings, cooked: row.cooked_at !== null, custom: row.custom_servings !== null };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID.test(value);
}
