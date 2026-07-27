import type {
  CatalogDocument,
  CheckerStateDocument,
  Incident,
  NotificationDelivery
} from "@tools-platform/domain";

export interface NotificationDrainResult {
  state: CheckerStateDocument;
  etag: string;
  attempted: number;
}

export interface NotificationDrainOptions {
  expectedEtag: string;
  maxAttempts: number;
  persist(
    state: CheckerStateDocument,
    expectedEtag: string,
    signal?: AbortSignal
  ): Promise<string>;
  signal?: AbortSignal;
}

export async function drainNotifications(
  state: CheckerStateDocument,
  catalog: CatalogDocument,
  webhookUrl: string | undefined,
  options: NotificationDrainOptions,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date()
): Promise<NotificationDrainResult> {
  if (!webhookUrl) {
    return { state, etag: options.expectedEtag, attempted: 0 };
  }

  let currentState = state;
  let currentEtag = options.expectedEtag;
  let attempted = 0;
  for (
    let index = 0;
    index < currentState.notifications.length &&
    attempted < options.maxAttempts;
    index += 1
  ) {
    options.signal?.throwIfAborted();
    const delivery = currentState.notifications[index];
    const currentTime = now();
    if (
      delivery.status === "delivered" ||
      (delivery.nextAttemptAt !== null &&
        Date.parse(delivery.nextAttemptAt) > currentTime.getTime()) ||
      (delivery.claimedUntil !== null &&
        Date.parse(delivery.claimedUntil) > currentTime.getTime())
    ) {
      continue;
    }
    const incident = currentState.incidents.find(
      ({ id }) => id === delivery.incidentId
    );
    if (!incident) {
      currentState = withoutNotification(currentState, delivery.id, currentTime);
      currentEtag = await options.persist(
        currentState,
        currentEtag,
        options.signal
      );
      continue;
    }
    const entry = catalog.entries.find(({ id }) => id === incident.monitorId);
    const displayName = delivery.displayName ?? entry?.name ?? incident.monitorId;
    const claimToken = crypto.randomUUID();
    const claimed: NotificationDelivery = {
      ...delivery,
      displayName,
      attempts: delivery.attempts + 1,
      claimToken,
      claimedUntil: new Date(currentTime.getTime() + 30_000).toISOString()
    };
    currentState = replaceNotification(currentState, claimed, currentTime);
    currentEtag = await options.persist(
      currentState,
      currentEtag,
      options.signal
    );

    attempted += 1;
    const result = await deliver(
      claimed,
      incident,
      displayName,
      webhookUrl,
      fetcher,
      currentTime,
      options.signal
    );
    currentState = replaceNotification(currentState, result, now());
    currentEtag = await options.persist(
      currentState,
      currentEtag,
      options.signal
    );
  }
  return {
    state: currentState,
    etag: currentEtag,
    attempted
  };
}

export function retryDelaySeconds(
  response: Response,
  attempts: number,
  nowMs: number
): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Math.min(3600, Math.max(1, seconds));
    }
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) {
      return Math.min(
        3600,
        Math.max(1, Math.ceil((date - nowMs) / 1000))
      );
    }
  }
  return backoffSeconds(attempts);
}

async function deliver(
  delivery: NotificationDelivery,
  incident: Incident,
  name: string,
  webhookUrl: string,
  fetcher: typeof fetch,
  now: Date,
  outerSignal?: AbortSignal
): Promise<NotificationDelivery> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const signal = outerSignal
    ? AbortSignal.any([controller.signal, outerSignal])
    : controller.signal;
  let response: Response;
  try {
    response = await fetcher(withWait(webhookUrl), {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title:
              delivery.kind === "down"
                ? `${name} is down`
                : `${name} recovered`,
            description:
              delivery.kind === "down"
                ? `Incident opened at ${incident.startedAt}.`
                : `Incident resolved at ${incident.resolvedAt ?? now.toISOString()}.`,
            color: delivery.kind === "down" ? 0xc0392b : 0x238636
          }
        ]
      })
    });
  } catch {
    return failedDelivery(
      delivery,
      now,
      backoffSeconds(delivery.attempts),
      "discord_network_error"
    );
  } finally {
    clearTimeout(timer);
  }

  await response.body?.cancel();
  if (response.ok) {
    return {
      ...delivery,
      status: "delivered",
      nextAttemptAt: null,
      claimToken: null,
      claimedUntil: null,
      deliveredAt: now.toISOString(),
      lastErrorCode: null
    };
  }
  return failedDelivery(
    delivery,
    now,
    retryDelaySeconds(response, delivery.attempts, now.getTime()),
    `discord_http_${response.status}`
  );
}

function failedDelivery(
  delivery: NotificationDelivery,
  now: Date,
  delaySeconds: number,
  errorCode: string
): NotificationDelivery {
  return {
    ...delivery,
    nextAttemptAt: new Date(
      now.getTime() + delaySeconds * 1000
    ).toISOString(),
    claimToken: null,
    claimedUntil: null,
    deliveredAt: null,
    lastErrorCode: errorCode
  };
}

function backoffSeconds(attempts: number): number {
  return Math.min(3600, 2 ** Math.min(attempts, 10) * 5);
}

function withWait(webhookUrl: string): string {
  return `${webhookUrl}${webhookUrl.includes("?") ? "&" : "?"}wait=true`;
}

function replaceNotification(
  state: CheckerStateDocument,
  delivery: NotificationDelivery,
  now: Date
): CheckerStateDocument {
  return {
    ...state,
    updatedAt: now.toISOString(),
    notifications: state.notifications.map((candidate) =>
      candidate.id === delivery.id ? delivery : candidate
    )
  };
}

function withoutNotification(
  state: CheckerStateDocument,
  id: string,
  now: Date
): CheckerStateDocument {
  return {
    ...state,
    updatedAt: now.toISOString(),
    notifications: state.notifications.filter(
      (candidate) => candidate.id !== id
    )
  };
}
