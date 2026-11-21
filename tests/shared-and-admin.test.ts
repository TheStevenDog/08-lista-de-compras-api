import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryFirestore } from "./helpers/mockFirestore";
import { normalizePrivateKey } from "@/src/lib/firebaseAdmin";

const mockDb = new InMemoryFirestore();
const verifyIdTokenMock = vi.fn();

vi.mock("@/src/lib/firebaseAdmin", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/firebaseAdmin")>(
    "@/src/lib/firebaseAdmin"
  );
  return {
    ...actual,
    getAdminDb: () => mockDb,
    getAdminAuth: () => ({
      verifyIdToken: verifyIdTokenMock,
    }),
  };
});

import { PUT as listaPut } from "@/app/api/lista/[id]/route";
import { PUT as itemPut } from "@/app/api/item/[id]/route";
import { POST as compartirPost } from "@/app/api/listas/[id]/compartir/route";
import { GET as codigoGet } from "@/app/api/listas/codigo/[codigo]/route";
import { PATCH as codigoItemPatch } from "@/app/api/listas/codigo/[codigo]/items/[itemId]/route";
import { GET as adminStatsGet } from "@/app/api/admin/stats/route";

function authHeader(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

describe("Listas compartidas por código y control de rol admin (403)", () => {
  beforeEach(() => {
    mockDb.clear();
    verifyIdTokenMock.mockReset();
    verifyIdTokenMock.mockImplementation(async (token: string) => {
      if (token === "token-owner") {
        return { uid: "uid-owner", email: "owner@ejemplo.com", rol: "usuario" };
      }
      if (token === "token-admin") {
        return { uid: "uid-admin", email: "admin@ejemplo.com", rol: "admin" };
      }
      throw new Error("invalid token");
    });
  });

  it("normaliza saltos de línea literales en FIREBASE_PRIVATE_KEY", () => {
    const raw = '"LINEA1\\nLINEA2\\nLINEA3"';
    expect(normalizePrivateKey(raw)).toBe("LINEA1\nLINEA2\nLINEA3");
  });

  it("comparte lista con código de 6 caracteres reintentando ante colisión ALREADY_EXISTS y permite consultar y marcar comprado", async () => {
    // 1. Crear lista y dos productos
    await listaPut(
      new Request("https://api.test/api/lista/lista-casa", {
        method: "PUT",
        headers: authHeader("token-owner"),
        body: JSON.stringify({ nombre: "Compras de casa", cerrada: false }),
      }),
      { params: Promise.resolve({ id: "lista-casa" }) }
    );

    await itemPut(
      new Request("https://api.test/api/item/prod-leche", {
        method: "PUT",
        headers: authHeader("token-owner"),
        body: JSON.stringify({
          lista_id: "lista-casa",
          nombre: "Leche",
          cantidad: 2,
          categoria: "lacteos",
          comprado: false,
        }),
      }),
      { params: Promise.resolve({ id: "prod-leche" }) }
    );

    // Otro producto en una lista distinta (no debe poder editarse con el código de lista-casa)
    await itemPut(
      new Request("https://api.test/api/item/prod-otra-lista", {
        method: "PUT",
        headers: authHeader("token-owner"),
        body: JSON.stringify({
          lista_id: "otra-lista",
          nombre: "Café",
          cantidad: 1,
          categoria: "despensa",
          comprado: false,
        }),
      }),
      { params: Promise.resolve({ id: "prod-otra-lista" }) }
    );

    // Simular 2 colisiones en .create() antes de lograr un código único
    mockDb.forcedCreateCollisions = 2;

    const shareRes = await compartirPost(
      new Request("https://api.test/api/listas/lista-casa/compartir", {
        method: "POST",
        headers: authHeader("token-owner"),
      }),
      { params: Promise.resolve({ id: "lista-casa" }) }
    );
    const shareJson = await shareRes.json();

    expect(shareRes.status).toBe(201);
    expect(shareJson.codigo).toMatch(/^[A-Z0-9]{6}$/);
    expect(shareJson.lista_id).toBe("lista-casa");
    expect(mockDb.forcedCreateCollisions).toBe(0);

    // 2. Consultar lista compartida sin autenticación (cualquiera con el código)
    const getSharedRes = await codigoGet(
      new Request(`https://api.test/api/listas/codigo/${shareJson.codigo}`),
      { params: Promise.resolve({ codigo: shareJson.codigo }) }
    );
    const getSharedJson = await getSharedRes.json();

    expect(getSharedRes.status).toBe(200);
    expect(getSharedJson.lista.nombre).toBe("Compras de casa");
    expect(getSharedJson.owner_uid).toBeUndefined();
    expect(getSharedJson.items).toHaveLength(1);
    expect(getSharedJson.items[0].nombre).toBe("Leche");

    // 3. Marcar producto comprado (intentando inyectar nombre/cantidad -> solo cambia comprado)
    const patchRes = await codigoItemPatch(
      new Request(
        `https://api.test/api/listas/codigo/${shareJson.codigo}/items/prod-leche`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            comprado: true,
            nombre: "HACKEADO",
            cantidad: 99,
          }),
        }
      ),
      { params: Promise.resolve({ codigo: shareJson.codigo, itemId: "prod-leche" }) }
    );
    const patchJson = await patchRes.json();

    expect(patchRes.status).toBe(200);
    expect(patchJson.comprado).toBe(true);
    expect(patchJson.nombre).toBe("Leche");
    expect(patchJson.cantidad).toBe(2);

    // 4. Intentar modificar un producto que pertenece a OTRA lista -> 404
    const crossListRes = await codigoItemPatch(
      new Request(
        `https://api.test/api/listas/codigo/${shareJson.codigo}/items/prod-otra-lista`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comprado: true }),
        }
      ),
      { params: Promise.resolve({ codigo: shareJson.codigo, itemId: "prod-otra-lista" }) }
    );
    expect(crossListRes.status).toBe(404);
  });

  it("GET /api/admin/stats exige token (401) y custom claim rol=admin (403 si es usuario normal, 200 si es admin)", async () => {
    const noTokenRes = await adminStatsGet(new Request("https://api.test/api/admin/stats"));
    expect(noTokenRes.status).toBe(401);

    const nonAdminRes = await adminStatsGet(
      new Request("https://api.test/api/admin/stats", {
        headers: { Authorization: "Bearer token-owner" },
      })
    );
    const nonAdminJson = await nonAdminRes.json();
    expect(nonAdminRes.status).toBe(403);
    expect(nonAdminJson.error).toContain("administrador");

    const adminRes = await adminStatsGet(
      new Request("https://api.test/api/admin/stats", {
        headers: { Authorization: "Bearer token-admin" },
      })
    );
    const adminJson = await adminRes.json();
    expect(adminRes.status).toBe(200);
    expect(adminJson.admin).toEqual({ id: "uid-admin", rol: "admin" });
    expect(typeof adminJson.estadisticas.listas_compartidas_activas).toBe("number");
  });
});
