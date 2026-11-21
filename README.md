# 08 · Lista de compras compartible — API (`08-lista-de-compras-api`)

Backend REST seguro para la aplicación móvil **08 · Lista de compras compartible**, construido con **Next.js (App Router)**, **Route Handlers (`runtime = "nodejs"`)**, **Firebase Admin SDK**, **Zod** y **Vitest**, listo para desplegar en **Vercel**.

---

## Arquitectura y Regla de Oro

```text
[ App móvil (Expo / SQLite / expo-secure-store) ]
   │  HTTPS + Authorization: Bearer <Firebase ID Token>
   ▼
[ 08-lista-de-compras-api (Next.js Route Handlers · Vercel) ]
   │  Variables secretas SOLO en Vercel
   └──────────────▶ [ Firebase Authentication + Cloud Firestore (solo Admin SDK) ]
```

- La app móvil **no contiene `firebaseConfig` ni ninguna credencial**.
- El acceso a Firestore se realiza **exclusivamente desde esta API** con Firebase Admin SDK. Las reglas de [`firestore.rules`](./firestore.rules) bloquean todo acceso directo (`allow read, write: if false;`).
- El `uid` y el custom claim `rol` se obtienen **únicamente** de `getAuth().verifyIdToken()` y nunca del cuerpo ni de la URL.

---

## Endpoints de la API

Todos los Route Handlers declaran `export const runtime = "nodejs";`.

### Salud

| Método y ruta | Auth | Respuesta |
|---|---|---|
| `GET /api/health` | Pública | `200 { ok: true, servicio, servidor_ahora }` |

### Autenticación (Firebase Auth mediada por la API)

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /api/auth/registro` | `{ email, password }` (`password >= 8`) | `201 { token, refreshToken, expiraEnSeg, usuario: { id, email } }` · `409` correo repetido · `400` clave débil |
| `POST /api/auth/login` | `{ email, password }` | `200 { token, refreshToken, expiraEnSeg, usuario: { id, email } }` · `401` mismo mensaje siempre · `429` límite de tasa |
| `POST /api/auth/refresh` | `{ refreshToken }` | `200 { token, refreshToken, expiraEnSeg }` · `401` token inválido/expirado |
| `GET /api/auth/yo` | Bearer token | `200 { usuario: { id, email, rol } }` · `401` sin/mal token |

### Sincronización incremental (recursos privados en `usuarios/{uid}/...`)

| Método y ruta | Auth | Comportamiento |
|---|---|---|
| `GET /api/lista?since=<ISO>` | Bearer | `200 { items, servidor_ahora }`. Máximo 500 documentos ordenados por `updated_at` ascendente; incluye borrados lógicos (`deleted_at`). |
| `PUT /api/lista/:id` | Bearer | Crea o reemplaza de forma idempotente (preserva `created_at`). Valida con Zod (`.strip()`). `200` con el documento. |
| `DELETE /api/lista/:id` | Bearer | Borrado lógico (`deleted_at` y `updated_at` del servidor). `200 { ok: true }` o `404`. |
| `GET /api/item?since=<ISO>` | Bearer | `200 { items, servidor_ahora }` (máx. 500, incluye borrados lógicos). |
| `PUT /api/item/:id` | Bearer | Idempotente. Valida `nombre` obligatorio y `cantidad` entera `1..99` (`.strip()`). |
| `DELETE /api/item/:id` | Bearer | Borrado lógico (`deleted_at`). `200 { ok: true }` o `404`. |

### Listas compartidas por código

| Método y ruta | Auth | Comportamiento |
|---|---|---|
| `POST /api/listas/:id/compartir` | Bearer (dueño) | Genera un código de 6 caracteres y crea `listas_compartidas/{codigo}` con `.create()` (reintenta automáticamente ante colisiones). |
| `GET /api/listas/codigo/:codigo` | Código compartido | Devuelve la lista y sus productos activos (`deleted_at == null`) sin exponer el `owner_uid`. |
| `PATCH /api/listas/codigo/:codigo/items/:itemId` | Código compartido | Permite marcar **únicamente** el campo booleano `comprado` en productos pertenecientes a esa lista. |

### Administración (Custom Claim `rol = "admin"`)

| Método y ruta | Auth | Comportamiento |
|---|---|---|
| `GET /api/admin/stats` | Bearer + `rol === "admin"` | `200` con métricas agregadas · `401` sin token · `403` si el usuario no tiene el claim `rol = "admin"`. |

---

## Modelo de datos en Firestore

```text
usuarios/{uid}/lista/{id}
  nombre: string
  cerrada: boolean
  codigo_compartir: string | null
  created_at: ISO 8601 UTC
  updated_at: ISO 8601 UTC
  deleted_at: ISO 8601 UTC | null

usuarios/{uid}/item/{id}
  lista_id: string
  nombre: string
  cantidad: integer (1..99)
  categoria: string
  comprado: boolean
  created_at: ISO 8601 UTC
  updated_at: ISO 8601 UTC
  deleted_at: ISO 8601 UTC | null

listas_compartidas/{codigo}
  owner_uid: string
  lista_id: string
  creada_en: ISO 8601 UTC
```

Convenciones aplicadas en toda la API:
- Campos en `snake_case` idénticos a las columnas de SQLite.
- Fechas en formato ISO 8601 UTC (`new Date().toISOString()`).
- Cero valores `undefined` en Firestore (siempre `null`).
- Errores estandarizados: `{ "error": "mensaje", "detalles"?: [{ "campo", "mensaje" }] }`; errores inesperados responden siempre `500 { "error": "Error interno" }` sin detalles ni logs con secretos o PII.

---

## Puesta en marcha local

1. **Instalar dependencias:**
   ```bash
   npm install
   ```

2. **Configurar variables de entorno locales** (crear `.env.local` basado en `.env.example`, nunca versionar):
   ```bash
   cp .env.example .env.local
   ```
   Variables requeridas:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY` (con saltos de línea literales `\n`, convertidos automáticamente al iniciar)
   - `FIREBASE_WEB_API_KEY`

3. **Ejecutar en desarrollo:**
   ```bash
   npm run dev
   ```

4. **Verificar calidad, seguridad y pruebas:**
   ```bash
   npm run verify:ai-safety
   npm run typecheck
   npm test
   npm run build
   ```

---

## Despliegue en Firebase y Vercel

1. En **Firebase Console**:
   - Activar *Authentication → Sign-in method → Email/Password*.
   - Crear base de datos *Cloud Firestore* en modo producción y desplegar [`firestore.rules`](./firestore.rules) y [`firestore.indexes.json`](./firestore.indexes.json).
   - Generar una clave privada de *Cuenta de servicio* y copiar la *Web API Key* del proyecto.
   - Para asignar el rol administrador a un usuario, usar Admin SDK: `getAuth().setCustomUserClaims(uid, { rol: "admin" })`.
2. En **Vercel**:
   - Importar el repositorio `08-lista-de-compras-api`.
   - Configurar `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (pegada con `\n` literales) y `FIREBASE_WEB_API_KEY` en *Settings → Environment Variables*.
   - Desplegar con `vercel deploy --prod`.
   - Comprobar `GET https://<tu-proyecto>.vercel.app/api/health` desde el teléfono.

---

## Configuración de IA y Seguridad (Sección 14)

La configuración de IA del proyecto fue creada y versionada en el **primer commit** del repositorio (`chore(ia): configuracion inicial de IA, reglas de seguridad y evidencias`):

- Reglas del proyecto: [`AGENTS.md`](./AGENTS.md), [`CLAUDE.md`](./CLAUDE.md), [`.cursorrules`](./.cursorrules).
- Restricciones técnicas de acceso a secretos y confinamiento: [`.aiignore`](./.aiignore), [`.cursorignore`](./.cursorignore), [`.claude/settings.json`](./.claude/settings.json), [`.gitignore`](./.gitignore).
- Verificación automatizada: [`scripts/verify-ai-safety.mjs`](./scripts/verify-ai-safety.mjs) (`npm run verify:ai-safety`).
- Evidencias, pruebas y bitácora: [`ia/bitacora-ia.md`](./ia/bitacora-ia.md), [`ia/evidencias-configuracion.md`](./ia/evidencias-configuracion.md) e [`ia/verify-restrictions.test.ts`](./ia/verify-restrictions.test.ts).
