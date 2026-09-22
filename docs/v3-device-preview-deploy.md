# Preview deploy seguro para validación V3 en celular

Este procedimiento prepara un preview de la rama `feature/v3-device-validation`. No ejecuta el deploy, no modifica producción y no activa el cutover. El preview debe ser descartable y apuntar exclusivamente al proyecto `nico-fit-v3-staging`.

## 1. Crear el preview desde Vercel

1. Confirmar en Git que la rama local/remota sea exactamente `feature/v3-device-validation` y que el commit de la checklist y del guard esté publicado sólo cuando exista aprobación explícita.
2. En Vercel, abrir el proyecto Nico Fit y crear un deployment manual seleccionando esa rama. Elegir el entorno **Preview**; no seleccionar Production ni `main`.
3. Antes de ejecutar el deployment, revisar las variables del entorno Preview. No reutilizar variables heredadas de Production.
4. Mantener el deployment protegido con la autenticación/Access de Vercel disponible para el equipo. Compartir la URL sólo con quien hará la prueba física.
5. El resultado tendrá una URL temporal de Vercel, por ejemplo `https://<deployment>-<team>.vercel.app`. El host exacto se obtiene en el panel después de que el usuario confirme el deploy; no se puede fijar por adelantado.

Alternativa CLI, después de la aprobación de deploy y con Vercel CLI autenticado:

```powershell
vercel deploy --prebuilt=false --target preview
```

El comando debe ejecutarse desde la raíz del repositorio y con el proyecto Vercel correcto enlazado. No usar `vercel --prod`.

## 2. Variables del entorno Preview

Configurar únicamente estas variables en Vercel → Settings → Environment Variables → **Preview**:

| Variable | Valor requerido | Secreto |
|---|---|---|
| `NICO_FIT_PREVIEW_TARGET` | `nico-fit-v3-staging` | No |
| `SUPABASE_STAGING_PROJECT_REF` | `tmydirzzlmlmtjgwqcgh` | No |
| `SUPABASE_STAGING_URL` | `https://tmydirzzlmlmtjgwqcgh.supabase.co` | No |
| `SUPABASE_STAGING_PUBLISHABLE_KEY` | publishable/anon key de staging | Pública, pero no pegar una service-role/secret key |

No configurar en Preview `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_ANON_KEY` ni sus equivalentes de Production. El guard de `api/config` ignora esas variables en Preview y devuelve `503` si falta la selección explícita de staging, si el ref/URL no coinciden o si se presenta una clave `sb_secret_`.

Las credenciales de los usuarios Auth de staging no deben ser variables públicas del deployment. Se ingresan manualmente sólo en la pantalla de login durante la prueba, o se gestionan con el mecanismo seguro del entorno de pruebas.

El esquema remoto de rollout de staging debe estar con `minimum_client_version` compatible y todos los flags V3 apagados al crear el preview. Para probar una función concreta, el responsable de staging puede activar sólo los flags estrictamente necesarios durante una ventana controlada y devolverlos a `false` al terminar:

- almacenamiento local: `v3_enabled` + `v3_storage_enabled`;
- entrenamiento: además `v3_routines_enabled` y `v3_training_enabled`;
- sync: además `v3_sync_enabled`;
- señales/Coach/conflictos/observabilidad: activar cada flag sólo si el caso del checklist lo requiere.

No activar flags implícitamente ni usar datos históricos. V3 debe comenzar vacío para el usuario de prueba.

## 3. Verificación antes de abrirlo en el celular

Desde la URL de Preview, comprobar en una pestaña de escritorio:

1. `GET /api/config` responde `200` sólo con `url` y `publishableKey`, y la URL es exactamente `https://tmydirzzlmlmtjgwqcgh.supabase.co`.
2. Una URL de producción o una key `sb_secret_` produce `503` con el mensaje de configuración explícita de staging.
3. La pantalla de rollout/observabilidad muestra `source: remote`, el ref esperado indirectamente por la URL, `v3_enabled: false` y el resto de flags `false`.
4. El meta `nico-fit-build` y el service worker muestran el build del preview; registrar ambos junto con el host de Vercel.
5. No usar la URL de `gym-futbol` productivo, ni copiar sesiones/cookies del navegador de producción.

Desde el celular, abrir la misma URL HTTPS, instalarla como PWA y revisar la URL/origen desde la información de la aplicación o el navegador antes de iniciar sesión. La URL debe conservar el host de Preview y nunca redirigir al dominio productivo. La pantalla de rollout debe mostrar staging, flags apagados y ninguna actualización requerida inesperada.

## 4. Uso durante la prueba física

Con flags apagados se puede comprobar carga del shell, aislamiento del preview y el mensaje de V3 desactivado. Para los casos de entrenamiento, sync, minimum version, maintenance y kill switch, registrar la versión de configuración de staging antes y después. Cada cambio remoto requiere una nueva `config_version`, una ventana autorizada y restauración de todos los flags a `false` antes de cerrar.

No crear datos personales reales. Usar sólo el usuario Auth sintético de staging y fechas de prueba. Guardar capturas y estados en la carpeta de evidencias fuera del repositorio; no incluir tokens, cookies, contraseñas ni payloads en Git.

## 5. Reversión y eliminación

Para detener la prueba, primero apagar en staging cualquier flag que se haya activado y confirmar `maintenance_mode=false`, `v3_sync_enabled=false` y mínimo compatible. Luego cerrar sesión en el celular y borrar la PWA instalada si ya no se necesita. No borrar datos de Production.

Para eliminar el preview, usar Vercel → Deployments → seleccionar el deployment de esta rama → Delete, o el flujo equivalente de eliminación del proyecto Vercel. Revocar el acceso compartido si se creó un enlace protegido. Eliminar las variables Preview del proyecto Vercel después de confirmar que ningún otro preview las usa. Conservar las capturas y el informe de resultados fuera del deployment; los datos sintéticos persistidos en staging sólo se limpian mediante el procedimiento de staging aprobado.

## Guardas y criterio de seguridad

El preview no se considera seguro si `/api/config` devuelve una URL distinta a `tmydirzzlmlmtjgwqcgh.supabase.co`, si aparece cualquier key `sb_secret_`, si el host no es un deployment Preview o si se observan flags activos sin una ventana autorizada. En cualquiera de esos casos, no iniciar sesión ni registrar datos y marcar la prueba como `BLOCKED`.

Este archivo sólo documenta el procedimiento. No autoriza publicar, activar flags, ejecutar SQL, hacer push, merge, deploy productivo ni cutover.
