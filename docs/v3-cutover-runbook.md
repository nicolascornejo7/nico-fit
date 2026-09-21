# Runbook de preparación V2 → V3

Estrategia aprobada el 2026-09-20: **V3 arranca desde cero para el usuario actual**. V2 queda conservado como histórico/legado; no se borra ni se transforma en datos V3. No se ejecutará backfill productivo de datos personales sin una decisión posterior explícita. Los datos V2 y locales que no se migren quedan **conscientemente excluidos de V3**, no eliminados físicamente por este plan. El inventario local y los mappings productivos dejan de ser requisitos de lanzamiento.

Estado operativo: **NO-GO para ejecutar cutover todavía** por los bloqueantes de seguridad de actualización PWA, control de versiones, pruebas de dispositivo y recuperación que siguen abiertos. Este documento prepara el procedimiento; no autoriza SQL productivo, freeze, flags ni deploy.

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

Los flags actuales son locales, por lo que no permiten rollout centralizado ni versión mínima. Antes del GO debe existir una configuración remota con build ID, versión mínima, cohorte y kill switches. Ningún cliente debe confiar en flags de otro dispositivo.

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
- El service worker actual usa `skipWaiting()` y `clients.claim()` inmediatamente. Eso puede cambiar código durante una sesión. Antes del GO debe reemplazarse o validarse con un protocolo: detectar update, conservar sesión, pedir recarga al finalizar y bloquear sync con versiones mixtas.
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
| Navegador Edge normal | Parcial | Deployment carga; falta ciclo autenticado V3 |
| Standalone PWA | Pendiente | Inicio, reload, offline, update y sesión activa |
| Android | Pendiente/según disponibilidad | Chrome/PWA, bloqueo 30 min, reconexión |
| iPhone/iOS | Pendiente/según disponibilidad | Safari/Home Screen, suspensión y cuota |
| Suspensión prolongada | Pendiente | 2 h y una noche; timers, lease y cola correctos |
| Pérdida/recuperación de red | Pendiente | Insert/update/delete offline y confirmación real |
| Dos dispositivos | Pendiente | Entidades distintas y misma entidad/conflicto |
| Dos pestañas | Pendiente | Web Locks, lease y recuperación de cierre |
| Update de SW durante sesión | Pendiente bloqueante | Snapshot y drafts intactos; versión coherente |
| Sesión activa durante cambio de versión | Pendiente bloqueante | Continúa con snapshot N; N+1 no la modifica |

Cada ejecución registra dispositivo/OS/navegador/build, flags, usuario de prueba, timestamps, capturas no sensibles, colas antes/después y resultado. Android/iOS no disponibles se marcan como excepción explícita; no se convierten automáticamente en PASS.

## Auditoría y eliminación de cuenta

- Conflictos V3 abiertos y tombstones: retener durante el rollout y al menos 180 días después del cutover estable. Los mapas históricos V2→V3 quedan archivados; si algún día se autoriza migrar, definir entonces su retención específica.
- Decisiones de conflicto resueltas: 365 días.
- Eventos operativos exitosos: 90 días.
- Errores y eventos críticos: 180 días, sin payloads completos, tokens, notas ni valores de salud.
- Backups de cutover: 90 días después de declarar V3 estable y cerrar reconciliaciones; luego eliminación manual registrada.
- No existe purga automática hasta aprobar esta política y probarla en staging.

Ante eliminación de cuenta: autenticar nuevamente al usuario, ofrecer export, congelar sync, inventariar V2/V3/auditoría, borrar en transacción administrativa desde hijos hacia padres, borrar mapas/auditoría según obligación aplicable, eliminar Auth al final, borrar IndexedDB/localStorage en cada dispositivo y registrar sólo un comprobante no identificable. La solicitud explícita prevalece sobre la retención operativa. Ninguna cuenta se elimina desde el frontend con service role.

## Checklist PRE-CUTOVER

- [ ] Commit desplegado con release puente, flags apagados y versión mínima.
- [ ] Backup lógico con checksum y restauración aislada aprobada.
- [ ] Confirmar explícitamente que V3 del usuario actual empieza sin datos personales previos; cualquier dato V3 de pruebas se revisa antes de activar, sin borrado automático.
- [x] Decisión registrada: V2 queda histórico; datos no migrados, incluidos los sólo locales, se descartan **para V3** sin borrar la fuente.
- [x] Cuatro mappings y doce sets documentados para una eventual migración posterior; no son condición de lanzamiento.
- [ ] SQL de esquema, señales, observabilidad y rutinas reejecutado en clon restaurado.
- [ ] RLS/anon/dos usuarios validados.
- [ ] Todos los casos de dispositivo bloqueantes en PASS.
- [ ] Política de auditoría aprobada.
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

| Riesgo | Probabilidad | Impacto | Estado | Decisión |
|---|---|---|---|---|
| Sin backup administrado/restaurado | Alta | Crítico | Abierto | NO-GO |
| Datos V2 sólo locales no inventariados | Media | Alto para recuperación histórica | Exclusión de V3 aceptada; export voluntario | No bloquea V3 |
| Service worker actualiza inmediatamente | Media | Alto | Abierto | NO-GO |
| Versión mínima/rollout remoto no implementado | Alta | Alto | Abierto | NO-GO |
| Cuatro órdenes de ejercicio V2 | Baja | Medio si se migra luego | Mappings aprobados y archivados | No requeridos para V3 desde cero |
| Colisión/conflicto V3 | Baja | Alto | UI y auditoría existen | CONDITIONAL GO tras prueba física |
| PWA/Android/iOS/suspensión no probados | Media | Alto | Abierto | NO-GO |
| Retención de auditoría no aprobada | Media | Medio | Propuesta | CONDITIONAL GO |
| Esquema V2 inesperado | Baja | Medio | No detectado | GO |
| Datos V2 productivos no migrados | Cierta | Historial ausente en V3 | Descarte para V3 aprobado; V2 retenido | No bloquea V3 |

Recomendación actual: **NO-GO para cutover**. Puede pasar a **CONDITIONAL GO** cuando recuperación/backup exigidos, release puente, versión mínima, actualización segura del service worker y pruebas físicas estén completos. **GO** exige verificar V3 vacío para el usuario actual, ninguna importación ni doble escritura accidental, RLS y sync correctos, rollback probado y confirmación manual del propietario, operador de base y responsable de release. El inventario local, el preflight de V2 y los mappings productivos **no son condiciones de GO** para este arranque limpio.
