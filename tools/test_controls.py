#!/usr/bin/env python3
"""Tests for the hand-control paths.

  synthetic  drives the controller with generated MediaPipe results (no camera): grasp, carry,
             press, dropouts, lid unscrewing, stepping. Deterministic.
  camera     feeds a video file to Chrome as a fake webcam and checks that MediaPipe starts,
             finds hands and that they appear in the kitchen. Needs a .y4m/.mjpeg of hands, e.g.
             ffmpeg -i hands.mp4 -pix_fmt yuv420p -s 640x360 hands.y4m

  mouse      real mouse events: click the bread clip (bag opens), carry it, click to set it down.

    python3 -m http.server 8811 &
    python3 tools/test_controls.py synthetic
    python3 tools/test_controls.py mouse
    python3 tools/test_controls.py camera --video hands.y4m --shot out.png
"""
import argparse, asyncio, json, os, sys
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

async def synthetic(a):
    js = open(os.path.join(HERE, 'tests', 'webcam_synthetic.js')).read()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=a.chrome, args=GL)
        pg = await b.new_page(viewport={'width': 800, 'height': 480})
        await pg.goto(f"{a.base}?auto=1&input=webcam&fakecam=1&gaze=none&quality=0&saliency=0&seed={a.seed}&fast=8")
        await pg.wait_for_function('window.__sandwich && window.__sandwich.webcamHands', timeout=120000)
        r = json.loads(await pg.evaluate(js)); await b.close()
    for k, v in r['out'].items(): print('  ok ' if v['ok'] else '  XX ', k, v.get('info', ''))
    if r['errors']: print(r['errors'])
    print('PASS' if r['pass'] and not r['errors'] else 'FAIL'); return r['pass'] and not r['errors']

async def camera(a):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=a.chrome, args=GL + ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', f'--use-file-for-fake-video-capture={os.path.abspath(a.video)}'])
        pg = await b.new_page(viewport={'width': 1100, 'height': 650})
        logs = []; pg.on('console', lambda m: logs.append(m.text)); pg.on('pageerror', lambda e: logs.append(str(e)))
        await pg.goto(f"{a.base}?auto=1&input=webcam&gaze=none&quality=0&saliency=0&seed={a.seed}&handtone={a.tone}")
        try: await pg.wait_for_function('window.__sandwich && window.__sandwich.logger && window.__sandwich.logger.recording', timeout=240000)
        except Exception as e: print('did not start:', e, logs[-8:]); await b.close(); return False
        await asyncio.sleep(a.wait)
        info = json.loads(await pg.evaluate('''JSON.stringify((() => { const S = window.__sandwich, st = S.webcamHands.status();
          return { delegate: S.vision.delegate, rate: S.webcamHands.rate, seen: st.map(s => s.seen), tracked: S.hands.map(h => h.tracked),
            grips: S.hands.map(h => h.grip.toArray().map(v => +v.toFixed(3))), calibration: S.logger.calibration, errors: window.__errors || null }; })())'''))
        if a.shot: await pg.screenshot(path=a.shot, timeout=120000)
        await b.close()
    print(json.dumps(info, indent=1))
    ok = any(info['tracked']) and not info['errors']; print('PASS' if ok else 'FAIL'); return ok

async def mouse(a):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=a.chrome, args=GL)
        pg = await b.new_page(viewport={'width': 800, 'height': 480})
        await pg.goto(f"{a.base}?auto=1&input=mouse&gaze=mouse&quality=0&saliency=0&seed={a.seed}&pr=0.5")
        await pg.wait_for_function('window.__sandwich && window.__sandwich.logger && window.__sandwich.logger.recording', timeout=120000)
        px = lambda expr: pg.evaluate(f'''(() => {{ const S = window.__sandwich, v = ({expr}).clone().project(S.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }})()''')
        state = lambda: pg.evaluate('''(() => { const S = window.__sandwich, h = S.hands[1]; return { holding: h.holding && h.holding.id, hover: h.hover && h.hover.id, open: S.L.task.bag.state.open,
            types: S.logger.events.map(e => e.type).filter(t => ['grasp','release','bag_open','grasp_miss'].includes(t)), errors: window.__errors || null }; })()''')
        x, y = await px("S.L.task.bag.clip.root.getWorldPosition(new S.camera.position.constructor())")
        await pg.mouse.move(x, y, steps=8); await asyncio.sleep(2.5); s0 = await state()
        await pg.mouse.down(); await pg.mouse.up(); await asyncio.sleep(1.5); s1 = await state()
        x, y = await px("new S.camera.position.constructor(0.35, 0.91, -0.1)")
        await pg.mouse.move(x, y, steps=12); await asyncio.sleep(2.5)
        await pg.mouse.down(); await pg.mouse.up(); await asyncio.sleep(1.5); s2 = await state()
        await b.close()
    checks = {'hover finds the clip': s0['hover'] == 'bread_clip', 'click grabs it and the bag opens': s1['holding'] == 'bread_clip' and s1['open'],
              'second click releases': s2['holding'] is None and 'release' in s2['types'], 'no errors': not s2['errors']}
    for k, v in checks.items(): print('  ok ' if v else '  XX ', k)
    if not all(checks.values()): print(s0, s1, s2)
    print('PASS' if all(checks.values()) else 'FAIL'); return all(checks.values())

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('which', choices=['synthetic', 'camera', 'mouse'])
    ap.add_argument('--base', default='http://localhost:8811/index.html'); ap.add_argument('--chrome', default=None); ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--video'); ap.add_argument('--shot'); ap.add_argument('--wait', type=float, default=6); ap.add_argument('--tone', default='neutral')
    a = ap.parse_args()
    sys.exit(0 if asyncio.run({'synthetic': synthetic, 'camera': camera, 'mouse': mouse}[a.which](a)) else 1)

if __name__ == '__main__':
    main()
