# Nico Fit V3: validación en Supabase staging

## Alcance y aislamiento

La validación usa el proyecto descartable `nico-fit-v3-staging` (`tmydirzzlmlmtjgwqcgh`) en São Paulo. El proyecto productivo `gym-futbol` (`xaklsoqyzwowtjwcpwmb`) no se enlaza ni se consulta. Los scripts abortan si reciben el ref productivo o si el ref no coincide con la URL.

El entorno alojado validado ejecuta PostgreSQL `17.6.1.166`, PostgREST `14.5` y Auth `2.196.0`.

Esta rama contiene SQL, fixtures, documentación y pruebas. No modifica el frontend V2, `js/sync.js`, `js/store.js` ni ejecuta cutover.

## Reproducción

1. Crear un proyecto Supabase temporal vacío. Guardar solo su URL y publishable key en variables de la terminal; no usar una secret key ni el proyecto productivo.
2. Generar contraseñas aleatorias y los ocho bloques SQL ignorados por Git:

```powershell
$env:SUPABASE_STAGING_PROJECT_REF = '<staging-ref>'
$env:SUPABASE_STAGING_URL = 'https://<staging-ref>.supabase.co'
$env:SUPABASE_STAGING_PUBLISHABLE_KEY = '<publishable-key>'
npm install
npm run build:v3:staging
```

3. Servir los bloques solo en loopback:

```powershell
npm run serve:v3:staging
```

4. Abrir cada URL `http://127.0.0.1:41739/v3-staging-N.sql` y ejecutar su contenido, en orden, en el SQL Editor del proyecto temporal:

| Fase | Contenido | Resultado esperado |
| ---: | --- | --- |
| 1 | Bootstrap mínimo V2 y dos usuarios reales de Auth | Tablas V2 y usuarios A/B creados |
| 2 | `migration-v3-schema.sql` | Esquema V3 creado |
| 3 | Reejecución de la migración | Sin errores ni cambios destructivos |
| 4 | Fixtures V2 sintéticos | 10 sesiones, 9 workouts y 2 tombstones |
| 5 | Ambos backfills | Entidades y correspondencias creadas |
| 6 | Reejecución de ambos backfills | Mismos conteos, sin duplicados |
| 7 | Grants staging y exposición PostgREST | Solo `authenticated` accede a V3 |
| 8 | `test-v3-staging.sql` | Todas las aserciones pasan |

5. Ejecutar la prueba mediante el cliente público y Auth real:

```powershell
npm run test:v3:staging
```

`.env.v3-staging.local` y `.tmp/` están ignorados. El generador conserva las contraseñas existentes cuando se repite, por lo que regenerar los bloques no invalida los dos usuarios ya creados.

## Dataset y comparación

Los fixtures son equivalentes al dry run de PGlite: sesión normal, dos sesiones el mismo día, ejercicio repetido, series incompletas, medición ambigua, tombstones y registros sin padre inequívoco.

| Objeto | PGlite | Supabase tras primer backfill | Supabase tras segundo backfill |
| --- | ---: | ---: | ---: |
| V2 sessions | 10 | 10 | 10 |
| V2 workouts | 9 | 9 | 9 |
| V2 tombstones | 2 | 2 | 2 |
| V3 sessions | 9 | 9 | 9 |
| V3 session exercises | 6 | 6 | 6 |
| V3 sets | 8 | 8 | 8 |
| Session mappings | 9 | 9 | 9 |
| Workout mappings | 8 | 8 | 8 |
| Set mappings | 8 | 8 | 8 |

Las clasificaciones también coinciden: sesiones `8 migrated / 1 pending_review`; workouts `0 migrated / 6 pending_review / 2 skipped`; sets `6 migrated / 2 pending_review / 0 skipped`.

## Resultados

- Creación y reejecución del esquema: aprobadas.
- Backfill y reejecución: aprobados con conteos idénticos.
- Múltiples sesiones el mismo día y ejercicio repetido: aprobados.
- Casos ambiguos e incompletos: quedan `pending_review` o `skipped`; no se inventan valores.
- Tombstones: impiden importar registros eliminados.
- RLS SQL con dos identidades: aprobado en tablas padre e hijas.
- Auth real con dos usuarios: aprobado.
- Anon: acceso rechazado.
- PostgREST y paginación: esquema visible, página de dos filas y conteo por propietario.
- Acceso cruzado: lectura filtrada por RLS e inserción para otro usuario rechazada.
- Versiones: saltos y versiones obsoletas rechazados por el servidor con `PT409`/HTTP 409.
- Soft delete: tombstone visible para sincronización y resurrección rechazada.

## Diferencias frente a PGlite

1. Un proyecto Supabase vacío necesita el bootstrap V2 antes del esquema V3 porque las tablas de trazabilidad referencian las tablas V2. El runner PGlite hacía este paso internamente.
2. El esquema personalizado debe agregarse explícitamente a `pgrst.db_schemas`, recargar la configuración de PostgREST y recibir grants. Tener tablas y RLS no lo publica automáticamente en la Data API.
3. SQLSTATE `40001` significa `serialization_failure`. La versión alojada de PostgREST lo considera transitorio y reintenta la solicitud. El test real detectó solicitudes que no terminaban. Se cambió el conflicto de versión a `PT409`, que devuelve HTTP 409 sin reintentos, según la [guía de Supabase](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b) y el [mapeo de errores de PostgREST](https://docs.postgrest.org/en/v16/references/errors.html).
4. Supabase usa GoTrue, JWT y los roles reales `anon`/`authenticated`; PGlite simula `auth.uid()`. La prueba `supabase-js` cubre esta diferencia.
5. El SQL Editor advierte sobre DDL, RLS y tablas temporales. Los ocho bloques separados hacen explícito qué fase cambia esquema, carga datos, concede acceso y valida.

## Fallos encontrados y correcciones

1. El conflicto usaba `40001` y generó reintentos continuos de PostgREST, alto consumo y tres conexiones atrapadas. Se terminaron esas conexiones y se cambió el trigger, las pruebas y la documentación a `PT409`.
2. Grants y validación estaban en un mismo bloque de ejecución. Se dividieron en las fases 7 y 8 para que la exposición de PostgREST quede persistida antes de cambiar al rol `authenticated` dentro de una transacción de prueba.
3. La validación SQL contaba todas las sesiones V3. Los tests del cliente crean un único tombstone fijo para comprobar que no puede resucitar, por lo que una repetición legítima alteraba el total. Ahora los conteos de backfill consideran solo entidades enlazadas por las tablas V2→V3; tres ejecuciones consecutivas del cliente conservaron estable ese conjunto.

## Riesgos restantes

- Los fixtures cubren formas conocidas, pero un inventario de tipos, constraints y payloads excepcionales de producción sigue siendo obligatorio antes de un backfill real.
- La publicación de `nico_fit_v3` en PostgREST se hizo solo en staging. Producción debe mantener V3 cerrada hasta el cutover aprobado.
- Los workouts V2 asociados solo por fecha continúan siendo ambiguos si hay más de una sesión ese día.
- El orden histórico de ejercicios y el tipo reps/segundos requieren revisión humana cuando V2 no los distingue.
- El futuro cliente V3 debe enviar `version + 1`, tratar HTTP 409 como conflicto y mantener los tombstones locales hasta confirmar sincronización.
- Las claves y los usuarios del proyecto temporal deben revocarse al terminar la validación o eliminarse junto con el proyecto.

## Criterio go/no-go

**GO para comenzar el cliente V3 en otra rama, detrás de una activación explícita**, cuando las ocho fases y `npm run test:v3:staging` terminan sin fallos, el staging sigue aislado, anon no accede, RLS bloquea ambos sentidos del acceso cruzado, la segunda pasada no cambia conteos y los conflictos devuelven HTTP 409.

**NO-GO para producción o cutover** mientras no se compare el esquema V2 real, se revise cada mapeo ambiguo, se defina observabilidad de conflictos/tombstones, se ensaye un rollback operativo con backup y se apruebe un plan de despliegue. Esta rama no habilita escrituras V3 en el frontend.
