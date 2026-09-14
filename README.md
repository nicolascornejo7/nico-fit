# Nico Fit V2

PWA personal para combinar gimnasio y fútbol, con sincronización Supabase.

La aplicación activa se inicia desde `index.html` y usa los módulos de `js/`. La implementación monolítica V1 se conserva únicamente como referencia en `legacy/app-v1.js` y no forma parte del runtime ni del caché de la PWA.

## V2
- Dashboard con readiness y cuenta regresiva al partido.
- Readiness con Sueño / Energía / Frescura / Dolor + zona.
- Rutinas de martes, jueves y viernes.
- Última sesión y sugerencia automática de carga.
- Cronómetro de sesión y descanso por serie.
- Resumen de sesión con duración, volumen y RPE.
- Registro de carga de fútbol por sRPE (duración × RPE).
- Gráficos de readiness, frescura al partido y fuerza.
- PWA, soporte offline básico, localStorage + Supabase.

## Actualización desde V1
1. En Supabase > SQL Editor, ejecutar `supabase/migration-v2.sql` una sola vez.
2. Reemplazar los archivos del repositorio por esta versión.
3. `git add .`
4. `git commit -m "Actualizo Nico Fit a V2"`
5. `git push`
6. Vercel desplegará automáticamente.

La migración no elimina las tablas ni registros anteriores.
