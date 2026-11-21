import type { NextResponse } from "next/server";
import { jsonError, type ApiErrorBody } from "@/src/lib/errors";
import { getAdminAuth } from "@/src/lib/firebaseAdmin";

export interface AuthenticatedUser {
  uid: string;
  email: string | null;
  rol: string | null;
}

export type AuthResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; response: NextResponse<ApiErrorBody> };

export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;

  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * Verifica el ID token de Firebase enviado en `Authorization: Bearer <token>`.
 * El `uid` y el custom claim `rol` provienen EXCLUSIVAMENTE del token verificado.
 */
export async function requireAuth(request: Request): Promise<AuthResult> {
  const token = extractBearerToken(request);
  if (!token) {
    return {
      ok: false,
      response: jsonError(401, "Token de autenticación requerido"),
    };
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    const rolClaim = decoded["rol"];

    return {
      ok: true,
      user: {
        uid: decoded.uid,
        email: typeof decoded.email === "string" ? decoded.email : null,
        rol: typeof rolClaim === "string" ? rolClaim : null,
      },
    };
  } catch {
    return {
      ok: false,
      response: jsonError(401, "Token inválido o expirado"),
    };
  }
}

/**
 * Verifica autenticación y custom claim `rol === "admin"` (secciones 9.1 y 11).
 */
export async function requireAdmin(request: Request): Promise<AuthResult> {
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return auth;
  }

  if (auth.user.rol !== "admin") {
    return {
      ok: false,
      response: jsonError(403, "Acceso denegado: se requiere rol de administrador"),
    };
  }

  return auth;
}
