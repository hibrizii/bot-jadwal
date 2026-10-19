import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import cron from 'node-cron';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// State Global Bot
let sock = null;
let isConnected = false;
let userPhone = '';
let currentQRDataURL = null;
const botLogs = [];

function addLog(msg) {
  const time = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
  const logStr = `[${time} WIB] ${msg}`;
  console.log(logStr);
  botLogs.unshift(logStr);
  if (botLogs.length > 80) botLogs.pop();
}

// Helper membaca & menulis JSON
function readJSON(file) {
  try {
    const raw = fs.readFileSync(path.join(__dirname, file), 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(path.join(__dirname, file), JSON.stringify(data, null, 2), 'utf-8');
}

// Helper waktu Jakarta (WIB)
function getJakartaDay() {
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const jkt = new Date(utc + (3600000 * 7));
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return {
    name: days[jkt.getDay()],
    date: jkt
  };
}

// Pembuat Mention WhatsApp Aktif (Biru & Berdering di HP guru)
function formatGuruMention(guruList, kontakMap, mentionsArr) {
  if (!guruList || guruList.length === 0) return "-";
  
  const formatted = [];
  for (const guru of guruList) {
    const cleanG = guru.trim();
    if (!cleanG || cleanG === "Kosong") continue;

    let phone = "";
    if (kontakMap[cleanG]) {
      phone = kontakMap[cleanG];
    } else {
      const lowG = cleanG.toLowerCase();
      for (const k in kontakMap) {
        if (lowG.includes(k.toLowerCase()) || k.toLowerCase().includes(lowG)) {
          phone = kontakMap[k];
          break;
        }
      }
    }

    if (phone) {
      phone = phone.replace(/[^0-9]/g, '');
      if (phone.startsWith('08')) phone = '62' + phone.substring(1);
      else if (phone.startsWith('8')) phone = '62' + phone;

      if (phone.length >= 9) {
        const jid = `${phone}@s.whatsapp.net`;
        if (!mentionsArr.includes(jid)) {
          mentionsArr.push(jid);
        }
        formatted.push(`@${phone} (${cleanG})`);
        continue;
      }
    }

    formatted.push(`@${cleanG}`);
  }

  return formatted.length > 0 ? formatted.join(" / ") : "-";
}

// 1. Format Pesan Piket (Teacher on Duty)
function buildPiketMessage(jadwalData, kontakMap) {
  const { name: dayName } = getJakartaDay();
  const daySched = jadwalData.schedule[dayName];
  if (!daySched || !daySched.piket) return null;

  const mentions = [];
  const p = daySched.piket;

  const lt1_s1 = formatGuruMention((p['1']?.lt1 || '-').split('/'), kontakMap, mentions);
  const lt4_s1 = formatGuruMention((p['1']?.lt4 || '-').split('/'), kontakMap, mentions);

  const lt1_s2 = formatGuruMention((p['2']?.lt1 || '-').split('/'), kontakMap, mentions);
  const lt4_s2 = formatGuruMention((p['2']?.lt4 || '-').split('/'), kontakMap, mentions);

  const lt1_s3 = formatGuruMention((p['3']?.lt1 || '-').split('/'), kontakMap, mentions);
  const lt4_s3 = formatGuruMention((p['3']?.lt4 || '-').split('/'), kontakMap, mentions);

  const lt1_s4 = formatGuruMention((p['4']?.lt1 || '-').split('/'), kontakMap, mentions);
  const lt4_s4 = formatGuruMention((p['4']?.lt4 || '-').split('/'), kontakMap, mentions);

  const text = `Bismillah..\n\n` +
               `Teacher on duty for today:\n\n` +
               `*Sesi I (07.00 - 09.00 WIB)*\n` +
               `Lt. 1: ${lt1_s1}\n` +
               `Lt. 4: ${lt4_s1}\n\n` +
               `*Sesi II (09.00 - 10.45 WIB)*\n` +
               `Lt. 1: ${lt1_s2}\n` +
               `Lt. 4: ${lt4_s2}\n\n` +
               `*Sesi III (10.45 - 13.30 WIB)*\n` +
               `Lt. 1: ${lt1_s3}\n` +
               `Lt. 4: ${lt4_s3}\n\n` +
               `*Sesi IV (13.30 - 15.00 WIB)*\n` +
               `Lt. 1: ${lt1_s4}\n` +
               `Lt. 4: ${lt4_s4}\n\n` +
               `Syukron🙏`;

  return { text, mentions };
}

// 2. Format Pesan Jam Pelajaran
function buildJamMessage(targetJam, jadwalData, kontakMap) {
  const { name: dayName, date } = getJakartaDay();
  const daySched = jadwalData.schedule[dayName];
  if (!daySched || !daySched.periods) return null;

  const periodsList = daySched.periods[String(targetJam)] || [];
  const mentions = [];

  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const n = date.getDate();
  const s = ["th", "st", "nd", "rd"]; const v = n % 100;
  const ordinalDate = n + (s[(v - 20) % 10] || s[v] || s[0]);
  const dateStr = days[date.getDay()] + ", " + months[date.getMonth()] + " " + ordinalDate + " " + date.getFullYear();

  const vJ = targetJam % 100;
  const ordJam = targetJam + (s[(vJ - 20) % 10] || s[vJ] || s[0]);
  const pInfo = jadwalData.periodTimes[String(targetJam)] ? jadwalData.periodTimes[String(targetJam)].label : "";

  let text = `[Announcement]\n` +
             `${dateStr}\n` +
             `Bismillah.\n` +
             `For Ustadz having a schedule at ${ordJam} period at ${pInfo} WIB, please prepare yourself to come to your class\n\n`;

  const icons = ['🩺', '💵', '🔭', '🧬', '📚', '🎯', '🚀'];
  const kelasOrder = ["10 I", "10 J", "11 STEAM", "11 BUSSLAW", "12 STEAM", "12 BUSSLAW", "12 IGPA"];

  const classMap = {};
  for (const item of periodsList) {
    classMap[item.class] = item;
  }

  for (let k = 0; k < kelasOrder.length; k++) {
    const kls = kelasOrder[k];
    if (classMap[kls]) {
      const gStr = formatGuruMention(classMap[kls].teachers, kontakMap, mentions);
      text += `${icons[k % icons.length]} ${kls} : ${classMap[kls].subject} - ${gStr}\n\n`;
    }
  }

  // Tambahkan info piket jam tersebut
  const sesi = ([1, 2].includes(targetJam)) ? '1' : (([3, 4].includes(targetJam)) ? '2' : (([5, 6].includes(targetJam)) ? '3' : '4'));
  const piketInfo = daySched.piket ? daySched.piket[sesi] : null;
  if (piketInfo) {
    if (piketInfo.lt1 && piketInfo.lt1 !== '-') {
      const gPiket1 = formatGuruMention((piketInfo.lt1 || '').split('/'), kontakMap, mentions);
      text += `📋 Piket Lt. 1 : ${gPiket1}\n`;
    }
    if (piketInfo.lt4 && piketInfo.lt4 !== '-') {
      const gPiket4 = formatGuruMention((piketInfo.lt4 || '').split('/'), kontakMap, mentions);
      text += `📋 Piket Lt. 4 : ${gPiket4}\n`;
    }
  }

  return { text, mentions };
}

// Helper pengirim pesan dengan mention
async function broadcast(targetGroup, payload) {
  if (!payload || !payload.text) return { success: false, error: 'Pesan kosong' };
  if (!sock || !isConnected) {
    const err = 'Bot WhatsApp belum terhubung!';
    addLog(`[ERROR] ${err}`);
    return { success: false, error: err };
  }
  try {
    await sock.sendMessage(targetGroup, {
      text: payload.text,
      mentions: payload.mentions || []
    });
    const logMsg = `[SUKSES] Pesan terkirim ke ${targetGroup} (${payload.mentions.length} mention biru).`;
    addLog(logMsg);
    return { success: true, mentions: payload.mentions.length };
  } catch (e) {
    const logErr = `[ERROR] Gagal kirim ke ${targetGroup}: ${e.message}`;
    addLog(logErr);
    return { success: false, error: e.message };
  }
}

// MAIN FUNCTION BOT BAILEYS
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  addLog(`Memulai Baileys v${version.join('.')}...`);

  const config = readJSON('config.json') || {};
  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: ['Ubuntu', 'Chrome', '20.0.04']
  });

  sock.ev.on('creds.update', saveCreds);

  let qrNotified = false;
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (!qrNotified) {
        addLog("QR Code siap di web dashboard: http://localhost:3000");
        qrNotified = true;
      }
      try {
        currentQRDataURL = await QRCode.toDataURL(qr, { margin: 2, scale: 7 });
      } catch (err) {
        console.error("Gagal buat QR data URL:", err);
      }
    }

    if (connection === 'close') {
      isConnected = false;
      userPhone = '';
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      addLog(`Koneksi WA terputus. Reconnect: ${shouldReconnect}`);
      if (shouldReconnect) {
        startBot();
      } else {
        addLog("WhatsApp Logout. Hapus folder ./session jika ingin menghubungkan ulang.");
      }
    } else if (connection === 'open') {
      isConnected = true;
      currentQRDataURL = null;
      userPhone = sock.user?.id ? sock.user.id.split(':')[0] : 'Aktif';
      addLog(`[SUKSES] BOT BERHASIL TERHUBUNG KE WHATSAPP! Akun: ${userPhone}`);
    }
  });

  // Handler pesan chat perintah WhatsApp
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    const cleanCmd = body.trim().toLowerCase();

    const currentCfg = readJSON('config.json') || {};
    const jadwal = readJSON('jadwal.json');
    const kontak = readJSON('kontak.json') || {};

    // 1. !piket
    if (cleanCmd === '!piket') {
      const payload = buildPiketMessage(jadwal, kontak);
      if (payload) await broadcast(from, payload);
    }
    // 2. !jam
    else if (cleanCmd.startsWith('!jam') || cleanCmd.startsWith('!jadwal')) {
      const parts = cleanCmd.split(' ');
      let targetJ = 1;
      if (parts.length > 1 && parseInt(parts[1])) {
        targetJ = parseInt(parts[1]);
      } else {
        const { date: jkt } = getJakartaDay();
        const m = jkt.getHours() * 60 + jkt.getMinutes();
        if (m < 480) targetJ = 1;
        else if (m < 525) targetJ = 2;
        else if (m < 600) targetJ = 3;
        else if (m < 645) targetJ = 4;
        else if (m < 690) targetJ = 5;
        else if (m < 810) targetJ = 6;
        else if (m < 855) targetJ = 7;
        else targetJ = 8;
      }
      const payload = buildJamMessage(targetJ, jadwal, kontak);
      if (payload) await broadcast(from, payload);
    }
    // 3. !setgroup
    else if (cleanCmd === '!setgroup') {
      if (from.endsWith('@g.us')) {
        currentCfg.targetGroupId = from;
        writeJSON('config.json', currentCfg);
        await sock.sendMessage(from, { text: `✔️ Grup ini berhasil diatur sebagai target kirim otomatis bot!\nID Grup: ${from}` });
      } else {
        await sock.sendMessage(from, { text: `⚠️ Perintah ini harus dijalankan di dalam grup WhatsApp yang dituju.` });
      }
    }
    // 4. !help
    else if (cleanCmd === '!help' || cleanCmd === '!menu') {
      const helpText = `🤖 *BOT JADWAL & PIKET SMA AL-MAAHIRA*\n\n` +
                       `Perintah yang bisa Anda gunakan:\n` +
                       `• *!piket* : Kirim rekap ustadz piket hari ini (tag aktif)\n` +
                       `• *!jam* : Kirim jadwal jam pelajaran aktif saat ini\n` +
                       `• *!jam 1* s.d. *!jam 8* : Kirim jadwal jam tertentu\n` +
                       `• *!setgroup* : Jadikan grup saat ini sebagai target broadcast otomatis\n` +
                       `• *!help* : Buka panduan ini`;
      await sock.sendMessage(from, { text: helpText });
    }
  });
}

// SCHEDULER OTOMATIS (CRON 24 JAM)
// 1. Briefing Pagi (06.30 WIB - Senin s.d. Sabtu)
cron.schedule('30 6 * * 1-6', async () => {
  const currentCfg = readJSON('config.json');
  if (!currentCfg || !currentCfg.autoPiket || !currentCfg.targetGroupId) return;

  addLog('[CRON 06:30] Mengirim Briefing Piket Otomatis...');
  const jadwal = readJSON('jadwal.json');
  const kontak = readJSON('kontak.json') || {};
  const payload = buildPiketMessage(jadwal, kontak);
  if (payload) await broadcast(currentCfg.targetGroupId, payload);
}, { timezone: "Asia/Jakarta" });

// 2. Pengingat Jam Pelajaran (10 Menit Sebelum Bel)
const bellCronList = [
  { jam: 1, cronTime: '5 7 * * 1-6' },   // 07.05 WIB (masuk 07.15)
  { jam: 2, cronTime: '50 7 * * 1-6' },  // 07.50 WIB (masuk 08.00)
  { jam: 3, cronTime: '5 9 * * 1-6' },   // 09.05 WIB (masuk 09.15)
  { jam: 4, cronTime: '50 9 * * 1-6' },  // 09.50 WIB (masuk 10.00)
  { jam: 5, cronTime: '35 10 * * 1-6' }, // 10.35 WIB (masuk 10.45)
  { jam: 6, cronTime: '35 12 * * 1-6' }, // 12.35 WIB (masuk 12.45)
  { jam: 7, cronTime: '20 13 * * 1-6' }, // 13.20 WIB (masuk 13.30)
  { jam: 8, cronTime: '5 14 * * 1-6' }   // 14.05 WIB (masuk 14.15)
];

for (const b of bellCronList) {
  cron.schedule(b.cronTime, async () => {
    const currentCfg = readJSON('config.json');
    if (!currentCfg || !currentCfg.autoMengajar || !currentCfg.targetGroupId) return;

    addLog(`[CRON] Mengirim Pengingat Jam ${b.jam} Otomatis...`);
    const jadwal = readJSON('jadwal.json');
    const kontak = readJSON('kontak.json') || {};
    const payload = buildJamMessage(b.jam, jadwal, kontak);
    if (payload) await broadcast(currentCfg.targetGroupId, payload);
  }, { timezone: "Asia/Jakarta" });
}

// --- EXPRESS HTTP SERVER (WEB CONTROLLER & HEALTH CHECK) ---
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Status
app.get('/api/status', (req, res) => {
  const cfg = readJSON('config.json') || {};
  res.json({
    connected: isConnected,
    user: userPhone,
    qr: currentQRDataURL,
    config: cfg,
    logs: botLogs
  });
});

// API Jadwal Hari Ini (Format Lengkap Kelas & Guru)
app.get('/api/jadwal/today', (req, res) => {
  const { name: dayName, date } = getJakartaDay();
  const jadwal = readJSON('jadwal.json');
  const daySched = (jadwal && jadwal.schedule) ? jadwal.schedule[dayName] : null;
  const flatData = [];
  const teachersSet = new Set();

  if (daySched) {
    // 1. Pelajaran Kelas
    for (const [jamStr, list] of Object.entries(daySched.periods || {})) {
      const jam = parseInt(jamStr);
      for (const item of list) {
        const guruStr = (item.teachers || []).join(' / ');
        flatData.push({
          jam,
          kelas: item.class,
          mapel: item.subject,
          guru: guruStr
        });
        (item.teachers || []).forEach(t => {
          if (t && t !== "Kosong") teachersSet.add(t.trim());
        });
      }
    }

    // 2. Piket Lantai 1 & Lantai 4
    for (const [sesiStr, p] of Object.entries(daySched.piket || {})) {
      const jamList = sesiStr === '1' ? [1, 2] : (sesiStr === '2' ? [3, 4] : (sesiStr === '3' ? [5, 6] : [7, 8]));
      for (const j of jamList) {
        if (p.lt1) {
          flatData.push({ jam: j, kelas: "Piket Lt. 1", mapel: "Piket", guru: p.lt1 });
          p.lt1.split('/').forEach(t => { if (t.trim() && t.trim() !== "Kosong") teachersSet.add(t.trim()); });
        }
        if (p.lt4) {
          flatData.push({ jam: j, kelas: "Piket Lt. 4", mapel: "Piket", guru: p.lt4 });
          p.lt4.split('/').forEach(t => { if (t.trim() && t.trim() !== "Kosong") teachersSet.add(t.trim()); });
        }
      }
    }
  }

  // Tambahkan juga semua guru dari kontak.json
  const kontak = readJSON('kontak.json') || {};
  Object.keys(kontak).forEach(k => {
    if (k && k.trim()) teachersSet.add(k.trim());
  });

  const sortedTeachers = Array.from(teachersSet).sort();

  res.json({
    success: true,
    day: dayName,
    date: date,
    data: flatData,
    teachers: sortedTeachers,
    periodTimes: jadwal ? jadwal.periodTimes : {}
  });
});

// API Daftar Grup WhatsApp
app.get('/api/groups', async (req, res) => {
  const presetGroups = [
    { id: "120363421823108391@g.us", name: "SMA AL-MAAHIRA PUTRA IIBS MALANG" },
    { id: "120363403598196152@g.us", name: "PIONIR SMA PUTRA" },
    { id: "120363422731477590@g.us", name: "Attendance SMA PUTRA" },
    { id: "120363407336484707@g.us", name: "Konsinyasi Al-Maahira Putra" }
  ];

  if (!sock || !isConnected) {
    return res.json({ success: true, groups: presetGroups, fromWhatsApp: false });
  }

  try {
    const participating = await sock.groupFetchAllParticipating();
    const fetched = Object.values(participating).map(g => ({
      id: g.id,
      name: g.subject
    }));

    const existingIds = new Set(fetched.map(g => g.id));
    for (const p of presetGroups) {
      if (!existingIds.has(p.id)) {
        fetched.push(p);
      }
    }

    fetched.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ success: true, groups: fetched, fromWhatsApp: true });
  } catch (err) {
    console.error("Gagal ambil grup:", err);
    res.json({ success: true, groups: presetGroups, error: err.message });
  }
});

// API Kontak Guru
app.get('/api/kontak', (req, res) => {
  const kontak = readJSON('kontak.json') || {};
  res.json(kontak);
});

app.post('/api/kontak', (req, res) => {
  try {
    const newKontak = req.body || {};
    writeJSON('kontak.json', newKontak);
    addLog(`Daftar nomor kontak ustadz berhasil diperbarui (${Object.keys(newKontak).length} guru).`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API Config
app.post('/api/config', (req, res) => {
  try {
    const currentCfg = readJSON('config.json') || {};
    const updated = { ...currentCfg, ...req.body };
    writeJSON('config.json', updated);
    addLog(`Pengaturan bot diperbarui.`);
    res.json({ success: true, config: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API Trigger Manual Broadcast
app.post('/api/trigger', async (req, res) => {
  const { type, jam, targetGroupId: customGroup } = req.body;
  const cfg = readJSON('config.json') || {};
  const targetGroup = customGroup || cfg.targetGroupId || "120363421823108391@g.us";
  const jadwal = readJSON('jadwal.json');
  const kontak = readJSON('kontak.json') || {};

  if (type === 'piket') {
    const payload = buildPiketMessage(jadwal, kontak);
    if (!payload) return res.status(400).json({ success: false, error: "Jadwal piket tidak ditemukan hari ini." });
    const result = await broadcast(targetGroup, payload);
    return res.json(result);
  }

  if (type === 'jam') {
    let targetJ = parseInt(jam) || 1;
    if (jam === 'current') {
      const { date: jkt } = getJakartaDay();
      const m = jkt.getHours() * 60 + jkt.getMinutes();
      if (m < 480) targetJ = 1;
      else if (m < 525) targetJ = 2;
      else if (m < 600) targetJ = 3;
      else if (m < 645) targetJ = 4;
      else if (m < 690) targetJ = 5;
      else if (m < 810) targetJ = 6;
      else if (m < 855) targetJ = 7;
      else targetJ = 8;
    }
    const payload = buildJamMessage(targetJ, jadwal, kontak);
    if (!payload) return res.status(400).json({ success: false, error: `Jadwal jam ${targetJ} tidak ditemukan.` });
    const result = await broadcast(targetGroup, payload);
    return res.json(result);
  }

  res.status(400).json({ success: false, error: "Tipe trigger tidak dikenal." });
});

// Jalankan Web Server & Bot
app.listen(PORT, () => {
  addLog(`Web Dashboard Controller berjalan di: http://localhost:${PORT}`);
  startBot();

  // Auto Keep-Alive Self-Ping (Mencegah server sleep di Render / cloud gratis)
  const appUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
  if (appUrl) {
    setInterval(async () => {
      try {
        await fetch(`${appUrl}/api/status`);
      } catch (e) {}
    }, 10 * 60 * 1000);
  }
});
