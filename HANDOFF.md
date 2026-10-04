# CIMDIP & Miguel Cané — Recorrido 40 — Traspaso de contexto

> Este documento está escrito para un asistente de IA que va a trabajar sobre
> este código sin haberlo visto antes. Leelo entero antes de tocar nada: hay
> varias decisiones que parecen mejorables y que en realidad ya se probaron y
> fallaron, y están explicadas acá para que no se repitan.
>
> El repositorio se sigue llamando `ciudad-2050` porque empezó como una ciudad
> solarpunk procedural. Hoy es otra cosa (ver 1); quedan nombres de entonces
> (`City`, `CityIndex`, `CityLayout`) que se conservaron para no romper nada.

---

## 1. Qué es el proyecto

Un **juego educativo 3D/VR en la escuela CIMDIP & Miguel Cané** (Laprida y
Miguel Cané), para una muestra escolar. Corre en el navegador, en escritorio y
en visores WebXR (Quest).

- **La escuela es la protagonista.** Planta baja del plano de evacuación
  (medida píxel a píxel), plantas altas y jardín deducidos del recorrido
  virtual de 2020, fachadas, aulas, patios, gimnasio, carteles y mobiliario
  según el video y la web. Alrededor, una sola hilera de manzanas con los
  edificios de la ciudad 2050 (vivienda con terrazas verdes y patio, cívico,
  mercado de madera) y una torre con jardines en altura, más las calles
  necesarias (Laprida, Lafinur, Gral. Acha y dos sin nombre).
- **Está viva.** ~190 alumnos, docentes, familias y personal (100 en VR) con
  uniformes, que cambian de lugar según el momento del día escolar (entrada,
  clase, recreo, acto, salida), abren las puertas al pasar y miran al jugador.
- **Es un juego.** "Recorrido 40": la escuela cumple 40 años y el jugador arma
  el recorrido del aniversario. Prólogo + cinco capítulos, 10 personajes con
  nombre, 6 actividades (robot Educabot, bandeja saludable, reciclaje,
  trivia de trofeos, coreografía, penales), simulacro de evacuación, estrellas
  del jardín, acto final y créditos. 8 sellos del Pasaporte 40, 36 lugares,
  misiones secundarias. Se guarda en `localStorage` (`cimdip-recorrido40-v1`).
- **Interacción con respuesta**: puertas de aulas y oficinas (E o gatillo, y se
  abren solas al acercarse), interruptores de luz de las aulas, 22 carteles
  informativos, computadoras, pizarra, campana, impresora 3D, piano, batería,
  pelota, lockers.
- **Sonido procedural**: ambientes por zona (calle, patio, pasillo, aula,
  gimnasio, comedor, jardín…), pasos según el piso, puertas, campana de bronce,
  voces (síntesis del navegador en español o balbuceo silábico) y música
  generativa suave.

Reglas duras que siguen vigentes:

- **Cero assets externos.** Toda la geometría son primitivas y todas las
  texturas y carteles se dibujan en canvas al arrancar.
- **Determinista.** El barrio sale de una semilla (fija por defecto:
  `cimdip-miguel-cane`; `?seed=` la cambia). La escuela es siempre la misma.
- **Fidelidad antes que decoración.** No inventar ambientes ni elementos que
  contradigan el plano, el video o la web.

---

## 2. Stack y ejecución

| | |
|---|---|
| Motor 3D | **Babylon.js 8** (`@babylonjs/core`) |
| Lenguaje | TypeScript estricto, con `noUnusedLocals`/`noUnusedParameters` |
| Build | Vite |
| Tests | vitest (`npx vitest run`) |
| Herramientas | `puppeteer-core` (sólo dev, usa el Chrome del sistema), `iwer` (Quest 3 emulado) |

```bash
npm install
npm run dev          # http://localhost:5173 (en esta máquina suele estar en 5190)
npx tsc --noEmit
npx eslint src tests --max-warnings=0
npx vitest run
npm run build
```

**Parámetros de URL**

- `?seed=42` — barrio reproducible (número o texto)
- `?quality=low|mobile|vr|balanced|high` — fuerza un perfil de calidad
- `?touch=1|0` — fuerza o apaga el modo celular (para probarlo en la PC con
  el mouse: el mouse maneja los joysticks)
- `?titulo=0|1` — salta o muestra la pantalla de título
- `?libre=1` — abre todas las zonas (sin las cerraduras de la historia)
- `?hud=0|1` — oculta o muestra el HUD y los marcadores
- Con `navigator.webdriver` (puppeteer) el juego entra directo, todo abierto y
  sin HUD, para que las capturas no dependan de la historia. Para probar la
  historia con puppeteer: `?titulo=1&libre=0&hud=1`.
- `?frases=1|0` trae de vuelta (o apaga) diálogos, voces, comentarios y
  entrevistas (ver 75). Sin el parámetro, nadie habla.

**Controles de escritorio**: `WASD` mover, `Shift` correr, `Espacio` saltar,
`E` interactuar (saludar, abrir, usar), `Esc` menú (pasaporte, ajustes,
controles), `F` caminar/volar (volando, `E`/`Q` suben y bajan).

**Controles VR**: stick izquierdo camina (clic: correr), stick derecho gira de
a 30° / teletransporta / paso atrás, gatillo elige con el láser. Panel de
muñeca con el lugar y el objetivo.

**Controles de celular** (pantalla horizontal; ver 56–61): joystick flotante
en la mitad izquierda (analógico), deslizar en la mitad derecha para mirar
(o un segundo joystick, en Ajustes), tocar a una persona u objeto para
usarlo, botones Usar (se enciende con algo a mano), Saltar y Correr; volando,
Subir y Bajar. Arriba: menú, ocultar objetivo y mapa, pantalla completa. Con
`?frases=1`, en un diálogo un toque avanza. Con el teléfono vertical, el juego
pide girarlo.

---

## 3. Arquitectura

```
src/
├── main.ts                 # arma todo y lo conecta (ver "Conexiones" abajo)
├── core/
│   ├── InstanceFarm.ts     # thin instances — el corazón del rendimiento
│   ├── RenderPipeline.ts   # SSAO, bloom, nitidez (POST_SETTINGS)
│   └── QualityManager.ts   # perfiles low / vr / balanced / high + adaptativo
├── world/
│   ├── CityLayout.ts       # el barrio: 5×5, la escuela y su hilera de 10 manzanas
│   ├── City.ts             # orquestador + precompilación de shaders
│   ├── CityIndex.ts        # colisión, pisos, describe()
│   ├── Life.ts             # autos por las calles y pájaros
│   ├── SchoolBase.ts       # primitivas de la escuela (tipos, U/V, item, onLevel)
│   ├── SchoolLayout.ts     # planta baja del plano + colisión + agrega todo
│   ├── SchoolUpper.ts      # plantas altas del edificio principal (del video)
│   ├── SchoolJardin.ts     # jardín de infantes (3 niveles)
│   ├── SchoolDoors.ts      # puertas de aulas/oficinas que se abren (datos)
│   ├── SchoolLights.ts     # interruptores de luz de las aulas (datos)
│   ├── SchoolAtlas.ts      # carteles, murales, plano (UNA textura 2048²)
│   ├── SchoolIdentity.ts   # dónde va cada cartel del atlas
│   ├── Environment.ts      # sol, sombras (static/cascaded), IBL, niebla
│   ├── Sky.ts / TimeOfDay.ts / ProceduralNoise.ts / TexturePainter.ts
│   ├── Textures.ts / Materials.ts / Palette.ts / WindPlugin.ts
│   ├── people/             # la gente de la escuela (ver 36)
│   │   ├── Population.ts   #   render + API (PopulationApi)
│   │   ├── Sim.ts          #   comportamiento sin motor (fases, tareas)
│   │   ├── NavGrid.ts      #   navegación: grilla de 25 cm por piso + escaleras
│   │   ├── Places.ts       #   asientos, pizarrones, puestos del personal
│   │   └── Looks.ts / Rig.ts / Anim.ts / HumanGeometry.ts
│   └── builders/
│       ├── SchoolBuilder.ts        # la escuela en 3D
│       ├── BuildingBuilder.ts      # vivienda con terrazas, cívico, mercado, torre
│       ├── NeighborhoodBuilder.ts  # casas bajas (sin uso: el usuario prefirió la ciudad)
│       ├── InfraBuilder.ts         # suelo, calles, cinturón verde
│       └── NatureBuilder.ts / StreetLevel.ts / PrismBatch.ts
├── game/
│   ├── contracts.ts        # interfaces entre juego, gente, audio y jugador
│   ├── GameDirector.ts     # une historia, mundo, HUD y visor
│   ├── Interaction.ts      # foco por mirada (escritorio) o rayo (VR)
│   ├── audioZones.ts
│   ├── story/              # historia pura: StoryEngine, objetivos, diálogos,
│   │                       # personajes, anclas, cerraduras, guardado
│   ├── activities/         # robot, menú, reciclaje, trivia, danza, penales
│   ├── world/              # GameProps, Doors, Lights, Markers, Screens, ThinSet
│   └── xr/GamePanel3D.ts   # panel del juego dentro del visor
├── audio/                  # Soundscape (AudioApi) + mix, synth, dsp, speech,
│                           # music, schoolAcoustics
├── ui/                     # Hud (DOM), Minimap, draw, input
│   ├── TouchControls.ts    #   celular: joysticks, botones, toques (import dinámico)
│   ├── joystick.ts         #   matemática de los sticks (pura, con tests)
│   └── device.ts           #   modo táctil, gama, resolución, FOV, tope de cuadros
├── player/                 # FlyCamera, PlayerController (caminar/volar),
│                           # VirtualInput (lo que escriben los controles táctiles)
├── vr/                     # XRSetup, XRLocomotion, XRWristPanel,
│                           # XRComfortVignette, XRControllerModels
└── utils/rng.ts            # mulberry32 con semilla
```

### Conexiones (main.ts)

- `buildCity()` arma `City` → `Environment` (foco de sombra en la escuela) →
  post-proceso → congela materiales → `Life` → `Population` →
  `PlayerController` → `GameDirector`. Al cambiar la calidad se reconstruye
  todo y el jugador queda donde estaba.
- El `Hud` se crea UNA vez; cada director nuevo se vuelve a enganchar.
- `playerApi` (`PlayerApi`) es el jugador para el juego, igual en escritorio y
  en VR: `feet()`, `forward()`, `teleport()` (en VR, `XRControls.placeAt`
  diferido al próximo cuadro XR), `setPaused()`.
- 4 veces por segundo: `acousticsAtWorld` → `sound.setZone/setSurface`. El
  director pone el oyente (`setListener` con la mirada) y la fase.
- Ganchos para herramientas: `__scene`, `__schoolFrame`, `__index`, `__xr`,
  `__people()`, `__director()`, `__game` (el director vigente), `__player`,
  `__sound`, `__setShadows`, `__setPost`.

### Flujo de generación

1. `generateCityPlan(seed)` produce un **plano de datos puros**: las manzanas
   del barrio con tipo, posición y lados con frente, más las calles.
2. Los *builders* recorren ese plano y emiten geometría dentro de una única
   `InstanceFarm`.
3. `farm.commit()` sube todo a la GPU en buffers estáticos.
4. `Environment` arma cielo, sol, sombras e IBL.
5. `RenderPipeline` agrega el post-procesado.
6. `City.precompile()` compila shaders con presupuesto de tiempo.
7. Recién entonces se congelan los materiales y se muestra la escena.

**El orden de los pasos 4→7 importa y está explicado en el punto 5.**

### El barrio

`CityLayout` arma una grilla de 5×5 (manzanas de 49 m, paso 64: ver 24 y 90)
con la escuela en el centro (y su anexo al este) y **una hilera de diez manzanas** alrededor con las tipologías de la
ciudad 2050 que levanta `BuildingBuilder`: vivienda perimetral con terrazas y
patio (enfrente del portal y del gimnasio), cívico, mercado de madera y **una
torre de 62–76 m** en la esquina sureste, cruzando Laprida y Gral. Acha. El
reparto está curado en la tabla `RING` (no se sortea); las alturas sí salen de
la semilla (`ringHeight`), con la vivienda acotada a 4–7 pisos para no aplastar
a la escuela. Nada alto al norte (detrás de la escuela): aparecería detrás del
portal en la vista de llegada. Calles con `span` (no cruzan todo) y nombre.
No hay canal (`halfWidth 0`), parques ni energía. Las casas bajas
(`houses`, `NeighborhoodBuilder`) se probaron y el usuario las descartó por
aburridas: no volver a ellas.

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

- **Colisión al caminar** (`isSolid(x, z, feetY)`), con pisos dentro de la
  escuela (`schoolSolidLocal`)
- **Altura del piso** bajo los pies (`groundHeight`), escaleras incluidas
- **Peatones** (`isPedestrianBlocked`) y `describe()` de cada manzana

Si necesitás interacción con el mundo, **extendé `CityIndex` o los datos de
la escuela**; no vuelvas pickables las thin instances. Lo interactivo del
juego son candidatos (posición + radio) que `game/Interaction` elige por
mirada o por rayo.

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

8. **Las texturas van en metros, no en UV** (`MetricUVPlugin` en
   `Materials.ts`). Las UV de una primitiva van de 0 a 1 sin importar su
   tamaño: un muro de 42 m y una caja de 2 m estiraban la misma textura, la
   fachada parecía machimbre y la calle tablones. El plugin mapea cada
   textura desde la posición en el mundo (los cilindros y conos, desde su
   propio tamaño): bloques de 40 × 20 cm y baldosas de 30–40 cm en cualquier
   pieza, continuos de un tramo de muro al siguiente. Excepciones atadas a la
   cara: `FACE_ALIGNED` (los paneles solares, cuya grilla tiene que coincidir
   con el panel). Las variantes `concreteXL`/`timberXL`/`pavementXL` quedaron
   como alias de las de base. **Nada que se mueva puede usar un material
   texturizado de esta biblioteca**: la textura se deslizaría sobre él
   (puertas, gente, autos y objetos del juego tienen materiales propios).

9. **El vidrio es OSCURO (`#28423c`, `#243a49`) con metalicidad alta.**
   Una ventana vista desde afuera de día se ve oscura: el interior está mucho
   menos iluminado que la fachada al sol. Con vidrios claros, las aberturas
   tenían el mismo valor que el muro y los edificios parecían bloques lisos.

10. **El follaje usa icoesferas de subdivisión 1 (20 triángulos) con
    `flat: false`.**
    `CreateSphere({segments: 4})` cuesta **144** triángulos; con ~8.700 copias se
    comía el 84 % de la escena. `flat: false` promedia las normales: con los
    mismos 20 triángulos la copa se lee redonda en vez de facetada.

11. **Follaje: difuso × 0,70 y emisivo 0,70** (`Materials.foliage`).
    El emisivo es un sustituto barato de dispersión subsuperficial. Con la
    luz hemisférica baja del entorno actual, 0,30 y después 0,45 dejaban las
    copas en sombra **negras** (bajo los edificios de enfrente, a contraluz,
    en el patio este): `StandardMaterial` suma el emisivo en espacio gamma,
    antes de pasar a lineal, así que el piso de luz rinde mucho menos de lo
    que sugiere la cuenta. Subir sólo el emisivo las volvía plástico al sol,
    por eso se baja el difuso a la vez: al sol la copa da casi lo mismo
    (≈1,46 × color, antes 1,37). Medido: copa en sombra luminancia 22 → 45;
    árbol al sol en Laprida 55 → 59.

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

22. **`SchoolLayout` es la única fuente de coordenadas de la escuela.** La
    planta baja sale del plano CAD de evacuación (PDF "Planos de
    Evacuación", Colegio CIMDIP "Miguel Cané", planta baja y primer piso),
    registrado con el frente de 67,4 m (26,02 px/m; error medio 0,26–0,29 m
    en los muros seguros). La foto del plano de S&O y el video de 2020 mandan
    sólo en lo que el CAD no tiene o es más viejo: edificio de bloque, Arte,
    Teatro, jardín, Tecnología, galería roja, escalera blanca, pasarela y
    vestíbulo de salida. Muros con sus vanos, ambientes, escaleras,
    equipamiento, zonas de alumnos y estaciones: los usan `SchoolBuilder`,
    `SchoolIdentity` (incluido el plano colgado en el hall), `CityIndex`
    (colisión por grilla de 10 cm), la gente (`people/`), el juego (`game/`)
    y el audio (`schoolAcoustics`). No inventar ambientes que ningún plano
    ni el video muestran. El CAD se registró con 67,4 m de frente, pero el
    edificio real mide ~78 m sobre Laprida (OpenStreetMap): los datos SIGUEN
    en metros del plano y `SchoolLayout` los entrega en metros reales con
    `SC` (ver 90). Todo número de coordenada citado en este documento y en
    los comentarios de los módulos de datos es del PLANO.

23. **Personas: un material, color = vértice × instancia.** Las piezas
    articuladas tienen el origen en su pivote para compartir matriz. Cada
    cuadro se escriben sólo las personas visibles, compactadas, y las mallas
    son `alwaysSelectAsActiveMesh`: su bounding no se puede mantener barato.
    Ver `people/HumanGeometry.ts` y `people/Population.ts` (36).

24. **La escuela ocupa DOS manzanas** (`schoolSite`): la central y la de su
    oeste, sin la calle intermedia (`Street.gaps`). La planta real
    (78 × 47,6 m con su franja de frente, ver 90) no entra en una manzana:
    las manzanas miden 49 m (paso de grilla 64) para que el vértice norte
    quede a 1,35 m de la vereda de Lafinur y la plazoleta al oeste de Miguel
    Cané mida ~12 m sobre Laprida. `CityIndex.blockAt` devuelve
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

27. **La escuela tiene pisos: la colisión y el piso dependen de la altura de
    los pies.** `LEVEL_Y` da la cota de cada nivel (0,12 / 3,42 / 6,72) y
    `levelOf(feetY)` el nivel en el que se está. Muros (`Wall.level`),
    ambientes (`Room.level`) y equipamiento (`Item.level`) llevan su nivel;
    la grilla de ocupación es una por nivel, y en los pisos altos arranca
    llena (aire) y se abren sólo los ambientes de ese nivel. Las escaleras NO
    están en la grilla: cada tramo es una rampa (`stairY`, que pasa por la
    mitad de cada huella) y se resuelve por altura en `schoolSolidLocal`: un
    escalón al alcance del pie se pisa, uno a la altura del cuerpo es pared
    (el costado de un tramo o el hueco visto desde arriba). La multitud
    (`pedestrian`) no usa escaleras. `CityIndex.isSolid/groundHeight` reciben
    `feetY` opcional: sin él responden a nivel de suelo, como antes.

28. **Lo que se pinta está en `SchoolAtlas` / `SchoolArt`, sin motor.** El
    atlas es UNA textura de 2048 × 2048 (un draw call para todos los carteles,
    murales y gráficas) con recorte por alfa para siluetas (el óvalo de PRO
    FOOD). Para revisar un dibujo sin abrir la app: `node
    tools/atlas-preview.mjs salida.png` (empaqueta `SchoolAtlas.ts` con esbuild
    y lo pinta en Chrome sin ventana).

29. **En VR los pies siguen el piso** (`vr/XRLocomotion.ts`): cada cuadro
    se consulta el mismo índice que en escritorio, se ajusta la altura de la
    cámara al piso bajo los pies (escalón, descanso, primer piso) y si un
    movimiento mete los pies en un muro se vuelve a la posición anterior.

30. **La escuela se escribe en seis módulos.** `SchoolBase` tiene las
    primitivas (tipos, líneas `U`/`V` del plano, `seg/hw/vw`, `item`,
    `onLevel`, `SC`, `planU/planV/fromPlan`); `SchoolGround` la planta baja
    del plano (y los agregados `PLAN_*` de los tres niveles); `SchoolUpper`
    las plantas altas y `SchoolJardin` el jardín, los tres en METROS DEL
    PLANO; `SchoolScale` la pasada pura plano → real; `SchoolLayout` la
    fachada en metros REALES (mismos nombres de siempre), la colisión, las
    escaleras y el marco. Los módulos de datos importan SÓLO de `SchoolBase`
    (y `SchoolGround` de los otros dos): si importaran de `SchoolLayout`
    habría un ciclo. Fuera de esos seis, todo importa de `SchoolLayout` y
    nunca coordenadas de los módulos de datos.

31. **La planta alta sale del CAD del primer piso y del plano de planta
    alta anotado a mano.** El CAD da muros, puertas, escaleras y baños; el
    plano a mano da los nombres y cursos (Gerencia, Dirección de secundaria,
    Preceptoría, Pr. Bil, Salón Emociones, Damas y Caballeros, Salón de los
    Espejos del 2º piso) y manda en los tabiques: la fila norte son tres aulas
    parejas (tabiques en u 17,4 y 22,45; el bilingüe es una L que conserva el
    fondo del CAD al oeste del conducto). El plano a mano no sirve al este de
    u ≈ 42 (sus cajas del edificio de bloque caen dentro del gimnasio): ahí
    siguen el video y el CAD; el aula taller es una división de 2º A y el
    salón del 2º piso es el aula de danzas de siempre. El video manda en las
    alturas de los descansos (2,45 / 2,2) y en lo que los planos no dibujan.
    La fila norte del primer piso queda 1,5 m al norte del bloque de planta
    baja (el conducto es un pozo cerrado).

32. **Huecos de losa (`VOIDS`) y volúmenes (`Volume`).** Donde una escalera
    atraviesa un piso, la losa de ese nivel y el cielorraso de abajo se
    recortan (`subtractRects`) y la grilla de colisión de ese nivel lo marca
    macizo SIN margen (si no, el que sube queda trabado en el último
    escalón). Un tramo y su descanso deben tocarse sin hueco: 15 cm sin
    escalón ni descanso entre ellos y los pies "caen" al piso de abajo.
    `Volume.floors` da 1 o 2 plantas altas; `roof: false` deja el volumen
    bajo la bóveda, `shell: false` y `cornice: false` apagan cerramiento y
    cornisa genéricos. Cornisas y pretiles se omiten arista por arista contra
    otro volumen alto o el gimnasio (si no, asoman dentro del piso vecino).

33. **En VR la escuela es más liviana, no distinta.** Con `highDetailStreet`
    apagado, `SchoolBuilder` arma pupitres, sillas, rejas, mallas, barandas,
    cortinas y narices de escalón con menos piezas (`detailed = false`). La
    arquitectura es la misma. Sin esto la planta alta subía el perfil VR de
    152k a 215k triángulos; con esto queda en ~194k.

34. **Contratos en `game/contracts.ts`.** El juego no conoce cómo están
    hechos la gente, el audio ni el jugador: habla con `PopulationApi`,
    `AudioApi` y `PlayerApi`. Así cada parte se prueba sola (los tests del
    juego usan dobles) y `main.ts` es el único que las une.

35. **Las cerraduras de la historia son `setDynamicSolid`.** Una zona cerrada
    (primer piso, jardín…) es un rectángulo macizo en `SchoolLayout` que
    respetan el jugador y la gente. Con `{ playerOnly: true }` sólo frena al
    jugador: es lo que usan las puertas de las aulas, que la gente abre al
    llegar (no las tiene en cuenta al planear su camino).

36. **La gente se mueve por la escuela, no por la ciudad.** `NavGrid` arma una
    grilla de 25 cm por piso desde `schoolSolidLocal(…, true)`; las escaleras
    se derivan de `STAIRS` (no están escritas a mano) y se verifican con la
    misma regla de pisada del jugador. Los puestos del personal y la fila de
    la cantina salen de los ítems del plano: si se mueve un mostrador, la fila
    lo sigue. Culling por distancia, mirada y ambiente; en VR ~790 tris por
    persona (sombra incluida) y unas 20–50 dibujadas.
    - **Sentados:** la altura del asiento sale de `FURNITURE` (0,46 m;
      0,345 en las sillitas del jardín) y los brazos apuntan al pupitre
      medido con el largo de brazo de cada persona. Con 0,48 flotaban sobre
      la silla y los chicos escribían con las manos en la cara.
    - **Pizarrones:** un docente de la multitud cede el pizarrón si un
      personaje con nombre está ahí o va hacia ahí (en aula 4 Laura y un
      docente se superponían). Al aparecer o llegar un personaje con nombre,
      la gente que ocupa su lugar se corre.
    - **Escaleras:** cada pie se apoya en su propio escalón (`Rig` admite
      un piso por pie) y la gente va por su derecha y espera detrás de quien
      sube o baja en el mismo sentido.
    - **Jardín:** las sillitas se reconocen por `KINDER_ROOMS`, no por
      `startsWith('sala')` (que también agarraba la preceptoría `sala` y
      los baños `salaNorte`).

37. **Las puertas y luces de las aulas son del juego, no de la escuela.**
    `SchoolDoors` deriva de los muros las puertas simples y dobles que van de
    un pasillo a un aula u oficina (36 hoy); el constructor NO dibuja su hoja
    (`isInteractiveDoor`) y `game/world/Doors` la dibuja, la anima, la suena
    y la cierra en clase. `SchoolLights` pone un interruptor junto a cada
    puerta de aula; el constructor dibuja sólo el marco de esas luminarias y
    anota su posición (`SchoolBuilder.switchable` → `City.lightFixtures`), y
    `game/world/Lights` enciende o apaga las instancias emisivas. Puertas,
    luces e interruptores son 3 draw calls en total. Las hojas usan PBR con
    la luz del cielo atenuada (como los muros interiores): con un material
    estándar la cara que no mira al sol quedaba casi negra.

38. **Las copas son icoesferas abolladas con normales soldadas.** Con ~800
    copas (no las 8.000 de la ciudad) alcanzan 80 triángulos por copa
    (`blob`) y 320 las grandes (`blobHi`). `lumpy()` en `InstanceFarm`
    deforma con ruido determinista y suelda normales por posición: la
    icoesfera repite vértices en las costuras y sin soldar se ve facetada.
    Reemplaza a la decisión 10. Los pájaros bajaron a icoesferas de 20
    triángulos por pieza para pagarlo.

39. **Las palmeras jóvenes tienen hojas cortas** (`palm` escala la fronda con
    `h / 6`) y `tests/vegetation.test.ts` comprueba que ninguna copa de los
    patios asome dentro de un ambiente techado.

40. **La cámara del título pasa por debajo de las copas.** Va sobre la mano de
    enfrente de Laprida a 2,3 m: más arriba atravesaba los árboles de la
    vereda opuesta y medio título era una copa verde.

41. **La cancha del polideportivo tiene material propio.** El atlas usa un
    `StandardMaterial` que multiplica el emisivo por la textura; bajo la
    bóveda (sin sol directo) el cemento claro quedaba gris oscuro. La cancha
    es otra malla (`schoolIdentityFloor`) con más luz propia, y el piso y los
    muros del gimnasio tienen más rebote (`lift`). Un draw call más, sólo con
    el polideportivo en cuadro.

42. **Las medidas de los edificios del barrio son datos del plano.** El lado
    de la torre (`footprint`), la profundidad de las barras de vivienda
    (`barDepth`) y los puestos del mercado (`stalls`) los sortea
    `CityLayout`, no `BuildingBuilder`: el constructor gasta azar distinto
    según el detalle (escritorio vs. VR) y la misma semilla levantaba otra
    torre en el visor, con la colisión desfasada hasta 2 m. `CityIndex` usa
    esas mismas medidas: la torre bloquea su basamento exacto, la vivienda es
    maciza entera (el patio está cerrado: si fuera transitable, el
    teletransporte y el aterrizaje desde el vuelo dejaban al jugador
    encerrado), y el mercado es una nave abierta: macizos sólo columnas y
    puestos, y el piso es la plataforma de 25 cm.

43. **El teletransporte VR mira un radio de cuerpo**, no un punto: el destino
    y cuatro puntos a 30 cm tienen que estar libres (como la caminata).

44. **Medidas de mobiliario y alturas de cielorraso en un solo lugar**
    (`FURNITURE`, `CEILING_H`, `KINDER_ROOMS`, `ceilingHeight` en
    `SchoolBase.ts`). Las usan el constructor (lo que se dibuja), la gente (a
    qué altura se sienta) y `tests/schoolProps.test.ts` (que las compara con
    un aula real: pupitre 0,74, asiento 0,46, pizarra 0,90–2,10). No
    escribir alturas sueltas en el constructor.

45. **La terminación de un muro cambia donde cambia el ambiente**, nunca
    según el ambiente del punto medio del muro. Con el punto medio, el muro
    de la recepción del jardín salía entero amarillo (Sala Amarilla), también
    del lado que da a la galería verde.

46. **Sobre una puerta con marco, el muro arranca 8 cm por encima del vano.**
    Arrancando en el mismo plano que la cabeza del marco, las dos caras
    titilaban (z-fighting). Lo mismo para la guarda roja que termina en un
    vano y para la tapa del mostrador de recepción. Regla general: dos
    cajas nunca comparten una cara visible; una sobresale o se corre.

47. **Cantidad de escalones por la regla del paso cómodo** (`riserCount` en
    `SchoolLayout.ts`: contrahuella 14–19 cm y 2 contrahuellas + 1 huella
    ≈ 63 cm). La usan el constructor y la rampa de los pies (`stairY`):
    si sólo cambia uno, los pies no pisan los escalones dibujados.

48. **`tests/schoolProps.test.ts` es el QA de la escuela.** Modela cada ítem
    con las cajas que dibuja el constructor y falla si algo atraviesa un muro
    u otro objeto, flota, queda enterrado, sale de su ambiente, tapa una
    puerta o su barrido, cuelga de un muro que ahí es ventana, o si una
    escalera, puerta, ventana o mueble sale de la escala humana. En su primera
    corrida encontró ~200 problemas reales: se arreglan los datos, no se
    afloja el test.

49. **El relieve va en el detail map, nunca en el slot de normal map.** Cada
    textura pintada genera también su altura, y de ahí un normal map y un
    mapa de rugosidad (juntas y poros apenas más mates) que se cargan como
    `detailMap` de Babylon. En el slot de normal map, la pasada de SSAO
    pintaba manchas negras grandes en los muros (se verificó apagando cada
    cosa por separado). En escritorio el relieve va en todo; en VR y "baja",
    sólo en pisos, bloque, ladrillo, chapa y cortinas.

50. **Los espejos fingen un ambiente** (`Materials.mirror` + `MirrorPlugin`):
    piso oscuro abajo, muros con ventanas claras y puertas oscuras, techo con
    luces, que se corre al moverse. No es un reflejo real y no muestra gente:
    un espejo de verdad costaría una pasada entera de la escena por cuadro.

51. **Variación de tono y rugosidad a gran escala (6–12 m) en el shader**, en
    todos los perfiles: rompe la repetición de pisos y muros grandes sin
    texturas más grandes. En escritorio los pisos suman una textura grande
    con marcas de uso. Todo sutil: realismo, no abandono.

52. **El 65 % de la luz de los interiores era un brillo parejo** (el `lift`
    de `Materials.interior`): por eso las aulas se veían lechosas y apagar
    el sol y el cielo casi no cambiaba nada. Ahora un **mapa de luz
    natural** por piso (10 cm, calculado una vez al cargar desde las
    ventanas y puertas reales del plano, 150–300 ms) escala ese brillo y la
    luz del cielo en el shader: más claro junto a las ventanas, más oscuro al
    fondo y en los rincones, el piso más oscuro debajo de mesas, pupitres y
    escaleras (sombra de contacto que también funciona en VR), y una base
    para los ambientes sin ventanas que hace de luz artificial. Alcanza a los
    materiales de la escuela, puertas e interruptores del juego y la gente.
    **Necesita `environment.setSchool(city.schoolFrame)` en `main.ts`**: sin
    esa línea el mapa y la adaptación de la exposición quedan apagados.

53. **El sol de la mañana sale a 2,98 rad (≈ 9° al sur del este)**, no a 24°.
    Con la torre del barrio, a las 8:15 (la hora de llegada) la fachada de
    Laprida quedaba en la sombra de la torre; se comprobó aislando los
    proyectores de sombra. 9° es además, aproximadamente, la posición real
    del sol a esa hora en Buenos Aires en primavera. La cámara de la sombra
    estática se ubica por encima del edificio más alto: si no, la torre de
    66 m se recortaba.

54. **Cámara humana**: ojos a 1,62 m (el controlador y `EYE` de `main.ts`
    tienen que coincidir, o cada teletransporte cae 6 cm), campo vertical de
    56° y plano cercano a 0,10 m. La colisión deja los ojos a ≥ 0,2 m de los
    muros, así que el borde del cuadro nunca muestra a través de una jamba.
    Exposición y contraste más bajos en todas las horas (cámara, no cine) y
    adaptación lenta de la exposición al entrar (hasta ×1,3).

55. **SSAO de contacto, de radio corto y con desenfoque que respeta bordes**
    también en 'balanced': el desenfoque barato dejaba manchas grises a lo
    largo de las aristas muro/cielorraso. Desde el nivel adaptativo 2 el SSAO
    se quita: sin desenfoque, 8 muestras eran grano negro aun con 0,6 de
    intensidad (sobre la gente y los muebles).

56. **El modo celular lo decide el puntero PRINCIPAL** (`ui/device.ts`,
    `(pointer: coarse)` + puntos táctiles), no el agente: una notebook con
    pantalla táctil sigue siendo de mouse, un iPad que se presenta como Mac
    es táctil, y los visores quedan afuera. Todo lo del celular cuelga de
    `touchMode` en `main.ts`; sin él, escritorio y VR no cambian en nada
    (`tools/test-mobile.mjs` lo comprueba al final).

57. **Los controles táctiles escriben en `VirtualInput`, no mueven la cámara
    por su cuenta.** `PlayerController` suma el joystick al teclado: colisión
    por ejes, escaleras, gravedad y pisadas son el mismo código. La entrada
    táctil propia de Babylon (`FreeCameraTouchInput`) se quita: arrastrar
    hacia arriba hacía avanzar la cámara salteando la colisión.

58. **Perfil 'Móvil' = el del visor con menos sombra y gente, SIN
    post-proceso.** El mapeo tonal va en los materiales (colores ya
    verificados en VR) y el antialiasing es el MSAA del búfer de pantalla,
    casi gratis en una GPU por mosaicos. La resolución sale de la gama del
    equipo y un techo de píxeles por cuadro (`mobileRenderScale`), no de la
    densidad de la pantalla: a densidad 3 nativa, un teléfono dibujaría 9
    veces los píxeles del escritorio. Un equipo de entrada arranca un escalón
    abajo en la calidad adaptativa.

59. **Tope de cuadros parejo** (`evenCap`): divisor exacto de la frecuencia
    MEDIDA de la pantalla (60 en 120 Hz, 45 en 90 Hz). Un tope de 60 en 90 Hz
    alterna cuadros de 11 y 22 ms y se ve a saltos (se midió el mismo efecto
    en Chrome headless a 75 Hz). Usa `engine.maxFPS`, que saltea el cuadro
    entero: el `dt` que ven jugador y animaciones es el real. 30 con menú,
    título o ahorro de batería; 10 con el teléfono vertical; sin tope en XR.

60. **Calidad adaptativa: sano es sostener el objetivo, no superarlo**
    (fps ≥ 0,96 × objetivo: 60 en escritorio, el tope en celular, 72 en el
    visor). Con la regla vieja (objetivo + 10) una pantalla de 60 Hz o el
    visor nunca recuperaban un escalón perdido en el arranque. Un cuadro de
    más de 250 ms es un tirón en todos los modos (salvo que sean ≥ 40 % de la
    ventana). `QualityManager.settle()` no mide 6 s tras el arranque, al
    reconstruir (`settle(Infinity)` mientras dura) y al entrar o salir del
    visor. Recuperar exige 8 s sanos (15 s con tope) por un factor que se
    duplica (hasta ×8) si una bajada llega menos de 15 s después de
    recuperar: no oscila.

61. **El aviso de interacción no atrapa el dedo en el celular**
    (`pointer-events: none`): un pulgar que arranca encima tiene que mover el
    joystick. Tocarlo igual usa (TouchControls mira si el toque cayó sobre
    él). La pantalla completa y el bloqueo horizontal se piden al
    LEVANTAR el dedo (con toque, `pointerdown` no cuenta como gesto).

62. **En el visor nada traba la caminata ni exige puntería** (reportado con
    el Quest puesto: "no puedo caminar y es raro interactuar con los profes"):
    - Al entrar al visor desde el título se juega directo (`startInXR`):
      antes aparecía un menú que había que apuntar con el láser, y la
      caminata quedaba desactivada mientras estuviera abierto.
    - Con un diálogo, cartel o actividad abiertos se puede caminar; sólo se
      frena en las escenas guionadas (`modal === 'cutscene'`).
    - Los botones se leen del gamepad crudo en los dos controles
      (`pollXRButtons`, mapeo xr-standard: 0 gatillo, 4 A/X, 5 B/Y), sin
      depender del puntero de Babylon. Gatillo: elige lo que apunta ese
      control. A/X: sin frases, saluda a quien está señalado (aplica su
      charla en silencio); con `?frases=1`, sigue el diálogo, elige la
      primera opción si no se apunta a ninguna o habla con quien está
      señalado. B/Y: cierra carteles. Con
      una sola opción (Continuar, Cerrar) cualquier botón la elige.
      `GamePanel3D` tiene antirrebote de 300 ms: el gatillo llega también por
      el puntero de Babylon en el mismo cuadro.
    - Para señalar a alguien alcanza con mirarlo de cerca (la mirada es el
      respaldo si ningún control apunta a nada), y el rayo acepta cualquier
      parte del cuerpo, de la cadera a la cabeza.
    - El giro por pasos de 30° lo hace `XRLocomotion` leyendo el gamepad
      crudo del control derecho (el de Babylon queda en 0 grados): dependía
      de que el perfil del navegador expusiera el stick.
    - En el emulador IWER la cámara no respeta el espacio de referencia
      desplazado: la caminata calcula la velocidad (`__xr().motion` = 1) y
      escribe la posición, pero el emulador la pisa. En el visor real ese
      mecanismo es el mismo de la teletransportación de Babylon.
      `tools/test-vr.mjs` prueba el resto con botones emulados (arranque sin
      menú, caminata habilitada, la A sobre Rubén abre el portal sin panel
      con líneas ni voz).

63. **El SSAO va último en la cadena de post-proceso.** Cambiar
    samples/FXAA/bloom/nitidez del `DefaultRenderingPipeline` lo reconstruye y
    lo engancha al final, detrás del SSAO: la escena pasaba a dibujarse en la
    primera pasada del SSAO (8 bits, sin MSAA), sin disco solar ni bloom, por
    el resto de la sesión. `RenderPipeline.setAdaptiveLevel` aplica primero
    esos setters y después reengancha el SSAO para que quede último, como al
    arrancar.

64. **Las sombras usan `forceBackFacesOnly`** (`Environment.enableShadows`):
    sin esto la fachada de Laprida al sol tenía rayas verticales (mapa
    estático del visor y cascadas) y las copas, puntitos. Todo proyector debe
    ser cerrado o tener un cielorraso con cara inferior debajo: una losa
    abierta sin cielorraso dejaría pasar el sol.

65. **Mapa de luz natural: la altura sobre el piso del nivel se topa en 0**
    (`max(p.y − piso, 0)`). La vereda y los patios están por debajo de la
    planta baja: con h negativo la oclusión de contacto los oscurecía hasta
    ×0,56 (sol incluido) en una franja recta hasta el borde de la grilla.
    Disco solar de tamaño casi real (smoothstep 0,999965–0,99999, brillo ×8).

66. **Gente (decisiones del QA de personajes):** `NavGrid` barre los cierres
    dinámicos (`sweepDynamic`, ~300 celdas por cuadro), mantiene la marca
    mientras el cierre exista y suma una celda de margen. En una escalera la
    gente espera según su avance sobre el tramo compartido, no por geometría
    (el descanso en U ya no se amontona). Sentados dibujan `smockSit` o
    `torso` en vez del guardapolvo rígido. `Population.forEachPerson` (las
    puertas) informa sólo a quien camina: un alumno sentado junto a la puerta
    ya no la deja abierta toda la clase. Las maestras del jardín se paran
    entre las mesas (`teacherSpot`): las salas no tienen pizarrón. `deskArm`
    resuelve el codo exacto hasta la punta de los dedos y `lapArm` apoya las
    manos en los muslos.

67. **Mapa de luz natural en escaleras y aulas apagadas.** `bakeSchoolDaylight`
    guarda en `slab()` el piso sobre el que apoya cada tramo y descanso
    (`baseOf(y0)`) y nunca cubre un piso más bajo: sin esto los tramos del
    primer piso manchaban el piso del salón de los espejos (1,2 × 1,7 m
    oscuros). Los interruptores bajan la luz de verdad: `Lights` avisa por
    `onChange(roomId, on)` → `GameDirector` (`onRoomLights`) → `main.ts` →
    `Environment.setRoomLights`, que reescribe las celdas del aula con su
    valor sin lámparas (`DAYLIGHT.lightsOff` 0,55) y sube la textura una sola
    vez, en el cuadro siguiente. Los cambios de fase (recreo, acto, salida)
    apagan igual las aulas vacías. Amplía los ítems 37 y 52.

68. **Visor y celular tienen su propia gradación de imagen.** Sin post-proceso
    la imagen se veía lavada: `Environment.setInMaterialGrade(profile.post ===
    'off')` aplica `HEADSET_GRADE` (exposición ×1,05, contraste +0,08,
    saturación 17 / 12 en sombras, halo del sol ×1,6 en lugar del bloom); el
    escritorio sigue con `SCREEN_GRADE`. Mañana: horizonte (= color de la
    niebla) celeste pálido, no gris, y `fogThickness` 1,0, el mínimo que
    todavía tapa el borde del suelo (la niebla debe seguir ≥ 94 % en
    `fogReach`); más fina exige agrandar el suelo.

69. **Gente del barrio: simulación aparte y barata** (`people/Sidewalks.ts`,
    sin Babylon, con su propio generador aleatorio: la multitud de la escuela
    no cambia). Caminan por un carril por sentido (1,45 y 2,4 m desde la línea
    de edificación), cruzan sólo por las sendas peatonales y, en las esquinas
    con semáforo, sólo con rojo para los autos de esa calle
    (`Population.setCrossingGate`; sin conectar, `Sidewalks.mayCross` copia el
    ciclo de `SIGNAL`). Usan las mismas mallas de cuerpo: no suman llamadas
    de dibujo si se ve a alguien de la escuela. Tope 16 dibujados en el visor
    (40 en escritorio) con distancia de dibujo que se ajusta sola; la vereda
    de Laprida de la escuela sigue siendo de `PeopleSim`. Dos ahorros de
    dibujo pagan casi todo: la gente de los patios no se dibuja desde la
    calle más allá de 14 m en el visor (26 m en escritorio; está detrás de
    muros) y más allá de 12 m sólo se dibuja dentro de ±65° de la mirada
    (`CONE_FAR` 0,42).

70. **Puertas del juego: las hojas pisan 5 mm el marco y el dintel**
    (`SchoolDoors`: bisagra en `face(0.065)`, ancho `len2 − 0.13`, alto
    −0,025). No volver a 0,08 / 0,16: queda una rendija de 1 cm por la que se
    ve el otro lado. Las dos hojas de una puerta doble no se superponen entre
    sí (coplanares, titilan). Una hoja simple pasa la bisagra al otro lado si
    al abrirse atravesaría un muro, y `SchoolLights` pone la llave del lado
    del picaporte. Material `game-doors`: recibe sombra, emisivo 0, entorno
    `INTERIOR_ENV × 2,2`, vidrio `#4f6470`.

71. **Peatones y autos comparten los cruces** (`wireCrossings` en `main.ts`,
    se rearma en cada `buildCity` y se suelta antes de desarmar). La gente
    del barrio cruza según `TrafficSim.pedestrianGo`: rojo para los autos de
    esa calle y más de 4 s de verde por delante en la otra, igual que el
    semáforo peatonal; nunca con un reloj propio. En las esquinas sin
    semáforo los autos frenan ante una senda ocupada (`setZebraBusy`); en las
    que tienen semáforo siguen la luz y, al doblar, `setPedestrianQuery`. Los
    autos paran a `CROSS_AT` + `ZEBRA_HALF` (1,3) + 0,6 m del centro de la
    esquina: si cambia la posición o el ancho de la senda en `InfraBuilder`,
    actualizar `traffic.ts`.

72. **Árboles porteños y viento** (`NatureBuilder`, `WindPlugin`). La especie
    (plátano, fresno, tipa, jacarandá, palo borracho) sale de la posición del
    árbol y `broadleaf()` llama a `legacyDraws()` para sacar del generador
    compartido los mismos números que antes (ítem 42): no quitarlo ni cambiar
    cuántos saca. El viento busca la sombra en la posición de reposo (lo
    inyectado después de `vPositionW=vec3(worldPos);`): el mapa de sombras se
    dibuja sin viento y sin esto las copas se llenaban de manchas que
    caminaban. El segundo color del follaje está acotado y los árboles en
    flor tienen huecos menos profundos (0,35); el emisivo del follaje se suma
    en gamma, y más fuerte deja las copas "atigradas". Nubes: umbral
    `1 − cloudCover·1,12` (con 0,95 el cielo quedaba vacío). `GLASS_ENV` 2 es
    absoluto y sólo para el vidrio de fachada (alfa ≥ 0,5); el de las aulas
    sigue con el valor de la escena.

73. **Calles: una sola fuente para medidas y bancos** (`CityLayout`).
    `LANE_FRAC` 0,42, `RAMP_LEN` 1,3, `CROSS_AT` 6,2 y `KERB_W` 0,32 las usan
    `InfraBuilder`, la gente y el tránsito: nada de copias locales.
    `plan.benches` es la única lista de bancos (`kind` 'sidewalk', 'plaza' o
    'stop'; el que se sienta mira hacia (sin rotY, cos rotY)), con su propio
    generador (`seed ^ 0x0be4c5`) para no correr nada más de la ciudad;
    `InfraBuilder.streetscape` y `BuildingBuilder.civicFront` siguen sacando
    los mismos números de antes (ítem 42). Suelo: una losa de
    (extensión + `GROUND_MARGIN` 640) × 2 centrada en el barrio y
    `fogReach` = extensión + 360: el borde queda a ≥ 98 % de niebla desde
    cualquier punto. No achicar la losa sin volver a espesar la niebla.
    `DistantCity` dibuja toda la capa 2 también en el visor y una capa 3 de
    unas 100 cajas pálidas entre 380 y 640 m (generador `seed ^ 0x5c71e3`,
    sin llamadas extra): con la niebla más fina se veía una franja de pasto
    vacía en el horizonte. En el visor, vidrieras, vidrios de puertas y
    balcones son un solo plano, zócalos, barandas y sogas de ropa son paneles
    de color, las celosías van a la mitad y no hay parteluces (8–10 mil
    triángulos menos por vista).

74. **Gente del barrio, segunda pasada** (`people/Sidewalks.ts`). Esquivan al
    jugador sólo a menos de 3 m: pasan a 0,95 m, nunca a menos de 0,6 m de la
    fachada (las exhibiciones llegan a 0,93) ni a más de 2,6 m (troncos a
    3,03); si no hay lugar, esperan en vez de atravesarlo. Las parejas se
    ponen en fila (`singleT`, el otro 0,8 m atrás) cuando viene alguien de
    frente a menos de 5 m, al lado de algo parado o de un banco y al
    esquivar al jugador; quien camina detrás usa la posición real del
    segundo. Los bancos los ocupan los últimos en crearse (no corren el
    generador de los demás) y sólo los 'sidewalk' y 'plaza'; los 'stop' son
    de la parada. En el visor, celular y calidad baja el material de la gente
    lleva un borde de luz (`emissiveFresnelParameters`): a contraluz del sol
    de la mañana se veían casi negros. No subir el emisivo plano (0,46) en
    escritorio: ahí el post-proceso ya levanta las sombras.

75. **El juego no tiene frases por defecto** (lo pidió el usuario: "No quiero
    que nadie me hable, así que sacá todas las frases; capaz más adelante
    agregamos"). Un solo interruptor: `FRASES` en `src/game/story/phrases.ts`
    (false) y `?frases=1` (`?frases=0` fuerza el modo callado). Sin frases:
    ni diálogos (HUD ni panel del visor), ni voces (`audio.voice` no se
    llama; el código de audio no cambió), ni `#bark`, ni avisos del visor con
    frases, ni respuestas al pasar, ni la explicación de la campana, ni el
    discurso en el acto o los créditos, ni citas dentro de las actividades.
    Lola tampoco comenta por su cuenta, con o sin frases ("¡Llegaste!",
    "¡Recreo!", comentarios de lugares y avisos de las reglas se borraron).
    A la gente se la **saluda** (`GameDirector.greet` →
    `StoryEngine.silentTalk`): se recorre en silencio la charla pendiente
    eligiendo `DialogueRunner.silentPick` (la primera opción, salvo que lleve
    a una entrevista) y se aplican todos sus efectos; el personaje contesta
    con un gesto y suena un clic. Las entrevistas son frases: `s.voces` y la
    insignia Cronista sólo existen con frases. Textos sin frases:
    `silentTitle` (objetivos), `silentReason` (cerraduras), `silentNotReady`
    (objetos), `.phrases-only` / `.silent-only` en `index.html`
    (`Hud.setPhrases` pone `html.phrases`). Sin frases nadie gesticula
    hablando (`stationAnim`: "talk" → "idle"). Todo el texto sigue en el
    código: no volver a mostrar texto de personajes ni pedir voces sin pasar
    por `SESSION.phrases`.

76. **El plano lejano nunca corta antes de que cierre la niebla.**
    `QualityManager.setFogReach` (lo llama `main.ts` al crear el
    `Environment`) pone un piso a `camera.maxZ` de `fogReach ×
    FAR_FLOOR_FACTOR` (1,09, niebla al 97 %), y `Environment.trackFarPlane`
    espesa la niebla si alguna cámara corta antes de `fogReach / 0,92`.
    Cortar antes no ahorraba dibujo (una losa de suelo y la ciudad lejana en
    `TintFarm`) y en calidad baja o celular, en el nivel adaptativo 3 (348 m,
    niebla al 76 %), dejaba una banda bajo el horizonte con el horizonte de
    edificios flotando. En `Sky` la mezcla hacia el color del suelo empieza
    en h = −0,1 (`smoothstep(-0.1, -0.35, h)`): la franja justo bajo el
    horizonte sigue del color de la niebla, porque volando alto se ve por
    debajo del suelo cortado. Multitud del visor: `crowdSize` 110 (con 90 el
    portón a la hora de entrada, la primera vista con el visor, se veía
    vacío); unos 735 triángulos por persona dibujada, sin llamadas extra.

77. **Más gente en las veredas del visor sin pasar el tope.** En el visor,
    50 caminantes (`crowdSize × 0,55`) y 5 grupos charlando, dibujados hasta
    80 m (escritorio 90) con el tope de 16 (escritorio 40). Si hay más
    candidatos que el tope se dibujan los MÁS CERCANOS, nunca los primeros
    de la lista (alguien en un banco cercano titilaba). "Burbuja"
    (`SidewalkOptions.bubble`: 90 en el visor, 100 en escritorio; no bajarla
    de la distancia de dibujo + 10): un caminante por cuadro; si está fuera
    de la burbuja y nadie lo vio (ni a su pareja) durante 1 s, reaparece
    adelante, justo pasando la distancia de dibujo y dentro de ±40° de la
    mirada (casi siempre caminando hacia la cámara), o a más de 80° de la
    mirada a un tercio o dos tercios de la burbuja. Nunca volando (cámara a
    más de 14 m). La gente de la escuela elige el detalle por distancia 3D.

78. **Negocios: medidas y azar por local** (`StreetLevel`). Un plano girado
    con `yaw` (piso y techo del local, línea de luz, mesa de exhibición, piso
    del hall) siempre recibe (a lo largo de la fachada, fondo): no cambiar
    los lados en las caras este y oeste; el giro ya lo hace `yaw = PI/2` y
    cambiarlos otra vez sacaba los paneles 0,7 m sobre la vereda. Cada local
    usa su propio generador (`deco(px(t), pz(t), 13)`), no uno por cara:
    cuántos números saca cada local depende del detalle, y uno compartido
    hacía que visor y escritorio armaran negocios distintos (ítem 42).
    `DistantCity` también usa un generador por edificio. `plan.cafeTables`
    lo llena `StreetLevel` al armar los locales (`InfraBuilder.ground` le
    pasa el arreglo del plan) antes de crear la gente, y cada perfil publica
    las suyas. En el visor, las fachadas de la primera fila del fondo tienen
    bandas de ventanas partidas y bordes de losa hasta el piso 3, y el
    horizonte lejano son dos paneles por edificio: no volverlos cajas sin
    pagarlo en otro lado.

79. **Tránsito: sendas libres y jugador sólido.** En las esquinas sin semáforo
    cada carril espera con la trompa detrás de la senda (`stopBack` =
    `CROSS_AT` + `ZEBRA_HALF` + 0,25 − `endFrom`): con 0 los autos frenaban
    sobre la senda y la gente los atravesaba. La distancia al de adelante se
    mide en su camino nuevo si cambió de camino en el mismo paso (antes el
    de atrás frenaba de 8 m/s a 0 en un cuadro). El jugador parado en la
    calzada es un obstáculo (`PLAYER_CLEAR` 0,7, ojos a menos de 3 m del
    asfalto): sin esto los autos lo atravesaban y desde adentro no se veía
    nada (caras traseras descartadas). `pedestrianGo` también frena el cruce
    mientras haya un vehículo sobre la senda o que no llegue a frenar
    (`vehicleOnZebra`), con o sin semáforo; los que doblan con verde ceden
    a quien cruza la senda de salida. Vidrios de vehículos `#3a4853` con
    franja de cielo en el colectivo: no volver a `#1d252c` (agujeros negros).

80. **Copas vistas desde abajo: relleno de cielo y transparencia de las
    hojas** (`WindPlugin`, `CUSTOM_FRAGMENT_BEFORE_FOG`). Las caras que no
    miran hacia arriba reciben ~0,04 de luz de cielo y las que miran hacia
    abajo hasta ~0,125 de verde amarillento traslúcido: el TONO de la hoja
    con brillo fijo (no proporcional al color), un poco más en especies
    oscuras, teñido con `scene.fogColor` para seguir la hora y sólo 35 % con
    el dibujo de racimos. Sin esto la copa vista desde abajo medía luminancia
    25–35 en el visor contra un cielo de 150. No escalarlo con el albedo
    (las claras quedan lima y las oscuras esmeralda) ni sumarlo a las caras
    que miran hacia arriba (es el "plástico pálido" del ítem 11).

81. **Escaleras con los planos.** Torre del hall: el descanso está partido,
    macizo al oeste (u 32,48–33,85) y hueco al este con el cuartito del CAD
    debajo; su puerta está cerrada para la gente (`NavGrid.closedForCrowd`:
    es un depósito sin salida). Las dos aberturas "de paso" de 2,45 m de la
    torre (`HIGH_SILLS`) son sólidas a nivel de planta baja en
    `schoolSolidLocal` mientras los pies estén más abajo que el umbral; la
    grilla por nivel ignora los umbrales, así que no confiar sólo en ella
    para aberturas que arrancan en un descanso. Escalera oeste: el tramo 7 va
    de u 7,15 a 10,15 (12 contrahuellas en 2,2 m piden 3 m) y el muro oeste
    del hueco en u 5,5 llega a altura completa: sin él se caía del descanso
    a un recoveco cerrado de 2,2 m sin salida. Por la altura libre: muro
    oeste de Preceptoría en u 8,9 y borde sur del hueco del hall en −10,4.

82. **La escuela tiene su propio generador** (`seed ^ 0x5c4001a7`) y su
    propio `NatureBuilder`, creados en `City.ts` e iguales en escritorio y
    visor: tocar la escuela ya no reordena los árboles y balcones del barrio
    (la pasada de los planos sumaba ~52 copas y ~4 mil triángulos por vista
    sólo por eso), y se fue una de las diferencias entre escritorio y visor
    (la escuela sacaba distinta cantidad de números según el perfil).

83. **Portón y detalle barato.** Pilares, columnas y la reja de altura
    completa del portal son constantes de colisión (`PORTAL_PILLARS`,
    `PORTAL_COLUMNS`, `PORTAL_RAILS`) que también dibuja el builder; no están
    en `FENCES` porque `FENCES` se dibuja como cerco de muro rojo. En el
    visor las rejas de Laprida y Miguel Cané y la del portal dibujan una
    barra de cada dos (amplía 33). Primitiva `post` de `InstanceFarm`: caja
    sin cara inferior (10 triángulos), sólo donde esa cara nunca se ve (patas
    y parantes de sillas, unas 1.450 instancias). El muro medianero de planta
    baja bajo las aulas del primer piso mide 3,3 m (con 3,6 titilaba contra
    sus caras) y las salas de `SOFFIT_ROOMS` tienen un cielorraso de losa
    1 cm bajo su piso.

84. **Puertas y planos.** `SchoolDoors` pasa una hoja simple a la otra jamba
    también si al abrirse cruzaría la hoja abierta de otra puerta (la
    portería: puerta del porche y del vestíbulo en esquina); `doors.test`
    controla hoja contra hoja y punta contra muro (amplía 70). Desvíos del
    CAD a propósito, dentro de su error de ~0,26 m: puertas de los boxes de
    baño y del cuartito de 0,85 m (CAD 0,70–0,77) y la de Tecnología 10 cm
    al este, para que la hoja no entre en el muro de Miguel Cané.

85. **Juego y gente con la planta nueva.** `DOOR_LOCKS` (`story/world.ts`)
    son puertas del juego que la historia tiene con llave: hoy la puerta de
    la portería al porche hasta que se abre la entrada; no está en `LOCKS`
    porque ahí dibujaría una segunda hoja. Esa puerta está cerrada para la
    gente en todas las fases (`NavGrid.closedForCrowd`): abierta, la oficina
    era una segunda entrada y la atravesaban aun con llave. Con la entrada
    vidriada cerrada por la historia, la gente de afuera no busca camino
    (una búsqueda imposible recorre toda la vereda): espera, a la que no se
    ve se la ubica adentro y la que se ve reintenta una vez por apertura
    (`gateEpoch`, `NavGrid.forgetDynamic`); sin esto, después de Rubén
    quedaban congeladas en el portón. La grilla estática se arma con los
    sólidos dinámicos del momento: `Population` tiene que crearse antes que
    `GameDirector` (y `dispose` limpia las cerraduras antes de reconstruir).
    Barreras de escalera: cubren todo lo que se alcanza desde el costado
    (contrahuellas + 0,45 m + 0,25), no 0,5 m fijos. Un objetivo de llegar a
    un lugar que se habilita estando adentro se cumple en el acto.
    `Places.porter` sale de la abertura del mostrador; `treadFloor` usa
    `riserCount`; los destinos al pasear evitan a los personajes con nombre
    (0,9 m). Estaciones: Rubén en el porche al costado de la columna del
    medio, Graciela detrás del mostrador, Martín en la puerta de
    Preceptoría, Inés en Recepción (la Dirección de primaria del CAD mide
    4,5 × 1,9 m y la hoja de su puerta la tapaba). En el visor, la gente de
    los patios tampoco se dibuja desde la franja del frente y el atrio, ni
    los peatones que tapa la escuela (`people/Culling.ts`,
    `hiddenBySchool`); en el portón se dibujan como mucho los 60 más
    cercanos (los personajes con nombre siempre).

86. **No hay ciudad de fondo** (lo pidió el usuario: "es innecesario tantos
    edificios"). Sólo la escuela y su anillo de 8 manzanas: `plan.backdrop`
    queda vacío, se borró `DistantCity` (capas 1–3 del horizonte) y el
    cinturón de árboles de afuera. Lo que dicen los ítems 73 y 76 sobre la
    ciudad lejana ya no aplica; la losa de suelo y la niebla siguen igual.

87. **El borde del mapa es una obra** (`PeripheryBuilder`, datos en
    `CityLayout` con generador propio): valla de obra continua de ~2,6 m del
    otro lado de las calles perimetrales, un portón por lado con barrera,
    carteles ACCESO RESTRINGIDO / PELIGRO OBRA (vía `SignAtlas`), conos, dos
    edificios en construcción con andamio y red, una grúa torre y una
    excavadora. Todo lo que queda del lado de afuera de la valla es sólido en
    `CityIndex` (caminando, volando y con teletransporte): no volver a dejar
    pasto transitable más allá.

88. **Puertas del CAD y detalles del video (segunda revisión).** Primer piso
    sobre Laprida: puertas dobles de 1,9 m (4° AC a la Gerencia 3,1–5,0; S2
    8,6–10,5; S3 12,5–14,3; S4 21,5–23,4; S5 24,45–26,35, 25 cm al este del
    CAD para no cortar el tabique de 24,3) con sus paños vidriados del CAD.
    Fila norte: doble bilingüe→vértice 17,15–18,95, baños 21,45–22,35 (box al
    oeste, mesada contra el conducto), 4° A→fondo 28,9–30,05. Planta baja:
    Preceptoría, Sala de profesores y ADM con vanos de 1,31 m del CAD como
    puertas **dobles** (`schoolProps` no admite hojas simples de más de
    1,2 m). Fondo del pasillo de los trofeos: puerta al este y ventanilla al
    oeste (4:36), escritorio de la PR detrás de la ventanilla, estante de
    trofeos de 1,3 m, sillones crema. Video: aula 4 blanca con cortinas
    celestes; 6° BD/6° AC voile lila con cenefa roja y la U de 6° BD contra
    oeste/sur/este con las sillas del lado del muro (la U abre a la pizarra
    norte: así se ve en 4:42–4:54); Dirección de secundaria con cortinas
    corridas (`drawn`); guardas de metal desplegado (`Stair.meshGuard`,
    `Item.mesh`) en la escalera del hall, la cabecera de la oeste en el P1 y
    la escalera blanca del comedor (blanca); barrotes horizontales oscuros
    en la galería roja; piso beige en el pasillo de lockers (`floor: 'ceramic'`
    con `floorLook: 'ceramicBeige'`: el color cambia y los pasos suenan
    igual, sin tocar el audio). Salida del gimnasio a Laprida y portón del patio sobre
    Miguel Cané: el modelo sigue el video y el plano de S&O (2,1 m entre la
    esquina y la primera pilastra; el CAD de 3,4 m cortaba la pilastra).
89. **Patio aire libre (patio este) como en el video de 2026.** El video de
    WhatsApp del 3/10/2026 (después de la pandemia; no se versiona) muestra el
    PATIO NUEVO (`patioEste`, «Patio aire libre»), no el central: el Espacio recreativo
    (`patioOeste`) queda como estaba antes (cantero azul, ladrillo, árboles
    pelados, palmera con asientos, aro). En el tramo entre el hall, el comedor
    y el salón de los espejos: piso de baldosas claras (se fueron la franja
    verde, el ripio y el árbol), muros de bloque gris del lado del patio
    (comedor, testero norte del hall y salón; antes oliva), cantero rojo al pie
    de la escalera blanca con bancos de chapa roja y azul (`boxBench`, los de
    72 cm son mesitas), gradas curvas azules (`amphi`, colisión en franjas por
    el arco en `obstacleRects`) con dos mástiles detrás, mesas de pie rojo con
    damero y sillas negras (`cafeTable`; con `h`, mesas altas de pie contra el
    ventanal del hall), macetas blancas (`pot`), la palmera en su cazuela,
    banco blanco contra el salón y banderines (`bunting`, decal en
    `schoolProps`; no pasan bajo el tramo de la pasarela). El patio de juegos
    viejo NO EXISTE más (corrección del usuario: «el patio de juegos se
    removió»): se sacaron bicicletero, torre de madera con toboganes,
    aviarios, choza, hamacas, tobogán, domo trepador, arenero y cerco de
    cañas; al norte de las gradas el piso queda libre (ahí corren los chicos,
    `PLAY_KIDS`). Las fichas de la historia que apuntaban a la torre y a los
    aviarios ahora son `gradasPatio` (`amphi`) y `damero` (`cafeTable`,
    `nth: 5`, primera mesa del segundo par doble). Los tipos de ítem viejos
    siguen en `SchoolBase`/`SchoolBuilder` sin uso. Libres: la puerta bajo la
    escalera blanca, su pie, la de la cantina y la del hall.

90. **Escuela a tamaño real (`SC = 78 / 67,4`).** El usuario pidió la escuela
    del tamaño real ("es casi una cuadra entera") para que entre todo lo del
    plano. Los datos siguen escritos en metros del plano; `SchoolLayout`
    aplica una escala UNIFORME en planta con centro en la esquina de Laprida
    y Miguel Cané (`SchoolScale`): muros, vanos (con su centro: el juego
    encuentra puertas por cercanía), ambientes, escaleras, descansos, huecos,
    volúmenes y techos quedan exactos, y la diagonal de Miguel Cané y la
    medianera conservan su ángulo. Las alturas no se escalan. Reglas que no
    hay que deshacer:
    - **Los muebles no se escalan**: se mueve su posición, no su medida. Lo
      que estaba a ≤ 0,35 m de un muro detrás (≤ 0,15 de costado) queda a la
      MISMA distancia del muro real (también contra las diagonales, que se
      vuelven a medir después de mover el grupo); lo que toca muros en los
      dos extremos y cubre un paño (vigas, espejos, barras, mesadas: `STRETCH`)
      se estira; rejas y cortinas siguen a su vano (largo × SC); pintura de
      piso, banderines y cercos vivos se agrandan; los muebles que se tocan
      (silla bajo el pupitre, fila de boxes) se mueven juntos. Excepciones
      puntuales en `ITEM_OVERRIDES` / `KEEP_WIDTH`, cada una con su porqué.
    - **Hojas de fábrica**: una puerta simple no pasa de 1,1 m, una doble de
      2,6 y una salida de 2,2 (si ya eran más anchas en el plano, quedan).
    - **Nunca escribir en un consumidor un número leído del plano** sin
      `planU`/`planV`/`fromPlan` (más allá de la línea municipal y del muro
      este, conservan la distancia real: la calle no se ensancha). Línea +
      separación (`U.east1 + 0.15`) y medidas quedan como están.
    - La grilla de colisión, la de luz natural (`DAYLIGHT_GRID`) y el plano
      colgado en el hall se derivan de `SC`. En la grilla, una celda se abre
      si el ambiente toca cualquier parte de ella y un hueco de losa marca
      sólo celdas enteras: con los bordes fuera de la grilla de 10 cm, el
      último escalón quedaba a 3 cm de una celda maciza y trababa al que bajaba.
    - Con `SC = 1` la pasada es la identidad exacta: usarlo para aislar fallas.
    - `tools/school-shots.mjs` acepta `"plan": true` por vista (convierte con
      el gancho `__fromPlan`) para reusar las vistas viejas. Ojo: un ojo
      viejo convertido puede caer dentro de un muro o de un ambiente vecino
      (el hall tiene la oficina de la entrada metida en su planta); las
      vistas de QA ya están en metros reales, con el ojo a ≥ 0,7 m de muros
      y muebles altos.
    - **Pintura de piso** (`floorPatch`) pasa por la escala uniforme entera
      (centro y las dos medidas × SC, sin anclar ni agrupar; sólo se corre
      si su cara trasera iba contra un muro): anclada de un lado, la pista
      del Aula Maker quedaba 1,3 m corta en cada punta. Los **cercos vivos**
      (`hedge`) son plantas: medida real, la fila junta por `GROUPABLE`.
    - Una **cortina** se escala con su vano sólo si de verdad está en un vano;
      un telón que cuelga del borde de un escenario toma el centro y el largo
      reales del escenario (`followStage`): escalado por su cuenta, el del
      SUM del jardín sobresalía 0,44 m de cada punta, con una pata en el aire.
    - **Visor**: con la manzana de 49 m el barrio sumaba ~50 mil triángulos
      por vista (las instancias de la granja no se recortan por distancia ni
      por oclusión). En el visor no se plantan los árboles de los patios
      cerrados de las manzanas de vivienda (no se ven desde la calle; se
      consume el mismo azar con `NatureBuilder.skipBroadleaf`, así el resto
      del barrio no cambia) y el cerco de la obra va sin zócalo verde ni
      filete amarillo; las balizas y faroles de la obra son icosaedros (20
      triángulos en vez de ~400). Quedó en 272–304 mil triángulos y ≤ 229
      draw calls por vista (el pico es el hall con ~55 personas a la vista).

91. **Gente a tamaño real: dos arreglos de comportamiento (no deshacer).**
    No son cambios de coordenadas; aparecieron como fallas reales al escalar:
    - `Places.lastMile`: cuando la búsqueda termina en la PRIMERA celda (su
      centro ya es grilla gruesa pero el punto de parada no), se agrega el
      punto de parada en vez de reemplazar el centro de la celda. Si no, el
      tramo arrancaba fuera de la grilla gruesa y quien venía caminando no
      tenía dónde engancharse (se quedaba trabado antes del asiento).
    - `Sim.spreadAtFoot`: los que esperan al pie de una escalera (primer
      punto del tramo, quietos) se abren un poco entre sí. En el tramo no hay
      esquive, y con los pasillos más largos llegaban más a la vez y quedaban
      todos parados en el mismo punto del pie, fundidos en un solo bulto.
    - `GOAL_MOUTH_U` sale del arco este de `ITEMS`: los penales siguen al arco
      aunque las reglas de escala lo muevan.
    - Recorridos guardados (`steps_*.json` del QA): las coordenadas literales
      de `__t.go` van envueltas en `...__fromPlan(u, v)`.

92. **Video de 2026 (hall + patio aire libre, pasillo al jardín y gimnasio).**
    Lo que cambió respecto del de 2020, en los datos del plano:
    - Escaleras: la del hall con paños de chapa perforada clara en marco de
      caño rojo y escalones grises sin nariz amarilla; la blanca del comedor
      con baranda de caño rojo (pasamanos y dos travesaños), sin malla, y
      zancas blancas macizas (`Stair.guard`, manda sobre `meshGuard`).
    - Patio aire libre (tramo): cantero rojo corrido en L desde el rincón de la
      puerta del hall (puerta vidriada simple corrida al este, dos macetas),
      fila de juegos de chapa (mesa + dos bancos); detrás, piso verde con dos
      contenedores y el cajón bajo con baranda de caño y la palmera; contra
      el salón, cazuelas de ripio con palmeras y arbolitos (`slimTree`) y
      mesitas lisas de dos sillas; muros del patio en revoque liso (no bloque);
      ventanal del hall casi hasta el piso; ventanal del comedor al norte.
    - Frente a Arte: gradas azules, tres mástiles blancos con la bandera
      argentina y una azul, mesas dobles con damero (`cafeTable.chess`),
      banco blanco de listones, papel picado pastel, bloque claro a la vista
      (`blockLight`), ventana corrediza y puerta de seis vidrios, pilastra.
    - Pasillo del jardín, Arte y Teatro: blancos sin guarda roja, cielorraso
      de placas, piso cerámico claro, paños vidriados al pasillo; Arte con
      filas de mesas largas rojas y bancos. V. Damas es vestuario: azulejo
      blanco, piso terracota, banco de madera, paneles grises y perchero;
      puertas de hoja roja. Gimnasio: piso gris claro y la puerta del pasillo
      enmarcada en azul marino.
    - Hall: banner oscuro con lema amarillo (cartelería impresa), cuadro de
      marco oscuro y cámara sobre la puerta del cuartito, columna acolchada
      verde oscuro con cinta azul, mostrador corrido rojo de la recepción con
      vidriado blanco y las sillas de espera frente a él.
    - Segunda pasada: murales de los chicos (`drawKidsMural`, regiones
      `kidsA`/`kidsB` del atlas) sobre el muro del polideportivo del pasillo y
      sobre el de Teatro en el hall del jardín; puerta de chapa negra al final
      del pasillo (muro nuevo de 1,85 m en `U.teaE`); hojas rojas MACIZAS en
      V. Damas y en la del fondo (grille `'none'` en una puerta = hoja sin
      vidrio; marco negro con color `'black'`); puerta del patio al pasillo de
      una hoja blanca; bicicletero de pared (dos caños blancos, soportes
      azules), matafuego con chapa roja y hoja impresa en el muro este del hall
      del jardín; acolchado rojo corrido en el lateral norte del gimnasio
      (bajo las ventanas oscuras, sólo la fila baja) y aro de básquet de poste
      rojo y tablero blanco con borde rojo contra el testero este.
    - Tercera pasada: persianas de enrollar rosado salmón (`pinkWall`) bajas
      tres cuartos en las dos ventanas del primer piso sobre la escalera
      blanca; piso del patio aire libre en losetas de cemento de 40 cm gris
      beige de juntas finas (`floorLook: 'patioTile'`, textura `granite`);
      salón de los espejos hacia el patio: ventanas de marco gris con
      barrotes horizontales oscuros (`'alu', 'louvre'`) y la puerta doble de
      PVC blanco con tres paños por hoja sobre zócalo bajo (grille
      `'whiteBars'` en una puerta vidriada = travesaños). Una reja pedida a
      mano en un muro interior ahora se dibuja (del lado sin techo o del
      pasillo, `grilleSide`). Ventanilla de vanos rojos al sanitario sobre el
      bicicletero (ventana `'red', 'none'` = revoque del vano en rojo);
      cantero redondo escalonado del rincón NE (ítem nuevo `roundPlanter`:
      tres anillos de gajos de la granja, uno solo para el QA, con arbustos
      y un arbolito de flor rosada); ventanas del gimnasio al hall del jardín
      con marco negro y malla; textura `court` gris claro (#c9c9c4) con
      líneas azul oscuro; tablero del aro de 1,8 × 1,05 m. El piso del hall
      del jardín NO es verde en el video (cerámico claro): se dejó.
    - Sin hacer: bicicletas apoyadas (no hay modelo), Teatro como aula, la
      ventanita oscura con celosía del muro del gimnasio en el pasillo justo
      antes de la puerta negra (chocaría con el acolchado de ese paño), el
      cantero redondo unido a las gradas en curva S (las gradas siguen en
      cuarto de círculo aparte), reflejos del piso pulido del gimnasio (sólo
      cambió el color) y el interior rojo de las ventanas del salón.

93. **No hay voces en el sonido** (lo pidió el usuario: "eliminá las voces o
    susurros"). `AMBIENT_VOICES = false` en `Soundscape`: no se generan las
    multitudes de fondo (chicos del patio, murmullo de aulas, jardín), no
    suenan los sueltos con voz (`laugh`, `shout`, `teacher`, `voices`) y
    `voice()` no habla (ni voz del navegador ni bla-bla), aunque se abra con
    `?frases=1`: la línea dura lo mismo, en silencio. El resto del ambiente
    (pájaros, pelota, silbato, autos, campana, pasos) sigue igual.

---

## 6. Estado actual

### Métricas (semilla 42, por encuadre, Chrome con GPU)

Draw calls reales por cuadro (contador de Babylon, promedio de 10 cuadros) y
triángulos activos, con la gente y el juego andando. `tools/school-shots.mjs`
los imprime por vista.

| Perfil | Draw calls | Triángulos activos | Gente | Geometría total |
|---|---|---|---|---|
| Alta | ~810–940 (3 cascadas de sombra + SSAO) | 1,4–2,0 M (con pasadas de sombra) | 190 | ~250k |
| VR | 179–229 | 272–304k (escuela a tamaño real) | 110 (15–56 dibujadas) | ~237k |

### Qué ya funciona

- La escuela completa en tres niveles con colisión, escaleras y pisos
- El barrio: una hilera de edificios de la ciudad 2050 y una torre, calles con autos y pájaros
- Gente con fases del día escolar, navegación por pisos y puertas
- La historia entera de principio a fin (probado en el juego real, con la
  gente y el audio reales: prólogo → créditos, 8/8 sellos)
- Puertas y luces interactivas, carteles, actividades
- HUD nuevo (objetivo, minimapa, avisos, menú de pausa con pasaporte y ajustes)
- Audio procedural por zona, voces y música
- VR: menú del juego en el visor, láser, panel de muñeca, caminata con stick,
  giro, teletransporte, viñeta de confort
- Celular en horizontal: joysticks, tocar para usar, botones, HUD y menús
  acomodados, aviso de girar, perfil 'Móvil', tope de cuadros parejo, audio
  suspendido en segundo plano. Probado en un teléfono EMULADO (Chrome con
  toques reales por CDP), no en uno físico

### ⚠️ Limitación crítica de validación

Las herramientas corren en Chrome headless con GPU (`--use-angle=d3d11`): los
fps que informan están topados por el navegador y **no representan un visor**.
Valen draw calls, triángulos y tiempos de armado.

El VR **no se probó en un Quest real** desde la transformación en juego. En el
emulador IWER la cámara XR vuelve al origen en cada cuadro (no respeta el
espacio de referencia desplazado), así que en `tools/test-vr.mjs` fallan
"el stick camina", "gira" y "teletransporta" — también fallaban antes de los
cambios; es una limitación del emulador. Todo lo demás pasa (entrar, menú del
juego delante, mandos, colores, salir, sin errores).

---

## 7. Qué mejorar, por prioridad

1. **Probar en un Quest real**: caminata, giro, teletransporte, legibilidad del
   panel y del HUD de muñeca, fps con la escuela llena (`adb reverse` o HTTPS).
2. **Pasada de escucha del audio**: el balance se hizo midiendo niveles; los
   valores están en `ZONE_RECIPES` (`audio/mix.ts`) y `BED_TRIM` /
   `EVENT_LEVEL` (`Soundscape.ts`).
3. **Gente**: hacen fila superpuestos en las escaleras (sin evitación ahí); los
   chicos del patio corren entre puntos al azar; aparecen de golpe a ~12 m
   (VR) en pasos anchos entre ambientes.
4. **Detalles de la escuela pendientes**: guardas de escaleras, matas de
   pasto en canteros, oficina bajo la escalera de chapa.
5. **Limpiar código de la ciudad** que el barrio ya no usa
   (`BuildingBuilder`, canal, energía, parque, tranvías de `Life`).
6. **Que visor y escritorio armen la misma ciudad** (ítem 42, heredado; la
   escuela ya tiene su propio generador, ver 82):
   `NatureBuilder.legacyDraws` saca los números de las ramas del generador
   compartido sólo con detalle alto, y `StreetLevel.facadeLife` decide los
   balcones con el generador compartido en un bucle de 8 pisos en escritorio
   y 3 en el visor. Arreglo: consumir siempre los mismos números.
7. **Margen del visor**: la vista aérea anda por 285–288 mil triángulos
   (tope 300 mil). Lo más grande son las barandas y rejas de metal oscuro de
   la escuela (`box|s:#2C2F35`, unos 37 mil triángulos): en el visor, una de
   cada dos o paneles planos en lugar de cajas.
8. **Detalles menores**: `tools/test-wind.mjs` busca una manzana 'park' que
   ya no existe; en `Sidewalks` volver a mirar el semáforo hasta bajar del
   cordón y pasarle el centro de la senda a `pedestrianGo`; nadie camina
   por el césped de Miguel Cané.

---

## 8. Cómo verificar cambios

**Compilar no prueba nada.** Después de cada cambio importante:

```bash
npx tsc --noEmit && npx eslint src tests --max-warnings=0 && npx vitest run
node tools/test-interaction.mjs http://localhost:5190/ <carpeta>   # escritorio + juego
node tools/test-vr.mjs http://localhost:5190/?seed=42 <carpeta>    # Quest 3 emulado
node tools/test-mobile.mjs http://localhost:5190/ <carpeta>        # celular horizontal
node tools/school-shots.mjs "<url>&quality=high|vr" <carpeta> <vistas.json>
```

- `test-interaction.mjs`: tres pasadas. Modo herramienta (caminar, volar,
  gente, personajes, pájaros, sin HUD), modo jugador (título, partida nueva,
  objetivo, menú de pausa, saludar a Rubén sin frases) y una tercera con
  `&frases=1` (diálogo y voz). Sale con 1 si algo falla.
- `test-vr.mjs`: entra desde el título, verifica el menú del juego en el
  visor, empieza la partida y prueba locomoción (ver la limitación del
  emulador en 6), paredes, mandos, saludar a Rubén con la A sin frases,
  salida y consola.
- `test-mobile.mjs`: un Android emulado de 844 × 390 jugando con los dedos
  (`Input.dispatchTouchEvent`, varios a la vez): detección y perfil,
  joystick analógico, mirar, dos pulgares, saltar, correr, tocar a una
  persona y botón de usar (reacción sin frases: sin voces, sin `#dialogue`
  ni `#bark`), menú, ajustes, volar, actividad, superposiciones
  del HUD, aviso vertical, tope de cuadros, un equipo de entrada y que el
  escritorio NO entre en modo táctil.
- `school-shots.mjs`: capturas en coordenadas del plano
  (`[{name, eye:[u,y,v], look:[u,y,v], fly, wait}]`) con el coste de cada
  encuadre (draw calls, triángulos, gente dibujada).
- Tests de datos que conviene mirar al tocar la escuela: `schoolLayout`,
  `schoolLevels` (subir y bajar cada escalera), `peopleNav`, `gameReach`
  (cada paso de la historia es caminable), `gameStory` (la historia completa
  sin callejones, también en silencio hasta el final), `doors`, `vegetation`.

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
