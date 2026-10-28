export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL iCal tidak boleh kosong' });
  }

  if (url.startsWith('webcal://')) {
    url = 'https://' + url.slice(9);
  }

  async function fetchRawIcs(targetUrl) {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'
      }
    });
    return response.text();
  }

  function parseIcsTasks(icsRaw) {
    if (icsRaw.includes('Invalid authentication') || icsRaw.toLowerCase().includes('<html')) {
      return { error: 'Invalid authentication atau token kalender kadaluarsa' };
    }

    const unfolded = icsRaw.replace(/\r?\n[ \t]/g, '');
    const lines = unfolded.split(/\r?\n/);
    const events = [];
    let curr = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line === 'BEGIN:VEVENT') {
        curr = {};
      } else if (line === 'END:VEVENT') {
        if (curr) events.push(curr);
        curr = null;
      } else if (curr && line.includes(':')) {
        const colonIdx = line.indexOf(':');
        const keyPart = line.substring(0, colonIdx);
        const val = line.substring(colonIdx + 1);
        const key = keyPart.split(';')[0].toUpperCase();
        curr[key] = val;
      }
    }

    const tasks = [];
    for (const ev of events) {
      const summary = ev.SUMMARY || 'Tugas';
      const cleanName = summary
        .replace(/\s+is due\b/gi, '')
        .replace(/\s+harus dikumpulkan\b/gi, '')
        .trim();

      const desc = (ev.DESCRIPTION || '').replace(/\\n/g, '\n').replace(/\\,/g, ',');
      const urlTask = ev.URL || '';
      const cat = ev.CATEGORIES || 'LMS Telkom';
      const uid = ev.UID || '';

      const dtStr = ev.DTEND || ev.DTSTART || '';
      let duedate = 0;
      if (dtStr) {
        const cleanDt = dtStr.replace('Z', '');
        if (cleanDt.length === 8) {
          const y = parseInt(cleanDt.slice(0, 4), 10);
          const m = parseInt(cleanDt.slice(4, 6), 10) - 1;
          const d = parseInt(cleanDt.slice(6, 8), 10);
          duedate = Math.floor(Date.UTC(y, m, d) / 1000);
        } else if (cleanDt.length >= 15) {
          const y = parseInt(cleanDt.slice(0, 4), 10);
          const m = parseInt(cleanDt.slice(4, 6), 10) - 1;
          const d = parseInt(cleanDt.slice(6, 8), 10);
          const hh = parseInt(cleanDt.slice(9, 11), 10);
          const mm = parseInt(cleanDt.slice(11, 13), 10);
          const ss = parseInt(cleanDt.slice(13, 15), 10);
          duedate = Math.floor(Date.UTC(y, m, d, hh, mm, ss) / 1000);
        }
      }

      const cmidMatch = urlTask.match(/id=(\d+)/);

      tasks.push({
        id: uid || String(Math.abs(hashString(cleanName))),
        cmid: cmidMatch ? cmidMatch[1] : '',
        name: cleanName,
        courseName: cat,
        intro: desc,
        url: urlTask,
        duedate,
        submissionStatus: 'nosubmission'
      });
    }

    tasks.sort((a, b) => {
      if (a.duedate === 0 && b.duedate === 0) return 0;
      if (a.duedate === 0) return 1;
      if (b.duedate === 0) return -1;
      return a.duedate - b.duedate;
    });

    return { tasks };
  }

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  try {
    const icsRaw = await fetchRawIcs(url);
    let { tasks, error } = parseIcsTasks(icsRaw);

    if (error) {
      return res.status(200).json({ success: false, error });
    }

    // Jika 0 tugas dan ada userid & authtoken, coba variasi Moodle
    if ((!tasks || tasks.length === 0) && url.includes('userid=') && url.includes('authtoken=')) {
      const uMatch = url.match(/userid=(\d+)/);
      const aMatch = url.match(/authtoken=([a-f0-9]+)/);
      if (uMatch && aMatch) {
        const uId = uMatch[1];
        const aTok = aMatch[1];
        const variants = [
          `https://lms.telkomuniversity.ac.id/calendar/export_execute.php?userid=${uId}&authtoken=${aTok}&preset_what=all&preset_time=custom`,
          `https://lms.telkomuniversity.ac.id/calendar/export_execute.php?userid=${uId}&authtoken=${aTok}&preset_what=courses&preset_time=custom`,
          `https://lms.telkomuniversity.ac.id/calendar/export_execute.php?userid=${uId}&authtoken=${aTok}&preset_what=all&preset_time=recentupcoming`,
          `https://lms.telkomuniversity.ac.id/calendar/export_execute.php?userid=${uId}&authtoken=${aTok}&preset_what=courses&preset_time=recentupcoming`
        ];

        for (const vUrl of variants) {
          if (vUrl === url) continue;
          try {
            const vRaw = await fetchRawIcs(vUrl);
            const vRes = parseIcsTasks(vRaw);
            if (vRes.tasks && vRes.tasks.length > 0) {
              tasks = vRes.tasks;
              break;
            }
          } catch (e) {
            // continue trying
          }
        }
      }
    }

    return res.status(200).json({ success: true, tasks: tasks || [], count: (tasks || []).length });
  } catch (err) {
    return res.status(500).json({ success: false, error: `Gagal membaca iCal: ${err.message}` });
  }
}
