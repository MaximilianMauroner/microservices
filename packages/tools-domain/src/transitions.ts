import type {
  CheckObservation,
  Incident,
  MonitorState,
  NotificationDelivery,
  ObservationTransition
} from "./types.js";

export interface TransitionIds {
  incidentId: string;
}

export function applyObservation(
  current: MonitorState,
  observation: CheckObservation,
  ids: TransitionIds,
  openIncident: Incident | null
): ObservationTransition {
  if (current.status === "paused") {
    throw new Error("Cannot apply an observation to a paused monitor");
  }

  if (observation.success) {
    const resolvedIncident =
      current.openIncidentId === null
        ? null
        : {
            ...requireOpenIncident(current, openIncident),
            resolvedAt: observation.checkedAt,
            closingObservationId: observation.id
          };
    return {
      monitor: {
        ...current,
        status: "up",
        consecutiveFailures: 0,
        latestObservation: observation,
        openIncidentId: null
      },
      openedIncident: null,
      resolvedIncident,
      queuedNotification: resolvedIncident
        ? pendingNotification(resolvedIncident, "recovery", observation.checkedAt)
        : null
    };
  }

  const consecutiveFailures = current.consecutiveFailures + 1;
  if (consecutiveFailures < 2) {
    return {
      monitor: {
        ...current,
        status: "checking",
        consecutiveFailures,
        latestObservation: observation
      },
      openedIncident: null,
      resolvedIncident: null,
      queuedNotification: null
    };
  }

  if (current.openIncidentId !== null) {
    return {
      monitor: {
        ...current,
        status: "down",
        consecutiveFailures,
        latestObservation: observation
      },
      openedIncident: null,
      resolvedIncident: null,
      queuedNotification: null
    };
  }

  const incident: Incident = {
    id: ids.incidentId,
    monitorId: current.monitorId,
    startedAt: observation.checkedAt,
    openingObservationId: observation.id,
    resolvedAt: null,
    closingObservationId: null
  };
  return {
    monitor: {
      ...current,
      status: "down",
      consecutiveFailures,
      latestObservation: observation,
      openIncidentId: incident.id
    },
    openedIncident: incident,
    resolvedIncident: null,
    queuedNotification: pendingNotification(
      incident,
      "down",
      observation.checkedAt
    )
  };
}

function pendingNotification(
  incident: Incident,
  kind: NotificationDelivery["kind"],
  nextAttemptAt: string
): Omit<NotificationDelivery, "id"> {
  return {
    incidentId: incident.id,
    kind,
    status: "pending",
    attempts: 0,
    nextAttemptAt,
    displayName: null,
    claimToken: null,
    claimedUntil: null,
    deliveredAt: null,
    lastErrorCode: null
  };
}

function requireOpenIncident(
  current: MonitorState,
  incident: Incident | null
): Incident {
  if (
    !incident ||
    incident.id !== current.openIncidentId ||
    incident.monitorId !== current.monitorId ||
    incident.resolvedAt !== null
  ) {
    throw new Error("Open incident state is inconsistent");
  }
  return incident;
}
