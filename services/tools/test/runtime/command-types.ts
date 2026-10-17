export type StopSignal = "SIGINT" | "SIGTERM";

export type OwnerReason = "cancelled" | "scope-closed" | "owner-limit" | "anchor-failed";

export type Termination =
  | Readonly<{ kind: "natural" }>
  | Readonly<{ kind: "deadline"; limitMs: number }>
  | Readonly<{ kind: "interrupted"; signal: StopSignal }>
  | Readonly<{ kind: "owner"; reason: OwnerReason }>;

export type ExitObservation =
  | Readonly<{ kind: "exited"; code: number }>
  | Readonly<{ kind: "signalled"; signal: string }>
  | Readonly<{ kind: "unavailable"; reason: string }>;

export type LogState =
  | Readonly<{ kind: "written"; path: string }>
  | Readonly<{ kind: "failed"; path: string; reason: string }>;

export type CommandOutcome =
  | Readonly<{ kind: "succeeded"; stdout: string; log: string }>
  | Readonly<{
      kind: "failed" | "blocked";
      termination: Termination;
      exit: ExitObservation;
      escalation: "none" | "term" | "kill";
      ownership: "released" | "uncertain";
      log: LogState;
      reasons: readonly string[];
    }>
  | Readonly<{ kind: "not-started"; reason: "interrupted" | "cancelled" | "deadline" | "scope-closed" }>;

export type CommandSpec = Readonly<{
  command: string;
  args: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
  deadlineMs: number;
  log: string;
  signal?: AbortSignal;
  redact?: (text: string) => string;
}>;

export interface CommandExecutor {
  execute(spec: CommandSpec): Promise<CommandOutcome>;
}
