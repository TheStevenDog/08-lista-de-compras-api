import { NextResponse } from "next/server";
import { internalErrorResponse, jsonError, zodErrorResponse } from "@/src/lib/errors";
import { getAdminDb } from "@/src/lib/firebaseAdmin";
import { codigoCompartirSchema } from "@/src/lib/schemas";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ codigo: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { codigo } = await context.params;
  const parsedCodigo = codigoCompartirSchema.safeParse(codigo);
  if (!parsedCodigo.success) {
    return zodErrorResponse(parsedCodigo.error);
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

    if (!listaSnap.exists) {
      return jsonError(404, "Lista compartida no disponible");
    }

    const listaData = listaSnap.data();
    if (listaData?.["deleted_at"] !== null && listaData?.["deleted_at"] !== undefined) {
      return jsonError(404, "Lista compartida no disponible");
    }

    const itemsSnap = await db
      .collection("usuarios")
      .doc(ownerUid)
      .collection("item")
      .where("lista_id", "==", listaId)
      .where("deleted_at", "==", null)
      .get();

    const items = itemsSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        lista_id: listaId,
        nombre: typeof data["nombre"] === "string" ? data["nombre"] : "",
        cantidad: typeof data["cantidad"] === "number" ? data["cantidad"] : 1,
        categoria: typeof data["categoria"] === "string" ? data["categoria"] : "otros",
        comprado: Boolean(data["comprado"]),
        updated_at: typeof data["updated_at"] === "string" ? data["updated_at"] : null,
      };
    });

    return NextResponse.json(
      {
        codigo: parsedCodigo.data,
        lista: {
          id: listaId,
          nombre: typeof listaData?.["nombre"] === "string" ? listaData["nombre"] : "",
          cerrada: Boolean(listaData?.["cerrada"]),
          created_at: typeof listaData?.["created_at"] === "string" ? listaData["created_at"] : null,
          updated_at: typeof listaData?.["updated_at"] === "string" ? listaData["updated_at"] : null,
        },
        items,
      },
      { status: 200 }
    );
  } catch {
    return internalErrorResponse();
  }
}
