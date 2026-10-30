module.exports = async function handler(req, res) {
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

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {}
  } else if (!body) {
    try {
      const buffers = [];
      for await (const chunk of req) buffers.push(chunk);
      body = JSON.parse(Buffer.concat(buffers).toString());
    } catch (e) {}
  }

  const { token, wsfunction, params } = body || {};
  if (!token || !wsfunction) {
    return res.status(400).json({ error: 'Token dan wsfunction diperlukan' });
  }

  const queryDict = {
    wstoken: token,
    wsfunction: wsfunction,
    moodlewsrestformat: 'json',
    ...(params || {})
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
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)',
        'Accept': 'application/json, text/plain, */*'
      }
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: `Gagal memanggil LMS Telkom: ${err.message}` });
  }
};
