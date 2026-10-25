import * as THREE from 'three'
import { surfaceNoiseShader } from './landscape-material'

/** Analytic materials retain detail at deep zoom without per-town texture allocations. */
export function architectureMaterial(kind: 'wall' | 'roof') {
  const material = new THREE.MeshStandardMaterial({ roughness: kind === 'wall' ? 0.91 : 0.83 })
  material.customProgramCacheKey = () => `town-architecture-v2:${kind}`
  material.onBeforeCompile = (shader) => {
    const varying = 'varying vec3 vLocal; varying vec3 vSize; varying vec3 vSide; varying float vHouse;\n'
    shader.vertexShader = varying + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vSize=vec3(1.0); vHouse=0.0;
      #ifdef USE_INSTANCING
        vSize=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
        vHouse=fract(sin(dot(instanceMatrix[3].xz,vec2(12.9898,78.233)))*43758.5453);
      #endif
      vLocal=(position+0.5)*vSize; vSide=normal;
    `,
    )
    shader.fragmentShader = varying + surfaceNoiseShader + '\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      float horizontal=abs(vSide.x)>0.5 ? vLocal.z : vLocal.x;
      float span=abs(vSide.x)>0.5 ? vSize.z : vSize.x;
      float grain=surfaceNoise(vec2(horizontal,vLocal.y)*18.0);
      float detail=1.0-smoothstep(0.10,0.30,length(fwidth(vLocal)));
      ${
        kind === 'wall'
          ? `
        vec2 brick=vec2(horizontal*5.0,vLocal.y*8.0);
        brick.x+=mod(floor(brick.y),2.0)*0.5;
        vec2 mortar=abs(fract(brick)-0.5);
        float joint=smoothstep(0.43,0.49,max(mortar.x,mortar.y));
        float masonry=step(0.42,vHouse);
        diffuseColor.rgb*=mix(1.0,0.93+grain*0.14-joint*0.13*masonry,detail);
        vec2 pane=fract(vec2(horizontal,vLocal.y)*vec2(2.2,1.8));
        vec2 aa=max(fwidth(vec2(horizontal,vLocal.y))*vec2(2.2,1.8),vec2(0.01));
        float windowMask=smoothstep(0.28-aa.x,0.28+aa.x,pane.x)*(1.0-smoothstep(0.67-aa.x,0.67+aa.x,pane.x))*smoothstep(0.30-aa.y,0.30+aa.y,pane.y)*(1.0-smoothstep(0.74-aa.y,0.74+aa.y,pane.y));
        float frame=step(0.23,pane.x)*step(pane.x,0.72)*step(0.25,pane.y)*step(pane.y,0.79);
        float side=1.0-step(0.5,abs(vSide.y));
        float timber=step(0.76,vHouse)*max(1.0-smoothstep(0.015,0.04,min(vLocal.y,abs(fract(vLocal.y*1.8)-0.05))),1.0-smoothstep(0.025,0.055,min(horizontal,span-horizontal)));
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(0.35,0.30,0.24),timber*side*detail);
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*1.12,frame*side*detail);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.055,0.085,0.09),windowMask*side*0.86);
        float door=(1.0-smoothstep(0.10,0.13,abs(horizontal-span*0.5)))*(1.0-smoothstep(0.43,0.48,vLocal.y))*side;
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.13,0.095,0.065),door);
        diffuseColor.rgb*=0.80+0.20*smoothstep(0.0,0.25,vLocal.y);
      `
          : `
        vec2 roofUv=vec2(abs(vSide.x)>0.5 ? vLocal.z : vLocal.x,vLocal.y+vLocal.z*0.15);
        vec2 tile=roofUv*vec2(7.0,10.0);
        tile.x+=mod(floor(tile.y),2.0)*0.5;
        vec2 edge=abs(fract(tile)-0.5);
        float seam=smoothstep(0.40,0.49,max(edge.x,edge.y));
        float variation=surfaceHash(floor(tile));
        diffuseColor.rgb*=mix(1.0,0.88+variation*0.22-seam*0.18,detail);
      `
      }
    `,
    )
  }
  return material
}

export function townGroundMaterial() {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
  material.customProgramCacheKey = () => 'town-ground-v2'
  material.onBeforeCompile = (shader) => {
    const varying = 'varying vec2 vTownGround; varying float vSurfaceKind;\n'
    shader.vertexShader = 'attribute float surfaceKind;\n' + varying + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvTownGround=position.xz; vSurfaceKind=surfaceKind;',
    )
    shader.fragmentShader = varying + surfaceNoiseShader + '\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      float detail=1.0-smoothstep(0.12,0.35,length(fwidth(vTownGround)));
      vec2 stone=vTownGround*vec2(5.5,7.0);
      stone.x+=mod(floor(stone.y),2.0)*0.5;
      vec2 seam=abs(fract(stone)-0.5);
      float joint=smoothstep(0.39,0.49,max(seam.x,seam.y));
      float paving=0.92+surfaceHash(floor(stone))*0.18-joint*0.21;
      float earth=0.85+surfaceNoise(vTownGround*9.0)*0.30;
      float garden=0.88+surfaceNoise(vTownGround*3.0)*0.24;
      float textureValue=vSurfaceKind<0.5 ? paving : vSurfaceKind<1.5 ? earth : garden;
      diffuseColor.rgb*=mix(1.0,textureValue,detail);
    `,
    )
  }
  return material
}

export function windMaterial(time: { value: number }, cloth = false) {
  const material = new THREE.MeshStandardMaterial({
    roughness: cloth ? 0.92 : 1,
    side: cloth ? THREE.DoubleSide : THREE.FrontSide,
  })
  material.customProgramCacheKey = () => `town-wind-v1:${cloth}`
  material.onBeforeCompile = (shader) => {
    shader.uniforms.sceneryTime = time
    shader.vertexShader = 'uniform float sceneryTime; varying vec3 vWindLocal;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vWindLocal=position;
      float phase=0.0;
      #ifdef USE_INSTANCING
        phase=dot(instanceMatrix[3].xz,vec2(0.31,0.17));
      #endif
      ${cloth ? 'transformed.z+=sin(position.x*7.0-sceneryTime*2.4+phase)*pow(position.x+0.5,1.5)*0.17;' : 'transformed.x+=sin(sceneryTime*1.3+phase+position.y*2.0)*max(0.0,position.y+0.5)*0.035;'}
    `,
    )
    shader.fragmentShader = 'varying vec3 vWindLocal;\n' + surfaceNoiseShader + '\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      ${cloth ? 'float stripe=step(0.45,fract((vWindLocal.x+0.5)*3.0)); diffuseColor.rgb*=mix(0.78,1.07,stripe);' : 'diffuseColor.rgb*=0.82+surfaceNoise(vWindLocal.xy*15.0+vWindLocal.z*7.0)*0.30;'}
    `,
    )
  }
  return material
}
