# CLAUDE.md — Instrucciones para Claude Code en `08-lista-de-compras-api`

Este archivo complementa `AGENTS.md` con instrucciones operativas directas para sesiones con Claude Code.

## Resumen del Proyecto

API backend en **Next.js App Router** (`runtime = "nodejs"`) con **Firebase Admin SDK**, **Zod** y **Vitest** para el proyecto `08 · Lista de compras compartible`.

## Restricciones Críticas de Seguridad (Aplicadas además en `.claude/settings.json`)

1. **Prohibido leer secretos:** Nunca acceder a `.env`, `.env.local`, `.env.production`, `*.pem`, `*.key`, `service-account*.json`, `*firebase-adminsdk*.json` ni `credentials*.json`. Solo `.env.example` está permitido como referencia de nombres de variables.
2. **Confinamiento al repositorio:** Toda lectura, escritura y comando debe permanecer estrictamente dentro de `08-lista-de-compras-api/`. Prohibido acceder a rutas padre (`../`) o rutas absolutas externas.
3. **Acciones externas bajo confirmación:** Cualquier comando que afecte sistemas externos (`vercel`, `git push`, `firebase deploy`, `npm publish`, llamadas de red salientes) requiere aprobación explícita del humano.
4. **Cero fugas en logs y respuestas:** Nunca imprimir tokens, contraseñas, correos sensibles ni claves en consola ni en respuestas HTTP. Los errores inesperados siempre responden `500 { "error": "Error interno" }`.

## Reglas Técnicas Clave

- Todos los Route Handlers declaran `export const runtime = "nodejs";`.
- Todas las entradas se validan con Zod usando `.strip()` para eliminar campos no declarados.
- Las rutas privadas usan `requireAuth(request)` (`src/lib/authMiddleware.ts`) que valida el token con `getAuth().verifyIdToken()` y extrae `uid`, `email` y `rol`.
- Las rutas `/api/admin/**` usan `requireAdmin(request)` y devuelven `403` si `rol !== "admin"`.
- En Firestore:
  - Reglas bloqueadas: `allow read, write: if false;`.
  - Colecciones privadas bajo `usuarios/{uid}/lista/{id}` y `usuarios/{uid}/item/{id}`.
  - Colección compartida `listas_compartidas/{codigo}` creada con `.create()` y reintento ante colisiones.
  - Campos en `snake_case`, fechas ISO 8601 UTC y `null` en lugar de `undefined`.

## Flujo de Verificación Obligatorio

Tras cualquier cambio de código:
1. `npm run verify:ai-safety`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`

Consultar `AGENTS.md` para la especificación completa y `ia/bitacora-ia.md` para registrar decisiones asistidas por IA.
