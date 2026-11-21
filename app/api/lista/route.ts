import { NextResponse } from "next/server";
import { requireAuth } from "@/src/lib/authMiddleware";
import { internalErrorResponse, zodErrorResponse } from "@/src/lib/errors";
import { getAdminDb } from "@/src/lib/firebaseAdmin";
import { isoDateSchema } from "@/src/lib/schemas";

export const runtime = "nodejs";

const MAX_SYNC_LIMIT = 500;

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const sinceParam = url.searchParams.get("since");

  let sinceIso: string | null = null;
  if (sinceParam !== null && sinceParam.trim() !== "") {
    const parsedSince = isoDateSchema.safeParse(sinceParam);
    if (!parsedSince.success) {
      return zodErrorResponse(parsedSince.error);
    }
    sinceIso = parsedSince.data;
  }

  try {
    const db = getAdminDb();
    const baseCollection = db
      .collection("usuarios")
      .doc(auth.user.uid)
      .collection("lista");

    let query: FirebaseFirestore.Query = baseCollection;
    if (sinceIso !== null) {
      query = query.where("updated_at", ">", sinceIso);
    }

    const snapshot = await query.orderBy("updated_at", "asc").limit(MAX_SYNC_LIMIT).get();
    const servidorAhora = new Date().toISOString();

    const items = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        nombre: typeof data["nombre"] === "string" ? data["nombre"] : "",
        cerrada: Boolean(data["cerrada"]),
        codigo_compartir:
          typeof data["codigo_compartir"] === "string" ? data["codigo_compartir"] : null,
        created_at: typeof data["created_at"] === "string" ? data["created_at"] : servidorAhora,
        updated_at: typeof data["updated_at"] === "string" ? data["updated_at"] : servidorAhora,
        deleted_at: typeof data["deleted_at"] === "string" ? data["deleted_at"] : null,
      };
    });

    return NextResponse.json(
      {
        items,
        servidor_ahora: servidorAhora,
      },
      { status: 200 }
    );
  } catch {
    return internalErrorResponse();
  }
}
