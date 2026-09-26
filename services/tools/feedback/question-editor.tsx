"use client";

import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Badge } from "../src/components/ui/badge.js";
import { Button } from "../src/components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../src/components/ui/card.js";
import { Input } from "../src/components/ui/input.js";
import { Label } from "../src/components/ui/label.js";
import { NativeSelect, NativeSelectOption } from "../src/components/ui/native-select.js";
import { Textarea } from "../src/components/ui/textarea.js";
import type { FeedbackLanguage, FeedbackQuestion } from "./domain.js";

type QuestionKind = FeedbackQuestion["kind"];

export function FeedbackQuestionEditor({
  questions,
  language,
  onChange,
}: {
  questions: readonly FeedbackQuestion[];
  language: FeedbackLanguage;
  onChange: (questions: readonly FeedbackQuestion[]) => void;
}) {
  const canAdd = questions.length < 20;
  const missingFollowUpQuestions = ["follow_up", "follow_up_contact", "follow_up_context"].filter((id) => !questions.some((question) => question.id === id)).length;
  const questionOption = language === "de" ? "Eine Rückfrage" : "A follow-up question";
  const meetingOption = language === "de" ? "Ein Treffen" : "A meeting";
  const existingFollowUp = questions.find((question) => question.id === "follow_up");
  const missingOptions = existingFollowUp?.kind === "choice" ? [questionOption, meetingOption].filter((option) => !existingFollowUp.options?.includes(option)) : [];
  const canAddFollowUp = questions.length + missingFollowUpQuestions <= 20
    && (!existingFollowUp || (existingFollowUp.kind === "choice" && (existingFollowUp.options?.length ?? 0) + missingOptions.length <= 12))
    && (missingFollowUpQuestions > 0 || missingOptions.length > 0);
  const add = (kind: QuestionKind) => onChange(addFeedbackQuestion(questions, kind));
  const update = (id: string, change: (question: FeedbackQuestion) => FeedbackQuestion) => {
    onChange(questions.map((question) => question.id === id ? change(question) : question));
  };

  return (
    <section className="mt-5" aria-labelledby="feedback-questions-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 id="feedback-questions-title" className="text-sm font-semibold">Questions</h3>
          <p className="mt-1 text-xs text-muted-foreground">{questions.length} of 20 questions</p>
        </div>
        {questions.length ? <QuestionKindButtons disabled={!canAdd} onAdd={add} /> : null}
      </div>
      <Button className="mt-3" variant="outline" size="sm" type="button" disabled={!canAddFollowUp} onClick={() => onChange(addFeedbackFollowUpQuestions(questions, language))}><PlusIcon data-icon="inline-start" />Add follow-up or meeting options</Button>

      {questions.length ? (
        <div className="mt-3 grid gap-3">
          {questions.map((question, index) => (
            <Card className="bg-background/45" key={question.id} size="sm">
              <CardHeader className="grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                  <CardTitle>Question {index + 1}</CardTitle>
                  <Badge className="mt-1 max-w-full font-mono text-[0.65rem]" title={`Response key: ${question.id}`} variant="outline">Response key: {question.id}</Badge>
                </div>
                <div className="flex items-center gap-1.5 self-end sm:self-auto">
                  <Button variant="outline" size="icon-sm" type="button" title="Move up" aria-label={`Move question ${index + 1} up`} disabled={index === 0} onClick={() => onChange(moveFeedbackQuestion(questions, index, -1))}><ArrowUpIcon /></Button>
                  <Button variant="outline" size="icon-sm" type="button" title="Move down" aria-label={`Move question ${index + 1} down`} disabled={index === questions.length - 1} onClick={() => onChange(moveFeedbackQuestion(questions, index, 1))}><ArrowDownIcon /></Button>
                  <Button variant="destructive-subtle" size="icon-sm" type="button" title="Remove question" aria-label={`Remove question ${index + 1}`} onClick={() => onChange(questions.filter(({ id }) => id !== question.id))}><Trash2Icon /></Button>
                </div>
              </CardHeader>

              <CardContent>
                <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <div className="grid content-start gap-1.5">
                    <Label htmlFor={`${question.id}-kind`}>Answer type</Label>
                    <NativeSelect className="w-full" id={`${question.id}-kind`} value={question.kind} onChange={(event) => update(question.id, (current) => changeFeedbackQuestionKind(current, event.target.value as QuestionKind))}>
                      <NativeSelectOption value="choice">Choice</NativeSelectOption>
                      <NativeSelectOption value="short_text">Short answer</NativeSelectOption>
                      <NativeSelectOption value="long_text">Long answer</NativeSelectOption>
                    </NativeSelect>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${question.id}-prompt`}>Question</Label>
                    <Textarea id={`${question.id}-prompt`} className="min-h-20 resize-y" maxLength={300} placeholder="Write the question" value={question.prompt} onChange={(event) => update(question.id, (current) => ({ ...current, prompt: event.target.value }))} />
                  </div>
                </div>

                {question.kind === "choice" ? (
                  <div className="mt-1 border-t pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <Label>Choice options</Label>
                      <Badge variant="secondary">{question.options?.length ?? 0} of 12</Badge>
                    </div>
                    <div className="mt-2 grid gap-2">
                      {(question.options ?? []).map((option, optionIndex) => (
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2" key={`${question.id}:${optionIndex}`}>
                          <Input maxLength={120} aria-label={`Option ${optionIndex + 1} for question ${index + 1}`} placeholder={`Option ${optionIndex + 1}`} value={option} onChange={(event) => update(question.id, (current) => ({ ...current, options: current.options?.map((item, currentIndex) => currentIndex === optionIndex ? event.target.value : item) }))} />
                          <Button variant="destructive-subtle" size="icon-sm" type="button" title="Remove option" disabled={(question.options?.length ?? 0) <= 2} aria-label={`Remove option ${optionIndex + 1}`} onClick={() => update(question.id, (current) => ({ ...current, options: current.options?.filter((_, currentIndex) => currentIndex !== optionIndex) }))}><Trash2Icon /></Button>
                        </div>
                      ))}
                    </div>
                    <Button className="mt-2" variant="outline" size="sm" type="button" disabled={(question.options?.length ?? 0) >= 12} onClick={() => update(question.id, (current) => ({ ...current, options: [...(current.options ?? []), ""] }))}><PlusIcon data-icon="inline-start" />Add option</Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="mt-3 min-h-52 border-dashed bg-background/45 shadow-none">
          <CardContent className="grid flex-1 place-items-center p-6 text-center">
            <div>
              <div className="mx-auto grid size-12 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-2xl text-primary" aria-hidden="true">+</div>
              <h3 className="mt-3 font-semibold text-foreground">Build the questions here</h3>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Add them manually, or paste a generated schema later.</p>
              <div className="mt-4"><QuestionKindButtons disabled={!canAdd} onAdd={add} /></div>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

export function addFeedbackFollowUpQuestions(questions: readonly FeedbackQuestion[], language: FeedbackLanguage): readonly FeedbackQuestion[] {
  const de = language === "de";
  const questionOption = de ? "Eine Rückfrage" : "A follow-up question";
  const meetingOption = de ? "Ein Treffen" : "A meeting";
  const ids = new Set(questions.map((question) => question.id));
  const existingFollowUp = questions.find((question) => question.id === "follow_up");
  const missingOptions = existingFollowUp?.kind === "choice" ? [questionOption, meetingOption].filter((option) => !existingFollowUp.options?.includes(option)) : [];
  if (existingFollowUp && (existingFollowUp.kind !== "choice" || (existingFollowUp.options?.length ?? 0) + missingOptions.length > 12)) return questions;
  const additions: FeedbackQuestion[] = [
    ...(!ids.has("follow_up") ? [{ id: "follow_up", kind: "choice" as const, prompt: de ? "Möchtest du eine Rückfrage oder ein Treffen?" : "Would you like a follow-up question or a meeting?", options: de ? ["Nein, danke", questionOption, meetingOption] : ["No, thanks", questionOption, meetingOption] }] : []),
    ...(!ids.has("follow_up_contact") ? [{ id: "follow_up_contact", kind: "short_text" as const, prompt: de ? "Wie kann ich dich dafür erreichen?" : "How can I reach you for that?" }] : []),
    ...(!ids.has("follow_up_context") ? [{ id: "follow_up_context", kind: "long_text" as const, prompt: de ? "Welche Frage oder weitere Information möchtest du vor einem Treffen mitteilen?" : "What question or other information would you like to share before a meeting?" }] : []),
  ];
  if (questions.length + additions.length > 20) return questions;
  const expanded = questions.map((question) => question.id === "follow_up" && question.kind === "choice" && missingOptions.length
    ? { ...question, options: [...(question.options ?? []), ...missingOptions] }
    : question);
  if (!additions.length && expanded.every((question, index) => question === questions[index])) return questions;
  return [...expanded, ...additions];
}

function QuestionKindButtons({ disabled, onAdd }: { disabled: boolean; onAdd: (kind: QuestionKind) => void }) {
  return (
    <div className="grid w-full grid-cols-1 gap-2 min-[520px]:grid-cols-3 sm:w-auto" aria-label="Add question">
      <Button variant="outline" size="sm" type="button" disabled={disabled} onClick={() => onAdd("choice")}><PlusIcon data-icon="inline-start" />Add choice</Button>
      <Button variant="outline" size="sm" type="button" disabled={disabled} onClick={() => onAdd("short_text")}><PlusIcon data-icon="inline-start" />Add short answer</Button>
      <Button variant="outline" size="sm" type="button" disabled={disabled} onClick={() => onAdd("long_text")}><PlusIcon data-icon="inline-start" />Add long answer</Button>
    </div>
  );
}

export function addFeedbackQuestion(questions: readonly FeedbackQuestion[], kind: QuestionKind): readonly FeedbackQuestion[] {
  if (questions.length >= 20) return questions;
  const id = nextQuestionId(questions);
  const question: FeedbackQuestion = kind === "choice"
    ? { id, kind, prompt: "", options: ["", ""] }
    : { id, kind, prompt: "" };
  return [...questions, question];
}

export function changeFeedbackQuestionKind(question: FeedbackQuestion, kind: QuestionKind): FeedbackQuestion {
  if (kind === "choice") {
    return { id: question.id, kind, prompt: question.prompt, options: question.kind === "choice" ? question.options ?? ["", ""] : ["", ""] };
  }
  return { id: question.id, kind, prompt: question.prompt };
}

export function moveFeedbackQuestion(questions: readonly FeedbackQuestion[], index: number, offset: -1 | 1): readonly FeedbackQuestion[] {
  const target = index + offset;
  if (index < 0 || index >= questions.length || target < 0 || target >= questions.length) return questions;
  const reordered = [...questions];
  const [question] = reordered.splice(index, 1);
  reordered.splice(target, 0, question!);
  return reordered;
}

function nextQuestionId(questions: readonly FeedbackQuestion[]) {
  const ids = new Set(questions.map(({ id }) => id));
  let index = 1;
  while (ids.has(`question_${index}`)) index += 1;
  return `question_${index}`;
}
