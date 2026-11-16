using System.Runtime.InteropServices;

internal static class MacClipboard
{
    private const string ObjC = "/usr/lib/libobjc.A.dylib";
    static MacClipboard() => NativeLibrary.Load("/System/Library/Frameworks/AppKit.framework/AppKit");
    private static nint Sel(string name) => sel_registerName(name);
    private static nint Text(string value)
    {
        nint utf8 = Marshal.StringToCoTaskMemUTF8(value);
        try { return SendPtr(objc_getClass("NSString"), Sel("stringWithUTF8String:"), utf8); }
        finally { Marshal.FreeCoTaskMem(utf8); }
    }

    internal static void Write(string path, byte[] bytes)
    {
        nint pool = Send(Send(objc_getClass("NSAutoreleasePool"), Sel("alloc")), Sel("init"));
        nint item = 0;
        try
        {
            nint board = Send(objc_getClass("NSPasteboard"), Sel("generalPasteboard"));
            item = Send(Send(objc_getClass("NSPasteboardItem"), Sel("alloc")), Sel("init"));
            var pin = GCHandle.Alloc(bytes, GCHandleType.Pinned);
            nint data;
            try { data = SendData(objc_getClass("NSData"), Sel("dataWithBytes:length:"), pin.AddrOfPinnedObject(), (nuint)bytes.Length); }
            finally { pin.Free(); }
            nint url = SendPtr(objc_getClass("NSURL"), Sel("fileURLWithPath:"), Text(path));
            if (board == 0 || item == 0 || data == 0 || url == 0 ||
                !SendBool2(item, Sel("setData:forType:"), data, Text("com.compuserve.gif")) ||
                !SendBool2(item, Sel("setString:forType:"), Send(url, Sel("absoluteString")), Text("public.file-url")))
                throw new InvalidOperationException("Unable to prepare GIF clipboard data.");
            nint items = SendPtr(objc_getClass("NSArray"), Sel("arrayWithObject:"), item);
            Send(board, Sel("clearContents"));
            if (!SendBool(board, Sel("writeObjects:"), items))
                throw new InvalidOperationException("Unable to write the macOS clipboard.");
        }
        finally
        {
            if (item != 0) SendVoid(item, Sel("release"));
            SendVoid(pool, Sel("drain"));
        }
    }

    internal static string? CurrentFile()
    {
        nint pool = Send(Send(objc_getClass("NSAutoreleasePool"), Sel("alloc")), Sel("init"));
        try
        {
            nint board = Send(objc_getClass("NSPasteboard"), Sel("generalPasteboard"));
            nint text = SendPtr(board, Sel("stringForType:"), Text("public.file-url"));
            string? url = text == 0 ? null : Marshal.PtrToStringUTF8(Send(text, Sel("UTF8String")));
            return Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.IsFile ? uri.LocalPath : null;
        }
        finally { SendVoid(pool, Sel("drain")); }
    }

    [DllImport(ObjC)] private static extern nint objc_getClass(string name);
    [DllImport(ObjC)] private static extern nint sel_registerName(string name);
    [DllImport(ObjC, EntryPoint = "objc_msgSend")] private static extern nint Send(nint receiver, nint selector);
    [DllImport(ObjC, EntryPoint = "objc_msgSend")] private static extern nint SendPtr(nint receiver, nint selector, nint argument);
    [DllImport(ObjC, EntryPoint = "objc_msgSend")] private static extern nint SendData(nint receiver, nint selector, nint bytes, nuint length);
    [DllImport(ObjC, EntryPoint = "objc_msgSend")] [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool SendBool(nint receiver, nint selector, nint argument);
    [DllImport(ObjC, EntryPoint = "objc_msgSend")] [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool SendBool2(nint receiver, nint selector, nint first, nint second);
    [DllImport(ObjC, EntryPoint = "objc_msgSend")] private static extern void SendVoid(nint receiver, nint selector);
}
