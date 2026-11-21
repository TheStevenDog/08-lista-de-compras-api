import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Normaliza la clave privada de Firebase:
 * - Elimina comillas envolventes opcionales si fueron pegadas en Vercel.
 * - Convierte secuencias literales `\n` en saltos de línea reales.
 */
export function normalizePrivateKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  const unwrapped =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed;

  return unwrapped.replace(/\\n/g, "\n");
}

export function getFirebaseApp(): App {
  if (getApps().length > 0) {
    return getApp();
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !rawPrivateKey) {
    throw new Error("Configuración incompleta de Firebase Admin en variables de entorno");
  }

  const privateKey = normalizePrivateKey(rawPrivateKey);

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

export function getAdminAuth(): Auth {
  return getAuth(getFirebaseApp());
}

export function getAdminDb(): Firestore {
  const db = getFirestore(getFirebaseApp());
  return db;
}

export function getFirebaseWebApiKey(): string {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) {
    throw new Error("FIREBASE_WEB_API_KEY no configurada en variables de entorno");
  }
  return apiKey;
}
