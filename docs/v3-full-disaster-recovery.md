# Recuperación total de Supabase: V2 y Auth

## Revalidación final para V3 — 2026-09-24

La revisión final no tocó producción ni `nico-fit-v3-staging`. El entorno disponible continúa sin Supabase CLI, `pg_dump`, `pg_restore`, `psql`, Docker/Podman ni un tercer proyecto descartable. Tampoco hay variables `SUPABASE_DR_*` cargadas. Por ello no es seguro ni técnicamente posible ejecutar hoy una restauración real de Auth.

### Inventario de recuperación

- `ops/v3-dr/export-full-readonly.ps1` prepara el export de sólo lectura, el bundle separado (`roles.sql`, `schema.sql`, `data.sql`), el dump forense, hashes y conteos.
- `ops/v3-dr/restore-full-isolated.ps1` rechaza producción y staging, valida hashes y compara esquema, conteos, RLS y relaciones.
- `scripts/v3-dr-auth-verify.mjs` cubre login con hash/UUID preservado y el flujo alternativo `createUser → recovery link → contraseña nueva → login → lectura con RLS`.
- `supabase/v3-dr-remap-v2-ownership.sql` demuestra en una transacción el remapeo de las seis entidades V2. V3 arranca vacío en el rollout aprobado, por lo que no hay datos V3 iniciales que remapear. Para una recuperación futura con datos V3, el procedimiento soportado es transformar `user_id` al importar en un esquema limpio, respetando el orden padre/hijo, en vez de editar a ciegas una restauración con FKs compuestas.
- `supabase/migration-v3-schema.sql`, `migration-v3-signals.sql`, `migration-v3-routines.sql` y `migration-v3-observability.sql` contienen las dependencias de identidad: catálogo personal, sesiones, trazabilidad, readiness, fútbol, reviews, templates y auditoría. `session_exercises`, `exercise_sets`, versiones/ejercicios de rutina y reviews heredan o validan propiedad mediante sus padres.
- `operational_audit.user_id` usa `ON DELETE RESTRICT`; antes de eliminar una cuenta se exige export y purga administrativa explícita mediante `migration-v3-audit-retention.sql`.

### Resultado por estrategia

**Strategy A — NOT FEASIBLE con los recursos actuales.** Supabase soporta migrar `auth` con usuarios y hashes mediante backup completo o dump/restore, pero esta prueba requiere la conexión PostgreSQL legítima del origen y un destino aislado. No se resetea la contraseña productiva ni se reutiliza staging para forzar la prueba.

**Strategy B — base de datos PASS; Auth operativo NOT TESTED.** La restauración lógica y el remapeo atómico V2 están demostrados en PGlite, incluidas guardas contra refs protegidos. El contrato del runner cubre creación administrativa, recovery, login y verificación de propiedad, pero esos pasos no pueden considerarse ejecutados sin un GoTrue descartable real. Tampoco se declara PASS para RLS vía JWT ni para export/purga real de auditoría hasta correr el mismo flujo en ese destino.

La clasificación del bloque es **CONDITIONAL** y sigue bloqueando el cutover. Pasa a PASS únicamente con un proyecto Supabase descartable o stack local completo donde `scripts/v3-dr-auth-verify.mjs --recovery-link` complete creación, recuperación, login, propiedad/RLS, aislamiento y la prueba administrativa de auditoría. La ausencia de ese destino es el único recurso externo pendiente; no requiere cambios de producto.

Fecha de validación: 2026-09-16. Rama: `feature/v3-full-disaster-recovery`.

## Decisión actual

El procedimiento quedó diseñado, protegido y probado localmente, pero el bloqueante de disaster recovery continúa **NO-GO**. No se produjo un dump completo de producción ni se restauró Auth en un tercer proyecto Supabase descartable. Producción y `nico-fit-v3-staging` no recibieron escrituras.

Los impedimentos comprobados son operativos:

- el dashboard no permite volver a ver la contraseña PostgreSQL actual; resetearla modificaría producción y rompería la condición de sólo lectura;
- este equipo no tiene `supabase`, `pg_dump`, `pg_restore`, `psql`, Docker ni Podman instalados;
- WSL está presente pero su acceso fue denegado;
- la organización Free ya usa sus dos proyectos activos: producción y el staging que debe conservarse.

El backup lógico V2 de la rama anterior sigue siendo válido para esquema, datos de aplicación, RLS y propiedad simulada. No contiene las tablas internas completas de Auth, hashes, sesiones ni configuración de GoTrue.

## Alcance por categoría

| Categoría | Estrategia A: dump completo | Estrategia B: datos + Auth nueva |
|---|---|---|
| Datos `public` | Se conservan | Se conservan y se remapea `user_id` |
| RLS, policies, índices, constraints, funciones y triggers | Se conservan en `schema.sql` | Se recrean desde SQL versionado |
| Identidades Auth | Se restauran las tablas de `auth` | Se crea una identidad nueva por usuario |
| Hash de contraseña | Se conserva; Supabase documenta que migra con `auth` | No se copia; se fuerza recuperación de contraseña |
| UUID de usuario | Se conserva | Cambia; todas las FK de propiedad deben remapearse atómicamente |
| Sesiones/tokens existentes | Se invalidan si cambia la clave JWT | Se invalidan siempre |
| Configuración Auth | Se recrea manualmente | Se recrea manualmente |
| Publishable/secret keys, JWT y contraseña DB | Se regeneran/rotan | Se regeneran/rotan |
| Storage | El dump guarda metadatos, no los objetos binarios | Igual; los objetos se exportan/importan por Storage API o S3 |

Supabase recomienda `supabase db dump` para proyectos Free. Su flujo oficial genera `roles.sql`, `schema.sql` y `data.sql`. La documentación también confirma que las tablas Auth y los hashes pueden migrarse, pero la configuración del servicio y las claves del proyecto no forman parte de esa restauración.

## Estrategia A: dump y restore completos

Es la estrategia preferida porque conserva el UUID y el hash de contraseña. Requiere una contraseña PostgreSQL existente y un destino descartable independiente.

### Export read-only

1. Instalar versiones compatibles de PostgreSQL, Supabase CLI y Docker. Producción usa PostgreSQL 17.6; el restore debe probar compatibilidad explícitamente.
2. Guardar la conexión en una variable de proceso. No escribirla en el repo, shell history, logs o tickets.
3. Definir:

   ```powershell
   $env:NICO_FIT_PROD_PROJECT_REF='xaklsoqyzwowtjwcpwmb'
   $env:NICO_FIT_PROD_DB_URL='postgresql://...'
   $env:NICO_FIT_DR_READ_ONLY_APPROVAL='approved-read-only-full-export'
   ```

4. Ejecutar desde fuera de una carpeta sincronizada públicamente:

   ```powershell
   .\ops\v3-dr\export-full-readonly.ps1 -OutputDirectory D:\backup-cifrado\nico-fit -Execute
   ```

El script fija `default_transaction_read_only=on`, comprueba el ref exacto, rechaza staging, captura conteos y relaciones, crea un dump forense custom y el bundle oficial separado. El manifest registra UTC, bytes y SHA-256. `forensic-full.dump` sirve para inspección; la restauración soportada usa `roles.sql`, `schema.sql` y `data.sql` filtrados por la CLI de Supabase. No se debe restaurar ciegamente el dump forense sobre un proyecto administrado.

### Restore aislado

1. Crear otro proyecto/organización descartable o un stack local completo. No usar producción ni `nico-fit-v3-staging`.
2. Configurar localmente `SUPABASE_DR_PROJECT_REF`, `SUPABASE_DR_DB_URL` y `NICO_FIT_DR_RESTORE_APPROVAL=approved-disposable-full-restore`.
3. Ejecutar:

   ```powershell
   .\ops\v3-dr\restore-full-isolated.ps1 -BackupDirectory D:\backup-cifrado\nico-fit\<timestamp> -Execute
   ```

El restore valida todos los hashes antes de escribir y compara automáticamente usuarios Auth, seis tablas V2, seis tablas con RLS, número de policies y relaciones huérfanas. El reporte `restore-verification.json` sólo puede quedar `PASS` si coincide con el origen.

4. Copiar `.env.v3-dr.example` a `.env.v3-dr.local`, completar valores del destino y probar la contraseña conocida del usuario restaurado:

   ```powershell
   node --env-file=.env.v3-dr.local scripts/v3-dr-auth-verify.mjs --preserved-hash
   ```

La prueba exige el UUID original, inicia sesión por Auth y consulta los conteos esperados con el JWT del usuario. Así verifica a la vez hash operativo, UUID, PostgREST, RLS y propiedad.

## Estrategia B: datos y recreación de Auth

Es el fallback cuando no se puede exportar o restaurar `auth`. Pierde el hash anterior y exige reset de contraseña.

1. Restaurar únicamente el esquema versionado de aplicación en un destino limpio.
2. Recrear cada usuario desde un proceso administrativo server-side. La service role nunca se carga en el navegador ni se guarda en Git.
3. Generar un enlace/token de recuperación, establecer una contraseña nueva e iniciar sesión:

   ```powershell
   node --env-file=.env.v3-dr.local scripts/v3-dr-auth-verify.mjs --recovery-link
   ```

   El script usa un destino protegido por ref, crea una contraseña temporal aleatoria, genera y consume un token de recuperación y verifica el login final. En una recuperación real, el correo se envía mediante `resetPasswordForEmail`; `generateLink` se limita a una prueba administrativa descartable para no depender del correo.

4. Importar las filas de aplicación sustituyendo el UUID viejo por el nuevo antes de insertar. Para una restauración PostgreSQL aislada que ya contiene los stubs viejos, `supabase/v3-dr-remap-v2-ownership.sql` realiza el remapeo de las seis tablas en una transacción y falla si queda alguna fila con el propietario anterior.
5. Consultar con el JWT nuevo y exigir que RLS muestre exactamente las filas esperadas. Otro usuario y `anon` deben observar cero filas.

En Supabase administrado no se deben insertar stubs manuales en `auth.users`. Se crea primero la identidad soportada por Admin Auth y luego se importa la información de aplicación con el UUID nuevo.

## Objetos que no deben copiarse ciegamente

- roles administrados, propietarios y contraseñas de roles;
- claves JWT, publishable/anon, secret/service role y contraseña PostgreSQL;
- tablas/esquema `storage` sin transferir también los objetos reales;
- DDL interno de `auth`, `storage`, Realtime y Supabase que no coincida con la versión del destino;
- sesiones, refresh tokens y MFA como promesa de continuidad: dependen de claves/configuración y deben tratarse como invalidados;
- slots de replicación, subscriptions, webhooks, cron jobs y funciones con efectos externos;
- secretos de Vault o columnas cifradas sin validar la misma encryption root key;
- historial `supabase_migrations` salvo que se exporte y verifique por separado.

Antes de habilitar servicios en el destino se inspeccionan funciones, `pg_net`, `pg_cron`, wrappers, webhooks y triggers externos. Permanecen desactivados durante la prueba para evitar llamadas duplicadas.

## Elementos que se recrean manualmente

- Site URL, redirect URLs, plantilla de correo, SMTP, rate limits, CAPTCHA y proveedores OAuth;
- callbacks y secretos de cada proveedor social;
- Edge Functions y sus secretos;
- configuración/publicaciones de Realtime;
- extensiones y parámetros de base no predeterminados;
- buckets, límites y todos los objetos Storage mediante su API;
- custom domains, DNS, network restrictions y certificados;
- variables de Vercel y URL/keys del nuevo proyecto;
- API keys, JWT/signing keys, DB password, claves S3 y cualquier webhook secret.

La política recomendada es generar claves nuevas y forzar reautenticación. Reutilizar la JWT secret podría mantener tokens antiguos, pero aumenta el impacto de una posible exposición durante el desastre y no es requisito para recuperar los datos.

## Validación ejecutada

| Prueba | Resultado |
|---|---|
| Backup lógico V2 previo + restore PGlite | PASS: 6 tablas, 49 columnas, 18 índices, 30 constraints, 24 policies y 6 RLS |
| Guardas de refs productivo/staging | PASS |
| PowerShell parse de export/restore | PASS |
| Manifest y comparación de hashes diseñados | PASS por test estático; ejecución real pendiente |
| Remapeo atómico de las seis entidades V2 | PASS en PGlite |
| Rechazo del remapeo sobre ref protegido | PASS en PGlite |
| Flujos Auth preservado y reset | API y guardas testeadas estáticamente; ejecución real pendiente |
| `pg_dump` completo de producción | **BLOCKED**: sin contraseña existente ni herramientas |
| Restore Supabase/Auth descartable | **BLOCKED**: sin tercer proyecto/stack local |
| Login con hash restaurado | **BLOCKED** hasta restore completo |
| Reset y propiedad en Supabase real descartable | **BLOCKED** hasta crear destino |

Comandos locales ejecutados:

```powershell
npm run test:v3:disaster-recovery
node --check scripts/v3-dr-auth-verify.mjs
npm test
git diff --check
```

## Tiempos y objetivos de recuperación

Estimación para el tamaño actual, excluyendo esperas de provisión/correo:

| Fase | Estrategia A | Estrategia B |
|---|---:|---:|
| Preparar herramientas/destino | 30–60 min | 20–45 min |
| Export/restore | 15–45 min | 20–45 min |
| Configuración manual | 20–45 min | 20–45 min |
| Auth, RLS y propiedad | 15–30 min | 30–60 min |
| Total estimado | 1 h 20–3 h | 1 h 30–3 h 15 |

El RPO de un dump manual es la hora de su captura. El RTO real no puede declararse hasta cronometrar una restauración completa. Con más usuarios, la estrategia B aumenta por comunicación, reset y conciliación individual.

## Rotación y custodia

Tras recuperar un proyecto se rotan: contraseña DB, publishable/anon y secret/service-role keys, JWT/signing keys, SMTP, OAuth client secrets, webhooks, Edge Function secrets, claves S3 y credenciales CI/Vercel. Las claves públicas pueden volver a distribuirse en una nueva build; ninguna clave administrativa entra al frontend.

El bundle contiene PII, emails y hashes de contraseña. Se cifra en reposo, se restringe por mínimo privilegio, se conserva fuera de Git y se registra acceso/eliminación. Los hashes siguen siendo credenciales sensibles aunque no permitan leer la contraseña directamente.

## Criterio para cerrar el bloqueante

El estado cambia a **GO** sólo cuando, en una ejecución fechada:

1. el dump completo se obtiene con la conexión legítima sin cambiar producción;
2. hashes y conteos del bundle quedan registrados;
3. un destino nuevo restaura sin tocar producción ni staging;
4. una identidad restaurada inicia sesión con la contraseña previa **o** el flujo B completa reset;
5. ese usuario ve exactamente sus datos y un segundo usuario/anon no los ve;
6. se documentan configuración recreada, claves rotadas, duración, RPO y RTO;
7. el destino descartable se elimina después de conservar evidencia no sensible.

Hasta completar los siete puntos, la recomendación es **NO-GO para considerar cerrado disaster recovery** y, por extensión, **NO-GO para el cutover V3**.

## Referencias oficiales

- Supabase, Database Backups: https://supabase.com/docs/guides/platform/backups
- Supabase, Backup and Restore using the CLI: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- Supabase, Restore a Platform Project to Self-Hosted: https://supabase.com/docs/guides/self-hosting/restore-from-platform
- Supabase, Migrating Auth Users Between Projects: https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects
- Supabase, Restore to a New Project: https://supabase.com/docs/guides/platform/clone-project
- Supabase, Storage schema: https://supabase.com/docs/guides/storage/schema/design
- Supabase, Admin createUser: https://supabase.com/docs/reference/javascript/auth-admin-createuser
- Supabase, Redirect URLs: https://supabase.com/docs/guides/auth/redirect-urls
