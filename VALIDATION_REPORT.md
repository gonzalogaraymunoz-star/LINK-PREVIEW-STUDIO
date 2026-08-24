# Validación — LINK Preview Studio 3.0 Production

Fecha de preparación: 2026-08-23.

## Resultado

- Estructura limpia: **PASS**
- Serverless Functions en `/api`: **7**
- Helpers TypeScript dentro de `/api`: **0**
- Herramientas MCP registradas: **18**
- Archivos base del proyecto: **30**
- Parseo JavaScript de `index.html`, `preview.html` y `shared.html`: **PASS**
- Parseo/shape TypeScript con stubs de dependencias: **PASS**
- JSON (`package.json`, `vercel.json`, `tsconfig.json`, manifest): **PASS**
- Escaneo de secretos hardcodeados: **PASS**

## Runtime y dependencias fijadas

- Node `24.x`
- `@modelcontextprotocol/server` `2.0.0`
- `@modelcontextprotocol/node` `2.0.0`
- `@supabase/supabase-js` `2.112.3`
- `@sparticuz/chromium` `149.0.0`
- `puppeteer-core` `25.1.0` — par alineado con Chromium 149
- `zod` `4.4.3`
- TypeScript `7.0.2`

## Seguridad revisada

- Service Role solo server-side.
- Login correo + contraseña server-side.
- Tokens Supabase en cookies HttpOnly / Secure / SameSite=Lax.
- `app_members` como autorización adicional.
- MCP independiente y cerrado en producción si falta `LINK_MCP_TOKEN`.
- HTML generado ejecutado en iframe sandbox sin `allow-same-origin`.
- Preview externo también aislado mediante `shared.html` + iframe sandbox.
- HTML descargable se entrega como attachment, no como página arbitraria same-origin.
- Share tokens aleatorios; en DB solo queda SHA-256; vencimiento máximo 24h.
- PDF bloquea IPs/esquemas locales y privados evidentes.
- Versiones anteriores no se sobrescriben: restaurar crea una versión nueva.

## Alcance de esta validación

La sesión de construcción no dispone de acceso npm saliente, por lo que no se ejecutó un `npm install` / `vercel build` local con dependencias reales. Las versiones se fijaron contra versiones publicadas actuales y el código fue validado estáticamente. El build definitivo lo realizará Vercel después del commit.

El problema que motivó la reconstrucción (`exceeded_serverless_functions_per_deployment`) queda resuelto estructuralmente: el proyecto expone 7 funciones, por debajo del límite de 12 del plan Hobby.
