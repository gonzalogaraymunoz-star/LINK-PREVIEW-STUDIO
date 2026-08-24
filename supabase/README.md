# Supabase — LINK PREVIEW

El proyecto Supabase `LINK PREVIEW` ya contiene la arquitectura V2 aplicada durante el trabajo del 23 de agosto de 2026.

Por eso, al reemplazar el repositorio de GitHub **no necesitas borrar ni recrear Supabase**.

El archivo `migrations/20260824_production_baseline.sql` se incluye para:

- reproducibilidad;
- instalación fresca en otro proyecto;
- reparación de una base incompleta;
- documentación formal del modelo de datos.

Es aditivo e idempotente y no contiene `DROP TABLE` ni borrado de datos.
