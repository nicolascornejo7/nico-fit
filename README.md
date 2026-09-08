# Gym + Fútbol — PWA

Aplicación web simple para registrar gimnasio, fatiga y sensaciones de partido, con foco en llegar bien al fútbol del sábado.

## Incluye
- Plan semanal fijo.
- Rutinas de martes, jueves y viernes.
- Registro de kilos, repeticiones y RIR.
- Sueño, energía, fatiga y dolor.
- Recomendación simple de ajuste de carga.
- Evaluación del partido del sábado.
- Historial guardado con `localStorage`.
- PWA instalable y soporte offline básico.

## Probarla localmente
Por el service worker, conviene servirla por HTTP en lugar de abrir `index.html` directamente.

Con Python instalado:

```bash
python -m http.server 8000
```

Luego abrí `http://localhost:8000`.

## Subir a GitHub
1. Creá un repositorio vacío en GitHub, por ejemplo `gym-futbol-app`.
2. No agregues README, licencia ni `.gitignore` desde GitHub porque este proyecto ya los incluye.
3. Desde una terminal dentro de esta carpeta:

```bash
git init
git add .
git commit -m "Primera version Gym Futbol PWA"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/gym-futbol-app.git
git push -u origin main
```

## Publicar en Vercel
1. Entrá a Vercel e iniciá sesión con GitHub.
2. Elegí **Add New > Project**.
3. Importá `gym-futbol-app`.
4. Dejá el proyecto como sitio estático, sin build command.
5. Hacé clic en **Deploy**.

Cada nuevo `git push` a la rama de producción generará un nuevo deployment en Vercel.

## Instalar en el celular
### Android / Chrome
Abrí la URL publicada y usá **Instalar app** o **Agregar a pantalla principal** desde el menú del navegador.

### iPhone / Safari
Abrí la URL en Safari, tocá **Compartir** y luego **Agregar a inicio**.

## Importante sobre los datos
Los registros se guardan con `localStorage`, por lo que quedan vinculados a ese navegador/dispositivo. Una futura versión puede usar Supabase para sincronización y login.
