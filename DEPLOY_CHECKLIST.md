# Checklist de reemplazo limpio

## Antes de borrar GitHub
- No borres Supabase.
- No borres las variables de Vercel.
- Conserva el proyecto Vercel `playgroundlink` conectado al mismo repo.

## GitHub
1. Deja el repositorio vacío.
2. Sube todos los archivos de esta carpeta.
3. Comprueba que `/lib` esté fuera de `/api`.
4. Comprueba que `/api` tenga exactamente 7 archivos `.ts`.
5. Commit a `main`.

## Vercel
El build correcto debe terminar sin:

`exceeded_serverless_functions_per_deployment`

La versión usa Node `24.x` para evitar upgrades automáticos de major version.

Variables necesarias:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUBLIC_BASE_URL`
- `LINK_OWNER_EMAIL`
- `LINK_MCP_TOKEN`

Recomendado:
- `SUPABASE_PUBLISHABLE_KEY`

## Supabase Auth
- Usuario creado con correo y contraseña.
- Correo confirmado.
- Correo igual a `LINK_OWNER_EMAIL` para bootstrap del primer owner.
- Desactivar signup público una vez creado el usuario.

## Pruebas
- `/api/auth?op=health`
- Login
- Inicio/Workspace
- Proyecto 360
- Abrir preview
- Descargar HTML
- Descargar PDF
- Compartir preview
- Versiones
- Restaurar versión
- Mover creación
- Guardar como referencia
- MCP `/mcp`

## MCP seguro
- En producción, `LINK_MCP_TOKEN` no puede quedar vacío.
- Preferir Bearer / `x-link-mcp-token`.
- Si el conector solo admite URL, usar temporalmente `?mcp_token=...` y no compartir esa URL.

## Dependencias
- Node 24.x.
- Dependencias críticas fijadas a versiones explícitas; no usar `latest`.
- PDF: Chromium 149 + Puppeteer Core 25.1.0.
