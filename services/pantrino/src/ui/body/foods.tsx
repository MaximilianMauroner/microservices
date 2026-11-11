import type { BodyshopAppSnapshot } from "@tools-platform/service/bodyshop-contract";
import { formatNumber } from "@tools-platform/service/kitchen-contract";
import { Plus, ScanBarcode } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { fromSaved, type Loggable } from "../../body/model";
import { bodyStore } from "../../body/store";
import { Button, Empty, Field, FloatingButton, type Notice, Press, Screen, SearchField, Sheet, Snackbar, T } from "../kit";
import { useLanguage, useText } from "../language";
import { type ScanResult, Scanner } from "../scan/scanner";
import { useColors } from "../theme";
import { LogSheet, unitLabel } from "./log-sheet";
import { TEXT } from "./text";

/** The saved Bodyshop foods. A tap logs one; a new food can be typed or scanned from its package. */
export function Foods({ snapshot }: { snapshot: BodyshopAppSnapshot }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const [query, setQuery] = useState("");
  const [logging, setLogging] = useState<Loggable>();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const foods = snapshot.foods.filter((food) => words.every((word) => `${food.name} ${food.brand}`.toLowerCase().includes(word)));

  return (
    <Screen title={text.foods} facts={text.foodsFacts(snapshot.foods.length)}
      floating={<Snackbar notice={notice} onUndo={() => undefined} onDone={() => setNotice(null)} />}
      fab={<FloatingButton icon={Plus} label={text.newFood} onPress={() => setCreating(true)} />}>
      {snapshot.foods.length ? <SearchField value={query} onValue={setQuery} label={text.search} /> : null}
      {snapshot.foods.length ? <View style={{ gap: 2 }}>
        {foods.map((food) => (
          <Press key={food.id} accessibilityRole="button" onPress={() => setLogging(fromSaved(food))}
            style={({ pressed }) => ({ minHeight: 56, justifyContent: "center", gap: 2, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 12, backgroundColor: pressed ? colors.muted : "transparent" })}>
            <T weight="medium">{food.name}</T>
            <T muted style={{ fontSize: 12 }}>
              {[food.brand, food.nutrients.kcal === null ? "" : `${formatNumber(food.nutrients.kcal, language)} ${text.kcal} ${text.per(formatNumber(food.amount, language), unitLabel(food.unit, language, food.amount))}`].filter(Boolean).join(" · ")}
            </T>
          </Press>
        ))}
        {!foods.length ? <T muted style={{ padding: 16, textAlign: "center" }}>{text.noMatch(query.trim())}</T> : null}
      </View> : <Empty title={text.noFoods} body={text.noFoodsBody} />}
      {logging ? <LogSheet initial={logging} onClose={() => setLogging(undefined)} notify={setNotice} /> : null}
      {creating ? <FoodSheet onClose={() => setCreating(false)} notify={setNotice} /> : null}
    </Screen>
  );
}

const NUTRIENT_KEYS = ["kcal", "protein", "carbs", "fat", "fiber"] as const;
type Fields = Record<(typeof NUTRIENT_KEYS)[number], string>;

/** A new saved food, typed or filled from a scan. Values are per an amount of a unit, 100 g unless the person changes it. */
function FoodSheet({ onClose, notify }: { onClose: () => void; notify: (notice: Notice) => void }) {
  const text = useText(TEXT);
  const colors = useColors();
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [per, setPer] = useState("100");
  const [unit, setUnit] = useState("g");
  const [fields, setFields] = useState<Fields>({ kcal: "", protein: "", carbs: "", fat: "", fiber: "" });
  const [source, setSource] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string>();
  const number = (field: string) => field.trim() ? Number(field.replace(",", ".")) : null;
  const amount = number(per);
  const values = Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, number(fields[key])])) as Record<(typeof NUTRIENT_KEYS)[number], number | null>;
  const ready = name.trim() && unit.trim() && amount !== null && amount > 0 && values.kcal !== null && NUTRIENT_KEYS.every((key) => values[key] === null || (values[key]! >= 0 && values[key]! <= 10_000));

  function fill(scan: ScanResult) {
    const found = scan.kind === "product" ? { ...scan.product.nutrition, fiber: null } : scan.values;
    if (scan.kind === "product") { setName(scan.product.name); setBrand(scan.product.brand); }
    setPer("100");
    setUnit(scan.kind === "product" ? scan.product.unit : scan.unit);
    setFields(Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, found[key] === null ? "" : String(found[key]).replace(".", ",")])) as Fields);
    setSource(scan.kind === "product" ? `Barcode ${scan.product.code}` : "Label photo");
  }

  async function save() {
    if (!ready) return;
    const result = await bodyStore.act({
      type: "food.save", name: name.trim(), brand: brand.trim(), amount: amount!, unit: unit.trim(), source,
      nutrients: { kcal: values.kcal!, protein: values.protein, carbs: values.carbs, fat: values.fat, fiber: values.fiber },
    });
    if (result.ok) { notify({ message: text.foodSaved(name.trim()) }); onClose(); return; }
    setError(result.reason === "refused" ? result.message : result.reason === "offline" ? text.needsConnection : text.failed);
  }

  return (
    <Sheet open onClose={onClose} title={text.newFood}
      footer={<View style={{ width: "100%", flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Button tone="outline" icon={ScanBarcode} label={text.scan} onPress={() => setScanning(true)} />
        <Button label={text.saveFood} disabled={!ready} onPress={() => void save()} />
      </View>}>
      <View style={{ gap: 6 }}>
        <T weight="medium">{text.name}</T>
        <Field accessibilityLabel={text.name} value={name} onChangeText={setName} placeholder={text.namePlaceholder} maxLength={200} />
      </View>
      <View style={{ gap: 6 }}>
        <T weight="medium">{text.brand}</T>
        <Field accessibilityLabel={text.brand} value={brand} onChangeText={setBrand} maxLength={200} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <T weight="medium">{text.perAmount}</T>
        <Field accessibilityLabel={text.amount} value={per} onChangeText={setPer} inputMode="decimal" style={{ width: 90 }} />
        <Field accessibilityLabel={text.unit} value={unit} onChangeText={setUnit} maxLength={40} style={{ width: 90 }} />
      </View>
      {NUTRIENT_KEYS.map((key) => (
        <View key={key} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <T style={{ flex: 1 }}>{text.nutrients[key]}</T>
          <Field accessibilityLabel={text.nutrients[key]} value={fields[key]} onChangeText={(value) => setFields({ ...fields, [key]: value })} inputMode="decimal" placeholder="–" style={{ width: 110 }} />
          <T muted style={{ width: 32 }}>{key === "kcal" ? text.kcal : "g"}</T>
        </View>
      ))}
      {error ? <T accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</T> : null}
      {scanning ? <Scanner onResult={fill} onClose={() => setScanning(false)} /> : null}
    </Sheet>
  );
}
