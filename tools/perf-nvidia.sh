#!/bin/sh
# Performance run on the NVIDIA GPU (plan §17, §19): the Chromium flatpak has no NVIDIA driver
# extension and can only reach the Intel iGPU through Mesa, so this drives the native Brave (or
# Chrome) binary headless, with a throwaway profile, on the discrete GPU via PRIME render offload.
# Headless Chromium falls back to SwiftShader on the Vulkan path here; the ANGLE-over-GL path works.
#   tools/perf-nvidia.sh [--preset=medium,high] [--out=perf-out-nvidia]   (any tools/perf.mjs flag)
#   CHROMIUM=/path/to/browser tools/perf-nvidia.sh ...                    (default: Brave)
cd "$(dirname "$0")/.." || exit 1
exec env -u DRI_PRIME \
  CHROMIUM="${CHROMIUM:-/opt/brave.com/brave/brave}" \
  CHROMIUM_ARGS="--use-gl=angle --use-angle=gl" \
  __NV_PRIME_RENDER_OFFLOAD=1 \
  __GLX_VENDOR_LIBRARY_NAME=nvidia \
  __EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/10_nvidia.json \
  node tools/perf.mjs "$@"
