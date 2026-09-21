# Runbook de preparación V2 → V3

Estado al 2026-09-16: **NO-GO para ejecutar cutover**. Esta rama sólo prepara consultas, backup, write-freeze, rollback y validaciones. No agrega producto, no activa flags y no ejecuta SQL de escritura.

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

### Datos sólo locales

No pueden descartarse todavía. IndexedDB y localStorage dependen del origen, perfil y dispositivo. El deployment descubierto abrió sin sesión (`Solo local`) y no prueba el contenido de la PWA instalada o de otro teléfono. El procedimiento nuevo está en [inventario local](v3-local-device-inventory.md): cada dispositivo/perfil/origen debe exportar y validar su JSON antes del cutover. La herramienta no prueba ausencia remota; los candidatos se comparan con el inventario remoto. Cualquier registro local no confirmado bloquea el cutover hasta sincronizarlo o marcarlo para revisión. Un dispositivo no inventariado mantiene abierto el riesgo.

## Preflight de migración

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

La revisión humana quedó registrada en `config/v3-production-workout-mappings.v1.json`. El preflight exige que cada payload fuente conserve exactamente su huella; si cambia, el caso vuelve a `pending_review`. Este resultado es una proyección y no implica que el backfill haya sido ejecutado.

## Backup y restauración

La falta de backup administrado impone estos pasos:

1. Instalar versiones compatibles de `pg_dump`, `pg_restore` y `psql`.
2. Configurar `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` sin guardar secretos en archivos del repo.
3. Configurar `NICO_FIT_PROD_PROJECT_REF=xaklsoqyzwowtjwcpwmb` y `NICO_FIT_BACKUP_APPROVAL=approved-read-only-backup`.
4. Ejecutar `ops/v3-cutover/backup-production.ps1 -Execute` en almacenamiento cifrado.
5. Confirmar tamaño y SHA-256 del dump, esquema e inventario en `manifest.json`.
6. Restaurar en un stack Supabase local y descartable mediante `restore-verify-isolated.ps1`; el script rechaza tanto producción como `nico-fit-v3-staging`, que debe conservarse.
7. Ejecutar inventario, RLS, Auth, backfill dry-run y suite de integración sobre la restauración.
8. Registrar fecha, operador, checksum, destino cifrado y prueba de restauración.

El dump contiene información personal. Se almacena cifrado, con acceso limitado y sin subirlo a Git. `pg_restore --clean` sólo está autorizado contra un stack Supabase local descartable creado para la prueba. La restauración productiva nunca se improvisa con `pg_restore`; se usa el procedimiento aprobado por Supabase o una reconciliación revisada. El staging existente no se borra ni se reutiliza como destino de restore.

Para cada navegador/PWA se descarga el JSON de `/local-device-inventory.html`, que incluye SHA-256 de contenido, se valida y se guarda junto al manifiesto del dispositivo. El script previo `local-backup-browser.js` y `local-restore-browser.js` queda sólo para el procedimiento de recuperación ya documentado; este inventario no importa ni restaura datos.

## Activación gradual y reversible

Los flags actuales son locales, por lo que no permiten rollout centralizado ni versión mínima. Antes del GO debe existir una configuración remota con build ID, versión mínima, cohorte y kill switches. Ningún cliente debe confiar en flags de otro dispositivo.

Orden obligatorio:

1. **Storage V3**: habilitar IndexedDB e importación shadow; V2 continúa autoritativo. Comparar conteos.
2. **Signals**: habilitar bridge local; revisar readiness/fútbol/reviews. Sync de señales permanece apagado.
3. **Routines**: habilitar identidad y snapshots; sync de rutinas permanece apagado.
4. **Training**: habilitar para una cohorte interna después de backup local y prueba de sesión activa.
5. **Sync**: habilitar señales/rutinas y motor general sólo después del write-freeze V2 y backfill validado.
6. **Conflicts**: habilitar panel antes de ampliar la cohorte; cero resolución automática.
7. **Observability**: habilitar panel y auditoría, verificar retención y ausencia de secretos.
8. **Coach**: habilitar al final; depende de señales e historial V3 confirmados.

Cada paso requiere 24 horas o un ciclo de entrenamiento observado, cero pérdida de datos, cola estable y rollback probado. Un kill switch apaga el módulo recién habilitado sin apagar storage ni borrar datos. Training y sync nunca se encienden implícitamente.

## Clientes antiguos, caché y pestañas abiertas

- Definir `CLIENT_BUILD_ID` y `MIN_SUPPORTED_BUILD_ID` en configuración remota. Un cliente inferior entra en modo sólo lectura y muestra actualización requerida.
- La protección fuerte es `cutover-freeze-v2-writes.sql`: revoca DML V2 a `anon` y `authenticated`. Una pestaña antigua conservará su borrador local, pero el servidor rechazará la escritura.
- Publicar primero una versión puente con flags apagados, export local, manejo de `409/403`, versión mínima y pantalla de actualización. Esperar adopción antes del cutover.
- El service worker actual usa `skipWaiting()` y `clients.claim()` inmediatamente. Eso puede cambiar código durante una sesión. Antes del GO debe reemplazarse o validarse con un protocolo: detectar update, conservar sesión, pedir recarga al finalizar y bloquear sync con versiones mixtas.
- En la ventana crítica: cerrar pestañas adicionales, terminar o exportar la sesión activa, activar freeze, validar colas, recargar hasta que `CLIENT_BUILD_ID` coincida y recién entonces activar V3.
- Una pestaña vieja abierta recibe rechazo de escritura V2 y no puede iniciar sync V3. Sus datos locales se exportan y revisan; nunca se fusionan automáticamente.

## Rollback

| Momento | Acción | ¿Simple? |
|---|---|---|
| Antes de escrituras V3 | Apagar flags, retirar release puente si corresponde, mantener V2 | Sí |
| Esquema/backfill creado, V3 todavía read-only | Apagar flags, revocar grants V3, conservar o retirar esquema después de comparar; V2 intacto | Sí |
| Freeze V2 activo, todavía sin escrituras V3 | Ejecutar `rollback-unfreeze-v2-writes.sql` con aprobación y volver a V2 | Sí |
| Después de cualquier escritura V3 confirmada | Congelar V2 y V3, exportar deltas, comparar versiones/tombstones y reconciliar por entidad | **No** |

El punto de no retorno simple es la primera escritura V3 aceptada después del freeze. A partir de allí no se restaura un dump sobre producción ni se vuelve a habilitar V2 sin reconciliar UUIDs, versiones, tombstones, sesiones y señales. El backup sigue siendo evidencia y recuperación de desastre, no un mecanismo automático de overwrite.

ABORT inmediato antes de escribir V3 si falla el backup/restauración, aparecen datos sólo locales, cambia cualquier conteo durante el freeze, hay `pending_review` sin aprobar, la versión mínima no se aplica, existe una sesión activa no exportada, la cola no está vacía o una prueba de dispositivo falla.

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

- Conflictos abiertos, migraciones `pending_review` y tombstones: retener durante toda la migración y al menos 180 días después del cutover estable.
- Decisiones de conflicto resueltas: 365 días.
- Eventos operativos exitosos: 90 días.
- Errores y eventos críticos: 180 días, sin payloads completos, tokens, notas ni valores de salud.
- Backups de cutover: 90 días después de declarar V3 estable y cerrar reconciliaciones; luego eliminación manual registrada.
- No existe purga automática hasta aprobar esta política y probarla en staging.

Ante eliminación de cuenta: autenticar nuevamente al usuario, ofrecer export, congelar sync, inventariar V2/V3/auditoría, borrar en transacción administrativa desde hijos hacia padres, borrar mapas/auditoría según obligación aplicable, eliminar Auth al final, borrar IndexedDB/localStorage en cada dispositivo y registrar sólo un comprobante no identificable. La solicitud explícita prevalece sobre la retención operativa. Ninguna cuenta se elimina desde el frontend con service role.

## Checklist PRE-CUTOVER

- [ ] Commit desplegado con release puente, flags apagados y versión mínima.
- [ ] Backup lógico con checksum y restauración aislada aprobada.
- [ ] Backup local de cada dispositivo/origen activo.
- [ ] Inventario repetido; conteos congelados y firmados.
- [x] Cuatro ejercicios y doce sets revisados; proyección con cero `pending_review`.
- [ ] SQL de esquema, señales, observabilidad y rutinas reejecutado en clon restaurado.
- [ ] Backfills idempotentes ejecutados dos veces en clon.
- [ ] RLS/anon/dos usuarios validados.
- [ ] Todos los casos de dispositivo bloqueantes en PASS.
- [ ] Política de auditoría aprobada.
- [ ] Responsable de DB, release y validación presentes.
- [ ] Ventana y canal de comunicación definidos.
- [ ] Confirmación manual explícita del propietario para iniciar.

## Pasos CUTOVER preparados, no autorizados

1. Anunciar ventana y detener nuevos entrenamientos.
2. Verificar build mínimo y exportar cualquier sesión activa.
3. Ejecutar inventario final y comparar con baseline.
4. Crear backup final y validar checksum.
5. Activar freeze V2 con el guard explícito y comprobar rechazo desde un cliente antiguo.
6. Aplicar esquema V3 por fases: base, signals, observability, routines; nunca backfill mezclado con DDL.
7. Aplicar grants mínimos y validar RLS antes del backfill.
8. Ejecutar backfills separados, revisar mapas y repetir para idempotencia.
9. Abort si cambia cualquier conteo o aparece ambigüedad no aprobada.
10. Habilitar flags en el orden definido para cohorte interna.
11. Validar post-cutover antes de ampliar cohorte.

Cada paso de escritura requiere confirmación manual nueva. No se encadenan todos los scripts en una única ejecución.

## POST-CUTOVER

- [ ] Conteos fuente/mapa/destino conciliados.
- [ ] Cero resurrecciones y tombstones conservados.
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
| Datos sólo locales no inventariados | Media | Alto | Abierto | NO-GO |
| Service worker actualiza inmediatamente | Media | Alto | Abierto | NO-GO |
| Versión mínima/rollout remoto no implementado | Alta | Alto | Abierto | NO-GO |
| Cuatro órdenes de ejercicio sintéticos | Baja | Medio | Aprobados con PK y huella fuente | GO para este bloqueante |
| Colisión/conflicto V3 | Baja | Alto | UI y auditoría existen | CONDITIONAL GO tras prueba física |
| PWA/Android/iOS/suspensión no probados | Media | Alto | Abierto | NO-GO |
| Retención de auditoría no aprobada | Media | Medio | Propuesta | CONDITIONAL GO |
| Esquema V2 inesperado | Baja | Medio | No detectado | GO |
| Datos productivos inválidos | Baja | Medio | No detectado | GO |

Recomendación actual: **NO-GO para cutover**. Puede pasar a **CONDITIONAL GO** cuando backup/restauración, inventario local, release puente, versión mínima, service worker y pruebas físicas estén completos. **GO** requiere además cero ambigüedades sin decisión, preflight repetido durante el freeze y confirmación manual del propietario, operador de base y responsable de release.
