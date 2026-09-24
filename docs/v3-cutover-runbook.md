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

## Pasos CUTOVER preparados, no autorizados

1. Anunciar ventana y detener nuevos entrenamientos.
2. Verificar build mínimo; no trasladar sesiones V2 activas a V3. Ofrecer export local voluntario.
3. Confirmar que no se importarán datos V2 y que el espacio V3 del usuario actual está vacío o fue revisado explícitamente.
4. Crear backup final y validar checksum.
5. Activar freeze V2 con el guard explícito y comprobar rechazo desde un cliente antiguo.
6. Aplicar esquema V3 por fases: base, signals, observability, routines; **no ejecutar backfill de datos personales V2**.
7. Aplicar grants mínimos y validar RLS, Auth y usuario V3 antes de abrir escrituras.
8. Verificar que importadores V2 y cualquier doble escritura V2/V3 estén desactivados; registrar baseline V3 vacío.
9. Abort si aparece un dato V3 previo inesperado o falla un control de versión, RLS o dispositivo bloqueante.
10. Habilitar flags en el orden definido para cohorte interna.
11. Validar post-cutover antes de ampliar cohorte.

Cada paso de escritura requiere confirmación manual nueva. No se encadenan todos los scripts en una única ejecución.

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

Recomendación actual: **CONDITIONAL GO para producción**. No quedan bloqueantes técnicos conocidos: código/build, staging, rollout, PWA, flujo móvil crítico, auditoría, backup lógico y disaster recovery/Auth están en PASS. Antes de ejecutar el cutover siguen siendo obligatorios el backup fresco con checksum, el freeze/version mínima real del cliente V2, la verificación del baseline V3 vacío, responsables presentes y autorización manual de la ventana. Suspensión prolongada, dos pestañas, dos dispositivos y flapping prolongado permanecen NOT TESTED; deben ejecutarse o aceptarse explícitamente como riesgo. Producción V3 continúa NOT TESTED por diseño hasta la ventana autorizada. El inventario local, el preflight histórico V2 y los mappings productivos no bloquean este arranque limpio.

### Bloqueantes restantes

No quedan bloqueantes técnicos identificados. Los pendientes obligatorios son operativos:

1. Generar y verificar el backup fresco con checksum inmediatamente antes del freeze.
2. Aplicar y comprobar el freeze/version mínima contra un cliente V2 antiguo antes de habilitar escrituras V3.
3. Confirmar baseline V3 vacío o revisar explícitamente cualquier fila de prueba.
4. Designar responsables de DB, release y validación, definir la ventana y obtener confirmación manual.

Pruebas todavía recomendadas: suspensión física prolongada, dos pestañas, dos dispositivos y flapping/backoff prolongado. Pueden aceptarse como riesgo residual porque Web Locks/lease, recuperación, backoff y aislamiento ya tienen cobertura automatizada y el flujo crítico físico pasó; esa aceptación debe quedar registrada antes de la autorización final.
