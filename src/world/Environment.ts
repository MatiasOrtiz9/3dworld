import type { Scene } from '@babylonjs/core/scene';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Observer } from '@babylonjs/core/Misc/observable';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
// El CSM usa el depth renderer para ajustar las cascadas (autoCalcDepthBounds).
// Sin este import de efecto secundario, Babylon lanza en tiempo de ejecución.
import '@babylonjs/core/Rendering/depthRendererSceneComponent';
import { ReflectionProbe } from '@babylonjs/core/Probes/reflectionProbe';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { ColorCurves } from '@babylonjs/core/Materials/colorCurves';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { SkyDome } from './Sky';
import {
  ITEMS,
  LANDINGS,
  LEVEL_Y,
  ROOMS,
  SCHOOL,
  STAIRS,
  VAULTED,
  WALKABLE,
  WALLS,
  SC,
  ceilingHeight,
  inPoly,
  planU,
  planV,
  roomLevel,
  stairY,
  type Level,
  type OpeningType,
  type Room,
} from './SchoolLayout';
import { SWITCHABLE_ROOMS } from './SchoolLights';
import {
  DEFAULT_HOUR,
  PRESETS,
  castsShadow,
  fogDensityFor,
  fogReach,
  presetAt,
  staticShadowFrame,
  sunDirection,
  type AtmospherePreset,
  type Rgb,
  type TimeOfDay,
} from './TimeOfDay';

// La API de horas sigue saliendo de acá: main.ts y el resto no tienen por qué
// saber que los datos viven en un módulo puro aparte.
export { DAY_END, DAY_START, DEFAULT_HOUR, TIME_LABELS, TIME_ORDER, formatHour } from './TimeOfDay';
export type { TimeOfDay } from './TimeOfDay';

/**
 * Cómo se proyectan las sombras del sol.
 *
 *  - `cascaded`: mapas en cascada que siguen a la cámara. Nítidas de cerca,
 *    pero se redibujan CADA cuadro (tres pasadas de toda la ciudad). Para
 *    escritorio con placa dedicada.
 *  - `static`: un único mapa sobre el barrio, que se dibuja una vez por
 *    cambio de hora. Todos los proyectores son estáticos (la gente tiene su
 *    sombra de contacto propia), así que la imagen es la misma y el costo por
 *    cuadro es sólo leer el mapa. Es lo que hace posible tener sombras en VR.
 *  - `off`: sin sombras proyectadas.
 */
export type ShadowMode = 'off' | 'static' | 'cascaded';

/** Filtrado del borde de la sombra (PCF de 1 o de 4 lecturas). */
export type ShadowFilter = 'low' | 'medium';

/**
 * Radio máximo del foco de la sombra estática: la escuela, las calles que la
 * rodean y la hilera de casas de enfrente. Con 2048 px son ~9 cm por texel.
 */
const STATIC_SHADOW_MAX_RADIUS = 95;

/**
 * Fracción del plano lejano a la que la niebla tiene que llegar al 95 % si la
 * cámara recorta antes de `fogReach`: en el corte mismo queda en ~97 %.
 * Es la inversa de QualityManager.FAR_FLOOR_FACTOR.
 */
const FOG_BEFORE_FAR = 0.92;

const toColor3 = (c: Rgb) => new Color3(c[0], c[1], c[2]);

/**
 * Gradación de la imagen. `SCREEN_GRADE` es la del escritorio (con bloom,
 * nitidez y SSAO en post-proceso); `HEADSET_GRADE`, la del visor y el
 * celular, que no tienen post-proceso. Exposición y halo multiplican;
 * contraste suma; saturaciones son las de `ColorCurves` (−100…100).
 *
 * La del visor no es "más cine": compensa lo que el post-proceso pone en
 * escritorio. Sin bloom el sol no derrama luz (el halo del cielo se ensancha
 * para eso), sin SSAO ni nitidez los volúmenes se aplanan (algo más de
 * contraste) y la lente del visor apaga un poco el color (más saturación,
 * sobre todo en las sombras, que en el Quest se veían grises).
 */
const SCREEN_GRADE = { exposure: 1, contrast: 0, saturation: 6, shadowsSaturation: 6, halo: 1 } as const;
const HEADSET_GRADE = { exposure: 1.05, contrast: 0.08, saturation: 17, shadowsSaturation: 12, halo: 1.6 } as const;

/**
 * Cielo, sol y atmósfera.
 *
 * El cielo es procedural y estilizado (ver `Sky.ts`), las horas son datos
 * puros (`TimeOfDay.ts`) y acá se traducen a luces, niebla, sombras, IBL y
 * mapeo tonal.
 *
 * La niebla es deliberada y no decorativa: en VR, una atmósfera con densidad
 * da profundidad y escala. Su densidad se calcula desde el tamaño del mundo,
 * así el mismo preajuste funde el borde del suelo tanto en la grilla grande
 * como en el barrio compacto, sin velar nunca la escuela.
 */
export class Environment {
  readonly sun: DirectionalLight;
  readonly ambient: HemisphericLight;
  readonly skyBox: Mesh;
  private readonly sky: SkyDome;
  private shadows: ShadowGenerator | null = null;
  private mode: ShadowMode = 'off';
  private shadowResolution = 0;
  private activeShadowResolution = 0;
  private probe: ReflectionProbe | null = null;
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  /** Exposición de la hora; la del ojo adaptado sale de multiplicarla. */
  private baseExposure = 1;
  /** Adaptación del ojo: multiplica la exposición (1 afuera). */
  private adaptation = 1;
  private readonly adaptObserver: Observer<Scene>;
  private materialObserver: Observer<Material> | null = null;
  private readonly focus = new Vector3(0, 0, 0);
  private focusRadius: number;
  private focusPinned = false;
  /** Altura del proyector más alto (la torre del barrio llega a ~80 m con la antena). */
  private casterTop = 30;
  private toSun = { x: 0, y: 1, z: 0 };
  private fogDistance: number;
  /** Plano lejano de la cámara activa con el que se calculó la densidad de la niebla. */
  private farPlane = Infinity;
  /** Luz natural horneada de la escuela (ver `bakeSchoolDaylight`). */
  private daylight: DaylightState | null = null;
  private schoolOrigin = { ox: NaN, oz: NaN };
  /** Aulas con las luces apagadas (pedido antes o después de hornear). */
  private readonly roomLights = new Map<string, boolean>();
  /** Gradación para mapeo tonal dentro de los materiales (ver `setInMaterialGrade`). */
  private inMaterialGrade = false;
  private preset: AtmospherePreset | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly worldExtent: number,
  ) {
    this.sky = new SkyDome(scene);
    this.skyBox = this.sky.mesh;
    this.focusRadius = Math.min(STATIC_SHADOW_MAX_RADIUS, worldExtent);
    this.fogDistance = fogReach(worldExtent);

    this.ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
    // Sin especular: el reflejo ambiente lo da el IBL. La especular de la
    // hemisférica pintaba un brillo cenital uniforme sobre todo lo pulido.
    this.ambient.specular = Color3.Black();
    this.sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.4), scene);
    this.sun.autoUpdateExtends = false;

    scene.fogMode = 2; // FOGMODE_EXP2: limpia de cerca, cierra rápido al fondo
    scene.clearColor = new Color4(0.75, 0.8, 0.85, 1);

    // Mapeo tonal ACES.
    //
    // PBR trabaja en rango dinámico alto: sin mapeo tonal, todo lo que supera
    // 1.0 se recorta a blanco y la ciudad parece una maqueta de papel. ACES
    // comprime los altos con una curva de cine.
    //
    // En Babylon esto se compila DENTRO del shader del material cuando no hay
    // post-proceso: en VR no cuesta un segundo pase de pantalla completa.
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    // Gradación de color sutil: altas luces apenas cálidas, sombras apenas
    // frías. Es la diferencia de temperatura entre el sol y el cielo, llevada
    // también a la imagen; una pizca de saturación devuelve lo que ACES le
    // quita a los medios tonos (maderas, verdes, el rojo institucional).
    // A la mitad de lo que era: con más, la imagen viraba a "película"
    // (sombras azuladas, rojos encendidos) en vez de verse como una foto.
    const curves = new ColorCurves();
    curves.globalSaturation = SCREEN_GRADE.saturation;
    curves.highlightsHue = 38;
    curves.highlightsDensity = 5;
    curves.highlightsSaturation = 5;
    curves.shadowsHue = 215;
    curves.shadowsDensity = 5;
    curves.shadowsSaturation = SCREEN_GRADE.shadowsSaturation;
    ip.colorCurves = curves;
    ip.colorCurvesEnabled = true;

    this.applyHour(DEFAULT_HOUR);
    this.adaptObserver = scene.onBeforeRenderObservable.add(() => {
      this.trackFarPlane();
      this.adaptExposure();
    });
  }

  /**
   * Distancia a la que la niebla funde el suelo (95 %). QualityManager no
   * deja que el plano lejano adaptativo baje de ahí (ver `setFogReach`).
   */
  get fogReach(): number {
    return this.fogDistance;
  }

  /**
   * La niebla tiene que cerrar ANTES del plano lejano de la cámara que dibuja.
   * Si alguna cámara lo trae más corto que la niebla, el suelo y la ciudad de
   * fondo se cortaban a medio fundir y debajo asomaba el cielo bajo el
   * horizonte (marrón). Se espesa sólo lo justo para llegar al 95 % un poco
   * antes del corte. Una comparación por cuadro; la densidad se recalcula
   * sólo cuando cambia el plano (nivel adaptativo, entrar o salir del visor).
   */
  private trackFarPlane(): void {
    const cam = this.scene.activeCamera;
    if (!cam) return;
    // maxZ 0 es plano lejano infinito en Babylon.
    const far = cam.maxZ > 0 ? cam.maxZ : Infinity;
    if (far === this.farPlane) return;
    this.farPlane = far;
    if (this.preset) this.applyFogDensity(this.preset);
  }

  private applyFogDensity(p: AtmospherePreset): void {
    const reach = Math.min(this.fogDistance, this.farPlane * FOG_BEFORE_FAR);
    this.scene.fogDensity = fogDensityFor(reach, p.fogThickness);
  }

  /**
   * Adaptación del ojo: bajo techo la exposición sube de a poco, como en un
   * ojo o una cámara que entra a un aula desde la vereda al sol. Sin ella,
   * con la luz natural de los interiores (ver `bakeSchoolDaylight`), o el
   * aula se veía oscura o la calle quemada. Sutil y lenta a propósito: es lo
   * que hace el ojo, no un efecto; en el visor también, porque la pupila
   * real no ve la pantalla más brillante.
   */
  private adaptExposure(): void {
    const s = this.daylight;
    // Un interruptor cambió el mapa: una subida, en este cuadro y no en cada uno.
    if (s?.dirty) {
      s.light.update(s.lightData);
      s.dirty = false;
    }
    const cam = this.scene.activeCamera;
    if (!s || !cam || !Number.isFinite(s.ox)) return;
    const p = cam.globalPosition;
    const g = DAYLIGHT_GRID;
    const i = Math.floor((s.ox - p.x - g.u0) / g.cell);
    const j = Math.floor((p.z - s.oz - g.v0) / g.cell);
    // Cuánto se abre la pupila: más en un aula con poca luz que en un
    // pasillo vidriado al patio (que ya está casi tan claro como afuera).
    let target = 1;
    if (i >= 0 && j >= 0 && i < g.width && j < g.height) {
      const feet = p.y - 1.5;
      const level = feet >= LEVEL_Y[2] - 0.6 ? 2 : feet >= LEVEL_Y[1] - 0.6 ? 1 : 0;
      const k = j * g.width + i;
      if (s.indoor[k] & (1 << level)) {
        const local = Math.max(0.3, s.lightData[k * 4 + level] / 128);
        target = Math.max(1, Math.min(INDOOR_EXPOSURE_MAX, INDOOR_EXPOSURE / Math.sqrt(local)));
      }
    }
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
    // El ojo se adapta más rápido a la luz que a la penumbra.
    const tau = target > this.adaptation ? EYE_ADAPT_IN : EYE_ADAPT_OUT;
    this.adaptation += (target - this.adaptation) * (1 - Math.exp(-dt / tau));
    const exposure = this.baseExposure * this.adaptation;
    const ip = this.scene.imageProcessingConfiguration;
    if (Math.abs(ip.exposure - exposure) > 0.002) ip.exposure = exposure;
  }

  /**
   * Imagen sin post-proceso (visor y celular): el mapeo tonal va dentro de
   * cada material y no hay bloom, nitidez ni oclusión en pantalla que le den
   * cuerpo. Sin ellos la misma gradación se veía lavada y gris dentro del
   * visor ("triste"): se compensa con un poco más de exposición, contraste
   * y saturación, y el halo del sol más ancho hace de bloom. Se fija antes
   * de congelar los materiales (cada perfil reconstruye la escuela).
   */
  setInMaterialGrade(on: boolean): void {
    if (this.inMaterialGrade === on) return;
    this.inMaterialGrade = on;
    const g = on ? HEADSET_GRADE : SCREEN_GRADE;
    const curves = this.scene.imageProcessingConfiguration.colorCurves;
    if (curves) {
      curves.globalSaturation = g.saturation;
      curves.shadowsSaturation = g.shadowsSaturation;
    }
    if (this.preset) this.applyPreset(this.preset);
  }

  /** Hora continua del día, entre DAY_START y DAY_END. */
  applyHour(hour: number): void {
    this.applyPreset(presetAt(hour));
  }

  /** Fija una hora concreta a partir de un preajuste con nombre. */
  apply(time: TimeOfDay): void {
    this.applyPreset(PRESETS[time]);
  }

  /**
   * Centro y radio del barrio que importa: la sombra estática gasta ahí toda
   * su resolución y la sonda de IBL se ubica encima. Opcional: sin llamarla,
   * el foco sale del volumen de los proyectores de sombra.
   */
  setFocus(center: { x: number; z: number }, radius = STATIC_SHADOW_MAX_RADIUS): void {
    this.focus.set(center.x, 0, center.z);
    this.focusRadius = Math.max(20, radius);
    this.focusPinned = true;
    if (this.mode === 'static') this.frameStaticShadow();
  }

  /**
   * Origen local de la escuela en el mundo (`City.schoolFrame`): ubica sobre
   * la escuela el mapa de luz natural de los interiores. Se puede llamar antes
   * o después de `captureEnvironment`.
   */
  setSchool(frame: { ox: number; oz: number }): void {
    this.schoolOrigin = { ox: frame.ox, oz: frame.oz };
    if (this.daylight) {
      this.daylight.ox = frame.ox;
      this.daylight.oz = frame.oz;
    }
  }

  /**
   * Prende o apaga las luminarias de un aula (interruptor del juego o cambio
   * de fase): baja la parte "luz artificial" de su mapa de luz. Una sola
   * subida de la textura en el cuadro siguiente, sin costo por cuadro; sirve
   * igual en el visor, donde no hay otra luz interior que este mapa.
   */
  setRoomLights(roomId: string, on: boolean): void {
    if (on) this.roomLights.delete(roomId);
    else this.roomLights.set(roomId, false);
    if (this.daylight) this.writeRoomLights(this.daylight, roomId, on);
  }

  private writeRoomLights(s: DaylightState, roomId: string, on: boolean): void {
    const room = s.bake.rooms.get(roomId);
    if (!room) return;
    const { idx, off } = room;
    const src = s.bake.light;
    for (let i = 0; i < idx.length; i++) s.lightData[idx[i]] = on ? src[idx[i]] : off[i];
    s.dirty = true;
  }

  /** Modo de sombras activo. */
  get shadowMode(): ShadowMode {
    return this.mode;
  }

  private applyPreset(p: AtmospherePreset): void {
    this.preset = p;
    const g = this.inMaterialGrade ? HEADSET_GRADE : SCREEN_GRADE;
    const d = sunDirection(p.elevation, p.azimuth);
    this.toSun = d;
    const toSun = new Vector3(d.x, d.y, d.z);

    this.sky.set(g.halo === 1 ? p : { ...p, sunGlow: p.sunGlow * g.halo }, d);

    // La luz direccional apunta DESDE el sol hacia la escena.
    this.sun.direction = toSun.scale(-1);
    this.sun.diffuse = toColor3(p.sunColor);
    // Especular del sol con su color pleno: los destellos en vidrios y pisos
    // pulidos son de lo que más "cine" aporta con sol bajo.
    this.sun.specular = toColor3(p.sunColor).scale(0.9);
    this.sun.intensity = p.sunIntensity;

    this.ambient.diffuse = toColor3(p.hemiSky);
    this.ambient.groundColor = toColor3(p.hemiGround);
    this.ambient.intensity = p.hemiIntensity;

    const fog = toColor3(p.horizon);
    this.scene.fogColor = fog;
    this.applyFogDensity(p);
    this.scene.clearColor = new Color4(fog.r, fog.g, fog.b, 1);

    const ip = this.scene.imageProcessingConfiguration;
    this.baseExposure = p.exposure * g.exposure;
    ip.exposure = this.baseExposure * this.adaptation;
    ip.contrast = p.contrast + g.contrast;

    this.scene.environmentIntensity = p.envIntensity;

    if (this.mode === 'static') this.frameStaticShadow();
    // Al cambiar la hora cambia el cielo, y con él la luz ambiental: hay que
    // volver a capturar la sonda una vez.
    this.probe?.cubeTexture.resetRefreshCounter();
  }

  /**
   * Captura el cielo para la iluminación basada en imagen (IBL).
   *
   * Sin `scene.environmentTexture`, todo material PBR con algo de metalicidad
   * se ve negro y los materiales rugosos pierden el rebote del cielo. La
   * sonda dibuja SÓLO el cielo (la ciudad formaría un bucle de
   * realimentación: los materiales leerían la textura que se está
   * escribiendo) una vez por cambio de hora.
   *
   * En coma flotante: el halo del sol y las nubes iluminadas pasan de 1.0, y
   * en 8 bits el reflejo del cielo en vidrios y pisos se aplanaba a gris.
   * 256 px: los vidrios casi espejados reflejan las nubes sin pixelarlas.
   *
   * Hay que llamarla cuando la ciudad ya está construida.
   */
  captureEnvironment(): void {
    this.probe?.dispose();
    const probe = new ReflectionProbe('skyEnv', 256, this.scene, true, true);
    probe.position.set(this.focus.x, 20, this.focus.z);
    probe.renderList = [this.skyBox];
    probe.refreshRate = 0; // REFRESHRATE_RENDER_ONCE: el cielo no cambia solo
    probe.cubeTexture.coordinatesMode = Texture.CUBIC_MODE;
    probe.cubeTexture.gammaSpace = false;
    // Mientras se dibuja la sonda, el cielo entrega luz lineal sin mapeo
    // tonal (ver SkyDome.probeMode).
    probe.cubeTexture.onBeforeRenderObservable.add(() => {
      this.sky.probeMode = true;
    });
    probe.cubeTexture.onAfterRenderObservable.add(() => {
      this.sky.probeMode = false;
    });

    this.scene.environmentTexture = probe.cubeTexture;
    this.probe = probe;
    this.applySchoolDaylight();
  }

  /**
   * Engancha el mapa de luz natural a los materiales de la escuela y de su
   * equipamiento (prefijos `i:` y `s:` de `Materials`). Antes de congelarlos:
   * el plugin agrega su código al shader.
   */
  private applySchoolDaylight(): void {
    if (this.daylight) return;
    const bake = (cachedDaylight ??= bakeSchoolDaylight());
    const make = (data: Uint8Array, name: string) => {
      const tex = RawTexture.CreateRGBATexture(data, bake.width, bake.height, this.scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
      tex.name = name;
      tex.wrapU = Texture.CLAMP_ADDRESSMODE;
      tex.wrapV = Texture.CLAMP_ADDRESSMODE;
      return tex;
    };
    // Copia propia: el horneado se reutiliza entre reconstrucciones y los
    // interruptores escriben sobre ésta.
    const lightData = bake.light.slice();
    const state: DaylightState = {
      light: make(lightData, 'schoolDaylight'),
      cover: make(bake.cover, 'schoolCover'),
      dir: make(bake.dir, 'schoolLightDir'),
      indoor: bake.indoor,
      lightData,
      bake,
      dirty: false,
      ox: this.schoolOrigin.ox,
      oz: this.schoolOrigin.oz,
    };
    for (const [id, on] of this.roomLights) this.writeRoomLights(state, id, on);
    this.daylight = state;
    for (const mat of this.scene.materials) attachDaylight(mat, state);
    // La gente y las puertas del juego se crean después: se enganchan al
    // aparecer, una vez terminado su constructor y antes de compilar.
    this.materialObserver = this.scene.onNewMaterialAddedObservable.add((mat) => {
      void Promise.resolve().then(() => {
        if (this.daylight === state && !mat.isFrozen) attachDaylight(mat, state);
      });
    });
  }

  /**
   * Activa las sombras del sol.
   *
   * @param casters mallas fuente de la ciudad; acá se filtran las que no
   *   deben proyectar (vidrios, losas a ras del suelo) pero todas reciben.
   * @param resolution lado del mapa (o de cada cascada).
   * @param mode `static` por omisión: es la opción segura en cualquier
   *   equipo; `cascaded` sólo para escritorio con placa dedicada.
   * @param filter `low` (1 lectura con PCF por hardware) o `medium` (4).
   */
  enableShadows(
    casters: Mesh[],
    resolution: number,
    mode: ShadowMode = 'static',
    filter: ShadowFilter = mode === 'cascaded' ? 'medium' : 'low',
  ): void {
    this.disableShadows();
    if (mode === 'off' || resolution <= 0) return;

    const casting: Mesh[] = [];
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of casters) {
      mesh.receiveShadows = true;
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      const transparent = Boolean(mesh.material?.needAlphaBlending());
      if (!castsShadow({ minY: box.minimumWorld.y, maxY: box.maximumWorld.y, transparent })) continue;
      casting.push(mesh);
      min.minimizeInPlace(box.minimumWorld);
      max.maximizeInPlace(box.maximumWorld);
    }
    // La cámara de la sombra estática tiene que quedar por encima del
    // proyector más alto: con 30 m fijos, con el sol rasante la punta de la
    // torre de 66 m del barrio podía caer detrás del plano cercano y su
    // sombra sobre la escuela salía recortada.
    if (Number.isFinite(max.y)) this.casterTop = Math.max(30, max.y + 2);
    if (!this.focusPinned && casting.length && Number.isFinite(min.x)) {
      // Foco automático: el centro del volumen de los proyectores (el barrio
      // es simétrico alrededor de la escuela) y su radio horizontal, topado.
      this.focus.set((min.x + max.x) / 2, 0, (min.z + max.z) / 2);
      const half = Math.hypot(max.x - min.x, max.z - min.z) / 2;
      this.focusRadius = Math.max(20, Math.min(STATIC_SHADOW_MAX_RADIUS, half));
    }

    const gen =
      mode === 'cascaded' ? this.createCascaded(resolution) : new ShadowGenerator(resolution, this.sun);
    // Sólo las caras de atrás proyectan: la profundidad guardada es la de la
    // cara que NO mira al sol, así que la cara iluminada nunca se sombrea a
    // sí misma. Sin esto la fachada de Laprida al sol salía con rayas
    // verticales (fuertes con el mapa estático del visor y en las cascadas
    // del nivel adaptativo 1) y las copas con puntitos. Exige que todo
    // proyector sea cerrado o tenga un cielorraso con cara inferior debajo:
    // una losa abierta sin cielorraso dejaría pasar el sol.
    gen.forceBackFacesOnly = true;
    gen.usePercentageCloserFiltering = true;
    gen.filteringQuality =
      filter === 'medium' ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
    for (const mesh of casting) gen.addShadowCaster(mesh, false);

    this.shadows = gen;
    this.mode = mode;
    this.shadowResolution = resolution;
    this.activeShadowResolution = resolution;

    if (gen instanceof CascadedShadowGenerator) {
      // Los proyectores no se mueven: calcular su volumen una vez, no en
      // cada cuadro (recorrer ~200 cajas por cuadro es CPU tirada).
      gen.freezeShadowCastersBoundingInfo = true;
    } else {
      this.setupStatic(gen);
    }
  }

  private createCascaded(resolution: number): CascadedShadowGenerator {
    this.sun.autoUpdateExtends = false;
    this.sun.shadowFrustumSize = 0;
    const gen = new CascadedShadowGenerator(resolution, this.sun);
    // Tres cascadas, no cuatro: con el barrio compacto la cuarta cubría
    // calles que la niebla ya funde, y cada cascada es una pasada completa de
    // la ciudad por cuadro.
    gen.numCascades = 3;
    // Reparto casi logarítmico: la primera cascada cubre unos 5 m (medio
    // centímetro por texel): rejas, sillas y barandas proyectan sombra nítida.
    gen.lambda = 0.9;
    gen.cascadeBlendPercentage = 0.08;
    gen.stabilizeCascades = true; // evita el hervor de bordes al moverse
    gen.shadowMaxZ = Math.min(170, Math.max(80, this.worldExtent * 1.1));
    gen.depthClamp = true;
    // Ajusta las cascadas a la profundidad visible: adentro de la escuela
    // (fondo a 20 m) toda la resolución se concentra en el ambiente.
    gen.autoCalcDepthBounds = true;
    // El sesgo del CSM está en unidades normalizadas del rango de cada
    // cascada (~10 m la primera): 0,0015 ≈ 1,5 cm. El anterior (0,008) daba
    // decenas de centímetros en las lejanas: sombras "despegadas" del pie de
    // muros y postes. El sesgo normal (en metros) se lleva el acné de las
    // caras rasantes sin comerse los contactos.
    gen.bias = 0.0015;
    gen.normalBias = 0.012;
    gen.darkness = 0.05;
    return gen;
  }

  /**
   * Sombra estática: un mapa ortográfico fijo sobre el foco, que se dibuja
   * cuando cambia la hora y nunca más.
   *
   * El primer dibujo espera a que compilen los shaders de profundidad: con
   * "dibujar una vez", un proyector cuyo shader no estaba listo quedaría
   * fuera del mapa para siempre. Mientras compila, el mapa se redibuja cada
   * cuadro (sólo durante la carga) y después se repite dos veces más por
   * seguridad, por las mallas que compilan tarde.
   */
  private setupStatic(gen: ShadowGenerator): void {
    const map = gen.getShadowMap();
    if (!map) return;
    this.frameStaticShadow();
    map.refreshRate = 1;
    const settle = () => {
      if (this.shadows !== gen) return;
      map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      for (const ms of [1200, 4000]) {
        this.timers.push(
          setTimeout(() => {
            if (this.shadows === gen) map.resetRefreshCounter();
          }, ms),
        );
      }
    };
    gen.forceCompilationAsync({ useInstances: true }).then(settle, settle);
  }

  /** Recoloca la cámara de la sombra estática según el sol y el foco. */
  private frameStaticShadow(): void {
    const gen = this.shadows;
    if (!gen || this.mode !== 'static') return;
    const frame = staticShadowFrame(this.focus, this.focusRadius, this.toSun, this.casterTop);
    this.sun.autoUpdateExtends = false;
    this.sun.position = new Vector3(frame.position.x, frame.position.y, frame.position.z);
    this.sun.shadowFrustumSize = frame.size;
    this.sun.shadowMinZ = frame.minZ;
    this.sun.shadowMaxZ = frame.maxZ;
    // Sesgo en unidades normalizadas del rango del mapa: ~6 cm de
    // profundidad. El normal, del orden de medio texel (~9 cm por texel).
    const range = frame.maxZ - frame.minZ;
    gen.bias = 0.06 / range;
    gen.normalBias = Math.min(0.06, (frame.size / this.shadowResolution) * 0.45);
    gen.darkness = 0.05;
    gen.getShadowMap()?.resetRefreshCounter();
  }

  /** Baja resolución del mapa de sombras sin invalidar los shaders congelados. */
  setAdaptiveLevel(level: number): void {
    const gen = this.shadows;
    // La sombra estática no cuesta nada por cuadro: achicarla sólo la
    // empeoraría sin devolver tiempo.
    if (!gen || this.mode !== 'cascaded') return;

    const divisor = level === 0 ? 1 : level === 1 ? 2 : 4;
    const resolution = Math.max(512, Math.floor(this.shadowResolution / divisor));
    if (resolution !== this.activeShadowResolution) {
      gen.getShadowMap()?.resize({ width: resolution, height: resolution });
      this.activeShadowResolution = resolution;
    }
  }

  disableShadows(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
    if (!this.shadows) return;
    this.shadows.dispose();
    this.shadows = null;
    this.mode = 'off';
    this.shadowResolution = 0;
    this.activeShadowResolution = 0;
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.adaptObserver);
    this.scene.onNewMaterialAddedObservable.remove(this.materialObserver);
    this.materialObserver = null;
    this.probe?.dispose();
    this.probe = null;
    this.daylight?.light.dispose();
    this.daylight?.cover.dispose();
    this.daylight?.dir.dispose();
    this.daylight = null;
    this.scene.environmentTexture = null;
    this.disableShadows();
    this.sky.dispose();
    this.sun.dispose();
    this.ambient.dispose();
  }
}

// ======================================================= luz natural de la escuela

/**
 * Exposición bajo techo relativa a la de afuera (ojo adaptado), para un
 * ambiente de luz 1; se divide por la raíz de la luz del lugar y se topa:
 * un aula (~0,8) abre la pupila ~1,28×, un pasillo al patio (~1,3) casi nada.
 */
export const INDOOR_EXPOSURE = 1.15;
const INDOOR_EXPOSURE_MAX = 1.32;
/** Constantes de tiempo de la adaptación (s): hacia la penumbra y hacia la luz. */
const EYE_ADAPT_IN = 1.1;
const EYE_ADAPT_OUT = 0.6;

/**
 * Grilla en planta de la luz de la escuela: 10 cm por celda (un muro interior
 * son dos celdas, así cada cara de un muro lee SU ambiente y no el de al lado).
 */
export const DAYLIGHT_GRID = (() => {
  // Derivada del predio real (ver `SC`): del ochavo de Miguel Cané (−9,6 en el
  // plano) y el fondo (−42) hasta pasar el muro este y la línea municipal.
  const cell = 0.1;
  const u0 = -9.6 * SC;
  const v0 = -42 * SC;
  return { u0, v0, cell, width: Math.ceil((planU(72.4) - u0) / cell - 1e-6), height: Math.ceil((planV(4) - v0) / cell - 1e-6) } as const;
})();

/**
 * Calibración de la luz de los interiores (multiplica el rebote y el cielo).
 *
 *  - `base`: un ambiente sin ventanas, con las luminarias del cielorraso.
 *  - `gain` y `e0`: lo que suma la luz de las ventanas, saturando: `e0` es el
 *    ángulo sólido de cielo (sr) que da ~63 % de la ganancia. En el medio de
 *    un aula sobre Laprida ≈ 0,33 sr (factor ~0,87); en el fondo, a 6 m de
 *    las ventanas, ≈ 0,1 sr (~0,66); un pasillo abierto al patio ≈ 1,4 sr
 *    (~1,28). El promedio de un aula queda algo por debajo del rebote
 *    parejo de antes: los interiores ya no se ven lechosos.
 *  - `borrowed`: una ventana o un paso a otro ambiente techado deja pasar
 *    esa fracción de la luz de una ventana al exterior.
 *  - `corner`: oscurecimiento de los rincones (dos muros que se encuentran).
 *  - `cover`: oscurecimiento máximo bajo mesas, pupitres y escaleras.
 *  - `facing`: cuánto más (o menos) recibe una cara vertical según mire hacia
 *    las ventanas o les dé la espalda, con toda la luz de un mismo lado.
 */
export const DAYLIGHT = {
  base: 0.55,
  gain: 0.85,
  e0: 0.7,
  borrowed: 0.3,
  corner: 0.36,
  cover: 0.55,
  facing: 0.35,
  /**
   * Fracción de `base` que queda con las luminarias del aula apagadas: la
   * luz prestada del pasillo y el rebote. Las ventanas no cambian, así que
   * apagar se nota sobre todo en el fondo del aula (0,66 → ~0,41).
   */
  lightsOff: 0.55,
} as const;

/** Peso de cada tipo de vano como fuente de luz (vidrio, hoja ciega, paso libre). */
const OPENING_LIGHT: Partial<Record<OpeningType, number>> = {
  window: 1,
  high: 1,
  band: 0.9,
  entrance: 0.85,
  counter: 0.5,
  pass: 0.8,
  exit: 0.35,
  double: 0.25,
  door: 0.2,
};

/** Antepecho y dintel de cada tipo de vano (los mismos que dibuja SchoolBuilder). */
const OPENING_SPAN: Record<OpeningType, readonly [number, number]> = {
  door: [0, 2.15],
  double: [0, 2.25],
  pass: [0, 2.6],
  exit: [0, 2.3],
  entrance: [0, 2.75],
  window: [0.95, 2.35],
  high: [4.3, 6.2],
  band: [1.95, 2.75],
  counter: [0.95, 2.05],
};

/** Cielo cenital (sr equivalentes) de los ambientes bajo una bóveda con franjas traslúcidas. */
const SKYLIGHT: Partial<Record<string, number>> = { gimnasio: 0.55 };

/** Cara de abajo de la tapa de cada mesa: debajo, la luz llega rasante y poca. */
const COVER_TOP: Partial<Record<string, number>> = {
  desk: 0.7,
  table: 0.72,
  teacherDesk: 0.73,
  hexTable: 0.71,
  roundTable: 0.55,
  workbench: 0.74,
  longTable: 0.74,
  desk2: 0.74,
};

export interface DaylightBake {
  width: number;
  height: number;
  /** RGBA por celda: luz de planta baja, primer y segundo piso (128 = 1,0). */
  light: Uint8Array;
  /** RGBA por celda: alto (m / 4) de lo que tapa el piso en cada nivel. */
  cover: Uint8Array;
  /**
   * RGBA por celda: de dónde llega la luz de las ventanas, en el MUNDO
   * (x, z) de planta baja y primer piso; 128 = sin dirección.
   */
  dir: Uint8Array;
  /** Por celda, un bit por nivel: 1 si está bajo techo (adaptación del ojo). */
  indoor: Uint8Array;
  /**
   * Aulas con interruptor: qué bytes de `light` son suyos (`celda·4 + nivel`)
   * y cuánto valen con sus luminarias apagadas.
   */
  rooms: Map<string, { idx: Uint32Array; off: Uint8Array }>;
}

type V3 = readonly [number, number, number];

/** Ángulo sólido de un triángulo visto desde el origen (Van Oosterom–Strackee). */
function triangleSolidAngle(a: V3, b: V3, c: V3): number {
  const la = Math.hypot(a[0], a[1], a[2]);
  const lb = Math.hypot(b[0], b[1], b[2]);
  const lc = Math.hypot(c[0], c[1], c[2]);
  const det =
    a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  const ab = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const ac = a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
  const bc = b[0] * c[0] + b[1] * c[1] + b[2] * c[2];
  const den = la * lb * lc + ab * lc + ac * lb + bc * la;
  return 2 * Math.abs(Math.atan2(det, den));
}

interface LightQuad {
  /** Esquinas en (u, y, v). */
  q: readonly [V3, V3, V3, V3];
  weight: number;
}

function roomAtLevel(level: Level, u: number, v: number): Room | null {
  for (const r of ROOMS) if (roomLevel(r) === level && inPoly(r.poly, u, v)) return r;
  return null;
}

/**
 * Vanos por los que entra luz a un ambiente: ventanas y pasos en los muros
 * que lo bordean, recortados a su altura. Del otro lado puede haber cielo
 * (calle, patio) o un ambiente techado (luz prestada, más débil).
 */
function roomLightSources(room: Room): LightQuad[] {
  const level = roomLevel(room);
  const y0 = LEVEL_Y[level];
  const y1 = y0 + ceilingHeight(room);
  const out: LightQuad[] = [];
  for (const w of WALLS) {
    const base = w.level * SCHOOL.storey;
    if (base > y1 || base + w.h < y0) continue;
    const du = w.b[0] - w.a[0];
    const dv = w.b[1] - w.a[1];
    const len = Math.hypot(du, dv);
    if (len < 1e-3) continue;
    const nu = -dv / len;
    const nv = du / len;
    for (const o of w.openings) {
      const weight0 = OPENING_LIGHT[o.type];
      if (!weight0) continue;
      const [hb, ht] = OPENING_SPAN[o.type];
      const lo = Math.max(y0, base + (o.hb ?? hb));
      const hi = Math.min(y1, base + Math.min(o.ht ?? ht, w.h - 0.15));
      if (hi - lo < 0.1) continue;
      const tm = (o.t0 + o.t1) / 2;
      const mu = w.a[0] + (du / len) * tm;
      const mv = w.a[1] + (dv / len) * tm;
      // ¿De qué lado del muro está el ambiente? El otro lado dice qué luz entra.
      let side = 0;
      if (inPoly(room.poly, mu + nu * 0.35, mv + nv * 0.35)) side = 1;
      else if (inPoly(room.poly, mu - nu * 0.35, mv - nv * 0.35)) side = -1;
      if (!side) continue;
      const other = roomAtLevel(level, mu - side * nu * 0.45, mv - side * nv * 0.45);
      const weight = other && other.roofed && other !== room ? weight0 * DAYLIGHT.borrowed : weight0;
      const au = w.a[0] + (du / len) * o.t0;
      const av = w.a[1] + (dv / len) * o.t0;
      const bu = w.a[0] + (du / len) * o.t1;
      const bv = w.a[1] + (dv / len) * o.t1;
      out.push({
        q: [
          [au, lo, av],
          [bu, lo, bv],
          [bu, hi, bv],
          [au, hi, av],
        ],
        weight,
      });
    }
  }
  return out;
}

/**
 * Cielo (sr ponderados) que ve un punto a través de los vanos, y de dónde
 * viene en planta: `du, dv` es la suma de las direcciones hacia cada vano
 * pesadas por su cielo (dividida por `e` da la direccionalidad, 0-1).
 */
function skyThrough(
  sources: readonly LightQuad[],
  u: number,
  y: number,
  v: number,
): { e: number; du: number; dv: number } {
  let e = 0;
  let du = 0;
  let dv = 0;
  for (const s of sources) {
    const [p0, p1, p2, p3] = s.q;
    const a: V3 = [p0[0] - u, p0[1] - y, p0[2] - v];
    const b: V3 = [p1[0] - u, p1[1] - y, p1[2] - v];
    const c: V3 = [p2[0] - u, p2[1] - y, p2[2] - v];
    const d: V3 = [p3[0] - u, p3[1] - y, p3[2] - v];
    const omega = s.weight * (triangleSolidAngle(a, b, c) + triangleSolidAngle(a, c, d));
    e += omega;
    const cu = (a[0] + b[0] + c[0] + d[0]) / 4;
    const cv = (a[2] + b[2] + c[2] + d[2]) / 4;
    const len = Math.hypot(cu, cv);
    if (len > 1e-3) {
      du += (omega * cu) / len;
      dv += (omega * cv) / len;
    }
  }
  return { e, du, dv };
}

/** Factor de luz de un ambiente según el cielo que ve (sin rincones ni mesas). */
export function daylightFactor(sky: number): number {
  return DAYLIGHT.base + DAYLIGHT.gain * (1 - Math.exp(-sky / DAYLIGHT.e0));
}

/** De [-1, 1] a un byte, con 128 como cero. */
function encodeSigned(x: number): number {
  return Math.max(0, Math.min(255, Math.round(128 + x * 127)));
}

/** Desenfoque de caja separable, radio `r` celdas. */
function boxBlur(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const n = 2 * r + 1;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += src[j * W + Math.max(0, Math.min(W - 1, i + d))];
      tmp[j * W + i] = s / n;
    }
  }
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += tmp[Math.max(0, Math.min(H - 1, j + d)) * W + i];
      out[j * W + i] = s / n;
    }
  }
  return out;
}

/** Recorre las celdas de la grilla cuyo centro cae en el rectángulo. */
function eachCell(a0: number, b0: number, a1: number, b1: number, fn: (k: number, u: number, v: number) => void): void {
  const { u0, v0, cell, width: W, height: H } = DAYLIGHT_GRID;
  const i0 = Math.max(0, Math.floor((a0 - u0) / cell));
  const i1 = Math.min(W - 1, Math.floor((a1 - u0) / cell));
  const j0 = Math.max(0, Math.floor((b0 - v0) / cell));
  const j1 = Math.min(H - 1, Math.floor((b1 - v0) / cell));
  for (let j = j0; j <= j1; j++) {
    const v = v0 + (j + 0.5) * cell;
    if (v < b0 || v > b1) continue;
    for (let i = i0; i <= i1; i++) {
      const u = u0 + (i + 0.5) * cell;
      if (u >= a0 && u <= a1) fn(j * W + i, u, v);
    }
  }
}

function polyBox(poly: Room['poly']): [number, number, number, number] {
  let a0 = Infinity;
  let b0 = Infinity;
  let a1 = -Infinity;
  let b1 = -Infinity;
  for (const [u, v] of poly) {
    a0 = Math.min(a0, u);
    b0 = Math.min(b0, v);
    a1 = Math.max(a1, u);
    b1 = Math.max(b1, v);
  }
  return [a0, b0, a1, b1];
}

/** Celdas dentro de un muro (tramo `s0..s1` desde `a`, medio espesor `halfT`). */
function eachWallCell(
  a: Room['poly'][number],
  b: Room['poly'][number],
  s0: number,
  s1: number,
  halfT: number,
  fn: (k: number) => void,
): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const du = (b[0] - a[0]) / len;
  const dv = (b[1] - a[1]) / len;
  const pu0 = a[0] + du * s0;
  const pv0 = a[1] + dv * s0;
  const pu1 = a[0] + du * s1;
  const pv1 = a[1] + dv * s1;
  eachCell(
    Math.min(pu0, pu1) - halfT,
    Math.min(pv0, pv1) - halfT,
    Math.max(pu0, pu1) + halfT,
    Math.max(pv0, pv1) + halfT,
    (k, u, v) => {
      const t = (u - a[0]) * du + (v - a[1]) * dv;
      const n = Math.abs(-(u - a[0]) * dv + (v - a[1]) * du);
      if (t >= s0 && t <= s1 && n <= halfT) fn(k);
    },
  );
}

/**
 * Hornea la luz natural de la escuela en planta, por nivel.
 *
 * Es lo que hace que un aula no esté pareja: junto a las ventanas se ve más
 * luz que en el fondo, los rincones y lo que queda bajo las mesas y las
 * escaleras se oscurecen, y un pasillo sin ventanas queda con la luz de sus
 * luminarias. En el visor no hay oclusión ambiental en pantalla: este mapa
 * es la única que hay, y cuesta dos lecturas de textura por píxel.
 *
 * Se calcula una vez, en Node o en el navegador, con los mismos datos del
 * plano que usan el constructor y la colisión.
 */
export function bakeSchoolDaylight(): DaylightBake {
  const { cell, width: W, height: H } = DAYLIGHT_GRID;
  const N = W * H;
  const light = new Uint8Array(N * 4);
  const cover = new Uint8Array(N * 4);
  const dir = new Uint8Array(N * 4).fill(128);
  const indoor = new Uint8Array(N);
  /** Dirección de la luz por nivel, en planta local (u, v), con su intensidad. */
  const dirU = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  const dirV = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  const factor = [new Float32Array(N).fill(1), new Float32Array(N).fill(1), new Float32Array(N).fill(1)];
  /**
   * Ambiente techado de cada celda por nivel, como índice en ROOMS + 1 (0 =
   * ninguno); también para las dobles alturas.
   */
  const owner = [new Int16Array(N), new Int16Array(N), new Int16Array(N)];
  /** Celdas de patio (a cielo abierto) por nivel: no son muro para los rincones. */
  const open = [new Uint8Array(N), new Uint8Array(N), new Uint8Array(N)];
  const COARSE = 4; // la luz de las ventanas varía suave: se evalúa cada 40 cm

  for (let ri = 0; ri < ROOMS.length; ri++) {
    const room = ROOMS[ri];
    const level = roomLevel(room);
    const [a0, b0, a1, b1] = polyBox(room.poly);
    if (!room.roofed) {
      eachCell(a0, b0, a1, b1, (k, u, v) => {
        if (inPoly(room.poly, u, v)) open[level][k] = 1;
      });
      continue;
    }
    const sources = roomLightSources(room);
    // Las franjas de policarbonato de la bóveda del polideportivo: luz cenital
    // pareja que no entra por ningún vano del plano.
    const skylight = VAULTED.has(room.id) ? (SKYLIGHT[room.id] ?? 0) : 0;
    const y = LEVEL_Y[level] + 1.2;
    // Luz en una grilla gruesa sobre la caja del ambiente; las celdas finas la
    // interpolan (la función es continua también fuera del polígono).
    const gw = Math.ceil((a1 - a0) / (cell * COARSE)) + 2;
    const gh = Math.ceil((b1 - b0) / (cell * COARSE)) + 2;
    const step = cell * COARSE;
    const coarse = new Float32Array(gw * gh);
    const coarseU = new Float32Array(gw * gh);
    const coarseV = new Float32Array(gw * gh);
    for (let gj = 0; gj < gh; gj++) {
      for (let gi = 0; gi < gw; gi++) {
        const sky = skyThrough(sources, a0 + gi * step, y, b0 + gj * step);
        const total = sky.e + skylight;
        coarse[gj * gw + gi] = daylightFactor(total);
        // Direccionalidad: 1 si toda la luz llega de un mismo lado; la luz
        // cenital de una bóveda no tiene dirección.
        coarseU[gj * gw + gi] = total > 1e-4 ? sky.du / total : 0;
        coarseV[gj * gw + gi] = total > 1e-4 ? sky.dv / total : 0;
      }
    }
    const bilerp = (t: Float32Array, gi: number, gj: number, ti: number, tj: number) => {
      const top = t[gj * gw + gi] + (t[gj * gw + gi + 1] - t[gj * gw + gi]) * ti;
      const bottom = t[(gj + 1) * gw + gi] + (t[(gj + 1) * gw + gi + 1] - t[(gj + 1) * gw + gi]) * ti;
      return top + (bottom - top) * tj;
    };
    eachCell(a0, b0, a1, b1, (k, u, v) => {
      if (!inPoly(room.poly, u, v)) return;
      const fi = (u - a0) / step;
      const fj = (v - b0) / step;
      const gi = Math.min(gw - 2, Math.floor(fi));
      const gj = Math.min(gh - 2, Math.floor(fj));
      const ti = fi - gi;
      const tj = fj - gj;
      factor[level][k] = bilerp(coarse, gi, gj, ti, tj);
      dirU[level][k] = bilerp(coarseU, gi, gj, ti, tj);
      dirV[level][k] = bilerp(coarseV, gi, gj, ti, tj);
      owner[level][k] = ri + 1;
    });
  }

  // Dobles alturas (polideportivo, danzas): por encima de la losa del nivel
  // se sigue dentro del mismo ambiente, no al aire libre.
  for (let level = 1; level <= 2; level++) {
    for (let k = 0; k < N; k++) {
      const below = owner[level - 1][k];
      if (owner[level][k] || !below) continue;
      const room = ROOMS[below - 1];
      if (LEVEL_Y[roomLevel(room)] + ceilingHeight(room) <= LEVEL_Y[level]) continue;
      factor[level][k] = factor[level - 1][k];
      dirU[level][k] = dirU[level - 1][k];
      dirV[level][k] = dirV[level - 1][k];
      owner[level][k] = below;
    }
  }
  // Factor antes de los rincones: la parte de las luminarias se descuenta de
  // él y los rincones se conservan en proporción (ver `rooms` más abajo).
  const lit = factor.map((f) => f.slice());

  // Rincones: fracción de "no es este ambiente" (muro, o lo que hay del otro
  // lado) en un cuadrado de 1,3 m alrededor de la celda. Sobre la cara de
  // un muro liso da ~0,45; en un rincón, ~0,7: se oscurecen los rincones
  // (unos 30-40 cm hacia cada lado), no los muros.
  const R = 6;
  const area = (2 * R + 1) * (2 * R + 1);
  for (let level = 0; level <= 2; level++) {
    const wall = new Uint8Array(N);
    const floorY = LEVEL_Y[level] + 1;
    for (const w of WALLS) {
      const base = w.level * SCHOOL.storey;
      if (base > floorY || base + w.h < floorY) continue;
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      if (len < 1e-3) continue;
      const halfT = (w.kind === 'int' ? SCHOOL.wallT : SCHOOL.extT) / 2;
      let start = 0;
      for (const o of w.openings) {
        if (!WALKABLE.has(o.type)) continue;
        if (o.t0 > start) eachWallCell(w.a, w.b, start, o.t0, halfT, (k) => (wall[k] = 1));
        start = Math.max(start, o.t1);
      }
      if (start < len) eachWallCell(w.a, w.b, start, len, halfT, (k) => (wall[k] = 1));
    }
    // Caja de cada ambiente en celdas.
    const boxes = new Map<number, [number, number, number, number]>();
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const r = owner[level][j * W + i];
        if (!r) continue;
        const b = boxes.get(r);
        if (!b) boxes.set(r, [i, j, i, j]);
        else {
          if (i < b[0]) b[0] = i;
          if (j < b[1]) b[1] = j;
          if (i > b[2]) b[2] = i;
          if (j > b[3]) b[3] = j;
        }
      }
    }
    for (const [room, [bi0, bj0, bi1, bj1]] of boxes) {
      const i0 = Math.max(0, bi0 - R);
      const j0 = Math.max(0, bj0 - R);
      const i1 = Math.min(W - 1, bi1 + R);
      const j1 = Math.min(H - 1, bj1 + R);
      const bw = i1 - i0 + 1;
      const bh = j1 - j0 + 1;
      // Dos sumas: lo ajeno (otro ambiente, afuera) y el muro propio. Las
      // celdas de muro sólo miran lo ajeno: si no, toda la cara de un muro
      // liso salía más oscura que el piso de al lado.
      const sat = new Float32Array((bw + 1) * (bh + 1));
      const satWall = new Float32Array((bw + 1) * (bh + 1));
      for (let j = 0; j < bh; j++) {
        let row = 0;
        let rowWall = 0;
        for (let i = 0; i < bw; i++) {
          const k = (j0 + j) * W + i0 + i;
          const mine = owner[level][k] === room;
          row += mine ? 0 : 1;
          rowWall += mine && wall[k] ? 1 : 0;
          sat[(j + 1) * (bw + 1) + i + 1] = sat[j * (bw + 1) + i + 1] + row;
          satWall[(j + 1) * (bw + 1) + i + 1] = satWall[j * (bw + 1) + i + 1] + rowWall;
        }
      }
      const boxSum = (t: Float32Array, ia: number, ib: number, ja: number, jb: number) =>
        t[jb * (bw + 1) + ib] - t[ja * (bw + 1) + ib] - t[jb * (bw + 1) + ia] + t[ja * (bw + 1) + ia];
      for (let j = bj0; j <= bj1; j++) {
        const ja = Math.max(0, j - R - j0);
        const jb = Math.min(bh, j + R + 1 - j0);
        for (let i = bi0; i <= bi1; i++) {
          const k = j * W + i;
          if (owner[level][k] !== room) continue;
          const ia = Math.max(0, i - R - i0);
          const ib = Math.min(bw, i + R + 1 - i0);
          let sum = boxSum(sat, ia, ib, ja, jb);
          if (!wall[k]) sum += boxSum(satWall, ia, ib, ja, jb);
          // Lo que cae fuera de la grilla cuenta como muro.
          const frac = (sum + (area - (ib - ia) * (jb - ja))) / area;
          const x = Math.max(0, Math.min(1, (frac - 0.44) / 0.28));
          factor[level][k] *= 1 - DAYLIGHT.corner * x * x * (3 - 2 * x);
        }
      }
    }
  }

  for (let k = 0; k < N; k++) {
    for (let level = 0; level <= 2; level++) {
      light[k * 4 + level] = Math.max(0, Math.min(255, Math.round(factor[level][k] * 128)));
      if (owner[level][k]) indoor[k] |= 1 << level;
    }
    light[k * 4 + 3] = 255;
    // En el mundo x = ox - u y z = oz + v: la u cambia de signo.
    dir[k * 4] = encodeSigned(-dirU[0][k]);
    dir[k * 4 + 1] = encodeSigned(dirV[0][k]);
    dir[k * 4 + 2] = encodeSigned(-dirU[1][k]);
    dir[k * 4 + 3] = encodeSigned(dirV[1][k]);
  }

  // Aulas con interruptor: con las luminarias apagadas se descuenta su parte
  // de la base (lo que no es ventana); el degradado desde las ventanas y los
  // rincones quedan, escalados.
  const lampShare = DAYLIGHT.base * (1 - DAYLIGHT.lightsOff);
  const lists = new Map<string, { idx: number[]; off: number[] }>();
  const listOf = ROOMS.map((r) => {
    if (!SWITCHABLE_ROOMS.has(r.id)) return null;
    let l = lists.get(r.id);
    if (!l) lists.set(r.id, (l = { idx: [], off: [] }));
    return l;
  });
  for (let level = 0; level <= 2; level++) {
    const own = owner[level];
    for (let k = 0; k < N; k++) {
      const l = own[k] ? listOf[own[k] - 1] : null;
      if (!l) continue;
      const i = k * 4 + level;
      const pre = lit[level][k];
      l.idx.push(i);
      l.off.push(Math.round((light[i] * Math.max(0, pre - lampShare)) / Math.max(1e-3, pre)));
    }
  }
  const rooms = new Map<string, { idx: Uint32Array; off: Uint8Array }>();
  for (const [id, l] of lists) rooms.set(id, { idx: Uint32Array.from(l.idx), off: Uint8Array.from(l.off) });

  // Lo que tapa el piso: tapas de mesas y escaleras con luz por debajo.
  const top = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  const raise = (level: number, k: number, h: number) => {
    if (h > top[level][k]) top[level][k] = h;
  };
  for (const it of ITEMS) {
    const h = COVER_TOP[it.kind];
    if (h === undefined) continue;
    const level = it.level ?? 0;
    if (it.kind === 'hexTable' || it.kind === 'roundTable') {
      const r = it.w / 2;
      eachCell(it.u - r, it.v - r, it.u + r, it.v + r, (k, u, v) => {
        if (Math.hypot(u - it.u, v - it.v) <= r) raise(level, k, h);
      });
      continue;
    }
    eachCell(it.u - it.w / 2, it.v - it.d / 2, it.u + it.w / 2, it.v + it.d / 2, (k) => raise(level, k, h));
    if (it.kind === 'longTable') {
      // Bancos a los dos lados.
      const along = it.w >= it.d;
      for (const s of [-1, 1]) {
        const bu = along ? it.u : it.u + s * (it.w / 2 + 0.3);
        const bv = along ? it.v + s * (it.d / 2 + 0.3) : it.v;
        const hu = along ? it.w / 2 - 0.1 : 0.15;
        const hv = along ? 0.15 : it.d / 2 - 0.1;
        eachCell(bu - hu, bv - hv, bu + hu, bv + hv, (k) => raise(level, k, 0.45));
      }
    }
  }
  /** Piso sobre el que apoya un tramo o descanso que arranca a `yRel` (relativo a planta baja). */
  const baseOf = (yRel: number) => (yRel >= 2 * SCHOOL.storey - 0.2 ? 2 : yRel >= SCHOOL.storey - 0.2 ? 1 : 0);
  /**
   * Losa de un tramo o descanso a `yAbs`: tapa el piso del nivel de abajo.
   * `base` es el piso donde apoya: un tramo que arranca sobre la losa del
   * primer piso no tiene "abajo" en planta baja. Sin este tope, sus primeros
   * escalones (yb < piso + 0,3) caían en el nivel 0 con una tapa de ~3,1 m y
   * el piso del salón de los espejos (y el arranque de la escalera del
   * jardín) salía con una mancha oscura de 1,2 × 1,7 m sin nada encima.
   */
  const slab = (yAbs: number, k: number, base: number) => {
    const yb = yAbs - 0.25;
    const level = yb >= LEVEL_Y[2] + 0.3 ? 2 : yb >= LEVEL_Y[1] + 0.3 ? 1 : 0;
    if (level < base) return;
    if (level > 0 && !owner[level][k]) return;
    raise(level, k, Math.min(3.98, yb - LEVEL_Y[level]));
  };
  for (const s of STAIRS) {
    // Los tramos que arrancan del suelo son macizos: no hay "abajo".
    if (s.y0 < 0.5 && !s.hollow) continue;
    const base = baseOf(s.y0);
    eachCell(s.u0, s.v0, s.u1, s.v1, (k, u, v) => slab(stairY(s, u, v), k, base));
  }
  for (const l of LANDINGS) {
    if (l.y < 3 && !l.hollow) continue;
    const base = baseOf(l.y);
    eachCell(l.u0, l.v0, l.u1, l.v1, (k) => slab(SCHOOL.floorY + l.y, k, base));
  }
  // Borde blando: la penumbra de una mesa se abre unos centímetros.
  for (let level = 0; level <= 2; level++) {
    // Una sola pasada de 3×3 (±10 cm): con dos, un pupitre de 45 cm perdía
    // la meseta de altura y la sombra ya no alcanzaba al asiento de la silla.
    const t = boxBlur(top[level], W, H, 1);
    for (let k = 0; k < N; k++) cover[k * 4 + level] = Math.max(0, Math.min(255, Math.round((t[k] / 4) * 255)));
  }
  for (let k = 0; k < N; k++) cover[k * 4 + 3] = 255;

  return { width: W, height: H, light, cover, dir, indoor, rooms };
}

/** La escuela es siempre la misma: el horneado se reutiliza entre reconstrucciones. */
let cachedDaylight: DaylightBake | null = null;

/**
 * Parámetros compartidos por todos los materiales con luz de la escuela: se
 * escriben una vez y cada material los lee al dibujarse.
 */
interface DaylightState {
  light: RawTexture;
  cover: RawTexture;
  dir: RawTexture;
  indoor: Uint8Array;
  /**
   * Copia en CPU de la luz vigente (128 = 1,0): la horneada con las aulas
   * apagadas descontadas. La lee la adaptación del ojo.
   */
  lightData: Uint8Array;
  /** El horneado original (compartido entre reconstrucciones: no se escribe). */
  bake: DaylightBake;
  /** `lightData` cambió y falta subirla a la textura. */
  dirty: boolean;
  /** Origen local de la escuela en el mundo (x, z); NaN mientras no se conoce. */
  ox: number;
  oz: number;
}

/**
 * Plugin de material: multiplica la luz indirecta (rebote simulado = emisivo,
 * cielo = IBL difuso y reflejado) por el mapa horneado, y la directa sólo
 * hacia abajo (la hemisférica en el fondo de un aula), nunca hacia arriba:
 * una mancha de sol junto a la ventana queda como está.
 *
 * Fuera de la escuela o sin marco conocido el factor es 1: el resto de la
 * ciudad (y la cara exterior de los muros) no cambia.
 */
/**
 * Materiales que reciben la luz de la escuela: los PBR de superficies e
 * interiores de `Materials` (prefijos `s:` e `i:`), las puertas e
 * interruptores del juego y la gente (un único StandardMaterial). Los
 * vidrios, el follaje y las fuentes de luz, no.
 */
const DAYLIGHT_PBR = /^(i:|s:|game-doors$|game-switches$)/;
const DAYLIGHT_STANDARD = /^npc$/;

function attachDaylight(mat: Material, state: DaylightState): void {
  if (mat.pluginManager?.getPlugin('SchoolDaylight')) return;
  const cls = mat.getClassName();
  if ((cls === 'PBRMetallicRoughnessMaterial' || cls === 'PBRMaterial') && DAYLIGHT_PBR.test(mat.name)) {
    new SchoolDaylightPlugin(mat, state, false);
  } else if (cls === 'StandardMaterial' && DAYLIGHT_STANDARD.test(mat.name)) {
    new SchoolDaylightPlugin(mat, state, true);
  }
}

class SchoolDaylightPlugin extends MaterialPluginBase {
  constructor(
    material: Material,
    private readonly state: DaylightState,
    /** StandardMaterial: se escala el color final (no tiene IBL ni emisivo aparte). */
    private readonly standard: boolean,
  ) {
    super(material, 'SchoolDaylight', 210, { SCHOOLDAYLIGHT: false }, true, true);
  }

  override prepareDefines(defines: Record<string, unknown>): void {
    defines.SCHOOLDAYLIGHT = true;
  }

  override getClassName(): string {
    return 'SchoolDaylightPlugin';
  }

  override getSamplers(samplers: string[]): void {
    samplers.push('sdLight', 'sdCover', 'sdDir');
  }

  override getUniforms(): {
    ubo: Array<{ name: string; size: number; type: string }>;
    fragment: string;
  } {
    return {
      ubo: [
        { name: 'sdFrame', size: 4, type: 'vec4' },
        { name: 'sdLevels', size: 4, type: 'vec4' },
        { name: 'sdFloors', size: 4, type: 'vec4' },
      ],
      fragment: `#ifdef SCHOOLDAYLIGHT
uniform vec4 sdFrame;
uniform vec4 sdLevels;
uniform vec4 sdFloors;
#endif`,
    };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    const s = this.state;
    const g = DAYLIGHT_GRID;
    const known = Number.isFinite(s.ox) && Number.isFinite(s.oz);
    // u = ox − x, v = z − oz (ver SchoolLayout.toWorld); sin marco, la
    // coordenada cae fuera de la textura y el factor es 1.
    ubo.updateFloat4(
      'sdFrame',
      known ? s.ox - g.u0 : -1e6,
      known ? s.oz + g.v0 : 1e6,
      1 / (g.width * g.cell),
      1 / (g.height * g.cell),
    );
    ubo.updateFloat4('sdLevels', LEVEL_Y[1] - 0.06, LEVEL_Y[2] - 0.06, DAYLIGHT.cover, DAYLIGHT.facing);
    ubo.updateFloat4('sdFloors', LEVEL_Y[0], LEVEL_Y[1], LEVEL_Y[2], 0);
    ubo.setTexture('sdLight', s.light);
    ubo.setTexture('sdCover', s.cover);
    ubo.setTexture('sdDir', s.dir);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== 'fragment') return null;
    if (this.standard) {
      return { CUSTOM_FRAGMENT_DEFINITIONS: SD_DEFINITIONS, CUSTOM_FRAGMENT_BEFORE_FOG: SD_APPLY_STANDARD };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: SD_DEFINITIONS,
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: SD_APPLY,
    };
  }
}

const SD_DEFINITIONS = `
#ifdef SCHOOLDAYLIGHT
uniform sampler2D sdLight;
uniform sampler2D sdCover;
uniform sampler2D sdDir;
float schoolDaylight(vec3 p, vec3 n) {
  vec2 uv = vec2((sdFrame.x - p.x) * sdFrame.z, (p.z - sdFrame.y) * sdFrame.w);
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return 1.0;
  vec3 lv = p.y < sdLevels.x ? vec3(1.0, 0.0, 0.0) : (p.y < sdLevels.y ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0));
  float f = dot(texture2D(sdLight, uv).rgb, lv) * 1.9921875;
  // Topado en 0: el suelo de afuera (vereda, patios) está por debajo del
  // piso de planta baja, y con h negativo la oclusión de contacto lo
  // oscurecía (hasta ×0,56, sol incluido) en una franja recta hasta el
  // borde de la grilla, a lo largo de la vereda de Laprida.
  float h = max(p.y - dot(sdFloors.xyz, lv), 0.0);
  float top = dot(texture2D(sdCover, uv).rgb, lv) * 4.0;
  float occ = smoothstep(h + 0.02, h + 0.16, top) * (1.0 - 0.45 * clamp(h / 0.8, 0.0, 1.0));
  // La luz de las ventanas llega de un lado: lo que las mira (el muro de
  // enfrente, el costado de un mueble) recibe más que lo que les da la
  // espalda (el propio muro de las ventanas). Los planos horizontales, igual.
  vec4 d = texture2D(sdDir, uv) * 2.0 - 1.0;
  vec2 dir = lv.x * d.xy + lv.y * d.zw;
  float facing = dot(n.xz, dir);
  return f * (1.0 - sdLevels.z * occ) * (1.0 + sdLevels.w * facing);
}
#endif
`;

/**
 * La gente: su emisivo es un "piso de luz" parejo; bajo techo se multiplica
 * todo por la luz del lugar (topada: al sol junto a una ventana no se quema).
 */
const SD_APPLY_STANDARD = `
#ifdef SCHOOLDAYLIGHT
color.rgb *= min(schoolDaylight(vPositionW, normalW), 1.1);
#endif
`;

const SD_APPLY = `
#ifdef SCHOOLDAYLIGHT
float sdF = schoolDaylight(vPositionW, normalW);
finalEmissive *= sdF;
finalDiffuse *= min(sdF, 1.0);
#ifdef REFLECTION
finalIrradiance *= sdF;
finalRadianceScaled *= min(sdF, 1.15);
#endif
#endif
`;
