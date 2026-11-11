import {
  addDays,
  fieldNumber,
  formatAmount,
  type StockItem,
  
  INGREDIENT_UNITS,
  type IngredientUnit,
  requiredName,
  unitName,
} from "@tools-platform/service/kitchen-contract";
import { Plus } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { OpenKitchen } from "../../state";
import { Button, byGroup, Field, GroupDot, Press, SearchField, Sheet, Stepper, T } from "../kit";
import { useLanguage, useText } from "../language";
import { useColors } from "../theme";
import { TEXT } from "./text";
import { stockAmount } from "./view";

type Selection = { type: "existing"; id: string } | { type: "new"; name: string; unit: IngredientUnit };

export function AddStockSheet({
  kitchen,
  change,
  onClose,
}: OpenKitchen & { onClose: () => void }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const [selection, setSelection] = useState<Selection>();
  const [query, setQuery] = useState("");
  const [amount, setAmount] = useState("");
  const [creating, setCreating] = useState<{ name: string; amount: number }>();
  const submitted = useRef(false);
  const stockQueued = useRef(false);
  const selected =
    selection?.type === "new"
      ? selection
      : selection?.type === "existing"
        ? kitchen.ingredients.find((one) => one.id === selection.id)
        : undefined;
  const typed = query.trim().replace(/\s+/g, " ");
  const isNew =
    Boolean(typed) &&
    typed.length <= 120 &&
    !kitchen.ingredients.some((one) => one.name.toLowerCase() === typed.toLowerCase());
  const value = stockAmount(amount);
  const matches = byGroup(
    kitchen.kitchen.groups,
    kitchen.ingredients.filter(
      (one) =>
        one.name.toLowerCase().includes(query.trim().toLowerCase()),
    ),
    (one) => one.section,
  )
    .flatMap(([, items]) => items)
    .slice(0, 60);
  const home = new Map(kitchen.stock.map((item) => [item.ingredientId, item.amount]));
  // The queue assigns the ingredient ID, so stock must wait for the local copy.
  useEffect(() => {
    if (!creating || stockQueued.current) return;
    const ingredient = kitchen.ingredients.find((one) => one.name.toLowerCase() === creating.name.toLowerCase());
    if (!ingredient) return;
    stockQueued.current = true;
    change({ type: "stock.add", ingredientId: ingredient.id, amount: creating.amount });
    onClose();
  }, [creating, kitchen.ingredients, change, onClose]);
  function add() {
    if (!selected || value === undefined || value <= 0 || submitted.current) return;
    submitted.current = true;
    if (selection?.type === "new") {
      const name = requiredName(selection.name, "ingredient");
      setCreating({ name, amount: value });
      change({
        type: "ingredient.save",
        name,
        unit: selection.unit,
        section: "",
        kcal: null,
        protein: null,
        carbs: null,
        fat: null,
        notes: "",
      });
    } else if (selection?.type === "existing") {
      change({ type: "stock.add", ingredientId: selection.id, amount: value });
      onClose();
    }
  }
  const missing = !selected
    ? text.chooseIngredientFirst
    : value === undefined || value <= 0
      ? text.enterAmount
      : undefined;
  return (
    <Sheet
      open
      onClose={() => {
        if (!creating) onClose();
      }}
      title={text.addStockTitle}
      description={text.addStockDescription}
      footer={<Button wide label={text.addToStock} disabled={Boolean(missing) || Boolean(creating)} onPress={add} />}
    >
      <SearchField value={query} onValue={setQuery} label={text.findIngredient} />
      {isNew ? (
        <Press
          accessibilityRole="button"
          disabled={Boolean(creating)}
          onPress={() =>
            setSelection({ type: "new", name: typed, unit: selection?.type === "new" ? selection.unit : "g" })
          }
          style={{
            minHeight: 48,
            padding: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.controlBorder,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            opacity: creating ? 0.4 : 1,
          }}
        >
          <Plus size={18} color={colors.foreground} />
          <T weight="medium" style={{ flex: 1 }}>
            {text.addNew(typed)}
          </T>
        </Press>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {matches.map((one) => {
          const chosen = selection?.type === "existing" && selection.id === one.id;
          return (
            <Press
              key={one.id}
              accessibilityRole="button"
              accessibilityState={{ selected: chosen, disabled: Boolean(creating) }}
              disabled={Boolean(creating)}
              onPress={() => setSelection({ type: "existing", id: one.id })}
              style={{
                minHeight: 48,
                borderRadius: 22,
                borderWidth: 1,
                borderColor: chosen ? colors.page.kitchen : colors.controlBorder,
                backgroundColor: chosen ? colors.page.kitchen : colors.control,
                paddingHorizontal: 12,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                maxWidth: "100%",
              }}
            >
              <GroupDot groups={kitchen.kitchen.groups} group={one.section} />
              <T style={{ color: chosen ? "#ffffff" : colors.foreground, flexShrink: 1 }}>{one.name}</T>
              {home.get(one.id) ? (
                <T style={{ fontSize: 12, color: chosen ? "#ffffff" : colors.mutedForeground }}>
                  {formatAmount(home.get(one.id)!, one.unit, language)}
                </T>
              ) : null}
            </Press>
          );
        })}
      </View>
      {selected ? (
        <View style={{ gap: 8 }}>
          <T weight="medium">{text.amountOf(selected.name)}</T>
          {selection?.type === "new" ? (
            <T muted style={{ fontSize: 12 }}>
              {text.newIngredient}
            </T>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Field
              style={{ width: 120 }}
              value={amount}
              onChangeText={setAmount}
              editable={!creating}
              keyboardType="decimal-pad"
              accessibilityLabel={text.amountOf(selected.name)}
              onSubmitEditing={add}
              returnKeyType="done"
            />
            {selection?.type !== "new" ? <T muted>{unitName(selected.unit, language)}</T> : null}
          </View>
          {selection?.type === "new" ? (
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={text.unit}
              style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}
            >
              {INGREDIENT_UNITS.map((unit) => (
                <Press
                  key={unit}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selection.unit === unit }}
                  disabled={Boolean(creating)}
                  onPress={() => setSelection({ ...selection, unit })}
                  style={{
                    minHeight: 48,
                    borderRadius: 22,
                    paddingHorizontal: 14,
                    justifyContent: "center",
                    backgroundColor: selection.unit === unit ? colors.page.kitchen : colors.muted,
                  }}
                >
                  <T style={{ color: selection.unit === unit ? "#ffffff" : colors.foreground }}>
                    {unitName(unit, language)}
                  </T>
                </Press>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {missing ? (
        <T muted style={{ fontSize: 12 }}>
          {missing}
        </T>
      ) : null}
      {!kitchen.ingredients.length && !typed ? <T muted>{text.addIngredientsFirst}</T> : null}
    </Sheet>
  );
}

/** Sets how much of one ingredient is at home. */
export function AmountSheet({ item, onSave, onClose }: { item: StockItem; onSave: (amount: number) => void; onClose: () => void }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const [value, setValue] = useState(fieldNumber(item.amount, language));
  const amount = stockAmount(value);
  function save() {
    if (amount === undefined) return;
    if (amount !== item.amount) onSave(amount);
    onClose();
  }
  return (
    <Sheet open onClose={onClose} title={item.ingredient} footer={<Button wide label={text.save} disabled={amount === undefined} onPress={save} />}>
      <T weight="medium">{text.amountAtHome}</T>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Field
          autoFocus
          selectTextOnFocus
          style={{ width: 120 }}
          value={value}
          onChangeText={setValue}
          keyboardType="decimal-pad"
          accessibilityLabel={text.amountOf(item.ingredient)}
          onSubmitEditing={save}
          returnKeyType="done"
        />
        <T muted>{unitName(item.unit, language, amount ?? item.amount)}</T>
      </View>
    </Sheet>
  );
}

export function AddLeftoverSheet({ today, change, onClose }: OpenKitchen & { onClose: () => void }) {
  const text = useText(TEXT);
  const [name, setName] = useState("");
  const [servings, setServings] = useState(2);
  const [days, setDays] = useState(3);
  const submitted = useRef(false);
  return (
    <Sheet
      open
      onClose={onClose}
      title={text.addLeftoverTitle}
      footer={
        <Button
          wide
          label={text.keepIt}
          disabled={!name.trim()}
          onPress={() => {
            if (!name.trim() || submitted.current) return;
            submitted.current = true;
            change({ type: "leftover.add", name: name.trim(), servings, useBy: addDays(today, days) });
            onClose();
          }}
        />
      }
    >
      <T weight="medium">{text.whatIsLeft}</T>
      <Field
        value={name}
        onChangeText={setName}
        maxLength={120}
        accessibilityLabel={text.whatIsLeft}
        placeholder={text.chiliPlaceholder}
      />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <T>{text.servingsLabel}</T>
        <Stepper label={text.servingsLabel} value={servings} onValue={setServings} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <T>{text.goodForDays}</T>
        <Stepper label={text.days} value={days} onValue={setDays} max={30} unit={days === 1 ? text.day : text.days} />
      </View>
      {!name.trim() ? (
        <T muted style={{ fontSize: 12 }}>
          {text.nameLeftover}
        </T>
      ) : null}
    </Sheet>
  );
}
