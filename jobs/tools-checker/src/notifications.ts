import type {
  CatalogDocument,
  CheckerStateDocument,
  Incident,
  NotificationDelivery
} from "@tools-platform/domain";

export interface NotificationDrainResult {
  state: CheckerStateDocument;
  attempted: number;
}

export async function drainNotifications(
  state: CheckerStateDocument,
  catalog: CatalogDocument,
  webhookUrl: string | undefined,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date()
): Promise<NotificationDrainResult> {
  if (!webhookUrl) {
    return { state, attempted: 0 };
  }

  const notifications = [...state.notifications];
  let attempted = 0;
  for (let index = 0; index < notifications.length; index += 1) {
    const delivery = notifications[index];
    const currentTime = now();
    if (
      delivery.status === "delivered" ||
      (delivery.nextAttemptAt !== null &&
        Date.parse(delivery.nextAttemptAt) > currentTime.getTime())
    ) {
      continue;
    }
    const incident = state.incidents.find(
      ({ id }) => id === delivery.incidentId
    );
    if (!incident) {
      throw new Error(`Notification references missing incident: ${delivery.id}`);
    }
    const entry = catalog.entries.find(({ id }) => id === incident.monitorId);
    if (!entry) {
      throw new Error(`Incident references missing catalog entry: ${incident.id}`);
    }

    attempted += 1;
    notifications[index] = await deliver(
      delivery,
      incident,
      entry.name,
      webhookUrl,
      fetcher,
      currentTime
    );
  }
  return {
    state: {
      ...state,
      notifications
    },
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
  now: Date
): Promise<NotificationDelivery> {
  const attempts = delivery.attempts + 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetcher(withWait(webhookUrl), {
      method: "POST",
      signal: controller.signal,
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
      attempts,
      now,
      backoffSeconds(attempts),
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
      attempts,
      nextAttemptAt: null,
      deliveredAt: now.toISOString(),
      lastErrorCode: null
    };
  }
  return failedDelivery(
    delivery,
    attempts,
    now,
    retryDelaySeconds(response, attempts, now.getTime()),
    `discord_http_${response.status}`
  );
}

function failedDelivery(
  delivery: NotificationDelivery,
  attempts: number,
  now: Date,
  delaySeconds: number,
  errorCode: string
): NotificationDelivery {
  return {
    ...delivery,
    attempts,
    nextAttemptAt: new Date(
      now.getTime() + delaySeconds * 1000
    ).toISOString(),
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
