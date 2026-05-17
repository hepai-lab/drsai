export default {
  title: "Alat",
  subtitle:
    "Aktifkan atau nonaktifkan toolset yang dapat digunakan agent selama percakapan",
  web: {
    label: "Pencarian Web",
    description: "Cari di web dan ekstrak konten dari URL",
  },
  browser: {
    label: "Browser",
    description: "Jelajahi, klik, ketik, dan berinteraksi dengan halaman web",
  },
  terminal: {
    label: "Terminal",
    description: "Jalankan perintah dan skrip shell",
  },
  file: {
    label: "Operasi File",
    description: "Baca, tulis, cari, dan kelola file",
  },
  code_execution: {
    label: "Eksekusi Kode",
    description: "Jalankan kode Python dan shell secara langsung",
  },
  vision: { label: "Vision", description: "Analisis gambar dan konten visual" },
  image_gen: {
    label: "Pembuatan Gambar",
    description: "Buat gambar dengan DALL-E dan model lainnya",
  },
  tts: {
    label: "Text-to-Speech",
    description: "Ubah teks menjadi audio suara",
  },
  skills: {
    label: "Skill",
    description: "Buat, kelola, dan jalankan skill yang dapat digunakan ulang",
  },
  memory: {
    label: "Memori",
    description: "Simpan dan panggil kembali pengetahuan persisten",
  },
  session_search: {
    label: "Pencarian Sesi",
    description: "Cari di seluruh percakapan sebelumnya",
  },
  clarify: {
    label: "Pertanyaan Klarifikasi",
    description: "Minta klarifikasi dari pengguna saat diperlukan",
  },
  delegation: {
    label: "Delegasi",
    description: "Buat sub-agent untuk tugas paralel",
  },
  cronjob: {
    label: "Cron Job",
    description: "Buat dan kelola tugas terjadwal",
  },
  moa: {
    label: "Mixture of Agents",
    description: "Koordinasikan beberapa model AI bersama-sama",
  },
  todo: {
    label: "Perencanaan Tugas",
    description: "Buat dan kelola daftar tugas untuk pekerjaan kompleks",
  },
  mcpServers: "Server MCP",
  mcpDescription:
    "Server Model Context Protocol yang dikonfigurasi di config.yaml. Kelola melalui <code>hermes mcp add/remove</code> di terminal.",
  http: "HTTP",
  stdio: "stdio",
  disabled: "nonaktif",
} as const;
