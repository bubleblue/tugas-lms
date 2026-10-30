const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // 2. API Endpoints
    if (url.pathname === '/api/login') {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS_HEADERS });
      }
      return handleLogin(request);
    }

    if (url.pathname === '/api/moodle') {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS_HEADERS });
      }
      return handleMoodle(request);
    }

    if (url.pathname === '/api/fetch-ical') {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: CORS_HEADERS,
        });
      }
      return handleFetchIcal(request);
    }

    // 3. Static Assets (index.html, style.css, app.js, dll)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};

async function handleFetchIcal(request) {
  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    body = {};
  }

  let targetUrl = body?.url;
  if (!targetUrl || typeof targetUrl !== 'string') {
    return new Response(JSON.stringify({ error: 'URL iCal tidak boleh kosong' }), {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  targetUrl = targetUrl.replace(/[\s\u200B-\u200D\uFEFF]/g, '').trim();
  if (targetUrl.startsWith('webcal://')) {
    targetUrl = 'https://' + targetUrl.slice(9);
  }

  async function fetchRawIcs(u) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(u, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
          'Accept': 'text/calendar,text/plain,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
          'Referer': 'https://lms.telkomuniversity.ac.id/',
          'Cache-Control': 'no-cache',
        },
        redirect: 'follow',
      });
      clearTimeout(timeout);
      const status = response.status;
      const text = await response.text();
      return { status, text };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  function parseIcsTasks(icsRaw, status = 200) {
    if (!icsRaw || typeof icsRaw !== 'string') {
      return { error: `Server LMS tidak merespon (HTTP ${status})` };
    }

    if (icsRaw.includes('Invalid authentication')) {
      return { error: 'LMS Telkom menolak token: Invalid authentication.' };
    }

    if (icsRaw.toLowerCase().includes('<html') || icsRaw.toLowerCase().includes('<!doctype html')) {
      const titleMatch = icsRaw.match(/<title[^>]*>([^<]+)<\/title>/i);
      const pageTitle = titleMatch ? titleMatch[1].trim() : 'Firewall Challenge';
      return {
        error: `Server LMS Telkom memblokir IP ini (${pageTitle}, HTTP ${status}).`,
      };
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
        submissionStatus: 'nosubmission',
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
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  try {
    const { status, text: icsRaw } = await fetchRawIcs(targetUrl);
    let { tasks, error } = parseIcsTasks(icsRaw, status);

    if (error) {
      return new Response(JSON.stringify({ success: false, error }), {
        status: 200,
        headers: CORS_HEADERS,
      });
    }

    // Variasi Moodle jika tugas kosong
    if ((!tasks || tasks.length === 0) && targetUrl.includes('userid=') && targetUrl.includes('authtoken=')) {
      const uMatch = targetUrl.match(/userid=(\d+)/);
      const aMatch = targetUrl.match(/authtoken=([a-f0-9]+)/);
      if (uMatch && aMatch) {
        const uId = uMatch[1];
        const aTok = aMatch[1];
        const variants = [
          `https://lms.telkomuniversity.ac.id/calendar/export_execute.php?userid=${uId}&authtoken=${aTok}&preset_what=all&preset_time=custom`,
          `https://lms.telkomuniversity.ac.id/calendar/export_execute.php?userid=${uId}&authtoken=${aTok}&preset_what=courses&preset_time=custom`,
          `https://lms.telkomuniversity.ac.id/calendar/export_execute.php?userid=${uId}&authtoken=${aTok}&preset_what=all&preset_time=recentupcoming`,
          `https://lms.telkomuniversity.ac.id/calendar/export_execute.php?userid=${uId}&authtoken=${aTok}&preset_what=courses&preset_time=recentupcoming`,
        ];

        for (const vUrl of variants) {
          if (vUrl === targetUrl) continue;
          try {
            const { status: vStatus, text: vRaw } = await fetchRawIcs(vUrl);
            const vRes = parseIcsTasks(vRaw, vStatus);
            if (vRes.tasks && vRes.tasks.length > 0) {
              tasks = vRes.tasks;
              break;
            }
          } catch (e) {}
        }
      }
    }

    return new Response(JSON.stringify({ success: true, tasks: tasks || [], count: (tasks || []).length }), {
      status: 200,
      headers: CORS_HEADERS,
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: `Gagal membaca iCal: ${err.message}` }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}

async function handleLogin(request) {
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const { username, password } = body || {};
  if (!username || !password) {
    return new Response(JSON.stringify({ error: 'Username dan password wajib diisi' }), {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  const query = new URLSearchParams({
    username: username.trim(),
    password: password.trim(),
    service: 'moodle_mobile_app',
  });

  const targetUrl = `https://lms.telkomuniversity.ac.id/login/token.php?${query.toString()}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)',
        'Accept': 'application/json, text/plain, */*',
      },
    });
    const text = await response.text();
    return new Response(text, { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
  }
}

async function handleMoodle(request) {
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const { token, wsfunction, params } = body || {};
  if (!token || !wsfunction) {
    return new Response(JSON.stringify({ error: 'Token dan wsfunction diperlukan' }), {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  const queryDict = {
    wstoken: token,
    wsfunction: wsfunction,
    moodlewsrestformat: 'json',
    ...(params || {}),
  };

  const queryParams = new URLSearchParams();
  for (const [key, val] of Object.entries(queryDict)) {
    if (typeof val === 'object' && val !== null) {
      for (const [subKey, subVal] of Object.entries(val)) {
        queryParams.append(`${key}[${subKey}]`, subVal);
      }
    } else {
      queryParams.append(key, val);
    }
  }

  const targetUrl = `https://lms.telkomuniversity.ac.id/webservice/rest/server.php?${queryParams.toString()}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)',
        'Accept': 'application/json, text/plain, */*',
      },
    });
    const text = await response.text();
    return new Response(text, { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
  }
}
