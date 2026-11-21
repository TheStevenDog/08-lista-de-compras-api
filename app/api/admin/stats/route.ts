import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/authMiddleware";
import { internalErrorResponse } from "@/src/lib/errors";
import { getAdminDb } from "@/src/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const db = getAdminDb();
    const sharedSnap = await db.collection("listas_compartidas").get();

    return NextResponse.json(
      {
        admin: {
          id: auth.user.uid,
          rol: auth.user.rol,
        },
        estadisticas: {
          listas_compartidas_activas: sharedSnap.size,
        },
        servidor_ahora: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch {
    return internalErrorResponse();
  }
}
