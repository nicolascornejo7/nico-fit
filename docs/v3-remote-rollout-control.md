# V3 remote rollout control (build nico-fit-v18)

## Alcance y arquitectura

`nico_fit_v3.rollout_config` es una sola fila pública, sin credenciales ni datos personales. `config_version` aumenta exactamente en uno por cambio; el trigger conserva cada versión en `rollout_config_history`, que sólo puede leer el operador SQL. `anon` y `authenticated` pueden leer la fila activa y no pueden modificarla. El SQL es aditivo y está separado del cutover: `supabase/migration-v3-rollout-control.sql`.

`rollout-control` obtiene primero `/api/config` (URL y publishable key existentes) y después la fila por PostgREST con `Accept-Profile: nico_fit_v3`. La respuesta se valida campo por campo. `rollout-policy` calcula flags efectivos y el bloqueo de versión; `rollout-state` es la única interfaz que consultan almacenamiento, entrenamiento, señales, rutinas, conflictos, sync y observabilidad. Los componentes no consultan Supabase ni IndexedDB para decidir los flags. El cache público local dura 60 segundos, guarda el instante de lectura y se propaga a otras pestañas con BroadcastChannel y `storage`. Hay polling cada 60 segundos; una operación de sync vuelve a comprobar la política antes de reclamar y antes de enviar cada grupo.

Todos los flags parten apagados. `v3_enabled` es requisito común, pero cada flag de entidad debe activarse explícitamente. El sync específico de señales y rutinas también requiere sus flags locales `v3.signals.sync.enabled` y `v3.routines.sync.enabled`; encender señales o rutinas no lo inicia. La auditoría mantiene su activación local explícita. Ningún flag crea por sí solo una sesión o un cliente remoto.

Si falla la lectura, un cache vigente puede utilizarse hasta agotar su TTL; después, los flags V3 se apagan y la cola local queda intacta. Si una versión mínima ya conocida supera el build local, el bloqueo se conserva incluso con cache vencida. Si nunca se leyó una versión mínima, el cliente V18 no puede imponerla offline: por eso el salto inicial con V16 requiere enforcement de servidor. La latencia máxima prevista para un kill switch en una pestaña online abierta es aproximadamente 60 segundos, más el tiempo de una solicitud remota ya iniciada.

`minimum_client_version` compara IDs `nico-fit-vN`. Una versión inferior bloquea nuevas escrituras locales y remotas, sync e inicio de sesiones en el cliente nuevo. Los datos, borradores, sesión activa y operaciones pendientes permanecen. La UI muestra “Actualización requerida” y ofrece buscar/aplicar la actualización con el protocolo seguro de PWA. `maintenance_mode` pausa operaciones remotas de V18, tanto V2 como V3, pero permite conservar trabajo local. `v3_sync_enabled=false` pausa el motor V3 sin borrar la cola; volverlo a `true` permite reanudarla.

Observabilidad añade `rollout`: versión, última lectura válida, edad, origen `remote/cache/fallback`, flags efectivos, motivo de bloqueo, versión mínima y maintenance. La vista técnica no muestra claves ni payloads. La franja de actualización/mantenimiento está disponible aun cuando observabilidad V3 está apagada.

## Operación reproducible en staging

1. Verificar visualmente que el proyecto destino sea `nico-fit-v3-staging` (`tmydirzzlmlmtjgwqcgh`). Aplicar **sólo allí** `supabase/migration-v3-rollout-control.sql` con rol operador. No usar el proyecto `gym-futbol` productivo.
2. Ejecutar `npm run test:v3:rollout:staging -- baseline`. El script exige ref y URL exactos y sólo acepta una publishable key. Comprueba lectura anon/Auth de dos usuarios y rechazo de escrituras y de lectura del historial.
3. Cambiar en SQL Editor un campo por vez con `config_version=config_version+1`. Para ensayar sync: `update nico_fit_v3.rollout_config set config_version=config_version+1,v3_enabled=true,v3_storage_enabled=true,v3_sync_enabled=true where singleton_id=true;`. Ejecutar `npm run test:v3:rollout:staging -- enabled`.
4. Ensayar `maintenance_mode=true` con nueva versión y modo `maintenance`; después volver a `false` y subir `minimum_client_version='nico-fit-v19'` para modo `minimum`.
5. Volver el mínimo a `nico-fit-v18`, poner `v3_sync_enabled=false` con nueva versión y ejecutar modo `kill`; volverlo a `true` y repetir `enabled`. Así se verifica reversibilidad sin redeploy.
6. Restaurar **todos** los flags a `false`, `maintenance_mode=false`, mínimo `nico-fit-v18`, siempre con versión nueva. Ejecutar `npm run test:v3:rollout:staging -- restored`. Confirmar una fila activa y una fila de historia por versión.

El script de integración nunca modifica la configuración: sólo prueba que los clientes no pueden escribirla. El operador cambia flags desde SQL Editor; la fila y su historial quedan auditables. No usar claves secret/service role en navegador o en Git.

La UI puede inspeccionarse sin iniciar sesión ni escribir datos con `npm run serve:v3:rollout:manual` y `http://127.0.0.1:41744`. El fixture lee únicamente staging y permite forzar una nueva lectura con su botón. Cerrar el servidor al terminar.

## Primer salto desde V16

V16 no lee la política remota ni participa en la coordinación del nuevo service worker. Una pestaña V16 abierta puede continuar intentando escribir V2. Antes del futuro cutover debe instalarse un **freeze de escrituras V2 del lado servidor**, reversible y verificado con Auth real: bloquear INSERT/UPDATE/DELETE en todas las tablas V2 afectadas, incluida la ruta de tombstones, mientras se conserva SELECT y la posibilidad de export. Registrar hora, responsable, SQL inverso y validación de cada tabla. El freeze no se ejecuta en esta rama.

Después se distribuye V18 con el nuevo protocolo PWA, se establece una versión mínima que excluya V16 y se pide cerrar/actualizar pestañas antiguas. El rollout sólo puede avanzar cuando la lectura de V2 y la denegación de escritura de V16 estén verificadas en servidor, los dispositivos previstos usen el build compatible y no haya escrituras V2 aceptadas durante la ventana de observación acordada. No se debe usar la ausencia de pestañas visibles como prueba: el enforcement de servidor sigue siendo obligatorio durante la transición. V2 permanece histórico; V3 arranca vacío, sin backfill productivo personal por defecto.

## Validación y riesgos

El 21/09/2026, staging se reanudó y la migración se aplicó con éxito. La configuración pasó por versiones 1–7: baseline apagado, enabled, maintenance, mínimo V19, kill switch, reanudación y restauración apagada. En cada estado el script leyó el valor real vía PostgREST: anon y dos usuarios Auth pudieron leer; los tres recibieron `42501` en INSERT/UPDATE/DELETE y al consultar el historial. Una actualización sin incrementar versión recibió `PT409`. Se confirmó una fila activa y siete filas de historial tras esa secuencia. Se realizaron además cambios temporales para inspeccionar en Edge los banners de versión mínima y mantenimiento, y se restauró la configuración. Staging terminó en versión 11, mínimo V18, maintenance apagado y todos los flags V3 apagados. No hubo deploy ni acceso productivo.

PGlite valida idempotencia del SQL, singleton, RLS/grants y versionado. La suite automatizada cubre cache fresco/vencido, ausencia e invalidez, timeout, dos pestañas, mínimo, mantenimiento, cola pendiente, kill/reanudación. Falta la prueba física en PWA/Android/iOS y observar una pestaña V16 real bajo freeze. Si se eleva el mínimo mientras existe una sesión activa, el cliente viejo conserva su estado local pero no puede finalizarlo con ese build; el protocolo PWA puede rechazar la activación mientras la pestaña siga abierta. El operador debe planificar ese cambio fuera de sesiones activas o instruir a cerrar la PWA y reabrirla con el worker nuevo, verificando la restauración de la sesión. Las configuraciones ya entregadas a clientes se pueden usar hasta que expire el TTL; una operación HTTP que ya salió no puede retirarse. Ningún control de cliente reemplaza el freeze de V16. Estado: **GO para pruebas físicas; NO-GO para cutover**.
