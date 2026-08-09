import crypto from "node:crypto";
import {
  jsonResponse,
  type Authentication,
  type Authenticator,
} from "./http.js";

const bearer = (request: Request) =>
  request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];

export function agentAuth(expected: string): Authenticator {
  const expectedBytes = Buffer.from(expected);
  return (request) => {
    const token = bearer(request);
    const tokenBytes = token ? Buffer.from(token) : undefined;
    if (
      !tokenBytes ||
      tokenBytes.byteLength !== expectedBytes.byteLength ||
      !crypto.timingSafeEqual(tokenBytes, expectedBytes)
    ) {
      return authError(
        "agent_auth_required",
        "Valid agent credentials are required.",
      );
    }
    return { ok: true };
  };
}

function authError(error: string, message: string): Authentication {
  return {
    ok: false,
    response: jsonResponse(
      { error, message },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Bearer realm="field-guide-console"',
        },
      },
    ),
  };
}
