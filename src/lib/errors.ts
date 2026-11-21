import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export interface ErrorDetail {
  campo: string;
  mensaje: string;
}

export interface ApiErrorBody {
  error: string;
  detalles?: ErrorDetail[];
}

export function jsonError(
  status: number,
  mensaje: string,
  detalles?: ErrorDetail[],
  headers?: HeadersInit
): NextResponse<ApiErrorBody> {
  const body: ApiErrorBody = detalles && detalles.length > 0
    ? { error: mensaje, detalles }
    : { error: mensaje };

  return NextResponse.json(body, { status, headers });
}

export function zodErrorResponse(error: ZodError): NextResponse<ApiErrorBody> {
  const detalles: ErrorDetail[] = error.issues.map((issue) => ({
    campo: issue.path.length > 0 ? issue.path.join(".") : "body",
    mensaje: issue.message,
  }));

  return jsonError(400, "Datos inválidos", detalles);
}

/**
 * Respuesta obligatoria para errores internos:
 * nunca devuelve stack traces ni detalles al cliente y no registra datos sensibles.
 */
export function internalErrorResponse(): NextResponse<ApiErrorBody> {
  return jsonError(500, "Error interno");
}

export async function parseJsonBody(
  request: Request
): Promise<{ ok: true; data: unknown } | { ok: false; response: NextResponse<ApiErrorBody> }> {
  const contentType = request.headers.get("content-type");
  if (contentType && !contentType.toLowerCase().includes("application/json")) {
    return {
      ok: false,
      response: jsonError(415, "El encabezado Content-Type debe ser application/json"),
    };
  }

  try {
    const data: unknown = await request.json();
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return {
        ok: false,
        response: jsonError(400, "El cuerpo de la petición debe ser un objeto JSON"),
      };
    }
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      response: jsonError(400, "JSON mal formado"),
    };
  }
}
