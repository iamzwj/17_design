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
import time,hmac,hashlib,urllib.parse
root=Path('/home/ubuntu/17_design/data/films')
p=json.loads(files[0].read_text()) if False else json.loads(sorted(root.glob('*/project.json'),key=lambda f:f.stat().st_mtime,reverse=True)[0].read_text())
for t in reversed(p.get('tasks',[])):
 urls=t.get('requestBody',{}).get('images',[])
 if not urls:continue
 for url in urls[:1]:
  parts=urllib.parse.urlparse(url).path.split('/');pid,file=parts[-2:];exp=str(int(time.time())+1800);sig=hmac.new((root/'.link-key').read_text().encode(),f'{pid}/{file}/{exp}'.encode(),hashlib.sha256).hexdigest()
  print('LOCAL_REFERENCE_EXISTS',(root/pid/file).exists())
  for host in ['17design.fun','app.17design.fun']:
   fresh=f'https://{host}/api/film-assets/{pid}/{file}?expires={exp}&signature={sig}'
   try:
    with urllib.request.urlopen(fresh,timeout=15) as r:print('FRESH_REFERENCE',host,r.status,r.headers.get('Content-Type'),len(r.read()))
   except Exception as e:print('FRESH_ERROR',host,str(e))
 break
# Isolated real-provider smoke test with the saved request and fresh references.
body=dict(t['requestBody']);fresh_urls=[]
for url in body.get('images',[]):
 parts=urllib.parse.urlparse(url).path.split('/');pid,file=parts[-2:];exp=str(int(time.time())+1800);sig=hmac.new((root/'.link-key').read_text().encode(),f'{pid}/{file}/{exp}'.encode(),hashlib.sha256).hexdigest();fresh_urls.append(f'https://app.17design.fun/api/film-assets/{pid}/{file}?expires={exp}&signature={sig}')
body['images']=fresh_urls;body['replyType']='async'
base=cfg.get('GRSAI_BASE_URL','https://grsaiapi.com').rstrip('/')
def call(endpoint,body=None):
 req=urllib.request.Request(base+endpoint,data=json.dumps(body).encode() if body else None,headers={'Authorization':'Bearer '+cfg['GRSAI_API_KEY'],'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=180) as r:
  d=json.load(r);return d.get('data',d)
r=call('/v1/api/generate',body);print('LIVE_SUBMIT',r.get('id'),r.get('status'),flush=True)
if r.get('id'):
 for i in range(180):
  time.sleep(8)
  try:r=call('/v1/api/result?id='+r['id'])
  except Exception as e:print('LIVE_QUERY_ERROR',type(e).__name__,flush=True);continue
  print('LIVE_STATUS',r.get('id'),r.get('status'),r.get('error'),flush=True)
  if r.get('status') in ['succeeded','failed']:
   if r.get('results'):
    with urllib.request.urlopen(r['results'][0]['url'],timeout=30) as image:print('LIVE_IMAGE',image.status,image.headers.get('Content-Type'),len(image.read()),flush=True)
   break
