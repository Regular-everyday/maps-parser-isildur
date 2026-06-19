'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const locationData = require('./data/locations.json');
const {
  DEFAULT_CREDITS,
  getCreditCost,
  normalizeTurkish,
  validateSearchInput,
  findMentionedLocation,
  buildTextQuery,
  filterPlaces
} = require('./lib/domain');

initializeApp();

const db = getFirestore('maps-parser');
const mapsApiKey = defineSecret('GOOGLE_MAPS_API_KEY');
const locations = locationData.locations;
const callableOptions = {
  region: 'europe-west3',
  timeoutSeconds: 30,
  memory: '256MiB',
  maxInstances: 10,
  invoker: 'public',
  cors: [
    'https://maps-parser-isildur.web.app',
    'https://maps-parser-isildur.firebaseapp.com',
    /^http:\/\/localhost(:\\d+)?$/
  ],
  secrets: [mapsApiKey]
};

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
  }
  return request.auth;
}

function safeString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function profileFromAuth(auth) {
  const token = auth.token ?? {};
  return {
    uid: auth.uid,
    email: safeString(token.email, 254),
    displayName: safeString(token.name, 80),
    photoURL: safeString(token.picture, 500),
    provider: token.firebase?.sign_in_provider === 'google.com' ? 'google.com' : 'password'
  };
}

async function readDefaultCredits(transaction) {
  const configSnapshot = await transaction.get(db.doc('config/app'));
  const configured = configSnapshot.exists ? configSnapshot.get('defaultCredits') : null;
  return Number.isInteger(configured) && configured >= 0 && configured <= 10000
    ? configured
    : DEFAULT_CREDITS;
}

function newUserData(auth, credits) {
  return {
    ...profileFromAuth(auth),
    creditsRemaining: credits,
    creditsTotal: credits,
    createdAt: FieldValue.serverTimestamp(),
    lastSignedInAt: FieldValue.serverTimestamp()
  };
}

exports.ensureProfile = onCall(callableOptions, async (request) => {
  const auth = requireAuth(request);
  const userRef = db.doc(`users/${auth.uid}`);

  await db.runTransaction(async (transaction) => {
    const defaultCredits = await readDefaultCredits(transaction);
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      transaction.create(userRef, newUserData(auth, defaultCredits));
      return;
    }
    transaction.update(userRef, {
      ...profileFromAuth(auth),
      lastSignedInAt: FieldValue.serverTimestamp()
    });
  });

  return { ok: true };
});

exports.resolveLocation = onCall(callableOptions, async (request) => {
  requireAuth(request);
  const latitude = Number(request.data?.latitude);
  const longitude = Number(request.data?.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new HttpsError('invalid-argument', 'Geçersiz koordinat.');
  }

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('latlng', `${latitude},${longitude}`);
  url.searchParams.set('language', 'tr');
  url.searchParams.set('key', mapsApiKey.value());

  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || payload.status !== 'OK' || !payload.results?.length) {
    console.warn('Geocoding API konumu çözemedi', {
      httpStatus: response.status,
      apiStatus: payload.status,
      errorMessage: safeString(payload.error_message, 300)
    });
    throw new HttpsError('not-found', 'Konum adresi belirlenemedi.');
  }

  const components = payload.results.flatMap((result) => result.address_components ?? []);
  const findByType = (type) => components.find((component) => component.types?.includes(type))?.long_name ?? '';
  const provinceName = findByType('administrative_area_level_1');
  const province = locations.find((item) => normalizeTurkish(item.name) === normalizeTurkish(provinceName));
  if (!province) {
    return { country: findByType('country'), outsideTurkey: true };
  }

  const possibleDistricts = [
    findByType('administrative_area_level_2'),
    findByType('sublocality_level_1'),
    findByType('sublocality'),
    findByType('locality')
  ].filter(Boolean);
  const district = province.districts.find((item) =>
    possibleDistricts.some((name) => normalizeTurkish(name) === normalizeTurkish(item.name))
  );
  const label = findByType('neighborhood') || findByType('sublocality_level_1') || district?.name || province.name;

  return {
    outsideTurkey: false,
    city: province.name,
    district: district?.name ?? null,
    label,
    latitude,
    longitude
  };
});

function makeFingerprint(input, useTypedLocation) {
  return JSON.stringify({
    query: normalizeTurkish(input.query),
    city: normalizeTurkish(input.city),
    district: normalizeTurkish(input.district),
    allCity: input.allCity,
    useTypedLocation
  });
}

async function searchGooglePlaces(textQuery) {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': mapsApiKey.value(),
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.rating',
        'places.userRatingCount',
        'places.googleMapsUri',
        'places.formattedAddress'
      ].join(',')
    },
    body: JSON.stringify({
      textQuery,
      languageCode: 'tr',
      regionCode: 'TR',
      pageSize: 20
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    const message = payload.error?.message || `Places API HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload.places ?? [];
}

exports.searchPlaces = onCall(callableOptions, async (request) => {
  const auth = requireAuth(request);
  const requestId = safeString(request.data?.requestId, 64);
  if (!/^[a-zA-Z0-9-]{12,64}$/.test(requestId)) {
    throw new HttpsError('invalid-argument', 'Geçersiz arama kimliği.');
  }

  let input;
  try {
    input = validateSearchInput(request.data, locations);
  } catch {
    throw new HttpsError('invalid-argument', 'Arama veya konum bilgisi geçersiz.');
  }

  const useTypedLocation = request.data?.useTypedLocation === true;
  const mentionedLocation = findMentionedLocation(input.query, locations, input.city);
  const textQuery = buildTextQuery(input, mentionedLocation, useTypedLocation);
  const cost = getCreditCost(input.city, input.allCity);
  const fingerprint = makeFingerprint(input, useTypedLocation);
  const userRef = db.doc(`users/${auth.uid}`);
  const searchRef = userRef.collection('searches').doc(requestId);

  const reservation = await db.runTransaction(async (transaction) => {
    const defaultCredits = await readDefaultCredits(transaction);
    const userSnapshot = await transaction.get(userRef);
    const searchSnapshot = await transaction.get(searchRef);

    if (searchSnapshot.exists) {
      const existing = searchSnapshot.data();
      if (existing.fingerprint !== fingerprint) {
        throw new HttpsError('already-exists', 'Arama kimliği daha önce kullanılmış.');
      }
      if (existing.status === 'completed') {
        return { cached: true, search: existing };
      }
      if (existing.status === 'pending') {
        return { cached: false, resumed: true };
      }
      throw new HttpsError('failed-precondition', 'Bu arama daha önce başarısız oldu.');
    }

    const userData = userSnapshot.exists ? userSnapshot.data() : newUserData(auth, defaultCredits);
    const creditsRemaining = Number(userData.creditsRemaining ?? 0);
    if (!Number.isFinite(creditsRemaining) || creditsRemaining < cost) {
      throw new HttpsError('resource-exhausted', `Bu arama için ${cost} kredi gerekiyor.`);
    }

    if (!userSnapshot.exists) {
      transaction.create(userRef, {
        ...userData,
        creditsRemaining: creditsRemaining - cost,
        lastSearchAt: FieldValue.serverTimestamp()
      });
    } else {
      transaction.update(userRef, {
        creditsRemaining: creditsRemaining - cost,
        lastSearchAt: FieldValue.serverTimestamp()
      });
    }
    transaction.create(searchRef, {
      fingerprint,
      query: input.query,
      city: input.city,
      district: input.allCity ? null : input.district,
      allCity: input.allCity,
      cost,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      textQuery
    });
    return { cached: false, resumed: false };
  });

  if (reservation.cached) {
    return {
      results: reservation.search.results ?? [],
      totalFound: reservation.search.totalFound ?? 0,
      cost: reservation.search.cost,
      cached: true
    };
  }

  try {
    const rawPlaces = await searchGooglePlaces(textQuery);
    const results = filterPlaces(rawPlaces);
    await searchRef.update({
      status: 'completed',
      results,
      totalFound: rawPlaces.length,
      filteredOut: rawPlaces.length - results.length,
      completedAt: FieldValue.serverTimestamp()
    });
    return { results, totalFound: rawPlaces.length, cost, cached: false };
  } catch (error) {
    await db.runTransaction(async (transaction) => {
      const [userSnapshot, searchSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(searchRef)
      ]);
      if (!userSnapshot.exists || !searchSnapshot.exists || searchSnapshot.get('status') !== 'pending') return;
      transaction.update(userRef, {
        creditsRemaining: Number(userSnapshot.get('creditsRemaining') ?? 0) + cost
      });
      transaction.update(searchRef, {
        status: 'failed',
        refunded: true,
        error: safeString(error.message, 300),
        completedAt: FieldValue.serverTimestamp()
      });
    });
    console.error('Places araması başarısız:', error);
    throw new HttpsError('internal', 'Mekân araması tamamlanamadı; krediniz iade edildi.');
  }
});
