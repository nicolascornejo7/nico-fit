# Validación de backup y restore V2

Fecha: 2026-09-16. Rama: `feature/v3-backup-restore-validation`.

## Resultado

Se extrajo producción `gym-futbol` (`xaklsoqyzwowtjwcpwmb`) mediante `supabase/backup-v2-production-readonly.sql`. La consulta abre una transacción `READ ONLY`, ejecuta únicamente catálogos y `SELECT`, genera una sola fila Base64 y no crea objetos ni ejecuta migraciones. Staging no fue consultado ni modificado.

El payload se restauró en una instancia nueva y efímera de PGlite. El runner rechazará como destino el ref productivo, el ref del staging conservado y cualquier host que contenga alguno de esos refs. El backup y la evidencia real quedan bajo `artifacts/v3-backup-restore-validation/`, ignorado por Git. No contienen claves API, service role ni contraseña de base de datos.

| Artefacto | Tamaño | SHA-256 |
|---|---:|---|
| Export CSV/Base64 | 36.828 bytes | `118d73d464a50711901d04dd0cdf5ac44691d1175ea01ed82b6195c3e28a86e7` |
| Payload decodificado | 27.248 bytes | `dc4616b39abc0737733c8cf1cda06534a868bbe8b4345469214db2e96d70612d` |
| Esquema V2 restaurado | 8.921 bytes | `6d13c257fcaebb26e02e35974d2dcf2064a2706354a6926cac9eb6133ee8287e` |

Captura productiva: `2026-09-16T13:36:15.092203+00:00`. PostgreSQL productivo: 17.6.

## Comparación automática

| Entidad | Origen | Restaurada | Resultado |
|---|---:|---:|---|
| Auth identity stubs | 1 | 1 | PASS |
| `readiness` | 5 | 5 | PASS |
| `workouts` | 4 | 4 | PASS |
| `match_reviews` | 0 | 0 | PASS |
| `football_sessions` | 1 | 1 | PASS |
| `workout_sessions` | 1 | 1 | PASS |
| `sync_tombstones` | 0 | 0 | PASS |

La comparación por identidad también aprobó 49 columnas, 18 índices, 30 constraints, 24 políticas y 6 tablas con RLS. No quedaron relaciones huérfanas. Las seis secuencias de identidad quedaron al menos en el máximo restaurado. RLS mostró filas al propietario autenticado, ocultó todo a otro UUID y ocultó todo a `anon`.

## Procedimiento reproducible

1. Abrir exclusivamente el SQL Editor del proyecto productivo cuyo ref visible sea `xaklsoqyzwowtjwcpwmb`.
2. Ejecutar `supabase/backup-v2-production-readonly.sql` y comprobar que devuelve una sola columna `payload_base64` y una sola fila.
3. Descargar CSV y guardarlo cifrado fuera de Git. No abrir ni pegar el contenido en tickets o logs.
4. Crear un directorio nuevo bajo `artifacts/v3-backup-restore-validation/<timestamp>/` y copiar allí el CSV.
5. Ejecutar:

   ```powershell
   node scripts/v3-backup-restore-verify.mjs --input <backup.csv> --output <directorio> --targetRef local-isolated-pglite
   ```

6. Exigir `status: PASS` en `restore-verification.json`. Conservar juntos `backup-manifest.json`, `schema-v2.sql`, el CSV y el reporte, cifrados y con acceso restringido.
7. Repetir la extracción inmediatamente antes de cualquier ventana futura; este backup es una fotografía, no captura escrituras posteriores.

El comando puede repetirse sin estado previo porque crea una base efímera nueva en memoria. El restore nunca se conecta a Supabase.

## Fallos encontrados y correcciones

- PGlite expone constraints internos `NOT NULL` como `contype=n`, a diferencia del catálogo observado en PostgreSQL 17.6. Se excluyen sólo esos objetos internos y se comparan nombres de los 30 constraints funcionales.
- El bootstrap V3 existente precreaba tres tablas V2 y omitía dos checks de `workout_sessions`. Se creó `test-v2-restore-bootstrap.sql`, que simula únicamente roles/Auth y deja que `schema.sql` cree íntegramente V2.
- La descarga automatizada de Edge conservó temporalmente el sufijo `.crdownload`; el archivo dejó de crecer, decodificó a JSON completo y fue validado por checksum antes del restore. El procedimiento normal usa el CSV finalizado.

## Riesgos y decisión

El export excluye deliberadamente contraseñas cifradas, tokens, sesiones e identidades internas de Supabase Auth. Conserva `id` y `email` para restaurar propiedad y claves foráneas, pero un desastre que pierda el proyecto Auth requeriría recrear la cuenta y forzar un cambio de contraseña. PGlite tampoco reproduce GoTrue ni PostgREST.

Resultado: **PASS para respaldo/restauración de esquema y datos de la aplicación V2; NO-GO para cerrar el bloqueante “backup completo restaurado y verificado”**. Para cerrarlo se necesita una de estas evidencias:

- un `pg_dump`/restore completo ejecutado con credenciales existentes, sin resetear la contraseña productiva, sobre PostgreSQL local descartable; o
- backup administrado de Supabase restaurado a un proyecto nuevo y prueba real de Auth.

El estado general de producción continúa **NO-GO**. No se ejecutaron freeze, migraciones, backfill, flags, deploy ni cutover.
