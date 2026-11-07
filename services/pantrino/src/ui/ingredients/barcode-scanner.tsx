import type { CatalogProduct } from "@tools-platform/service/kitchen-contract";
import { CameraView, useCameraPermissions } from "expo-camera";
import { X } from "lucide-react-native";
import { useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Offline } from "../../auth/session";
import { lookupBarcode } from "../../sync/api";
import { haptic } from "../haptics";
import { Button, T } from "../kit";
import { useText } from "../language";
import { TEXT } from "./text";

type Scan = { kind: "scanning" } | { kind: "looking" } | { kind: "missing"; code: string } | { kind: "offline" } | { kind: "failed" };

/** A full-screen camera that reads the barcode on a food package and looks up its product. It closes with the product when one is found. */
export function BarcodeScanner({ onProduct, onClose }: { onProduct: (product: CatalogProduct) => void; onClose: () => void }) {
  const text = useText(TEXT);
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scan, setScan] = useState<Scan>({ kind: "scanning" });
  /** The camera reports one code many times a second. Only the first read of a scan counts. */
  const busy = useRef(false);

  async function read(code: string) {
    if (busy.current) return;
    busy.current = true;
    haptic("tap");
    setScan({ kind: "looking" });
    try {
      const product = await lookupBarcode(code);
      if (product) { onProduct(product); onClose(); return; }
      setScan({ kind: "missing", code });
    } catch (error) {
      setScan({ kind: error instanceof Offline ? "offline" : "failed" });
    }
  }

  function again() {
    busy.current = false;
    setScan({ kind: "scanning" });
  }

  const message = scan.kind === "missing" ? text.scanNotFound(scan.code) : scan.kind === "offline" ? text.scanOffline : scan.kind === "failed" ? text.scanFailed : undefined;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose} statusBarTranslucent
      supportedOrientations={["portrait", "portrait-upside-down", "landscape-left", "landscape-right"]}>
      <View style={styles.screen}>
        {permission?.granted ? (
          <CameraView style={StyleSheet.absoluteFill} facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"] }}
            onBarcodeScanned={scan.kind === "scanning" ? ({ data }) => void read(data) : undefined} />
        ) : null}
        <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
          <T weight="semibold" style={styles.title}>{text.scanTitle}</T>
          <Button tone="ghost" icon={X} accessibilityLabel={text.cancel} onPress={onClose} />
        </View>
        <View style={styles.middle} pointerEvents="none">
          {permission?.granted ? <View style={styles.frame} /> : null}
        </View>
        <View style={[styles.bottom, { paddingBottom: insets.bottom + 24 }]}>
          {!permission ? <ActivityIndicator color="#ffffff" />
            : !permission.granted ? <>
              <T style={styles.light}>{permission.canAskAgain ? text.cameraNeeded : text.cameraBlocked}</T>
              {permission.canAskAgain
                ? <Button label={text.allowCamera} onPress={() => void requestPermission()} />
                : <Button label={text.openSettings} onPress={() => void Linking.openSettings()} />}
            </>
            : scan.kind === "looking" ? <View style={styles.row}><ActivityIndicator color="#ffffff" /><T style={styles.light}>{text.scanLooking}</T></View>
            : message ? <>
              <T accessibilityRole="alert" style={styles.light}>{message}</T>
              <View style={styles.row}>
                <Button tone="outline" label={text.cancel} onPress={onClose} />
                <Button label={text.scanAgain} onPress={again} />
              </View>
            </>
            : <T style={styles.light}>{text.scanHint}</T>}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000000" },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, backgroundColor: "rgba(0,0,0,0.45)", paddingBottom: 8 },
  title: { color: "#ffffff", fontSize: 18 },
  middle: { flex: 1, alignItems: "center", justifyContent: "center" },
  frame: { width: "78%", maxWidth: 360, aspectRatio: 1.8, borderRadius: 20, borderWidth: 3, borderColor: "#ffffff" },
  bottom: { gap: 12, alignItems: "center", paddingHorizontal: 24, paddingTop: 16, backgroundColor: "rgba(0,0,0,0.45)" },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  light: { color: "#ffffff", textAlign: "center", fontSize: 15 },
});
