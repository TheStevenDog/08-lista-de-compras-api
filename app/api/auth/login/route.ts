import { NextResponse } from "next/server";
import {
  internalErrorResponse,
  jsonError,
  parseJsonBody,
  zodErrorResponse,
} from "@/src/lib/errors";
import { getFirebaseWebApiKey } from "@/src/lib/firebaseAdmin";
import { checkLoginRateLimit, getClientIp } from "@/src/lib/rateLimit";
import { loginSchema } from "@/src/lib/schemas";

export const runtime = "nodejs";

interface FirebaseSignInSuccess {
  idToken: string;
  refreshToken: string;
  expiresIn: string;
  localId: string;
  email: string;
}

interface FirebaseRestError {
  error?: {
    message?: string;
  };
}

const INVALID_CREDENTIALS_MSG = "Credenciales inválidas";

export async function POST(request: Request) {
  const clientIp = getClientIp(request);
  const rate = checkLoginRateLimit(clientIp);
  if (!rate.allowed) {
    return jsonError(
      429,
      "Demasiados intentos de inicio de sesión. Intenta más tarde.",
      undefined,
      { "Retry-After": String(rate.retryAfterSec) }
    );
  }

  const body = await parseJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = loginSchema.safeParse(body.data);
  if (!parsed.success) {
    return zodErrorResponse(parsed.error);
  }

  try {
    const apiKey = getFirebaseWebApiKey();
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: parsed.data.email,
          password: parsed.data.password,
          returnSecureToken: true,
        }),
      }
    );

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as FirebaseRestError;
      const code = errBody.error?.message ?? "";

      if (code === "TOO_MANY_ATTEMPTS_TRY_LATER") {
        return jsonError(429, "Demasiados intentos de inicio de sesión. Intenta más tarde.");
      }

      if (
        code === "EMAIL_NOT_FOUND" ||
        code === "INVALID_PASSWORD" ||
        code === "INVALID_LOGIN_CREDENTIALS" ||
        code === "USER_DISABLED"
      ) {
        return jsonError(401, INVALID_CREDENTIALS_MSG);
      }

      return internalErrorResponse();
    }

    const data = (await res.json()) as FirebaseSignInSuccess;
    return NextResponse.json(
      {
        token: data.idToken,
        refreshToken: data.refreshToken,
        expiraEnSeg: Number(data.expiresIn),
        usuario: {
          id: data.localId,
          email: data.email,
        },
      },
      { status: 200 }
    );
  } catch {
    return internalErrorResponse();
  }
}
