export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function onRequestPost(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  let body = {};
  try {
    body = await context.request.json();
  } catch (e) {}

  const { token, wsfunction, params } = body || {};
  if (!token || !wsfunction) {
    return new Response(JSON.stringify({ error: 'Token dan wsfunction diperlukan' }), {
      status: 400,
      headers: corsHeaders,
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
    return new Response(text, { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
