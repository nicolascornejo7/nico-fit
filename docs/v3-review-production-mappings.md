# Revisión humana de mappings productivos V2

Fecha: 2026-09-16. Fuente: export productivo read-only capturado a las 10:36:15 ART, SHA-256 `118d73d464a50711901d04dd0cdf5ac44691d1175ea01ed82b6195c3e28a86e7`.

## Decisiones aprobadas

| Workout V2 | Identidad estable | Tipo | Posición prescrita | Series | Decisión |
|---:|---|---|---:|---:|---|
| 60 | `sentadilla-prensa` | reps | 0 | 3 | Identidad combinada preservada |
| 10 | `press-banca` | reps | 2 | 3 | Coincidencia exacta |
| 1 | `elevacion-gemelos` | reps | 5 | 3 | Coincidencia exacta |
| 35 | `plancha-pallof` | segundos | 6 | 3 | Identidad combinada preservada |

La aprobación vincula cada decisión al PK V2, sesión V2 `1`, identidad fuente, timestamp y huella SHA-256 del payload completo. El orden representa la prescripción histórica de `v2-validated-day-2` versión 1. No afirma el orden real de ejecución.

Las doce series se conservan literalmente. Los valores 45/60/60 de Plancha/Pallof se interpretan como segundos por la identidad exacta de la rutina, pero no se recortan al rango prescrito. Carga cero, RIR cero y las identidades combinadas permanecen sin normalización.

## Preflight

`supabase/preflight-v3-production-readonly.sql` contiene la misma decisión en un CTE de sólo lectura. Exige coincidencia exacta de:

- PK de workout y sesión;
- propietario y fecha de la sesión relacionada;
- fecha, día, nombre y `updated_at` del workout;
- hash del JSONB de todas sus series;
- identidad canónica, tipo de medición y posición aprobados.

La validación se ejecutó sobre una restauración PGlite efímera del export real. Resultado:

| Entidad | Migrated | Pending review | Skipped |
|---|---:|---:|---:|
| `workout_sessions` | 1 | 0 | 0 |
| `session_exercises` | 4 | 0 | 0 |
| `exercise_sets` | 12 | 0 | 0 |
| `daily_readiness` | 5 | 0 | 0 |
| `football_sessions` | 1 | 0 | 0 |
| `match_reviews` | 0 | 0 | 0 |

El runner `scripts/v3-review-production-mappings.mjs` vuelve a validar el manifiesto JSON y ejecuta el SQL completo en una base efímera. No escribe en Supabase.

```powershell
node scripts/v3-review-production-mappings.mjs `
  --input artifacts/v3-backup-restore-validation/20260916-103734/nico-fit-production-v2.csv `
  --output artifacts/v3-review-production-mappings/20260916-approved
```

## Protección ante cambios

Un mapping ausente o incorrecto permanece `pending_review`. Cualquier cambio posterior en la fuente invalida su huella y devuelve ese ejercicio y sus series a revisión. Reejecutar el preflight no crea objetos ni modifica V2 o V3, por lo que es idempotente.

## Decisión

**Los cuatro mappings permanecen documentados y aprobados como evidencia histórica, pero no son condición de lanzamiento.** Por decisión del 2026-09-20, V3 empieza sin sesiones V2; no se ejecuta backfill productivo de datos personales. Si se autoriza una migración posterior, habrá que repetir el preflight sobre un export fresco y revalidar cualquier fuente modificada. V2 se conserva y el estado general continúa **NO-GO para cutover** por otros bloqueantes.
