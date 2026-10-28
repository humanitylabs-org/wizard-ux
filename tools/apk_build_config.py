"""Artifact BuildConfig reader, shared with the canonical phone-release work (PR #513).
Read encoded DEX fields; string-searching a hostname does not prove ORIGIN.
"""
import re
import struct
import zipfile


def require(ok, message):
    if not ok:
        raise ValueError(message)


def uleb(data, offset):
    value = shift = 0
    for _ in range(5):
        b = data[offset]
        offset += 1
        value |= (b & 127) << shift
        if not b & 128:
            return value, offset
        shift += 7
    raise ValueError('Invalid DEX ULEB128')


def dex_build_config(data):
    """Read encoded static String fields, not a substring guess over DEX bytes."""
    require(data[:4] == b'dex\n', 'Unsupported DEX')
    u32 = lambda offset: struct.unpack_from('<I', data, offset)[0]
    nstrings, strings_off = u32(56), u32(60)
    strings = []
    for i in range(nstrings):
        _, start = uleb(data, u32(strings_off + 4 * i))
        strings.append(data[start:data.index(b'\0', start)].decode('utf-8', errors='replace'))
    types_off, fields_off = u32(68), u32(84)
    def typename(idx):
        return strings[u32(types_off + 4 * idx)]
    found = None
    for i in range(u32(96)):
        off = u32(100) + 32 * i
        if typename(u32(off)) != 'Lai/wizards/os/BuildConfig;':
            continue
        require(found is None, 'Duplicate BuildConfig')
        class_data, values_off = u32(off + 24), u32(off + 28)
        require(class_data != 0 and values_off != 0, 'Missing BuildConfig static values')
        counts = []
        for _ in range(4):
            count, class_data = uleb(data, class_data)
            counts.append(count)
        static_fields = []
        field_idx = 0
        for _ in range(counts[0]):
            delta, class_data = uleb(data, class_data)
            _, class_data = uleb(data, class_data)
            field_idx += delta
            static_fields.append(strings[u32(fields_off + 8 * field_idx + 4)])
        size, pos = uleb(data, values_off)
        require(size <= len(static_fields), 'Invalid static value count')
        found = {}
        for name in static_fields[:size]:
            header = data[pos]
            pos += 1
            kind, width = header & 31, (header >> 5) + 1
            if kind in (0x1e, 0x1f):
                value = None if kind == 0x1e else bool(header >> 5)
            else:
                require(kind not in (0x1c, 0x1d), 'Unexpected compound BuildConfig constant')
                raw = int.from_bytes(data[pos:pos + width], 'little')
                pos += width
                value = strings[raw] if kind == 0x17 else raw
            found[name] = value
    return found


def apk_build_config(apk):
    found = []
    with zipfile.ZipFile(apk) as z:
        for name in z.namelist():
            if re.fullmatch(r'classes\d*\.dex', name):
                fields = dex_build_config(z.read(name))
                if fields is not None:
                    found.append(fields)
    require(len(found) == 1, 'Expected exactly one artifact BuildConfig')
    return found[0]
