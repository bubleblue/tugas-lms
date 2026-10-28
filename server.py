#!/usr/bin/env python3
import http.server
import socketserver
import urllib.request
import urllib.parse
import json
import os
import ssl

PORT = int(os.environ.get('PORT', 3000))
BASE_DIR = os.path.dirname(__file__) if os.path.exists(os.path.join(os.path.dirname(__file__), 'index.html')) else os.path.join(os.path.dirname(__file__), 'public')
LMS_BASE = 'https://lms.telkomuniversity.ac.id'

# SSL context that allows secure fetching to Tel-U LMS
ssl_context = ssl.create_default_context()

class AppHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        # Enable CORS for local network and mobile devices
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)

        try:
            payload = json.loads(body.decode('utf-8')) if body else {}
        except Exception:
            payload = {}

        if parsed.path == '/api/login':
            self.handle_login(payload)
        elif parsed.path == '/api/moodle':
            self.handle_moodle_proxy(payload)
        elif parsed.path == '/api/ical-url':
            self.handle_ical_url(payload)
        elif parsed.path == '/api/fetch-ical':
            self.handle_fetch_ical(payload)
        else:
            self.send_error(404, "Endpoint not found")

    def handle_login(self, payload):
        username = payload.get('username', '')
        password = payload.get('password', '')

        query = urllib.parse.urlencode({
            'username': username,
            'password': password,
            'service': 'moodle_mobile_app'
        })
        target_url = f"{LMS_BASE}/login/token.php?{query}"

        try:
            req = urllib.request.Request(target_url, headers={
                'User-Agent': 'MoodleMobile'
            })
            with urllib.request.urlopen(req, context=ssl_context, timeout=12) as response:
                res_data = response.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(res_data)
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            err_resp = json.dumps({"error": f"Gagal terhubung ke LMS: {str(e)}"})
            self.wfile.write(err_resp.encode('utf-8'))

    def handle_moodle_proxy(self, payload):
        token = payload.get('token', '')
        wsfunction = payload.get('wsfunction', '')
        params = payload.get('params', {})

        query_dict = {
            'wstoken': token,
            'wsfunction': wsfunction,
            'moodlewsrestformat': 'json'
        }
        query_dict.update(params)

        target_url = f"{LMS_BASE}/webservice/rest/server.php?{urllib.parse.urlencode(query_dict)}"

        try:
            req = urllib.request.Request(target_url, headers={
                'User-Agent': 'MoodleMobile'
            })
            with urllib.request.urlopen(req, context=ssl_context, timeout=15) as response:
                res_data = response.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(res_data)
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            err_resp = json.dumps({"error": f"Gagal memanggil LMS: {str(e)}"})
            self.wfile.write(err_resp.encode('utf-8'))

    def handle_ical_url(self, payload):
        """Get the iCal export URL for the logged-in user's calendar."""
        token = payload.get('token', '')
        userid = payload.get('userid', '')

        if not token or not userid:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'token dan userid diperlukan'}).encode())
            return

        # Get the calendar auth token via Moodle Web Service
        query_dict = {
            'wstoken': token,
            'wsfunction': 'core_calendar_get_calendar_export_token',
            'moodlewsrestformat': 'json'
        }
        ws_url = f"{LMS_BASE}/webservice/rest/server.php?{urllib.parse.urlencode(query_dict)}"

        try:
            req = urllib.request.Request(ws_url, headers={'User-Agent': 'MoodleMobile'})
            with urllib.request.urlopen(req, context=ssl_context, timeout=12) as res:
                data = json.loads(res.read().decode('utf-8'))

            if 'exception' in data or 'errorcode' in data:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': data.get('message', 'Tidak bisa mendapatkan calendar token'),
                    'fallback_url': f"{LMS_BASE}/calendar/export.php"
                }).encode())
                return

            authtoken = data.get('token', '')
            ical_base = f"{LMS_BASE}/calendar/export_execute.php"

            def make_params(what, time):
                return urllib.parse.urlencode({
                    'userid': userid,
                    'authtoken': authtoken,
                    'preset_what': what,
                    'preset_time': time
                })

            p_all      = make_params('all', 'recentupcoming')
            p_all_ever = make_params('all', 'custom') + '&time=0'
            p_courses  = make_params('courses', 'recentupcoming')

            webcal_base = 'webcal://lms.telkomuniversity.ac.id/calendar/export_execute.php'
            gcal_prefix = 'https://calendar.google.com/calendar/r?cid='

            result = {
                'authtoken': authtoken,
                'userid': userid,
                'urls': {
                    'semua_mendatang': f"{ical_base}?{p_all}",
                    'semua_sepanjang_waktu': f"{ical_base}?{p_all_ever}",
                    'hanya_kuliah': f"{ical_base}?{p_courses}",
                },
                'webcal_urls': {
                    'semua_mendatang': f"{webcal_base}?{p_all}",
                    'semua_sepanjang_waktu': f"{webcal_base}?{p_all_ever}",
                    'hanya_kuliah': f"{webcal_base}?{p_courses}",
                },
                'google_urls': {
                    'semua_mendatang': gcal_prefix + urllib.parse.quote(f"https://lms.telkomuniversity.ac.id/calendar/export_execute.php?{p_all}", safe=''),
                    'semua_sepanjang_waktu': gcal_prefix + urllib.parse.quote(f"https://lms.telkomuniversity.ac.id/calendar/export_execute.php?{p_all_ever}", safe=''),
                }
            }

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode('utf-8'))

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': f'Gagal mendapatkan iCal URL: {str(e)}'}).encode())

    def handle_fetch_ical(self, payload):
        """Fetch and parse iCal data from provided URL to bypass CORS and return task list."""
        import re
        from datetime import datetime, timezone

        url = re.sub(r'[\s\u200B-\u200D\uFEFF]', '', payload.get('url', '')).strip()
        if not url:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'URL iCal tidak boleh kosong'}).encode())
            return

        if url.startswith('webcal://'):
            url = 'https://' + url[9:]

        def fetch_ics_raw(target_url):
            print(f"[iCal] Mengunduh: {target_url}")
            req = urllib.request.Request(target_url, headers={
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'
            })
            with urllib.request.urlopen(req, context=ssl_context, timeout=15) as res:
                return res.read().decode('utf-8', errors='ignore')

        def parse_ics_tasks(ics_raw):
            if 'Invalid authentication' in ics_raw or '<html' in ics_raw.lower():
                return None, "Invalid authentication atau token kalender kadaluarsa."

            unfolded = re.sub(r'\r?\n[ \t]', '', ics_raw)
            events = []
            curr = None
            for line in unfolded.splitlines():
                line = line.strip()
                if not line:
                    continue
                if line == 'BEGIN:VEVENT':
                    curr = {}
                elif line == 'END:VEVENT':
                    if curr:
                        events.append(curr)
                    curr = None
                elif curr is not None and ':' in line:
                    kp, val = line.split(':', 1)
                    k = kp.split(';')[0].upper()
                    curr[k] = val

            tasks = []
            for ev in events:
                summary = ev.get('SUMMARY', 'Tugas')
                clean_name = re.sub(r'\s+is due\b', '', summary, flags=re.IGNORECASE)
                clean_name = re.sub(r'\s+harus dikumpulkan\b', '', clean_name, flags=re.IGNORECASE)

                desc = ev.get('DESCRIPTION', '').replace(r'\n', '\n').replace(r'\,', ',')
                url_task = ev.get('URL', '')
                cat = ev.get('CATEGORIES', 'LMS Telkom')
                uid = ev.get('UID', '')

                dt_str = ev.get('DTEND') or ev.get('DTSTART', '')
                duedate = 0
                if dt_str:
                    c_dt = dt_str.replace('Z', '')
                    try:
                        if len(c_dt) == 8:
                            dt = datetime.strptime(c_dt, '%Y%m%d').replace(tzinfo=timezone.utc)
                        elif len(c_dt) >= 15:
                            dt = datetime.strptime(c_dt[:15], '%Y%m%dT%H%M%S').replace(tzinfo=timezone.utc)
                        else:
                            dt = None
                        if dt:
                            duedate = int(dt.timestamp())
                    except Exception:
                        pass

                tasks.append({
                    'id': uid or str(abs(hash(clean_name))),
                    'cmid': re.search(r'id=(\d+)', url_task).group(1) if re.search(r'id=(\d+)', url_task) else '',
                    'name': clean_name,
                    'courseName': cat,
                    'intro': desc,
                    'url': url_task,
                    'duedate': duedate,
                    'submissionStatus': 'nosubmission'
                })

            tasks.sort(key=lambda t: (t['duedate'] == 0, t['duedate']))
            return tasks, None

        try:
            # 1. Coba unduh URL target awal
            ics_raw = fetch_ics_raw(url)
            tasks, err = parse_ics_tasks(ics_raw)

            if err:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': err}).encode('utf-8'))
                return

            print(f"[iCal] Hasil URL awal: {len(tasks)} tugas ditemukan.")

            # 2. Jika 0 tugas dan URL memiliki userid & authtoken, coba variasi Moodle lainnya secara otomatis
            if len(tasks) == 0 and 'userid=' in url and 'authtoken=' in url:
                uid_match = re.search(r'userid=(\d+)', url)
                tok_match = re.search(r'authtoken=([a-f0-9]+)', url)

                if uid_match and tok_match:
                    u_id = uid_match.group(1)
                    a_tok = tok_match.group(1)

                    variants = [
                        f"{LMS_BASE}/calendar/export_execute.php?userid={u_id}&authtoken={a_tok}&preset_what=all&preset_time=custom",
                        f"{LMS_BASE}/calendar/export_execute.php?userid={u_id}&authtoken={a_tok}&preset_what=courses&preset_time=custom",
                        f"{LMS_BASE}/calendar/export_execute.php?userid={u_id}&authtoken={a_tok}&preset_what=all&preset_time=recentupcoming",
                        f"{LMS_BASE}/calendar/export_execute.php?userid={u_id}&authtoken={a_tok}&preset_what=courses&preset_time=recentupcoming"
                    ]

                    for v_url in variants:
                        if v_url == url:
                            continue
                        try:
                            v_raw = fetch_ics_raw(v_url)
                            v_tasks, _ = parse_ics_tasks(v_raw)
                            print(f"[iCal] Variasi ({v_url.split('?')[-1]}): {len(v_tasks)} tugas.")
                            if v_tasks and len(v_tasks) > len(tasks):
                                tasks = v_tasks
                                break
                        except Exception as ve:
                            print(f"[iCal] Gagal variasi: {ve}")

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True, 'tasks': tasks, 'count': len(tasks)}).encode('utf-8'))

        except Exception as e:
            print(f"[iCal] Error: {e}")
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': False, 'error': f'Gagal membaca iCal: {str(e)}'}).encode('utf-8'))

class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == '__main__':
    server = ThreadingServer(('0.0.0.0', PORT), AppHandler)
    print(f"🚀 LMS Server running on http://0.0.0.0:{PORT}")
    server.serve_forever()
