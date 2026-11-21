# Evidencias de Configuración de IA — `08-lista-de-compras-api`

Este documento describe y demuestra las medidas técnicas implementadas desde el **primer commit** del repositorio para cumplir con la **Sección 14 (Configuración de la IA del proyecto)** y cómo verificarlas **en vivo** durante la sustentación.

## 1. Arquitectura de Controles de IA

| Capa | Archivo(s) | Propósito |
|---|---|---|
| Reglas del proyecto | `AGENTS.md`, `CLAUDE.md`, `.cursorrules` | Define stack (`Next.js App Router`, `runtime = "nodejs"`, `firebase-admin`, `zod`, `vitest`), convenciones (`snake_case`, ISO 8601 UTC, `null` en vez de `undefined`), aislamiento `usuarios/{uid}` y prohibiciones. |
| Bloqueo técnico de archivos sensibles | `.aiignore`, `.cursorignore`, `.gitignore` | Excluye `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.keystore`, `service-account*.json` y `*firebase-adminsdk*.json` del contexto de IA y de Git. |
| Políticas de permisos y confinamiento | `.claude/settings.json` | Bloquea (`permissions.deny`) lectura/edición/comandos sobre `.env*`, claves privadas y salida del directorio (`../*`), y exige confirmación (`permissions.ask`) para `git push`, `vercel`, `firebase deploy` y comandos de red externos. |
| Control automático de calidad y secretos | `scripts/verify-ai-safety.mjs` | Escanea el repositorio buscando patrones de secretos hardcodeados, valida la integridad de la configuración de IA y comprueba que Git no rastree archivos sensibles. |
| Pruebas ejecutables de restricciones | `ia/verify-restrictions.test.ts` | Suite Vitest que prueba automáticamente las reglas de bloqueo y el detector de secretos. |

## 2. Guión para Demostración en Vivo en la Sustentación

### Demostración A — Verificar que la configuración nació en el Commit #1

```bash
git log --reverse --stat -n 1
```

**Resultado esperado:** El primer commit del repositorio (`chore(ia): configuracion inicial de IA, reglas de seguridad y evidencias`) contiene únicamente los archivos de gobernanza, restricciones de seguridad y evidencias de IA, previos a cualquier código de la API.

### Demostración B — Probar bloqueo de `.env` y archivos sensibles

1. Crear un archivo temporal local (no versionado):
   ```bash
   echo "FIREBASE_WEB_API_KEY=demo-no-leer" > .env.local
   ```
2. Comprobar que Git lo ignora:
   ```bash
   git check-ignore -v .env.local
   ```
   **Resultado esperado:** `.gitignore:13:.env.*    .env.local`
3. Comprobar que las políticas de IA bloquean su lectura:
   - En Claude Code, intentar pedir al asistente que lea `.env.local` → la regla `Read(.env.*)` en `.claude/settings.json` bloquea la operación automáticamente.
   - En Cursor / herramientas compatibles, `.cursorignore` y `.aiignore` excluyen `.env.local` del indexado y del contexto.
4. Eliminar el archivo temporal tras la demo:
   ```bash
   rm .env.local
   ```

### Demostración C — Probar bloqueo de salida del repositorio y confirmación de acciones externas

1. Abrir `.claude/settings.json` y verificar:
   - `permissions.deny` contiene `Read(../*)`, `Read(../**)`, `Edit(../*)`, `Write(../*)` y `Bash(cd ..*)`.
   - `permissions.ask` contiene `Bash(git push*)`, `Bash(vercel*)`, `Bash(firebase deploy*)`, exigiendo autorización explícita antes de cualquier acción con impacto fuera de la máquina local.

### Demostración D — Ejecución automática del verificador y pruebas de restricciones

```bash
npm run verify:ai-safety
npx vitest run ia/verify-restrictions.test.ts
```

**Resultado esperado:**
- `verify-ai-safety` reporta `OK: Configuración de IA, restricciones de seguridad y escaneo de secretos verificados sin hallazgos.`
- Todas las pruebas de `ia/verify-restrictions.test.ts` pasan en verde, demostrando tanto la integridad de las reglas como la detección inmediata si alguien intenta introducir una clave privada o una API key en el código fuente.
