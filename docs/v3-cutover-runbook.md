# Runbook de preparación V2 → V3

Estrategia aprobada el 2026-09-20: **V3 arranca desde cero para el usuario actual**. V2 queda conservado como histórico/legado; no se borra ni se transforma en datos V3. No se ejecutará backfill productivo de datos personales sin una decisión posterior explícita. Los datos V2 y locales que no se migren quedan **conscientemente excluidos de V3**, no eliminados físicamente por este plan. El inventario local y los mappings productivos dejan de ser requisitos de lanzamiento.

Estado operativo al 24/09/2026: **preflight técnico y flujo físico crítico en PASS; CONDITIONAL GO para preparar la ventana de cutover**. En iPhone, hasta build `nico-fit-v45`, pasaron standalone, Auth persistente, offline/reopen/reconnect, sync real, maintenance, kill switch, versión mínima y safe-update con preservación de IndexedDB/Auth/cola. Strategy B de disaster recovery/Auth pasó dos ejecuciones end-to-end en Supabase descartable. Quedan controles operativos de ventana —backup fresco, freeze efectivo del cliente V2 y confirmaciones manuales— y pruebas móviles extendidas que deben ejecutarse o aceptarse explícitamente. Este documento no autoriza SQL productivo, freeze, flags ni deploy.

## Inventario productivo observado

Proyecto comprobado visualmente en Supabase: `gym-futbol`, ref `xaklsoqyzwowtjwcpwmb`, PostgreSQL 17.6. Todas las consultas se ejecutaron dentro de transacciones de sólo lectura o como `SELECT`.

| Elemento | Producción | Esperado | Diferencia |
|---|---:|---:|---|
| Tablas V2 `public` | 6 | 6 | Ninguna |
| Tablas `nico_fit_v3` | 0 | 0 antes de migrar | Ninguna |
| Tablas V2 con RLS | 6 | 6 | Ninguna |
| Índices V2 | 18 | 18 | Ninguna |
| Políticas V2 | 24 | 24 | Ninguna |
| Funciones propias public/V3 | 0 | 0 en V2 | Ninguna |
| Triggers propios public/V3 | 0 | 0 en V2 | Ninguna |
| PK identity `BY DEFAULT` | 6 | 6 | Ninguna |
| Backups mostrados por dashboard | 0 | ≥1 verificado para cutover | **Bloqueante** |
| Migraciones registradas por dashboard | 0 | Historial reproducible deseable | Diferencia operativa |

Las columnas, checks, claves únicas y FKs coinciden con `schema.sql`, `migration-v2.sql` y `migration-v2-sync-hardening.sql`. `anon` y `authenticated` conservan los grants amplios predeterminados de Supabase; RLS evita acceso a filas sin `auth.uid()` coincidente. Durante la ventana crítica se revocarán INSERT/UPDATE/DELETE/TRUNCATE de V2 porque una versión declarada por el cliente no es una barrera confiable contra una PWA antigua.

Conteos observados:

| Entidad | Registros | Rango |
|---|---:|---|
| Usuarios Auth | 1 | — |
| Readiness | 5 | 2026-09-08 → 2026-09-15 |
| Workouts/ejercicios | 4 | 2026-09-15 |
| Series JSON V2 | 12 | 2026-09-15 |
| Sesiones gym | 1 | 2026-09-15 |
| Sesiones fútbol | 1 | 2026-09-14 |
| Match reviews | 0 | — |
| Tombstones V2 | 0 | — |

El detalle no sensible queda en `docs/v3-cutover-production-inventory.json`. La consulta reproducible es `supabase/production-inventory-readonly.sql`.

### Datos sólo locales y alcance histórico

IndexedDB y localStorage dependen del origen, perfil y dispositivo. Bajo la nueva decisión, **no se exige reconciliar datos V2 locales de PC o celular para arrancar V3**. La herramienta de [inventario/export local](v3-local-device-inventory.md) sigue disponible como respaldo voluntario, pero un dispositivo no inventariado ya no bloquea este cutover. Los datos locales V2 no sincronizados pueden perderse si se borra el almacenamiento o deja de funcionar el cliente legado; esa exclusión de V3 es una consecuencia aceptada de la decisión. No borrar V2 ni su almacenamiento durante este trabajo.

## Preflight histórico de migración (no requerido para el lanzamiento)

`supabase/preflight-v3-production-readonly.sql` reproduce las reglas sin crear tablas, funciones ni temporales.

| Destino | Migrated | Pending review | Skipped | Condición |
|---|---:|---:|---:|---|
| `workout_sessions` | 1 | 0 | 0 | Sesión terminada |
| `session_exercises` | 4 | 0 | 0 | Cuatro posiciones prescritas aprobadas y ligadas a PK V2 |
| `exercise_sets` | 12 | 0 | 0 | Identidad y unidad aprobadas; valores preservados literalmente |
| `daily_readiness` | 5 | 0 | 0 | Conversión `freshness = 6 - fatigue` |
| `football_sessions` | 1 | 0 | 0 | Tipo reconocido |
| `match_reviews` | 0 | 0 | 0 | Sin fuentes |

No se detectaron sesiones draft, ejercicios sin sesión, múltiples sesiones candidatas, identidades desconocidas, tipos de fútbol desconocidos, series inválidas, tombstones malformados ni entidades inesperadas. Los hashes de identidad permiten repetir la revisión sin publicar nombres, usuario, notas, cargas ni valores de readiness.

La revisión humana quedó registrada en `config/v3-production-workout-mappings.v1.json`. Los cuatro mappings aprobados y las doce series son evidencia para una **eventual migración posterior, separada y explícitamente autorizada**. El preflight exigiría repetir la comparación de huellas sobre una fuente fresca si se decidiera usarlos. No son necesarios para iniciar V3 y esta proyección no autoriza ni ejecuta backfill.

## Backup y restauración

La falta de backup administrado impone estos pasos:

1. Instalar versiones compatibles de `pg_dump`, `pg_restore` y `psql`.
2. Configurar `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` sin guardar secretos en archivos del repo.
3. Configurar `NICO_FIT_PROD_PROJECT_REF=xaklsoqyzwowtjwcpwmb` y `NICO_FIT_BACKUP_APPROVAL=approved-read-only-backup`.
4. Ejecutar `ops/v3-cutover/backup-production.ps1 -Execute` en almacenamiento cifrado.
5. Confirmar tamaño y SHA-256 del dump, esquema e inventario en `manifest.json`.
6. Restaurar en un stack Supabase local y descartable mediante `restore-verify-isolated.ps1`; el script rechaza tanto producción como `nico-fit-v3-staging`, que debe conservarse.
7. Verificar RLS, Auth y suite de integración sobre la restauración. El backfill dry-run y el inventario de datos V2 quedan como ejercicios opcionales de recuperación histórica, no como pasos de lanzamiento V3.
8. Registrar fecha, operador, checksum, destino cifrado y prueba de restauración.

El dump contiene información personal. Se almacena cifrado, con acceso limitado y sin subirlo a Git. `pg_restore --clean` sólo está autorizado contra un stack Supabase local descartable creado para la prueba. La restauración productiva nunca se improvisa con `pg_restore`; se usa el procedimiento aprobado por Supabase o una reconciliación revisada. El staging existente no se borra ni se reutiliza como destino de restore.

El JSON de `/local-device-inventory.html` conserva una opción de respaldo local voluntario por navegador/PWA. Incluye SHA-256 de contenido y un validador, pero no se exige para activar V3 desde cero. El script previo `local-backup-browser.js` y `local-restore-browser.js` queda sólo para el procedimiento de recuperación ya documentado; el inventario no importa ni restaura datos.

## Activación gradual y reversible

El rollout remoto V3 está implementado y validado en staging. Expone configuración pública sin secretos, versión mínima, maintenance mode y kill switches independientes; conserva una last-known-good para uso local offline y exige revalidación remota antes de sincronizar. Los flags permanecen apagados por defecto y ninguno activa otro implícitamente.

Orden obligatorio:

1. **Storage V3**: habilitar IndexedDB vacío para el usuario actual; no invocar importadores V2. V2 queda como histórico/legado.
2. **Signals**: habilitar captura V3 nueva de readiness/fútbol/reviews; no importar señales V2. Sync de señales permanece apagado.
3. **Routines**: habilitar identidad y snapshots de rutinas V3 nuevas; sync de rutinas permanece apagado.
4. **Training**: habilitar para una cohorte interna después de probar sesión activa y recuperación local V3.
5. **Sync**: habilitar señales/rutinas y motor V3 sólo después de validar esquema, RLS, versión mínima y protección contra clientes V2 antiguos. No depende de backfill.
6. **Conflicts**: habilitar panel antes de ampliar la cohorte; cero resolución automática.
7. **Observability**: habilitar panel y auditoría, verificar retención y ausencia de secretos.
8. **Coach**: habilitar al final; con poco historial V3 debe usar sus reglas conservadoras y explicar la falta de tendencia personal.

Cada paso requiere 24 horas o un ciclo de entrenamiento observado, cero pérdida de datos, cola estable y rollback probado. Un kill switch apaga el módulo recién habilitado sin apagar storage ni borrar datos. Training y sync nunca se encienden implícitamente.

## Clientes antiguos, caché y pestañas abiertas

- Definir `CLIENT_BUILD_ID` y `MIN_SUPPORTED_BUILD_ID` en configuración remota. Un cliente inferior entra en modo sólo lectura y muestra actualización requerida.
- La protección fuerte es `cutover-freeze-v2-writes.sql`: revoca DML V2 a `anon` y `authenticated`. Una pestaña antigua conservará su borrador local, pero el servidor rechazará la escritura.
- Publicar primero una versión puente con flags apagados, export local opcional, manejo de `409/403`, versión mínima y pantalla de actualización. Esperar adopción antes del cutover.
- El service worker usa activación explícita coordinada: una build waiting no fuerza reload, consulta los bloqueos locales y sólo ejecuta `skipWaiting()` después de una decisión segura. La prueba física confirmó “Después”, bloqueo durante sesión y actualización posterior sin perder Auth, IndexedDB ni cola. V16 no participa de este protocolo y se controla mediante freeze/version mínima durante el primer salto.
- En la ventana crítica: cerrar pestañas adicionales, terminar o conservar la sesión V2 en el cliente legado, activar freeze, recargar hasta que `CLIENT_BUILD_ID` coincida y recién entonces activar V3. No trasladar automáticamente una sesión V2 activa a V3.
- Una pestaña vieja abierta recibe rechazo de escritura V2 y no puede iniciar sync V3. Sus datos locales no se fusionan automáticamente; el export voluntario permite conservarlos fuera de V3.

## Rollback

| Momento | Acción | ¿Simple? |
|---|---|---|
| Antes de escrituras V3 | Apagar flags, retirar release puente si corresponde, mantener V2 | Sí |
| Esquema V3 creado, aún sin escrituras personales V3 | Apagar flags, revocar grants V3 si corresponde y conservar el esquema para revisión; V2 intacto | Sí |
| Freeze V2 activo, todavía sin escrituras V3 | Ejecutar `rollback-unfreeze-v2-writes.sql` con aprobación y volver a V2 | Sí |
| Después de cualquier escritura V3 confirmada | Congelar V2 y V3, exportar deltas, comparar versiones/tombstones y reconciliar por entidad | **No** |

El punto de no retorno simple es la primera escritura V3 aceptada después del freeze. A partir de allí no se restaura un dump sobre producción ni se vuelve a habilitar V2 como camino de escritura sin decidir qué hacer con los datos nuevos V3: exportarlos, conservar V3 read-only o reconciliarlos explícitamente. **V2 no contiene esas nuevas sesiones V3**. El backup sigue siendo evidencia y recuperación de desastre, no un mecanismo automático de overwrite.

ABORT inmediato antes de escribir V3 si falla el backup/restauración exigido, la versión mínima o el bloqueo de clientes V2 antiguos no se aplican, el service worker cambia código durante una sesión sin conservar el estado, el usuario V3 ya tiene datos inesperados que no se han revisado, o falla una prueba de dispositivo bloqueante. Datos V2 sólo locales, `pending_review` de mappings históricos y diferencias de conteos V2 ya no son causas de ABORT bajo el arranque limpio.

## Pruebas de dispositivo

| Caso | Estado | Evidencia requerida |
|---|---|---|
| Navegador Edge normal | CONDITIONAL | Preview y UI verificados; el ciclo físico principal se ejecutó en iPhone. |
| Standalone PWA | PASS | Instalación, Auth persistente, offline/reopen/reconnect, update y sesión activa. |
| Android | Pendiente/según disponibilidad | Chrome/PWA, bloqueo 30 min, reconexión |
| iPhone/iOS | PASS crítico | Home Screen, Auth, offline, reaperturas, controles remotos, sync y safe-update hasta v45. |
| Suspensión prolongada | Pendiente | 2 h y una noche; timers, lease y cola correctos |
| Pérdida/recuperación de red | PASS | Escritura offline, Auth/rollout revalidados, sync real y cola final 0. |
| Dos dispositivos | Pendiente | Entidades distintas y misma entidad/conflicto |
| Dos pestañas | Pendiente | Web Locks, lease y recuperación de cierre |
| Update de SW durante sesión | PASS | Waiting no interrumpió la sesión; update aplicado al quedar seguro. |
| Sesión activa durante cambio de versión | PASS | Estado preservado; drafts abandonados se descartaron explícitamente mediante tombstones. |

Cada ejecución registra dispositivo/OS/navegador/build, flags, usuario de prueba, timestamps, capturas no sensibles, colas antes/después y resultado. Android/iOS no disponibles se marcan como excepción explícita; no se convierten automáticamente en PASS.

## Auditoría y eliminación de cuenta

- Conflictos V3 abiertos y tombstones: retener durante el rollout y al menos 180 días después del cutover estable. Los mapas históricos V2→V3 quedan archivados; si algún día se autoriza migrar, definir entonces su retención específica.
- Decisiones de conflicto resueltas: 365 días.
- Eventos operativos exitosos: 90 días.
- Errores y eventos críticos: 180 días, sin payloads completos, tokens, notas ni valores de salud.
- Backups de cutover: 90 días después de declarar V3 estable y cerrar reconciliaciones; luego eliminación manual registrada.
- No existe purga automática. La política y sus funciones administrativas de preview/purge fueron validadas en staging; `anon` y `authenticated` no pueden purgar y la operación exige rol administrativo explícito.

Ante eliminación de cuenta: autenticar nuevamente al usuario, ofrecer export, congelar sync, inventariar V2/V3/auditoría, borrar en transacción administrativa desde hijos hacia padres, borrar mapas/auditoría según obligación aplicable, eliminar Auth al final, borrar IndexedDB/localStorage en cada dispositivo y registrar sólo un comprobante no identificable. La solicitud explícita prevalece sobre la retención operativa. Ninguna cuenta se elimina desde el frontend con service role.

## Checklist PRE-CUTOVER

- [ ] Commit desplegado con release puente, flags apagados y versión mínima.
- [x] Backup lógico V2 con checksum y restauración aislada aprobado.
- [x] Strategy B de disaster recovery/Auth verificada end-to-end dos veces en Supabase descartable: remap, login, JWT, RLS, FKs y auditoría PASS.
- [ ] Generar un backup fresco con checksum durante la ventana autorizada.
- [ ] Confirmar explícitamente que V3 del usuario actual empieza sin datos personales previos; cualquier dato V3 de pruebas se revisa antes de activar, sin borrado automático.
- [x] Decisión registrada: V2 queda histórico; datos no migrados, incluidos los sólo locales, se descartan **para V3** sin borrar la fuente.
- [x] Cuatro mappings y doce sets documentados para una eventual migración posterior; no son condición de lanzamiento.
- [ ] SQL de esquema, señales, observabilidad y rutinas reejecutado en clon restaurado.
- [x] RLS/anon/dos usuarios validados en staging.
- [x] Flujo físico crítico iPhone en PASS: standalone, Auth, offline/reconnect, sync, rollout y safe-update.
- [ ] Completar o aceptar explícitamente las excepciones de suspensión prolongada, dos pestañas y dos dispositivos.
- [x] Política de auditoría aprobada y validada en staging.
- [ ] Responsable de DB, release y validación presentes.
- [ ] Ventana y canal de comunicación definidos.
- [ ] Confirmación manual explícita del propietario para iniciar.

## Runbook ejecutable de CUTOVER (preparado, no autorizado)

Este procedimiento se ejecuta paso a paso. Nunca se encadenan migraciones, freeze, deploy y flags en un solo comando. Los valores entre `<...>` se completan en la hoja de ventana y se revisan entre dos personas. Las credenciales viven sólo en variables de entorno locales; no se copian a la terminal, al acta ni a Git. Todos los pasos son compatibles con planes FREE: backup lógico manual, proyecto descartable/local para restore, Git/Vercel y configuración remota propia; no dependen de PITR, branching ni backups administrados.

### Prerrequisitos de la ventana

- Commit candidato firmado y hash exacto registrado; `main` protegida y sin cambios ajenos durante la ventana.
- Responsable de decisión, operador DB, operador release y validador presentes. Una persona puede cubrir más de un rol, pero quien opera no aprueba su propio resultado crítico.
- Acceso administrativo a PostgreSQL productivo mediante variables `PG*`, acceso GitHub/Vercel y un cliente V2 antiguo conservado para la prueba negativa.
- `pg_dump`, `pg_restore`, `psql`, Git y Node disponibles; reloj de todos los operadores sincronizado.
- Destino cifrado con espacio para backup y manifest; stack Supabase local descartable preparado para restauración.
- Build V3 objetivo y `minimum_client_version` anotados como el mismo valor (`<TARGET_BUILD>`).
- Ninguna sesión V2 en curso. El usuario conoce que V3 inicia vacío y que V2 queda sólo como histórico.
- SQL y scripts revisados desde el mismo commit candidato. Quedan expresamente excluidos `backfill-v2-sessions.sql` y `backfill-v2-workouts.sql`.
- Artefacto productivo `sql/v3-production-api-grants.sql` incluido en el commit candidato y validado dos veces en el proyecto DR. Los archivos `staging-v3-*-api-grants.sql` no se ejecutan en producción.
- Hoja de evidencias creada con timestamps UTC/ART, operadores, hashes, capturas no sensibles y decisión GO/ABORT por paso.

### 1. Autorizar la ventana

**Sistema afectado:** operación humana; ningún sistema técnico cambia.

**Procedimiento exacto:** registrar en la hoja: fecha/hora de inicio y fin, hash candidato, `<TARGET_BUILD>`, ref productivo `xaklsoqyzwowtjwcpwmb`, responsables, canal de incidentes y aceptación explícita de V3 vacío. Confirmar verbalmente y por escrito: `AUTORIZO INICIAR CUTOVER V3 HASTA EL PASO 3`. Cada paso de escritura posterior exige su propia aprobación.

**PASS/GO:** cuatro roles cubiertos, ventana vigente, hash único, usuario sin sesión activa y aprobaciones registradas. **ABORT:** falta un responsable, hay actividad V2, el hash cambió o la autorización es ambigua.

**Rollback:** no aplica; no hubo cambios. **Reversible:** sí. **Aprobación humana:** propietario y responsable de DB. **Evidencia:** acta de ventana y `git rev-parse <CANDIDATE>`.

### 2. Generar backup fresco y verificar checksum/restauración

**Sistema afectado:** producción en sólo lectura y destino local cifrado.

```powershell
$env:NICO_FIT_PROD_PROJECT_REF='xaklsoqyzwowtjwcpwmb'
$env:NICO_FIT_BACKUP_APPROVAL='approved-read-only-backup'
# PGHOST, PGPORT, PGDATABASE, PGUSER y PGPASSWORD se cargan desde el gestor local de secretos.
.\ops\v3-cutover\backup-production.ps1 -OutputDirectory '<ENCRYPTED_BACKUP_DIR>' -Execute
Get-Content '<BACKUP_DIR>\manifest.json'
Get-FileHash -Algorithm SHA256 '<BACKUP_DIR>\nico-fit-production.dump'
```

Restaurar el mismo archivo en un stack local descartable, nunca en producción ni staging:

```powershell
$env:NICO_FIT_TARGET_PROJECT_REF='<DISPOSABLE_LOCAL_REF>'
$env:NICO_FIT_TARGET_KIND='disposable-local-supabase'
$env:NICO_FIT_RESTORE_APPROVAL='approved-isolated-restore'
# Las variables PG* ahora apuntan exclusivamente al stack local descartable.
.\ops\v3-cutover\restore-verify-isolated.ps1 -BackupFile '<BACKUP_DIR>\nico-fit-production.dump' -Execute
psql -X -v ON_ERROR_STOP=1 -f .\supabase\production-inventory-readonly.sql *> '<BACKUP_DIR>\restored-inventory.txt'
```

**PASS/GO:** manifest con fecha de la ventana, tamaños mayores que cero, hashes recalculados idénticos, restore aislado exitoso y conteos V2 iguales al origen. **ABORT:** dump ilegible, hash distinto, restore fallido, diferencias no explicadas o guardas de ref rechazadas.

**Rollback:** borrar sólo el stack local descartable después de retener evidencia; producción no cambió. **Reversible:** sí. **Aprobación humana:** previa al `-Execute` y GO del responsable DB tras restore. **Evidencia:** `manifest.json`, inventarios origen/destino, log sin secretos y ubicación cifrada.

### 3. Crear y verificar el baseline V3 con flags apagados

**Sistema afectado:** esquema aditivo productivo `nico_fit_v3`; V2 permanece intacto.

Tras autorización específica `AUTORIZO BASELINE V3`, cargar variables `PG*` productivas y ejecutar individualmente, deteniéndose ante el primer error:

```powershell
psql -X -v ON_ERROR_STOP=1 -f .\supabase\migration-v3-schema.sql
psql -X -v ON_ERROR_STOP=1 -f .\supabase\migration-v3-signals.sql
psql -X -v ON_ERROR_STOP=1 -f .\supabase\migration-v3-observability.sql
psql -X -v ON_ERROR_STOP=1 -f .\supabase\migration-v3-audit-retention.sql
psql -X -v ON_ERROR_STOP=1 -f .\supabase\migration-v3-routines.sql
psql -X -v ON_ERROR_STOP=1 -f .\supabase\migration-v3-free-workouts.sql
psql -X -v ON_ERROR_STOP=1 -f .\supabase\migration-v3-rollout-control.sql
```

Repetir la misma secuencia para demostrar idempotencia. Luego ejecutar `production-inventory-readonly.sql` y comprobar mediante SQL Console que todas las columnas `v3_*_enabled` y `v3_enabled` son `false`, `maintenance_mode=true` para la ventana y las tablas personales V3 tienen cero filas. No ejecutar backfill.

**PASS/GO:** dos ejecuciones completas, RLS habilitado, políticas esperadas, config singleton válida, V3 personal vacío y las seis tablas V2/conteos sin cambios. Además, el bundle productivo de PostgREST/grants está versionado y revisado, aunque todavía no se aplica. **ABORT:** cualquier fila personal V3 inesperada, RLS ausente, flag activo, migración no idempotente, cambio V2 o bundle de grants incompleto.

**Rollback:** antes de toda escritura V3, mantener flags apagados; preferentemente conservar el esquema inerte para análisis. Si la decisión formal exige retirarlo, usar los rollback V3 versionados sólo después de verificar cero filas. **Reversible:** sí mientras V3 no acepte datos. **Aprobación humana:** DB antes de migraciones y GO conjunto tras baseline. **Evidencia:** logs de ambas ejecuciones, inventario, políticas, grants, config y conteos cero.

### 4. Establecer versión mínima objetivo y congelar escrituras V2

**Sistema afectado:** `nico_fit_v3.rollout_config` y grants de tablas V2 productivas.

Primero actualizar la config singleton en una transacción: incrementar `config_version` exactamente en uno, establecer `minimum_client_version='<TARGET_BUILD>'`, mantener `maintenance_mode=true` y todos los flags V3 en `false`. Guardar el row anterior y posterior. La versión mínima protege clientes nuevos; **no protege V16**.

Después de aprobación `AUTORIZO FREEZE V2`, ejecutar:

```powershell
$previousPgOptions=$env:PGOPTIONS
$env:PGOPTIONS='-c nico_fit.cutover_v2_write_freeze=approved -c nico_fit.expected_project_ref=xaklsoqyzwowtjwcpwmb'
psql -X -v ON_ERROR_STOP=1 -f .\supabase\cutover-freeze-v2-writes.sql
$env:PGOPTIONS=$previousPgOptions
```

Verificar que `anon` y `authenticated` carecen de INSERT/UPDATE/DELETE/TRUNCATE sobre las seis tablas V2, mientras SELECT continúa según RLS.

**PASS/GO:** config avanza sólo una versión, flags siguen apagados y los grants DML V2 están revocados. **ABORT:** cambió otro flag, falla el guard/ref, queda cualquier grant de escritura V2 o SELECT/RLS se rompe.

**Rollback:** antes de escrituras V3, ejecutar el paso de unfreeze de la etapa 10 y restaurar la fila de rollout mediante una nueva versión, nunca decrementando `config_version`. **Reversible:** sí. **Aprobación humana:** propietario + DB. **Evidencia:** filas config antes/después y consulta de grants.

### 5. Demostrar que un cliente V2 antiguo no puede escribir

**Sistema afectado:** cliente legacy y API productiva; no debe persistirse ninguna fila.

**Procedimiento exacto:** usar la pestaña/PWA V2 abierta antes del freeze con su sesión normal. Registrar los conteos/`updated_at` de la entidad elegida. Intentar una única escritura controlada desde el flujo V2 (por ejemplo guardar un check-in identificable de prueba) y capturar la respuesta de red. No reintentar ni cambiar permisos para hacerla pasar. Consultar de nuevo los conteos y confirmar que no hubo inserción/actualización.

**PASS/GO:** HTTP 401/403 o PostgreSQL `42501`, UI legacy informa fallo, y conteos/filas no cambian. **ABORT:** HTTP 2xx, fila nueva/modificada, cola legacy se declara sincronizada o el cliente puede escribir por otra tabla/ruta.

**Rollback:** si PASS, conservar freeze. Si ABORT, mantener `maintenance_mode=true`, no desplegar V3, cerrar la ventana y corregir el freeze. Si se abandona completamente el cutover, ejecutar unfreeze sólo con aprobación. **Reversible:** sí; el intento debe fallar. **Aprobación humana:** GO explícito del validador antes del deploy. **Evidencia:** build V2, timestamp, captura/respuesta sanitizada y consulta antes/después.

### 6. Merge, push y deploy del cliente V3

**Sistema afectado:** GitHub `main` y deployment productivo de Vercel. El esquema continúa en maintenance y sin flags.

```powershell
git fetch origin
git switch main
git pull --ff-only origin main
git merge --no-ff feature/v3-final-preflight
git rev-parse HEAD
git status --short
git push origin main
```

Usar exclusivamente la integración Git de Vercel: no ejecutar además `vercel --prod`. Esperar deployment `READY`, comprobar que su source commit coincide con el merge hash y que el dominio productivo apunta a ese deployment.

**PASS/GO:** merge sin conflictos, árbol limpio, push exacto, deployment READY del hash aprobado y `/api/config` reporta el ref productivo esperado sin secretos. **ABORT:** conflicto, checks fallidos, commit distinto, preview/staging config, error de build o cambio del dominio inesperado.

**Rollback:** antes de escrituras V3, promover/reasignar el último deployment productivo conocido o revertir el merge y desplegar ese revert; conservar freeze hasta decidir. **Reversible:** sí antes del punto de no retorno. **Aprobación humana:** release antes de merge, push y promoción. **Evidencia:** hashes feature/merge, checks, deployment ID/URL, hora READY y respuesta sanitizada de `/api/config`.

### 7. Verificar el deploy sin habilitar V3

**Sistema afectado:** PWA productiva y lectura de config/Auth.

**Procedimiento exacto:** abrir en ventana limpia y PWA instalada; confirmar build `<TARGET_BUILD>`, branding/iconos/manifest, service worker de la misma build, login persistente, pantalla de mantenimiento/actualización requerida y V3 inaccesible por flags. Recargar dos veces y comprobar que no mezcla assets. Confirmar que V2 continúa legible como histórico y que no puede escribir.

**PASS/GO:** build y SW coinciden, Auth válido, IndexedDB existente intacto, cero requests de escritura V3, V2 read-only y ningún error crítico. **ABORT:** mismatch de build/SW, pérdida de Auth/local data, escritura V2, flag V3 efectivo inesperado o configuración no productiva.

**Rollback:** deployment anterior/revert con flags apagados; mantener freeze o, si se cancela la ventana, unfreeze aprobado. **Reversible:** sí. **Aprobación humana:** validadores desktop y móvil. **Evidencia:** build/SW, manifest, capturas, red sanitizada y config efectiva.

### 8. Activar flags gradualmente

**Sistema afectado:** grants/API V3 y una fila productiva de `rollout_config`; no requiere redeploy.

Antes de habilitar el primer flag y con aprobación `AUTORIZO API V3`, aplicar el artefacto productivo versionado mediante `cutover-v3.sql`. El bloque expone `nico_fit_v3` en PostgREST, concede los permisos mínimos ya validados y conserva `anon` sin acceso a datos personales; únicamente `rollout_config` mantiene la lectura pública aprobada. No reutilizar directamente scripts llamados `staging-*`.

```powershell
$previousPgOptions=$env:PGOPTIONS
$env:PGOPTIONS='-c nico_fit.allow_v3_cutover=approved'
psql -X -v ON_ERROR_STOP=1 -f .\supabase\cutover-v3.sql
$env:PGOPTIONS=$previousPgOptions
```

Verificar el schema cache de PostgREST y los grants con `authenticated` y `anon` antes de tocar flags. Si `sql/v3-production-api-grants.sql` no coincide con el artefacto revisado del commit candidato, el resultado es ABORT.

Por cada transición: leer la fila actual, incrementar `config_version` exactamente en uno y cambiar **sólo** el flag indicado. Verificar desde el cliente y guardar la fila/history antes de continuar. Secuencia obligatoria:

1. `v3_enabled=true` y `v3_storage_enabled=true`.
2. `v3_signals_enabled=true`.
3. `v3_routines_enabled=true`.
4. `v3_training_enabled=true`.
5. `v3_sync_enabled=true` sólo después de aprobar los checks locales de training.
6. `v3_conflicts_enabled=true`.
7. `v3_observability_enabled=true`.
8. `v3_coach_enabled=true` al final.

Mantener `maintenance_mode=true` hasta terminar el paso 4. Para abrir operaciones remotas, publicar una nueva versión cambiando sólo `maintenance_mode=false`; después habilitar sync en una versión posterior. Ningún update agrupa dos decisiones salvo la pareja maestra `v3_enabled/storage` aprobada.

**PASS/GO:** PostgREST expone V3, `authenticated` recibe sólo permisos mínimos sujetos a RLS, `anon` queda rechazado en datos personales; cada versión sube uno, sólo cambia el campo autorizado, cliente recibe config fresca y el módulo previo sigue estable durante el período aprobado (mínimo un ciclo observado; 24 h para ampliar cohorte). **ABORT:** bundle de grants ausente/incompleto, acceso anon o cruzado, config inválida/stale, activación implícita, error de storage/training, dato V2 importado o fallo de UI.

**Rollback:** kill switch por una nueva versión: apagar primero el flag recién activado; `v3_sync_enabled=false` detiene red sin borrar cola. `maintenance_mode=true` pausa toda operación remota preservando uso local. **Reversible:** flags sí; los datos V3 ya aceptados no. **Aprobación humana:** una por cada flag y una adicional antes de quitar maintenance. **Evidencia:** history de config, capturas, timestamps y métricas/cola por fase.

### 9. Ejecutar checks de Auth, RLS, cola y sync

**Sistema afectado:** cliente y V3 productivos, sólo con el usuario/cohorte autorizados.

**Procedimiento exacto:** después de habilitar training, crear una sesión mínima nueva V3, completar una serie y finalizarla; comprobar status/`ended_at`. Crear una modificación offline, confirmar `pending`, recuperar red, revalidar Auth y config, sincronizar y comprobar cola `0/synced`. Con un segundo usuario sintético autorizado, intentar leer el UUID del primero y esperar cero filas/403; con anon, esperar rechazo. Verificar tombstone con un registro sintético de la cohorte y confirmar que no resucita. Revisar observabilidad: último sync, checkpoint, lock/lease, failed/conflicts y auditoría sin payload sensible.

**PASS/GO:** Auth persiste/refresh, RLS aísla usuarios, anon rechazado, cola vuelve a 0, sin `syncing`/lease abandonado, cero conflictos inexplicados y auditoría válida. **ABORT:** acceso cruzado, anon autorizado, pérdida/duplicado, resurrección, cola creciente, PT409 en flujo simple o refresh/config posterior al envío.

**Rollback:** activar `maintenance_mode=true` y `v3_sync_enabled=false`; no borrar cola ni datos. Si todavía no hubo escritura V3, puede restaurarse V2 simple. Si ya la hubo, aplicar el rollback con reconciliación de la etapa 10. **Reversible:** controles sí; escritura aceptada marca el punto de no retorno simple. **Aprobación humana:** validador antes de ampliar cohorte. **Evidencia:** IDs sintéticos, estados de cola antes/después, respuestas RLS sanitizadas, checkpoint y audit ID.

### 10. Cerrar ventana o ejecutar rollback de la etapa alcanzada

**Sistema afectado:** según la última etapa aprobada.

| Etapa alcanzada | Acción exacta de rollback | Tipo |
|---|---|---|
| 1–2 | Cancelar ventana; conservar backup/evidencia. | Totalmente reversible |
| 3, cero escrituras V3 | Flags apagados; conservar esquema inerte o ejecutar rollback V3 aprobado tras verificar conteos cero. | Reversible |
| 4–5, V2 congelado y cero escrituras V3 | Ejecutar `rollback-unfreeze-v2-writes.sql` con guard; publicar nueva config con maintenance/flags apagados. | Reversible |
| 6–7, deploy nuevo y cero escrituras V3 | Revert/promote deployment anterior, luego unfreeze aprobado. | Reversible |
| 8 antes de primera escritura V3 | Apagar flags por nuevas versiones; maintenance; revert deploy si hace falta; unfreeze V2. | Reversible |
| 8–9 después de primera escritura V3 | Maintenance inmediata + kill switch; exportar V3/colas/tombstones; conservar V2 congelado; decidir reconciliación por entidad antes de habilitar cualquier escritor. | No es rollback simple |

Para unfreeze autorizado:

```powershell
$previousPgOptions=$env:PGOPTIONS
$env:PGOPTIONS='-c nico_fit.rollback_v2_write_freeze=approved -c nico_fit.expected_project_ref=xaklsoqyzwowtjwcpwmb'
psql -X -v ON_ERROR_STOP=1 -f .\supabase\rollback-unfreeze-v2-writes.sql
$env:PGOPTIONS=$previousPgOptions
```

**PASS de cierre:** checklist post-cutover firmado, V2 congelado, rollout estable, evidencia cifrada y monitoreo asignado. **ABORT/rollback:** cualquiera de las condiciones anteriores. **Aprobación humana:** propietario y DB para cerrar o iniciar rollback; después del punto de no retorno también responsable de datos. **Evidencia:** decisión final, hora, etapa alcanzada, configs, grants, deployment y export de deltas si aplica.

### Punto exacto de no retorno simple

El punto de no retorno es **el primer commit remoto exitoso de una fila personal V3** (`workout_sessions`, señales, rutinas personales o sus hijos) después del freeze V2. Crear el esquema, desplegar el cliente y habilitar storage local siguen siendo reversibles. Una escritura sólo local/pending tampoco cruza el punto: puede preservarse y revisarse. Al recibir confirmación remota, V2 ya no contiene ese hecho; desde entonces volver a V2 como escritor requiere exportar y reconciliar V3, incluidas versiones y tombstones. Registrar el timestamp, entidad, ID y versión remota de esa primera confirmación.

### Riesgos residuales aceptables sólo con firma

- Suspensión prolongada, dos dispositivos, dos pestañas móviles y flapping prolongado no tienen prueba física completa; existe cobertura automatizada y controles de lease/backoff, pero requieren aceptación explícita o prueba antes de la ventana.
- El plan FREE carece de PITR y backup administrado: la recuperación depende del dump fresco, restore verificado y Strategy B de Auth ya validada.
- Una PWA V16 abierta no entiende rollout ni safe-update. Sólo el freeze de grants impide su escritura; por eso el paso 5 es obligatorio.
- El artefacto productivo de grants/PostgREST fue validado en DR, pero producción seguirá NOT TESTED hasta la ventana; cualquier diferencia de configuración del rol `authenticator` exige ABORT, no un ajuste improvisado.
- Tras la primera escritura remota V3, un rollback rápido puede pausar el sistema, pero no volver a V2 sin reconciliación.
- V2 queda histórico y los datos no migrados se excluyen conscientemente de V3; no deben eliminarse durante el rollout.

## POST-CUTOVER

- [ ] Baseline V3 sin sesiones históricas y primeras escrituras V3 nuevas verificadas; ninguna fila V2 importada accidentalmente.
- [ ] Cero resurrecciones V3 y tombstones conservados.
- [ ] Cola sin `syncing` abandonados; conflicts/failed explicados.
- [ ] Sesión creada, editada, finalizada y recuperada offline.
- [ ] Readiness, fútbol, match review, rutina y Coach correctos.
- [ ] Dos usuarios aislados y anon rechazado.
- [ ] Observabilidad sin secretos; auditoría remota confirmada.
- [ ] PWA actualizada en cada dispositivo; ninguna pestaña obsoleta escribe.
- [ ] Backup y evidencia almacenados; hora del punto de no retorno registrada.

## Matriz Go/No-Go

### Estado final por bloque

| Bloque | Estado | Evidencia o condición pendiente |
|---|---|---|
| Código y build | PASS | Suites, sintaxis, app shell, cache versionada, manifest/iconos y ausencia de secretos versionados verificados. Build física final: v45. |
| Supabase staging | PASS | Esquema V3, Auth, RLS, training/free workout, routines, signals, sync, conflictos, observabilidad, rollout, auditoría e idempotencia validados sin tocar producción. |
| Rollout control | PASS | Versión mínima, maintenance, kill switch, fallback conservador y reanudación observados físicamente. |
| PWA | PASS | Standalone, reaperturas offline, módulos/CSS cacheados y safe-update coordinado durante sesión. |
| Uso real móvil crítico | PASS | Auth, IndexedDB, cola, offline/online, sync, updates, catálogo idempotente y descarte de drafts confirmados en iPhone. |
| Uso móvil extendido | NOT TESTED | Suspensión prolongada, dos pestañas móviles, dos dispositivos y flapping prolongado. |
| Auditoría | PASS | Retención y purga administrativa explícita verificadas en staging; sin purga automática. |
| Backup lógico V2 | PASS | Procedimiento y restauración lógica de esquema/datos documentados y verificados. |
| Disaster recovery con Auth | PASS | Strategy B ejecutada dos veces en Supabase descartable con Auth real, JWT, remapeo atómico, RLS, aislamiento, FKs y auditoría. |
| Freeze/version mínima de V2 real | CONDITIONAL | Diseño y scripts preparados; deben ejecutarse y verificarse en la ventana autorizada. |
| Producción V3 | NOT TESTED | Por restricción no se aplicó SQL, no se activaron flags y no se ejecutó cutover. |

Los bloques técnicos críticos están en PASS. El rollout queda en CONDITIONAL GO porque los controles operativos de la ventana productiva todavía no fueron ejecutados y la cobertura móvil extendida continúa sin prueba física.

| Riesgo | Probabilidad | Impacto | Estado | Decisión |
|---|---|---|---|---|
| Disaster recovery/Auth Strategy B | Baja | Crítico | Dos ejecuciones end-to-end PASS en proyecto descartable; secretos fuera de Git | GO |
| Datos V2 sólo locales no inventariados | Media | Alto para recuperación histórica | Exclusión de V3 aceptada; export voluntario | No bloquea V3 |
| Safe PWA update | Baja | Alto | PASS físico hasta v45; Auth/IndexedDB/cola preservados | GO |
| Versión mínima/maintenance/kill switch | Baja | Alto | PASS físico con cambios remotos sin redeploy | GO |
| Cuatro órdenes de ejercicio V2 | Baja | Medio si se migra luego | Mappings aprobados y archivados | No requeridos para V3 desde cero |
| Idempotencia/conflicto de catálogo V3 | Baja | Alto | Fix validado; sync físico posterior con cola 0 | GO |
| Drafts abandonados | Baja | Medio | No se auto-reactivan; descarte explícito/tombstones PASS | GO |
| Suspensión prolongada/dos pestañas/dos dispositivos | Media | Alto | NOT TESTED físicamente | CONDITIONAL |
| Retención de auditoría | Baja | Medio | Política y tooling administrativo validados en staging | GO |
| Esquema V2 inesperado | Baja | Medio | No detectado | GO |
| Datos V2 productivos no migrados | Cierta | Historial ausente en V3 | Descarte para V3 aprobado; V2 retenido | No bloquea V3 |

Recomendación actual: **CONDITIONAL GO para producción**. Código/build, staging, rollout, PWA, flujo móvil crítico, auditoría, backup lógico, disaster recovery/Auth y el artefacto productivo de grants/PostgREST están en PASS fuera de producción. Durante la ventana siguen siendo obligatorios el backup fresco con checksum, el freeze/version mínima real del cliente V2, la verificación del baseline V3 vacío, responsables presentes y autorización manual. Suspensión prolongada, dos pestañas, dos dispositivos y flapping prolongado permanecen NOT TESTED; deben ejecutarse o aceptarse explícitamente como riesgo. Producción V3 continúa NOT TESTED por diseño hasta la ventana autorizada. El inventario local, el preflight histórico V2 y los mappings productivos no bloquean este arranque limpio.

### Bloqueantes restantes

No quedan bloqueantes técnicos documentales conocidos. Los pendientes operativos obligatorios son:

1. Generar y verificar el backup fresco con checksum inmediatamente antes del freeze.
2. Aplicar y comprobar el freeze/version mínima contra un cliente V2 antiguo antes de habilitar escrituras V3.
3. Confirmar baseline V3 vacío o revisar explícitamente cualquier fila de prueba.
4. Designar responsables de DB, release y validación, definir la ventana y obtener confirmación manual.

Pruebas todavía recomendadas: suspensión física prolongada, dos pestañas, dos dispositivos y flapping/backoff prolongado. Pueden aceptarse como riesgo residual porque Web Locks/lease, recuperación, backoff y aislamiento ya tienen cobertura automatizada y el flujo crítico físico pasó; esa aceptación debe quedar registrada antes de la autorización final.
