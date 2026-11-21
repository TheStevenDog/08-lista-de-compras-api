import { NextResponse } from "next/server";
import { requireAuth } from "@/src/lib/authMiddleware";
import {
  internalErrorResponse,
  jsonError,
  parseJsonBody,
  zodErrorResponse,
} from "@/src/lib/errors";
import { getAdminDb } from "@/src/lib/firebaseAdmin";
import { itemPutSchema, resourceIdSchema } from "@/src/lib/schemas";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, context: RouteContext) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const parsedId = resourceIdSchema.safeParse(id);
  if (!parsedId.success) {
    return zodErrorResponse(parsedId.error);
  }

  const body = await parseJsonBody(request);
  if (!body.ok) return body.response;

  const parsedBody = itemPutSchema.safeParse(body.data);
  if (!parsedBody.success) {
    return zodErrorResponse(parsedBody.error);
  }

  try {
    const db = getAdminDb();
    const docRef = db
      .collection("usuarios")
      .doc(auth.user.uid)
      .collection("item")
      .doc(parsedId.data);

    const existingSnap = await docRef.get();
    const existingData = existingSnap.exists ? existingSnap.data() : undefined;
    const now = new Date().toISOString();

    const createdAt =
      typeof existingData?.["created_at"] === "string" ? existingData["created_at"] : now;

    const docData = {
      lista_id: parsedBody.data.lista_id,
      nombre: parsedBody.data.nombre,
      cantidad: parsedBody.data.cantidad,
      categoria: parsedBody.data.categoria,
      comprado: parsedBody.data.comprado,
      created_at: createdAt,
      updated_at: now,
      deleted_at: null as string | null,
    };

    await docRef.set(docData);

    return NextResponse.json(
      {
        id: parsedId.data,
        ...docData,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("PUT /api/item/[id] error:", err);
    return internalErrorResponse();
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const parsedId = resourceIdSchema.safeParse(id);
  if (!parsedId.success) {
    return zodErrorResponse(parsedId.error);
  }

  try {
    const db = getAdminDb();
    const docRef = db
      .collection("usuarios")
      .doc(auth.user.uid)
      .collection("item")
      .doc(parsedId.data);

    const existingSnap = await docRef.get();
    if (!existingSnap.exists) {
      return jsonError(404, "Producto no encontrado");
    }

    const now = new Date().toISOString();
    await docRef.update({
      deleted_at: now,
      updated_at: now,
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("PUT /api/item/[id] error:", err);
    return internalErrorResponse();
  }
}
