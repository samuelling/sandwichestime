#!/usr/bin/env python3
"""Run the scripted autopilot participant headlessly and save its session log(s).

Needs: pip install playwright && playwright install chromium   (or pass --chrome PATH)
Serve the repo first:  python3 -m http.server 8811

    python3 tools/run_autopilot.py --seeds 1 2 3 --layout counter --out examples/
"""
import argparse, asyncio, json, os, time
from playwright.async_api import async_playwright

async def run(url, out, chrome, timeout):
    async with async_playwright() as p:
        kw = dict(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        if chrome: kw['executable_path'] = chrome
        b = await p.chromium.launch(**kw)
        pg = await b.new_page(viewport={'width': 960, 'height': 560})
        await pg.goto(url)
        t0 = time.time()
        while time.time() - t0 < timeout:
            await asyncio.sleep(2)
            if await pg.evaluate('!!window.__done'): break
        data = await pg.evaluate('window.__log ? JSON.stringify(window.__log.toJSON()) : null')
        errs = await pg.evaluate('window.__errors || null')
        await b.close()
    if errs: print('page errors:', errs[:2])
    if not data: raise SystemExit(f'no log produced for {url}')
    d = json.loads(data)
    m = d['meta']
    fn = os.path.join(out, f"autopilot_{m['layout']}_{m['condition']}_seed{m['seed']}.json")
    with open(fn, 'w') as f: json.dump(d, f, separators=(',', ':'))
    print(f"{fn}: {d['summary']['duration']:.1f}s, complete={d['summary']['completed']}, events={len(d['events'])}, frames={len(d['frames']['t'])}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://localhost:8811/index.html')
    ap.add_argument('--seeds', type=int, nargs='+', default=[1])
    ap.add_argument('--layout', default='counter'); ap.add_argument('--condition', default='standard')
    ap.add_argument('--distractors', default='full'); ap.add_argument('--out', default='examples')
    ap.add_argument('--chrome', default=None); ap.add_argument('--timeout', type=float, default=900)
    ap.add_argument('--fast', type=int, default=40)
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    for s in a.seeds:
        url = (f"{a.base}?auto=1&input=autopilot&gaze=autopilot&quality=0&saliency=1&noreport=1&fast={a.fast}"
               f"&seed={s}&layout={a.layout}&condition={a.condition}&distractors={a.distractors}&participant=autopilot")
        asyncio.run(run(url, a.out, a.chrome, a.timeout))

if __name__ == '__main__':
    main()
