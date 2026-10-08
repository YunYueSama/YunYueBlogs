"""Windows DPAPI 将账号凭据绑定到当前系统用户。"""
import base64
import ctypes
import os
from ctypes import wintypes


def protect(value: str, *, decrypt: bool = False) -> str:
    if os.name != 'nt':
        return value
    class Blob(ctypes.Structure):
        _fields_ = [('length', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]
    raw = base64.b64decode(value, validate=True) if decrypt else value.encode('utf-8')
    buffer = (ctypes.c_ubyte * len(raw)).from_buffer_copy(raw)
    source = Blob(len(raw), buffer)
    target = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    if decrypt:
        function = crypt.CryptUnprotectData
        second = None
    else:
        function = crypt.CryptProtectData
        second = 'YunYue music account'
    function.restype = wintypes.BOOL
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p if decrypt else wintypes.LPCWSTR,
                         ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    # 禁止系统交互弹窗；不允许凭据转移到另一位 Windows 用户。
    if not function(ctypes.byref(source), second, None, None, None, 1, ctypes.byref(target)):
        raise ValueError('无法读取或保护本机账号凭据，请使用原 Windows 用户重新登录')
    try:
        result = ctypes.string_at(target.data, target.length)
        return result.decode('utf-8') if decrypt else base64.b64encode(result).decode('ascii')
    finally:
        kernel = ctypes.WinDLL('kernel32')
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        kernel.LocalFree(target.data)
