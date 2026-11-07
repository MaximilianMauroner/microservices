import { Bug, Lightbulb } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { Offline } from "../auth/session";
import { ReportRefused, sendReport, type Report } from "../sync/api";
import { Button, Field, Sheet, T } from "./kit";
import { type KitchenLanguage, useText } from "./language";
import { useColors } from "./theme";

const en = {
  title: "Report a problem or idea",
  description: "The developer reads every report. The app version and phone type are sent with it.",
  bug: "Problem",
  feature: "Idea",
  bugPrompt: "What went wrong? What did you expect?",
  featurePrompt: "What should Pantrino do that it does not do now?",
  bugDetails: "How can the developer make it happen again? (optional)",
  featureDetails: "Why would it help you? (optional)",
  email: "Your email for a reply (optional)",
  send: "Send",
  sending: "Sending…",
  sent: "Thanks. Your report was sent.",
  offline: "You are offline. Connect to the internet and send it again.",
  failed: "The report could not be sent. Try again."
};
const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: {
    title: "Problem oder Idee melden",
    description: "Der Entwickler liest jede Meldung. Die App-Version und der Telefontyp werden mitgesendet.",
    bug: "Problem",
    feature: "Idee",
    bugPrompt: "Was ist schiefgegangen? Was hast du erwartet?",
    featurePrompt: "Was soll Pantrino können, das es jetzt nicht kann?",
    bugDetails: "Wie kann der Entwickler es nachstellen? (optional)",
    featureDetails: "Warum würde es dir helfen? (optional)",
    email: "Deine E-Mail für eine Antwort (optional)",
    send: "Senden",
    sending: "Wird gesendet…",
    sent: "Danke. Deine Meldung wurde gesendet.",
    offline: "Du bist offline. Verbinde dich mit dem Internet und sende sie noch einmal.",
    failed: "Die Meldung konnte nicht gesendet werden. Versuche es erneut."
  }
};

/** A sheet to send a bug report or an idea. Signed out, it also asks for an optional email so the developer can reply. */
export function ReportSheet({ open, onClose, signedIn, page }: { open: boolean; onClose: () => void; signedIn: boolean; page: string }) {
  const text = useText(TEXT);
  const colors = useColors();
  const [kind, setKind] = useState<Report["kind"]>("bug");
  const [message, setMessage] = useState("");
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | { error: string }>("idle");

  async function send() {
    setState("sending");
    try {
      await sendReport({ kind, message: message.trim(), ...(details.trim() ? { details: details.trim() } : {}), page, ...(!signedIn && email.trim() ? { contactEmail: email.trim() } : {}) }, signedIn);
      setMessage(""); setDetails(""); setEmail(""); setState("sent");
    } catch (error) {
      setState({ error: error instanceof Offline ? text.offline : error instanceof ReportRefused ? error.message : text.failed });
    }
  }

  const close = () => { onClose(); if (state !== "sending") setState("idle"); };
  return (
    <Sheet open={open} onClose={close} title={text.title} description={text.description}
      footer={state === "sent" ? <Button label="OK" wide onPress={close} /> : <Button label={state === "sending" ? text.sending : text.send} wide disabled={state === "sending" || !message.trim()} onPress={() => void send()} />}>
      {state === "sent" ? <T>{text.sent}</T> : <>
        <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 8 }}>
          <Button tone={kind === "bug" ? "primary" : "outline"} icon={Bug} label={text.bug} onPress={() => setKind("bug")} />
          <Button tone={kind === "feature" ? "primary" : "outline"} icon={Lightbulb} label={text.feature} onPress={() => setKind("feature")} />
        </View>
        <Field value={message} onChangeText={setMessage} placeholder={kind === "bug" ? text.bugPrompt : text.featurePrompt} accessibilityLabel={kind === "bug" ? text.bugPrompt : text.featurePrompt}
          multiline maxLength={4000} style={{ minHeight: 120, textAlignVertical: "top" }} />
        <Field value={details} onChangeText={setDetails} placeholder={kind === "bug" ? text.bugDetails : text.featureDetails} accessibilityLabel={kind === "bug" ? text.bugDetails : text.featureDetails}
          multiline maxLength={4000} style={{ minHeight: 80, textAlignVertical: "top" }} />
        {signedIn ? null : <Field value={email} onChangeText={setEmail} placeholder={text.email} accessibilityLabel={text.email} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />}
        {typeof state === "object" ? <T style={{ color: colors.destructive }}>{state.error}</T> : null}
      </>}
    </Sheet>
  );
}
