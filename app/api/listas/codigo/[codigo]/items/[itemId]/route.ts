import { NextResponse } from "next/server";
import {
  internalErrorResponse,
  jsonError,
  parseJsonBody,
  zodErrorResponse,
} from "@/src/lib/errors";
import { getAdminDb } from "@/src/lib/firebaseAdmin";
import {
  codigoCompartirSchema,
  resourceIdSchema,
  sharedItemPatchSchema,
} from "@/src/lib/schemas";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ codigo: string; itemId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { codigo, itemId } = await context.params;

  const parsedCodigo = codigoCompartirSchema.safeParse(codigo);
  if (!parsedCodigo.success) {
    return zodErrorResponse(parsedCodigo.error);
  }

  const parsedItemId = resourceIdSchema.safeParse(itemId);
  if (!parsedItemId.success) {
    return zodErrorResponse(parsedItemId.error);
  }

  const body = await parseJsonBody(request);
  if (!body.ok) return body.response;

  const parsedBody = sharedItemPatchSchema.safeParse(body.data);
  if (!parsedBody.success) {
    return zodErrorResponse(parsedBody.error);
  }

  try {
    const db = getAdminDb();
    const shareSnap = await db.collection("listas_compartidas").doc(parsedCodigo.data).get();
    if (!shareSnap.exists) {
      return jsonError(404, "Código de lista no encontrado");
    }

    const shareData = shareSnap.data();
    const ownerUid = typeof shareData?.["owner_uid"] === "string" ? shareData["owner_uid"] : null;
    const listaId = typeof shareData?.["lista_id"] === "string" ? shareData["lista_id"] : null;

    if (!ownerUid || !listaId) {
      return jsonError(404, "Lista compartida no disponible");
    }

    const listaSnap = await db
      .collection("usuarios")
      .doc(ownerUid)
      .collection("lista")
      .doc(listaId)
      .get();

    const listaData = listaSnap.exists ? listaSnap.data() : undefined;
    if (!listaSnap.exists || (listaData?.["deleted_at"] !== null && listaData?.["deleted_at"] !== undefined)) {
      return jsonError(404, "Lista compartida no disponible");
    }

    const itemRef = db
      .collection("usuarios")
      .doc(ownerUid)
      .collection("item")
      .doc(parsedItemId.data);

    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) {
      return jsonError(404, "Producto no encontrado");
    }

    const itemData = itemSnap.data();
    if (
      itemData?.["lista_id"] !== listaId ||
      (itemData?.["deleted_at"] !== null && itemData?.["deleted_at"] !== undefined)
    ) {
      return jsonError(404, "Producto no encontrado en esta lista");
    }

    const now = new Date().toISOString();
    await itemRef.update({
      comprado: parsedBody.data.comprado,
      updated_at: now,
    });

    return NextResponse.json(
      {
        id: parsedItemId.data,
        lista_id: listaId,
        nombre: typeof itemData["nombre"] === "string" ? itemData["nombre"] : "",
        cantidad: typeof itemData["cantidad"] === "number" ? itemData["cantidad"] : 1,
        categoria: typeof itemData["categoria"] === "string" ? itemData["categoria"] : "otros",
        comprado: parsedBody.data.comprado,
        updated_at: now,
      },
      { status: 200 }
    );
  } catch {
    return internalErrorResponse();
  }
}
