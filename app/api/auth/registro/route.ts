import { NextResponse } from "next/server";
import {
  internalErrorResponse,
  jsonError,
  parseJsonBody,
  zodErrorResponse,
} from "@/src/lib/errors";
import { getFirebaseWebApiKey } from "@/src/lib/firebaseAdmin";
import { registroSchema } from "@/src/lib/schemas";

export const runtime = "nodejs";

interface FirebaseSignUpSuccess {
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

export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = registroSchema.safeParse(body.data);
  if (!parsed.success) {
    return zodErrorResponse(parsed.error);
  }

  try {
    const apiKey = getFirebaseWebApiKey();
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
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

      if (code === "EMAIL_EXISTS") {
        return jsonError(409, "El correo ya está registrado");
      }
      if (code.startsWith("WEAK_PASSWORD")) {
        return jsonError(400, "La contraseña es demasiado débil", [
          { campo: "password", mensaje: "La contraseña debe tener al menos 8 caracteres" },
        ]);
      }
      if (code === "INVALID_EMAIL") {
        return jsonError(400, "Datos inválidos", [
          { campo: "email", mensaje: "Correo electrónico inválido" },
        ]);
      }
      if (code === "TOO_MANY_ATTEMPTS_TRY_LATER") {
        return jsonError(429, "Demasiados intentos. Intenta más tarde.");
      }

      return internalErrorResponse();
    }

    const data = (await res.json()) as FirebaseSignUpSuccess;
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
      { status: 201 }
    );
  } catch {
    return internalErrorResponse();
  }
}
