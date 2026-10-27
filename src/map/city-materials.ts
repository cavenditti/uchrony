import * as THREE from 'three'
import { surfaceNoiseShader } from './landscape-material'

const pigmentFinish = `
  outgoingLight=mix(outgoingLight,diffuseColor.rgb*1.16,0.32);
  #include <opaque_fragment>
`

/** Analytic materials retain detail at deep zoom without per-town texture allocations. */
export function architectureMaterial(kind: 'wall' | 'roof') {
  const material = new THREE.MeshStandardMaterial({ roughness: kind === 'wall' ? 0.91 : 0.83 })
  material.customProgramCacheKey = () => `town-illuminated-architecture-v1:${kind}`
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
        vec2 brick=vec2(horizontal*3.0,vLocal.y*5.0);
        brick.x+=mod(floor(brick.y),2.0)*0.5;
        vec2 mortar=abs(fract(brick)-0.5);
        float joint=smoothstep(0.43,0.49,max(mortar.x,mortar.y));
        float masonry=step(0.42,vHouse);
        diffuseColor.rgb*=mix(1.0,0.97+grain*0.07-joint*0.07*masonry,detail);
        vec2 pane=fract(vec2(horizontal,vLocal.y)*vec2(1.8,1.6));
        vec2 aa=max(fwidth(vec2(horizontal,vLocal.y))*vec2(1.8,1.6),vec2(0.01));
        float arch=length(vec2(pane.x-0.5,max(0.0,pane.y-0.52)));
        float windowMask=(1.0-smoothstep(0.15-aa.x,0.15+aa.x,arch))*smoothstep(0.27-aa.y,0.27+aa.y,pane.y);
        float frame=(1.0-smoothstep(0.21-aa.x,0.21+aa.x,arch))*smoothstep(0.22-aa.y,0.22+aa.y,pane.y);
        float side=1.0-step(0.5,abs(vSide.y));
        float timber=step(0.76,vHouse)*max(1.0-smoothstep(0.015,0.04,min(vLocal.y,abs(fract(vLocal.y*1.8)-0.05))),1.0-smoothstep(0.025,0.055,min(horizontal,span-horizontal)));
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(0.35,0.30,0.24),timber*side*detail);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.47,0.33,0.18),frame*side*detail*0.42);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.045,0.10,0.12),windowMask*side*0.88);
        float door=(1.0-smoothstep(0.10,0.13,abs(horizontal-span*0.5)))*(1.0-smoothstep(0.43,0.48,vLocal.y))*side;
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.13,0.095,0.065),door);
        float band=(1.0-smoothstep(0.025,0.06,abs(vLocal.y-vSize.y*0.82)))*step(0.5,vHouse);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.36,0.15,0.095),band*side*detail*0.5);
        float edgeDistance=min(min(horizontal,span-horizontal),min(vLocal.y,vSize.y-vLocal.y));
        float lineWidth=clamp(max(fwidth(horizontal),fwidth(vLocal.y))*0.65,0.012,0.055);
        float ink=1.0-smoothstep(lineWidth*0.45,lineWidth*1.4,edgeDistance);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.08,0.10,0.085),ink*side*detail*0.68);
        diffuseColor.rgb*=0.87+0.13*smoothstep(0.0,0.25,vLocal.y);
      `
          : `
        vec2 roofUv=vec2(abs(vSide.x)>0.5 ? vLocal.z : vLocal.x,vLocal.y+vLocal.z*0.15);
        vec2 tile=roofUv*vec2(4.0,6.0);
        tile.x+=mod(floor(tile.y),2.0)*0.5;
        vec2 edge=abs(fract(tile)-0.5);
        float seam=smoothstep(0.40,0.49,max(edge.x,edge.y));
        float variation=surfaceHash(floor(tile));
        diffuseColor.rgb*=mix(1.0,0.93+variation*0.13-seam*0.25,detail);
        float roofEdge=min(vLocal.y,min(vLocal.z,vSize.z-vLocal.z));
        float lineWidth=clamp(length(fwidth(vLocal))*0.55,0.015,0.055);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.075,0.09,0.08),(1.0-smoothstep(lineWidth*0.5,lineWidth*1.5,roofEdge))*detail*0.65);
      `
      }
    `,
    )
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', pigmentFinish)
  }
  return material
}

/** Blender scenery models carry their own vertex colors instead of procedural masonry. */
export function paintedMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })
  material.customProgramCacheKey = () => 'town-illuminated-painted-v1'
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', pigmentFinish)
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
  material.customProgramCacheKey = () => 'town-illuminated-ground-v1'
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
      float paving=0.97+surfaceHash(floor(stone))*0.10-joint*0.13;
      float earth=0.85+surfaceNoise(vTownGround*9.0)*0.30;
      float garden=0.88+surfaceNoise(vTownGround*3.0)*0.24;
      float textureValue=vSurfaceKind<0.5 ? paving : vSurfaceKind<1.5 ? earth : garden;
      diffuseColor.rgb*=mix(1.0,textureValue,detail);
    `,
    )
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', pigmentFinish)
  }
  return material
}

export function windMaterial(time: { value: number }, cloth = false, scale = { value: 1 }) {
  const material = new THREE.MeshStandardMaterial({
    roughness: cloth ? 0.92 : 1,
    side: cloth ? THREE.DoubleSide : THREE.FrontSide,
  })
  material.customProgramCacheKey = () => `town-illuminated-wind-v1:${cloth}`
  material.onBeforeCompile = (shader) => {
    shader.uniforms.sceneryTime = time
    shader.uniforms.treeScale = scale
    shader.vertexShader =
      'uniform float treeScale; uniform float sceneryTime; varying vec3 vWindLocal;\n' + shader.vertexShader
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
      transformed*=treeScale;
    `,
    )
    shader.fragmentShader = 'varying vec3 vWindLocal;\n' + surfaceNoiseShader + '\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      ${cloth ? 'float stripe=step(0.45,fract((vWindLocal.x+0.5)*3.0)); diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.8,0.63,0.30),stripe*0.8);' : 'diffuseColor.rgb*=0.94+surfaceNoise(vWindLocal.xy*8.0+vWindLocal.z*7.0)*0.12;'}
    `,
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      float rim=1.0-smoothstep(0.03,0.34,abs(dot(normal,normalize(vViewPosition))));
      outgoingLight=mix(outgoingLight,diffuseColor.rgb*1.15,0.38)*(1.0-rim*0.32);
      #include <opaque_fragment>
    `,
    )
  }
  return material
}
