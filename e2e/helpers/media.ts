import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Device, LaunchPermissions } from '@e2e-dev/mobile';

/** Two synthetic images, created once per owned simulator with no EXIF data. */
export function addGalleryFixtures() {
  const device = process.env.NA_PIVO_E2E_DEVICE!;
  const directory = path.resolve('.e2e/gallery');
  fs.mkdirSync(directory, { recursive: true });
  const marker = path.join(directory, `${device}.added`);
  if (fs.existsSync(marker)) return;
  execFileSync(path.resolve('backend/.venv/bin/python'), ['-c', `
from pathlib import Path
from PIL import Image, ImageDraw
import sys
destination = Path(sys.argv[1])
for name, color in [('amber', '#F4B000'), ('foam', '#EEE5D0')]:
    image = Image.new('RGB', (256, 256), '#281A0C')
    draw = ImageDraw.Draw(image)
    draw.rectangle((32, 32, 224, 224), fill=color)
    draw.line((32, 32, 224, 224), fill='#281A0C', width=16)
    draw.text((80, 116), 'E2E ' + name, fill='#281A0C')
    image.save(destination / (name + '.png'))
`, directory], { stdio: 'ignore' });
  execFileSync('xcrun', ['simctl', 'addmedia', device, path.join(directory, 'amber.png'), path.join(directory, 'foam.png')], { stdio: 'ignore' });
  fs.writeFileSync(marker, 'synthetic fixtures only\n');
}

/** Documented per-launch override; app.restart() returns to config defaults. */
export async function restartWithPermissions(device: Device, permissions: LaunchPermissions) {
  await device.openApp('com.tomasmach.na-pivo', {
    relaunch: true,
    permissions: { location: 'grant', camera: 'deny', photos: 'grant', ...permissions },
  });
}
