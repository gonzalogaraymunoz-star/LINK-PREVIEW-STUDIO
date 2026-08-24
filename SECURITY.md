# Seguridad

## Secretos
Nunca subir al repositorio:
- `SUPABASE_SERVICE_ROLE_KEY`
- `LINK_MCP_TOKEN`
- contraseñas de usuarios

## Claves públicas
`SUPABASE_PUBLISHABLE_KEY` está diseñada para uso público. El acceso real a datos no depende de ocultarla.

## Navegador
La autenticación usa correo + contraseña contra Supabase Auth desde el servidor. Los tokens se guardan en cookies HttpOnly y el frontend no puede leerlos.

## Autorización
Además de existir en Supabase Auth, el usuario debe existir en `app_members` con estado `active`.

El primer owner solo se crea automáticamente cuando:
- `app_members` está vacío;
- el usuario inicia sesión correctamente;
- su correo coincide exactamente con `LINK_OWNER_EMAIL`.

## HTML generado
Dentro del Studio se ejecuta en un iframe `sandbox` sin `allow-same-origin`, aislándolo del panel administrativo.

## Links externos
Se crean con 32 bytes aleatorios y solo se almacena SHA-256 del token. Expiran entre 5 minutos y 24 horas.

## PDF
Chromium bloquea localhost, metadata addresses, IP privadas evidentes y esquemas que no sean HTTP/HTTPS/data/blob/about.

## MCP
El login del navegador no se comparte con ChatGPT.

En producción el MCP usa una credencial propia y falla cerrado cuando no está configurada.

## Preview HTML aislado

El HTML generado por ChatGPT se considera contenido no confiable. En el Studio, el preview autenticado y el preview compartido se inyectan con `srcdoc` en un `iframe sandbox` **sin `allow-same-origin`**. El endpoint de HTML externo fuerza `Content-Disposition: attachment` y no se utiliza para renderizar HTML arbitrario directamente bajo el origen autenticado de la app.

## MCP

En Vercel/producción, `LINK_MCP_TOKEN` es obligatorio. El endpoint `/mcp` falla cerrado si la variable no existe. Se acepta Bearer, `x-link-mcp-token` y, solo como compatibilidad con conectores que admiten únicamente URL, `mcp_token` en query string.
