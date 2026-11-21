#!/usr/bin/env node
/**
 * Script automatizado de verificación de seguridad y configuración de IA
 * para 08-lista-de-compras-api (Sección 14 de la especificación).
 *
 * Comprueba:
 * 1. Existencia e integridad de los archivos de gobernanza y restricciones de IA.
 * 2. Bloqueo de .env*, claves privadas y credenciales en .gitignore, .aiignore,
 *    .cursorignore y .claude/settings.json (incluyendo confinamiento al repo y ask externo).
 * 3. Ausencia de secretos hardcodeados en el código fuente del repositorio.
 * 4. Ausencia de archivos sensibles rastreados en Git.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, "..");

const REQUIRED_FILES = [
  ".gitignore",
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules",
  ".aiignore",
  ".cursorignore",
  ".claude/settings.json",
  "ia/bitacora-ia.md",
  "ia/evidencias-configuracion.md",
  "ia/verify-restrictions.test.ts",
];

const REQUIRED_IGNORE_PATTERNS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "service-account*.json",
  "*firebase-adminsdk*.json",
];

const SECRET_PATTERNS = [
  {
    name: "Clave privada PEM",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    name: "Google / Firebase API Key",
    regex: /AIza[0-9A-Za-z_-]{35}/,
  },
  {
    name: "Credencial firebaseConfig embebida",
    regex: /apiKey\s*:\s*["']AIza[0-9A-Za-z_-]{20,}["']/,
  },
  {
    name: "Token Bearer hardcodeado",
    regex: /Authorization["']?\s*[:=]\s*["']Bearer\s+eyJ[A-Za-z0-9_-]{20,}/,
  },
  {
    name: "Private key JSON de cuenta de servicio",
    regex: /"private_key"\s*:\s*"-----BEGIN PRIVATE KEY-----/,
  },
];

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "out",
  "dist",
  "coverage",
  ".vercel",
]);

const SKIP_SCAN_FILES = new Set([
  path.normalize("scripts/verify-ai-safety.mjs"),
  path.normalize("ia/verify-restrictions.test.ts"),
  path.normalize("ia/evidencias-configuracion.md"),
  path.normalize("package-lock.json"),
]);

/**
 * Escanea un texto en busca de patrones de secretos hardcodeados.
 * @param {string} content
 * @param {string} fileLabel
 * @returns {Array<{ file: string, rule: string }>}
 */
export function scanContentForSecrets(content, fileLabel = "<input>") {
  const findings = [];
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.regex.test(content)) {
      findings.push({ file: fileLabel, rule: pattern.name });
    }
  }
  return findings;
}

/**
 * Valida que los archivos de configuración y restricción de IA existan y cumplan las reglas.
 * @param {string} rootDir
 * @returns {string[]} Lista de errores encontrados (vacía si todo está OK)
 */
export function validateAiConfig(rootDir = DEFAULT_ROOT) {
  const errors = [];

  for (const relPath of REQUIRED_FILES) {
    const absPath = path.join(rootDir, relPath);
    if (!fs.existsSync(absPath)) {
      errors.push(`Falta archivo obligatorio de configuración de IA: ${relPath}`);
    }
  }

  for (const ignoreFile of [".gitignore", ".aiignore", ".cursorignore"]) {
    const absPath = path.join(rootDir, ignoreFile);
    if (!fs.existsSync(absPath)) continue;
    const content = fs.readFileSync(absPath, "utf8");
    const lines = content.split(/\r?\n/).map((line) => line.trim());
    for (const pattern of REQUIRED_IGNORE_PATTERNS) {
      if (!lines.includes(pattern)) {
        errors.push(`${ignoreFile} debe incluir el patrón obligatorio "${pattern}"`);
      }
    }
  }

  const claudeSettingsPath = path.join(rootDir, ".claude/settings.json");
  if (fs.existsSync(claudeSettingsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(claudeSettingsPath, "utf8"));
      const deny = parsed?.permissions?.deny;
      const ask = parsed?.permissions?.ask;

      if (!Array.isArray(deny) || deny.length === 0) {
        errors.push(".claude/settings.json debe definir permissions.deny");
      } else {
        const hasEnvDeny = deny.some((r) => typeof r === "string" && r.includes(".env"));
        const hasKeyDeny = deny.some((r) => typeof r === "string" && (r.includes(".pem") || r.includes("service-account")));
        const hasParentDeny = deny.some((r) => typeof r === "string" && r.includes(".."));

        if (!hasEnvDeny) errors.push(".claude/settings.json debe bloquear lectura de .env* en permissions.deny");
        if (!hasKeyDeny) errors.push(".claude/settings.json debe bloquear claves/credenciales en permissions.deny");
        if (!hasParentDeny) errors.push(".claude/settings.json debe bloquear salida del repositorio (..) en permissions.deny");
      }

      if (!Array.isArray(ask) || ask.length === 0) {
        errors.push(".claude/settings.json debe definir permissions.ask para acciones externas");
      } else {
        const hasDeployAsk = ask.some(
          (r) => typeof r === "string" && (r.includes("vercel") || r.includes("git push") || r.includes("firebase deploy"))
        );
        if (!hasDeployAsk) {
          errors.push(".claude/settings.json debe exigir confirmación para despliegues/acciones externas");
        }
      }
    } catch (err) {
      errors.push(`.claude/settings.json no es un JSON válido: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return errors;
}

/**
 * Recorre recursivamente el repositorio buscando secretos en archivos de texto.
 * @param {string} rootDir
 * @returns {Array<{ file: string, rule: string }>}
 */
export function scanRepositoryForSecrets(rootDir = DEFAULT_ROOT) {
  const findings = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.normalize(path.relative(rootDir, fullPath));

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          walk(fullPath);
        }
        continue;
      }

      if (SKIP_SCAN_FILES.has(relPath)) continue;
      if (entry.name === ".env.example") continue;
      if (/\.(png|jpg|jpeg|gif|ico|woff2?|pdf|zip)$/i.test(entry.name)) continue;

      const content = fs.readFileSync(fullPath, "utf8");
      findings.push(...scanContentForSecrets(content, relPath));
    }
  }

  walk(rootDir);
  return findings;
}

/**
 * Verifica que ningún archivo sensible (.env, *.pem, service-account*.json) esté rastreado en Git.
 * @param {string} rootDir
 * @returns {string[]}
 */
export function checkGitTrackedSecrets(rootDir = DEFAULT_ROOT) {
  const errors = [];
  if (!fs.existsSync(path.join(rootDir, ".git"))) {
    return errors;
  }

  try {
    const tracked = execSync("git ls-files", { cwd: rootDir, encoding: "utf8" })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const forbiddenTracked = tracked.filter((file) => {
      const base = path.basename(file);
      if (base === ".env.example") return false;
      return (
        base === ".env" ||
        base.startsWith(".env.") ||
        /\.(pem|key|p12|jks|keystore)$/i.test(base) ||
        /service-account.*\.json$/i.test(base) ||
        /firebase-adminsdk.*\.json$/i.test(base)
      );
    });

    for (const bad of forbiddenTracked) {
      errors.push(`Archivo sensible rastreado en Git: ${bad}`);
    }
  } catch {
    // Si git no está disponible o no hay commits aún, se omite este paso sin romper la validación.
  }

  return errors;
}

/**
 * Ejecuta todas las verificaciones de seguridad y gobernanza de IA.
 * @param {string} rootDir
 */
export function runVerification(rootDir = DEFAULT_ROOT) {
  const configErrors = validateAiConfig(rootDir);
  const secretFindings = scanRepositoryForSecrets(rootDir);
  const trackedErrors = checkGitTrackedSecrets(rootDir);

  const allErrors = [
    ...configErrors,
    ...secretFindings.map((f) => `Posible secreto detectado (${f.rule}) en ${f.file}`),
    ...trackedErrors,
  ];

  return {
    ok: allErrors.length === 0,
    errors: allErrors,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const result = runVerification(DEFAULT_ROOT);
  if (result.ok) {
    console.log("[verify-ai-safety] OK: Configuración de IA, restricciones de seguridad y escaneo de secretos verificados sin hallazgos.");
    process.exit(0);
  } else {
    console.error("[verify-ai-safety] FALLO: Se detectaron incumplimientos de seguridad/IA:");
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
}
