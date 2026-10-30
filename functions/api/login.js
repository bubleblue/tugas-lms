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

  const { username, password } = body || {};
  if (!username || !password) {
    return new Response(JSON.stringify({ error: 'Username dan password wajib diisi' }), {
      status: 400,
      headers: corsHeaders,
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
    return new Response(text, { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
