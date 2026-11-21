# AGENTS.md — Reglas del Proyecto `08-lista-de-compras-api`

Este archivo define las reglas obligatorias de arquitectura, estilo, seguridad y calidad que todo asistente de IA debe cumplir al trabajar en `08-lista-de-compras-api`.

## 1. Propósito y Stack Tecnológico

API REST segura para la aplicación móvil **08 · Lista de compras compartible**, desplegada en **Vercel**.

- **Framework:** Next.js (App Router) con Route Handlers en `app/api/**/route.ts`.
- **Runtime obligatorio:** `export const runtime = "nodejs";` en todos los Route Handlers (Firebase Admin SDK no funciona en Edge Runtime).
- **Lenguaje:** TypeScript con `"strict": true`.
- **Persistencia y Autenticación:** `firebase-admin` (Firebase Auth + Firestore solo vía Admin SDK) + Firebase Auth REST API (`accounts:signUp`, `accounts:signInWithPassword`, `securetoken`).
- **Validación:** `zod` (esquemas estrictos con `.strip()` para descartar campos no declarados).
- **Pruebas:** `vitest` con mocks de Firebase (`vi.mock`).

## 2. Estructura del Repositorio

```text
08-lista-de-compras-api/
├── app/api/
│   ├── health/route.ts
│   ├── auth/{registro,login,refresh,yo}/route.ts
│   ├── lista/route.ts
│   ├── lista/[id]/route.ts
│   ├── item/route.ts
│   ├── item/[id]/route.ts
│   ├── listas/[id]/compartir/route.ts
│   ├── listas/codigo/[codigo]/route.ts
│   ├── listas/codigo/[codigo]/items/[itemId]/route.ts
│   └── admin/stats/route.ts
├── src/lib/
│   ├── firebaseAdmin.ts     # Inicialización segura de Admin SDK (\n -> saltos reales)
│   ├── authMiddleware.ts    # Verificación Bearer token con verifyIdToken()
│   ├── errors.ts            # Respuestas de error normalizadas sin fugas
│   ├── rateLimit.ts         # Límite de tasa para /api/auth/login
│   └── schemas.ts           # Esquemas Zod estrictos (.strip())
├── tests/                   # Pruebas unitarias e integración con Vitest
├── ia/                      # Bitácora, evidencias y pruebas de restricciones de IA
├── scripts/                 # Scripts de verificación automática de seguridad/calidad
├── firestore.rules          # allow read, write: if false;
└── firestore.indexes.json   # Índices compuestos para consultas de sincronización
```

## 3. Convenciones de Datos y Firestore

1. **Acceso exclusivo por Admin SDK:** `firestore.rules` debe mantener siempre `allow read, write: if false;`.
2. **Aislamiento por ruta:** Todos los datos privados viven en `usuarios/{uid}/lista/{id}` y `usuarios/{uid}/item/{id}`. El `uid` se obtiene **exclusivamente** del ID token verificado con `getAuth().verifyIdToken()`, nunca del body, query o parámetro de URL.
3. **Colecciones compartidas:** `listas_compartidas/{codigo}` es escrita únicamente por la API usando `.create()` (con reintento en caso de colisión).
4. **Nombres de campos:** Siempre `snake_case` coincidiendo exactamente con SQLite (`lista_id`, `codigo_compartir`, `created_at`, `updated_at`, `deleted_at`, `owner_uid`, `creada_en`).
5. **Fechas:** Siempre texto ISO 8601 UTC (`new Date().toISOString()`).
6. **Prohibición de `undefined`:** Firestore rechaza `undefined`. Use siempre `null` para campos opcionales o ausentes (`deleted_at: null`, `codigo_compartir: null`).
7. **Campos administrados por el servidor:** `created_at`, `updated_at` y `deleted_at` son establecidos únicamente por el servidor.
8. **Idempotencia:** El cliente genera los UUID; `PUT` crea o reemplaza sin duplicar y preserva `created_at` si el documento ya existe.
9. **Borrado lógico:** `DELETE` asigna `deleted_at` y `updated_at` con la hora actual del servidor; `GET ?since=<ISO>` incluye documentos borrados lógicamente con un máximo de 500 resultados por página más `servidor_ahora`.

## 4. Seguridad Obligatoria (Lo que SÍ y lo que NO)

### SÍ hacer
- Validar **todas** las entradas (body, params, query) con Zod y usar `.strip()` para guardar únicamente los campos declarados.
- Verificar `Authorization: Bearer <token>` con `getAuth().verifyIdToken()` en todas las rutas privadas.
- Verificar el custom claim `rol === "admin"` en todas las rutas bajo `/api/admin/**` (responder `403` si falta).
- Devolver errores en formato uniforme `{ "error": "mensaje", "detalles"?: [{ "campo": "...", "mensaje": "..." }] }`.
- Devolver `401` con el **mismo mensaje genérico** en login exista o no el correo.
- Devolver `500` con `{ "error": "Error interno" }` sin stack traces ni detalles internos.
- Convertir `\n` literales en `FIREBASE_PRIVATE_KEY` a saltos de línea reales en tiempo de ejecución.

### NO hacer
- **NUNCA** leer, imprimir, resumir, copiar ni versionar `.env`, `.env.*`, claves privadas (`*.pem`, `*.key`), certificados ni archivos `service-account*.json` / `*firebase-adminsdk*.json`.
- **NUNCA** salir de la carpeta del repositorio (`08-lista-de-compras-api`) al leer, listar o ejecutar comandos.
- **NUNCA** ejecutar acciones con efecto externo (`git push`, `vercel deploy`, `firebase deploy`, peticiones destructivas a APIs externas) sin confirmación explícita del desarrollador.
- **NUNCA** registrar contraseñas, tokens, encabezados `Authorization` ni datos personales en `console.log` o `console.error`.
- **NUNCA** confiar en `uid`, `rol` ni metadatos sensibles enviados por el cliente.
- **NUNCA** usar `any` implícito ni deshabilitar controles de TypeScript o seguridad.

## 5. Comandos y Verificación Automática de Calidad

Antes de dar por terminada cualquier tarea (incluido código generado por IA), se deben ejecutar y pasar:

```bash
npm run verify:ai-safety   # Verifica restricciones de IA, .gitignore y ausencia de secretos
npm run typecheck          # tsc --noEmit (TypeScript strict)
npm test                   # Vitest (pruebas de rutas + ia/verify-restrictions.test.ts)
npm run build              # Compilación de producción Next.js
```
