import { recognizeText } from "@infinitered/react-native-mlkit-text-recognition";
import type { CatalogProduct } from "@tools-platform/service/kitchen-contract";
import { CameraView, useCameraPermissions } from "expo-camera";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import { Camera, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Offline } from "../../auth/session";
import { useApp } from "../../state";
import { lookupBarcode } from "../../sync/api";
import { haptic } from "../haptics";
import { Button, Field, Press, T } from "../kit";
import { type KitchenLanguage, useText } from "../language";
import { useColors } from "../theme";
import { LABEL_NUTRIENTS, labelDisagrees, type LabelValues, readLabel } from "./label";

const en = {
  scanTitle: "Scan a barcode",
  labelTitle: "Photograph the nutrition table",
  scanHint: "Hold the barcode on the package inside the frame.",
  labelHint: "Fill the frame with the nutrition table, then take the photo.",
  noBarcode: "No barcode? Read the table",
  looking: "Looking up the product…",
  reading: "Reading the table…",
  notFound: (code: string) => `No product with nutrition has the barcode ${code}.`,
  offline: "The barcode needs a connection to look up.",
  failed: "Tools could not look up the product.",
  needsAccount: "Product lookup by barcode needs an account. Pantrino reads the table on this phone.",
  readTable: "Read the nutrition table",
  scanAgain: "Scan again",
  takePhoto: "Take photo",
  retake: "Retake",
  useValues: "Use these values",
  cancel: "Cancel",
  cameraNeeded: "Pantrino needs the camera to read barcodes and nutrition tables.",
  allowCamera: "Allow camera",
  cameraBlocked: "Camera access is off. Turn it on for Pantrino in the system settings.",
  openSettings: "Open settings",
  checkValues: "Check each value against the photo. Correct or fill in what is wrong.",
  nothingRead: "Pantrino could not read the table. Type the values from the package.",
  disagree: "The calories do not fit the other values. A digit may be misread.",
  per100: "Per 100",
  photo: "Photo of the nutrition table",
  nutrients: { kcal: "Calories", protein: "Protein", carbs: "Carbs", fat: "Fat", fiber: "Fiber" },
  kcalNeeded: "Enter the calories to go on.",
};
const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: {
    scanTitle: "Barcode scannen",
    labelTitle: "Nährwerttabelle fotografieren",
    scanHint: "Halte den Barcode der Packung in den Rahmen.",
    labelHint: "Füll den Rahmen mit der Nährwerttabelle und mach dann das Foto.",
    noBarcode: "Kein Barcode? Tabelle lesen",
    looking: "Produkt wird gesucht …",
    reading: "Tabelle wird gelesen …",
    notFound: (code: string) => `Kein Produkt mit Nährwerten hat den Barcode ${code}.`,
    offline: "Für den Barcode braucht es eine Verbindung.",
    failed: "Tools konnte das Produkt nicht suchen.",
    needsAccount: "Die Produktsuche per Barcode braucht ein Konto. Pantrino liest die Tabelle auf diesem Telefon.",
    readTable: "Nährwerttabelle lesen",
    scanAgain: "Nochmal scannen",
    takePhoto: "Foto machen",
    retake: "Neues Foto",
    useValues: "Werte übernehmen",
    cancel: "Abbrechen",
    cameraNeeded: "Pantrino braucht die Kamera, um Barcodes und Nährwerttabellen zu lesen.",
    allowCamera: "Kamera erlauben",
    cameraBlocked: "Der Kamerazugriff ist aus. Schalte ihn in den Systemeinstellungen für Pantrino ein.",
    openSettings: "Einstellungen öffnen",
    checkValues: "Vergleiche jeden Wert mit dem Foto. Korrigiere oder ergänze, was nicht stimmt.",
    nothingRead: "Pantrino konnte die Tabelle nicht lesen. Gib die Werte von der Packung ein.",
    disagree: "Die Kalorien passen nicht zu den anderen Werten. Vielleicht ist eine Ziffer falsch gelesen.",
    per100: "Pro 100",
    photo: "Foto der Nährwerttabelle",
    nutrients: { kcal: "Kalorien", protein: "Eiweiß", carbs: "Kohlenhydrate", fat: "Fett", fiber: "Ballaststoffe" },
    kcalNeeded: "Gib die Kalorien ein, um weiterzumachen.",
  },
};

/** A product from the catalog, or values a person confirmed from a photo of the table. A label never carries a name: it is not a product. */
export type ScanResult =
  | Readonly<{ kind: "product"; product: CatalogProduct }>
  | Readonly<{ kind: "label"; unit: "g" | "ml"; values: LabelValues }>;

type Step =
  | { kind: "barcode" }
  | { kind: "looking" }
  | { kind: "missed"; reason: "missing" | "offline" | "failed"; code: string }
  | { kind: "aiming" }
  | { kind: "reading" }
  | { kind: "review"; photo: string; fields: Record<keyof LabelValues, string>; unit: "g" | "ml"; found: number };

const BARCODES = ["ean13", "ean8", "upc_a", "upc_e"] as const;

/**
 * A full-screen camera. It reads the barcode on a package and looks up the product. When no product has the code, it
 * photographs the nutrition table and reads it on the phone, and the person checks the values next to the photo.
 * Without an account there is no lookup, so it starts at the table.
 */
export function Scanner({ onResult, onClose }: { onResult: (result: ScanResult) => void; onClose: () => void }) {
  const text = useText(TEXT);
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const lookup = useApp().session === "signed-in";
  const [step, setStep] = useState<Step>(lookup ? { kind: "barcode" } : { kind: "aiming" });
  const camera = useRef<CameraView>(null);
  /** The camera reports one code many times a second. Only the first read of a scan counts. */
  const busy = useRef(false);
  const mounted = useRef(true);
  const photo = step.kind === "review" ? step.photo : undefined;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => () => { if (photo) discardPhoto(photo); }, [photo]);

  async function look(code: string) {
    if (busy.current) return;
    busy.current = true;
    haptic("tap");
    setStep({ kind: "looking" });
    try {
      const product = await lookupBarcode(code);
      if (product) { onResult({ kind: "product", product }); onClose(); return; }
      setStep({ kind: "missed", reason: "missing", code });
    } catch (error) {
      setStep({ kind: "missed", reason: error instanceof Offline ? "offline" : "failed", code });
    }
  }

  async function photograph() {
    const shot = await camera.current?.takePictureAsync({ quality: 0.85 }).catch(() => undefined);
    if (!shot) return;
    if (!mounted.current) { discardPhoto(shot.uri); return; }
    haptic("tap");
    setStep({ kind: "reading" });
    const reading = await recognizeText(shot.uri)
      .then((found) => readLabel(found.blocks.flatMap((block) => block.lines)))
      .catch(() => readLabel([]));
    if (!mounted.current) { discardPhoto(shot.uri); return; }
    const fields = Object.fromEntries(LABEL_NUTRIENTS.map((key) => [key, reading.values[key] === null ? "" : String(reading.values[key]).replace(".", ",")])) as Record<keyof LabelValues, string>;
    setStep({ kind: "review", photo: shot.uri, fields, unit: reading.unit ?? "g", found: reading.found });
  }

  function barcodeAgain() {
    busy.current = false;
    setStep({ kind: "barcode" });
  }

  const live = permission?.granted && step.kind !== "review" && step.kind !== "reading";
  const reading = step.kind === "aiming" || step.kind === "reading";

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose} statusBarTranslucent
      supportedOrientations={["portrait", "portrait-upside-down", "landscape-left", "landscape-right"]}>
      {step.kind === "review" ? <Review step={step} onStep={setStep} onRetake={() => setStep({ kind: "aiming" })} onClose={onClose}
        onUse={(values) => { onResult({ kind: "label", unit: step.unit, values }); onClose(); }} /> : (
        <View style={styles.screen}>
          {live ? (
            <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back"
              barcodeScannerSettings={{ barcodeTypes: [...BARCODES] }}
              onBarcodeScanned={step.kind === "barcode" ? ({ data }) => void look(data) : undefined} />
          ) : null}
          <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
            <T weight="semibold" style={styles.title}>{reading ? text.labelTitle : text.scanTitle}</T>
            <Button tone="ghost" icon={X} accessibilityLabel={text.cancel} onPress={onClose} />
          </View>
          <View style={styles.middle} pointerEvents="none">
            {permission?.granted ? <View style={[styles.frame, reading && styles.tableFrame]} /> : null}
          </View>
          <View style={[styles.bottom, { paddingBottom: insets.bottom + 24 }]}>
            {!permission ? <ActivityIndicator color="#ffffff" />
              : !permission.granted ? <>
                <T style={styles.light}>{permission.canAskAgain ? text.cameraNeeded : text.cameraBlocked}</T>
                {permission.canAskAgain
                  ? <Button label={text.allowCamera} onPress={() => void requestPermission()} />
                  : <Button label={text.openSettings} onPress={() => void Linking.openSettings()} />}
              </>
              : step.kind === "looking" || step.kind === "reading" ? <View style={styles.row}><ActivityIndicator color="#ffffff" /><T style={styles.light}>{step.kind === "looking" ? text.looking : text.reading}</T></View>
              : step.kind === "missed" ? <>
                <T accessibilityRole="alert" style={styles.light}>{step.reason === "missing" ? text.notFound(step.code) : step.reason === "offline" ? text.offline : text.failed}</T>
                <View style={styles.row}>
                  <Button tone="outline" label={text.scanAgain} onPress={barcodeAgain} />
                  <Button label={text.readTable} onPress={() => setStep({ kind: "aiming" })} />
                </View>
              </>
              : step.kind === "aiming" ? <>
                {lookup ? null : <T style={styles.light}>{text.needsAccount}</T>}
                <T style={styles.light}>{text.labelHint}</T>
                <Press accessibilityRole="button" accessibilityLabel={text.takePhoto} onPress={() => void photograph()} style={styles.shutter}>
                  <Camera size={28} color="#000000" />
                </Press>
              </>
              : <>
                <T style={styles.light}>{text.scanHint}</T>
                <Press accessibilityRole="button" onPress={() => setStep({ kind: "aiming" })} hitSlop={8}>
                  <T style={[styles.light, { textDecorationLine: "underline" }]}>{text.noBarcode}</T>
                </Press>
              </>}
          </View>
        </View>
      )}
    </Modal>
  );
}

function discardPhoto(uri: string) {
  try { new File(uri).delete(); } catch {}
}

/** The photo next to the values read from it. Every value can be corrected, and calories are needed to go on. */
function Review({ step, onStep, onRetake, onUse, onClose }: {
  step: Extract<Step, { kind: "review" }>; onStep: (step: Step) => void; onRetake: () => void; onUse: (values: LabelValues) => void; onClose: () => void;
}) {
  const text = useText(TEXT);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const values = Object.fromEntries(LABEL_NUTRIENTS.map((key) => [key, number(step.fields[key])])) as Record<keyof LabelValues, number | null>;
  const valid = LABEL_NUTRIENTS.every((key) => step.fields[key].trim() === "" || values[key] !== null);
  const ready = valid && values.kcal !== null;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + 8 }}>
      <View style={[styles.top, { backgroundColor: "transparent" }]}>
        <T weight="semibold" style={{ fontSize: 18 }}>{text.labelTitle}</T>
        <Button tone="ghost" icon={X} accessibilityLabel={text.cancel} onPress={onClose} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, flexDirection: "row", flexWrap: "wrap" }} keyboardShouldPersistTaps="handled">
        <Image source={{ uri: step.photo }} accessibilityLabel={text.photo} contentFit="contain"
          style={{ flexGrow: 1, flexBasis: 280, minHeight: 240, maxHeight: 420, borderRadius: 16, backgroundColor: colors.muted }} />
        <View style={{ flexGrow: 1, flexBasis: 280, gap: 12 }}>
          <T accessibilityRole="alert" muted>{step.found ? text.checkValues : text.nothingRead}</T>
          {labelDisagrees(values) ? <T style={{ color: colors.destructive }}>{text.disagree}</T> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <T weight="medium">{text.per100}</T>
            {(["g", "ml"] as const).map((unit) => (
              <Press key={unit} accessibilityRole="radio" accessibilityState={{ checked: step.unit === unit }} onPress={() => onStep({ ...step, unit })}
                style={{ minHeight: 40, minWidth: 56, alignItems: "center", justifyContent: "center", borderRadius: 20, borderWidth: 1, borderColor: step.unit === unit ? colors.foreground : colors.controlBorder }}>
                <T weight={step.unit === unit ? "semibold" : "regular"}>{unit}</T>
              </Press>
            ))}
          </View>
          {LABEL_NUTRIENTS.map((key) => (
            <View key={key} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <T style={{ flex: 1 }}>{text.nutrients[key]}</T>
              <Field accessibilityLabel={text.nutrients[key]} value={step.fields[key]} inputMode="decimal" placeholder="–" style={{ width: 120, fontVariant: ["tabular-nums"] }}
                onChangeText={(value) => onStep({ ...step, fields: { ...step.fields, [key]: value } })} />
              <T muted style={{ width: 32 }}>{key === "kcal" ? "kcal" : "g"}</T>
            </View>
          ))}
          {ready ? null : <T muted style={{ fontSize: 12 }}>{text.kcalNeeded}</T>}
        </View>
      </ScrollView>
      <View style={[styles.row, { justifyContent: "flex-end", padding: 16, paddingBottom: insets.bottom + 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
        <Button tone="outline" label={text.retake} onPress={onRetake} />
        <Button label={text.useValues} disabled={!ready} onPress={() => onUse(values)} />
      </View>
    </View>
  );
}

function number(field: string): number | null {
  if (!field.trim()) return null;
  const value = Number(field.replace(",", "."));
  return Number.isFinite(value) && value >= 0 && value <= 10_000 ? value : null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000000" },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, backgroundColor: "rgba(0,0,0,0.45)", paddingBottom: 8 },
  title: { color: "#ffffff", fontSize: 18 },
  middle: { flex: 1, alignItems: "center", justifyContent: "center" },
  frame: { width: "78%", maxWidth: 360, aspectRatio: 1.8, borderRadius: 20, borderWidth: 3, borderColor: "#ffffff" },
  tableFrame: { width: "86%", maxWidth: 440, aspectRatio: 0.8 },
  bottom: { gap: 12, alignItems: "center", paddingHorizontal: 24, paddingTop: 16, backgroundColor: "rgba(0,0,0,0.45)" },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", justifyContent: "center", gap: 12 },
  light: { color: "#ffffff", textAlign: "center", fontSize: 15 },
  shutter: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff", borderWidth: 4, borderColor: "rgba(255,255,255,0.5)" },
});
