import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  runVerification,
  scanContentForSecrets,
  validateAiConfig,
} from "../scripts/verify-ai-safety.mjs";

const REPO_ROOT = path.resolve(__dirname, "..");

describe("Restricciones de seguridad y configuración de IA (Sección 14)", () => {
  it("contiene todos los archivos obligatorios de gobernanza y evidencias", () => {
    const required = [
      ".gitignore",
      "AGENTS.md",
      "CLAUDE.md",
      ".cursorrules",
      ".aiignore",
      ".cursorignore",
      ".claude/settings.json",
      "scripts/verify-ai-safety.mjs",
      "ia/bitacora-ia.md",
      "ia/evidencias-configuracion.md",
      "ia/verify-restrictions.test.ts",
    ];

    for (const file of required) {
      expect(fs.existsSync(path.join(REPO_ROOT, file)), `Debe existir ${file}`).toBe(true);
    }
  });

  it("bloquea .env*, claves privadas y cuentas de servicio en .gitignore, .aiignore y .cursorignore", () => {
    const files = [".gitignore", ".aiignore", ".cursorignore"];
    const expectedPatterns = [
      ".env",
      ".env.*",
      "*.pem",
      "*.key",
      "service-account*.json",
      "*firebase-adminsdk*.json",
    ];

    for (const file of files) {
      const lines = fs
        .readFileSync(path.join(REPO_ROOT, file), "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim());

      for (const pattern of expectedPatterns) {
        expect(lines, `${file} debe bloquear ${pattern}`).toContain(pattern);
      }
    }
  });

  it("configura reglas deny y ask en .claude/settings.json para proteger secretos, confinar al repo y confirmar despliegues", () => {
    const settingsPath = path.join(REPO_ROOT, ".claude/settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      permissions: { deny: string[]; ask: string[] };
    };

    expect(settings.permissions.deny).toContain("Read(.env)");
    expect(settings.permissions.deny).toContain("Read(.env.*)");
    expect(settings.permissions.deny).toContain("Read(*.pem)");
    expect(settings.permissions.deny).toContain("Read(*service-account*.json)");
    expect(settings.permissions.deny).toContain("Read(../*)");
    expect(settings.permissions.deny).toContain("Bash(cd ..*)");

    expect(settings.permissions.ask).toContain("Bash(git push*)");
    expect(settings.permissions.ask).toContain("Bash(vercel*)");
    expect(settings.permissions.ask).toContain("Bash(firebase deploy*)");
  });

  it("documenta las reglas del stack, aislamiento usuarios/{uid} y prohibición de undefined en AGENTS.md", () => {
    const agents = fs.readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf8");
    expect(agents).toContain('runtime = "nodejs"');
    expect(agents).toContain("firebase-admin");
    expect(agents).toContain("zod");
    expect(agents).toContain("snake_case");
    expect(agents).toContain("usuarios/{uid}");
    expect(agents).toContain("null");
  });

  it("detecta secretos hardcodeados simulados mediante el escáner automatizado", () => {
    const fakeGoogleKey = ["AIza", "SyA1234567890abcdefghijklmnopqrstuv"].join("");
    const fakePem = ["-----BEGIN ", "PRIVATE KEY-----\nMIIEvQIBADAN\n-----END PRIVATE KEY-----"].join("");

    const keyFindings = scanContentForSecrets(`const k = "${fakeGoogleKey}";`, "simulado-key.ts");
    const pemFindings = scanContentForSecrets(fakePem, "simulado-pem.ts");
    const cleanFindings = scanContentForSecrets(
      'const key = process.env.FIREBASE_WEB_API_KEY ?? "";',
      "limpio.ts"
    );

    expect(keyFindings.length).toBeGreaterThan(0);
    expect(pemFindings.length).toBeGreaterThan(0);
    expect(cleanFindings).toEqual([]);
  });

  it("aprueba la validación completa de seguridad e integridad del repositorio", () => {
    expect(validateAiConfig(REPO_ROOT)).toEqual([]);
    const result = runVerification(REPO_ROOT);
    expect(result.ok, result.errors.join("; ")).toBe(true);
  });
});
