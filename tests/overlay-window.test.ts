import test from 'node:test'
import assert from 'node:assert/strict'
import { overlayWindow, TerrainCoverage } from '../src/map/overlay-window'
import { OverlayUpdates } from '../src/map/render-budget'

const view = { w: 1440, h: 900, scale: 12, x: 0, y: 0, tilt: true }

test('deep zoom linework follows display density rather than the full world texture', () => {
  const crop = overlayWindow(6000, 4000, view, 80, 1.75, 8192)
  assert(crop.width < 150)
  assert(crop.height < 200)
  assert(crop.pixelsWide / crop.width >= view.scale * 1.5)
  assert(crop.pixelsHigh / crop.height >= view.scale * 1.5)
})

test('the crop covers every visible ground and elevated point under a tilted camera', () => {
  for (const tilt of [false, true]) {
    const camera = { ...view, x: 300, y: -200, tilt },
      crop = overlayWindow(6000, 4000, camera, 100, 1.75, 8192),
      angle = tilt ? Math.PI * 0.29 : Math.PI / 2,
      cx = 3000 - camera.x / camera.scale,
      cy = 2000 - camera.y / (camera.scale * Math.sin(angle))
    for (const screenX of [-720, 0, 720])
      for (const screenY of [-450, 0, 450])
        for (const elevation of [0, 50, 100]) {
          const x = cx + screenX / camera.scale,
            y = cy + screenY / (camera.scale * Math.sin(angle)) + elevation / Math.tan(angle)
          assert(x >= crop.x && x <= crop.x + crop.width)
          assert(y >= crop.y && y <= crop.y + crop.height)
        }
  }
})

test('tall visible terrain does not spend spare texture storage on horizontal blur', () => {
  const camera = { ...view, scale: 96 },
    crop = overlayWindow(6000, 4000, camera, 150, 1.75, 8192)
  assert(crop.pixelsWide / crop.width >= camera.scale)
  assert.equal(crop.pixelsHigh, 4096)
  assert(crop.pixelsWide * crop.pixelsHigh <= 8_388_608)
})

test('overscan reuses small pans, while large pans and zooms refresh coverage', () => {
  const crop = overlayWindow(6000, 4000, view, 80, 1.75, 8192)
  assert.equal(overlayWindow(6000, 4000, { ...view, x: 20 }, 80, 1.75, 8192, crop), crop)
  assert.notEqual(overlayWindow(6000, 4000, { ...view, x: 400 }, 80, 1.75, 8192, crop), crop)
  assert.notEqual(overlayWindow(6000, 4000, { ...view, scale: 48 }, 80, 1.75, 8192, crop), crop)
})

test('texture storage stays bounded across world scales, device sizes and out-of-map pans', () => {
  for (const scale of [0.08, 0.5, 3, 24, 96])
    for (const tilt of [true, false])
      for (const offset of [-1e7, 0, 1e7]) {
        const crop = overlayWindow(
          6000,
          4000,
          { w: 3840, h: 2160, scale, x: offset, y: offset, tilt },
          220,
          2,
          4096,
        )
        assert(crop.pixelsWide > 0 && crop.pixelsHigh > 0)
        assert(crop.pixelsWide <= 4096 && crop.pixelsHigh <= 4096)
        assert(crop.pixelsWide * crop.pixelsHigh <= 8_388_608)
        assert(Number.isFinite(crop.x + crop.y + crop.width + crop.height))
      }
})

test('new coverage bypasses animation throttling once and resumes normal reuse', () => {
  const updates = new OverlayUpdates(),
    revision = {}
  assert(updates.shouldPaint(revision, 0, true))
  assert.equal(updates.shouldPaint(revision, 10, true), false)
  updates.invalidate()
  assert(updates.shouldPaint(revision, 11, true))
  assert.equal(updates.shouldPaint(revision, 12, true), false)
})

test('nearby height bounds keep maximum zoom sharp without clipping visible slopes', () => {
  const heightAt = (x: number, y: number) => (x > 80 ? 250 : 10 + y * 0.15),
    terrain = new TerrainCoverage(1000, 1000, 100, 100, heightAt),
    camera = { ...view, scale: 96 },
    crop = overlayWindow(1000, 1000, camera, 250, 1.75, 8192, undefined, terrain)
  assert(crop.height < 20, 'a distant peak cannot force a large blurry crop')
  assert(crop.pixelsWide / crop.width >= camera.scale * 1.75 - 1)
  assert(crop.pixelsHigh / crop.height >= camera.scale * 1.75 - 1)
  const angle = Math.PI * 0.29
  for (let row = 0; row <= 100; row++)
    for (let col = 0; col <= 100; col++) {
      const x = col * 10,
        z = row * 10,
        h = heightAt(col, row),
        sx = (x - 500) * camera.scale,
        sy = ((z - 500) * Math.sin(angle) - h * Math.cos(angle)) * camera.scale
      if (Math.abs(sx) > camera.w / 2 || Math.abs(sy) > camera.h / 2) continue
      assert(x >= crop.x && x <= crop.x + crop.width)
      assert(z >= crop.y && z <= crop.y + crop.height)
    }
})
