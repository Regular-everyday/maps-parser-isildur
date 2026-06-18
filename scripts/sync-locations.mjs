import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const provinceUrl = 'https://api.turkiyeapi.dev/v2/datasets/provinces.json';
const districtUrl = 'https://api.turkiyeapi.dev/v2/datasets/districts.json';
const [provinceResponse, districtResponse] = await Promise.all([fetch(provinceUrl), fetch(districtUrl)]);

if (!provinceResponse.ok || !districtResponse.ok) {
  throw new Error(`Konum verisi alınamadı: HTTP ${provinceResponse.status}/${districtResponse.status}`);
}

const [provinces, districts] = await Promise.all([provinceResponse.json(), districtResponse.json()]);
const locations = provinces
  .map((province) => ({
    id: province.id,
    name: province.name,
    districts: districts
      .filter((district) => district.provinceId === province.id)
      .map((district) => ({ id: district.id, name: district.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  }))
  .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

const districtCount = locations.reduce((total, province) => total + province.districts.length, 0);
if (locations.length !== 81 || districtCount < 900) {
  throw new Error(`Beklenmeyen veri seti: ${locations.length} il, ${districtCount} ilçe`);
}

const document = `${JSON.stringify({
  source: [provinceUrl, districtUrl],
  datasetVersion: '2025',
  lastUpdated: '2026-05-21',
  locations
}, null, 2)}\n`;

for (const destination of ['src/data/locations.json', 'functions/data/locations.json']) {
  const absolutePath = path.resolve(process.cwd(), destination);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, document, 'utf8');
}

console.log(`${locations.length} il ve ${districtCount} ilçe kaydedildi.`);
