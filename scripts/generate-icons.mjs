import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Generates the PWA icon set with no image dependencies — a saffron tile with a
 * blocky "K". Written by hand rather than pulled from a design tool so the
 * icons are reproducible and the repo stays free of binary assets nobody can
 * regenerate.
 *
 *   node scripts/generate-icons.mjs
 */

const SAFFRON = [232, 152, 46]
const INK = [34, 28, 20]

/* ------------------------------- PNG encoder ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBytes, data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  header[10] = 0 // deflate
  header[11] = 0 // adaptive filtering
  header[12] = 0 // no interlace

  // Each scanline is prefixed with its filter byte (0 = none).
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* --------------------------------- Glyph --------------------------------- */

/**
 * A "K" built from three strokes: a vertical stem plus two diagonals meeting at
 * the stem's midpoint. Distance tests rather than a font, so it scales cleanly
 * to any size.
 */
function isInsideK(x, y, size, padding) {
  const inner = size - padding * 2
  const u = (x - padding) / inner
  const v = (y - padding) / inner
  if (u < 0 || u > 1 || v < 0 || v > 1) return false

  const thickness = 0.15

  // Vertical stem, left third.
  if (u >= 0.12 && u <= 0.12 + thickness) return true

  // Upper diagonal: from the stem at mid-height out to the top right.
  const upper = 0.27 + (0.5 - v) * 1.15
  if (v <= 0.52 && Math.abs(u - upper) <= thickness * 0.72 && u >= 0.25) return true

  // Lower diagonal: from the stem at mid-height down to the bottom right.
  const lower = 0.27 + (v - 0.5) * 1.15
  if (v >= 0.48 && Math.abs(u - lower) <= thickness * 0.72 && u >= 0.25) return true

  return false
}

function renderIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4)

  // Maskable icons get cropped to a circle by the launcher, so the glyph needs
  // more breathing room and the background must bleed to the edges.
  const radius = maskable ? 0 : size * 0.22
  const padding = maskable ? size * 0.28 : size * 0.2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4

      // Rounded-rectangle mask for the non-maskable variants.
      let inside = true
      if (radius > 0) {
        const dx = Math.max(radius - x, x - (size - radius), 0)
        const dy = Math.max(radius - y, y - (size - radius), 0)
        inside = dx * dx + dy * dy <= radius * radius
      }

      if (!inside) {
        rgba[offset + 3] = 0
        continue
      }

      const glyph = isInsideK(x, y, size, padding)
      const colour = glyph ? INK : SAFFRON

      rgba[offset] = colour[0]
      rgba[offset + 1] = colour[1]
      rgba[offset + 2] = colour[2]
      rgba[offset + 3] = 255
    }
  }

  return encodePng(size, size, rgba)
}

/* --------------------------------- Write --------------------------------- */

const publicDir = join(process.cwd(), 'public')
mkdirSync(publicDir, { recursive: true })

const outputs = [
  ['icon-192.png', renderIcon(192)],
  ['icon-512.png', renderIcon(512)],
  ['icon-maskable-512.png', renderIcon(512, { maskable: true })],
  ['apple-icon.png', renderIcon(180)],
  ['badge-96.png', renderIcon(96)],
]

for (const [name, buffer] of outputs) {
  writeFileSync(join(publicDir, name), buffer)
  console.log(`  ${name}  ${(buffer.length / 1024).toFixed(1)} KB`)
}

console.log('\nIcons written to public/')
