# 📋 Tugas LMS — Telkom University

Website mobile bergaya iOS untuk melihat daftar tugas yang belum dikerjakan di LMS Telkom University. Otomatis terhubung ke LMS tanpa perlu memasukkan tugas secara manual.

## ✨ Fitur

- 🔐 **Login SSO** — Masuk dengan akun SSO Telkom University
- 🔑 **Login Token** — Atau gunakan Moodle Web Service Token
- 📋 **Auto-fetch tugas** — Otomatis mengambil semua tugas yang belum dikerjakan
- 🔥 **Prioritas visual** — Warna mendesak (merah/oranye) vs aman (hijau)
- 📅 **Filter** — Terlambat, Mendesak, Minggu Ini, Tanpa Deadline
- 📱 **iOS-style UI** — Dark mode, animasi halus, bottom sheet modal
- 🔗 **Link langsung** — Buka tugas langsung di LMS

## 🚀 Cara Menjalankan

```bash
cd lms-tugas/public
python3 -m http.server 3000
```

Lalu buka: **http://localhost:3000**

## 📱 Cara Pakai

1. Buka website di browser HP/laptop
2. Login dengan **username & password SSO** Telkom University
3. Website akan otomatis mengambil semua tugas dari LMS
4. Lihat tugas yang belum dikerjakan, diurutkan berdasarkan deadline
5. Tap kartu tugas untuk melihat detail & buka di LMS

## ⚠️ Catatan Penting

- **CORS**: Jika login SSO tidak bisa karena CORS, gunakan mode **"Pakai Token"**
- **Token**: Bisa didapat dari Moodle Mobile app atau admin LMS
- **Keamanan**: Token hanya disimpan di browser lokal (localStorage), tidak dikirim ke server manapun
- Website ini **tidak menyimpan password** — hanya mengirimnya langsung ke server LMS Telkom

## 🏗️ Teknologi

- HTML5 + CSS3 + Vanilla JavaScript
- Moodle Web Service REST API
- Zero dependencies — tidak butuh Node.js atau framework apapun
# paw-tugas-lms
# paw-tugas-lms
