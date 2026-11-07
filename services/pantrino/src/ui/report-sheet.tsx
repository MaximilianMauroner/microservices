import { Bug, Lightbulb } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { sendReport, type Report } from "../sync/api";
import { Button, Field, Sheet, T } from "./kit";
import { useText } from "./language";
import { checkReport, outcomeMessage, REPORT_LIMIT, TEXT } from "./report-text";
import { useColors } from "./theme";

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
    const report = { kind, message: message.trim(), ...(details.trim() ? { details: details.trim() } : {}), page, ...(!signedIn && email.trim() ? { contactEmail: email.trim() } : {}) };
    const refused = checkReport(report);
    if (refused) { setState({ error: text.rejections[refused] }); return; }
    setState("sending");
    const outcome = await sendReport(report, signedIn);
    if (outcome.kind !== "sent") { setState({ error: outcomeMessage(outcome, text) }); return; }
    setMessage(""); setDetails(""); setEmail(""); setState("sent");
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
          multiline maxLength={REPORT_LIMIT} style={{ minHeight: 120, textAlignVertical: "top" }} />
        <Field value={details} onChangeText={setDetails} placeholder={kind === "bug" ? text.bugDetails : text.featureDetails} accessibilityLabel={kind === "bug" ? text.bugDetails : text.featureDetails}
          multiline maxLength={REPORT_LIMIT} style={{ minHeight: 80, textAlignVertical: "top" }} />
        {signedIn ? null : <Field value={email} onChangeText={setEmail} placeholder={text.email} accessibilityLabel={text.email} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />}
        {typeof state === "object" ? <T style={{ color: colors.destructive }}>{state.error}</T> : null}
      </>}
    </Sheet>
  );
}
