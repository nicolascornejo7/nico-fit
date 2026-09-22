# Checklist de validación V3 en celular real / PWA standalone

Esta guía valida únicamente la experiencia V3 standalone. No incluye V1/V2, migración histórica ni reconciliación de datos anteriores. No se ejecuta staging desde este checklist: las pruebas que cambian configuración remota requieren una ventana de staging autorizada y deben volver a dejar los flags apagados.

## Prerrequisitos

- Celular físico con Android/Chrome o iPhone/Safari actualizado.
- Usuario de prueba de Supabase staging y contraseña disponible fuera del repositorio.
- URL de la build V3 candidata y conexión inicial a internet.
- Cuenta de prueba sin datos personales históricos; V3 debe comenzar vacío.
- Acceso al panel remoto de rollout únicamente para el responsable autorizado.
- Hoja de evidencias o carpeta local fuera de Git. No guardar tokens, cookies, contraseñas ni claves.
- Registrar modelo, sistema operativo, navegador, modo standalone, build visible, fecha/hora y zona horaria.

Formato recomendado para cada evidencia: `D##-nombre-YYYYMMDD-HHmm` con captura, resultado y comentario breve. En PASS/FAIL registrar siempre la hora y el build.

## Matriz de pruebas manuales

Marcar cada fila como `PASS`, `FAIL` o `BLOCKED`. Un fallo que pierda datos, resucite una operación o deje la sesión inutilizable es bloqueante.

| ID | Caso y pasos | Resultado esperado | Evidencia | Resultado |
|---|---|---|---|---|
| D01 | Abrir la URL en el navegador; elegir “Instalar”/“Añadir a pantalla de inicio”; abrir desde el icono, sin barra de navegador. | La app arranca standalone, conserva orientación y no muestra rutas internas ni errores de carga. | Captura de pantalla instalada + modelo/OS + URL/build. | ☐ |
| D02 | En standalone, iniciar sesión con el usuario de prueba; cerrar y reabrir la app. | Login exitoso; la sesión Auth se conserva según la política del navegador; no se muestran secretos. | Capturas antes/después + hora del login. | ☐ |
| D03 | Entrar a Entrenamiento V3; crear una sesión; agregar dos ejercicios, incluido uno repetido si la UI lo permite. | Se crea una única sesión local con UUID; la sesión activa queda visible y no aparece un segundo inicio accidental. | Captura de sesión activa + identificadores visibles no sensibles. | ☐ |
| D04 | Cargar series con carga, reps, duración, RIR `0` y RIR vacío/null; completar algunas y dejar otras incompletas. | Se distinguen reps de duración y null de cero; sólo las series completadas entran en métricas/progresión. | Captura de formulario y resumen; anotar valores usados. | ☐ |
| D05 | Con la sesión activa y cambios guardados, recargar la PWA. | Se restaura sesión, ejercicio actual, series, borradores, cronómetro, descanso y resumen pendiente exactamente. | Captura antes/después + diferencia de hora del cronómetro. | ☐ |
| D06 | Iniciar un descanso; bloquear la pantalla durante 10–15 minutos; desbloquear y volver a la app. | El descanso usa timestamps reales: muestra el restante correcto o indica que terminó; el cronómetro de sesión continúa correctamente. | Hora de bloqueo/desbloqueo + capturas + tiempos esperados/observados. | ☐ |
| D07 | Con sesión activa, forzar cierre de la PWA desde el selector de aplicaciones; abrirla nuevamente. | La sesión local y los borradores se recuperan; no se duplican ejercicios, series ni operaciones. | Capturas antes del cierre y tras reapertura; contador de operaciones si está visible. | ☐ |
| D08 | Activar modo avión; crear/editar sesión, ejercicios y series; finalizar o dejar resumen pendiente. | La app sigue usable offline; los cambios quedan locales con estado pendiente; no se muestran falsos “Sincronizado”. | Capturas del modo avión, estado de cola y resumen. | ☐ |
| D09 | Con datos offline, cerrar la PWA y reabrirla todavía sin red. | Se conserva la sesión activa/pending y no se bloquea la navegación local. | Captura tras reapertura offline. | ☐ |
| D10 | Desactivar modo avión y esperar conexión; abrir observabilidad/estado V3 o disparar sync cuando corresponda. | Las operaciones se envían con confirmación real; pasan a `synced`; no se duplican al reintentar. | Captura de estado antes/después + hora de recuperación de red. | ☐ |
| D11 | Durante una sesión, perder red y recuperarla varias veces; intentar sync manual. | Backoff y estados son claros; no hay loops visibles ni pérdida de cola; la sesión sigue usable. | Capturas de error/backoff y resultado final. | ☐ |
| D12 | Finalizar sesión con RPE/notas; provocar una caída de red antes del guardado remoto; reintentar luego online. | La sesión no se limpia antes de guardar con éxito; el resumen queda pendiente y luego se confirma. | Capturas del resumen pendiente y de confirmación posterior. | ☐ |
| D13 | Con una nueva build PWA disponible y sin sesión activa, pulsar “Actualizar ahora”. | La actualización se instala de forma coordinada, no mezcla assets y recarga en el build nuevo. | Build antes/después, captura del aviso y versión del service worker. | ☐ |
| D14 | Con una sesión activa, formulario sucio o sync crítico, intentar “Actualizar ahora”. | La aplicación bloquea la activación inmediata, explica el motivo y ofrece “Después”; los borradores quedan intactos. | Captura del aviso bloqueado + estado de sesión. | ☐ |
| D15 | Finalizar y guardar la sesión; volver al aviso de actualización y aplicar. | La actualización pendiente se aplica sólo después de que el estado sea seguro; la sesión finalizada queda intacta. | Capturas antes/después + build activo. | ☐ |
| D16 | Con configuración remota de staging `minimum_client_version` superior al build instalado, abrir/recargar la app. | Se muestra “Actualización requerida”; no se permite iniciar sesión nueva, escribir ni sincronizar; los datos locales permanecen. | Captura del banner + build local y mínimo remoto anotados. | ☐ |
| D17 | Activar `maintenance_mode` en staging; abrir la app online y offline; desactivarlo luego. | Las operaciones remotas se pausan con mensaje claro; la cola local no se borra; al desactivar se puede reanudar. | Capturas en ambos estados + versión de config. | ☐ |
| D18 | Con operaciones pendientes, cambiar `v3_sync_enabled` a `false`; intentar sync; volver a `true`. | El kill switch detiene sync sin borrar la cola; al reactivarlo las operaciones continúan sin duplicarse. | Conteo de cola antes/durante/después + capturas. | ☐ |
| D19 | Abrir dos pestañas/ventanas de la PWA si el sistema lo permite; iniciar o editar la misma sesión y pulsar sync en ambas. | Web Lock/lease evita doble procesamiento; una instancia espera o informa que otra trabaja; no hay duplicados. | Capturas de ambas instancias + estados y hora. | ☐ |
| D20 | Cambiar entre app y otra aplicación durante una edición; volver después de varios minutos. | El estado local y los borradores sobreviven suspensión; no se resetean inputs ni cronómetros. | Hora de salida/retorno + captura comparativa. | ☐ |

## Evidencia y criterios

Para cada caso guardar:

- `PASS`, `FAIL` o `BLOCKED` y una frase de resultado.
- build de la app, versión del service worker si está disponible, modelo/OS/navegador y hora local.
- capturas antes/después; para offline o red, registrar hora exacta de cada transición.
- conteos de cola/estado y UUIDs sólo si son necesarios para comparar; no exportar payloads sensibles.
- error visible completo, saneado de tokens, cookies, emails innecesarios o claves.

Resultado global: **PASS** sólo si todos los casos aplicables pasan, ningún caso bloqueante falla y los casos no ejecutables están justificados. **NO-GO** si falla recuperación tras reload/cierre, se pierde una serie o resumen, se confirma sync sin respuesta remota, se reviven tombstones, se mezclan builds o una actualización interrumpe una sesión. `BLOCKED` por limitación del dispositivo debe repetirse en otro entorno o quedar aceptado explícitamente antes del rollout.

## Riesgos que requieren un teléfono real

- Suspensión agresiva de iOS/Android, ahorro de batería y terminación del proceso pueden cambiar cuándo se ejecutan timers, service workers y eventos de red.
- El comportamiento de instalación standalone, actualización del service worker y dos ventanas varía por navegador y versión del sistema.
- Bloqueo de pantalla durante una subida HTTP no puede simularse fielmente en escritorio.
- La conectividad móvil puede producir redes cautivas, cambios de IP, timeouts y reconexiones distintas a un modo avión manual.
- No se puede demostrar con pruebas locales la política real de background execution, push/OS eviction o restauración tras falta de almacenamiento.
- Una pestaña V16 no entiende el protocolo nuevo; su control requiere freeze de escrituras V2 del lado servidor y no queda validado por este checklist.
- La prueba de flags, versión mínima, maintenance y kill switch debe ejecutarse sólo en staging y restaurar los flags apagados; este documento no autoriza cambios remotos.

## Registro final de dispositivo

Completar una fila por cada origen real:

| Dispositivo/origen | Modelo/OS | Navegador | Standalone | Build/SW | Usuario de prueba | Casos PASS | Casos FAIL/BLOCKED | Evidencia | Fecha |
|---|---|---|---|---|---|---|---|---|---|
| PC/Edge (referencia) |  |  |  |  |  |  |  |  |  |
| Celular principal |  |  |  |  |  |  |  |  |  |
| Otro perfil/origen |  |  |  |  |  |  |  |  |  |

Un dispositivo u origen no inventariado sigue siendo un riesgo operativo para el rollout, aunque V3 comience vacío. Esta rama sólo prepara la validación; no cambia flags, no escribe staging y no realiza cutover.
