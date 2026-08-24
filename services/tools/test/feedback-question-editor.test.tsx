import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  FeedbackQuestionEditor,
  addFeedbackQuestion,
  changeFeedbackQuestionKind,
  moveFeedbackQuestion,
} from "../feedback/question-editor.js";
import type { FeedbackQuestion } from "../feedback/domain.js";

describe("manual feedback question editor", () => {
  it("offers every question kind when the form is empty", () => {
    const html = renderToStaticMarkup(<FeedbackQuestionEditor questions={[]} onChange={vi.fn()} />);

    expect(html).toContain("Add choice");
    expect(html).toContain("Add short answer");
    expect(html).toContain("Add long answer");
    expect(html).toContain("Build the questions here");
    expect(html).toContain('data-slot="button"');
    expect(html).toContain('data-slot="card"');
  });

  it("uses the shared form controls for an editable question", () => {
    const questions = [{ id: "question_1", kind: "choice", prompt: "How was it?", options: ["Good", "Bad"] }] satisfies readonly FeedbackQuestion[];
    const html = renderToStaticMarkup(<FeedbackQuestionEditor questions={questions} onChange={vi.fn()} />);

    expect(html).toContain('data-slot="native-select"');
    expect(html).toContain('data-slot="textarea"');
    expect(html).toContain('data-slot="input"');
    expect(html).toContain('data-slot="label"');
    expect(html).toContain('data-slot="badge"');
  });

  it("creates stable unique IDs and the required choice slots", () => {
    const first = addFeedbackQuestion([], "short_text");
    const second = addFeedbackQuestion(first, "choice");

    expect(first[0]).toMatchObject({ id: "question_1", kind: "short_text", prompt: "" });
    expect(second[1]).toMatchObject({ id: "question_2", kind: "choice", options: ["", ""] });
  });

  it("changes type without changing the response key", () => {
    const question = { id: "question_1", kind: "short_text", prompt: "What happened?" } satisfies FeedbackQuestion;

    expect(changeFeedbackQuestionKind(question, "choice")).toEqual({
      id: "question_1",
      kind: "choice",
      prompt: "What happened?",
      options: ["", ""],
    });
  });

  it("reorders questions without changing their IDs", () => {
    const questions = [
      { id: "first", kind: "short_text", prompt: "First" },
      { id: "second", kind: "long_text", prompt: "Second" },
    ] satisfies readonly FeedbackQuestion[];

    expect(moveFeedbackQuestion(questions, 1, -1).map(({ id }) => id)).toEqual(["second", "first"]);
  });
});
