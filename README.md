# Mekân Bul

Google Places verileriyle, seçilen konumda en az 3,9 puanlı ve 100 yorumlu işletmeleri listeleyen Firebase tabanlı web uygulaması.

## Geliştirme

```bash
npm install
npm --prefix functions install
npm run dev
```

Google Maps API anahtarı kaynak kodda tutulmaz. Cloud Functions, Secret Manager'daki `GOOGLE_MAPS_API_KEY` secret'ını kullanır.

## Dağıtım

```bash
npm run build
npx -y firebase-tools@latest deploy --project maps-parser-isildur
```

## Kullanım hakları

Copyright © 2026. All rights reserved.

Bu depo ve içeriği özel mülkiyettir. Açık kaynak lisansı verilmemiştir; sahibinin yazılı izni olmadan kopyalanamaz, dağıtılamaz veya türev çalışma oluşturmak için kullanılamaz.

### Kredi yönetimi

Profil menüsündeki kullanıcı ID, Firestore'daki `users/{UID}` belgesinin kimliğidir. Kullanıcı kredisi Firebase Console'dan bu belgedeki `creditsRemaining` alanı değiştirilerek yönetilir.
