from pathlib import Path
from datetime import datetime
path=Path('/opt/viraeflow-demo/web/Caddyfile')
s=path.read_text()
route='  handle_path /_rate-monitor/* {\n    reverse_proxy rate-monitor-relay:8788\n  }\n'
if route not in s:
 backup=Path('/opt/rate-monitor/Caddyfile.before-'+datetime.now().strftime('%Y%m%d%H%M%S'))
 backup.write_text(s)
 assert s.startswith('c.dark20.xyz {\n')
 path.write_text(s.replace('c.dark20.xyz {\n','c.dark20.xyz {\n'+route,1))
 # On future container recreation, use the persisted Caddyfile. Existing routes are preserved.
 override=Path('/opt/viraeflow-demo/compose.override.yml')
 if not override.exists():
  override.write_text('services:\n  web:\n    volumes:\n      - ./web/Caddyfile:/etc/caddy/Caddyfile:ro\n')
