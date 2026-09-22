# Política de retención de auditoría V3

Esta política se limita a `nico_fit_v3.operational_audit`. V3 registra metadatos operativos mínimos: decisiones de conflicto y fallos de sincronización. No es un registro clínico, de entrenamiento ni de contenido de usuario.

## Retención propuesta

| Evento | Retención | Destino al vencer |
|---|---:|---|
| `conflict_resolution` | 730 días | Exportar si corresponde y purgar mediante operación administrativa explícita. |
| `sync_failure:transient` | 30 días | Purgable: aporta diagnóstico de corto plazo. |
| `sync_failure:auth` | 90 días | Purgable tras revisar un posible problema recurrente de acceso. |
| `sync_failure:conflict` | 365 días | Purgable tras confirmar que no hay conflicto abierto relacionado. |
| `sync_failure:permanent` | 365 días | Revisión humana y exportación antes de purgar. No se purga automáticamente. |

No existe tarea programada ni código de cliente que borre auditoría. La antigüedad sólo vuelve un evento **elegible**; la purga requiere a un administrador autorizado.

## Datos permitidos y prohibidos

Se conservan exclusivamente: UUIDs de evento, usuario y entidad; tipo de evento; estrategia; versiones; timestamps; y categorías/códigos enumerados de error. No se permiten payloads completos, snapshots, notas, texto arbitrario, datos de ejercicios, credenciales, tokens, claves, cookies, direcciones de correo ni contraseñas.

## Exportación autorizada

1. Un administrador ejecuta `audit_retention_preview()` en el SQL Editor o mediante una conexión administrativa segura.
2. Antes de borrar, exporta únicamente las columnas del esquema de `operational_audit` que correspondan al rango o usuario autorizado. El export se guarda cifrado fuera del repositorio, con fecha, operador, alcance y checksum.
3. El export no se sube a Git ni se envía a clientes. Se retiene según la obligación administrativa aplicable.

Ejemplo de consulta de exportación para un usuario autorizado (reemplazar el UUID fuera de este documento):

```sql
select event_id, user_id, event_type, entity, entity_id, strategy,
       local_revision, local_remote_version, remote_version,
       occurred_at, received_at, error_kind, error_code
from nico_fit_v3.operational_audit
where user_id = :approved_user_id
order by received_at, event_id;
```

## Purga administrativa

La migración introduce dos funciones `SECURITY DEFINER`, sin `EXECUTE` para `anon` ni `authenticated`:

- `audit_retention_preview(p_as_of)` muestra únicamente conteos elegibles por categoría.
- `purge_operational_audit('retention', null, false, p_as_of)` purga sólo eventos ya elegibles según esta política.
- `purge_operational_audit('account_deletion', :user_id, true, clock_timestamp())` purga el historial de auditoría de una cuenta **después de exportarlo** y como paso explícitamente aprobado de eliminación de cuenta.

No usar `DELETE` normal. La tabla sigue con RLS y los clientes sólo mantienen `SELECT` propio e `INSERT` propio. La función de trigger bloquea `UPDATE` y `DELETE` salvo dentro de este procedimiento privilegiado.

## Eliminación de cuenta y `auth.users`

`operational_audit.user_id` referencia `auth.users(id) ON DELETE RESTRICT`. Por eso el orden obligatorio es: exportar datos autorizados, cerrar/retirar colas y datos de aplicación conforme al runbook, purgar explícitamente la auditoría de la cuenta, y **recién al final** borrar la identidad de Auth. Si la exportación o la purga falla, no se borra `auth.users`.

## Fallos permanentes

Un fallo `permanent` se conserva 365 días y requiere revisión humana antes de que sea elegible para purga. La revisión debe confirmar que no existe una operación local recuperable, conflicto sin resolver o incidente operativo abierto. La eliminación no debe borrar ni modificar operaciones locales pendientes.

## Operación y límites

Las funciones sólo se ejecutan desde SQL Editor/conexión administrativa autorizada; el frontend usa únicamente la publishable key y nunca puede invocarlas. Toda ejecución administrativa debe quedar registrada en el ticket o runbook operativo con operador, motivo, rango, conteos previos/posteriores y checksum del export. No hay purga automática en producción.