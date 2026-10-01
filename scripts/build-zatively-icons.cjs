// Package-format conversion only; the icon master is edited with imagegen.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'assets', 'zatively');
async function main() {
  fs.mkdirSync(destination, { recursive: true });
  const master = path.join(destination, 'icon-master.png');
  if (process.argv[2]) fs.copyFileSync(path.resolve(process.argv[2]), master);
  const png = async size => sharp(master).resize(size, size).png().toBuffer();
  fs.writeFileSync(path.join(destination, 'icon.png'), await png(512));
  const entries = await Promise.all([16, 32, 48, 64, 128, 256].map(async size => ({ size, bytes: await png(size) })));
  const header = Buffer.alloc(6 + entries.length * 16); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach((entry, index) => {
    const start = 6 + index * 16; header[start] = entry.size % 256; header[start + 1] = entry.size % 256;
    header.writeUInt16LE(1, start + 4); header.writeUInt16LE(32, start + 6);
    header.writeUInt32LE(entry.bytes.length, start + 8); header.writeUInt32LE(offset, start + 12); offset += entry.bytes.length;
  });
  fs.writeFileSync(path.join(destination, 'icon.ico'), Buffer.concat([header, ...entries.map(entry => entry.bytes)]));
  const chunks = await Promise.all([['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]].map(async ([kind, size]) => {
    const bytes = await png(size); const chunk = Buffer.alloc(8); chunk.write(kind); chunk.writeUInt32BE(bytes.length + 8, 4); return Buffer.concat([chunk, bytes]);
  }));
  const icns = Buffer.alloc(8); icns.write('icns'); icns.writeUInt32BE(chunks.reduce((sum, chunk) => sum + chunk.length, 8), 4);
  fs.writeFileSync(path.join(destination, 'icon.icns'), Buffer.concat([icns, ...chunks]));
  const mark = '<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="47" fill="none" stroke="white" stroke-width="5"/><g transform="rotate(90 50 50)" fill="none" stroke="white" stroke-width="9" stroke-linecap="round"><path d="M26 22V78 M26 22L74 78 M74 22V78"/></g></svg>';
  fs.writeFileSync(path.join(destination, 'iconTemplate.png'), await sharp(Buffer.from(mark)).resize(32, 32).png().toBuffer());
  console.log(`Zatively icons written to ${destination}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
