"""Move the mouse slightly every few seconds to prevent macOS from sleeping.

Usage:  python keep_awake.py
Stop:   Ctrl+C

Zero third-party dependencies — calls macOS CoreGraphics via ctypes.
"""

import ctypes
import ctypes.util
import time

# Load CoreGraphics framework
_cg = ctypes.cdll.LoadLibrary(ctypes.util.find_library("CoreGraphics"))

# CGEventRef CGEventCreate(CGEventSourceRef source)
_cg.CGEventCreate.restype = ctypes.c_void_p
_cg.CGEventCreate.argtypes = [ctypes.c_void_p]

# CGPoint CGEventGetLocation(CGEventRef event)
class CGPoint(ctypes.Structure):
    _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]

_cg.CGEventGetLocation.restype = CGPoint
_cg.CGEventGetLocation.argtypes = [ctypes.c_void_p]

# CGEventRef CGEventCreateMouseEvent(source, mouseType, mouseCursorPosition, mouseButton)
_cg.CGEventCreateMouseEvent.restype = ctypes.c_void_p
_cg.CGEventCreateMouseEvent.argtypes = [
    ctypes.c_void_p, ctypes.c_uint32, CGPoint, ctypes.c_uint32,
]

# void CGEventPost(CGEventTapLocation tap, CGEventRef event)
_cg.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]

# void CFRelease(CFTypeRef cf)
_cf = ctypes.cdll.LoadLibrary(ctypes.util.find_library("CoreFoundation"))
_cf.CFRelease.argtypes = [ctypes.c_void_p]

kCGEventMouseMoved = 5
kCGHIDEventTap = 0
kCGMouseButtonLeft = 0

INTERVAL = 5  # seconds between nudges


def get_mouse_pos():
    event = _cg.CGEventCreate(None)
    pos = _cg.CGEventGetLocation(event)
    _cf.CFRelease(event)
    return pos.x, pos.y


def nudge_mouse():
    x, y = get_mouse_pos()
    for dx in (1, -1):
        pt = CGPoint(x + dx, y)
        evt = _cg.CGEventCreateMouseEvent(None, kCGEventMouseMoved, pt, kCGMouseButtonLeft)
        _cg.CGEventPost(kCGHIDEventTap, evt)
        _cf.CFRelease(evt)


def main():
    print(f"☕  Keep-awake: nudging mouse every {INTERVAL}s. Ctrl+C to stop.")
    try:
        while True:
            nudge_mouse()
            time.sleep(INTERVAL)
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
