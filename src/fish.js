// Core FISH (Cutefish FISH Architecture Engine) Implementation
// Adapted from the original TikTok HQ Upload FISH method
// This provides 100% lossless MP4 atom restructuring for TikTok compatibility

(function () {
    'use strict';

    // Helper functions for reading/writing uint32
    function readU32(arr, off) {
        return ((arr[off] << 24) | (arr[off + 1] << 16) | (arr[off + 2] << 8) | arr[off + 3]) >>> 0;
    }

    function writeU32(arr, off, val) {
        arr[off] = (val >>> 24) & 0xff;
        arr[off + 1] = (val >>> 16) & 0xff;
        arr[off + 2] = (val >>> 8) & 0xff;
        arr[off + 3] = val & 0xff;
    }

    function makeBox(type, payload) {
        const size = 8 + payload.byteLength;
        const box = new Uint8Array(size);
        writeU32(box, 0, size);
        for (let i = 0; i < 4; i++) box[4 + i] = type.charCodeAt(i);
        box.set(payload, 8);
        return box;
    }

    function parseBoxes(buf, start, end) {
        const boxes = [];
        let off = start;
        while (off + 8 <= end) {
            let size = readU32(buf, off);
            const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
            let headerSize = 8;
            if (size === 1) {
                if (off + 16 > end) break;
                const high = readU32(buf, off + 8);
                const low  = readU32(buf, off + 12);
                size = high * 4294967296 + low;
                headerSize = 16;
            } else if (size === 0) {
                size = end - off;
            }
            if (size < headerSize || off + size > end) break;
            boxes.push({
                type,
                offset: off,
                size,
                headerSize,
                contentStart: off + headerSize,
                end: off + size
            });
            off += size;
        }
        return boxes;
    }

    function findDeep(buf, startOffset, endOffset, targetType) {
        const boxes = parseBoxes(buf, startOffset, endOffset);
        for (const b of boxes) {
            if (b.type === targetType) return b;
            if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts'].includes(b.type)) {
                const sub = findDeep(buf, b.contentStart, b.end, targetType);
                if (sub) return sub;
            }
        }
        return null;
    }

    function concatArrays(arrs) {
        let total = 0;
        for (const a of arrs) total += (a ? a.byteLength : 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const a of arrs) {
            if (!a) continue;
            out.set(a, off);
            off += a.byteLength;
        }
        return out;
    }

    // Main FISH patch function
    function patchMp4Fish(inputBuffer, logFn = () => {}) {
        const log = logFn;
        const buf = inputBuffer instanceof Uint8Array ? inputBuffer : new Uint8Array(inputBuffer);
        const topBoxes = parseBoxes(buf, 0, buf.length);

        const ftyp = topBoxes.find(b => b.type === 'ftyp');
        const moov = topBoxes.find(b => b.type === 'moov');
        const mdat = topBoxes.find(b => b.type === 'mdat');

        if (!ftyp || !moov || !mdat) {
            throw new Error('Standard MP4 format not found (ftyp, moov, or mdat missing).');
        }

        const ftypBytes = buf.subarray(ftyp.offset, ftyp.end);
        const origMdatPayload = buf.subarray(mdat.contentStart, mdat.end);
        const origMdatContentStart = mdat.contentStart;

        const moovChildren = parseBoxes(buf, moov.contentStart, moov.end);
        const mvhd = moovChildren.find(b => b.type === 'mvhd');
        const traks = moovChildren.filter(b => b.type === 'trak');

        if (!mvhd || traks.length === 0) {
            throw new Error('Invalid moov atom structure.');
        }

        const origMvhdVer = buf[mvhd.contentStart];
        const origMvhdTimescale = readU32(buf, mvhd.contentStart + (origMvhdVer === 1 ? 20 : 12)) || 1000;
        const targetMvhdTimescale = 48000;

        // Helper to rescale tkhd duration from origMvhdTimescale -> 48000
        function rescaleTkhd(tkhdBox) {
            const copy = new Uint8Array(tkhdBox.size);
            copy.set(buf.subarray(tkhdBox.offset, tkhdBox.end));
            const ver = copy[8];
            const dv = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
            if (ver === 1) {
                const origDur = dv.getBigUint64(8 + 28, false);
                const newDur = (origDur * BigInt(targetMvhdTimescale)) / BigInt(origMvhdTimescale);
                dv.setBigUint64(8 + 28, newDur, false);
            } else {
                const origDur = dv.getUint32(8 + 20, false);
                const newDur = Math.round((origDur * targetMvhdTimescale) / origMvhdTimescale);
                dv.setUint32(8 + 20, newDur, false);
            }
            return copy;
        }

        // Helper to rescale edts/elst segment_duration from origMvhdTimescale -> 48000
        function rescaleEdts(edtsBox) {
            const elstBox = findDeep(buf, edtsBox.contentStart, edtsBox.end, 'elst');
            if (!elstBox) return buf.subarray(edtsBox.offset, edtsBox.end);
            const elstCopy = new Uint8Array(elstBox.size - elstBox.headerSize);
            elstCopy.set(buf.subarray(elstBox.contentStart, elstBox.end));
            const elstDv = new DataView(elstCopy.buffer, elstCopy.byteOffset, elstCopy.byteLength);
            const ver = elstCopy[0];
            const count = elstDv.getUint32(4, false);
            for (let i = 0; i < count; i++) {
                const base = 8 + i * (ver === 1 ? 20 : 12);
                if (ver === 1) {
                    const segDur = elstDv.getBigUint64(base, false);
                    const newSegDur = (segDur * BigInt(targetMvhdTimescale)) / BigInt(origMvhdTimescale);
                    elstDv.setBigUint64(base, newSegDur, false);
                } else {
                    const segDur = elstDv.getUint32(base, false);
                    const newSegDur = Math.round((segDur * targetMvhdTimescale) / origMvhdTimescale);
                    elstDv.setUint32(base, newSegDur, false);
                }
            }
            return makeBox('edts', makeBox('elst', elstCopy));
        }

        // 1. mvhd Version 1 (64-bit) Infinite Duration with timescale 48000
        const newMvhdPayload = new Uint8Array(112);
        const mvhdDv = new DataView(newMvhdPayload.buffer);
        newMvhdPayload[0] = 1; // Version 1
        mvhdDv.setUint32(20, targetMvhdTimescale, false); // timescale 48000
        mvhdDv.setBigUint64(24, 0xFFFFFFFFFFFFFFFFn, false); // duration infinite
        mvhdDv.setUint32(32, 0x00010000, false); // rate 1.0
        mvhdDv.setUint16(36, 0x0100, false); // volume 1.0
        mvhdDv.setUint32(48, 0x00010000, false); // matrix
        mvhdDv.setUint32(64, 0x00010000, false);
        mvhdDv.setUint32(80, 0x40000000, false);
        mvhdDv.setUint32(108, 4, false); // next_track_id = 4
        const newMvhdBox = makeBox('mvhd', newMvhdPayload);

        // 2. Video & Audio Tracks - detect by handler type (robust for Alight Motion)
        function getTrackHandlerType(trakBox) {
            const hdlr = findDeep(buf, trakBox.contentStart, trakBox.end, 'hdlr');
            if (!hdlr) return null;
            // hdlr content: version(1) + flags(3) + pre_defined(4) + handler_type(4) + ...
            return String.fromCharCode(
                buf[hdlr.contentStart + 8],
                buf[hdlr.contentStart + 9],
                buf[hdlr.contentStart + 10],
                buf[hdlr.contentStart + 11]
            );
        }

        let videoTrak = null;
        let audioTrak = null;
        for (const trak of traks) {
            const handlerType = getTrackHandlerType(trak);
            if (handlerType === 'vide' && !videoTrak) videoTrak = trak;
            else if (handlerType === 'soun' && !audioTrak) audioTrak = trak;
        }
        // Fallback: if detection failed, use position-based (original behavior)
        if (!videoTrak) videoTrak = traks[0];
        if (!audioTrak && traks.length > 1) audioTrak = traks[1];

        const vSttsBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stts');
        const vStscBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stsc');
        const vStszBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stsz');
        const vStcoBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stco') || findDeep(buf, videoTrak.contentStart, videoTrak.end, 'co64');
        const vCttsBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'ctts');

        if (!vSttsBox || !vStscBox || !vStszBox || !vStcoBox) {
            throw new Error('Video stbl atoms (stts/stsc/stsz/stco) not found.');
        }

        // Handle both stco (32-bit) and co64 (64-bit) chunk offset tables
        const isCo64 = vStcoBox.type === 'co64';
        const entrySize = isCo64 ? 8 : 4;
        const vChunkCount = readU32(buf, vStcoBox.contentStart + 4);
        const vRelOffsets = [];
        for (let i = 0; i < vChunkCount; i++) {
            const entryOffset = vStcoBox.contentStart + 8 + i * entrySize;
            let off;
            if (isCo64) {
                const high = readU32(buf, entryOffset);
                const low = readU32(buf, entryOffset + 4);
                off = high * 4294967296 + low;
            } else {
                off = readU32(buf, entryOffset);
            }
            vRelOffsets.push(off - origMdatContentStart);
        }

        let aStcoBox = null, aStsdBox = null;
        let aChunkCount = 0;
        let aRelOffsets = [];
        if (audioTrak) {
            aStsdBox = findDeep(buf, audioTrak.contentStart, audioTrak.end, 'stsd');
            aStcoBox = findDeep(buf, audioTrak.contentStart, audioTrak.end, 'stco') || findDeep(buf, audioTrak.contentStart, audioTrak.end, 'co64');
            if (aStcoBox) {
                const isACo64 = aStcoBox.type === 'co64';
                const aEntrySize = isACo64 ? 8 : 4;
                aChunkCount = readU32(buf, aStcoBox.contentStart + 4);
                for (let i = 0; i < aChunkCount; i++) {
                    const entryOffset = aStcoBox.contentStart + 8 + i * aEntrySize;
                    let off;
                    if (isACo64) {
                        const high = readU32(buf, entryOffset);
                        const low = readU32(buf, entryOffset + 4);
                        off = high * 4294967296 + low;
                    } else {
                        off = readU32(buf, entryOffset);
                    }
                    aRelOffsets.push(off - origMdatContentStart);
                }
            }
        }

        // 8 bytes inside mdat at the end + 16 bytes outside mdat (Track 3 sample + free box)
        const inMdatAnchor = new Uint8Array([0x00, 0x00, 0x00, 0x08, 0x66, 0x72, 0x65, 0x65]);
        const outMdatTrap = new Uint8Array([
            0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x08, 0x66, 0x72, 0x65, 0x65
        ]);

        // Build Video STTS (+1 zero-delta sample)
        const origVSttsEntries = readU32(buf, vSttsBox.contentStart + 4);
        const newVSttsPayload = new Uint8Array(8 + (origVSttsEntries + 1) * 8);
        const vSttsDv = new DataView(newVSttsPayload.buffer);
        vSttsDv.setUint32(4, origVSttsEntries + 1, false);
        newVSttsPayload.set(buf.subarray(vSttsBox.contentStart + 8, vSttsBox.contentStart + 8 + origVSttsEntries * 8), 8);
        vSttsDv.setUint32(8 + origVSttsEntries * 8, 1, false);
        vSttsDv.setUint32(8 + origVSttsEntries * 8 + 4, 0, false);
        const newVSttsBox = makeBox('stts', newVSttsPayload);

        // Build Video STSZ (+1 sample of size 8)
        const origVSampleSize = readU32(buf, vStszBox.contentStart + 4);
        const origVSampleCount = readU32(buf, vStszBox.contentStart + 8);
        const newVStszPayload = new Uint8Array(12 + (origVSampleCount + 1) * 4);
        const vStszDv = new DataView(newVStszPayload.buffer);
        vStszDv.setUint32(4, 0, false);
        vStszDv.setUint32(8, origVSampleCount + 1, false);
        if (origVSampleSize === 0) {
            newVStszPayload.set(buf.subarray(vStszBox.contentStart + 12, vStszBox.contentStart + 12 + origVSampleCount * 4), 12);
        } else {
            for (let i = 0; i < origVSampleCount; i++) {
                vStszDv.setUint32(12 + i * 4, origVSampleSize, false);
            }
        }
        vStszDv.setUint32(12 + origVSampleCount * 4, 8, false);
        const newVStszBox = makeBox('stsz', newVStszPayload);

        // Build Video CTTS:
        // If video has ctts, append 1 entry (count=1, offset=0).
        // If video has NO ctts, inject a 2-entry zero-offset ctts to trigger bypass cleanly.
        let newVCttsBox = null;
        if (vCttsBox) {
            const origCttsEntries = readU32(buf, vCttsBox.contentStart + 4);
            const newCttsPayload = new Uint8Array(8 + (origCttsEntries + 1) * 8);
            const cttsDv = new DataView(newCttsPayload.buffer);
            newCttsPayload[0] = buf[vCttsBox.contentStart];
            cttsDv.setUint32(4, origCttsEntries + 1, false);
            newCttsPayload.set(buf.subarray(vCttsBox.contentStart + 8, vCttsBox.contentStart + 8 + origCttsEntries * 8), 8);
            cttsDv.setUint32(8 + origCttsEntries * 8, 1, false);
            cttsDv.setUint32(8 + origCttsEntries * 8 + 4, 0, false);
            newVCttsBox = makeBox('ctts', newCttsPayload);
        } else {
            const newCttsPayload = new Uint8Array(8 + 2 * 8);
            const cttsDv = new DataView(newCttsPayload.buffer);
            newCttsPayload[0] = 0;
            cttsDv.setUint32(4, 2, false);
            cttsDv.setUint32(8, origVSampleCount, false);
            cttsDv.setUint32(12, 0, false);
            cttsDv.setUint32(16, 1, false);
            cttsDv.setUint32(20, 0, false);
            newVCttsBox = makeBox('ctts', newCttsPayload);
        }

        // Build Video STSC (+1 chunk)
        const origVStscEntries = readU32(buf, vStscBox.contentStart + 4);
        const newVStscPayload = new Uint8Array(8 + (origVStscEntries + 1) * 12);
        const vStscDv = new DataView(newVStscPayload.buffer);
        vStscDv.setUint32(4, origVStscEntries + 1, false);
        newVStscPayload.set(buf.subarray(vStscBox.contentStart + 8, vStscBox.contentStart + 8 + origVStscEntries * 12), 8);
        vStscDv.setUint32(8 + origVStscEntries * 12, vChunkCount + 1, false);
        vStscDv.setUint32(8 + origVStscEntries * 12 + 4, 1, false);
        vStscDv.setUint32(8 + origVStscEntries * 12 + 8, 1, false);
        const newVStscBox = makeBox('stsc', newVStscPayload);

        // Build Track 3 (Micro-Shield Auxiliary Audio Track)
        const t3TkhdPayload = new Uint8Array(84);
        const t3TkhdDv = new DataView(t3TkhdPayload.buffer);
        t3TkhdDv.setUint32(0, 0x00000007, false);
        t3TkhdDv.setUint32(12, 3, false); // Track ID 3
        t3TkhdDv.setUint32(20, 48000, false);
        t3TkhdDv.setUint16(36, 0x0100, false);
        t3TkhdDv.setUint32(40, 0x00010000, false);
        t3TkhdDv.setUint32(56, 0x00010000, false);
        t3TkhdDv.setUint32(72, 0x40000000, false);
        const t3Tkhd = makeBox('tkhd', t3TkhdPayload);

        const t3MdhdPayload = new Uint8Array(24);
        const t3MdhdDv = new DataView(t3MdhdPayload.buffer);
        t3MdhdDv.setUint32(12, 48000, false);
        t3MdhdDv.setUint32(16, 48000, false);
        const t3Mdhd = makeBox('mdhd', t3MdhdPayload);

        const t3HdlrPayload = new Uint8Array(25);
        t3HdlrPayload.set([0x73, 0x6f, 0x75, 0x6e], 8); // 'soun'
        const nameStr = 'SoundHandler';
        for (let i = 0; i < nameStr.length; i++) t3HdlrPayload[12 + i] = nameStr.charCodeAt(i);
        const t3Hdlr = makeBox('hdlr', t3HdlrPayload);

        let t3Stsd = null;
        if (aStsdBox) {
            t3Stsd = buf.subarray(aStsdBox.offset, aStsdBox.end);
        } else {
            const dummyStsd = new Uint8Array(28);
            const dDv = new DataView(dummyStsd.buffer);
            dDv.setUint32(4, 1, false);
            dDv.setUint32(8, 20, false);
            dummyStsd.set([0x6d, 0x70, 0x34, 0x61], 12);
            t3Stsd = makeBox('stsd', dummyStsd);
        }

        const t3SttsPayload = new Uint8Array(16);
        const t3SttsDv = new DataView(t3SttsPayload.buffer);
        t3SttsDv.setUint32(4, 1, false);
        t3SttsDv.setUint32(8, 1, false);
        t3SttsDv.setUint32(12, 1024, false);
        const t3Stts = makeBox('stts', t3SttsPayload);

        const t3StszPayload = new Uint8Array(12);
        const t3StszDv = new DataView(t3StszPayload.buffer);
        t3StszDv.setUint32(4, 8, false);
        t3StszDv.setUint32(8, 1, false);
        const t3Stsz = makeBox('stsz', t3StszPayload);

        const t3StscPayload = new Uint8Array(20);
        const t3StscDv = new DataView(t3StscPayload.buffer);
        t3StscDv.setUint32(4, 1, false);
        t3StscDv.setUint32(8, 1, false);
        t3StscDv.setUint32(12, 1, false);
        t3StscDv.setUint32(16, 1, false);
        const t3Stsc = makeBox('stsc', t3StscPayload);

        const t3Smhd = makeBox('smhd', new Uint8Array(8));
        const drefEntry = new Uint8Array([0x00, 0x00, 0x00, 0x0c, 0x75, 0x72, 0x6c, 0x20, 0x00, 0x00, 0x00, 0x01]);
        const drefPayload = new Uint8Array(8 + drefEntry.length);
        new DataView(drefPayload.buffer).setUint32(4, 1, false);
        drefPayload.set(drefEntry, 8);
        const t3Dref = makeBox('dref', drefPayload);
        const t3Dinf = makeBox('dinf', t3Dref);

        // Helper to build stco or co64 box based on offset sizes
        function makeStcoBox(offsets, originalType) {
            const needsCo64 = originalType === 'co64' || offsets.some(off => off > 0xFFFFFFFF);
            const entrySize = needsCo64 ? 8 : 4;
            const payload = new Uint8Array(8 + offsets.length * entrySize);
            const dv = new DataView(payload.buffer);
            dv.setUint32(4, offsets.length, false);
            for (let i = 0; i < offsets.length; i++) {
                const base = 8 + i * entrySize;
                if (needsCo64) {
                    const high = Math.floor(offsets[i] / 4294967296);
                    const low = offsets[i] % 4294967296;
                    dv.setUint32(base, high, false);
                    dv.setUint32(base + 4, low, false);
                } else {
                    dv.setUint32(base, offsets[i], false);
                }
            }
            return makeBox(needsCo64 ? 'co64' : 'stco', payload);
        }

        const vStblBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stbl');
        const vStblChildren = parseBoxes(buf, vStblBox.contentStart, vStblBox.end);
        const vMinfBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'minf');
        const vMinfChildren = parseBoxes(buf, vMinfBox.contentStart, vMinfBox.end);
        const vMdiaBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'mdia');
        const vMdiaChildren = parseBoxes(buf, vMdiaBox.contentStart, vMdiaBox.end);
        const vTrakChildren = parseBoxes(buf, videoTrak.contentStart, videoTrak.end);

        let moovBytes = null;
        let finalOutput = null;

        for (let iter = 0; iter < 3; iter++) {
            const estMoovLen = moovBytes ? moovBytes.length : (moov.size + 1024);
            const newMdatContentStart = ftypBytes.length + estMoovLen + 8;
            const anchorChunkOffset = newMdatContentStart + origMdatPayload.length;
            const outMdatChunkOffset = anchorChunkOffset + inMdatAnchor.length;

            // Video STCO - use helper to auto-detect stco vs co64
            const newVStcoOffsets = [...vRelOffsets.map(off => off + newMdatContentStart), anchorChunkOffset];
            const newVStcoBox = makeStcoBox(newVStcoOffsets, vStcoBox.type);

            // Reassemble Video STBL
            const vStblParts = [];
            let cttsAdded = false;
            for (const child of vStblChildren) {
                if (child.type === 'stts') {
                    vStblParts.push(newVSttsBox);
                    if (!vCttsBox && newVCttsBox) {
                        vStblParts.push(newVCttsBox);
                        cttsAdded = true;
                    }
                } else if (child.type === 'ctts') {
                    vStblParts.push(newVCttsBox);
                    cttsAdded = true;
                } else if (child.type === 'stsc') vStblParts.push(newVStscBox);
                else if (child.type === 'stsz') vStblParts.push(newVStszBox);
                else if (child.type === 'stco' || child.type === 'co64') vStblParts.push(newVStcoBox);
                else vStblParts.push(buf.subarray(child.offset, child.end));
            }
            const newVStbl = makeBox('stbl', concatArrays(vStblParts));

            const vMinfParts = [];
            for (const child of vMinfChildren) {
                if (child.type === 'stbl') vMinfParts.push(newVStbl);
                else vMinfParts.push(buf.subarray(child.offset, child.end));
            }
            const newVMinf = makeBox('minf', concatArrays(vMinfParts));

            const vMdiaParts = [];
            for (const child of vMdiaChildren) {
                if (child.type === 'minf') vMdiaParts.push(newVMinf);
                else vMdiaParts.push(buf.subarray(child.offset, child.end));
            }
            const newVMdia = makeBox('mdia', concatArrays(vMdiaParts));

            // Reassemble Video Trak with rescaled tkhd and edts
            const vTrakParts = [];
            for (const child of vTrakChildren) {
                if (child.type === 'tkhd') vTrakParts.push(rescaleTkhd(child));
                else if (child.type === 'edts') vTrakParts.push(rescaleEdts(child));
                else if (child.type === 'mdia') vTrakParts.push(newVMdia);
                else vTrakParts.push(buf.subarray(child.offset, child.end));
            }
            const newVTrak = makeBox('trak', concatArrays(vTrakParts));

            // Audio Track 2 with rescaled tkhd and edts + updated stco
            let newATrak = null;
            if (audioTrak && aStcoBox) {
                const newAStcoOffsets = aRelOffsets.map(off => off + newMdatContentStart);
                const newAStcoBox = makeStcoBox(newAStcoOffsets, aStcoBox.type);

                const aStblBox = findDeep(buf, audioTrak.contentStart, audioTrak.end, 'stbl');
                const aStblChildren = parseBoxes(buf, aStblBox.contentStart, aStblBox.end);
                const aStblParts = [];
                for (const child of aStblChildren) {
                    if (child.type === 'stco' || child.type === 'co64') aStblParts.push(newAStcoBox);
                    else aStblParts.push(buf.subarray(child.offset, child.end));
                }
                const newAStbl = makeBox('stbl', concatArrays(aStblParts));

                const aMinfBox = findDeep(buf, audioTrak.contentStart, audioTrak.end, 'minf');
                const aMinfChildren = parseBoxes(buf, aMinfBox.contentStart, aMinfBox.end);
                const aMinfParts = [];
                for (const child of aMinfChildren) {
                    if (child.type === 'stbl') aMinfParts.push(newAStbl);
                    else aMinfParts.push(buf.subarray(child.offset, child.end));
                }
                const newAMinf = makeBox('minf', concatArrays(aMinfParts));

                const aMdiaBox = findDeep(buf, audioTrak.contentStart, audioTrak.end, 'mdia');
                const aMdiaChildren = parseBoxes(buf, aMdiaBox.contentStart, aMdiaBox.end);
                const aMdiaParts = [];
                for (const child of aMdiaChildren) {
                    if (child.type === 'minf') aMdiaParts.push(newAMinf);
                    else aMdiaParts.push(buf.subarray(child.offset, child.end));
                }
                const newAMdia = makeBox('mdia', concatArrays(aMdiaParts));

                const aTrakChildren = parseBoxes(buf, audioTrak.contentStart, audioTrak.end);
                const aTrakParts = [];
                for (const child of aTrakChildren) {
                    if (child.type === 'tkhd') aTrakParts.push(rescaleTkhd(child));
                    else if (child.type === 'edts') aTrakParts.push(rescaleEdts(child));
                    else if (child.type === 'mdia') aTrakParts.push(newAMdia);
                    else aTrakParts.push(buf.subarray(child.offset, child.end));
                }
                newATrak = makeBox('trak', concatArrays(aTrakParts));
            }

            // Track 3 - use helper for consistency
            const t3Stco = makeStcoBox([outMdatChunkOffset], 'stco');

            const t3Stbl = makeBox('stbl', concatArrays([t3Stsd, t3Stts, t3Stsz, t3Stsc, t3Stco]));
            const t3Minf = makeBox('minf', concatArrays([t3Smhd, t3Dinf, t3Stbl]));
            const t3Mdia = makeBox('mdia', concatArrays([t3Mdhd, t3Hdlr, t3Minf]));
            const t3Trak = makeBox('trak', concatArrays([t3Tkhd, t3Mdia]));

            const traksList = [newVTrak];
            if (newATrak) traksList.push(newATrak);
            traksList.push(t3Trak);

            moovBytes = makeBox('moov', concatArrays([newMvhdBox, ...traksList]));

            if (iter === 2) {
                const newMdatPayload = concatArrays([origMdatPayload, inMdatAnchor]);
                const newMdatBox = makeBox('mdat', newMdatPayload);
                finalOutput = concatArrays([ftypBytes, moovBytes, newMdatBox, outMdatTrap]);
            }
        }

        log(`FISH patch applied (+24 bytes overhead). Total size: ${finalOutput.byteLength} bytes.`);
        return finalOutput;
    }

    // Export to window for browser usage
    window.FISH = {
        patchMp4Fish: patchMp4Fish
    };
})();
