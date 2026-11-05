import { ingredientGroups, INGREDIENT_UNITS, isCountedUnit, unitName, UNSORTED_SECTION, type Ingredient, type KitchenSnapshot } from "@tools-platform/service/kitchen-contract";
import { Plus, X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { OpenKitchen } from "../../state";
import { byGroup, Button, Field, GroupDot, groupLabel, Sheet, T } from "../kit";
import { useLanguage, useText } from "../language";
import { RADIUS, useColors } from "../theme";
import { changeSize, conversionUnits, ingredientDraft, ingredientSave, NUTRIENTS, nutritionFields, withGroup } from "./model";
import { RecipeUses } from "./recipe-uses";
import { TEXT } from "./text";

export function IngredientSheet({ existing, newName, kitchen, change, onClose }: {
  existing?: Ingredient; newName: string; kitchen: KitchenSnapshot; change: OpenKitchen["change"]; onClose: () => void;
}) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const [draft, setDraft] = useState(() => ingredientDraft(existing, newName, language));
  const result = ingredientSave(draft, existing, kitchen);
  const changingUnit = existing !== undefined && draft.unit !== existing.unit;
  const { larger, smaller } = conversionUnits(existing?.unit ?? draft.unit, draft.unit);
  const nutrientLabel = { kcal: text.calories, protein: text.protein, carbs: text.carbs, fat: text.fat };
  const per = isCountedUnit(draft.unit) ? text.perOne(unitName(draft.unit, language, 1)) : text.per100(draft.unit);

  function save() {
    if (!result.action) return;
    change(result.action);
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title={existing?.name ?? text.newIngredient}
      footer={<View style={{ width: "100%", gap: 8 }}>
        {result.issue ? <T accessibilityRole="alert" muted style={{ fontSize: 12 }}>{text[result.issue]}</T> : null}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          {existing?.recipeCount ? <T muted style={{ flex: 1, fontSize: 12 }}>{text.usedInRecipes}</T>
            : existing ? <Button tone="destructive" label={text.delete} onPress={() => { change({ type: "ingredient.delete", id: existing.id }); onClose(); }} /> : <View />}
          <Button label={text.save} disabled={!result.action} onPress={save} />
        </View>
      </View>}>
      <View style={styles.section}>
        <View style={styles.field}>
          <T weight="medium">{text.name}</T>
          <Field accessibilityLabel={text.name} value={draft.name} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} placeholder={text.namePlaceholder} maxLength={200} />
        </View>
        <View style={styles.field}>
          <T weight="medium">{text.unit}</T>
          <View accessibilityRole="radiogroup" accessibilityLabel={text.unit} style={[styles.units, { backgroundColor: colors.muted }]}>
            {INGREDIENT_UNITS.map((unit) => (
              <Pressable key={unit} accessibilityRole="radio" accessibilityState={{ checked: draft.unit === unit }}
                onPress={() => setDraft((current) => ({ ...current, unit, size: "", values: nutritionFields(existing?.nutrition, language) }))}
                style={{ minHeight: 44, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 24, backgroundColor: draft.unit === unit ? colors.control : "transparent" }}>
                <T weight="medium" style={{ color: draft.unit === unit ? colors.foreground : colors.mutedForeground }}>{unitName(unit, language)}</T>
              </Pressable>
            ))}
          </View>
        </View>
        {changingUnit ? <View style={styles.field}>
          <T weight="medium">{text.size(unitName(larger, language, 1), unitName(smaller, language))}</T>
          <Field accessibilityLabel={text.size(unitName(larger, language, 1), unitName(smaller, language))} value={draft.size} onChangeText={(size) => setDraft((current) => changeSize(current, existing, size, language))} inputMode="decimal" placeholder={text.sizePlaceholder} style={{ maxWidth: 160 }} />
          <T muted style={styles.hint}>{text.sizeHint}</T>
        </View> : null}
        <GroupField kitchen={kitchen} groups={draft.groups} typed={draft.typedGroup}
          onGroups={(groups) => setDraft((current) => ({ ...current, groups }))}
          onTyped={(typedGroup) => setDraft((current) => ({ ...current, typedGroup }))} />
      </View>
      <RecipeUses existing={existing} unit={draft.unit} uses={draft.uses} kitchen={kitchen} onClose={onClose}
        onUses={(uses) => setDraft((current) => ({ ...current, uses }))} />
      <View style={styles.section}>
        <T weight="medium">{text.nutritionPer(per)}</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {NUTRIENTS.map(([key, suffix]) => (
            <View key={key} style={{ flexBasis: "46%", flexGrow: 1, gap: 6 }}>
              <T muted style={styles.hint}>{nutrientLabel[key]}</T>
              <View style={{ justifyContent: "center" }}>
                <Field accessibilityLabel={nutrientLabel[key]} value={draft.values[key]} inputMode="decimal" placeholder="–"
                  onChangeText={(value) => setDraft((current) => ({ ...current, values: { ...current.values, [key]: value } }))} style={{ paddingRight: 48, fontVariant: ["tabular-nums"] }} />
                <T muted pointerEvents="none" style={{ position: "absolute", right: 12, fontSize: 12 }}>{suffix}</T>
              </View>
            </View>
          ))}
        </View>
        <T muted style={styles.hint}>{text.leaveEmpty}</T>
      </View>
      <View style={styles.field}>
        <T weight="medium">{text.notes}</T>
        <Field accessibilityLabel={text.notes} multiline value={draft.notes} onChangeText={(notes) => setDraft((current) => ({ ...current, notes }))} placeholder={text.notesPlaceholder} maxLength={4000} style={{ minHeight: 88, paddingVertical: 12, textAlignVertical: "top" }} />
      </View>
    </Sheet>
  );
}

function GroupField({ kitchen, groups, onGroups, typed, onTyped }: {
  kitchen: KitchenSnapshot; groups: readonly string[]; onGroups: (groups: readonly string[]) => void; typed: string; onTyped: (typed: string) => void;
}) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const known = byGroup(kitchen.kitchen.groups, kitchen.ingredients.flatMap(ingredientGroups), (group) => group).map(([group]) => group);
  const suggestions = [...new Set([...kitchen.kitchen.groups, ...known])].filter((group) => group !== UNSORTED_SECTION && !groups.some((one) => one.toLowerCase() === group.toLowerCase()));
  const add = (group: string) => { onGroups(withGroup(groups, group)); onTyped(""); };

  return (
    <View style={styles.field}>
      <T weight="medium">{text.groups}</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {groups.map((group, index) => (
          <View key={group} style={{ flexDirection: "row", alignItems: "center", maxWidth: "100%", borderRadius: 24, borderWidth: 1, borderColor: colors.controlBorder, backgroundColor: colors.control }}>
            <Pressable accessibilityRole="button" accessibilityLabel={index ? text.makeMain(groupLabel(group, language)) : groupLabel(group, language)} disabled={index === 0}
              onPress={() => onGroups([group, ...groups.filter((one) => one !== group)])}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingLeft: 12, flexShrink: 1 }}>
              <GroupDot groups={kitchen.kitchen.groups} group={group} size={8} />
              <T style={{ flexShrink: 1, fontSize: 14 }}>{groupLabel(group, language)}{index === 0 && groups.length > 1 ? <T muted style={styles.hint}> {text.mainGroup}</T> : null}</T>
            </Pressable>
            <Button tone="ghost" icon={X} accessibilityLabel={text.removeGroup(group)} onPress={() => onGroups(groups.filter((one) => one !== group))} />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Field accessibilityLabel={text.groups} value={typed} maxLength={60} placeholder={groups.length ? text.anotherGroup : text.groupPlaceholder} style={{ flex: 1 }}
          onChangeText={(value) => value.endsWith(",") ? add(value.slice(0, -1)) : onTyped(value)}
          onSubmitEditing={() => add(typed)} submitBehavior="submit"
          onKeyPress={({ nativeEvent }) => { if (nativeEvent.key === "Backspace" && !typed && groups.length) onGroups(groups.slice(0, -1)); }} />
        <Button tone="outline" icon={Plus} disabled={!typed.trim()} accessibilityLabel={text.addGroupNamed(typed.trim())} onPress={() => add(typed)} />
      </View>
      {suggestions.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {suggestions.map((group) => (
          <Pressable key={group} accessibilityRole="button" accessibilityLabel={text.addGroupNamed(groupLabel(group, language))} onPress={() => add(group)}
            style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, maxWidth: "100%", borderWidth: 1, borderStyle: "dashed", borderColor: colors.controlBorder, borderRadius: RADIUS, paddingHorizontal: 10 }}>
            <Plus size={14} color={colors.mutedForeground} />
            <T muted style={{ flexShrink: 1, fontSize: 12 }}>{groupLabel(group, language)}</T>
          </Pressable>
        ))}
      </View> : null}
      <T muted style={styles.hint}>{text.groupsHint}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12, marginBottom: 12 },
  field: { gap: 6 },
  hint: { fontSize: 12 },
  units: { flexDirection: "row", borderRadius: 26, padding: 4 },
});
