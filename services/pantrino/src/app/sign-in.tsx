import { useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useApp } from "../state";
import { Button, HueBadge, T } from "../ui/kit";
import { ReportSheet } from "../ui/report-sheet";
import { type KitchenLanguage, useText } from "../ui/language";
import { useColors } from "../ui/theme";

const en = { title: "Pantrino", body: "Sign in with the Google account you use for Mauroner Tools. Your kitchens then stay on this phone, encrypted, and work offline.", signIn: "Sign in", failed: "Sign-in did not work. Try again.", report: "Report a problem" };
const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: { title: "Pantrino", body: "Melde dich mit dem Google-Konto an, das du für Mauroner Tools verwendest. Deine Küchen bleiben dann verschlüsselt auf diesem Telefon und funktionieren auch offline.", signIn: "Anmelden", failed: "Die Anmeldung hat nicht funktioniert. Versuche es erneut.", report: "Problem melden" }
};

export default function SignIn() {
  const { signIn } = useApp();
  const text = useText(TEXT);
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reporting, setReporting] = useState(false);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background, justifyContent: "center", padding: 24 }}>
      <View style={{ alignItems: "center", gap: 16 }}>
        <HueBadge size={72} />
        <T weight="semibold" style={{ fontSize: 34, letterSpacing: -0.6 }}>{text.title}</T>
        <T muted style={{ textAlign: "center", maxWidth: 320 }}>{text.body}</T>
        <Button label={text.signIn} disabled={busy} onPress={async () => {
          setBusy(true);
          setFailed(false);
          try { await signIn(); } catch { setFailed(true); } finally { setBusy(false); }
        }} />
        {failed ? <T style={{ color: colors.destructive }}>{text.failed}</T> : null}
        <Button tone="ghost" compact label={text.report} onPress={() => setReporting(true)} />
      </View>
      <ReportSheet open={reporting} onClose={() => setReporting(false)} signedIn={false} page="/sign-in" />
    </SafeAreaView>
  );
}
