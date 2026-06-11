import { deflateRawSync } from "node:zlib";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const inputDir = resolve(root, "dist", "extension");
const outputFile = resolve(root, "dist", "download-to-curl.xpi");
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  var value = index;
  for (var bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});
const files = collectFiles(inputDir);

if (!files.length) {
  fail("Missing staged extension files. Run npm run stage first.");
}

mkdirSync(dirname(outputFile), { recursive: true });
writeFileSync(outputFile, buildZip(files));
console.log(outputFile);

function collectFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(fullPath);
      }
      if (!entry.isFile()) {
        return [];
      }
      return [{
        absolutePath: fullPath,
        zipPath: relative(inputDir, fullPath).split(sep).join("/")
      }];
    })
    .sort((a, b) => a.zipPath.localeCompare(b.zipPath));
}

function buildZip(entries) {
  const chunks = [];
  const centralDirectory = [];
  var offset = 0;

  entries.forEach((entry) => {
    const source = readFileSync(entry.absolutePath);
    const compressed = deflateRawSync(source, { level: 9 });
    const name = Buffer.from(entry.zipPath, "utf8");
    const crc = crc32(source);
    const stat = statSync(entry.absolutePath);
    const timestamp = dosTimestamp(stat.mtime);
    const localHeader = Buffer.alloc(30 + name.length);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(timestamp.time, 10);
    localHeader.writeUInt16LE(timestamp.date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(source.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    name.copy(localHeader, 30);

    chunks.push(localHeader, compressed);
    centralDirectory.push(buildCentralDirectoryRecord({
      name,
      crc,
      compressedSize: compressed.length,
      uncompressedSize: source.length,
      timestamp,
      offset
    }));
    offset += localHeader.length + compressed.length;
  });

  const centralOffset = offset;
  const centralSize = centralDirectory.reduce((total, item) => total + item.length, 0);
  const end = Buffer.alloc(22);

  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centralDirectory.length, 8);
  end.writeUInt16LE(centralDirectory.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat(chunks.concat(centralDirectory, end));
}

function buildCentralDirectoryRecord(entry) {
  const header = Buffer.alloc(46 + entry.name.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(entry.timestamp.time, 12);
  header.writeUInt16LE(entry.timestamp.date, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressedSize, 20);
  header.writeUInt32LE(entry.uncompressedSize, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.offset, 42);
  entry.name.copy(header, 46);
  return header;
}

function dosTimestamp(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  };
}

function crc32(buffer) {
  var crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
