import { NextResponse } from "next/server";
import {
  internalErrorResponse,
  jsonError,
  parseJsonBody,
  zodErrorResponse,
} from "@/src/lib/errors";
import { getFirebaseWebApiKey } from "@/src/lib/firebaseAdmin";
import { refreshSchema } from "@/src/lib/schemas";

export const runtime = "nodejs";

interface SecureTokenSuccess {
  id_token: string;
  refresh_token: string;
  expires_in: string;
}

interface SecureTokenError {
  error?: {
    message?: string;
  };
}

export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = refreshSchema.safeParse(body.data);
  if (!parsed.success) {
    return zodErrorResponse(parsed.error);
  }

  try {
    const apiKey = getFirebaseWebApiKey();
    const formBody = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: parsed.data.refreshToken,
    });

    const res = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
      }
    );

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as SecureTokenError;
      const code = errBody.error?.message ?? "";

      if (
        code === "TOKEN_EXPIRED" ||
        code === "INVALID_REFRESH_TOKEN" ||
        code === "USER_DISABLED" ||
        code === "USER_NOT_FOUND" ||
        res.status === 400
      ) {
        return jsonError(401, "Refresh token inválido o expirado");
      }

      return internalErrorResponse();
    }

    const data = (await res.json()) as SecureTokenSuccess;
    return NextResponse.json(
      {
        token: data.id_token,
        refreshToken: data.refresh_token,
        expiraEnSeg: Number(data.expires_in),
      },
      { status: 200 }
    );
  } catch {
    return internalErrorResponse();
  }
}
