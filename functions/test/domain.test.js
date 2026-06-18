'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeTurkish,
  getCreditCost,
  validateSearchInput,
  findMentionedLocation,
  buildTextQuery,
  filterPlaces
} = require('../lib/domain');

const locations = [
  { name: 'İstanbul', districts: [{ name: 'Kadıköy' }, { name: 'Fatih' }, { name: 'Merkez' }] },
  { name: 'Ankara', districts: [{ name: 'Çankaya' }, { name: 'Merkez' }] },
  { name: 'Antalya', districts: [{ name: 'Kaş' }] }
];

test('Türkçe metni karşılaştırma için normalize eder', () => {
  assert.equal(normalizeTurkish('  Şişli, İSTANBUL! '), 'sisli istanbul');
});

test('tekrarlanan ilçe adını seçili şehir bağlamıyla çözer', () => {
  assert.deepEqual(findMentionedLocation('merkez pizza', locations, 'Ankara'), {
    name: 'Merkez', city: 'Ankara', district: 'Merkez'
  });
  assert.equal(findMentionedLocation('merkez pizza', locations), null);
});

test('şehir araması kredi tarifesini uygular', () => {
  assert.equal(getCreditCost('İstanbul', true), 5);
  assert.equal(getCreditCost('İzmir', true), 3);
  assert.equal(getCreditCost('Bursa', true), 3);
  assert.equal(getCreditCost('Antalya', true), 2);
  assert.equal(getCreditCost('İstanbul', false), 1);
});

test('arama metnindeki ilçeyi bulur ve seçilen konuma göre çıkarır', () => {
  const mentioned = findMentionedLocation('Kadıköy kebapçı', locations);
  assert.deepEqual(mentioned, { name: 'Kadıköy', city: 'İstanbul', district: 'Kadıköy' });
  const input = validateSearchInput({ query: 'Kadıköy kebapçı', city: 'Ankara', district: 'Çankaya' }, locations);
  assert.equal(buildTextQuery(input, mentioned, false), 'kebapçı, Çankaya, Ankara, Türkiye');
  assert.equal(buildTextQuery(input, mentioned, true), 'Kadıköy kebapçı, Türkiye');
});

test('yalnızca eşikleri geçen benzersiz sonuçları döndürür', () => {
  const result = filterPlaces([
    { id: 'a', displayName: { text: 'A' }, rating: 4.6, userRatingCount: 150, googleMapsUri: 'https://maps.google.com/a' },
    { id: 'a', displayName: { text: 'A kopya' }, rating: 4.7, userRatingCount: 200 },
    { id: 'b', displayName: { text: 'B' }, rating: 3.8, userRatingCount: 500 },
    { id: 'c', displayName: { text: 'C' }, rating: 4.8, userRatingCount: 99 }
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'A');
});
