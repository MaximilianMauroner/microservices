import { describe, expect, it } from "vitest";
import {
  applyObservation,
  type CheckObservation,
  type Incident,
  type MonitorState
} from "../src/index.js";

const firstFailure: CheckObservation = {
  id: "observation-1",
  runId: "run-1",
  checkedAt: "2026-07-27T12:00:00.000Z",
  success: false,
  statusCode: 503,
  latencyMs: 100,
  errorCode: "http_error"
};
const initial: MonitorState = {
  monitorId: "monitor-1",
  status: "up",
  consecutiveFailures: 0,
  latestObservation: null,
  openIncidentId: null
};

describe("monitor transitions", () => {
  it("moves the first failure to checking without opening an incident", () => {
    const result = applyObservation(
      initial,
      firstFailure,
      { incidentId: "incident-1" },
      null
    );
    expect(result.monitor.status).toBe("checking");
    expect(result.monitor.consecutiveFailures).toBe(1);
    expect(result.openedIncident).toBeNull();
    expect(result.queuedNotification).toBeNull();
  });

  it("opens an incident and down notification on the second failure", () => {
    const checking = applyObservation(
      initial,
      firstFailure,
      { incidentId: "incident-1" },
      null
    ).monitor;
    const secondFailure = {
      ...firstFailure,
      id: "observation-2",
      checkedAt: "2026-07-27T12:05:00.000Z"
    };
    const result = applyObservation(
      checking,
      secondFailure,
      { incidentId: "incident-1" },
      null
    );
    expect(result.monitor).toMatchObject({
      status: "down",
      consecutiveFailures: 2,
      openIncidentId: "incident-1"
    });
    expect(result.openedIncident).toMatchObject({
      id: "incident-1",
      openingObservationId: "observation-2",
      resolvedAt: null
    });
    expect(result.queuedNotification).toMatchObject({
      kind: "down",
      status: "pending"
    });
  });

  it("resolves the persisted incident on one success", () => {
    const incident: Incident = {
      id: "incident-1",
      monitorId: "monitor-1",
      startedAt: "2026-07-27T12:05:00.000Z",
      openingObservationId: "observation-2",
      resolvedAt: null,
      closingObservationId: null
    };
    const down: MonitorState = {
      ...initial,
      status: "down",
      consecutiveFailures: 4,
      latestObservation: {
        ...firstFailure,
        id: "observation-4",
        checkedAt: "2026-07-27T12:15:00.000Z"
      },
      openIncidentId: incident.id
    };
    const success: CheckObservation = {
      id: "observation-5",
      runId: "run-1",
      checkedAt: "2026-07-27T12:20:00.000Z",
      success: true,
      statusCode: 200,
      latencyMs: 40,
      errorCode: null
    };
    const result = applyObservation(
      down,
      success,
      { incidentId: "unused" },
      incident
    );
    expect(result.monitor).toMatchObject({
      status: "up",
      consecutiveFailures: 0,
      openIncidentId: null
    });
    expect(result.resolvedIncident).toEqual({
      ...incident,
      resolvedAt: success.checkedAt,
      closingObservationId: success.id
    });
    expect(result.queuedNotification?.kind).toBe("recovery");
  });

  it("rejects observations for paused or inconsistent monitor state", () => {
    expect(() =>
      applyObservation(
        { ...initial, status: "paused" },
        firstFailure,
        { incidentId: "incident-1" },
        null
      )
    ).toThrow(/paused/);
    expect(() =>
      applyObservation(
        { ...initial, status: "down", openIncidentId: "incident-1" },
        { ...firstFailure, success: true, errorCode: null },
        { incidentId: "unused" },
        null
      )
    ).toThrow(/inconsistent/);
  });
});
