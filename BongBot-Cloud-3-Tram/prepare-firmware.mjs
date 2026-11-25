import { X509Certificate, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const project = import.meta.dirname;
const endpoint = 'https://rjvcrcskqslirypvzljf.supabase.co/functions/v1/ingest';
const stations = ['BB-01', 'BB-02', 'BB-03'];
const prompt = createInterface({ input: process.stdin, output: process.stdout });
const certificatePattern = /\bROOT_CA\s*=\s*R"PEM\(([\s\S]*?)\)PEM"/;

try {
  const trustedConfig = readFileSync(join(project, 'firmware', 'Station', 'bong_bot_local_config.h'), 'utf8');
  const trustedEndpoint = trustedConfig.match(/\bINGEST_URL\s*=\s*"([^"]+)"/)?.[1];
  const pem = trustedConfig.match(certificatePattern)?.[1].trim() ?? '';
  if (trustedEndpoint !== endpoint || !pem || !new X509Certificate(pem).ca) {
    throw Error('Khong tim thay CA Supabase hop le trong goi Cloud. Kiem tra file do setup-stations.mjs tao.');
  }

  const selection = (await prompt.question('Chon tram (1 = BB-01, 2 = BB-02, 3 = BB-03): ')).trim();
  if (!/^[1-3]$/.test(selection)) throw Error('Nhap 1, 2 hoac 3.');
  const station = stations[Number(selection) - 1];
  if (station !== 'BB-01') {
    const confirmed = (await prompt.question(
      'Tram nay dung cung chan GPS/SD/ADC, UART RX18 TX15 baud 9600 va cung APN nhu BB-01? [y/N] '
    )).trim().toLowerCase();
    if (confirmed !== 'y') throw Error('Can cau hinh phan cung rieng cho tram nay.');
  }
  const token = JSON.parse(readFileSync(join(project, 'private', 'stations.json'), 'utf8'))[station];
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) throw Error('Khong tim thay token da tao cua ' + station);
  const digest = createHash('sha256').update(token).digest('hex');
  const registration = readFileSync(join(project, 'private', 'register.sql'), 'utf8');
  if (!registration.includes(`('${station}','Trạm ${station}','${digest}')`)) {
    throw Error('Token va register.sql khong khop. Dung lai thu muc private da dang ky.');
  }

  const template = join(project, 'firmware-template');
  const hardware = readFileSync(join(template, 'settings.example.h'), 'utf8');
  const sketch = readFileSync(join(template, 'Station.ino'), 'utf8');
  const output = join(project, 'firmware-build', station, 'Station');
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'Station.ino'), sketch);
  writeFileSync(join(output, 'bong_bot_local_config.h'),
    hardware.replace(certificatePattern, () => `ROOT_CA = R"PEM(\n${pem}\n)PEM"`));
  writeFileSync(join(output, 'station_profile.h'),
    `#pragma once\n#define STATION_ID "${station}"\n#define STATION_TOKEN "${token}"\n`,
    { mode: 0o600 });
  console.log('Da tao firmware cho ' + station);
  console.log('Mo file Arduino: ' + join(output, 'Station.ino'));
} catch (error) {
  console.error('Loi: ' + error.message);
  process.exitCode = 1;
} finally {
  prompt.close();
}
