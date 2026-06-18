'use strict';

const DEFAULT_CREDITS = 10;
const MIN_RATING = 3.9;
const MIN_REVIEWS = 100;

function normalizeTurkish(value = '') {
  return String(value)
    .trim()
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9çğıöşü\s-]/g, ' ')
    .replace(/[ç]/g, 'c')
    .replace(/[ğ]/g, 'g')
    .replace(/[ö]/g, 'o')
    .replace(/[ş]/g, 's')
    .replace(/[ü]/g, 'u')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCreditCost(city, allCity) {
  if (!allCity) return 1;
  const normalizedCity = normalizeTurkish(city);
  if (normalizedCity === 'istanbul') return 5;
  if (['ankara', 'izmir', 'bursa'].includes(normalizedCity)) return 3;
  return 2;
}

function validateSearchInput(data, locations) {
  const query = typeof data?.query === 'string' ? data.query.trim() : '';
  const city = typeof data?.city === 'string' ? data.city.trim() : '';
  const district = typeof data?.district === 'string' ? data.district.trim() : '';
  const allCity = data?.allCity === true;

  if (query.length < 2 || query.length > 80) throw new Error('INVALID_QUERY');
  if (!city || city.length > 40) throw new Error('INVALID_CITY');
  if ((!district && !allCity) || district.length > 50) throw new Error('INVALID_DISTRICT');

  const province = locations.find((item) => normalizeTurkish(item.name) === normalizeTurkish(city));
  if (!province) throw new Error('INVALID_CITY');
  if (!allCity && !province.districts.some((item) => normalizeTurkish(item.name) === normalizeTurkish(district))) {
    throw new Error('INVALID_DISTRICT');
  }

  return { query, city: province.name, district, allCity };
}

function findMentionedLocation(query, locations, preferredCity = '') {
  const normalizedQuery = ` ${normalizeTurkish(query)} `;
  const candidates = [];

  for (const province of locations) {
    candidates.push({ name: province.name, city: province.name, district: null });
    for (const district of province.districts) {
      candidates.push({ name: district.name, city: province.name, district: district.name });
    }
  }

  const matches = candidates
    .filter((candidate) => normalizedQuery.includes(` ${normalizeTurkish(candidate.name)} `))
    .sort((a, b) => b.name.length - a.name.length);
  if (!matches.length) return null;

  const longestName = normalizeTurkish(matches[0].name);
  const sameName = matches.filter((candidate) => normalizeTurkish(candidate.name) === longestName);
  const provinceMatch = sameName.find((candidate) => candidate.district === null);
  if (provinceMatch) return provinceMatch;
  if (sameName.length === 1) return sameName[0];
  return sameName.find((candidate) => normalizeTurkish(candidate.city) === normalizeTurkish(preferredCity)) ?? null;
}

function buildTextQuery(input, mentionedLocation, useTypedLocation) {
  if (useTypedLocation && mentionedLocation) return `${input.query}, Türkiye`;

  let category = input.query;
  if (mentionedLocation) {
    const escaped = mentionedLocation.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    category = category.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'iu'), ' ').replace(/\s+/g, ' ').trim();
  }

  const location = input.allCity ? input.city : `${input.district}, ${input.city}`;
  return `${category || input.query}, ${location}, Türkiye`;
}

function filterPlaces(places = []) {
  const seen = new Set();
  return places
    .map((place) => ({
      id: String(place.id ?? ''),
      name: String(place.displayName?.text ?? '').trim(),
      rating: Number(place.rating ?? 0),
      reviews: Number(place.userRatingCount ?? 0),
      address: String(place.formattedAddress ?? '').trim(),
      mapsUrl: String(place.googleMapsUri ?? '').trim()
    }))
    .filter((place) => place.id && place.name && place.rating >= MIN_RATING && place.reviews >= MIN_REVIEWS)
    .filter((place) => {
      if (seen.has(place.id)) return false;
      seen.add(place.id);
      return true;
    })
    .sort((a, b) => b.rating - a.rating || b.reviews - a.reviews);
}

module.exports = {
  DEFAULT_CREDITS,
  MIN_RATING,
  MIN_REVIEWS,
  normalizeTurkish,
  getCreditCost,
  validateSearchInput,
  findMentionedLocation,
  buildTextQuery,
  filterPlaces
};
