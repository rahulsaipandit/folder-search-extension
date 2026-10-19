/**
 * GLSL ES 3.00 for the glass image wall (design §4B.3). One instanced quad per tile.
 *
 * Per instance: aRect = (centre x, centre y, width, height) in canvas CSS px with y down;
 * aState = (texture layer or -1, hover 0..1, keyboard focus 0..1, opacity).
 * The whole scene is rotated about the viewport centre by uOrbit (it follows the pointer, a few degrees,
 * like the EmbeddingGemma demo), then viewed from (0, 0, uFocal) looking down -z.
 */

export const VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aRect;
layout(location=2) in vec4 aState;
uniform vec2 uViewport;
uniform float uFocal;
uniform mat3 uOrbit;
out vec2 vUv;
flat out vec2 vSize;
flat out float vLayer;
flat out float vHover;
flat out float vFocus;
flat out float vOpacity;
out vec3 vWorld;
void main(){
  float hover = aState.y;
  vec2 size = aRect.zw;
  vec2 local = aCorner * size;
  // A shallow dome, so the glass catches light across its whole face.
  float R = max(size.x, size.y) * 1.4;
  float d2 = dot(local, local);
  float bulge = -d2 / (sqrt(max(R * R - d2, 1.)) + R);
  vec3 centred = vec3(local + aRect.xy - uViewport * .5, bulge);
  vec3 world = uOrbit * centred;
  float depth = uFocal - world.z;
  gl_Position = vec4(world.x * uFocal / (uViewport.x * .5), -world.y * uFocal / (uViewport.y * .5), 0., depth);
  vUv = aCorner + .5;
  vSize = size;
  vLayer = aState.x;
  vHover = hover;
  vFocus = aState.z;
  vOpacity = aState.w;
  vWorld = world;
}`

export const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUv;
flat in vec2 vSize;
flat in float vLayer;
flat in float vHover;
flat in float vFocus;
flat in float vOpacity;
in vec3 vWorld;
uniform sampler2DArray uThumbs;
uniform mat3 uOrbit;
uniform float uFocal;
out vec4 outColor;

// Signed distance to the tile's rounded rectangle (negative inside).
float sdf(vec2 p, float radius){
  vec2 q = abs(p) - vSize * .5 + radius;
  return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - radius;
}
// Height of the glass above the base plane: flat in the middle, rolling off in a rounded bevel.
float height(vec2 p, float radius, float bevelW, float thick){
  float t = clamp(1. + sdf(p, radius) / bevelW, 0., 1.);
  return pow(max(1. - pow(t, 3.9), 0.), 1. / 3.9) * thick;
}
// A procedural studio: a vertical gradient plus two soft boxes. No texture is loaded.
vec3 environment(vec3 r){
  r = normalize(r);
  vec3 base = mix(vec3(.05, .07, .10), vec3(.60, .66, .74), smoothstep(-.45, .85, -r.y));
  float box1 = pow(max(dot(r, normalize(vec3(-.55, -.65, .55))), 0.), 22.) * 1.3;
  float box2 = pow(max(dot(r, normalize(vec3(.70, -.25, .70))), 0.), 40.) * .8;
  return base + box1 * vec3(1., .97, .92) + box2 * vec3(.85, .92, 1.);
}
vec3 thumb(vec2 uv){
  if (vLayer < -.5) return vec3(.42, .45, .50);
  return texture(uThumbs, vec3(clamp(uv, vec2(.002), vec2(.998)), vLayer)).rgb;
}
void main(){
  float m = min(vSize.x, vSize.y);
  float radius = m * .16, bevelW = m * .20, thick = m * .22, rimW = max(m * .03, 1.5);
  vec2 p = (vUv - .5) * vSize;
  float d = sdf(p, radius);
  float aa = max(fwidth(d) * .5, .3);
  float alpha = (1. - smoothstep(-aa, aa, d)) * vOpacity;
  if (alpha < .004) discard;

  // Surface normal from the height field (central differences), plus the dome's own curvature.
  float e = max(bevelW * .06, .35);
  vec2 grad = vec2(
    height(p + vec2(e, 0.), radius, bevelW, thick) - height(p - vec2(e, 0.), radius, bevelW, thick),
    height(p + vec2(0., e), radius, bevelW, thick) - height(p - vec2(0., e), radius, bevelW, thick)
  ) / (2. * e);
  float slope = length(grad);
  grad *= min(slope, 1.7) / max(slope, .0001);
  float R = max(vSize.x, vSize.y) * 1.4;
  vec2 curve = p / sqrt(max(R * R - dot(p, p), 1.));
  vec3 normal = normalize(vec3(-grad + curve, 1.));

  vec3 toCam = vec3(0., 0., uFocal) - vWorld;
  vec3 view = normalize(transpose(uOrbit) * toCam);

  // Refract the view ray once per colour channel (slightly different indices), then look the
  // thumbnail up where each ray lands: that is the bent picture with a faint colour fringe.
  vec3 rr = refract(-view, normal, 1. / 1.9);
  vec3 rg = refract(-view, normal, 1. / 2.05);
  vec3 rb = refract(-view, normal, 1. / 2.2);
  vec2 ur = vUv + rr.xy * (thick / max(abs(rr.z), .05)) * .7 / vSize;
  vec2 ug = vUv + rg.xy * (thick / max(abs(rg.z), .05)) * .7 / vSize;
  vec2 ub = vUv + rb.xy * (thick / max(abs(rb.z), .05)) * .7 / vSize;
  vec3 through = vec3(thumb(ur).r, thumb(ug).g, thumb(ub).b);

  vec3 worldNormal = normalize(uOrbit * normal);
  vec3 worldView = normalize(toCam);
  vec3 reflection = environment(reflect(-worldView, worldNormal));
  float fresnel = .045 + .955 * pow(clamp(1. - dot(normal, view), 0., 1.), 5.);
  float rim = smoothstep(-rimW, 0., d) * (.11 + .35 * vFocus);

  vec3 color = mix(through, reflection, min(fresnel * 1.9, .30));
  color += vec3(rim);
  color *= 1. + .05 * vHover;
  color += vec3(.01, .014, .017) * vHover;
  outColor = vec4(max(color, vec3(0.)) * alpha, alpha);
}`
