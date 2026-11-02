# Beat Rhythm Game -> APK

## Cara 1: Build di GitHub (tanpa install apa pun)
1. Buat akun di github.com, lalu buat repository baru (boleh Private).
2. Upload SEMUA isi folder ini (termasuk folder .github) ke repository tersebut.
3. Buka tab "Actions" -> "Build APK" -> "Run workflow". Tunggu sekitar 5-10 menit.
4. Buka run yang selesai (centang hijau) -> bagian "Artifacts" -> unduh "beat-rhythm-game-apk".
5. Ekstrak ZIP-nya, kirim app-debug.apk ke HP, lalu install (izinkan "install dari sumber tidak dikenal").

## Cara 2: Build lokal (butuh Node.js 18+ dan Android Studio)
    npm install
    npx cap add android
    npx cap sync android
    npx cap open android
Di Android Studio: Build > Build APK(s).

## Mengubah game
Edit www/index.html, lalu build ulang (Cara 1: push lagi; Cara 2: npx cap sync android).

## Catatan
- Hasilnya APK debug: bisa langsung diinstal, tapi belum cocok untuk Google Play (butuh APK/AAB release yang ditandatangani).
- Nama aplikasi dan package ada di capacitor.config.json (appName, appId).
