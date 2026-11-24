// Minimal ZIP reader/writer (stdlib only). Reader handles stored + deflate entries.
// ponytail: no Zip64 — archives/entries over 4 GB are rejected; add Zip64 if backups ever get that large.
import fs from 'node:fs';
import zlib from 'node:zlib';

export function readZip(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const readAt = (pos, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b; };
  const tailLen = Math.min(size, 65557);
  const tail = readAt(size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) { fs.closeSync(fd); throw new Error('Not a zip file'); }
  const count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
  const cd = readAt(cdOff, cdSize);
  const entries = new Map();
  for (let p = 0, i = 0; i < count; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip directory');
    const method = cd.readUInt16LE(p + 10), csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
    const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32), off = cd.readUInt32LE(p + 42);
    const name = cd.subarray(p + 46, p + 46 + nlen).toString('utf8');
    entries.set(name, { name, method, csize, usize, off });
    p += 46 + nlen + xlen + clen;
  }
  const read = (name) => {
    const e = entries.get(name);
    if (!e) return null;
    const lh = readAt(e.off, 30);
    const data = readAt(e.off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28), e.csize);
    if (e.method === 0) return data;
    if (e.method === 8) return zlib.inflateRawSync(data);
    throw new Error('Unsupported zip compression');
  };
  return { names: [...entries.keys()], has: n => entries.has(n), read, close: () => fs.closeSync(fd) };
}

// Writes entries [{name, file?|data?}] to outFile. Large binaries are stored, text is deflated.
export function writeZip(outFile, entries) {
  const fd = fs.openSync(outFile, 'w');
  const central = [];
  let pos = 0;
  const write = b => { fs.writeSync(fd, b); pos += b.length; };
  try {
    for (const e of entries) {
      const raw = e.data ?? fs.readFileSync(e.file);
      const deflate = /\.(json|md|txt|db|sqlite|html)$/i.test(e.name);
      const body = deflate ? zlib.deflateRawSync(raw) : raw;
      if (pos + body.length > 0xfffffff0) throw new Error('Backup too large for zip format (over 4 GB)');
      const name = Buffer.from(e.name, 'utf8');
      const crc = zlib.crc32(raw);
      const h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(deflate ? 8 : 0, 8);
      h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(name.length, 26);
      central.push({ name, crc, csize: body.length, usize: raw.length, method: deflate ? 8 : 0, off: pos });
      write(h); write(name); write(body);
    }
    const cdStart = pos;
    for (const c of central) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0800, 8); h.writeUInt16LE(c.method, 10);
      h.writeUInt32LE(c.crc, 16); h.writeUInt32LE(c.csize, 20); h.writeUInt32LE(c.usize, 24); h.writeUInt16LE(c.name.length, 28); h.writeUInt32LE(c.off, 42);
      write(h); write(c.name);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(pos - cdStart, 12); end.writeUInt32LE(cdStart, 16);
    write(end);
  } finally { fs.closeSync(fd); }
}
