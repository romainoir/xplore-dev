import fs from 'node:fs';
import path from 'node:path';

const stylePath = path.resolve('osm_liberty.json');
const style = JSON.parse(fs.readFileSync(stylePath, 'utf8'));

function collectIconProperties(iconImage) {
  const properties = new Set();
  const constants = new Set();

  if (typeof iconImage === 'string') {
    const match = iconImage.match(/^\{(.+?)\}$/);
    if (match) {
      properties.add(match[1]);
    } else {
      constants.add(iconImage);
    }
    return { properties, constants };
  }

  function traverse(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      const [op, ...rest] = node;
      if (op === 'image') {
        if (rest.length > 0) {
          const target = rest[0];
          if (Array.isArray(target) && target[0] === 'get' && typeof target[1] === 'string') {
            properties.add(target[1]);
          } else if (typeof target === 'string') {
            constants.add(target);
          }
        }
        return;
      }
      for (const item of rest) {
        traverse(item);
      }
      return;
    }
  }

  traverse(iconImage);
  return { properties, constants };
}

function collectFilterValues(filterNode, propertyMap, allValues) {
  if (!filterNode) {
    return;
  }

  if (!Array.isArray(filterNode) || filterNode.length === 0) {
    return;
  }

  const [operator, ...rest] = filterNode;

  switch (operator) {
    case 'all':
    case 'any':
      for (const part of rest) {
        collectFilterValues(part, propertyMap, allValues);
      }
      break;
    case '!':
      if (rest[0]) {
        collectFilterValues(rest[0], propertyMap, allValues);
      }
      break;
    case 'in':
    case '!in': {
      const [target, ...values] = rest;
      const property = extractPropertyName(target);
      if (property) {
        const set = propertyMap.get(property) ?? new Set();
        for (const value of values) {
          if (typeof value === 'string') {
            set.add(value);
            if (allValues) {
              allValues.add(value);
            }
          }
        }
        propertyMap.set(property, set);
      }
      break;
    }
    case '==':
    case '!=':
    case '>':
    case '<':
    case '>=':
    case '<=': {
      const [target, value] = rest;
      const property = extractPropertyName(target);
      if (property && typeof value === 'string') {
        const set = propertyMap.get(property) ?? new Set();
        set.add(value);
        propertyMap.set(property, set);
        if (allValues) {
          allValues.add(value);
        }
      }
      break;
    }
    case 'match': {
      const [target, candidates, trueValue, falseValue] = rest;
      const property = extractPropertyName(target);
      if (property) {
        const set = propertyMap.get(property) ?? new Set();
        if (Array.isArray(candidates)) {
          for (const candidate of candidates) {
            if (typeof candidate === 'string') {
              set.add(candidate);
              if (allValues) {
                allValues.add(candidate);
              }
            }
          }
        } else if (typeof candidates === 'string') {
          set.add(candidates);
          if (allValues) {
            allValues.add(candidates);
          }
        }
        if (typeof trueValue === 'string') {
          set.add(trueValue);
          if (allValues) {
            allValues.add(trueValue);
          }
        }
        if (typeof falseValue === 'string') {
          set.add(falseValue);
          if (allValues) {
            allValues.add(falseValue);
          }
        }
        propertyMap.set(property, set);
      }
      break;
    }
    default:
      for (const item of rest) {
        collectFilterValues(item, propertyMap, allValues);
      }
  }
}

function extractPropertyName(node) {
  if (!node) {
    return null;
  }
  if (typeof node === 'string') {
    return node;
  }
  if (Array.isArray(node) && node[0] === 'get' && typeof node[1] === 'string') {
    return node[1];
  }
  return null;
}

const spriteToTags = new Map();

for (const layer of style.layers) {
  if (layer.type !== 'symbol') {
    continue;
  }

  const iconImage = layer.layout && layer.layout['icon-image'];
  if (!iconImage) {
    continue;
  }

  const { properties, constants } = collectIconProperties(iconImage);
  const propertyValues = new Map();
  const fallbackValues = new Set();
  collectFilterValues(layer.filter, propertyValues, fallbackValues);

  if (constants.size > 0) {
    if (propertyValues.size > 0) {
      for (const constant of constants) {
        for (const [property, values] of propertyValues) {
          for (const value of values) {
            addMapping(constant, `${property}=${value}`);
          }
        }
      }
    } else {
      for (const constant of constants) {
        addMapping(constant, `${layer.id}`);
      }
    }
  }

  if (properties.size === 0) {
    continue;
  }

  for (const property of properties) {
    let values = propertyValues.get(property);
    if ((!values || values.size === 0) && fallbackValues.size > 0) {
      values = fallbackValues;
    }
    if (!values || values.size === 0) {
      continue;
    }
    for (const value of values) {
      addMapping(value, `${property}=${value}`);
    }
  }
}

function addMapping(spriteName, tag) {
  if (typeof spriteName !== 'string' || !spriteName) {
    return;
  }
  const trimmed = spriteName.trim();
  if (!trimmed) {
    return;
  }
  const set = spriteToTags.get(trimmed) ?? new Set();
  if (tag) {
    set.add(tag);
  }
  spriteToTags.set(trimmed, set);
}

const entries = Array.from(spriteToTags.entries()).map(([sprite, tags]) => ({
  sprite,
  tags: Array.from(tags).sort()
})).sort((a, b) => a.sprite.localeCompare(b.sprite));

const intro = [
  '# OpenFreemap sprite lookup',
  '',
  'Generated by `scripts/generate-openfreemap-icon-table.mjs`. When the remote sprite metadata is unavailable, the script infers icons from the local `osm_liberty.json` filters, so the list may be limited.',
  ''
];
const header = ['| Sprite | Tags |', '| --- | --- |'];
const rows = entries.map(({ sprite, tags }) => {
  const tagList = tags.length ? tags.map((tag) => `\`${tag}\``).join(', ') : '';
  return `| \`${sprite}\` | ${tagList} |`;
});

const output = intro.concat(header, rows).join('\n');
const outputPath = path.resolve('data', 'openfreemap-sprites-table.md');
fs.writeFileSync(outputPath, `${output}\n`, 'utf8');
console.log(`Sprite table written to ${outputPath}`);
