# Ciudad 2050 — Traspaso de contexto

> Este documento está escrito para un asistente de IA que va a trabajar sobre
> este código sin haberlo visto antes. Leelo entero antes de tocar nada: hay
> varias decisiones que parecen mejorables y que en realidad ya se probaron y
> fallaron, y están explicadas acá para que no se repitan.

---

## 1. Qué es el proyecto

Una **ciudad solarpunk del año 2050**, generada íntegramente por código,
recorrible a pie desde el navegador y preparada para realidad virtual (WebXR).

Reglas duras que definen el proyecto:

- **Cero assets externos.** No hay un solo modelo 3D descargado ni una sola
  textura en disco. Toda la geometría son primitivas (cajas, cilindros, conos,
  icoesferas) y todas las texturas se dibujan en un canvas 2D al arrancar.
- **Todo determinista.** La ciudad se genera desde una semilla: la misma semilla
  da exactamente la misma ciudad. `?seed=42` es la de referencia.
- **Sin autos.** En 2050 esta ciudad resolvió la movilidad con tranvía, bici y
  caminata. Por eso la calzada es angosta y la vereda enorme. No es decorativo:
  es lo que permite árboles grandes y veredas habitables.

No tiene relación con ningún otro proyecto. Es autónomo.

---

## 2. Stack y ejecución

| | |
|---|---|
| Motor 3D | **Babylon.js 8.56.2** (`@babylonjs/core` + `@babylonjs/materials`) |
| Lenguaje | TypeScript 5.9.3, modo `strict`, con `noUnusedLocals` |
| Build | Vite 6.4.3 |
| Node | 24.13.0 |
| Herramientas | `puppeteer-core` (sólo dev, usa el Chrome del sistema) |

```bash
npm install
npm run dev          # http://localhost:5173
npm run typecheck    # tsc --noEmit
npm run build
```

**Parámetros de URL**

- `?seed=42` — ciudad reproducible (acepta número o texto)
- `?quality=vr|balanced|high` — fuerza un perfil de calidad

**Controles**: `WASD` mover, `Shift` correr, `Espacio` saltar, `F` alterna
caminar/volar, `E`/`Q` subir y bajar volando, clic sobre un edificio para
inspeccionarlo, `H` oculta la ayuda, `Esc` cierra paneles.

---

## 3. Arquitectura

```
src/
├── core/
│   ├── InstanceFarm.ts     # thin instances — el corazón del rendimiento
│   ├── RenderPipeline.ts   # SSAO, bloom, viñeta, nitidez, grano
│   └── QualityManager.ts   # tres perfiles: vr / balanced / high
├── world/
│   ├── CityLayout.ts       # el PLANO: manzanas, calles, canal (datos puros)
│   ├── City.ts             # orquestador + precompilación de shaders
│   ├── CityIndex.ts        # índice espacial: colisión, clic, estimaciones
│   ├── Life.ts             # tranvías y pájaros (thin instances dinámicas)
│   ├── Crowd.ts            # gente: comportamiento, animación, recorte
│   ├── PeopleGeometry.ts   # piezas low-poly de las personas y la bici
│   ├── SchoolLayout.ts     # planta del plano de evacuación CIMDIP (datos puros)
│   ├── SchoolIdentity.ts   # cartel, reloj, tótem, bandera, cancha (1 atlas)
│   ├── Environment.ts      # cielo, sol, sombras CSM, IBL, mapeo tonal
│   ├── Textures.ts         # texturas procedurales en canvas 2D
│   ├── Palette.ts          # lenguaje visual (colores)
│   ├── Materials.ts        # biblioteca compartida + variantes de tinte
│   └── builders/
│       ├── NatureBuilder.ts    # árboles, arbustos, jardineras, bosque
│       ├── BuildingBuilder.ts  # volúmenes escalonados, torres, mercado, cívico
│       ├── StreetLevel.ts      # planta baja, toldos, balcones, mobiliario
│       ├── InfraBuilder.ts     # calles, canal, puentes, energía
│       ├── SchoolBuilder.ts    # escuela CIMDIP & Miguel Cané en 3D
│       └── PrismBatch.ts       # pisos y losas poligonales (diagonales del plano)
├── game/ChallengeSystem.ts # cinco guías NPC, diálogo y preguntas del campus
├── player/
│   ├── FlyCamera.ts        # cámara base
│   └── PlayerController.ts # caminar/volar, gravedad, salto, colisión
├── ui/Inspector.ts         # clic → ficha de la manzana
├── vr/XRSetup.ts           # teleport, giro por pasos, hand tracking
└── utils/rng.ts            # mulberry32 con semilla
```

### Flujo de generación

1. `generateCityPlan(seed)` produce un **plano de datos puros**: las manzanas
   de la grilla con tipo, posición y altura, más las calles y la recta del
   canal.
2. Los *builders* recorren ese plano y emiten geometría dentro de una única
   `InstanceFarm`.
3. `farm.commit()` sube todo a la GPU en buffers estáticos.
4. `Environment` arma cielo, sol, sombras e IBL.
5. `RenderPipeline` agrega el post-procesado.
6. `City.precompile()` compila shaders con presupuesto de tiempo.
7. Recién entonces se congelan los materiales y se muestra la escena.

**El orden de los pasos 4→7 importa y está explicado en el punto 5.**

### Siete tipos de manzana

`park` · `water` (canal) · `residential` (manzana perimetral con patio
interior) · `civic` (la central siempre lo es: ahí está la escuela) ·
`tower` (con jardines en altura cada
4-6 pisos) · `market` (estructura de madera laminada) · `energy` (huerta solar
con turbinas de eje vertical).

---

## 4. Las dos ideas que sostienen todo

### 4.1 `InstanceFarm` — thin instances

En vez de crear una malla por cada ventana, árbol o panel, se registra **una
malla unitaria por cada combinación primitiva+material** y se acumulan matrices
de transformación en un buffer.

**Resultado: ~128 draw calls para 29.800 objetos.** Podrían ser 100.000 objetos
y seguirían siendo ~128, porque el coste está en la cantidad de combinaciones
primitiva/material, no en la cantidad de copias.

Consecuencia importante: **los edificios no son objetos para Babylon.** No se
puede hacer picking sobre ellos ni usar el sistema de colisiones del motor.

### 4.2 `CityIndex` — índice espacial

Resuelve lo anterior sin renunciar al rendimiento. Dada una posición del mundo,
calcula en qué manzana cae con una división y un redondeo. Con eso se hace:

- **Colisión al caminar** (`isSolid(x, z)`)
- **Inspección por clic**: se marcha a lo largo del rayo de la cámara
  consultando el índice, ~120 consultas por clic
- **Estimaciones** de habitantes, superficie de paneles y kWh/día

Si necesitás interacción con el mundo, **extendé `CityIndex`**; no vuelvas
pickables las thin instances.

---

## 5. Decisiones que NO hay que deshacer

Cada una de estas se ve como "código raro" y en realidad corrige un bug concreto
que ya costó una iteración. Si las revertís, el bug vuelve.

1. **`thinInstanceRefreshBoundingInfo(true)` después de
   `thinInstanceSetBuffer(..., staticBuffer: true)`.**
   Con buffer estático, Babylon NO recalcula el volumen envolvente. Sin esa
   llamada, la malla conserva el bounding de la primitiva unitaria en el origen,
   el generador de sombras descarta la ciudad entera y **no se ve ni una sombra**.

2. **Los materiales se congelan al final, no al crearlos.**
   `material.freeze()` impide recompilar el shader. Si se congela antes de crear
   el generador de sombras, los *defines* de sombra nunca entran. Por eso existe
   `Materials.freezeAll()` y se llama después de `enableShadows()`.
   Lo mismo con `scene.blockMaterialDirtyMechanism`: arranca en `false` y se
   pone en `true` recién al final.

3. **Los metales se mantienen bajos (`metallic` ≤ 0.3) y la escena tiene IBL.**
   En PBR, un metal no tiene componente difusa: todo su color viene de lo que
   refleja. Sin `scene.environmentTexture`, cualquier material metálico se
   renderiza casi negro.

4. **La `ReflectionProbe` del IBL sólo incluye el cielo (`renderList = [skyBox]`).**
   Si se incluye la ciudad, WebGL rechaza el render con
   *"Feedback loop formed between Framebuffer and active Texture"*, porque los
   materiales muestrean la textura que se está generando a partir de ellos.
   Además el cielo es el ~90 % de la luz ambiental al aire libre.

5. **Mapeo tonal ACES activado.**
   Sin él, PBR recorta a blanco puro todo lo que supera 1.0 y la ciudad parece
   una maqueta de papel. Es el cambio que más acercó el resultado a "render".

6. **Las texturas se COMPARTEN entre materiales, no se clonan.**
   La escala de repetición es constante por tipo de superficie, así que clonar
   era ~110 copias de un canvas de 256² absolutamente innecesarias.

7. **`City.precompile()` tiene un presupuesto de tiempo duro (2.5 s).**
   Bajo render por software, un solo shader PBR tardó ~45 s en compilar. Sin el
   tope, la pantalla de carga se cuelga para siempre en un equipo lento.

8. **Variantes de escala de textura: `concreteXL`, `timberXL`, `pavementXL`.**
   Las UV de una primitiva van de 0 a 1 sin importar su tamaño físico. Un muro
   de 42 × 19 m con la misma escala que una caja de 2 m convierte el grano del
   hormigón en franjas de 12 metros.

9. **El vidrio es OSCURO (`#28423c`, `#243a49`) con metalicidad alta.**
   Una ventana vista desde afuera de día se ve oscura: el interior está mucho
   menos iluminado que la fachada al sol. Con vidrios claros, las aberturas
   tenían el mismo valor que el muro y los edificios parecían bloques lisos.

10. **El follaje usa icoesferas de subdivisión 1 (20 triángulos) con
    `flat: false`.**
    `CreateSphere({segments: 4})` cuesta **144** triángulos; con ~8.700 copias se
    comía el 84 % de la escena. `flat: false` promedia las normales: con los
    mismos 20 triángulos la copa se lee redonda en vez de facetada.

11. **El emisivo del follaje está en 0.26.**
    Con 0.30 los árboles brillan por su cuenta y parecen plástico. Con 0.18
    quedan **negros a contraluz**, como agujeros en la imagen. Es un sustituto
    barato de dispersión subsuperficial.

12. **El ángulo del canal va NEGADO (`-Math.atan(slope)`).**
    Babylon es zurdo: rotar +X sobre Y por θ lo lleva a `(cos θ, 0, −sin θ)`.
    Sin negar, el canal se dibujaba espejado y no coincidía con las manzanas que
    el plano había marcado como agua.

13. **En `classifyBlock`, `ring === 0` se comprueba ANTES que el canal.**
    Si no, hay semillas donde el agua se come la manzana central y la ciudad
    nace sin plaza, sin Árbol Solar y con el jugador apareciendo en una calle
    vacía.

14. **Cada manzana planta sólo sus lados norte y oeste.**
    Si planta los cuatro, cada calle recibe árboles de las dos manzanas que la
    comparten: la densidad se duplica y la ciudad queda tapada por un bosque.

15. **El vidrio de las ventanas es más ANGOSTO que el cuerpo del edificio.**
    En una versión anterior era `w + 0.12`, o sea un aro que sobresalía;
    apilado piso a piso, los edificios parecían pilas de platos. Ahora deja las
    esquinas macizas, que es el lenguaje real de una ventana corrida.

16. **La colisión al caminar se resuelve por ejes separados.**
    Si el eje X está bloqueado pero Z no, el jugador se desliza a lo largo de la
    pared en vez de quedarse trabado. Es la diferencia entre una colisión que se
    siente natural y una que frustra.

17. **`dt` está topado a 50 ms en `PlayerController`.**
    Sin el tope, un tirón de cuadro teletransporta al jugador a través de una
    pared.

18. **Rotar θ sobre Y en Babylon lleva +X a (cos θ, −sin θ) y +Z a
    (sin θ, cos θ).** Es la fuente de varios bugs corregidos: patas de banco
    espejadas, bancos de la plaza no tangentes, ribera del canal plantada sobre
    la diagonal equivocada. Ante la duda, verificarlo con
    `Vector3.TransformCoordinates` en vez de razonarlo.

19. **El norte está en −Z.** Los paneles solares se inclinan hacia −Z y el sol
    culmina ahí (azimut de mediodía 4,45). Antes culminaba en +Z: los paneles
    le daban la espalda y la fachada de la escuela quedaba en sombra.

20. **`STANDARD_SUN_COMP` (0,45) en los `StandardMaterial`.** El sol vale ~2,4
    porque la ciudad es PBR; follaje, césped y gente lo multiplicaban tal cual,
    saturaban por canal y el verde se volvía menta blanquecino.

21. **El agua del canal está 3 cm por encima de y = 0.** El suelo base de la
    ciudad termina en 0: con el agua también en 0 había z-fighting en todo el
    canal.

22. **`SchoolLayout` es la única fuente de coordenadas de la escuela.** Es la
    planta baja del plano de evacuación, medida píxel a píxel y pasada a
    metros (0,07 m/px): muros con sus vanos, ambientes, escaleras,
    equipamiento, zonas de alumnos y estaciones. La usan `SchoolBuilder`,
    `SchoolIdentity` (incluido el plano de evacuación colgado en el hall),
    `CityIndex` (colisión por grilla de ocupación de 10 cm), `Crowd`,
    `ChallengeSystem` y el indicador "Estás en" de `main.ts`. No inventar
    ambientes: la planta alta no está en el plano y se levanta como volumen
    cerrado.

23. **Personas: un material, color = vértice × instancia.** Las piezas
    articuladas tienen el origen en su pivote (hombro, cadera, rodilla) para
    compartir matriz: antebrazo y mano usan la del brazo, zapato la de la
    pierna. Cada cuadro se escriben sólo las personas visibles, compactadas, y
    las mallas son `alwaysSelectAsActiveMesh`: su bounding no se puede
    mantener barato. Ver `PeopleGeometry.ts` y `Crowd.ts`.

24. **La escuela ocupa DOS manzanas** (`schoolSite`): la central y la de su
    oeste, sin la calle intermedia (`Street.gaps`). La planta real
    (~67 × 39 m) no entra en una manzana de 42 m. `CityIndex.blockAt` devuelve
    la escuela en todo el rectángulo, incluida la franja de la calle cortada;
    los EcoPods pegan la vuelta ahí y los peatones de vereda no entran.

25. **En este mundo el este es −x** (el norte es −z y el sol sale por −x).
    Por eso `toWorld` hace `x = ox − u`: con `u = +x` la escuela quedaba
    espejada y el gimnasio aparecía a la izquierda mirando desde Laprida.
    Cualquier rotación calculada en coordenadas locales tiene que pasar por
    el mundo (ver `SchoolBuilder.yaw` y `QuadBatch.wall`).

26. **La escuela está en el centro y ya no hay plaza.** Ocupa la manzana
    central (antes la plaza con el Árbol Solar) y la de su oeste. El canal
    corre siempre al norte del predio, a sus espaldas. Laprida, la calle de la
    fachada, nunca es avenida: sin tranvía ni ensanche delante del portón.
    `classifyBlock` sigue protegiendo `ring === 0` del agua y le da altura
    fija sin consumir azar. En VR se aparece frente a la escuela, igual que en
    escritorio (`startView` en `main.ts`).

---

## 6. Estado actual

### Métricas (semilla 42)

Con el mundo centrado en la escuela (grilla 5×5 con la escuela en el centro,
sin plaza, y planta del plano de evacuación). Draw calls = todas las
mallas con material en escena, que es lo que muestra el panel de métricas;
entre paréntesis, la versión anterior (9×9 en Alta, 7×7 en VR, escuela
artística) medida igual.

| Perfil | Objetos | Triángulos | Draw calls | Generación |
|---|---|---|---|---|
| Alta | 12.262 (31.967) | 185k (500k) | 192 (204) | ~200 ms |
| VR | 9.520 (14.241) | 133k (205k) | 177 (181) | ~200 ms |

### Carga

| | Dev | Producción |
|---|---|---|
| Peticiones | 161 | **21** |
| Transferido | 5.168 KB | **523 KB** |

**El cuello de botella de la carga no es la descarga: es la compilación de
shaders.** El shader PBR con CSM + IBL + niebla + SSAO + ACES es enorme.

### Qué ya funciona

- Generación procedural completa y determinista
- Caminar con gravedad, salto y colisión; volar
- Inspección por clic con ficha de datos
- Panel de energía con totales de la ciudad
- Tranvías circulando con paradas; pájaros planeando
- Cuatro horas del día
- Tres perfiles de calidad que escalan densidad de verde, detalle de follaje y
  detalle de calle
- Detalle a nivel de calle: planta baja comercial, toldos, balcones, cordón,
  alcorques, paradas de tranvía, bicicleteros
- WebXR configurado (teleport, giro por pasos, hand tracking)

### ⚠️ Limitación crítica de validación

**Los fps NUNCA se midieron en hardware real.** Todas las mediciones se hicieron
en Chrome headless con SwiftShader, que es render por software y da 0-4 fps
independientemente de lo que haga el código. **Los números de fps que veas en
las herramientas no significan nada.** Los que sí valen son triángulos, draw
calls, cantidad de objetos y tiempo de generación.

El VR está implementado pero **jamás se probó en un visor**.

---

## 7. Qué mejorar, por prioridad

### P1 — Gente caminando ✅ (hecho)

Figuras low-poly articuladas (pelo, ropa, pollera, mochila, rodillas y codos),
cuatro comportamientos (vereda, deambular con pausas, grupos charlando,
bicicleta por la calzada con pedaleo por cinemática inversa), sombra de
contacto y recorte por cámara. ~15 draw calls para toda la multitud. El texto
de abajo queda como registro del plan original.

Es el hueco más grande. La calle tiene locales, toldos, bancos y bicicleteros, y
está **completamente vacía**. Sin gente, una ciudad se lee como una maqueta por
más detalle arquitectónico que tenga.

- Seguir el patrón de `Life.ts`: thin instances con buffer dinámico
  (`thinInstanceSetBuffer(..., false)` + `thinInstanceBufferUpdated`), así 200
  peatones cuestan 1-2 draw calls.
- Una figura humana puede ser 3-4 cajas (torso, cabeza, dos piernas alternando).
  A escala de calle y en movimiento, alcanza.
- Que caminen por las veredas siguiendo la trama de calles, no al azar por el
  terreno. `CityIndex.isSolid()` sirve para mantenerlos fuera de los edificios.
- Variar altura, ritmo de paso y color de ropa. La uniformidad es lo que delata.

### P2 — Bajar el coste de la geometría

596k triángulos en calidad alta es mucho, y **el perfil VR en 266k es justo para
un Quest 2**. Lo que falta es lo más efectivo y todavía no está hecho:

- **Culling por sectores.** Hoy la ciudad entera se envía siempre. Dividir en
  una grilla de sectores y desactivar los que están fuera del frustum o a más de
  N metros bajaría muchísimo. Con thin instances hay que partir la farm en
  varias, una por sector.
- **LOD por distancia** para el follaje (hoy el LOD es por tamaño del árbol, no
  por distancia a la cámara).

### P3 — Medir en hardware real

Nada de lo anterior se puede priorizar bien sin esto.

- Abrir en un navegador con GPU y mirar los fps reales por perfil.
- Probar en un visor. **Ojo: WebXR exige contexto seguro.** Desde el visor,
  `http://192.168.x.x` no alcanza; hay que servir por HTTPS o usar
  `adb reverse tcp:5173 tcp:5173` para que lo vea como `localhost`.

### P4 — Viento en el follaje

Movimiento sutil que cambia mucho la sensación de vida. El desafío técnico: son
thin instances estáticas, así que hay que animar en el **vertex shader** (con un
`MaterialPlugin` de Babylon o un `NodeMaterial`), desplazando los vértices en
función de la altura y del tiempo. Actualizar el buffer de matrices por cuadro
para ~8.000 árboles sería demasiado caro.

### P5 — Ventanas encendidas al atardecer

La paleta ya tiene `PALETTE.glassLit` (`#f6d99a`) preparado y sin usar. Al
cambiar a `dusk`, un porcentaje de las ventanas debería pasar a material emisivo.
Como los materiales están congelados, lo más simple es generar desde el
principio dos conjuntos de instancias de ventana (apagadas y encendidas) y
alternar su visibilidad, en vez de intentar mutar el material.

### P6 — Interiores insinuados

Las vitrinas de planta baja son vidrio oscuro sobre el muro: si te acercás, no
hay nada detrás. Bastaría con una caja oscura poco profunda y dos o tres formas
adentro para que se lea un local, sin modelar un interior real.

### P7 — Audio

No hay nada de sonido. Ambiente urbano suave, pasos que cambian según la
superficie, el tranvía al pasar, pájaros. Babylon tiene audio espacial integrado
vía Web Audio; se puede generar procedimentalmente para no romper la regla de
cero assets.

### P8 — PWA / offline

`vite-plugin-pwa` + service worker para que funcione sin conexión después de la
primera carga. Es además el camino recomendado para VR, porque resuelve el
requisito de HTTPS.

### P9 — Más variedad tipológica

Ocho tipos de manzana empiezan a repetirse. Candidatos coherentes con el
concepto: estación de tranvía, planta de tratamiento de agua, invernaderos de
agricultura urbana, escuela con patio, centro de reparación/reuso.

---

## 8. Cómo verificar cambios

Hay cuatro herramientas en `tools/`. **Usalas: compilar no prueba nada.**

```bash
node tools/shoot.mjs <url> <salida.png>          # captura + métricas + consola
node tools/shoot-block.mjs <url> <png> <tipo>    # encuadra una manzana por tipo
node tools/test-interaction.mjs <url>            # prueba de humo interactiva
node tools/measure.mjs <url>                     # tiempos de carga y red
```

`shoot.mjs` imprime además el **desglose de coste por primitiva/material**
ordenado por triángulos. Es la herramienta para saber QUÉ optimizar en vez de
adivinar: así se descubrió que el follaje se comía el 84 % de la escena.

`test-interaction.mjs` ejercita los caminos reales del usuario (abrir paneles,
hacer clic sobre un edificio, cambiar de modo, caminar) y sale con código 1 si
alguno falla. Un panel puede compilar perfectamente y no abrirse nunca.

**Flujo recomendado para cualquier cambio visual:**
`npm run typecheck` → `node tools/shoot.mjs` → mirar la imagen →
`node tools/test-interaction.mjs`.

---

## 9. Convenciones de código

- Comentarios en español, explicando **por qué** y no qué. El código dice qué.
- TypeScript `strict` con `noUnusedLocals` y `noUnusedParameters`: un import sin
  usar rompe el build.
- `Palette.ts` y `CityLayout.ts` son **datos puros**: no importan nada del
  motor. Se puede cambiar un color o una proporción urbana sin tocar el render.
- Todo lo aleatorio de la GENERACIÓN pasa por `Rng` (mulberry32 con semilla).
  **Nunca usar `Math.random()` al construir la ciudad**: rompe el determinismo y
  la misma semilla dejaría de dar la misma ciudad.
  Única excepción deliberada: `Life.ts` usa `Math.random()` para decidir si un
  tranvía para en una esquina. Eso es comportamiento en tiempo de ejecución, no
  generación — no afecta a la geometría ni a la reproducibilidad de la ciudad, y
  que los tranvías no paren siempre en el mismo lugar es preferible.
- Los materiales se cachean por clave en `Materials`. Crear materiales sueltos
  fuera de esa clase multiplica los draw calls.
