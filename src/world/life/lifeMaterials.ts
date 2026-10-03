/**
 * Materiales de la vida de la calle: UNO para todo lo que tiene volumen
 * (carrocerías, ruedas, pájaros, postes) y uno sin luz para las luces.
 *
 * Color por cara × color por instancia, con una regla (ver `GeoKit`): sólo
 * las caras de alfa 1 toman el color de la instancia; las demás son fijas y
 * su alfa es la rugosidad. Así un auto rojo tiene vidrios oscuros y lisos,
 * gomas mates y carrocería con reflejos del cielo en UNA malla y UN draw call.
 *
 * Babylon multiplica vértice × instancia en el vertex shader, así que el
 * plugin rehace `vColor` al final del vertex shader, y en el fragment pone
 * la rugosidad y deja la opacidad en 1 (el alfa del vértice no es
 * transparencia).
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Nullable } from '@babylonjs/core/types';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Engine } from '@babylonjs/core/Engines/engine';

class VehiclePaintPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    // Los dos `true` registran y activan el plugin (ver WindPlugin).
    super(material, 'VehiclePaint', 140, { VEHPAINT: false }, true, true);
  }

  override getClassName(): string {
    return 'VehiclePaintPlugin';
  }

  override isCompatible(): boolean {
    return true;
  }

  override prepareDefines(defines: Record<string, unknown>): void {
    defines.VEHPAINT = true;
  }

  override getCustomCode(shaderType: string): Nullable<Record<string, string>> {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_MAIN_END: `
          #if defined(VEHPAINT) && defined(VERTEXCOLOR)
            #if defined(INSTANCESCOLOR) && defined(INSTANCES)
              vColor = vec4(color.a > 0.995 ? color.rgb * instanceColor.rgb : color.rgb, color.a);
            #else
              vColor = color;
            #endif
          #endif
        `,
      };
    }
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `
        #ifdef VEHPAINT
          alpha = 1.0;
        #endif
      `,
      CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS: `
        #if defined(VEHPAINT) && defined(VERTEXCOLOR)
          if (vColor.a < 0.995) {
            metallicRoughness.r = 0.0;
            metallicRoughness.g = vColor.a;
          }
        #endif
      `,
    };
  }
}

export interface LifeMaterials {
  /** Pintura de auto: barniz con reflejos del cielo. */
  paint: PBRMaterial;
  /** Plumas, ropa, postes: mate. */
  matte: PBRMaterial;
  /** Luces: sin iluminación, el color (puede pasar de 1) es la instancia. */
  lamp: StandardMaterial;
  /** Sombra de contacto: mancha difusa bajo cada vehículo. */
  shadow: StandardMaterial;
  /** Halo aditivo de faros y semáforos al anochecer. */
  glow: StandardMaterial;
  dispose(): void;
}

export function createLifeMaterials(scene: Scene): LifeMaterials {
  const pbr = (name: string, rough: number, metal: number) => {
    const m = new PBRMaterial(name, scene);
    m.albedoColor = Color3.White();
    m.metallic = metal;
    m.roughness = rough;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
    new VehiclePaintPlugin(m);
    return m;
  };
  // Metal bajo (HANDOFF 3): con más, la pintura sale casi negra fuera del sol.
  const paint = pbr('lifePaint', 0.34, 0.12);
  const matte = pbr('lifeMatte', 0.82, 0);

  // Sin luces, StandardMaterial da emisivo × color (vértice × instancia):
  // el emisivo en blanco deja pasar el color de la instancia tal cual.
  const lamp = new StandardMaterial('lifeLamp', scene);
  lamp.disableLighting = true;
  lamp.diffuseColor = Color3.Black();
  lamp.specularColor = Color3.Black();
  lamp.emissiveColor = Color3.White();

  // Sombra de contacto: en VR no hay sombras proyectadas que se muevan, y
  // sin esta mancha los autos parecen flotar sobre el asfalto.
  const tex = new DynamicTexture('lifeShadowTex', { width: 64, height: 64 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 64, 64);
  const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 31);
  grad.addColorStop(0, 'rgba(0,0,0,0.62)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.42)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  tex.hasAlpha = true;
  tex.update();
  const shadow = new StandardMaterial('lifeShadow', scene);
  shadow.diffuseColor = Color3.Black();
  shadow.specularColor = Color3.Black();
  shadow.emissiveColor = Color3.Black();
  shadow.disableLighting = true;
  shadow.opacityTexture = tex;
  shadow.disableDepthWrite = true;
  shadow.zOffset = -2;

  // Halo: en el visor no hay bloom (no hay post-proceso), y de noche un faro
  // sin halo es un rectángulo blanco. Mancha radial sumada, sin niebla (la
  // niebla sumada aclararía el cielo) y sin escribir profundidad.
  const glowTex = new DynamicTexture('lifeGlowTex', { width: 64, height: 64 }, scene, true);
  const gctx = glowTex.getContext() as CanvasRenderingContext2D;
  gctx.clearRect(0, 0, 64, 64);
  const gg = gctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gg.addColorStop(0, 'rgba(255,255,255,1)');
  gg.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  gg.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  gg.addColorStop(1, 'rgba(255,255,255,0)');
  gctx.fillStyle = gg;
  gctx.fillRect(0, 0, 64, 64);
  glowTex.hasAlpha = true;
  glowTex.update();
  const glow = new StandardMaterial('lifeGlow', scene);
  glow.disableLighting = true;
  glow.diffuseTexture = glowTex;
  glow.useAlphaFromDiffuseTexture = true;
  glow.diffuseColor = Color3.Black();
  glow.specularColor = Color3.Black();
  glow.emissiveColor = Color3.White();
  glow.alphaMode = Engine.ALPHA_ADD;
  glow.disableDepthWrite = true;
  glow.backFaceCulling = false;
  glow.fogEnabled = false;

  return {
    paint,
    matte,
    lamp,
    shadow,
    glow,
    dispose() {
      paint.dispose();
      matte.dispose();
      lamp.dispose();
      shadow.dispose();
      glow.dispose();
      tex.dispose();
      glowTex.dispose();
    },
  };
}
