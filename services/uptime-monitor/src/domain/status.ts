export interface StateInput { status: "checking" | "up" | "down"; consecutiveFailures: number; openIncidentId: number | null }
export interface StateResult { status: "checking" | "up" | "down"; consecutiveFailures: number; transition: "none" | "down" | "recovery" }
export function applyObservation(state: StateInput, success: boolean): StateResult {
  if (success) return { status: "up", consecutiveFailures: 0, transition: state.openIncidentId === null ? "none" : "recovery" };
  const failures = state.consecutiveFailures + 1;
  if (failures >= 2) return { status: "down", consecutiveFailures: failures, transition: state.openIncidentId === null ? "down" : "none" };
  return { status: "checking", consecutiveFailures: failures, transition: "none" };
}
