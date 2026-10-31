# Zero Trust Security — Sistem Pengelolaan Nilai

## 1. Deskripsi

Proyek ini merupakan implementasi pembelajaran Zero Trust pada API pengelolaan nilai akademik. Request pengguna masuk melalui API Gateway, kemudian diteruskan ke Service Nilai atau Service Transkrip setelah Gateway memeriksa token, sesi, device terdaftar, role, dan aturan akses.

Ketiga proses dirancang untuk berjalan secara lokal di satu komputer. Proyek ini tidak menyediakan frontend; API dapat diuji dengan Thunder Client di VS Code atau PowerShell.

## 2. Arsitektur

```text
Klien / Thunder Client
        |
        v
API Gateway :3000
  |                 \
  v                  v
Service Nilai :3001   Service Transkrip :3002
  |                         ^
  |                         |
  +-------- SQLite ----------+
             data/zero-trust.sqlite

Alur sinkronisasi:
Service Nilai -> API Gateway -> Service Transkrip
```

Gateway bertindak sebagai pintu masuk request pengguna sekaligus Policy Enforcement Point. Setelah policy mengizinkan request, Gateway meneruskannya ke service tujuan. Kedua service memverifikasi ulang JWT dan secret komunikasi dari Gateway. Ketika nilai difinalisasi, Service Nilai meminta service token berumur lima menit, lalu mengirim permintaan sinkronisasi melalui Gateway. Semua proses menggunakan database SQLite yang sama untuk akun, device, sesi, kelas, nilai, transkrip, dan audit.

## 3. Teknologi

- Node.js 24 LTS (minimal 24.13.0) dan npm
- Express 5
- JSON Web Token melalui `jsonwebtoken`
- SQLite melalui modul bawaan Node.js `node:sqlite`
- `node:crypto` untuk hash password scrypt, refresh token, dan secret
- Thunder Client atau PowerShell untuk pengujian API

## 4. Struktur proyek

```text
tugas-zero-trust/
├── database/
│   ├── db.js
│   ├── schema.sql
│   └── seed.js
├── gateway/
│   ├── middleware/
│   │   └── verify-user.js
│   ├── routes/
│   │   └── auth.js
│   ├── index.js
│   └── policy.js
├── service-nilai/
│   └── index.js
├── service-transkrip/
│   └── index.js
├── shared/
│   └── index.js
├── scripts/
│   ├── demo.js
│   ├── inspect.js
│   ├── seed.js
│   ├── setup.js
│   └── start.js
├── test/
│   ├── integration.test.js
│   ├── policy.test.js
│   └── setup.test.js
├── .env.example
├── config.js
├── package.json
├── package-lock.json
└── README.md
```

File `.env` dan database `data/zero-trust.sqlite` dibuat secara lokal saat setup. Jangan unggah file konfigurasi rahasia atau database lokal ke repository.

## 5. Persiapan

1. Instal Node.js 24 LTS versi 24.13.0 atau lebih baru dalam seri 24.
2. Clone repository dan buka terminal pada folder proyek.
3. Pasang dependency:

```powershell
npm.cmd ci
```

Di Windows PowerShell, gunakan `npm.cmd` jika pemanggilan `npm` diblokir oleh execution policy.

4. Jalankan setup pertama untuk membuat `.env`:

```powershell
npm.cmd run setup
```

Setup membuat tiga secret acak dan enam placeholder password demo di `.env`. Ganti setiap nilai `SEED_*_PASSWORD` dengan password pilihan yang berbeda dan minimal 12 karakter. Jangan memakai placeholder sebagai password atau membagikan isi `.env`.

Variabel konfigurasi yang digunakan:

| Variabel | Fungsi | Nilai awal |
|---|---|---|
| `HOST` | Alamat bind proses | `127.0.0.1` |
| `GATEWAY_PORT` | Port API Gateway | `3000` |
| `NILAI_PORT` | Port Service Nilai | `3001` |
| `TRANSKRIP_PORT` | Port Service Transkrip | `3002` |
| `DB_PATH` | Lokasi file SQLite | `./data/zero-trust.sqlite` |
| `JWT_SECRET` | Kunci access JWT user dan service | Dibuat acak saat setup |
| `GATEWAY_SECRET` | Secret komunikasi Gateway-service | Dibuat acak saat setup |
| `SERVICE_CLIENT_ID` | ID client Service Nilai | `service-nilai` |
| `SERVICE_CLIENT_SECRET` | Kredensial token service | Dibuat acak saat setup |
| `SEED_*_PASSWORD` | Password untuk tiap akun awal | Diisi sebelum seed |
| `ACCESS_START`, `ACCESS_END` | Rentang waktu edit/finalisasi nilai | `07:00`–`21:00` |
| `ACCESS_TIMEZONE` | Zona waktu aturan akses | `Asia/Jakarta` |
| `REQUEST_TIMEOUT_MS` | Batas waktu request internal | `5000` |

## 6. Inisialisasi database dan data demo

Setelah mengisi keenam password di `.env`, jalankan setup kembali:

```powershell
npm.cmd run setup
```

Setup membuat tabel dan indeks, lalu mengisi data awal ketika tabel pengguna masih kosong. Password disimpan sebagai hash scrypt. Menjalankan setup ulang tidak mengganti secret, password, atau data yang sudah ada.

Daftar akun dan device awal:

| Username | Role | NIM | Device ID | Variabel password |
|---|---|---|---|---|
| `admin` | admin | - | `admin-laptop` | `SEED_ADMIN_PASSWORD` |
| `dosen1` | dosen | - | `dosen1-laptop` | `SEED_DOSEN01_PASSWORD` |
| `dosen2` | dosen | - | `dosen2-laptop` | `SEED_DOSEN02_PASSWORD` |
| `mhs1` | mahasiswa | `237006001` | `mhs1-laptop` | `SEED_MHS01_PASSWORD` |
| `mhs2` | mahasiswa | `237006002` | `mhs2-laptop` | `SEED_MHS02_PASSWORD` |
| `mhs3` | mahasiswa | `237006003` | `mhs3-laptop` | `SEED_MHS03_PASSWORD` |

Data awal berisi kelas Keamanan Informasi yang diampu `dosen1` dan Basis Data yang diampu `dosen2`. Masing-masing memiliki tiga nilai mahasiswa. Nilai belum difinalisasi, sehingga masih dapat diedit sesuai policy dan jam akses.

Jika database sudah berisi akun, mengubah password di `.env` tidak mengubah password pada database tersebut. Untuk membuat database demo baru tanpa menghapus data lama, ubah `DB_PATH` di `.env` ke nama file baru, kemudian jalankan setup.

## 7. Menjalankan aplikasi

Jalankan ketiga proses sekaligus dari folder proyek:

```powershell
npm.cmd start
```

Perintah tersebut menjalankan Gateway dan kedua service. Ketiganya harus tetap aktif selama pengujian. Hentikan dengan `Ctrl+C` atau ketik `q` lalu Enter.

Alamat lokal:

- API Gateway: `http://127.0.0.1:3000`
- Service Nilai: `http://127.0.0.1:3001`
- Service Transkrip: `http://127.0.0.1:3002`

Jika perlu menjalankan proses secara terpisah, gunakan satu terminal untuk masing-masing perintah:

```powershell
npm.cmd run start:gateway
npm.cmd run start:nilai
npm.cmd run start:transkrip
```

## 8. Endpoint utama

| Method | Endpoint Gateway | Fungsi | Akses utama |
|---|---|---|---|
| `POST` | `/auth/login` | Login dan menerbitkan token | Username, password, dan `X-Device-ID` terdaftar |
| `POST` | `/auth/refresh` | Merotasi refresh token | Refresh token dan `X-Device-ID` sesi |
| `POST` | `/auth/logout` | Mencabut sesi | Refresh token dan device penerbit |
| `POST` | `/auth/service` | Menerbitkan service token 5 menit | `client_id` dan `client_secret` pada body |
| `GET` | `/nilai` | Membaca daftar nilai | Mahasiswa untuk nilainya sendiri; dosen untuk kelas yang diampu |
| `PUT` | `/nilai/:id` | Mengubah nilai | Dosen pengampu, sebelum finalisasi dan dalam jam akses |
| `POST` | `/kelas/:id/finalisasi` | Memfinalisasi kelas dan menyinkronkan transkrip | Dosen pengampu, seluruh nilai terisi dan dalam jam akses |
| `GET` | `/transkrip/:nim` | Membaca transkrip mahasiswa | Mahasiswa untuk NIM sendiri; admin untuk semua mahasiswa |
| `POST` | `/transkrip/sinkron` | Sinkronisasi nilai final | Token service; komunikasi internal melalui Gateway |

Endpoint pengguna yang dilindungi memerlukan header `Authorization` yang berisi access token dari response login, serta header `X-Device-ID` yang sesuai. Jangan membagikan token atau `SERVICE_CLIENT_SECRET`. Endpoint sinkronisasi hanya untuk komunikasi antar-service. Proyek ini tidak menyediakan endpoint `/health` atau `/me`.

Contoh pengujian login melalui Thunder Client:

1. Kirim `POST http://127.0.0.1:3000/auth/login`.
2. Sertakan header `Content-Type: application/json` dan `X-Device-ID: mhs1-laptop`.
3. Kirim body berikut dengan password dari `SEED_MHS01_PASSWORD`:

```json
{
  "username": "mhs1",
  "password": "<password dari .env>"
}
```

4. Untuk request `GET http://127.0.0.1:3000/nilai`, isi header `Authorization` menggunakan access token dari response login. Tambahkan juga `X-Device-ID: mhs1-laptop`.

## 9. Alur autentikasi dan keamanan

1. Pengguna login menggunakan username, password, dan device ID yang terdaftar.
2. Server memverifikasi password dengan hash scrypt serta memeriksa status akun dan device.
3. Gateway menerbitkan access JWT dengan masa berlaku 10 menit dan refresh token acak dengan masa berlaku 24 jam. Sesi refresh terikat pada device penerbit.
4. Database menyimpan hash refresh token. Saat refresh berhasil, token dirotasi dalam sesi yang sama; logout mencabut sesi sehingga token akses dari sesi itu juga ditolak.
5. Untuk request pengguna, Gateway memeriksa token, sesi, device, role terbaru, dan policy. Hak baca nilai serta transkrip dibatasi berdasarkan identitas dan data di database.
6. Service Nilai memverifikasi ulang gateway secret dan JWT, lalu memeriksa kewenangan dosen, nilai, status final, serta jam akses untuk perubahan dan finalisasi.
7. Saat finalisasi, Service Nilai meminta service token lima menit melalui `/auth/service`, lalu meminta sinkronisasi melalui Gateway.
8. Gateway meneruskan secret komunikasi kepada Service Transkrip. Service memverifikasi secret dan token service sebelum menyalin nilai final ke transkrip dengan upsert. Sinkronisasi dapat diulang jika service belum tersedia; nilai yang sudah final tetap terkunci.
9. Gateway mencatat keputusan akses pada audit log tanpa mencatat body request atau header kredensial.

Jam edit dan finalisasi default berlaku dari pukul `07:00` hingga sebelum `21:00` WIB. Rentang tersebut dapat diubah melalui `ACCESS_START`, `ACCESS_END`, dan `ACCESS_TIMEZONE` di `.env`.

## 10. Pengujian

Jalankan tes otomatis dari folder proyek:

```powershell
npm.cmd test
```

Tes mencakup alur HTTP Gateway dan service, login/token/device, policy role dan kepemilikan data, pembatasan jam akses, edit/finalisasi nilai, sinkronisasi transkrip, refresh/logout, audit, serta setup. Tes memakai database sementara dan tidak mengubah database demo.

Perintah tambahan:

| Perintah | Kegunaan |
|---|---|
| `npm.cmd run db:seed` | Mengisi seed bila tabel pengguna masih kosong |
| `npm.cmd run db:inspect` | Melihat akun, device, kelas, nilai, dan transkrip |
| `npm.cmd run audit` | Melihat hingga 50 audit log terbaru |
| `npm.cmd run demo` | Menjalankan skenario request pada database aktif |

**Perhatian:** `npm.cmd run demo` dapat memfinalisasi kelas 1 apabila jam akses mengizinkan. Nilai kelas yang sudah final tidak bisa diedit. Gunakan database baru jika ingin mengulang demo dari data awal.
