# Race Replay — Troubleshooting y Fixes aplicados

> Last updated: 2026-03-05
>
> Documento de referencia para entender por qué el replay iba con lag / coches fuera de pista y qué cambios lo solucionaron.

---

## Problemas observados

1. Movimiento de coches "a saltos" (tap tap tap), incluso en `1x`.
2. Cambiar de pestaña (`Replay` / `Engineer`) recargaba todo y perdía estado.
3. Al cambiar de carrera, algunas vistas quedaban con estado viejo o UI rota.
4. En algunos circuitos (ej. Jeddah), ciertos coches aparecían fuera de pista.
5. Algunos trazados de circuito se veían con solapes o segmentos raros.

---

## Causas raíz

### 1) Render demasiado pesado por frame

Se redibujaba toda la escena en cada `requestAnimationFrame`:

- fondo
- pista
- curvas
- overlays
- coches + labels + glow

Eso elevaba coste por frame y causaba micro-stutter.

### 2) React re-render frecuente durante animación

El playhead se actualizaba vía estado React con frecuencia alta, forzando trabajo de reconciliación que no era necesario para pintar el canvas.

### 3) Sampling backend relativamente grueso + jitter GPS

Aunque había interpolación, la entrada seguía teniendo:

- resolución temporal limitada
- ruido puntual en coordenadas GPS

Resultado: pequeños tirones o outliers.

### 4) Transformaciones geométricas y ocultación de tabs

- Mantener tabs montadas mejoró UX, pero exigía reset/re-init correcto por cambio de carrera.
- Canvas oculto puede calcular tamaño incorrecto hasta volver a estar visible.
- Algunos locks de pista eran demasiado simples para geometrías complejas.

### 5) Dibujo de pista cerrando contorno artificialmente

`closePath()` en circuitos con inicio/fin no perfectamente alineados podía introducir un segmento falso visualmente "solapado".

---

## Fixes implementados

## A. Fluidez de animación (frontend)

Archivos:

- `frontend/components/dashboard/ReplayTab.tsx`

Cambios:

- Playhead continuo con RAF desacoplado de re-render completo.
- `canvas-first rendering`: dibujado directo por frame.
- UI (progreso/tower) actualiza a menor frecuencia.
- "Low detail while playing": reduce coste visual en reproducción.
- Cache de medición de texto para labels (`labelWidthCache`).

Efecto:

- Menos trabajo por frame.
- Más FPS percibidos y menos stutter.

---

## B. Capa estática cacheada (frontend)

Archivo:

- `frontend/components/dashboard/ReplayTab.tsx`

Cambio:

- La pista/corners/start-finish se dibuja una vez en un `static canvas` cacheado.
- En cada frame solo se compone capa estática + coches dinámicos.

Efecto:

- Caída fuerte del coste por frame.

---

## C. Sampling + suavizado (backend)

Archivos:

- `src/api/routes/dashboard.py`
- `src/dashboard/replay_engine.py`
- `frontend/lib/dashboard-api.ts`
- `frontend/components/dashboard/ReplayTab.tsx`
- `frontend/components/dashboard/EngineerTab.tsx`

Cambios:

- `sample_interval` por defecto: `0.5` -> `0.25`
- mínimo permitido: `0.2` -> `0.1`
- suavizado ligero de series `x/y` interpoladas para reducir jitter puntual

Efecto:

- Trayectorias más densas y estables.

---

## D. Tab persistence sin recargas (UX)

Archivo:

- `frontend/app/dashboard/page.tsx`

Cambios:

- Tabs visitadas se mantienen montadas (`hidden` en vez de desmontar).
- Pre-mount de tabs pesadas (`Replay`, `Engineer`) tras cargar carrera.

Efecto:

- Cambio de tab instantáneo sin refetch/reinit.

---

## E. Correcto reset por cambio de carrera

Archivos:

- `frontend/app/dashboard/page.tsx`
- `frontend/components/dashboard/ReplayTab.tsx`
- `frontend/components/dashboard/EngineerTab.tsx`

Cambios:

- Se pasa `raceKey` a Replay/Engineer.
- Al cambiar carrera:
  - refetch de datos
  - reset de estado de reproducción
  - redraw al activarse

Efecto:

- Evita UI "mezclada" entre carreras distintas.

---

## F. Track lock robusto (coches fuera de pista)

Archivos:

- `frontend/components/dashboard/ReplayTab.tsx`
- `frontend/components/dashboard/EngineerTab.tsx`

Cambios:

- De nearest-point simple -> proyección al segmento más cercano de la polilínea.
- Umbral off-track dinámico según escala/zoom.
- Clamp visual solo cuando corresponde.

Efecto:

- Casos como ALO/HUL fuera de pista se corrigen de forma más consistente.

---

## G. Circuitos solapados / mal cerrados

Archivos:

- `frontend/components/dashboard/ReplayTab.tsx`
- `frontend/components/dashboard/EngineerTab.tsx`

Cambio:

- Eliminado `closePath()` al dibujar contorno de pista.

Efecto:

- Evita segmentos artificiales y solapes visuales en ciertos trazados.

---

## H. Layout full-space (Replay + Engineer)

Archivos:

- `frontend/components/dashboard/ReplayTab.tsx`
- `frontend/components/dashboard/EngineerTab.tsx`

Cambios:

- Contenedores de altura responsive al viewport.
- El área principal usa `flex-1` en vez de alto fijo limitado.

Efecto:

- Más espacio útil para telemetría y contexto.

---

## Checklist rápido para futuras incidencias

1. ¿Hay lag en coches?
   - Revisar si static layer cache sigue activa.
   - Verificar que UI throttle no se haya eliminado.
2. ¿Coches fuera de pista?
   - Comprobar track lock por segmento y umbral dinámico.
3. ¿Cambias de carrera y se rompe?
   - Confirmar que `raceKey` cambia y reinicia tabs.
4. ¿Circuito raro/solapado?
   - Verificar que no se use `closePath()` en el contorno.

---

## Ideas siguientes (mejora incremental)

- Quality mode en UI (`Balanced` / `Ultra smooth`).
- Modo rendimiento que esconda labels de no-foco en pantallas lentas.
- Validación geométrica de contorno y fallback spline para circuitos problemáticos.
