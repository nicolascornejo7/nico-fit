# Resultado de validación física V3 standalone

Fecha de cierre: 24/09/2026 (ART)

Rama: `feature/v3-final-preflight`

Build final observada: `nico-fit-v45`

Origen estable: `https://nico-fit-v3-device-validation-cornejo1.vercel.app`

Entorno remoto: `nico-fit-v3-staging`; producción no fue utilizada.

La validación se ejecutó físicamente en iPhone con PWA standalone y usuario autenticado. Los resultados siguientes sólo se marcan PASS cuando fueron observados en el dispositivo; los escenarios no ejecutados permanecen como NOT TESTED.

| ID | Caso | Estado | Evidencia física |
|---|---|---|---|
| D01 | Instalación y ejecución standalone | PASS | PWA instalada y ejecutada desde pantalla de inicio. |
| D02 | Auth persistente | PASS | La misma identidad se recuperó tras cierre, reapertura, offline y reconexión. |
| D03 | Inicio y uso de entrenamiento V3 | PASS | Entrenar V3 disponible online y mediante last-known-good offline. |
| D04 | Carga y persistencia local | PASS | Series y operaciones locales sobrevivieron cierres y reaperturas. |
| D05 | Reload/reopen con sesión activa | PASS | Estado activo restaurado durante las pruebas válidas; drafts huérfanos ya no se auto-reactivan. |
| D06 | Suspensión prolongada 10–15 minutos o más | NOT TESTED | No se registró una ejecución física cronometrada de suspensión prolongada. |
| D07 | Cierre forzado y reapertura | PASS | IndexedDB, Auth, sesión local y cola permanecieron disponibles. |
| D08 | Modo avión y escritura offline | PASS | Se creó una operación offline y quedó pending sin pérdida. |
| D09 | Dos reaperturas offline consecutivas | PASS | Shell, CSS, módulos, identidad local y Entrenar V3 cargaron correctamente. |
| D10 | Offline → online → sync real | PASS | Auth y rollout se revalidaron antes del sync; `pending` → `syncing` → `synced`; cola final `0`. |
| D11 | Idempotencia de `exercise_catalog` | PASS | Dos stores con IDs determinísticos y metadata temporal distinta convergieron sin conflictos; la validación física posterior terminó con cola `0`. |
| D12 | Maintenance mode | PASS | El aviso permaneció visible; training/storage local siguieron utilizables; sync remoto quedó bloqueado y la cola se conservó. |
| D13 | Reanudación post-maintenance | PASS | Al volver `maintenance_mode=false`, Auth/rollout se revalidaron y las operaciones pendientes pudieron continuar. |
| D14 | Kill switch `v3_sync_enabled` | PASS | Con sync apagado se preservó la cola; al reactivarlo, el flujo quedó nuevamente disponible. |
| D15 | Minimum client version | PASS | Un build inferior quedó bloqueado y el build mínimo admitido recuperó el acceso esperado. |
| D16 | Safe update durante sesión activa | PASS | La actualización waiting no forzó reload; “Después” permitió continuar y el estado inseguro bloqueó “Actualizar ahora”. |
| D17 | Aplicar update al quedar seguro | PASS | Tras finalizar o descartar correctamente la sesión, el update pudo aplicarse sin borrar datos. |
| D18 | Preservación entre builds | PASS | Auth, IndexedDB, tombstones y cola sobrevivieron los cambios de build hasta v45. |
| D19 | Sync posterior al update | PASS | La cola se procesó después de revalidar Auth/rollout y terminó en `0`. |
| D20 | Drafts huérfanos | PASS | No se auto-reactivaron; el diagnóstico distinguió checkpoint activo, huérfanos y tombstones. |
| D21 | Descarte explícito de drafts abandonados | PASS | Tres drafts reales se descartaron mediante confirmación y soft delete: `activeSessionId=null`, `draft=0`, `discarded=3`, ningún timer activo. |
| D22 | Dos pestañas móviles simultáneas | NOT TESTED | No se ejecutó contención física con dos contextos móviles. |
| D23 | Dos dispositivos simultáneos | NOT TESTED | No se ejecutó una prueba física concurrente iPhone + segundo dispositivo. |
| D24 | Flapping prolongado de red/backoff | NOT TESTED | Se probó pérdida y recuperación, pero no ciclos repetidos prolongados. |

El resultado físico del flujo crítico es **PASS**. La PWA standalone conservó Auth y datos locales, funcionó offline, revalidó controles remotos antes del sync, respetó maintenance/kill switch/minimum version y aplicó actualizaciones coordinadas sin perder IndexedDB ni cola.

Los tombstones de las tres sesiones abandonadas permanecen como operaciones válidas de soft delete. No cuentan como sesiones activas, no ejecutan cronómetros y no bloquean safe-update.

La cobertura física global queda **CONDITIONAL** por suspensión prolongada, dos pestañas, dos dispositivos y flapping prolongado. Esos casos no invalidan los PASS anteriores y no deben presentarse como ejecutados.

## Estado consolidado del preflight

| Bloque relacionado | Estado | Evidencia |
|---|---|---|
| Rollout control | PASS | Maintenance, reanudación, kill switch y minimum client version observados físicamente. |
| Auditoría y retención | PASS | RLS, append-only, preview/purga administrativa e idempotencia validados en staging. |
| Backup lógico V2 | PASS | Export, checksum, restauración aislada y comparación documentados. |
| Disaster recovery/Auth Strategy B | PASS | Dos ejecuciones end-to-end en Supabase descartable: restore/remap sintético, Auth real, JWT, RLS, aislamiento, FKs y `operational_audit`. |
| Cobertura móvil extendida | NOT TESTED | Suspensión prolongada, dos pestañas móviles, dos dispositivos y flapping prolongado. |

No quedan bloqueantes técnicos conocidos en el flujo V3 validado. Los casos móviles extendidos requieren ejecución adicional o aceptación explícita como riesgo. El backup fresco, el freeze V2 y la activación gradual son controles operativos de la ventana de cutover, no fallos de implementación.
