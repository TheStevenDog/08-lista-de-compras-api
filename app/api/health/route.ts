import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      servicio: "08-lista-de-compras-api",
      servidor_ahora: new Date().toISOString(),
    },
    { status: 200 }
  );
}
