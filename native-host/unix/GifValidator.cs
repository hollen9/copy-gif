using System.Buffers.Binary;

internal static class GifValidator
{
    internal static void Validate(byte[] data)
    {
        if (data.Length < 14 || (!data.AsSpan(0, 6).SequenceEqual("GIF87a"u8) &&
            !data.AsSpan(0, 6).SequenceEqual("GIF89a"u8)))
            throw new InvalidDataException("Not a GIF. Open the original GIF instead of a WebP or MP4 preview.");
        CheckSize(data, 6);
        int offset = 13;
        if ((data[10] & 0x80) != 0) offset += 3 * (1 << ((data[10] & 7) + 1));
        int frames = 0;
        while (offset < data.Length)
        {
            int type = data[offset++];
            if (type == 0x3b)
            {
                if (frames == 0) throw new InvalidDataException("GIF has no image frames.");
                return;
            }
            if (type == 0x21)
            {
                Require(data, offset, 1);
                offset++; // Extension label, followed by sub-blocks.
            }
            else if (type == 0x2c)
            {
                Require(data, offset, 9);
                CheckSize(data, offset + 4);
                int flags = data[offset + 8];
                offset += 9;
                if ((flags & 0x80) != 0) offset += 3 * (1 << ((flags & 7) + 1));
                Require(data, offset, 2);
                if (data[offset] < 2 || data[offset] > 8 || data[offset + 1] == 0)
                    throw new InvalidDataException("Invalid GIF image data.");
                offset++; // LZW minimum code size.
                frames++;
            }
            else throw new InvalidDataException("Invalid GIF block.");
            int size;
            do
            {
                Require(data, offset, 1);
                size = data[offset++];
                Require(data, offset, size);
                offset += size;
            } while (size != 0);
        }
        throw new InvalidDataException("GIF is truncated.");
    }

    private static void CheckSize(byte[] data, int offset)
    {
        Require(data, offset, 4);
        int width = BinaryPrimitives.ReadUInt16LittleEndian(data.AsSpan(offset, 2));
        int height = BinaryPrimitives.ReadUInt16LittleEndian(data.AsSpan(offset + 2, 2));
        if (width == 0 || height == 0 || (long)width * height > 40_000_000)
            throw new InvalidDataException("GIF dimensions are invalid or too large.");
    }

    private static void Require(byte[] data, int offset, int count)
    {
        if (offset < 0 || offset > data.Length - count) throw new InvalidDataException("GIF is truncated.");
    }
}
