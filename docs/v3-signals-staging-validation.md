# Validación real: bridge V3 en Supabase staging

Proyecto exclusivo: `nico-fit-v3-staging` (`tmydirzzlmlmtjgwqcgh`). Producción
`gym-futbol` no fue consultada ni modificada. No se ejecutó cutover.

## Procedimiento reproducible

1. Verificar la identidad del proyecto staging en dashboard y URL antes de SQL.
2. Aplicar `supabase/migration-v3-signals.sql`, después
   `supabase/staging-v3-signals-api-grants.sql`. No aplicar schema/backfill V2
   otra vez ni usar credenciales service role en el runner.
3. Reejecutar ambos archivos: tablas/datos se conservan, RLS continúa activo.
   La migración ahora crea triggers/políticas ausentes sin eliminar objetos.
4. Configurar `.env.v3-staging.local` ignorado por Git con URL/ref/publishable key
   y usuarios Auth A/B existentes. No imprimir passwords/tokens ni incorporarlos
   al repositorio.
5. Ejecutar:

```powershell
npm run test:v3:signals:staging
npm test
node --check scripts/v3-signals-staging.mjs
git diff --check
```

Runner rechaza ref productivo, URL distinta de la staging exacta, `sb_secret_`
y JWT service_role antes de login. Usa publishable key y sesiones Auth normales.
No cambia flags de aplicación: featureEnabled se inyecta en instancias de test;
el flag de fuente Coach vive solo temporalmente en el proceso Node.

Usa fechas sintéticas aleatorias de martes para evitar colisiones con la
unicidad de readiness. Sus fixtures quedan en staging, etiquetados por runId;
no se borran físicamente. La cola/maps de prueba usan fake-indexeddb y no la
base local del usuario. El reporte se escribe en `.tmp/v3-signals-staging-result.json`;
el reporte exitoso de esta validación se conserva junto a este documento.

## Resultados

12/12 pasos exitosos en Supabase real, con dos usuarios Auth:

Suite final local: **126/126**; sintaxis del runner y `git diff --check` sin
errores. Incluye test que ejecuta el guard del runner con ref/URL productiva y
claves secret/service_role para verificar rechazo antes de login.

| Paso | Resultado |
| --- | --- |
| Auth / esquema | Login A/B y select visible de las tres tablas vía Supabase JS/PostgREST. |
| Anon | Select rechazado con `42501` en las tres tablas. |
| Creación offline | Readiness, 3 sesiones de fútbol el mismo día y review vinculada, inicialmente pending. |
| Upload | Cinco registros confirmados, versión 1; carga generada 720 AU, null/0 conservados. |
| Download / paginación | Segundo repository obtiene UUIDs y review; páginas de 2 filas y checkpoint persistido. |
| RLS | B no lee/actualiza A; insert cruzado `42501`; vínculo cruzado `23514`; B crea y sincroniza su propio readiness. |
| Update / versión | Update avanza a versión 2; versión obsoleta y salto rechazados como `PT409`/HTTP 409. |
| Conflicto | Edición offline del segundo dispositivo permanece local y conflict; no overwrite silencioso. |
| Importación | 2 registros convertidos/sincronizados, 2 decisiones locales pending_review; reimportación crea 0 duplicados. |
| Coach | Con señales V3 enabled consume energía 4 y fútbol intenso desde V3; score 93 y reducción de volumen, sin leer V2. |
| Soft delete / tombstones | Readiness, partido y review quedan tombstoneados; resurrección rechazada. |
| Repetición | Sync adicional no duplica registros ni cambia versión del registro estable. |

SQL reejecutado exitosamente desde dashboard del proyecto staging; catálogo
`pg_tables` confirmó `rowsecurity=true` en las tres tablas.

## Diferencias frente a PGlite y fallo encontrado

- **Tombstones:** PGlite verifica SQLSTATE `55000`. PostgREST lo transporta como
  **HTTP 500**, no 409. La primera ejecución del runner falló por asumir HTTP 409.
  Se corrigió esa expectativa y se comprobó `classifySyncError({code:'55000',
  status:500}) === 'conflict'`: nunca debe tratarse como transitorio ni reintentarse
  automáticamente. El rechazo real y la inmutabilidad funcionaban; no se cambió
  el trigger compartido de entrenamiento para ocultar esta diferencia.
- **Versiones:** `PT409` sí se convierte en HTTP 409 real.
- **Permisos:** PGlite usa roles/claims simulados; staging verifica JWTs Auth y
  PostgREST, grants y visibilidad del schema. Un select cruzado retorna `[]` y
  update cruzado con `.select()` retorna `[]`, sin error; esto significa cero
  filas afectadas, no autorización concedida.
- **Carga:** columna generada calcula duración×RPE en servidor; el cliente no
  envía calculated_load como autoridad. No se observaron discrepancias de valor.
- **IndexedDB:** el servidor/SDK/Auth son reales; storage en este runner es
  fake-indexeddb reproducible con el repository/sync de la app. No es una prueba
  de persistencia nativa de PWA instalada ni de suspensión de un móvil.

## Riesgos abiertos y decisión

GO para commit/merge de esta rama y comenzar `v3-conflict-ui`, manteniendo flags
apagados y sin deploy/cutover. Esta validación no autoriza publicación.

Antes de activar señales remotamente para uso normal:
- Resolver conflictos y decisiones de importación con UI explícita. Pending_review
  ambiguo se guarda en migration_map local; no se envía una entidad inválida a
  Supabase. Hace falta definir respaldo/gestión remota de esas decisiones si se
  requieren en varios dispositivos.
- Observabilidad debe clasificar `55000` antes del HTTP 500. Normalizar ese
  transporte a PT409 sería una migración aparte del trigger compartido.
- Faltan captura UI V3 y prueba en IndexedDB nativo/PWA instalada con cuota,
  suspensión y reload prolongado. Formularios V2 siguen escribiendo solo V2.
- Readiness tombstone sigue impidiendo recrear la misma identidad/fecha; no
  existe restauración silenciosa.
- Idempotencia presupone objetos compatibles; no repara schema divergente.

Orden preservado: bridge → conflict-ui → observability → routine-identity →
cutover-prep. No hubo commit, merge, push ni deploy durante la validación.
