from pathlib import Path
import json,urllib.request
cfg={}
for line in Path('/home/ubuntu/17_design/.env').read_text().splitlines():
 if '=' in line:
  k,v=line.split('=',1);cfg[k]=v.strip().strip(chr(34)).strip(chr(39))
for f in sorted(Path('/home/ubuntu/17_design/data/films').glob('*/project.json'),key=lambda f:f.stat().st_mtime,reverse=True)[:3]:
 p=json.loads(f.read_text());print('PROJECT',p['id'],p.get('status'),p.get('stage'),p.get('error'))
 for t in [t for t in p.get('tasks',[]) if t.get('kind') in ['image','frame']][-5:]:
  b=t.get('requestBody',{});print('TASK',json.dumps({k:t.get(k) for k in ['id','providerId','status','error','providerStatus']},ensure_ascii=False));print('INPUT',b.get('model'),b.get('aspectRatio'),b.get('quality'),'refs',len(b.get('images',[])))
  for url in b.get('images',[]):
   if not isinstance(url,str) or not url.startswith('https://'):continue
   try:
    with urllib.request.urlopen(url,timeout=10) as r:print('REFERENCE',url.split('/')[2],r.status,r.headers.get('Content-Type'),len(r.read()))
   except Exception as e:print('REFERENCE_ERROR',url.split('/')[2],type(e).__name__,str(e).split('?')[0])
  if t.get('providerId'):
   try:
    req=urllib.request.Request(cfg.get('GRSAI_BASE_URL','https://grsaiapi.com').rstrip('/')+'/v1/api/result?id='+t['providerId'],headers={'Authorization':'Bearer '+cfg['GRSAI_API_KEY']})
    with urllib.request.urlopen(req,timeout=20) as r:
     d=json.load(r);d=d.get('data',d);print('PROVIDER',json.dumps({k:d.get(k) for k in ['status','error','message']},ensure_ascii=False))
   except Exception as e:print('QUERY_ERROR',type(e).__name__)
