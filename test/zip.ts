// Test data: zip files written without a library, to make .vsix files, valid or broken.

import { crc32 } from 'node:zlib';

/** A zip file with these entries, stored without compression: enough to write a .vsix, or a broken one. */
export function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** An extension with one dark theme, as `vsce package` writes it: the files under extension/, and a manifest. */
export const EXTENSION: Record<string, string> = {
  'extension.vsixmanifest': '<PackageManifest/>',
  'extension/package.json': JSON.stringify({ name: 'night', publisher: 'someone', contributes: { themes: [{ label: 'Night', uiTheme: 'vs-dark', path: './themes/night.json' }] } }),
  'extension/themes/night.json': JSON.stringify({ colors: { 'editor.background': '#1E1E1E', 'editor.foreground': '#D4D4D4' }, tokenColors: [{ scope: 'comment', settings: { foreground: '#6A9955' } }] }),
};

