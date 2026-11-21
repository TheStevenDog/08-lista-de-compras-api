import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimiter } from "@/src/lib/rateLimit";

const verifyIdTokenMock = vi.fn();

vi.mock("@/src/lib/firebaseAdmin", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/firebaseAdmin")>(
    "@/src/lib/firebaseAdmin"
  );
  return {
    ...actual,
    getAdminAuth: () => ({
      verifyIdToken: verifyIdTokenMock,
    }),
    getFirebaseWebApiKey: () => "test-web-api-key-mock",
  };
});

import { GET as healthGet } from "@/app/api/health/route";
import { POST as registroPost } from "@/app/api/auth/registro/route";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as refreshPost } from "@/app/api/auth/refresh/route";
import { GET as yoGet } from "@/app/api/auth/yo/route";

describe("Rutas de salud y autenticación (/api/health y /api/auth/*)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetRateLimiter();
    verifyIdTokenMock.mockReset();
    process.env.LOGIN_RATE_LIMIT_MAX = "3";
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS = "60000";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("GET /api/health responde 200 con marca de tiempo ISO UTC", async () => {
    const res = await healthGet();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.servicio).toBe("08-lista-de-compras-api");
    expect(Number.isNaN(Date.parse(json.servidor_ahora))).toBe(false);
  });

  it("POST /api/auth/registro valida contraseña >= 8 (400) y registra usuario (201)", async () => {
    const weakRes = await registroPost(
      new Request("https://api.test/api/auth/registro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "familia@ejemplo.com", password: "123" }),
      })
    );
    const weakJson = await weakRes.json();
    expect(weakRes.status).toBe(400);
    expect(weakJson.error).toBe("Datos inválidos");
    expect(weakJson.detalles[0].campo).toBe("password");

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          idToken: "id-token-123",
          refreshToken: "refresh-token-123",
          expiresIn: "3600",
          localId: "uid-familia-1",
          email: "familia@ejemplo.com",
        }),
        { status: 200 }
      )
    );

    const okRes = await registroPost(
      new Request("https://api.test/api/auth/registro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "Familia@Ejemplo.com", password: "PasswordSegura123" }),
      })
    );
    const okJson = await okRes.json();

    expect(okRes.status).toBe(201);
    expect(okJson).toEqual({
      token: "id-token-123",
      refreshToken: "refresh-token-123",
      expiraEnSeg: 3600,
      usuario: { id: "uid-familia-1", email: "familia@ejemplo.com" },
    });
  });

  it("POST /api/auth/registro responde 409 cuando el correo ya existe", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "EMAIL_EXISTS" } }), { status: 400 })
    );

    const res = await registroPost(
      new Request("https://api.test/api/auth/registro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "repetido@ejemplo.com", password: "PasswordSegura123" }),
      })
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain("registrado");
  });

  it("POST /api/auth/login devuelve el mismo mensaje 401 exista o no el correo y aplica rate limit 429", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "EMAIL_NOT_FOUND" } }), { status: 400 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "INVALID_PASSWORD" } }), { status: 400 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            idToken: "id-ok",
            refreshToken: "ref-ok",
            expiresIn: "3600",
            localId: "uid-1",
            email: "ok@ejemplo.com",
          }),
          { status: 200 }
        )
      );
    globalThis.fetch = fetchMock;

    const r1 = await loginPost(
      new Request("https://api.test/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.5" },
        body: JSON.stringify({ email: "noexiste@ejemplo.com", password: "Password123" }),
      })
    );
    const j1 = await r1.json();

    const r2 = await loginPost(
      new Request("https://api.test/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.5" },
        body: JSON.stringify({ email: "existe@ejemplo.com", password: "WrongPassword" }),
      })
    );
    const j2 = await r2.json();

    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    expect(j1.error).toBe(j2.error);
    expect(j1.error).toBe("Credenciales inválidas");

    // 3er intento permitido (LOGIN_RATE_LIMIT_MAX=3)
    const r3 = await loginPost(
      new Request("https://api.test/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.5" },
        body: JSON.stringify({ email: "ok@ejemplo.com", password: "Password123" }),
      })
    );
    expect(r3.status).toBe(200);

    // 4to intento bloqueado con 429
    const r4 = await loginPost(
      new Request("https://api.test/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.5" },
        body: JSON.stringify({ email: "ok@ejemplo.com", password: "Password123" }),
      })
    );
    expect(r4.status).toBe(429);
    expect(r4.headers.get("Retry-After")).toBeTruthy();
  });

  it("POST /api/auth/refresh renueva el token (200) y rechaza refresh token inválido (401)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id_token: "nuevo-id-token",
            refresh_token: "nuevo-refresh-token",
            expires_in: "3600",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "INVALID_REFRESH_TOKEN" } }), {
          status: 400,
        })
      );

    const okRes = await refreshPost(
      new Request("https://api.test/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-valido" }),
      })
    );
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({
      token: "nuevo-id-token",
      refreshToken: "nuevo-refresh-token",
      expiraEnSeg: 3600,
    });

    const badRes = await refreshPost(
      new Request("https://api.test/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-invalido" }),
      })
    );
    expect(badRes.status).toBe(401);
  });

  it("GET /api/auth/yo responde 401 sin token y 200 con token verificado", async () => {
    const noTokenRes = await yoGet(new Request("https://api.test/api/auth/yo"));
    expect(noTokenRes.status).toBe(401);

    verifyIdTokenMock.mockResolvedValueOnce({
      uid: "uid-carlos",
      email: "carlos@ejemplo.com",
      rol: "usuario",
    });

    const okRes = await yoGet(
      new Request("https://api.test/api/auth/yo", {
        headers: { Authorization: "Bearer token-valido-carlos" },
      })
    );
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({
      usuario: { id: "uid-carlos", email: "carlos@ejemplo.com", rol: "usuario" },
    });
  });
});
