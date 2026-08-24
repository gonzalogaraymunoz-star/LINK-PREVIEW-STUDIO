# LINK Preview Studio — Acceso directo

Esta variante elimina la autenticación del navegador.

## Resultado

Al abrir:

https://playgroundlink.vercel.app

el Workspace carga directamente.

No necesitas:
- correo
- contraseña
- Magic Link
- LINK_OWNER_EMAIL

## Se mantiene

- Supabase como backend
- service role solo en servidor
- clientes/proyectos/solicitudes
- previews y versiones
- HTML/PDF/share links
- MCP
- LINK_MCP_TOKEN para proteger `/mcp`

## Advertencia

El Studio web queda accesible a cualquier persona que conozca la URL y sus acciones del navegador funcionan como Owner.

Si más adelante quieres privacidad sin volver a crear cuentas dentro de LINK, usa Vercel Deployment Protection o una restricción externa de acceso.

No publiques `SUPABASE_SERVICE_ROLE_KEY`.
