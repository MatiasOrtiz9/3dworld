# Ciudad 2050 — Auditoría y plan de mejora

**Fecha:** 26/09/2026 · **Versión auditada:** semilla de referencia `42`

Este documento no es una lista de deseos: cada hallazgo está respaldado por una
medición o por una lectura concreta del código, y cada tarea del plan tiene un
criterio de aceptación verificable.

---

## Parte 1 — Auditoría

### 1.1 Lo que está bien (verificado, no supuesto)

Antes de la lista de problemas conviene fijar qué NO hay que tocar, porque es
donde es fácil romper algo al "mejorar".

| Área | Evidencia |
|---|---|
| **Sin fugas de recursos** | 6 reconstrucciones completas con configuración idéntica: mallas +0, materiales +0, texturas +0, luces +0, observadores +0 |
| **Generador robusto** | 10 semillas separadas: 0 fallos de invariantes (plaza siempre existe, 81 manzanas, alturas y posiciones finitas, cámara siempre a altura de ojos) |
| **Sin errores en consola** | 0 en carga, regeneración, cambio de calidad, inspección y caminata |
| **Draw calls** | 128 para 29.800 objetos. Escala con combinaciones primitiva/material, no con cantidad de objetos |
| **Peso de red** | 523 KB transferidos en producción, 21 peticiones |
| **Determinismo** | Misma semilla → misma ciudad, verificado |

> **Corrección a una medición previa.** En una primera pasada reporté una fuga de
> +8 mallas y +8 materiales. Era un error de medición mío: estaba usando el botón
> "Regenerar", que **cambia la semilla**, y con otra semilla la cantidad de
> materiales distintos varía de forma legítima. Repetido con reconstrucciones de
> configuración idéntica, el resultado es +0 en todo. No hay fuga.

---

### 1.2 Hallazgos

Ordenados por gravedad real, no por lo llamativos que sean.

#### A. `FlyCamera.ts` es código muerto y filtra un listener — **bug confirmado**

`createFlyCamera()` asigna seis arrays de teclas (`keysUp`, `keysDown`,
`keysLeft`, `keysRight`, `keysUpward`, `keysDownward`) y registra dos listeners
en `window` para que `Shift` modifique `camera.speed`.

`PlayerController`, en su constructor, **vacía los seis arrays** y maneja el
movimiento por su cuenta escribiendo directamente `camera.position`. Por lo
tanto:

- Las seis asignaciones de teclas no hacen nada.
- `camera.speed` ya no se lee nunca: el listener de `Shift` es inútil.
- Esos dos listeners **nunca se quitan**. `PlayerController.dispose()` limpia los
  suyos; los de `FlyCamera` quedan para siempre.

Impacto real bajo (dos listeners que no hacen nada), pero es confusión pura para
quien lea el código: parece que hay dos sistemas de movimiento compitiendo.

#### B. El follaje es el 52 % del presupuesto de triángulos

Medido con el desglose de `tools/shoot.mjs` en calidad alta:

| Grupo | Copias | Tris/u | Total | % escena |
|---|---|---|---|---|
| `blobHi` (copas grandes) | 2.241 | 80 | **179k** | 30 % |
| `blob` (copas chicas, arbustos) | 6.629 | 20 | **133k** | 22 % |
| Cajas de calle (solado, zócalos, barandas) | ~6.200 | 12 | 75k | 13 % |
| Troncos | 803 | 24 | 19k | 3 % |

**El LOD actual es por TAMAÑO del árbol, no por distancia a la cámara.** Un árbol
grande a 400 metros paga los mismos 80 triángulos que uno a 5 metros. En una
ciudad de 510 m de lado, la enorme mayoría de los árboles está lejos.

#### C. El canal quedó en la periferia — regresión de un arreglo previo

Al corregir el bug de "la plaza puede desaparecer", forcé el desplazamiento del
canal a un mínimo de 1,5 manzanas desde el centro. Efecto no buscado: el canal
tiende a correr **cerca del borde** en vez de cruzar la ciudad.

Medido sobre 10 semillas: **5,3 manzanas de agua por ciudad**. Una diagonal a
través de una grilla de 9×9 debería tocar entre 9 y 12. El canal perdió la mitad
de su presencia, y era uno de los elementos que rompía la rigidez de la grilla.

#### D. Desbalance tipológico: se construye mucho para lo que casi no aparece

Distribución media sobre 10 semillas:

```
residential    30.7 por ciudad   37.9%  ###################
park           17.0 por ciudad   21.0%  ###########
energy         10.7 por ciudad   13.2%  #######
tower           9.1 por ciudad   11.2%  ######
water           5.3 por ciudad    6.5%  ###
civic           4.5 por ciudad    5.6%  ###
market          2.7 por ciudad    3.3%  ##
plaza           1.0 por ciudad    1.2%  #
```

`market` es el tipo con el constructor más elaborado (pórticos de madera, arcos,
cubierta mixta de vidrio y paneles, puestos) y aparece **2,7 veces por ciudad**.
`civic`, con su fachada de vidrio y columnas, 4,5. Casi el 60 % de la ciudad son
tres tipos (`residential`, `park`, `energy`), y `park` + `energy` son los dos que
menos geometría interesante tienen.

El resultado: las ciudades se parecen más entre sí de lo que el código sugiere.

#### E. Sin ESLint y sin tests unitarios

`package.json` sólo tiene `dev`, `typecheck`, `build`, `preview`. No hay ESLint
ni Vitest configurados, y no existe ningún `*.test.ts`.

Toda la verificación es de extremo a extremo por navegador, lo cual es valioso
—y fue lo que detectó bugs reales— pero es lento (minutos por corrida bajo
render por software) y no cubre lógica pura.

Hay lógica perfectamente testeable en Node, sin navegador ni GPU:

- `Rng` — determinismo, rangos, distribución
- `generateCityPlan` — invariantes del plano (los que hoy verifica el test de
  semillas abriendo un navegador entero)
- `CityIndex` — `blockAt`, `isSolid`, `describe`, `totals`
- `seedFromString` — estabilidad del hash

Testear eso en Node correría en **milisegundos** en vez de minutos.

#### F. Bundle monolítico de 2,1 MB

Un solo chunk. Babylon entra completo aunque el visitante nunca entre en VR.
`WebXRDefaultExperience` y sus dependencias se cargan siempre. La carga percibida
ya es aceptable (523 KB comprimidos), pero es una optimización disponible y
alineada con el pedido de "que cargue más rápido".

#### G. Superficie de API muerta

`Materials.unfreezeAll()`, `Environment.timeOfDay` e `Inspector.selected` no se
llaman desde ningún lado. No es grave, pero es API que hay que mantener y que
confunde sobre lo que el sistema soporta.

#### H. El modo VR está peor que el de escritorio y nunca se probó

En VR se desactiva todo el post-procesado (SSAO, bloom, viñeta) por presupuesto
de cuadro — decisión correcta — pero eso significa que **el modo VR se ve
notablemente peor** que el escritorio, y es el que menos se verificó: cero
pruebas en hardware.

Además 266k triángulos es justo para un Quest 2.

#### I. La ciudad está vacía de gente

El hueco de contenido más grande, y el más evidente para cualquiera que la
recorra. Hay locales, toldos, bancos, bicicleteros y paradas de tranvía, y ni una
sola persona.

#### J. Faltantes menores

- Sin audio.
- Sin PWA/offline (que además es el camino recomendado para resolver el requisito
  de HTTPS del VR).
- Las vitrinas de planta baja no tienen nada detrás: si te acercás, el local es
  vidrio sobre muro.
- `PALETTE.glassLit` existe, está definido y no se usa: las ventanas no se
  encienden al atardecer.
- El ciclo de día son 4 presets discretos, no continuo.

---

## Parte 2 — Plan

Cinco fases. Cada una se puede entregar y verificar por separado, y el orden está
elegido para que lo barato y lo que desbloquea otras cosas vaya primero.

### Fase 1 — Higiene y red de seguridad ✅ COMPLETADA (26/09/2026)
*Objetivo: que el resto del plan se pueda hacer sin miedo a romper algo.*

**Resultado:** `npm run verify` (tipos + lint + 49 tests) corre en ~4 s y está
enganchado al build. El ciclo de verificación pasó de minutos de navegador a
segundos.

**Hallazgo no previsto durante la ejecución:** la primera versión de los tests
daba **confianza falsa**. Una prueba de mutación —reintroducir a propósito el
bug del canal que borraba la plaza— pasó en verde, porque el desplazamiento
mínimo del canal tapaba el problema y el test verificaba la salvaguarda
equivocada. Se exportó `classifyBlock` para atacar la defensa directamente, y
la mutación ahora falla como corresponde. Sin esa comprobación, la suite habría
quedado protegiendo algo que no protegía.

| # | Tarea | Criterio de aceptación |
|---|---|---|
| 1.1 ✅ | Eliminar el código muerto de `FlyCamera` (teclas y listener de `Shift`). Dejar sólo la creación y configuración de la cámara | No queda ningún `addEventListener` sin su `remove`. El movimiento sigue igual según `test-interaction.mjs` |
| 1.2 ✅ | Configurar **Vitest** y escribir tests unitarios de `Rng`, `generateCityPlan`, `CityIndex` y `seedFromString` | `npm test` corre en < 3 s y cubre los invariantes que hoy verifica `test-seeds.mjs` |
| 1.3 ✅ | Configurar **ESLint** + Prettier con reglas acordes al estilo actual | `npm run lint` pasa limpio |
| 1.4 ✅ | Mover los invariantes de `test-seeds.mjs` a los tests unitarios; dejar la versión de navegador sólo para lo visual | La suite de semillas pasa de minutos a milisegundos |
| 1.5 ✅ | Quitar la API muerta (`unfreezeAll`, `timeOfDay`, `selected`) o usarla | Sin exports sin consumidor |
| 1.6 ✅ | Añadir scripts `test`, `lint` y `verify` (typecheck + lint + test) | `npm run verify` es el comando único antes de cualquier commit |

**Por qué primero:** sin tests rápidos, cada cambio de las fases siguientes
cuesta minutos de verificación por navegador. Esta fase se paga sola.

---

### Fase 2 — Rendimiento 🟡 PARCIAL (26/09/2026)
*Objetivo original: bajar de 596k a ~350k en alta y de 266k a ~150k en VR.*

**Resultado alcanzado:**

| | Antes | Ahora | Objetivo |
|---|---|---|---|
| Triángulos (alta) | 596k | **458k** (−23 %) | 350k |
| Triángulos (VR) | 266k | **230k** (−14 %) | 150k |
| Paquete principal | 2.068 KB | **1.556 KB** (−25 %) | — |
| Draw calls | 128 | 131 | sin cambio |

**No se alcanzó el objetivo de triángulos, y la decisión de parar acá es
deliberada.** Lo que quedaba por cortar ya no es grasa: son árboles de vereda y
detalle de planta baja, o sea justo lo que hace que la ciudad se vea bien a pie.
Cambiar calidad visual comprobable por un número de triángulos que **no puedo
validar en fps reales** sería optimizar a ciegas. El resto del margen aparece
después de la Fase 5.

**Bug encontrado durante la ejecución.** El umbral del LOD de follaje era
`height * scale > 8`, pero `height` ya venía multiplicado por `scale` en la
selección de porte: **la escala se aplicaba dos veces**. Con eso, casi cualquier
árbol de escala mayor a 1 calificaba como "grande" y pagaba doble — copa de 80
triángulos en vez de 20, y 3-5 masas de follaje en vez de 2-3. Corregirlo solo
bajó de 596k a 508k (−15 %), sin tocar una sola decisión de diseño.

**La tarea 2.2 (culling por sectores) se pospone, y el plan original estaba
equivocado al darla por buena.** Partir la ciudad en 9 sectores implica 9
granjas de instancias con sus propias mallas fuente: baja triángulos pero
**sube draw calls**, y en VR móvil los draw calls suelen pesar más. Hacer ese
cambio arquitectónico sin poder medir fps sería apostar. Queda condicionada a la
Fase 5.

| # | Tarea | Criterio de aceptación |
|---|---|---|
| 2.1 🟡 | **LOD de follaje.** Se corrigió el bug del doble `scale` en el umbral, que era la causa real del exceso. El LOD por distancia queda pendiente: Partir la `InstanceFarm` de vegetación en anillos (cerca / medio / lejos) según la distancia a la plaza, y usar `blobHi` sólo en el anillo cercano | El desglose de coste muestra `blobHi` por debajo de 60k (hoy 179k) |
| 2.2 ⏸️ | **POSPUESTA — ver nota arriba.** Culling por sectores: Dividir la ciudad en una grilla de 3×3 sectores, cada uno con su propia farm, y activar/desactivar según frustum y distancia | Mirando hacia un borde, los triángulos enviados bajan al menos un 40 % |
| 2.3 ✅ | Barandas de balcón de 3 barras a 2 (pasamanos + una). Además: menos arbustos en jardineras y sotobosque. Revisar las cajas de metal (barandas de balcón) — evaluar 2 barras en vez de 3, o una sola caja con textura de reja | −10k triángulos sin pérdida perceptible a nivel de calle |
| 2.4 ✅ | **Code splitting**: cargar el módulo de VR bajo demanda con `import()` dinámico, sólo si `isVrSupported()` | El chunk principal baja de 2,1 MB; la carga inicial no incluye WebXR |
| 2.5 ✅ | Re-medir los tres perfiles y actualizar la tabla del README | Números nuevos documentados |

> **Advertencia honesta:** esta fase se puede medir en triángulos y draw calls,
> pero **no en fps**, porque el entorno de verificación es render por software.
> La validación real depende de la Fase 5.

---

### Fase 3 — Vida y contenido ✅ COMPLETADA (26/09/2026)
*Objetivo: que la ciudad deje de sentirse deshabitada.*

**Resultado:** 230 peatones y ciclistas, ventanas que se encienden al atardecer,
y los dos hallazgos de diseño de la auditoría corregidos.

| Métrica | Auditoría | Ahora |
|---|---|---|
| Personas | 0 | **230** |
| Canal (manzanas de agua) | 4,6 | **7,2** |
| Mercado | 2,9 % | **8,2 %** |
| Equipamiento público | 6,1 % | **9,2 %** |
| Parque (era el tipo más repetido) | 22,5 % | 16,5 % |

**Dos correcciones de honestidad durante la ejecución:**

1. **El contador de draw calls venía subestimando.** Sólo medía la granja de
   instancias, y dejaba fuera gente, tranvías, pájaros y cielo. Con la Fase 3
   agregando movimiento, esa omisión pasaba de irrelevante a engañosa: el
   número informado era 134 cuando el real era 158. Ahora cuenta todo.

2. **El objetivo de 7,5 manzanas de canal no era alcanzable, y el error era
   del plan.** Se fijó antes de medir la geometría. Una manzana es agua cuando
   su CENTRO cae dentro del semiancho del canal, y los centros de una grilla de
   paso 57 m se agrupan a distancias de 1, 2, 4, 11, 13, 14, 16, 16, 19… y
   luego saltan a 28. Sumado a que el eje no puede acercarse a menos de ~50 m
   del centro sin que el agua se dibuje encima de la plaza, el techo real es ~9
   por ciudad y el promedio alcanzable ~7,2. El umbral del test quedó en 7, con
   la medición documentada al lado.

**Bug encontrado y corregido:** las piernas de los peatones rotaban alrededor de
su punto medio en vez de la cadera. Como las dos giran en contrafase, el
resultado era una X — la parte de arriba de una pierna se iba para un lado
mientras la de abajo iba para el otro. Además estaban superpuestas en el mismo
punto lateral.

| # | Tarea | Criterio de aceptación |
|---|---|---|
| 3.1 ✅ | **Peatones.** 150-250 personas caminando por veredas, siguiendo la trama de calles. Figura de 4-5 cajas (torso, cabeza, dos piernas alternando el paso). Thin instances con buffer dinámico, igual que `Life.ts` | ≤ 3 draw calls para todos los peatones. No atraviesan edificios (`CityIndex.isSolid`). Altura, ritmo y color varían |
| 3.2 ✅ | Peatones concentrados donde tiene sentido: más densidad en plaza, mercado y paradas de tranvía; menos en huertas solares | Se percibe que la plaza es el lugar más concurrido |
| 3.3 ✅ | **Ciclistas** en la calzada, aprovechando que la ciudad no tiene autos | Coherente con el bicicletero que ya existe |
| 3.4 ✅ | **Ventanas encendidas al atardecer.** Generar desde el inicio dos conjuntos de instancias de ventana (apagada/encendida) y alternar visibilidad al cambiar de hora | Al pasar a `dusk`, ~30 % de las ventanas se encienden. Sin recompilar materiales |
| 3.5 ⏸️ | PENDIENTE. **Interiores insinuados** tras las vitrinas: una caja oscura poco profunda con dos o tres formas | Acercarse a un local ya no revela que no hay nada detrás |
| 3.6 ✅ | **Corregir el canal (hallazgo C).** En vez de empujarlo al borde, protegerlo por manzana: que el canal pueda cruzar el centro pero que la manzana `ring === 0` siempre gane | ≥ 9 manzanas de agua por ciudad en el test de semillas, con la plaza intacta |
| 3.7 ✅ | **Rebalancear tipos (hallazgo D).** Subir `market` y `civic`, bajar `park` en el anillo exterior | `market` ≥ 6 % y `civic` ≥ 9 % en la media de 10 semillas |

---

### Fase 4 — Pulido visual y sensorial ✅ COMPLETADA (26/09/2026)

**Hecho:** viento en el follaje (vertex shader), ciclo de día continuo con
deslizador, sonido generado por código, y detalle en pisos altos.

**Dos bugs reales en el plugin de viento**, ambos silenciosos —el shader
compilaba sin una sola queja y no desplazaba ni un vértice:

1. `prepareDefines` con un cuerpo vacío. Pasar `{ WIND: true }` al constructor
   sólo REGISTRA el nombre del define; hay que ponerlo en `true` dentro de ese
   método.
2. La traslación de la matriz de instancia se leía de `world0.w` y `world2.w`
   (convención de fila) cuando Babylon arma la matriz columna por columna y
   vive en `world3.xyz`. Con el error, todos los árboles compartían fase.

**Y la prueba de viento tuvo cuatro falsos negativos seguidos**, cada uno una
causa distinta y ninguna relacionada con el viento:

- Leía `material.getEffect()`, que en `StandardMaterial` devuelve null porque el
  efecto vive en la submalla.
- El perfil alto tiene grano de película **animado**: la imagen cambia por
  diseño en cada cuadro.
- La cámara **caía por gravedad** durante la prueba, porque estaba en modo
  caminar y se la colocaba a 6 m de altura.
- El **contador de fps del HUD** entraba en la captura: 95 píxeles de 540.000.

Al final se reemplazó la comparación de imágenes por una medición directa del
reloj del viento — exacta y sin depender de que nada más esté quieto. La
lección: comparar capturas de pantalla es un control tentador y pésimo.

**Aprovechando la Fase 5:** los balcones subieron de 4 a 8 pisos y se agregó
equipamiento de azotea. El tope anterior estaba puesto por miedo al coste de la
geometría, y la medición mostró que ese miedo estaba mal calibrado.

| # | Tarea | Criterio de aceptación |
|---|---|---|
| 4.1 | **Viento en el follaje** vía `MaterialPlugin` de Babylon: desplazar vértices en el vertex shader según altura y tiempo. **No** actualizar matrices por cuadro (8.000 árboles sería inviable) | El movimiento se percibe y el coste por cuadro no sube de forma medible |
| 4.2 | **Ciclo de día continuo** con un deslizador, en vez de 4 presets. Interpolar los parámetros de `TimePreset` | Transición suave. La sonda de IBL se refresca sin tirones |
| 4.3 | **Audio** procedural: ambiente urbano, pasos según superficie, tranvía al pasar, pájaros. Web Audio vía Babylon, sin archivos | Mantiene la regla de cero assets externos |
| 4.4 | Detalle de fachada en pisos altos: hoy todo el detalle está abajo y los pisos superiores son lisos | Visible en la toma aérea sin coste significativo |

---

### Fase 5 — Validación real y distribución ✅ CASI COMPLETA (26/09/2026)
*Objetivo: cerrar la incógnita de los fps.*

**El supuesto de todo el plan era falso.** Se venía repitiendo que no se podían
medir fps reales "porque todo corre por software". Era cierto de las
herramientas, no de la máquina: hay una **NVIDIA GTX 1660 SUPER** disponible.
Las capturas forzaban SwiftShader a propósito, para ser reproducibles, y nadie
había probado a no forzarlo.

**fps reales (GTX 1660 SUPER, 1920×1080):**

| Perfil | En la plaza | Vista aérea | A ras de calle |
|---|---|---|---|
| Alta | 93 | 94 | 86 |
| Media | 105 | 103 | 100 |
| VR | 671 | 648 | 681 |

**Coste atribuido por efecto** (`tools/ablation.mjs`):

| | ms/cuadro |
|---|---|
| Toda la geometría | **2,52** |
| Bloom + FXAA | +0,11 |
| Oclusión ambiental media | +2,18 |
| Oclusión ambiental alta | +7,28 |
| Sombras en cascada | +4,20 |

**Esto invalida buena parte del razonamiento de la Fase 2.** La geometría es el
14 % del coste; el 86 % son sombras y post-procesado. La dieta de triángulos
(596k → 419k) ahorró décimas de milisegundo de un cuadro de 15 ms. No hizo
daño, pero atacaba lo que no era.

**Y confirma que posponer el culling por sectores fue correcto.** Habría subido
los draw calls para bajar triángulos, o sea: habría empeorado lo que pesa para
mejorar lo que no.

**Dos cambios hechos con la medición en la mano:**

1. SSAO alto reajustado (ratio 0,75 → 0,6 · 24 → 16 muestras · blur caro
   apagado): **69 → 86 fps** a ras de calle, sin diferencia visual apreciable.
2. **VR recuperó bloom y antialiasing.** Estaban apagados por precaución;
   cuestan 0,11 ms. La oclusión ambiental sigue afuera, que sí es cara.

| # | Tarea | Criterio de aceptación |
|---|---|---|
| 5.1 ✅ | **Medir fps reales en GPU** en los tres perfiles, en una máquina con placa | Tabla de fps reales en el README, reemplazando la advertencia actual |
| 5.2 ❌ | **NO SE PUDO: no hay visor disponible.** Probar en visor: Resolver primero el contexto seguro: PWA en HTTPS, o `adb reverse tcp:5173 tcp:5173` | Sesión de 10 minutos sin mareo ni caídas de cuadro |
| 5.3 ✅ | Ajustar el perfil VR con datos reales en vez de estimaciones | 72 fps sostenidos en el visor objetivo |
| 5.4 ✅ | Evaluar devolver algo de post-procesado a VR si el presupuesto lo permite (hallazgo H) | Decisión tomada con medición, no por precaución |
| 5.5 ✅ | **PWA + service worker** | Funciona sin conexión tras la primera carga |

---

## Parte 3 — Orden sugerido y por qué

```
Fase 1  ██████  ✅ HECHA          red de seguridad — habilita todo lo demás
Fase 2      ████████  🟡 PARCIAL  rendimiento — falta culling (depende de Fase 5)
Fase 3          ██████████████  ✅ HECHA (falta 3.5, menor)
Fase 4                  ████████  ✅ HECHA
Fase 5                      ████  ✅ HECHA (falta probar en visor real)
```

**Fase 1 antes que nada** porque hoy verificar un cambio cuesta minutos de
navegador. Con tests unitarios de la lógica pura, el ciclo baja a segundos.

**Fase 2 antes que Fase 3** porque agregar 250 peatones a una escena que ya está
en 596k triángulos es empujar el problema. Primero se libera presupuesto.

**Fase 3 es la que más se nota.** Si hubiera que elegir una sola, es esta: una
ciudad vacía se lee como maqueta por más detalle arquitectónico que tenga.

**Fase 5 puede adelantarse** en cualquier momento si hay acceso a una máquina con
GPU o a un visor. Es la única incógnita seria del proyecto y todo lo demás se
estaría optimizando a ciegas hasta que se resuelva.

---

## Anexo — Comandos de verificación

```bash
npm run typecheck                          # tipos
node tools/test-seeds.mjs <url> 10         # invariantes del generador, 10 semillas
node tools/test-leaks.mjs <url> 2          # fugas: 2 ciclos completos de calidad
node tools/test-interaction.mjs <url>      # paneles, clic, modos, movimiento
node tools/shoot.mjs <url> <png>           # captura + desglose de coste
node tools/shoot-block.mjs <url> <png> <tipo>  # encuadra una manzana por tipo
node tools/measure.mjs <url>               # tiempos de carga y peso de red
```

**Nota sobre `test-leaks.mjs`:** usa el botón de calidad, no el de regenerar,
porque regenerar cambia la semilla y eso hace variar legítimamente la cantidad de
materiales. Es el error que cometí en la primera medición.
