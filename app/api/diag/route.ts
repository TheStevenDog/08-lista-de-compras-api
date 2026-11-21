import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb, getFirebaseApp } from "@/src/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function GET() {
  const info: Record<string, unknown> = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    hasPrivateKey: Boolean(process.env.FIREBASE_PRIVATE_KEY),
    privateKeyLength: process.env.FIREBASE_PRIVATE_KEY?.length ?? 0,
    hasWebApiKey: Boolean(process.env.FIREBASE_WEB_API_KEY),
  };

  try {
    const app = getFirebaseApp();
    info.appName = app.name;
    info.appOptionsProjectId = app.options.projectId;

    const auth = getAdminAuth();
    info.authReady = true;

    const db = getAdminDb();
    info.dbDatabaseId = db.databaseId;

    // Test Firestore write
    const testDoc = db.collection("_diagnostico").doc("test");
    await testDoc.set({ test: true, timestamp: new Date().toISOString() });
    info.firestoreWrite = "OK";

    const snap = await testDoc.get();
    info.firestoreRead = snap.exists ? "OK" : "NOT_EXISTS";

    return NextResponse.json({ ok: true, info }, { status: 200 });
  } catch (err: unknown) {
    const error = err as { message?: string; code?: string | number; details?: string; stack?: string };
    return NextResponse.json(
      {
        ok: false,
        info,
        error: error.message ?? String(err),
        code: error.code,
        details: error.details,
      },
      { status: 500 }
    );
  }
}
