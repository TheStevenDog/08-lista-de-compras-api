import { NextResponse } from "next/server";
import { requireAuth } from "@/src/lib/authMiddleware";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json(
    {
      usuario: {
        id: auth.user.uid,
        email: auth.user.email,
        rol: auth.user.rol,
      },
    },
    { status: 200 }
  );
}
