import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryFirestore } from "./helpers/mockFirestore";

const mockDb = new InMemoryFirestore();
const verifyIdTokenMock = vi.fn();

vi.mock("@/src/lib/firebaseAdmin", () => ({
  getAdminDb: () => mockDb,
  getAdminAuth: () => ({
    verifyIdToken: verifyIdTokenMock,
  }),
  getFirebaseWebApiKey: () => "test-web-api-key",
}));

import { GET as listaGet } from "@/app/api/lista/route";
import { PUT as listaPut, DELETE as listaDelete } from "@/app/api/lista/[id]/route";
import { GET as itemGet } from "@/app/api/item/route";
import { PUT as itemPut, DELETE as itemDelete } from "@/app/api/item/[id]/route";

function authHeader(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

describe("Sincronización privada, validación Zod y aislamiento usuarios/{uid}", () => {
  beforeEach(() => {
    mockDb.clear();
    verifyIdTokenMock.mockReset();
    verifyIdTokenMock.mockImplementation(async (token: string) => {
      if (token === "token-alice") {
        return { uid: "uid-alice", email: "alice@ejemplo.com" };
      }
      if (token === "token-bob") {
        return { uid: "uid-bob", email: "bob@ejemplo.com" };
      }
      throw new Error("invalid token");
    });
  });

  it("rechaza con 401 peticiones sin token a rutas privadas", async () => {
    const r1 = await listaGet(new Request("https://api.test/api/lista"));
    const r2 = await itemGet(new Request("https://api.test/api/item"));
    const r3 = await itemPut(
      new Request("https://api.test/api/item/item-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lista_id: "l1", nombre: "Leche", cantidad: 2 }),
      }),
      { params: Promise.resolve({ id: "item-1" }) }
    );

    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    expect(r3.status).toBe(401);
  });

  it("valida con Zod (400) cantidades fuera de 1..99, nombre vacío y descarta campos extra", async () => {
    const badQtyRes = await itemPut(
      new Request("https://api.test/api/item/item-bad", {
        method: "PUT",
        headers: authHeader("token-alice"),
        body: JSON.stringify({
          lista_id: "lista-1",
          nombre: "Leche",
          cantidad: 150,
          categoria: "lacteos",
        }),
      }),
      { params: Promise.resolve({ id: "item-bad" }) }
    );
    const badQtyJson = await badQtyRes.json();
    expect(badQtyRes.status).toBe(400);
    expect(badQtyJson.error).toBe("Datos inválidos");
    expect(badQtyJson.detalles.some((d: { campo: string }) => d.campo === "cantidad")).toBe(true);

    const badNameRes = await itemPut(
      new Request("https://api.test/api/item/item-bad2", {
        method: "PUT",
        headers: authHeader("token-alice"),
        body: JSON.stringify({
          lista_id: "lista-1",
          nombre: "   ",
          cantidad: 1,
        }),
      }),
      { params: Promise.resolve({ id: "item-bad2" }) }
    );
    expect(badNameRes.status).toBe(400);

    // Verifica que campos no declarados (uid, rol, precio) sean descartados (.strip())
    const putOk = await listaPut(
      new Request("https://api.test/api/lista/lista-1", {
        method: "PUT",
        headers: authHeader("token-alice"),
        body: JSON.stringify({
          nombre: "Mercado semanal",
          cerrada: false,
          uid: "uid-atacante",
          rol: "admin",
          precio: 999,
          created_at: "1999-01-01T00:00:00.000Z",
        }),
      }),
      { params: Promise.resolve({ id: "lista-1" }) }
    );
    const saved = await putOk.json();
    expect(putOk.status).toBe(200);
    expect(saved.nombre).toBe("Mercado semanal");
    expect(saved.codigo_compartir).toBeNull();
    expect(saved.deleted_at).toBeNull();
    expect(saved.uid).toBeUndefined();
    expect(saved.rol).toBeUndefined();
    expect(saved.precio).toBeUndefined();
    expect(saved.created_at).not.toBe("1999-01-01T00:00:00.000Z");

    const stored = mockDb.store.get("usuarios/uid-alice/lista/lista-1");
    expect(stored).toBeDefined();
    expect(stored?.["rol"]).toBeUndefined();
    expect(stored?.["precio"]).toBeUndefined();
  });

  it("sincroniza cambios incrementales con ?since= incluyendo borrados lógicos e idempotencia en PUT", async () => {
    const createRes = await listaPut(
      new Request("https://api.test/api/lista/l-sync-1", {
        method: "PUT",
        headers: authHeader("token-alice"),
        body: JSON.stringify({ nombre: "Supermercado", cerrada: false }),
      }),
      { params: Promise.resolve({ id: "l-sync-1" }) }
    );
    const created = await createRes.json();
    expect(createRes.status).toBe(200);

    // PUT idempotente preserva created_at
    const updateRes = await listaPut(
      new Request("https://api.test/api/lista/l-sync-1", {
        method: "PUT",
        headers: authHeader("token-alice"),
        body: JSON.stringify({ nombre: "Supermercado Sábado", cerrada: true }),
      }),
      { params: Promise.resolve({ id: "l-sync-1" }) }
    );
    const updated = await updateRes.json();
    expect(updated.created_at).toBe(created.created_at);
    expect(updated.cerrada).toBe(true);

    // Crear un item y luego borrarlo lógicamente
    const itemCreateRes = await itemPut(
      new Request("https://api.test/api/item/it-1", {
        method: "PUT",
        headers: authHeader("token-alice"),
        body: JSON.stringify({
          lista_id: "l-sync-1",
          nombre: "Leche",
          cantidad: 2,
          categoria: "lacteos",
          comprado: false,
        }),
      }),
      { params: Promise.resolve({ id: "it-1" }) }
    );
    expect(itemCreateRes.status).toBe(200);

    const beforeDeleteIso = new Date(Date.now() - 1000).toISOString();
    const delRes = await itemDelete(
      new Request("https://api.test/api/item/it-1", {
        method: "DELETE",
        headers: authHeader("token-alice"),
      }),
      { params: Promise.resolve({ id: "it-1" }) }
    );
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ ok: true });

    // GET ?since= debe incluir el borrado lógico
    const syncRes = await itemGet(
      new Request(
        `https://api.test/api/item?since=${encodeURIComponent(beforeDeleteIso)}`,
        { headers: authHeader("token-alice") }
      )
    );
    const syncJson = await syncRes.json();
    expect(syncRes.status).toBe(200);
    expect(syncJson.items).toHaveLength(1);
    expect(syncJson.items[0].id).toBe("it-1");
    expect(syncJson.items[0].deleted_at).not.toBeNull();
    expect(typeof syncJson.servidor_ahora).toBe("string");

    // ?since inválido devuelve 400
    const badSince = await listaGet(
      new Request("https://api.test/api/lista?since=no-es-fecha", {
        headers: authHeader("token-alice"),
      })
    );
    expect(badSince.status).toBe(400);
  });

  it("garantiza aislamiento estricto entre usuarios (usuarios/{uid}): Bob no puede ver ni borrar datos de Alice", async () => {
    await listaPut(
      new Request("https://api.test/api/lista/lista-privada-alice", {
        method: "PUT",
        headers: authHeader("token-alice"),
        body: JSON.stringify({ nombre: "Solo Alice", cerrada: false }),
      }),
      { params: Promise.resolve({ id: "lista-privada-alice" }) }
    );

    // Bob consulta sus listas -> vacío
    const bobListRes = await listaGet(
      new Request("https://api.test/api/lista", {
        headers: authHeader("token-bob"),
      })
    );
    const bobListJson = await bobListRes.json();
    expect(bobListRes.status).toBe(200);
    expect(bobListJson.items).toEqual([]);

    // Bob intenta borrar la lista de Alice -> 404 (su ruta apunta a usuarios/uid-bob/...)
    const bobDelRes = await listaDelete(
      new Request("https://api.test/api/lista/lista-privada-alice", {
        method: "DELETE",
        headers: authHeader("token-bob"),
      }),
      { params: Promise.resolve({ id: "lista-privada-alice" }) }
    );
    expect(bobDelRes.status).toBe(404);

    // La lista de Alice sigue intacta y activa
    const aliceListRes = await listaGet(
      new Request("https://api.test/api/lista", {
        headers: authHeader("token-alice"),
      })
    );
    const aliceListJson = await aliceListRes.json();
    expect(aliceListJson.items).toHaveLength(1);
    expect(aliceListJson.items[0].deleted_at).toBeNull();
  });
});
