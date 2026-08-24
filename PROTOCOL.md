# Protocolo operativo LINK Preview Studio 3.0

## El usuario trabaja en ChatGPT

La aplicación no incorpora un segundo chat.

### Crear algo nuevo
1. ChatGPT identifica segmento, cliente y proyecto.
2. Si existe contexto previo, lo recupera.
3. Registra la solicitud si corresponde.
4. Recupera ADN del cliente / plantilla / referencias.
5. Genera un `index.html` completo.
6. Usa `create_preview`.
7. Supabase crea `v1`.
8. El Studio lo muestra automáticamente.

### Modificar
1. `get_preview`.
2. ChatGPT conserva lo que no debe cambiar.
3. Reconstruye HTML completo.
4. `update_preview`.
5. Supabase crea nueva versión sin borrar la anterior.

### Enseñar lógica de un cliente
1. El usuario explica el negocio en lenguaje natural.
2. ChatGPT lo estructura.
3. `register_client_logic` almacena ADN, reglas de comunicación y negocio.
4. Ese conocimiento se reutiliza en futuras creaciones.

### Crear molde reutilizable
1. ChatGPT estructura campos, reglas, diseño y salidas.
2. `upsert_template` guarda la plantilla.
3. Nuevas creaciones combinan plantilla + ADN cliente + datos de la solicitud.

### Aprobar una creación como referencia
`register_design_reference` convierte una creación aprobada en referencia visual reutilizable.

### Entregar fuera de LINK
- HTML: descarga directa.
- PDF: render de Chromium.
- Preview externo: link firmado temporal.
- PDF/HTML externo desde ChatGPT: `create_share_link` o `export_preview_pdf`.
