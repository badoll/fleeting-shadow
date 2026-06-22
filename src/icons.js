const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_ATTRS = {
  xmlns: SVG_NS,
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
};

function normalizeIconName(value) {
  return String(value || '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');
}

function createSvg(icon, attrs) {
  const svg = document.createElementNS(SVG_NS, 'svg');

  Object.entries({ ...DEFAULT_ATTRS, ...attrs }).forEach(([key, value]) => {
    svg.setAttribute(key, String(value));
  });

  icon.forEach(([tagName, childAttrs]) => {
    const child = document.createElementNS(SVG_NS, tagName);
    Object.entries(childAttrs).forEach(([key, value]) => {
      child.setAttribute(key, String(value));
    });
    svg.append(child);
  });

  return svg;
}

export function createIcons({ attrs = {}, icons = {} } = {}) {
  document.querySelectorAll('[data-lucide]').forEach((element) => {
    const iconName = element.getAttribute('data-lucide');
    const icon = icons[iconName] ?? icons[normalizeIconName(iconName)];
    if (!icon) return;

    const svg = createSvg(icon, attrs);
    Array.from(element.attributes).forEach((attribute) => {
      if (attribute.name === 'data-lucide') return;
      svg.setAttribute(attribute.name, attribute.value);
    });
    svg.setAttribute('data-lucide', iconName);
    element.replaceWith(svg);
  });
}
