# LINK Preview Studio 3.0

Workspace privado para convertir conversaciones de ChatGPT en soluciones digitales organizadas, versionadas y descargables.

## Flujo central

**Conversación → Solicitud → Proyecto → Creación → Versión → Entregable → Evolución**

- **ChatGPT** comprende, diseña y orquesta.
- **LINK Preview Studio** muestra y organiza el trabajo.
- **Supabase** conserva la memoria estructurada.
- **GitHub** guarda el código formal.
- **Vercel** publica la aplicación.

## Arquitectura de producción

Esta versión fue reconstruida para funcionar en **Vercel Hobby sin superar el límite de 12 Serverless Functions**.

Solo existen 7 funciones dentro de `/api`:

1. `auth.ts`
2. `workspace.ts`
3. `projects.ts`
4. `design.ts`
5. `files.ts`
6. `pdf.ts`
7. `mcp.ts`

Los helpers viven en `/lib`, por lo que Vercel no los contabiliza como Serverless Functions.

### Dependencias de producción

La versión fija **Node 24.x** y versiones explícitas de las dependencias críticas. El par PDF está alineado a Chromium 149 (`@sparticuz/chromium 149.0.0` + `puppeteer-core 25.1.0`) para evitar depender de actualizaciones automáticas incompatibles.

## Funcionalidad incluida

### Workspace
- clientes y segmentos;
- proyectos y carpetas anidadas;
- General / Inbox para trabajo sin clasificar;
- panel lateral plegable;
- buscador;
- métricas de operación;
- Proyecto 360.

### Conocimiento reutilizable
- perfiles / ADN de cliente;
- reglas de comunicación;
- reglas de negocio;
- plantillas por segmento y tipo de creación;
- referencias visuales aprobadas.

### Trabajo
- solicitudes;
- briefs de proyecto;
- compromisos;
- entregables;
- integraciones Supabase / GitHub / Vercel / Drive / Gmail / Calendar / Attio;
- historial de actividad.

### Creaciones
- preview HTML completo;
- Desktop / Tablet / Mobile;
- versiones inmutables;
- restaurar una versión antigua como una **nueva** versión;
- mover una creación de proyecto;
- guardar creación como referencia/molde;
- descargar HTML;
- generar PDF;
- links temporales firmados para preview, HTML o PDF.

### Autenticación
El Studio ya **no usa Magic Link como acceso normal**.

Usa:

**Correo + contraseña → Supabase Auth → app_members → cookie HttpOnly**

La sesión se conserva mediante cookies `HttpOnly`, `SameSite=Lax` y `Secure` en producción. El JavaScript del navegador no tiene acceso a los tokens de sesión.

## Instalación en GitHub

Si vas a limpiar el repo actual:

1. Borra el contenido de `gonzalogaraymunoz-star/playgroundlink`.
2. Descomprime esta carpeta.
3. Sube **el contenido interno** de `LINK-PREVIEW-STUDIO-PRODUCTION`, no la carpeta contenedora.
4. Haz commit a `main`.
5. Vercel detectará el commit automáticamente.

La raíz del repo debe verse así:

```text
/api
/lib
/supabase
.env.example
.gitignore
index.html
preview.html
shared.html
package.json
PROJECT_MANIFEST.json
README.md
tsconfig.json
vercel.json
```

## Variables en Vercel

Mantén/configura:

```text
SUPABASE_URL=https://zgbnjlrxzvzpigmwidsp.supabase.co
SUPABASE_SERVICE_ROLE_KEY=***
PUBLIC_BASE_URL=https://playgroundlink.vercel.app
LINK_OWNER_EMAIL=tu-correo-autorizado
```

Recomendado:

```text
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

El código incluye como fallback la publishable key actual de LINK PREVIEW, que no es secreta. La `SERVICE_ROLE_KEY` nunca está en el frontend ni en el repositorio.

Obligatorio en producción:

```text
LINK_MCP_TOKEN=una-clave-larga-y-aleatoria
```

En Vercel, `/mcp` queda **cerrado si esta variable está vacía**. La forma preferida es enviar el token como Bearer o `x-link-mcp-token`. Si el conector solo permite configurar una URL, se admite como fallback `https://playgroundlink.vercel.app/mcp?mcp_token=...`; evita compartir esa URL y rota el token si queda expuesto.

## Usuario de acceso

En Supabase:

**Authentication → Users → Add user → Create new user**

Crea el usuario con:
- correo igual a `LINK_OWNER_EMAIL`;
- contraseña fuerte;
- email confirmado.

En el primer login válido, si `app_members` está vacío, ese usuario se registra automáticamente como `owner`.

Recomendación adicional:

**Authentication → Sign In / Providers → Email → desactivar nuevos registros públicos.**

## Supabase existente

No borres la base `LINK PREVIEW`.

Ya contiene clientes, segmentos, proyectos, creaciones y la evolución V2. El SQL de `/supabase/migrations` es una referencia reproducible y una base para instalaciones frescas.

## MCP

URL:

```text
https://playgroundlink.vercel.app/mcp
```

Herramientas principales:

- `get_workspace_context`
- `register_client_logic`
- `upsert_template`
- `register_request`
- `set_project_brief`
- `get_project_context`
- `create_preview`
- `get_preview`
- `update_preview`
- `list_previews`
- `add_commitment`
- `register_deliverable`
- `set_project_integration`
- `get_client_context`
- `get_template`
- `register_design_reference`
- `export_preview_pdf`
- `create_share_link`

## Comprobación después del deploy

1. Abre `https://playgroundlink.vercel.app/api/auth?op=health`.
2. Debe responder `ok: true`.
3. Abre `https://playgroundlink.vercel.app`.
4. Ingresa con correo + contraseña.
5. Confirma que aparecen los datos actuales de Supabase.
6. Abre una creación y prueba Desktop/Tablet/Mobile.
7. Prueba HTML y PDF.
8. Prueba Compartir: el enlace copiado debe abrir fuera de la sesión durante 60 minutos.
9. En Vercel, el deployment debe tener **7 Serverless Functions**, no más de 12.
10. Comprueba `/mcp` con la credencial configurada; sin `LINK_MCP_TOKEN` debe responder 401 en producción.

## Seguridad

- `SUPABASE_SERVICE_ROLE_KEY` solo servidor.
- sesión del Studio en cookies HttpOnly;
- el HTML generado se visualiza en `iframe sandbox` sin `allow-same-origin`;
- share links usan tokens aleatorios y en Supabase solo se guarda SHA-256;
- links externos expiran;
- los previews compartidos se ejecutan dentro de un `iframe sandbox` con origen aislado, no como HTML arbitrario sobre el origen autenticado del Studio;
- el render PDF bloquea esquemas no HTTP y direcciones locales/privadas evidentes;
- APIs de escritura requieren rol `owner` o `editor`;
- restaurar versiones nunca destruye la historia previa.

## Filosofía

LINK Preview Studio no es otro chat.

El usuario conversa en ChatGPT y el Studio responde visualmente:

1. ¿Qué clientes y proyectos existen?
2. ¿Qué se está pidiendo?
3. ¿Qué se creó y en qué versión va?
4. ¿Qué compromisos y entregables faltan?
5. ¿Qué conexiones están operativas?
6. ¿Qué conocimiento ya podemos reutilizar?
