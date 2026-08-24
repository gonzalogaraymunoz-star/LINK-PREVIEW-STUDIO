# LINK Preview Studio 3.0 — reemplazo limpio

Esta carpeta es la raíz completa del proyecto.

## Lo que tú harás

1. Borra **solo los archivos del repositorio GitHub** `playgroundlink`.
2. No borres el proyecto Supabase `LINK PREVIEW`.
3. No borres el proyecto Vercel `playgroundlink` ni sus variables.
4. Sube **todos los archivos y carpetas contenidos aquí** a la raíz del repo.
5. Commit a `main`.
6. Espera el deploy automático de Vercel.

## Antes del deploy

En Vercel deben existir:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (recomendado)
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUBLIC_BASE_URL`
- `LINK_OWNER_EMAIL`
- `LINK_MCP_TOKEN`

`LINK_MCP_TOKEN` debe ser una cadena larga y aleatoria. No la escribas en GitHub.

## Login

En Supabase Auth debe existir un usuario confirmado con correo + contraseña.
El correo del primer owner debe coincidir con `LINK_OWNER_EMAIL`.

## No ejecutar SQL por rutina

La carpeta `/supabase` contiene una baseline reproducible. El Supabase actual ya tiene la estructura del proyecto, por lo que **no necesitas ejecutar la migration para reemplazar GitHub**.

## Primera comprobación

Después del deploy:

1. `/api/auth?op=health` → `ok: true`
2. Login correo + contraseña.
3. El Workspace debe mostrar los datos ya existentes.
4. Abrir preview.
5. Descargar HTML.
6. Descargar PDF.
7. Compartir preview.
8. Ver versiones y restaurar una como versión nueva.
9. Confirmar en Vercel que hay 7 funciones Serverless.
10. Probar `/mcp` usando `LINK_MCP_TOKEN`.
