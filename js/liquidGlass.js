// ============================================
// Liquid Glass — Physics-based SVG Filter Generator
// Snell's Law refraction + specular highlights
// Based on archisvaze/liquid-glass
// ============================================

// Convex squircle surface function — models the curved glass surface profile
const SURFACE_FN = x => Math.pow(1 - Math.pow(1 - x, 4), 0.25);

/**
 * Calculate refraction displacement profile along the bezel using Snell's Law.
 * Returns a Float64Array mapping bezel depth → displacement amount.
 */
function calculateRefractionProfile(glassThickness, bezelWidth, ior, samples = 128) {
  const eta = 1 / ior;
  const profile = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = i / samples;
    const y = SURFACE_FN(x);
    const dx = 0.0001;
    const y2 = SURFACE_FN(x + dx);
    const deriv = (y2 - y) / dx;
    const mag = Math.sqrt(deriv * deriv + 1);
    const nx = -deriv / mag;
    const ny = -1 / mag;
    // Snell's Law: n1*sin(θ1) = n2*sin(θ2)
    const dot = ny;
    const k = 1 - eta * eta * (1 - dot * dot);
    if (k < 0) { profile[i] = 0; continue; }
    const sq = Math.sqrt(k);
    const rx = -(eta * dot + sq) * nx;
    const ry = eta - (eta * dot + sq) * ny;
    if (ry === 0) { profile[i] = 0; continue; }
    profile[i] = rx * ((y * bezelWidth + glassThickness) / ry);
  }
  return profile;
}

/**
 * Generate an RGBA displacement map canvas as a data URL.
 * R channel = X displacement, G channel = Y displacement (both centered at 128).
 */
function generateDisplacementMap(w, h, radius, bezelWidth, profile, maxDisp) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  // Default: no displacement (neutral gray)
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 128; d[i + 1] = 128; d[i + 2] = 0; d[i + 3] = 255;
  }
  const r = radius;
  const rSq = r * r;
  const r1Sq = (r + 1) ** 2;
  const rBSq = Math.max(r - bezelWidth, 0) ** 2;
  const wB = Math.max(w - r * 2, 0);
  const hB = Math.max(h - r * 2, 0);
  const S = profile.length;

  for (let y1 = 0; y1 < h; y1++) {
    for (let x1 = 0; x1 < w; x1++) {
      // Distance from nearest rounded corner centre
      const ex = x1 < r ? x1 - r : (x1 >= w - r ? x1 - r - wB : 0);
      const ey = y1 < r ? y1 - r : (y1 >= h - r ? y1 - r - hB : 0);
      const dSq = ex * ex + ey * ey;
      if (dSq > r1Sq || dSq < rBSq) continue;
      const dist = Math.sqrt(dSq);
      const fromSide = r - dist;
      const op = dSq < rSq
        ? 1
        : 1 - (dist - Math.sqrt(rSq)) / (Math.sqrt(r1Sq) - Math.sqrt(rSq));
      if (op <= 0 || dist === 0) continue;
      const cos = ex / dist;
      const sin = ey / dist;
      const bi = Math.min(Math.floor((fromSide / bezelWidth) * S), S - 1);
      const disp = profile[bi] || 0;
      const dX = (-cos * disp) / maxDisp;
      const dY = (-sin * disp) / maxDisp;
      const idx = (y1 * w + x1) * 4;
      d[idx]     = Math.max(0, Math.min(255, (128 + dX * 127 * op + 0.5) | 0));
      d[idx + 1] = Math.max(0, Math.min(255, (128 + dY * 127 * op + 0.5) | 0));
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

/**
 * Generate a specular highlight map — bright at edges facing the light source.
 */
function generateSpecularMap(w, h, radius, bezelWidth, angle = Math.PI / 3) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  d.fill(0);
  const r = radius;
  const rSq = r * r;
  const r1Sq = (r + 1) ** 2;
  const rBSq = Math.max(r - bezelWidth, 0) ** 2;
  const wB = Math.max(w - r * 2, 0);
  const hB = Math.max(h - r * 2, 0);
  const svX = Math.cos(angle);
  const svY = Math.sin(angle);

  for (let y1 = 0; y1 < h; y1++) {
    for (let x1 = 0; x1 < w; x1++) {
      const ex = x1 < r ? x1 - r : (x1 >= w - r ? x1 - r - wB : 0);
      const ey = y1 < r ? y1 - r : (y1 >= h - r ? y1 - r - hB : 0);
      const dSq = ex * ex + ey * ey;
      if (dSq > r1Sq || dSq < rBSq) continue;
      const dist = Math.sqrt(dSq);
      const fromSide = r - dist;
      const op = dSq < rSq
        ? 1
        : 1 - (dist - Math.sqrt(rSq)) / (Math.sqrt(r1Sq) - Math.sqrt(rSq));
      if (op <= 0 || dist === 0) continue;
      const cos = ex / dist;
      const sin = -ey / dist;
      const dot = Math.abs(cos * svX + sin * svY);
      const edge = Math.sqrt(Math.max(0, 1 - (1 - fromSide) ** 2));
      const coeff = dot * edge;
      const col = (255 * coeff) | 0;
      const alpha = (col * coeff * op) | 0;
      const idx = (y1 * w + x1) * 4;
      d[idx] = col; d[idx + 1] = col; d[idx + 2] = col; d[idx + 3] = alpha;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

/**
 * Build and inject an SVG filter into #svg-defs.
 * The filter includes: blur (frosted glass) + displacement (refraction) + specular.
 *
 * @param {string} filterId   — SVG filter id
 * @param {number} w          — element width in px
 * @param {number} h          — element height in px
 * @param {object} opts
 */
function buildFilter(filterId, w, h, opts = {}) {
  const {
    radius          = 32,
    bezelWidth      = 32,
    glassThickness  = 60,
    ior             = 2.0,
    scaleRatio      = 1.0,
    blurAmount      = 22,    // stdDeviation for frosted glass (≈ backdrop-filter blur)
    specularOpacity = 0.6,
    specularSat     = 4,
    saturation      = 2.1,   // colour saturation multiplier
    brightness      = 1.22,  // brightness multiplier
  } = opts;

  if (w < 4 || h < 4) return;

  const defs = document.getElementById('svg-defs');
  if (!defs) return;

  const clampedBezel = Math.min(bezelWidth, radius - 1, Math.min(w, h) / 2 - 1);
  if (clampedBezel <= 0) return;

  const profile = calculateRefractionProfile(glassThickness, clampedBezel, ior, 128);
  const maxDisp = Math.max(...Array.from(profile).map(Math.abs)) || 1;
  const dispUrl = generateDisplacementMap(w, h, radius, clampedBezel, profile, maxDisp);
  const specUrl = generateSpecularMap(w, h, radius, clampedBezel * 2.5);
  const scale   = maxDisp * scaleRatio;

  // Replace any existing filter with this id
  const existing = document.getElementById(filterId);
  if (existing) existing.remove();

  const NS     = 'http://www.w3.org/2000/svg';
  const filter = document.createElementNS(NS, 'filter');
  filter.id = filterId;
  filter.setAttribute('x', '-6%');
  filter.setAttribute('y', '-6%');
  filter.setAttribute('width', '112%');
  filter.setAttribute('height', '112%');
  filter.setAttribute('color-interpolation-filters', 'sRGB');

  filter.innerHTML = `
    <feGaussianBlur in="SourceGraphic" stdDeviation="${blurAmount}" result="blurred"/>
    <feColorMatrix in="blurred" type="saturate" values="${saturation}" result="saturated"/>
    <feComponentTransfer in="saturated" result="brightened">
      <feFuncR type="linear" slope="${brightness}"/>
      <feFuncG type="linear" slope="${brightness}"/>
      <feFuncB type="linear" slope="${brightness}"/>
    </feComponentTransfer>
    <feImage href="${dispUrl}" x="0" y="0" width="${w}" height="${h}" result="disp_map" preserveAspectRatio="none"/>
    <feDisplacementMap in="brightened" in2="disp_map"
      scale="${scale}" xChannelSelector="R" yChannelSelector="G"
      result="displaced"/>
    <feColorMatrix in="displaced" type="saturate" values="${specularSat}" result="displaced_sat"/>
    <feImage href="${specUrl}" x="0" y="0" width="${w}" height="${h}" result="spec_layer" preserveAspectRatio="none"/>
    <feComposite in="displaced_sat" in2="spec_layer" operator="in" result="spec_masked"/>
    <feComponentTransfer in="spec_layer" result="spec_faded">
      <feFuncA type="linear" slope="${specularOpacity}"/>
    </feComponentTransfer>
    <feBlend in="spec_masked" in2="displaced" mode="normal" result="with_spec"/>
    <feBlend in="spec_faded" in2="with_spec" mode="normal"/>
  `;

  defs.appendChild(filter);
}

// ── Public API ────────────────────────────────────────────────────────────────

let _rebuildTimer   = null;
let _indicatorTimer = null;

function buildNavFilter() {
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;
  const w = nav.offsetWidth;
  const h = nav.offsetHeight;
  if (w < 4 || h < 4) return;
  buildFilter('liquid-glass-nav', w, h, {
    radius:         32,
    bezelWidth:     32,
    glassThickness: 60,
    ior:            2.0,
    scaleRatio:     1.0,
    blurAmount:     22,
    specularOpacity: 0.65,
    specularSat:    4,
    saturation:     2.1,
    brightness:     1.22,
  });
}

function buildIndicatorFilter() {
  const indicator = document.querySelector('.tab-indicator');
  if (!indicator) return;
  const w = Math.max(indicator.offsetWidth, 60);
  const h = indicator.offsetHeight || 56;
  if (w < 4 || h < 4) return;
  buildFilter('liquid-glass-indicator', w, h, {
    radius:         28,
    bezelWidth:     28,
    glassThickness: 38,
    ior:            2.6,
    scaleRatio:     1.2,
    blurAmount:     10,
    specularOpacity: 0.9,
    specularSat:    6,
    saturation:     1.6,
    brightness:     1.35,
  });
}

export function initLiquidGlass() {
  function rebuild() {
    buildNavFilter();
    buildIndicatorFilter();
    // Enable liquid-glass CSS rules (see @supports block in index.css)
    document.body.classList.add('liquid-glass-ready');
  }

  function scheduleRebuild() {
    clearTimeout(_rebuildTimer);
    _rebuildTimer = setTimeout(rebuild, 40);
  }

  function scheduleIndicatorRebuild() {
    clearTimeout(_indicatorTimer);
    _indicatorTimer = setTimeout(buildIndicatorFilter, 40);
  }

  // Build after first two animation frames (layout is stable)
  requestAnimationFrame(() => requestAnimationFrame(rebuild));

  // Rebuild on window resize
  window.addEventListener('resize', scheduleRebuild);

  // Observe tab indicator size changes (tab switches change its width)
  const ro = new ResizeObserver(scheduleIndicatorRebuild);

  // Indicator may not exist yet; poll briefly
  let attempts = 0;
  const poll = setInterval(() => {
    const indicator = document.querySelector('.tab-indicator');
    if (indicator) {
      ro.observe(indicator);
      clearInterval(poll);
    } else if (++attempts > 50) {
      clearInterval(poll);
    }
  }, 100);
}
