import { Check } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { Button, GroupDot, groupLabel, Press, SearchField, Sheet, T, usePageColor } from "./kit";
import { type KitchenLanguage, useLanguage, useText } from "./language";
import { type PickItem, pickSections } from "./pick";
import { useColors } from "./theme";

const en = {
  search: "Search",
  noMatch: (query: string) => `Nothing matches “${query}”`,
  selected: (count: number) => count === 1 ? "1 selected" : `${count} selected`,
  cancel: "Cancel",
};
const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: {
    search: "Suchen",
    noMatch: (query: string) => `Nichts passt zu „${query}“`,
    selected: (count: number) => count === 1 ? "1 ausgewählt" : `${count} ausgewählt`,
    cancel: "Abbrechen",
  },
};

/** A full list to browse and select many items from, grouped by food group, with a search on top. */
export function PickSheet({ title, items, groups, confirm, onPick, onClose, query: startQuery = "" }: {
  title: string; items: readonly PickItem[]; groups: readonly string[]; confirm: (count: number) => string;
  onPick: (ids: readonly string[]) => void; onClose: () => void; query?: string;
}) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const { hue } = usePageColor();
  const [query, setQuery] = useState(startQuery);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const sections = pickSections(items, groups, query);
  const toggle = (id: string) => setPicked((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  return (
    <Sheet open onClose={onClose} title={title} description={picked.size ? text.selected(picked.size) : undefined}
      footer={<View style={{ width: "100%", flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Button tone="ghost" label={text.cancel} onPress={onClose} />
        <Button wide label={confirm(picked.size)} disabled={!picked.size} onPress={() => { onPick(items.filter((item) => picked.has(item.id)).map((item) => item.id)); onClose(); }} />
      </View>}>
      <SearchField value={query} onValue={setQuery} label={text.search} />
      {sections.length ? sections.map(([group, rows]) => (
        <View key={group} style={{ gap: 4 }}>
          <View accessibilityRole="header" style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 4 }}>
            <GroupDot groups={groups} group={group} size={8} />
            <T muted weight="medium" style={{ fontSize: 12 }}>{groupLabel(group, language)}</T>
          </View>
          {rows.map((item) => {
            const checked = picked.has(item.id);
            return (
              <Press key={item.id} accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => toggle(item.id)}
                style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 12, backgroundColor: pressed ? colors.muted : "transparent" })}>
                <View style={{ width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center", borderWidth: checked ? 0 : 1.5, borderColor: colors.controlBorder, backgroundColor: checked ? hue : "transparent" }}>
                  {checked ? <Check size={16} color="#ffffff" strokeWidth={3} /> : null}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <T weight={checked ? "medium" : "regular"}>{item.label}</T>
                  {item.detail ? <T muted style={{ fontSize: 12 }}>{item.detail}</T> : null}
                </View>
              </Press>
            );
          })}
        </View>
      )) : <T muted style={{ padding: 16, textAlign: "center" }}>{text.noMatch(query.trim())}</T>}
    </Sheet>
  );
}
