import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cropColumns, readSettings, renamePath, surfaceVisible } from '../src/model.ts';

test('the map crop uses the two calibrated meridians as image boundaries', () => {
  assert.deepEqual(cropColumns(1774, { left: 68 / 1774, right: 1710 / 1774 }), {
    x: 68,
    width: 1642,
  });
});

test('unconfigured or invalid cropping uses the entire image', () => {
  const settings = readSettings({ crop: { left: 0.9, right: 0.1 } });
  assert.deepEqual(cropColumns(1440, settings.crop), { x: 0, width: 1440 });
});

test('returning to an earlier map restores its saved crop after restart', async () => {
  const { selectMap } = await import('../src/model.ts');
  const original = readSettings({
    imagePath: '지도/첫째.png',
    crop: { left: 0.05, right: 0.95 },
  });
  const switched = selectMap(original, '지도/둘째.png');
  assert.deepEqual(switched.crop, { left: 0, right: 1 });
  const reopened = readSettings(JSON.parse(JSON.stringify(switched)));
  assert.deepEqual(selectMap(reopened, '지도/첫째.png').crop, { left: 0.05, right: 0.95 });
});

test('markers round-trip with map and note paths and reject invalid positions', () => {
  const marker = {
    id: 'place', mapPath: '지도/행성.png', notePath: '지역/해안.md',
    position: { u: 0.3, v: 0.8 },
  };
  const invalid = { ...marker, id: 'invalid', position: { u: -1, v: 0 } };
  const settings = { imagePath: marker.mapPath, crop: { left: 0, right: 1 }, markers: [marker, invalid] };
  assert.deepEqual(readSettings(JSON.parse(JSON.stringify(settings))).markers, [marker]);
});

test('deleting one marker preserves other markers linked to the same note', async () => {
  const { removeMarker } = await import('../src/model.ts');
  const first = { id: 'first', mapPath: 'Map.png', notePath: 'Coast.md', position: { u: 0.2, v: 0.4 } };
  const second = { ...first, id: 'second', position: { u: 0.3, v: 0.5 } };
  const settings = readSettings({ imagePath: 'Map.png', markers: [first, second] });
  const updated = removeMarker(settings, first.id);
  assert.deepEqual(updated, { ...settings, markers: [second] });
  assert.deepEqual(settings.markers, [first, second]);
  assert.equal(removeMarker(updated, first.id), updated);
});

test('a surface click stores its position in the original map image', async () => {
  const { pointToMap, mapToPoint } = await import('../src/model.ts');
  const crop = { left: 0.1, right: 0.9 };
  const location = pointToMap({ x: 0, y: 0, z: 1 }, crop);
  assert.ok(Math.abs(location.u - 0.3) < 1e-12);
  assert.equal(location.v, 0.5);
  const shifted = mapToPoint(location, { left: 0.3, right: 0.9 });
  assert.ok(shifted && Math.abs(shifted.x + 1) < 1e-12 && Math.abs(shifted.z) < 1e-12);
  assert.equal(mapToPoint(location, { left: 0.4, right: 0.9 }), null);
});

test('moving a vault folder updates only paths inside that folder', () => {
  assert.equal(renamePath('지역/상세/해안.md', '지역', '새 지역'), '새 지역/상세/해안.md');
  assert.equal(renamePath('지역 지도/행성.png', '지역', '새 지역'), '지역 지도/행성.png');
  assert.equal(renamePath('지역/해안.md', '지역/해안.md', '지역/새 해안.md'), '지역/새 해안.md');
});

test('markers behind the sphere or beyond the perspective horizon are hidden', () => {
  const camera = { x: 0, y: 0, z: 3 };
  assert.equal(surfaceVisible({ x: 0, y: 0, z: 1 }, camera), true);
  assert.equal(surfaceVisible({ x: 0, y: 0, z: -1 }, camera), false);
  assert.equal(surfaceVisible({ x: Math.sqrt(0.96), y: 0, z: 0.2 }, camera), false);
});
