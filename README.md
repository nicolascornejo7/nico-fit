# Gym + Fútbol — Supabase Sync

PWA simple para registrar gimnasio, estado diario y sensaciones de partido. Esta versión agrega login y sincronización entre celular y PC con Supabase.

## Arquitectura
- Vercel: frontend estático + `/api/config` para exponer únicamente las credenciales públicas de Supabase.
- Supabase Auth: login por email/contraseña.
- Supabase Postgres: `readiness`, `workouts`, `match_reviews`.
- RLS: cada usuario solo puede leer/escribir sus propias filas.
- `localStorage`: caché y respaldo local. Si estás offline, los cambios quedan locales y se sincronizan al recuperar conexión.

## 1. Crear las tablas y políticas en Supabase
1. Abrí Supabase Dashboard.
2. Entrá a tu proyecto.
3. Abrí **SQL Editor** > **New query**.
4. Copiá todo el contenido de `supabase/schema.sql`.
5. Ejecutá con **Run**.

## 2. Verificar variables en Vercel
En **Project > Environment Variables** ya deberían existir por la integración:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` o `SUPABASE_ANON_KEY`

`api/config.js` usa únicamente esas variables públicas. Nunca expone `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` ni `SUPABASE_JWT_SECRET`.

## 3. Configurar Auth en Supabase
En **Authentication > URL Configuration**:
- **Site URL**: tu URL de producción, por ejemplo `https://nico-fit-nine.vercel.app`
- En **Redirect URLs**, agregá también esa URL (podés agregar `https://nico-fit-nine.vercel.app/**`).

Por defecto Supabase puede requerir confirmación por email al crear una cuenta. Si es así, confirmá el correo antes de iniciar sesión.

## 4. Publicar
Reemplazá los archivos del repo por esta versión y ejecutá:

```bash
git add .
git commit -m "Agrego login y sincronizacion con Supabase"
git push
```

Vercel debería desplegar automáticamente la nueva versión.

## 5. Primera prueba recomendada
1. Abrí la app publicada en la PC.
2. Creá una cuenta o iniciá sesión.
3. Guardá el estado del día o un ejercicio.
4. Abrí la misma URL en el celular.
5. Iniciá sesión con la misma cuenta.
6. Tocá **Sincronizar ahora** si fuera necesario.
7. El registro debería aparecer en ambos dispositivos.

## Datos existentes de V1
Al iniciar sesión por primera vez, los datos que ya estaban en `localStorage` se mezclan con los datos remotos y se suben a Supabase. Si existe el mismo registro en ambos lados, se conserva el más reciente cuando hay marca de actualización disponible.

## Desarrollo local
La forma más fiel de probar las variables de Vercel es usar Vercel CLI:

```bash
npm i -g vercel
vercel login
vercel link
vercel dev
```

Abrí la URL local que indique Vercel CLI.
