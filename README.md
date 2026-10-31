# Zero Trust Security — Sistem Pengelolaan Nilai

Proyek pembelajaran arsitektur Zero Trust untuk API pengelolaan nilai akademik. Request pengguna masuk melalui **API Gateway :3000**; **Service Nilai :3001** dan **Service Transkrip :3002** menjalankan fungsi terpisah. Sistem memeriksa token, sesi, perangkat, role, kepemilikan kelas, dan aturan akses pada setiap request. Aplikasi dikonfigurasi untuk demonstrasi lokal dan tidak menyertakan frontend.

## Arsitektur

```text
Klien / Thunder Client
      |
      v
API Gateway :3000
  |           \
  v            v
Service Nilai :3001   Service Transkrip :3002
  |            ^              ^
  |            |              |
  +------------+--------------+
               |
               v
       SQLite: data/zero-trust.sqlite
```

Gateway memeriksa autentikasi dan policy sebelum meneruskan request. Kedua service memeriksa ulang gateway secret dan token. Saat nilai difinalisasi, Service Nilai meminta service token lalu melakukan sinkronisasi transkrip melalui Gateway. Semua komponen berbagi database SQLite lokal.

## Teknologi

- Node.js 24 LTS (minimal 24.13.0) dan npm
- Express 5 dan `jsonwebtoken`
- SQLite bawaan Node.js (`node:sqlite`)
- Thunder Client di VS Code atau PowerShell untuk pengujian API

## Mulai cepat

Butuh **Node.js 24 LTS (minimal 24.13.0)** dan npm. Tidak perlu MySQL, XAMPP, Laragon, Docker, akun cloud, atau API key.

```powershell
npm ci
npm run setup
```

Pada pertama kali, `setup` membuat `.env` dengan secret acak. Ganti enam placeholder `SEED_*_PASSWORD` di `.env` dengan password pilihan Anda (minimal 12 karakter), lalu jalankan lagi:

```powershell
npm run setup
npm start
```

Setup kedua membuat file `data/zero-trust.sqlite`, tabel, dan data awal. Menjalankan setup lagi tidak mengganti secret, password, atau data yang sudah ada. `npm start` menjalankan tiga proses terpisah; hentikan semuanya dengan Ctrl+C atau ketik `q` lalu Enter. Di folder kerja yang sudah disiapkan, jika database dan konfigurasi sudah tersedia cukup jalankan `npm start`.

Di terminal kedua:

```powershell
npm test
npm run demo
npm run audit
```

**Jam tulis default 07.00 sampai sebelum 21.00 WIB.** Untuk demo di luar jam tersebut, ubah `.env` menjadi `ACCESS_START=00:00` dan `ACCESS_END=24:00`, lalu restart ketiga proses. Kembalikan ke 07:00-21:00 untuk mendemokan penolakan akses. Script demo benar-benar memfinalisasi kelas 1 jika jam mengizinkan. Tes otomatis memakai database sementara dan tidak mengubah database kerja.

## Akun awal

Password setiap akun demo diatur sendiri melalui variabel `SEED_*_PASSWORD` di `.env` sebelum database pertama kali di-seed. Gunakan password minimal 12 karakter dan jangan membagikan `.env`. Seed menyimpan hash password, bukan teks aslinya.

| Username | Role | NIM | Header X-Device-ID | Password di `.env` |
| --- | --- | --- | --- | --- |
| admin | admin | - | admin-laptop | `SEED_ADMIN_PASSWORD` |
| dosen1 | dosen | - | dosen1-laptop | `SEED_DOSEN01_PASSWORD` |
| dosen2 | dosen | - | dosen2-laptop | `SEED_DOSEN02_PASSWORD` |
| mhs1 | mahasiswa | 237006001 | mhs1-laptop | `SEED_MHS01_PASSWORD` |
| mhs2 | mahasiswa | 237006002 | mhs2-laptop | `SEED_MHS02_PASSWORD` |
| mhs3 | mahasiswa | 237006003 | mhs3-laptop | `SEED_MHS03_PASSWORD` |

Kelas 1: Keamanan Informasi, pengampu `dosen1`, ID nilai 1-3. Kelas 2: Basis Data, pengampu `dosen2`, ID nilai 4-6. Setiap kelas berisi tiga mahasiswa. Pada data awal semua nilai masih draft dan transkrip kosong.

## Contoh pertama di PowerShell

```powershell
$password = Read-Host 'Masukkan password SEED_MHS01_PASSWORD dari .env'
$body = @{ username = 'mhs1'; password = $password } | ConvertTo-Json -Compress
$login = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/auth/login' `
  -ContentType 'application/json' -Headers @{ 'X-Device-ID' = 'mhs1-laptop' } `
  -Body $body

$headers = @{
  Authorization = "Bearer $($login.access_token)"
  'X-Device-ID' = 'mhs1-laptop'
}
Invoke-RestMethod 'http://127.0.0.1:3000/nilai' -Headers $headers | ConvertTo-Json -Depth 6
```

Untuk menguji API di VS Code, install extension **Thunder Client** dan buat request login `POST http://127.0.0.1:3000/auth/login` dengan header `Content-Type: application/json`, `X-Device-ID: mhs1-laptop`, serta body JSON berisi username `mhs1` dan password dari `SEED_MHS01_PASSWORD` di `.env`. Salin `access_token` dari respons login, lalu gunakan sebagai `Authorization: Bearer <access_token>` pada request terlindungi dan tambahkan header device yang sesuai akun. Request `GET http://127.0.0.1:3000/nilai` dengan token mahasiswa akan menampilkan nilai milik mahasiswa itu.

## Endpoint utama

| Method | Endpoint | Fungsi | Akses |
| --- | --- | --- | --- |
| `POST` | `/auth/login` | Login dan menerbitkan access serta refresh token | Kredensial dan `X-Device-ID` terdaftar |
| `POST` | `/auth/refresh` | Rotasi refresh token | Refresh token dan device sesi |
| `POST` | `/auth/logout` | Mencabut sesi | Refresh token dan device sesi |
| `POST` | `/auth/service` | Menerbitkan token Service Nilai selama 5 menit | Client credentials dari `.env` |
| `GET` | `/nilai` | Membaca nilai | Mahasiswa: nilai sendiri; dosen: kelas yang diampu |
| `PUT` | `/nilai/:id` | Mengubah nilai | Dosen pengampu, sebelum finalisasi dan dalam jam akses |
| `POST` | `/kelas/:id/finalisasi` | Mengunci nilai dan menyinkronkan transkrip | Dosen pengampu, nilai lengkap dan dalam jam akses |
| `GET` | `/transkrip/:nim` | Membaca transkrip | Mahasiswa pemilik NIM atau admin |
| `POST` | `/transkrip/sinkron` | Sinkron nilai final ke transkrip | Token service; komunikasi internal melalui Gateway |

Semua endpoint user yang dilindungi memerlukan `Authorization: Bearer <access_token>` dan `X-Device-ID`. Jangan membagikan client secret atau token kepada pengguna lain.

## Fitur keamanan dan alur autentikasi

- Access JWT 10 menit (sub, role, type, sid, device, issuer, audience, exp); verifikasi HS256 eksplisit.
- Refresh token acak 1 hari, hash di database, rotasi atomik, serta logout yang mencabut sesi. Token akses sesi tersebut langsung ikut ditolak.
- Token Service Nilai 5 menit melalui `/auth/service`; hanya bisa `POST /transkrip/sinkron`.
- Verifikasi device, user aktif, role terbaru, sesi, kepemilikan kelas/NIM dari DB pada setiap akses.
- Gateway secret ditambahkan oleh gateway; service memeriksa secret, tanda tangan, masa berlaku, identitas dan scope lagi.
- Default deny; query nilai difilter berdasarkan identitas, tidak berdasarkan NIM/role kiriman client.
- Finalisasi atomik mengunci kelas. Sinkron melalui gateway membaca nilai final dari DB dan idempoten. Gagal sinkron dapat dicoba ulang.
- Audit keputusan allow/deny di database; tidak mencatat body, query string atau header kredensial.

Alur ringkas: pengguna login dengan password dan device ID terdaftar; Gateway menerbitkan access token 10 menit dan refresh token 1 hari. Setiap request terproteksi memeriksa token, sesi aktif, device, role terkini, dan policy. Saat finalisasi, Service Nilai meminta token service berumur 5 menit lalu menyinkronkan nilai final melalui Gateway; operasi sinkron dapat diulang dengan aman.

## Mengatur password akun demo

1. Ganti semua placeholder `SEED_*_PASSWORD` di `.env` dengan password berbeda minimal 12 karakter.
2. Jalankan `npm run setup` untuk database baru. Setup hanya menambahkan akun ketika tabel users masih kosong; seed berikutnya tidak mengubah password atau data yang sudah ada.
3. Jika database sudah berisi akun, mengubah `.env` tidak mengubah password akun tersebut. Untuk membuat database demo baru tanpa menghapus data lama, ubah `DB_PATH` di `.env`, misalnya menjadi `./data/zero-trust-demo-baru.sqlite`, lalu jalankan `npm run setup`.

## Perintah

| Perintah | Kegunaan |
| --- | --- |
| `npm run setup` | Buat konfigurasi, tabel, dan seed jika belum ada |
| `npm start` | Jalankan ketiga proses sekaligus |
| `npm run start:gateway` | Jalankan gateway saja |
| `npm run start:nilai` | Jalankan Service Nilai saja |
| `npm run start:transkrip` | Jalankan Service Transkrip saja |
| `npm run db:seed` | Tambahkan seed hanya ketika tabel users kosong |
| `npm run db:inspect` | Lihat user/device, kelas, nilai dan transkrip |
| `npm run audit` | Lihat 50 keputusan gateway terakhir |
| `npm run demo` | Uji alur HTTP; dapat memfinalisasi kelas 1 |
| `npm test` | Tes otomatis dengan database sementara |

## Struktur dan bahan praktikum

```text
.env.example                    Template konfigurasi; setup membuat .env lokal
.gitignore                      Mengabaikan secret, database dan dependensi lokal
config.js                       Membaca dan memvalidasi konfigurasi
package.json                    Perintah npm dan dependensi
package-lock.json               Versi dependensi yang terkunci
README.md                       Panduan utama
database/
  db.js                          Koneksi dan transaksi SQLite
  schema.sql                     Definisi tabel
  seed.js                        Data awal demo
gateway/
  index.js                       Aplikasi gateway, audit dan proxy
  policy.js                      Aturan akses berdasarkan endpoint dan database
  middleware/
    verify-user.js               Verifikasi token pengguna dan service
  routes/
    auth.js                      Login, refresh, logout dan token service
service-nilai/
  index.js                       API nilai, finalisasi dan sinkron ke gateway
service-transkrip/
  index.js                       API baca dan sinkron transkrip
shared/
  index.js                       Utilitas HTTP, token, identitas dan aturan akses
scripts/
  setup.js                       Membuat konfigurasi, database dan seed
  start.js                       Menjalankan tiga service
  seed.js, inspect.js, demo.js   Operasi database dan demo API
test/
  integration.test.js            Tes integrasi HTTP
  policy.test.js                  Tes policy dan jam akses
  setup.test.js                  Tes setup
data/                            Database lokal hasil setup (tidak di-commit)
node_modules/                    Dependensi hasil npm ci (tidak di-commit)
```

Struktur inti terdiri dari database, gateway dengan middleware/routes/policy, serta dua service terpisah. Folder `shared/`, `scripts/`, dan `test/` masing-masing berisi kode bersama, alat operasional, dan pengujian. Setiap service menampung route, validasi, aturan bisnis, dan query khusus domain di satu file utama. Setiap `index.js` mengekspor factory aplikasi untuk tes, dan hanya membuka port saat dijalankan langsung.

## Batas praktikum

Server default hanya mendengarkan `127.0.0.1`. Ini implementasi pendidikan dengan shared database dan shared secret sesuai penyederhanaan tugas. Device ID adalah atribut terdaftar, bukan attestation hardware. Untuk deployment nyata diperlukan TLS, pemisahan jaringan/kredensial, rate limiting dan pengelolaan secret. Jangan unggah `.env`, database aktif, atau request Thunder Client yang sudah berisi token atau secret. `.gitignore` mengabaikan `.env` dan database lokal.

Referensi implementasi: [Node.js SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html), [Express error handling](https://expressjs.com/en/guide/error-handling.html), [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken). Pada Node.js 24.13.0, `node:sqlite` dapat menampilkan `ExperimentalWarning`; pengujian di versi tersebut sudah berjalan.
