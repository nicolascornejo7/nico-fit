# Inventario local previo al cutover V3

Estado de la herramienta: disponible para respaldo/diagnóstico voluntario. Por decisión del 2026-09-20, **el inventario local ya no bloquea el lanzamiento V3**: el usuario actual empieza V3 desde cero, V2 queda como histórico y los datos no migrados se descartan conscientemente **para V3**, sin borrado físico. Ningún dispositivo real fue declarado inventariado por este documento. La herramienta no ejecuta importación, sync ni escritura remota.

## Uso

1. Abrir Nico Fit en el **mismo origen y perfil de navegador** donde se usa normalmente. Entrar en **Ajustes → Inventario y respaldo de este dispositivo** (ruta `/local-device-inventory.html`). La PWA debe actualizarse a un build que incluya esta página; tener el código sólo en la rama no la pone en producción.
   Dejar el entrenamiento en pausa y evitar editar o sincronizar durante el export; IndexedDB se lee en una transacción consistente, pero localStorage y la base no comparten una transacción global.
2. Elegir cada perfil local detectado, incluido `guest` si existe. Si el navegador no enumera bases IndexedDB y falta un usuario V3 en la lista, ingresar manualmente su UUID comprobado. Exportar **un JSON por perfil**. No exportar el perfil de otra persona como si fuera el propio.
3. Guardar cada archivo en almacenamiento cifrado fuera de Git. Anotar dispositivo, navegador/perfil, origen, fecha, nombre y checksum. El JSON puede contener notas y datos de entrenamiento personales aunque se excluyan credenciales.
4. En la misma página, cargar el archivo con **Validar un inventario**. Confirmar `valid: true` y `complete: true`. Si hay corrupción, stores no reconocidos o filas de otro usuario, no cerrar el dispositivo.
5. Comparar los candidatos V2 con Supabase V2 por identidad/fecha y estado, y los V3 con confirmaciones remotas, tombstones y cola. La herramienta **no puede demostrar por sí sola** qué V2 existe únicamente localmente: marca todos los registros V2 como candidatos para comparar, sin escribir al servidor.
6. Si se desea preservar o reconciliar datos históricos, sincronizar o acordar revisión/recuperación de cada diferencia y repetir el export. Bajo el arranque limpio aprobado, una sesión V2 activa, cola V2 no confirmada o dispositivo no inventariado **no bloquean V3**. Una sesión o cola **V3** existente en el usuario que se supone nuevo sí exige revisión para comprobar el baseline vacío antes de habilitar escrituras V3.

## Formato JSON v1

`kind` es `nico-fit-local-device-inventory`; `schemaVersion` es `1`. `createdAt` usa UTC. `origin` identifica el origen web; `userId` identifica el perfil para reconciliación; `device.id` es un UUID aleatorio local y no identifica hardware. `device.browser`, `platform`, `mobile` y `standalone` son descriptores generales. `app.build`, `app.online` y `app.serviceWorker` registran build, conectividad observada, script/controlador y nombres de caché visibles. `summary` contiene conteos V2, entidades V3, estados de operaciones, conflictos, decisiones, resoluciones pendientes, checkpoints, estado del último sync y sesiones activas. `payload.localStorage` contiene únicamente claves Nico Fit V1/V2 del perfil seleccionado y flags V3 conocidos. `payload.indexedDB` contiene las entidades y stores internos V3 de la base de ese usuario, incluidos `pending_operations`, `migration_map`, `sync_metadata`, `sync_conflicts` y `sync_leases`. `warnings` señala lecturas parciales o datos dañados.

`checksum.algorithm` es `SHA-256` y `checksum.value` se calcula sobre el JSON canónico con claves ordenadas **sin** el propio objeto `checksum`. Detecta cambios accidentales; no autentica el origen ni sustituye una firma. Dos exportaciones del mismo estado con igual `createdAt` producen el mismo contenido/checksum.

El validador devuelve `valid`, `complete`, `corrupt`, `summary`, `localOnlyCandidates`, `pendingSync`, `activeSession`, `conflicts` y `shouldSyncBeforeCutover`. `valid` verifica formato, conteos y hash. `complete` exige que todas las fuentes elegidas sean legibles. `localOnlyCandidates` son **candidatos**, no una afirmación de ausencia remota. **`shouldSyncBeforeCutover` es un campo legado del formato v1 y no representa la nueva política de GO/NO-GO**: sigue siendo conservador para quien opte por reconciliar históricos, pero no obliga a migrar V2.

## Seguridad y límites

La extracción usa solamente APIs locales de navegador. Nunca llama a Supabase ni toca cookies. No exporta claves Auth de localStorage, ni campos `access_token`, `refresh_token`, contraseñas, service role, API keys, secretos o tokens de lease. Redacta patrones de credenciales en texto y correos dentro de errores. Si un secreto fue pegado como texto libre en notas, ningún filtro heurístico puede garantizar detectarlo: tratar el JSON como **dato confidencial** y revisarlo antes de compartirlo. Un `userId` se incluye porque permite reconciliar propiedad; el identificador de dispositivo es aleatorio y local.

No se implementa importación ni restauración desde este formato. Un archivo íntegro no equivale a un respaldo remoto ni confirma sincronización. Si `indexedDB.databases()` no está disponible, la herramienta intenta abrir únicamente la base del UUID elegido y aborta la creación si no existe. Por eso una base V3 perteneciente a un UUID no conocido puede quedar sin descubrir; el checklist debe cubrirlo.

## Checklist opcional de dispositivos reales

Registrar una fila por **dispositivo + navegador/perfil + origen** (la PWA instalada puede compartir o no almacenamiento con el navegador, según plataforma):

| Superficie | Inventario JSON por perfil | Validación completa | Diferencias remotas conciliadas | Export final/fecha/checksum |
|---|---|---|---|---|
| PC principal / Edge | ☐ | ☐ | ☐ | ☐ |
| Celular / navegador habitual | ☐ | ☐ | ☐ | ☐ |
| PWA standalone del celular, si usa otro almacenamiento | ☐ | ☐ | ☐ | ☐ |
| Cualquier otro navegador, perfil u origen usado con Nico Fit | ☐ | ☐ | ☐ | ☐ |

Antes de marcar una fila como conciliada: revisar sesión activa, V2 guest, cola `pending/syncing/failed/conflict`, tombstones, conflictos, resoluciones `pending_sync` y checkpoints; comparar conteos y registros candidatos con el remoto. No borrar archivos locales ni datos del navegador durante esta etapa. **Un dispositivo no inventariado continúa siendo riesgo de pérdida de datos locales.**

## Criterio de uso y riesgo aceptado

Si se busca una recuperación histórica exhaustiva, completar todas las superficies reales, validar JSON y conciliar candidatos sigue siendo la mejor evidencia. Si faltan dispositivos, esos datos pueden perderse del historial local al cambiar de navegador, limpiar almacenamiento o dejar de usar V2. **Ese riesgo está aceptado para lanzar V3 vacío y ya no es un NO-GO de cutover.** La decisión no autoriza borrar V2, ejecutar backfill ni afirmar que los datos históricos se copiaron. Permanecen otros bloqueantes de producción, incluido disaster recovery Auth y actualización segura de la PWA.

Prueba reproducible: `npm run test:v3:local-inventory`. No usa producción ni staging.
