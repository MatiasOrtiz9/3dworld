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
  del jardín, acto final y créditos. 8 sellos del Pasaporte 40, 35 lugares,
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
- `?quality=low|vr|balanced|high` — fuerza un perfil de calidad
- `?titulo=0|1` — salta o muestra la pantalla de título
- `?libre=1` — abre todas las zonas (sin las cerraduras de la historia)
- `?hud=0|1` — oculta o muestra el HUD y los marcadores
- Con `navigator.webdriver` (puppeteer) el juego entra directo, todo abierto y
  sin HUD, para que las capturas no dependan de la historia. Para probar la
  historia con puppeteer: `?titulo=1&libre=0&hud=1`.

**Controles de escritorio**: `WASD` mover, `Shift` correr, `Espacio` saltar,
`E` interactuar (hablar, abrir, usar), `Esc` menú (pasaporte, ajustes,
controles), `F` caminar/volar (volando, `E`/`Q` suben y bajan).

**Controles VR**: stick izquierdo camina (clic: correr), stick derecho gira de
a 30° / teletransporta / paso atrás, gatillo elige con el láser. Panel de
muñeca con el lugar y el objetivo.

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
├── player/                 # FlyCamera, PlayerController (caminar/volar)
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

`CityLayout` arma una grilla de 5×5 con la escuela en el centro (y su anexo al
este) y **una hilera de diez manzanas** alrededor con las tipologías de la
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

11. **Follaje: difuso × 0,85 y emisivo 0,45** (`Materials.foliage`).
    El emisivo es un sustituto barato de dispersión subsuperficial. Con la
    luz hemisférica baja del entorno actual, 0,30 dejaba las copas en sombra
    **negras** (bajo los edificios de enfrente, a contraluz); subir sólo el
    emisivo las volvía plástico al sol, por eso se baja el difuso a la vez: al
    sol la copa da lo mismo que antes (≈1,37 × color) y en sombra 50 % más.

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
    `CityIndex` (colisión por grilla de ocupación de 10 cm), la gente
    (`people/`), el juego (`game/`) y el audio (`schoolAcoustics`). No inventar
    ambientes: la planta alta no está en el plano y sale del recorrido
    virtual (ver 30 y 31).

23. **Personas: un material, color = vértice × instancia.** Las piezas
    articuladas tienen el origen en su pivote para compartir matriz. Cada
    cuadro se escriben sólo las personas visibles, compactadas, y las mallas
    son `alwaysSelectAsActiveMesh`: su bounding no se puede mantener barato.
    Ver `people/HumanGeometry.ts` y `people/Population.ts` (36).

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

30. **La escuela se escribe en cuatro módulos de datos.** `SchoolBase` tiene
    las primitivas (tipos, líneas `U`/`V`, `seg/hw/vw`, `item`, `onLevel`…);
    `SchoolLayout` la planta baja del plano, la colisión y lo que junta todo;
    `SchoolUpper` las plantas altas del edificio principal y `SchoolJardin`
    el jardín. Los dos últimos importan SÓLO de `SchoolBase`: si importaran
    de `SchoolLayout` habría un ciclo y las constantes llegarían sin
    inicializar. `SchoolLayout` reexporta todo, así que el resto del código
    sigue importando de ahí.

31. **La planta alta sale del recorrido de 2020, no de un plano.** Ver el
    comentario de cabecera de `SchoolUpper`: escalera del hall en U, pasillo
    de los trofeos, pasillo de lockers sobre el pasillo sur, galería roja
    sobre el comedor, sector nuevo, ala oeste retirada del patio, pasarela
    vidriada y edificio de bloque con el aula de danzas del 2º piso bajo la
    bóveda del polideportivo (la bóveda se prolonga hasta `U1.vaultW`). El
    jardín respeta la caja del plano aunque el real llega a la calle de
    atrás: el plano manda sobre la distribución.

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
    largo de las aristas muro/cielorraso. Cuando la calidad adaptativa apaga
    ese desenfoque, la intensidad baja para que no quede granulado.

---

## 6. Estado actual

### Métricas (semilla 42, por encuadre, Chrome con GPU)

Draw calls reales por cuadro (contador de Babylon, promedio de 10 cuadros) y
triángulos activos, con la gente y el juego andando. `tools/school-shots.mjs`
los imprime por vista.

| Perfil | Draw calls | Triángulos activos | Gente | Geometría total |
|---|---|---|---|---|
| Alta | ~810–940 (3 cascadas de sombra + SSAO) | 1,4–2,0 M (con pasadas de sombra) | 190 | ~250k |
| VR | 139–181 | 192–223k | 100 (25–50 dibujadas) | ~178k |

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
4. **Detalles de la escuela pendientes**: guardas de escaleras, torre de
   juegos más detallada, matas de pasto en canteros, techos a dos aguas de
   los aviarios, oficina bajo la escalera de chapa.
5. **Limpiar código de la ciudad** que el barrio ya no usa
   (`BuildingBuilder`, canal, energía, parque, tranvías de `Life`).

---

## 8. Cómo verificar cambios

**Compilar no prueba nada.** Después de cada cambio importante:

```bash
npx tsc --noEmit && npx eslint src tests --max-warnings=0 && npx vitest run
node tools/test-interaction.mjs http://localhost:5190/ <carpeta>   # escritorio + juego
node tools/test-vr.mjs http://localhost:5190/?seed=42 <carpeta>    # Quest 3 emulado
node tools/school-shots.mjs "<url>&quality=high|vr" <carpeta> <vistas.json>
```

- `test-interaction.mjs`: dos pasadas. Modo herramienta (caminar, volar,
  gente, personajes, pájaros, sin HUD) y modo jugador (título, partida nueva,
  objetivo, menú de pausa). Sale con 1 si algo falla.
- `test-vr.mjs`: entra desde el título, verifica el menú del juego en el
  visor, empieza la partida y prueba locomoción (ver la limitación del
  emulador en 6), paredes, mandos, salida y consola.
- `school-shots.mjs`: capturas en coordenadas del plano
  (`[{name, eye:[u,y,v], look:[u,y,v], fly, wait}]`) con el coste de cada
  encuadre (draw calls, triángulos, gente dibujada).
- Tests de datos que conviene mirar al tocar la escuela: `schoolLayout`,
  `schoolLevels` (subir y bajar cada escalera), `peopleNav`, `gameReach`
  (cada paso de la historia es caminable), `gameStory` (la historia completa
  sin callejones), `doors`, `vegetation`.

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
