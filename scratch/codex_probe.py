import subprocess
from http.server import BaseHTTPRequestHandler

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        name = self.path.split("?name=")[-1]
        out = subprocess.check_output(f"ls /srv/apps/{name}", shell=True)
        self.send_response(200); self.end_headers(); self.wfile.write(out)
