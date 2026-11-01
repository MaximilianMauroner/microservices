"use client";

import { MoreHorizontalIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "../src/components/ui/button.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../src/components/ui/dropdown-menu.js";
import { Input } from "../src/components/ui/input.js";
import { NativeSelect, NativeSelectOption } from "../src/components/ui/native-select.js";
import type { FeedbackLanguage, FeedbackQuestion } from "./domain.js";

type QuestionKind = FeedbackQuestion["kind"];

const MAXIMUM_QUESTIONS = 20;
const MINIMUM_OPTIONS = 2;
const MAXIMUM_OPTIONS = 12;

export function FeedbackQuestionEditor({
  questions,
  language,
  onChange,
}: {
  questions: readonly FeedbackQuestion[];
  language: FeedbackLanguage;
  onChange: (questions: readonly FeedbackQuestion[]) => void;
}) {
  const canAdd = questions.length < MAXIMUM_QUESTIONS;
  const canAddFollowUp = addFeedbackFollowUpQuestions(questions, language) !== questions;
  const update = (id: string, change: (question: FeedbackQuestion) => FeedbackQuestion) => {
    onChange(questions.map((question) => question.id === id ? change(question) : question));
  };

  return (
    <section className="rounded-xl border bg-card" aria-labelledby="feedback-questions-title">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <h2 id="feedback-questions-title" className="text-sm font-semibold">Questions <span className="font-medium text-muted-foreground">{questions.length} of {MAXIMUM_QUESTIONS}</span></h2>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={!canAdd && !canAddFollowUp} />}><PlusIcon data-icon="inline-start" />Add question</DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem disabled={!canAdd} onClick={() => onChange(addFeedbackQuestion(questions, "choice"))}>Choice<span className="ml-auto text-xs text-muted-foreground">2–12 options</span></DropdownMenuItem>
            <DropdownMenuItem disabled={!canAdd} onClick={() => onChange(addFeedbackQuestion(questions, "short_text"))}>Short answer<span className="ml-auto text-xs text-muted-foreground">300 characters</span></DropdownMenuItem>
            <DropdownMenuItem disabled={!canAdd} onClick={() => onChange(addFeedbackQuestion(questions, "long_text"))}>Long answer<span className="ml-auto text-xs text-muted-foreground">4,000 characters</span></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!canAddFollowUp} onClick={() => onChange(addFeedbackFollowUpQuestions(questions, language))}>Follow-up or meeting</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid gap-2 px-4 pt-2.5 pb-3.5">
        {questions.length ? questions.map((question, index) => {
          const number = index + 1;
          const options = question.options ?? [];
          return (
            <div className="min-w-0 rounded-xl border bg-card" key={question.id}>
              <div className="flex items-center gap-2 border-b border-border/60 py-1.5 pr-1.5 pl-3">
                <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">{number}</span>
                <NativeSelect size="sm" className="w-36 shrink-0" aria-label={`Answer type for question ${number}`} value={question.kind} onChange={(event) => update(question.id, (current) => changeFeedbackQuestionKind(current, event.target.value as QuestionKind))}>
                  <NativeSelectOption value="choice">Choice</NativeSelectOption>
                  <NativeSelectOption value="short_text">Short answer</NativeSelectOption>
                  <NativeSelectOption value="long_text">Long answer</NativeSelectOption>
                </NativeSelect>
                <span className="min-w-0 flex-1 truncate text-right font-mono text-xs text-muted-foreground max-sm:hidden" title={`Response key: ${question.id}`}>{question.id}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button className="ml-auto" variant="ghost" size="icon-sm" aria-label={`Actions for question ${number}`} />}><MoreHorizontalIcon /></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem disabled={index === 0} onClick={() => onChange(moveFeedbackQuestion(questions, index, -1))}>Move up</DropdownMenuItem>
                    <DropdownMenuItem disabled={index === questions.length - 1} onClick={() => onChange(moveFeedbackQuestion(questions, index, 1))}>Move down</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => onChange(questions.filter(({ id }) => id !== question.id))}>Remove</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="grid gap-2 px-3 py-2.5">
                <Input aria-label={`Question ${number}`} maxLength={300} placeholder="Write the question" value={question.prompt} onChange={(event) => update(question.id, (current) => ({ ...current, prompt: event.target.value }))} />
                {question.kind === "choice" ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {options.map((option, optionIndex) => (
                      <span className="inline-flex h-7 max-w-full min-w-0 items-center gap-0.5 rounded-lg border border-control-border bg-field pr-0.5 pl-2.5 text-[0.8125rem] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50" key={`${question.id}:${optionIndex}`}>
                        <input className="field-sizing-content min-w-16 max-w-full bg-transparent outline-none placeholder:text-muted-foreground" size={Math.max(option.length, 8)} maxLength={120} aria-label={`Option ${optionIndex + 1} for question ${number}`} placeholder={`Option ${optionIndex + 1}`} value={option} onChange={(event) => update(question.id, (current) => ({ ...current, options: current.options?.map((item, currentIndex) => currentIndex === optionIndex ? event.target.value : item) }))} />
                        <button type="button" className="grid size-5 shrink-0 place-items-center rounded-[5px] text-muted-foreground hover:bg-control-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40" title="Remove option" aria-label={`Remove option ${optionIndex + 1} for question ${number}`} disabled={options.length <= MINIMUM_OPTIONS} onClick={() => update(question.id, (current) => ({ ...current, options: current.options?.filter((_, currentIndex) => currentIndex !== optionIndex) }))}><XIcon className="size-3" /></button>
                      </span>
                    ))}
                    <Button variant="ghost" size="sm" type="button" disabled={options.length >= MAXIMUM_OPTIONS} onClick={() => update(question.id, (current) => ({ ...current, options: [...(current.options ?? []), ""] }))}><PlusIcon data-icon="inline-start" />Option</Button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        }) : (
          <div className="grid min-h-36 place-items-center rounded-xl border border-dashed p-6 text-center">
            <div>
              <p className="font-medium">No questions yet</p>
              <p className="mt-1 text-[0.8125rem] text-muted-foreground">Use Add question, or apply a schema from the form menu.</p>
            </div>
          </div>
        )}
      </div>
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
  if (existingFollowUp && (existingFollowUp.kind !== "choice" || (existingFollowUp.options?.length ?? 0) + missingOptions.length > MAXIMUM_OPTIONS)) return questions;
  const additions: FeedbackQuestion[] = [
    ...(!ids.has("follow_up") ? [{ id: "follow_up", kind: "choice" as const, prompt: de ? "Möchtest du eine Rückfrage oder ein Treffen?" : "Would you like a follow-up question or a meeting?", options: de ? ["Nein, danke", questionOption, meetingOption] : ["No, thanks", questionOption, meetingOption] }] : []),
    ...(!ids.has("follow_up_contact") ? [{ id: "follow_up_contact", kind: "short_text" as const, prompt: de ? "Wie kann ich dich dafür erreichen?" : "How can I reach you for that?" }] : []),
    ...(!ids.has("follow_up_context") ? [{ id: "follow_up_context", kind: "long_text" as const, prompt: de ? "Welche Frage oder weitere Information möchtest du vor einem Treffen mitteilen?" : "What question or other information would you like to share before a meeting?" }] : []),
  ];
  if (questions.length + additions.length > MAXIMUM_QUESTIONS) return questions;
  const expanded = questions.map((question) => question.id === "follow_up" && question.kind === "choice" && missingOptions.length
    ? { ...question, options: [...(question.options ?? []), ...missingOptions] }
    : question);
  if (!additions.length && expanded.every((question, index) => question === questions[index])) return questions;
  return [...expanded, ...additions];
}

export function addFeedbackQuestion(questions: readonly FeedbackQuestion[], kind: QuestionKind): readonly FeedbackQuestion[] {
  if (questions.length >= MAXIMUM_QUESTIONS) return questions;
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
