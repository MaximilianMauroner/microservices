import {
  ConflictError,
  ValidationError,
  validateVerdict,
  type Action,
  type AmendVerdictInput,
  type Candidate,
  type RoundKind,
  type Scope,
  type VerdictInput
} from "./types.js";

export function planVerdict(options: {
  kind: RoundKind;
  input: VerdictInput;
  now: Date;
  confirmations: number;
  verdictId?: string | null;
  dueAt?: Date | null;
}) {
  if (options.verdictId) throw new ConflictError("Review round is already decided.");
  if (options.dueAt && options.dueAt > options.now) {
    throw new ConflictError("Review is not due yet.");
  }
  return validateVerdict(options.kind, options.input, options.now, options.confirmations);
}

export function planAmendment(options: {
  kind: RoundKind;
  input: AmendVerdictInput;
  now: Date;
  confirmations: number;
  currentDecisionId?: string | null;
  currentAction?: Action | null;
  currentNextReviewAt?: Date | null;
  hasDecidedDescendant: boolean;
}) {
  const { currentDecisionId, currentAction, input } = options;
  if (!currentDecisionId || !currentAction) {
    throw new ConflictError("Review round has no decision to amend.");
  }
  if (currentDecisionId !== input.expectedDecisionId) {
    throw new ConflictError("Decision changed since it was loaded. Refresh and try again.");
  }
  if (options.hasDecidedDescendant) {
    throw new ConflictError("This decision cannot be amended after a later round was decided.");
  }
  if (currentAction === input.action && input.action !== "defer") {
    throw new ValidationError("Choose a different verdict.");
  }
  const schedule = validateVerdict(options.kind, input, options.now, options.confirmations);
  if (
    input.action === "defer" &&
    currentAction === "defer" &&
    schedule.nextReviewAt?.getTime() === options.currentNextReviewAt?.getTime()
  ) {
    throw new ValidationError("Choose a different defer date.");
  }
  return { currentDecisionId, schedule };
}

export function planScopeReassignment(options: {
  candidate: Candidate;
  round: number;
  kind: RoundKind;
  verdictId?: string | null;
  hasEvents: boolean;
  scope: Scope;
  now: Date;
  reviewer: string;
}): Candidate {
  if (options.round !== 1 || options.kind !== "initial" || options.verdictId || options.hasEvents) {
    throw new ConflictError("Scope can only change before the initial review is decided.");
  }
  const { candidate, scope } = options;
  if (candidate.scope === scope) throw new ValidationError("Candidate already has this scope.");
  const foundProjectKey = candidate.foundProjectKey ?? candidate.projectKey;
  const foundProjectDisplayName = candidate.foundProjectDisplayName ?? candidate.projectDisplayName;
  if (scope === "project" && (!foundProjectKey || !foundProjectDisplayName)) {
    throw new ValidationError("This candidate has no associated project to demote to.");
  }
  const { projectKey: _projectKey, projectDisplayName: _projectDisplayName, ...candidateWithoutProject } = candidate;
  const changed: Candidate = {
    ...candidateWithoutProject,
    scope,
    ...(scope === "project"
      ? { projectKey: foundProjectKey, projectDisplayName: foundProjectDisplayName }
      : {}),
    ...(foundProjectKey && foundProjectDisplayName
      ? { foundProjectKey, foundProjectDisplayName }
      : {}),
    scopeChangedAt: options.now.toISOString(),
    scopeChangedBy: options.reviewer
  };
  return changed;
}
