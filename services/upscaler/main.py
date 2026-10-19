"""
AI upscaler for print preparation — the service behind `PrintPrepSettings.upscaler.url`.

Contract (what `functions/src/upscaler.ts` relies on):

    POST /upscale?scale=2|4      body: the picture (PNG, JPEG or WebP)
    200                          body: the picture at exactly scale × its size
                                 (PNG when it has transparency, else JPEG q97)
    GET  /healthz                200 once the models are loaded

The caller resizes the result to the exact print size, checks it still looks
like its source, and falls back to Lanczos on any error — so this service may
fail, be slow or be absent without an order ever waiting on it.

Models: Real-ESRGAN x2plus / x4plus (BSD-3-Clause), loaded with spandrel.
Large pictures are processed in overlapping tiles so GPU memory stays flat.

Deploy (Cloud Run with a GPU, private):

    gcloud run deploy upscaler --source services/upscaler --region europe-west4 \
      --gpu 1 --gpu-type nvidia-l4 --cpu 4 --memory 16Gi --concurrency 1 \
      --min-instances 0 --max-instances 2 --timeout 300 --no-allow-unauthenticated \
      --no-cpu-throttling
    gcloud run services add-iam-policy-binding upscaler --region europe-west4 \
      --member serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com \
      --role roles/run.invoker

Then paste the service URL into Admin → Orders → Print files → Settings (auth:
IAM) and press "Test upscaler".
"""

import io
import os
import threading

import numpy as np
import torch
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import Response
from PIL import Image
from spandrel import ImageModelDescriptor, ModelLoader

MODEL_PATHS = {
    2: os.environ.get("MODEL_X2", "/models/RealESRGAN_x2plus.pth"),
    4: os.environ.get("MODEL_X4", "/models/RealESRGAN_x4plus.pth"),
}
TILE = int(os.environ.get("TILE", "512"))
OVERLAP = 32
MAX_SOURCE_PIXELS = 4_000_000
MAX_BODY_BYTES = 30 * 1024 * 1024

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
_models: dict[int, ImageModelDescriptor] = {}
_lock = threading.Lock()

app = FastAPI()


def model(scale: int) -> ImageModelDescriptor:
    with _lock:
        if scale not in _models:
            m = ModelLoader().load_from_file(MODEL_PATHS[scale])
            if not isinstance(m, ImageModelDescriptor) or m.scale != scale:
                raise RuntimeError(f"{MODEL_PATHS[scale]} is not a {scale}x image model")
            m.to(DEVICE).eval()
            if DEVICE.type == "cuda" and m.supports_half:
                m.half()
            _models[scale] = m
        return _models[scale]


@torch.inference_mode()
def run_tiled(m: ImageModelDescriptor, x: torch.Tensor, scale: int) -> torch.Tensor:
    """x: 1×3×H×W in [0,1]. Each tile is run with an overlap margin and only its core kept."""
    _, _, h, w = x.shape
    out = torch.zeros((1, 3, h * scale, w * scale), dtype=torch.float32, device="cpu")
    dtype = torch.float16 if DEVICE.type == "cuda" and m.supports_half else torch.float32
    for top in range(0, h, TILE):
        for left in range(0, w, TILE):
            bottom, right = min(top + TILE, h), min(left + TILE, w)
            t0, l0 = max(top - OVERLAP, 0), max(left - OVERLAP, 0)
            b0, r0 = min(bottom + OVERLAP, h), min(right + OVERLAP, w)
            tile = x[:, :, t0:b0, l0:r0].to(DEVICE, dtype)
            y = m(tile).float().cpu()
            out[
                :, :, top * scale : bottom * scale, left * scale : right * scale
            ] = y[
                :,
                :,
                (top - t0) * scale : (top - t0 + bottom - top) * scale,
                (left - l0) * scale : (left - l0 + right - left) * scale,
            ]
    return out


def upscale(img: Image.Image, scale: int) -> Image.Image:
    alpha = img.getchannel("A") if "A" in img.getbands() else None
    rgb = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    x = torch.from_numpy(rgb).permute(2, 0, 1).unsqueeze(0)
    y = run_tiled(model(scale), x, scale)
    arr = (y.squeeze(0).permute(1, 2, 0).clamp(0, 1) * 255.0).round().byte().numpy()
    up = Image.fromarray(arr, "RGB")
    if alpha is not None:
        up.putalpha(alpha.resize(up.size, Image.Resampling.LANCZOS))
    return up


@app.get("/healthz")
def healthz() -> dict:
    model(2)
    model(4)
    return {"ok": True, "device": DEVICE.type}


@app.post("/upscale")
async def upscale_route(request: Request, scale: int = Query(...)) -> Response:
    if scale not in (2, 4):
        raise HTTPException(400, "scale must be 2 or 4")
    body = await request.body()
    if not body or len(body) > MAX_BODY_BYTES:
        raise HTTPException(413, "picture missing or too large")
    try:
        img = Image.open(io.BytesIO(body))
        img.load()
    except Exception as err:  # noqa: BLE001 — any decode failure is the caller's input
        raise HTTPException(400, f"not a picture: {err}") from err
    if img.width * img.height > MAX_SOURCE_PIXELS:
        raise HTTPException(413, "picture already large; resample it instead")

    up = upscale(img, scale)
    buf = io.BytesIO()
    if up.mode == "RGBA":
        up.save(buf, "PNG", compress_level=3)
        media = "image/png"
    else:
        # JPEG keeps a 24 MP result well under Cloud Run's response limit; the caller re-encodes anyway.
        up.save(buf, "JPEG", quality=97, subsampling=0)
        media = "image/jpeg"
    return Response(content=buf.getvalue(), media_type=media)
