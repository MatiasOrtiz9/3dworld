# Ciudad 2050

Ciudad solarpunk generada íntegramente por código, recorrible a pie y en
realidad virtual (WebXR). Cero modelos 3D descargados, cero texturas externas:
la geometría son primitivas y las texturas se dibujan en un canvas al arrancar.

```bash
npm install
npm run dev        # http://localhost:5173
npm run verify     # typecheck + lint + tests  (~4 s) — antes de cada commit
npm run build      # verify + build de producción
npm test           # 49 tests unitarios en ~1,3 s
npm run lint
```

Verificación en navegador (lenta, para lo que un test unitario no puede ver):

```bash
node tools/shoot.mjs <url> <png>              # captura + desglose de coste
node tools/shoot-block.mjs <url> <png> <tipo> # encuadra una manzana por tipo
node tools/test-interaction.mjs <url>         # paneles, clic, modos, movimiento
node tools/test-leaks.mjs <url> [ciclos]      # fugas de recursos al reconstruir
node tools/test-seeds.mjs <url> [n]           # construcción y render por semilla
node tools/measure.mjs <url>                  # tiempos de carga y peso de red
node tools/benchmark.mjs <url> [seg]         # fps con GPU REAL (aborta si es software)
node tools/ablation.mjs <url> [seg]          # coste por efecto (sombras, SSAO, bloom)
node tools/test-offline.mjs <url-preview>     # funcionamiento con la red cortada
node tools/test-wind.mjs <url>               # que el viento del follaje se aplique
python tools/make-icons.py                   # regenera los iconos de la PWA
```

**Funciona sin conexión.** Service worker vía `vite-plugin-pwa`: tras la primera
carga, la aplicación entera (137 archivos, 2,9 MB) queda en caché. Verificado
cortando la red de verdad y recargando — 0 peticiones fallidas.

| URL | Qué hace |
|---|---|
| `/` | Ciudad aleatoria |
| `/?seed=42` | Ciudad reproducible (número o texto) |
| `/?quality=low` | Fuerza el perfil de bajo consumo para equipos modestos |
| `/?quality=vr` | Fuerza el perfil VR |

En escritorio, la calidad inicial se estima con núcleos, memoria disponible y
GPU. Los equipos modestos arrancan en **Baja**: renderiza a resolución reducida,
sin sombras ni oclusión ambiental, y genera una ciudad más compacta con menos
vegetación y peatones. El botón **Calidad** permite pasar por Baja, Media y Alta.

## Controles

| | |
|---|---|
| Caminar / volar | `W` `A` `S` `D` · `Shift` corre |
| Hora del día | deslizador en el HUD |
| Saltar | `Espacio` (sólo caminando) |
| Hablar con docentes y responder preguntas | acercarse a un NPC y pulsar `E` (sólo caminando) |
| Subir / bajar | `E` / `Q` (sólo volando) |
| Cambiar de modo | `F` |
| Mirar | clic + arrastrar |
| **Inspeccionar** | **clic sobre un edificio** |
| Cerrar panel | `Esc` |
| Ocultar ayuda | `H` |

---

## Qué hay

Traza de 5×5 manzanas (~285 m de lado), determinista por semilla. El mundo se
achicó a propósito para centrar la experiencia en la escuela, que ocupa el
centro de la ciudad (la manzana central y la de su oeste, donde antes estaba la
plaza). Su fachada mira al sur, a Laprida, con manzanas enfrente; el canal
corre siempre a sus espaldas, al norte.

**Escuela CIMDIP & Miguel Cané, réplica del plano de evacuación.** La planta
baja se midió sobre el "Plano de evacuación — planta baja" de la sede y se
levantó en 3D respetando distribución y proporciones (0,07 m por píxel del
plano): cinco aulas sobre Laprida, pasillos, los dos patios aire libre,
Tecnología, E.P, escalera principal, ADM, Prof., Dir. Prim, buffet, hall de
acceso, Salón de los espejos, gimnasio/SUM con bóveda, Arte, Teatro, V. Damas
y el Jardín de infantes CIMPID. La orientación es la real: Laprida al sur y
Miguel Cané en diagonal al oeste. Se recorre por dentro (puertas, pasillos,
escaleras dibujadas) y un indicador "Estás en" muestra el ambiente del plano.
Los colores y el equipamiento siguen el recorrido virtual de 2020 (guarda
roja, gimnasio gris, aula de danzas con espejos y columnas rojas, Tecnología
con piso verde). La planta alta no figura en el plano: se levanta como
volumen cerrado, sin inventar ambientes.

**Siete tipos de manzana** con criterio urbano, no al azar: torres con jardines
en altura, vivienda perimetral con patio, mercado de madera laminada,
equipamiento cívico,
parques, canal diagonal con puentes, y huertas solares con turbinas de eje
vertical. **Sin autos**: calzada angosta, vereda ancha, tranvía.

**Interactividad**
- **Cinco docentes NPC en el campus**: acercate, pulsá `E`, conversá y respondé
  preguntas de tecnología, robótica, ciencia, deporte y ambiente. Las respuestas
  incluyen explicación; el avance se conserva en el navegador.
- **Caminar** con gravedad, salto y colisión contra los edificios, a 1,68 m de
  altura de ojos. Es lo que da escala: un espacio urbano sólo se entiende
  cuando hay que rodear la manzana en vez de atravesarla.
- **Inspeccionar**: clic sobre cualquier manzana y sale su ficha — tipo, plantas,
  habitantes estimados, superficie de paneles y generación en kWh/día.
- **Panel de energía**: totales de la ciudad y qué porcentaje de la demanda
  cubre el sol.
- **Gente**: hasta 180 peatones y ciclistas caminando por las veredas, con más
  densidad en los parques y los mercados, y alumnos en los patios y
  el gimnasio de la escuela. Cada figura son cuatro
  cajas con las piernas pivotando en la cadera; todas van en *thin instances*
  agrupadas por color de ropa, así 230 personas cuestan 20 draw calls.
- **Vida**: tranvías que recorren las avenidas y paran en las esquinas, y
  pájaros planeando en círculos.
- **Hora del día continua** con un deslizador, de 08:00 a 20:30. Interpola sol,
  cielo, niebla y color de luz entre cuatro fotogramas clave. Al caer la tarde
  **se encienden las ventanas** — ambas variantes se generan de antemano y sólo
  se conmuta cuál se dibuja, porque los materiales están congelados.
- **Viento en el follaje**, animado en el vertex shader. Mover 6.000 copias de
  vegetación desde JavaScript sería inviable; en el shader cuesta unas pocas
  instrucciones por vértice y no toca la CPU.
- **Sonido generado por código**: ambiente de dos capas de ruido filtrado,
  pisadas que se disparan por distancia recorrida (así la cadencia se acelera
  sola al correr) y tonos de interfaz. Sin un solo archivo de audio.

## Cómo se ve así sin descargar nada

| Técnica | Qué aporta |
|---|---|
| **SSAO** | Oclusión ambiental. El efecto que más realismo da en arquitectura: los objetos se apoyan en el suelo en vez de flotar |
| **Mapeo tonal ACES** | Sin él, PBR recorta todo lo que supera 1.0 a blanco puro y la ciudad parece papel |
| **Bloom, viñeta, grano** | Lenguaje de cámara: el ojo lo asocia a una foto, no a un render |
| **Texturas procedurales** | Hormigón, madera, solado, césped, celdas solares y metal cepillado, dibujados en un canvas de 256² al arrancar |
| **Tinte variado por edificio** | Cuatro variantes por tono. Sin esto todos los edificios iguales son *exactamente* iguales y se lee "copiado y pegado" |
| **Ventanas oscuras** | Una ventana vista desde afuera de día se ve oscura: el interior está mucho menos iluminado que la fachada al sol. Con vidrios claros, las aberturas desaparecían |
| **Detalle a nivel de calle** | Planta baja comercial, toldos, balcones, cordón, alcorques, paradas de tranvía. Es donde se apoya el ojo al caminar |
| **Sombras en cascada (CSM)** | Un solo mapa para 400 m da sombras invisibles de tan borrosas |
| **IBL desde el cielo** | Sonda de reflexión de una pasada. Sin entorno, todo metal PBR se ve negro |

## Rendimiento

Medido con `seed=42`:

| Perfil | Objetos | Personas | Triángulos | Draw calls | Generación |
|---|---|---|---|---|---|
| **Alta** | 26.800 | 230 | 447k | 158 | ~155 ms |
| **VR** | 13.100 | 90 | 193k | 142 | ~110 ms |

> Los draw calls que se informan ahora incluyen **todo** lo que se dibuja:
> la granja de instancias más gente, tranvías, pájaros y cielo. Antes se
> informaba sólo la granja, así que la cifra subestimaba el coste justo cuando
> se agregaba movimiento — que es cuando más importa saberlo.

Tres palancas escalan por perfil: densidad de vegetación, follaje de alto
detalle (copas de 80 triángulos contra 20) y detalle fino de calle (parteluces,
balcones de pisos altos, bicicleteros). En VR se apagan las tres.

La base es `InstanceFarm`: una malla unitaria por combinación
primitiva+material y todas las copias como *thin instances* en un único buffer.
La ciudad se dibuja en ~100 draw calls sin importar cuántos objetos haya.

### Sobre el tiempo de carga

Lo medible con `tools/measure.mjs`:

| | Antes | Ahora |
|---|---|---|
| Paquete principal | 2.068 KB | **1.556 KB** |
| Comprimido (gzip) | 473 KB | **387 KB** |
| WebXR | siempre | **535 KB diferidos** |

WebXR y sus dependencias salieron del paquete principal con un `import()`
dinámico: sólo se descargan si el navegador declara tener un visor. Para quien
entra desde una computadora, es peso que ya no viaja.

**El cuello de botella no es la descarga: es la compilación de shaders.** El
shader PBR con sombras en cascada, IBL, niebla, SSAO y mapeo tonal es enorme, y
el navegador lo compila la primera vez que dibuja con él. Por eso
`City.precompile()` los compila a propósito durante la barra de progreso, con un
**presupuesto de tiempo duro**: lo que no entra se compila solo, de forma
perezosa. Sin ese presupuesto, un equipo lento se queda colgado en la carga.

### fps medidos en GPU real

`tools/benchmark.mjs` mide con la GPU de verdad y **aborta si detecta render por
software**, para no informar números falsos. Medido en una **NVIDIA GTX 1660
SUPER a 1920×1080**:

| Perfil | En la plaza | Vista aérea | A ras de calle |
|---|---|---|---|
| **Alta** | 93 fps | 94 fps | 88 fps |
| **Media** | 104 fps | 103 fps | 101 fps |
| **VR** | 657 fps | 635 fps | 643 fps |

### De dónde sale el coste

`tools/ablation.mjs` activa cada efecto por separado sobre la misma escena:

| | ms por cuadro |
|---|---|
| **Toda la geometría** (419k tris, 161 draw calls) | **2,52** |
| Bloom + FXAA | +0,11 |
| Oclusión ambiental media | +2,18 |
| Oclusión ambiental alta (config. original) | +7,28 |
| Sombras en cascada | +4,20 |

**La geometría es el 14 % del coste.** El resto son sombras y post-procesado.
Esta medición cambió dos decisiones:

1. El SSAO de calidad alta se reajustó (ratio 0,75 → 0,6 · 24 → 16 muestras ·
   blur caro apagado). Pagaba 5 ms extra por una diferencia que hay que buscar
   con lupa. **El perfil alto pasó de 69 a 86 fps a ras de calle.**
2. **VR recuperó bloom y antialiasing.** Estaban apagados por precaución; medir
   mostró que cuestan 0,11 ms. La oclusión ambiental sigue afuera.

> ⚠️ **Todavía no se probó en un visor.** Los números de arriba son de una GPU
> de escritorio con un solo ojo a 1080p. Un visor autónomo renderiza dos ojos a
> mayor resolución con una GPU mucho más débil, y lo que pesa ahí son los draw
> calls y el relleno, no los triángulos. Los 139 draw calls del perfil VR están
> en el límite superior de lo recomendable para VR móvil.

## Arquitectura

```
src/
├── core/
│   ├── InstanceFarm.ts     # thin instances: el corazón del rendimiento
│   ├── RenderPipeline.ts   # SSAO, bloom, viñeta, nitidez
│   └── QualityManager.ts   # tres perfiles (vr / balanced / high)
├── world/
│   ├── CityLayout.ts       # el plano: manzanas, calles, canal
│   ├── City.ts             # orquestador + precompilación de shaders
│   ├── CityIndex.ts        # índice espacial: colisión, clic, estimaciones
│   ├── Life.ts             # tranvías y pájaros
│   ├── Environment.ts      # cielo, sol, CSM, IBL, mapeo tonal
│   ├── Textures.ts         # texturas procedurales en canvas
│   ├── Palette.ts          # lenguaje visual solarpunk
│   ├── Materials.ts        # biblioteca compartida + tinte variado
│   └── builders/
│       ├── NatureBuilder.ts    # árboles, jardineras, bosque urbano
│       ├── BuildingBuilder.ts  # volúmenes escalonados, torres, mercado
│       ├── StreetLevel.ts      # planta baja, toldos, balcones, mobiliario
│       └── InfraBuilder.ts     # calles, canal, puentes, energía
├── player/
│   ├── FlyCamera.ts
│   └── PlayerController.ts # caminar/volar, gravedad, colisión
├── ui/Inspector.ts         # clic → ficha de la manzana
├── vr/XRSetup.ts           # teleport, snap turn, hand tracking
└── utils/rng.ts            # mulberry32 con semilla
```

**El truco del índice espacial:** la ciudad son ~19.000 *thin instances*, que
para Babylon no son objetos separados — no se puede hacer clic sobre un edificio
ni chocar contra él. En vez de pagar el coste de volverlos seleccionables, se
consulta el PLANO: dada una posición, se calcula en qué manzana cae. Una
división y un redondeo resuelven colisión e inspección.

## Bugs encontrados y corregidos

Se documentan porque cada uno costó una iteración y son trampas reutilizables.

1. **`thinInstanceSetBuffer(..., staticBuffer: true)` no recalcula el bounding
   info.** La malla conservaba el volumen de la primitiva unitaria en el origen,
   el generador de sombras descartaba la ciudad entera y **no se veía ni una
   sombra**. Se arregla con `thinInstanceRefreshBoundingInfo(true)`.
2. **`material.freeze()` antes de crear las sombras.** Congelar impide
   recompilar el shader, así que los *defines* de sombra nunca entraban.
3. **Metales negros.** PBR con `metallic` alto y sin `environmentTexture` se
   renderiza casi negro: un metal no tiene difusa, todo su color viene de lo que
   refleja. El Árbol Solar era una mancha oscura.
4. **`ReflectionProbe` con la ciudad en el `renderList`** produce un bucle de
   realimentación en WebGL. Sólo entra el cielo, que además es el 90 % de la luz
   ambiental exterior.
5. **Sin mapeo tonal, PBR quema todo a blanco.**
6. **Clonar la textura en cada material.** ~110 clones de un canvas de 256²
   completamente innecesarios: la escala de repetición es constante por tipo de
   superficie, así que la textura se comparte.
7. **Precompilar shaders sin presupuesto cuelga la carga.** Bajo render por
   software un solo shader PBR tardó ~45 s; 110 materiales habrían sido eternos.
8. **Canal espejado.** Babylon es zurdo: rotar +X sobre Y lleva a
   `(cos, 0, −sin)`. El ángulo iba sin negar.
9. **La plaza podía desaparecer.** El agua se clasificaba antes que la plaza, así
   que con ciertas semillas el canal se comía la manzana central.
10. **Vegetación duplicada.** Cada manzana plantaba sus cuatro lados, así que
    cada calle recibía árboles de las dos manzanas que la comparten.
11. **Ventanas más grandes que el edificio** (`w + 0.12`): un aro que sobresalía;
    apilado piso a piso, los edificios parecían pilas de platos.
12. **Follaje a 144 triángulos por copa.** `CreateSphere({segments: 4})` no es
    barata: con ~8.700 copias se comía el 84 % de la escena. Una icoesfera de
    subdivisión 1 cuesta **20**, y con `flat: false` se ve más redonda.
13. **Árboles como cristales.** Una o dos esferas grandes se leen como un
    caramelo sobre un palo. Un racimo de 3-5 masas menores, rotadas al azar y de
    tonos distintos, da una silueta que el ojo acepta como follaje.
14. **Texturas estiradas.** Las UV de una primitiva van de 0 a 1 sin importar su
    tamaño físico, así que un muro de 42 × 19 m con la misma escala que una caja
    de 2 m convertía el grano del hormigón en franjas de 12 metros. De ahí las
    variantes `concreteXL` / `timberXL` / `pavementXL`. La textura de hormigón
    además se hizo isótropa: las juntas sólo horizontales, al estirarse,
    parecían chapa ondulada.
15. **Ventanas invisibles.** Con vidrios verde y celeste claros, las aberturas
    tenían el mismo valor que el muro y los edificios parecían bloques lisos.
    Corregido con vidrio oscuro y metalicidad alta, que con IBL saca su color
    del reflejo del cielo — claro arriba, oscuro abajo, como el vidrio real.
16. **Follaje negro a contraluz.** Bajar el emisivo para que los árboles no
    brillaran los dejó como agujeros negros cuando el sol está detrás. Una hoja
    real es translúcida; el emisivo es el sustituto barato de la dispersión
    subsuperficial. El punto está en 0,26.
17. **La herramienta de captura se metía dentro de los edificios.** Pedir 26 m de
    distancia con calles de 15 m ponía la cámara en la manzana de enfrente. Ahora
    se topa al ancho real de la calle.

## VR

Probado en el emulador de Quest 3 (`node tools/test-vr.mjs`); la caminata se
ajustó con pruebas en el visor. Controles:

- **Stick izquierdo:** caminar con colisión y pisos (apretarlo corre). Si el
  navegador no expone el stick como componente, se leen los ejes crudos del
  gamepad.
- **Stick derecho:** girar de a 30° a los costados, teletransporte hacia
  adelante (arco hasta el destino) y un paso atrás hacia abajo.
- **Gatillo:** elegir con el láser (hablar, usar, botones del panel). Empieza
  en la mano derecha y pasa a la otra al apretar su gatillo.
- **Muñeca:** dónde estás y el objetivo actual. Al moverse aparece una viñeta
  de confort. El post-procesado se desactiva en VR (son pasadas de pantalla
  completa por ojo).

Para probar localmente, ejecutá `npm run dev:vr`. El servidor HTTPS escucha en
el puerto `5182`. Con la PC y el Quest en la misma Wi-Fi, abrí en Meta Quest
Browser `https://IP-DE-LA-PC:5182/` y pulsá **Entrar en VR**. Si WebXR falla,
el motivo aparece en pantalla (en el visor no hay consola a mano).

> **WebXR exige contexto seguro.** Desde un visor, `http://192.168.x.x` no
> alcanza: en desarrollo usá `npm run dev:vr`, que sirve la página por HTTPS.

## Licencias

Sin assets externos. Dependencias: Babylon.js (Apache-2.0), Vite (MIT),
TypeScript (Apache-2.0), puppeteer-core (Apache-2.0, sólo herramientas).

## Verificación

El proyecto tiene dos niveles de prueba, y la distinción importa:

- **Unitarias (`npm test`)** — 49 tests sobre la lógica pura: `Rng`,
  `generateCityPlan`, `classifyBlock`, `CityIndex`, `seedFromString`. Corren en
  **Node sin navegador ni GPU**, tardan ~1,3 s y cubren 300 semillas. Acá viven
  todos los invariantes del plano.
- **De navegador (`tools/`)** — lo que un test unitario no puede ver: que la
  ciudad efectivamente se construya y renderice, que los paneles se abran, que
  no haya fugas de recursos al reconstruir. Tardan minutos.

La suite unitaria se validó con una **prueba de mutación**: se reintrodujo a
propósito el bug por el que el canal borraba la plaza, y la suite lo detecta.
La primera versión de esos tests NO lo detectaba —pasaba por la razón
equivocada, porque otra salvaguarda tapaba el problema— y por eso
`classifyBlock` se exporta y se prueba directamente.

## Pendiente

- **Probar en un visor real.** Es lo único del plan que no se pudo hacer: no hay
  hardware disponible. Los fps de escritorio ya están medidos; lo que falta
  saber es cómo se comporta con dos ojos, más resolución y una GPU móvil.
- Interiores insinuados detrás de las vitrinas de planta baja.
- Culling por sectores — **condicionado** a que la prueba en visor muestre que
  hace falta. Con GPU de escritorio la geometría es el 14 % del coste, así que
  hoy no lo justifica nada.
- Más tipos de manzana (estación de tranvía, invernaderos, planta de agua).
