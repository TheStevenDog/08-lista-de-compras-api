import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireAuth } from "@/src/lib/authMiddleware";
import { internalErrorResponse, jsonError, zodErrorResponse } from "@/src/lib/errors";
import { getAdminDb } from "@/src/lib/firebaseAdmin";
import { resourceIdSchema } from "@/src/lib/schemas";

export const runtime = "nodejs";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const MAX_RETRIES = 5;

interface RouteContext {
  params: Promise<{ id: string }>;
}

function generateShareCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    const idx = crypto.randomInt(0, CODE_ALPHABET.length);
    code += CODE_ALPHABET[idx];
  }
  return code;
}

function isAlreadyExistsError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const candidate = err as { code?: unknown; message?: unknown };
  if (candidate.code === 6 || candidate.code === "already-exists" || candidate.code === "ALREADY_EXISTS") {
    return true;
  }
  if (typeof candidate.message === "string" && candidate.message.includes("ALREADY_EXISTS")) {
    return true;
  }
  return false;
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const parsedId = resourceIdSchema.safeParse(id);
  if (!parsedId.success) {
    return zodErrorResponse(parsedId.error);
  }

  try {
    const db = getAdminDb();
    const listaRef = db
      .collection("usuarios")
      .doc(auth.user.uid)
      .collection("lista")
      .doc(parsedId.data);

    const listaSnap = await listaRef.get();
    if (!listaSnap.exists) {
      return jsonError(404, "Lista no encontrada");
    }

    const listaData = listaSnap.data();
    if (listaData?.["deleted_at"] !== null && listaData?.["deleted_at"] !== undefined) {
      return jsonError(404, "Lista no encontrada");
    }

    const existingCode =
      typeof listaData?.["codigo_compartir"] === "string"
        ? listaData["codigo_compartir"]
        : null;

    if (existingCode) {
      const existingShareSnap = await db.collection("listas_compartidas").doc(existingCode).get();
      const existingShare = existingShareSnap.exists ? existingShareSnap.data() : undefined;
      if (
        existingShare &&
        existingShare["owner_uid"] === auth.user.uid &&
        existingShare["lista_id"] === parsedId.data
      ) {
        return NextResponse.json(
          {
            codigo: existingCode,
            lista_id: parsedId.data,
            creada_en:
              typeof existingShare["creada_en"] === "string"
                ? existingShare["creada_en"]
                : new Date().toISOString(),
          },
          { status: 200 }
        );
      }
    }

    const now = new Date().toISOString();
    let createdCode: string | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      const candidateCode = generateShareCode();
      const shareRef = db.collection("listas_compartidas").doc(candidateCode);

      try {
        await shareRef.create({
          owner_uid: auth.user.uid,
          lista_id: parsedId.data,
          creada_en: now,
        });
        createdCode = candidateCode;
        break;
      } catch (err) {
        if (isAlreadyExistsError(err)) {
          continue;
        }
        throw err;
      }
    }

    if (!createdCode) {
      return jsonError(409, "No fue posible generar un código único. Intenta nuevamente.");
    }

    await listaRef.update({
      codigo_compartir: createdCode,
      updated_at: now,
    });

    return NextResponse.json(
      {
        codigo: createdCode,
        lista_id: parsedId.data,
        creada_en: now,
      },
      { status: 201 }
    );
  } catch {
    return internalErrorResponse();
  }
}
