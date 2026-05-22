# Propuestas de Mejoras Visuales Premium para Claude (Camedi UI/UX)

Este archivo contiene estilos CSS avanzados, animaciones y mejoras de micro-interacción listos para ser copiados y pegados o procesados por **Claude** en el archivo `index.html` (dentro del bloque `<style>`) o en `css/styles.css`.

---

## 1. Transición de Tema Suave (Light/Dark Mode Transition)
Suaviza el cambio de color de toda la interfaz al alternar entre el modo claro y oscuro para evitar el parpadeo brusco de colores.

### CSS para agregar:
```css
/* Transiciones de tema suaves */
body, html, .bg-surface, .bg-bg, .text-ink, .text-ink-soft, .border-line, .input, aside, nav, .guardia-card, .cal-cell {
  transition: background-color 0.35s cubic-bezier(0.4, 0, 0.2, 1), 
              color 0.35s cubic-bezier(0.4, 0, 0.2, 1), 
              border-color 0.35s cubic-bezier(0.4, 0, 0.2, 1),
              box-shadow 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}
```

---

## 2. Animación de Pulso Glow en Estados Pendientes
Añade un punto luminoso que pulsa con animación infinita para los estados "Pendiente" en las listas de médicos. Esto dirige sutilmente la atención del administrador a las tareas pendientes.

### CSS para agregar:
```css
/* Pulsador luminoso para estados pendientes/alertas */
.badge-warn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.badge-warn::before {
  content: '';
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--warn);
  box-shadow: 0 0 8px var(--warn);
  animation: glow-pulse 1.8s infinite ease-in-out;
}

@keyframes glow-pulse {
  0%, 100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(212, 150, 30, 0.6);
    opacity: 1;
  }
  50% {
    transform: scale(1.25);
    box-shadow: 0 0 0 5px rgba(212, 150, 30, 0);
    opacity: 0.75;
  }
}
```

---

## 3. Efectos Glassmorphism (Efecto Esmerilado) en Modales
Reemplaza los fondos planos de los modales por una superficie de vidrio esmerilado que se integra de manera orgánica con los degradados radiales del fondo de la aplicación.

### CSS para agregar:
```css
/* Modales con efecto de cristal esmerilado */
.modal-contenido, #adm-modal-inscriptos .bg-surface {
  background: rgba(255, 255, 255, 0.82) !important;
  backdrop-filter: blur(16px) saturate(120%);
  -webkit-backdrop-filter: blur(16px) saturate(120%);
  border: 1px solid rgba(255, 255, 255, 0.4) !important;
  box-shadow: var(--shadow-lg), inset 0 1px 0 rgba(255, 255, 255, 0.5) !important;
}

/* Ajuste para el modo oscuro */
html[data-theme="dark"] .modal-contenido, 
html[data-theme="dark"] #adm-modal-inscriptos .bg-surface {
  background: rgba(17, 43, 41, 0.8) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  box-shadow: var(--shadow-lg), inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
}
```

---

## 4. Zoom y Sombras Premium en Celdas de Calendario
Hace que las celdas del calendario aumenten ligeramente de tamaño y generen una sombra envolvente al pasar el cursor por encima, creando una experiencia táctil y fluida al elegir turnos.

### CSS para agregar:
```css
/* Interactividad premium del calendario */
.cal-cell {
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), 
              box-shadow 0.2s ease, 
              border-color 0.2s ease;
}
.cal-cell:hover:not(.otro-mes) {
  z-index: 10;
  transform: scale(1.04) translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: var(--primary) !important;
  border-radius: 8px;
}
```

---

## 5. Diseño Personalizado de Barras de Desplazamiento (Scrollbars)
Sustituye las barras de scroll predeterminadas del navegador por barras minimalistas y estilizadas que se adaptan a la paleta de colores de la aplicación.

### CSS para agregar:
```css
/* Barras de scroll minimalistas */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: var(--bg);
}
::-webkit-scrollbar-thumb {
  background: var(--line);
  border-radius: 9999px;
  border: 2px solid var(--bg);
}
::-webkit-scrollbar-thumb:hover {
  background: var(--ink-mute);
}
```

---

## 6. Destellos Degradados Dinámicos en las Tarjetas de Guardias
Agrega un sutil resplandor con degradado en las esquinas de las tarjetas de guardias al pasar el ratón, dándoles un aspecto moderno "Glow".

### CSS para agregar:
```css
/* Destello de gradiente en hover para tarjetas */
.guardia-card {
  position: relative;
  overflow: hidden;
}
.guardia-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 100% 0%, var(--accent-soft) 0%, transparent 60%);
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}
.guardia-card:hover::after {
  opacity: 1;
}
```

---

## 7. Esqueleto de Carga Animado (Skeleton Loader Shimmer)
Para las secciones dinámicas (ej: al cargar guardias o médicos), reemplaza los textos estáticos de "Cargando..." por estructuras esqueleto que simulan los datos reales con un brillo de izquierda a derecha.

### CSS para agregar:
```css
/* Animación Shimmer para estados de carga */
.shimmer-placeholder {
  background: linear-gradient(90deg, var(--line) 25%, var(--bg) 50%, var(--line) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.6s infinite linear;
  border-radius: 10px;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

#### Ejemplo de HTML a retornar en el JS al cargar (reemplazando el texto plano "Cargando..."):
```html
<div class="space-y-4 py-8">
  <div class="shimmer-placeholder h-16 w-full"></div>
  <div class="shimmer-placeholder h-16 w-full"></div>
  <div class="shimmer-placeholder h-16 w-full"></div>
</div>
```
