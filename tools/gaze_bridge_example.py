#!/usr/bin/env python3
"""Stream a lab eye tracker into sandwichestime (gaze source: "external eye tracker").

The browser connects to ws://localhost:8765 and expects JSON messages:
    {"x": 0..1, "y": 0..1, "t": <tracker time, s>, "valid": true, "conf": 0..1}
x, y are normalised screen coordinates of the *browser window* (top-left origin).
Run the task full-screen so screen == window, or map with your own offset.

    pip install websockets
    python3 tools/gaze_bridge_example.py --demo     # synthetic Lissajous gaze, to test the pipe

Replace `read_tracker()` with your SDK:
  - EyeLink:  pylink  -> getNewestSample().getRightEye().getGaze() / screen px
  - Tobii:    tobii_research -> gaze_data callback, 'left_gaze_point_on_display_area'
  - Pupil:    zmq subscribe 'surfaces.<name>' -> norm_pos (flip y)
"""
import argparse, asyncio, json, math, time
import websockets

def read_tracker(t0, demo):
    if demo:
        t = time.time() - t0
        return {"x": 0.5 + 0.35 * math.sin(t * 0.7), "y": 0.55 + 0.3 * math.sin(t * 1.1), "t": t, "valid": True, "conf": 1.0}
    raise NotImplementedError("wire your eye tracker SDK in read_tracker()")

async def serve(ws, rate, demo):
    t0 = time.time()
    while True:
        await ws.send(json.dumps(read_tracker(t0, demo)))
        await asyncio.sleep(1 / rate)

async def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--port", type=int, default=8765); ap.add_argument("--rate", type=float, default=250)
    ap.add_argument("--demo", action="store_true"); a = ap.parse_args()
    async with websockets.serve(lambda ws: serve(ws, a.rate, a.demo), "localhost", a.port):
        print(f"gaze bridge on ws://localhost:{a.port} ({'demo' if a.demo else 'tracker'})"); await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
