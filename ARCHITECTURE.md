# Arquitectura LINK Preview Studio 3.0

```text
Usuario
  ↓
ChatGPT
  ↓
MCP /mcp
  ↓
Supabase LINK PREVIEW
  ↓
Cliente → Proyecto → Solicitud → Creación → Versión → Archivo/Entregable
  ↓
LINK Preview Studio
  ↓
HTML / PDF / enlace temporal
  ↓
GitHub → Vercel → Producción
```

## Plano de seguridad

```text
Navegador
  ↓ correo + contraseña
/api/auth
  ↓
Supabase Auth
  ↓
app_members
  ↓
Cookies HttpOnly
  ↓
APIs privadas del Studio
```

El canal MCP está separado del login del navegador para que ChatGPT no dependa de una sesión abierta en Chrome.

## Funciones Vercel

```text
/api/auth       autenticación y salud
/api/workspace  biblioteca global + clientes/proyectos
/api/projects   Proyecto 360 + acciones
/api/design     creación individual + versiones
/api/files      HTML + links firmados
/api/pdf        renderer PDF
/api/mcp        protocolo ChatGPT
```

Los módulos reutilizables (`db`, `auth`, `share`, `workspace`, `activity`, `http`) están en `/lib` y no se despliegan como funciones independientes.

## Restricción Vercel Hobby

La arquitectura expone solo 7 Serverless Functions. Todo código compartido se ubica en `/lib`, nunca en `/api`, para conservar margen bajo el límite de 12 funciones del plan Hobby.

## Canales de confianza

- Navegador: correo + contraseña → Supabase Auth → cookie HttpOnly → `app_members`.
- MCP: credencial independiente `LINK_MCP_TOKEN`; no comparte la sesión del navegador.
- Archivos externos: tokens temporales hasheados; el preview se ejecuta en sandbox aislado.
