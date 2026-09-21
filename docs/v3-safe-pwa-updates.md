# Actualizaciones seguras de la PWA

## Alcance

`feature/v3-safe-pwa-updates` no activa V3 ni cambia producción. V2 sigue siendo el camino normal y V3 arranca vacío cuando se autorice un cutover posterior. El identificador de esta compilación es `nico-fit-v17`: debe cambiarse en `sw.js` y en ambos metadatos HTML en cada publicación. El test de versión impide una discrepancia accidental.

## Protocolo

El worker instala una caché completa con un nombre por build. Si falta un asset, la instalación falla y el worker anterior sigue vigente. No llama a `skipWaiting()` durante `install`, ni hace `clients.claim()` durante `activate`. La UI detecta `registration.waiting`, ofrece **Actualizar ahora** y **Después**, y conserva un acceso a la actualización aplazada.

Al elegir actualizar, el worker en espera consulta a **todas** las ventanas del mismo scope mediante `MessageChannel`. Cada cliente detiene temporalmente el inicio de trabajo nuevo y comprueba su estado local. Un cliente sin respuesta o con una versión incompatible bloquea la activación. Sólo si todas las respuestas son seguras se invoca `skipWaiting()`. Las pestañas que siguen con JavaScript viejo quedan marcadas como antiguas y deben recargarse; sus recursos estáticos se leen de la caché de su propio build hasta entonces. El iniciador se recarga una vez activado el worker.

La comprobación bloquea una sesión V2 activa, un resumen/finalización pendiente, una sesión V3 `draft`, un checkpoint V3 activo, un formulario V2 sin guardar, una operación `syncing`, un lease V3 vigente o una operación local crítica en curso. También bloquea si no puede leer un estado local existente. Se reevalúa periódicamente, al volver a la pestaña y al cambiar localStorage. Una sesión iniciada conserva sus timestamps y datos en el almacenamiento ya existente; la actualización puede solicitarse cuando termina y su guardado queda en estado seguro. No se inicia trabajo nuevo desde una pestaña antigua.

Las rutas estáticas se sirven desde la caché versionada. Ante una caché incompleta se muestra un error explícito, sin mezclar archivos de red de otra compilación. La limpieza sólo elimina cachés `nico-fit-vN` **anteriores** al worker actual y sólo cuando no quedan clientes con ese build. En particular, el worker activo nunca elimina la caché de un worker nuevo todavía en espera; otros nombres de caché quedan intactos. `/api/` y solicitudes no estáticas siguen por la red normal.

Observabilidad V3 e inventario local incluyen `appBuildId`, `activeBuildId`, `waitingBuildId`, estado de control y mismatch. No incluyen credenciales.

## Reproducción local

1. Ejecutar `npm run serve:local-inventory:manual` y abrir `http://127.0.0.1:41747/` en Edge.
2. Abrir dos pestañas del mismo origen. Incrementar el build de `sw.js` y los dos HTML, recargar una pestaña y esperar el aviso.
3. Cambiar un campo sin guardar en la segunda pestaña. **Actualizar ahora** debe rechazar la activación. Guardar el formulario y reintentar.
4. Tras activar, sólo el iniciador se recarga. La otra pestaña muestra que usa una versión vieja y ofrece recarga segura.
5. Repetir con una sesión activa y con la red desconectada. Comprobar que el shell de la versión instalada sigue abriendo offline.

Para aislar el origen de pruebas puede iniciarse el servidor con `NICO_FIT_LOCAL_PORT=41748`. No usar el origen productivo para simular builds.

## Límites y comprobaciones pendientes

### Validación de esta rama

- `npm test`: 236/236; incluye 12 pruebas específicas de actualización. `node --check` de JavaScript y `git diff --check`: correctos.
- Edge desktop, origen local aislado: aviso de nueva versión, **Después**, bloqueo por borrador en otra pestaña, guardado y activación explícita, pestaña vieja marcada como tal y recarga individual: correctos. La primera simulación detectó que la limpieza del worker activo borraba la caché en espera; se corrigió y se repitió de principio a fin con resultado correcto.
- Ancho móvil 390 × 844: panel accesible en el DOM, sin impedir la navegación principal. Con el servidor local detenido, Edge recargó el shell desde caché.
- Standalone PWA y dispositivos físicos: pendientes. La prueba local no demuestra comportamiento bajo suspensión prolongada del sistema operativo.

Un worker en espera puede activarse por decisión del navegador después de que se cierren **todas** las ventanas. No puede interrumpir una sesión visible en ese momento; la sesión persistida debe restaurarse al reabrir. Una pestaña de una compilación anterior a este protocolo no puede responder al handshake: la activación explícita se rechaza hasta cerrarla. El primer salto desde V16 no puede coordinar las pestañas V16 ya abiertas ni controlar cómo ese worker entrega recursos; la garantía completa se obtiene entre builds que ya contienen este protocolo.

**Riesgo de transición V16 → V17:** V16 no participa del protocolo nuevo. Una pestaña V16 ya abierta no puede ser coordinada por V17 y debe tratarse como cliente obsoleto. Durante el rollout inicial se requiere un control remoto de versión mínima; en la ventana crítica, el freeze de escrituras V2 del servidor debe rechazar cualquier escritura de un cliente antiguo. El operador debe pedir que se cierre o recargue cada pestaña V16 antes de habilitar escrituras V3. El control de versión mínima y su verificación se implementarán en `v3-remote-rollout-control`; esta rama no activa el freeze.

Se requiere prueba adicional en PWA standalone, Android/iOS real y suspensión prolongada antes de habilitar el cutover. Esta rama no reemplaza el control remoto de rollout ni la versión mínima de cliente, que corresponden a `v3-remote-rollout-control`.
