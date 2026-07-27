type LogValue = string | number | boolean | null;
export type SafeLogFields = Readonly<Record<string, LogValue>>;

export interface SafeLogger {
  info(event: string, fields?: SafeLogFields): void;
  error(event: string, fields?: SafeLogFields): void;
}

export const consoleLogger: SafeLogger = {
  info(event, fields = {}) {
    console.log(JSON.stringify({ level: "info", event, ...fields }));
  },
  error(event, fields = {}) {
    console.error(JSON.stringify({ level: "error", event, ...fields }));
  }
};
