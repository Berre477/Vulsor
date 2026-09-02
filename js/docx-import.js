// ── .docx import (Word / Google Docs export) ──────────────────────────
// Converts a .docx file into the Vault doc editor's HTML format.
// Self-contained: a minimal ZIP reader (zlib) + an OOXML → HTML walker.
// No external libraries or network access required.
// Depends on: globals.js (fs, path, VAULT_DIR), vault.js (vaultData,
// saveVaultData, renderVaultFolders, renderVaultGrid, openVaultFile).

// ── Minimal ZIP reader ────────────────────────────────────────────────
// A .docx is a ZIP archive. Reads the central directory and inflates each
// entry (store / deflate). Returns Map<filename, Buffer>.
function vdxUnzip(buf) {
    const zlib = require('zlib');
    const map = new Map();

    // Locate the End Of Central Directory record (scan back from the end).
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a .docx file (no zip directory)');

    const count    = buf.readUInt16LE(eocd + 10);
    let p          = buf.readUInt32LE(eocd + 16); // central directory offset

    for (let n = 0; n < count; n++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) break; // not a central dir entry
        const method     = buf.readUInt16LE(p + 10);
        const compSize   = buf.readUInt32LE(p + 20);
        const nameLen    = buf.readUInt16LE(p + 28);
        const extraLen   = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const localOff   = buf.readUInt32LE(p + 42);
        const name       = buf.toString('utf8', p + 46, p + 46 + nameLen);

        // Jump to the local header to find where the data actually starts.
        const lhNameLen  = buf.readUInt16LE(localOff + 26);
        const lhExtraLen = buf.readUInt16LE(localOff + 28);
        const dataStart  = localOff + 30 + lhNameLen + lhExtraLen;
        const comp       = buf.subarray(dataStart, dataStart + compSize);

        let data = null;
        if (method === 0)      data = comp;                       // stored
        else if (method === 8) data = zlib.inflateRawSync(comp);  // deflate
        if (data) map.set(name, data);

        p += 46 + nameLen + extraLen + commentLen;
    }
    return map;
}

// ── Small OOXML helpers ───────────────────────────────────────────────
function _vdxEsc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function _vdxFirst(el, name) {
    if (!el) return null;
    for (const c of el.children) if (c.tagName === name) return c;
    return null;
}
// Word boolean toggles: present unless explicitly val="0/false/off".
function _vdxBool(el, name) {
    const c = _vdxFirst(el, name);
    if (!c) return false;
    const v = c.getAttribute('w:val');
    return !(v === '0' || v === 'false' || v === 'off');
}

// relationship id → target (hyperlink urls, image paths)
function _vdxRels(entries) {
    const map = {};
    const buf = entries.get('word/_rels/document.xml.rels');
    if (!buf) return map;
    try {
        const d = new DOMParser().parseFromString(buf.toString('utf8'), 'application/xml');
        Array.from(d.getElementsByTagName('Relationship')).forEach(r => {
            map[r.getAttribute('Id')] = r.getAttribute('Target');
        });
    } catch (_) {}
    return map;
}

// numId + level → list format ('bullet' vs 'decimal'/etc.) via numbering.xml
function _vdxBuildNumFmt(entries) {
    const map = {};
    const buf = entries.get('word/numbering.xml');
    if (!buf) return map;
    try {
        const d = new DOMParser().parseFromString(buf.toString('utf8'), 'application/xml');
        const abstract = {};
        Array.from(d.getElementsByTagName('w:abstractNum')).forEach(an => {
            const aid = an.getAttribute('w:abstractNumId');
            const lvls = {};
            Array.from(an.getElementsByTagName('w:lvl')).forEach(lvl => {
                const il  = lvl.getAttribute('w:ilvl');
                const fmt = lvl.getElementsByTagName('w:numFmt')[0];
                lvls[il]  = fmt ? fmt.getAttribute('w:val') : 'decimal';
            });
            abstract[aid] = lvls;
        });
        Array.from(d.getElementsByTagName('w:num')).forEach(n => {
            const numId = n.getAttribute('w:numId');
            const aref  = n.getElementsByTagName('w:abstractNumId')[0];
            map[numId]  = abstract[aref ? aref.getAttribute('w:val') : ''] || {};
        });
    } catch (_) {}
    return map;
}

// ── Inline runs ───────────────────────────────────────────────────────
function _vdxImage(drawing, ctx) {
    try {
        const blip = drawing.getElementsByTagName('a:blip')[0];
        if (!blip) return '';
        const rid = blip.getAttribute('r:embed') || blip.getAttribute('r:link');
        const target = rid && ctx.rels[rid];
        if (!target) return '';
        const clean = target.replace(/^\/+/, '');
        const data  = ctx.entries.get('word/' + clean) || ctx.entries.get(clean);
        if (!data) return '';
        const ext  = (target.split('.').pop() || 'png').toLowerCase();
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                   : ext === 'gif' ? 'image/gif'
                   : ext === 'svg' ? 'image/svg+xml'
                   : ext === 'bmp' ? 'image/bmp' : 'image/png';
        return `<img src="data:${mime};base64,${data.toString('base64')}" style="max-width:100%;height:auto;border-radius:4px;margin:6px 0;display:block" alt="image">`;
    } catch (_) { return ''; }
}

function _vdxRun(r, ctx) {
    const rPr = _vdxFirst(r, 'w:rPr');
    let text = '';
    for (const c of r.children) {
        const t = c.tagName;
        if      (t === 'w:t')       text += _vdxEsc(c.textContent);
        else if (t === 'w:br')      text += '<br>';
        else if (t === 'w:tab')     text += '&emsp;';
        else if (t === 'w:drawing') text += _vdxImage(c, ctx);
    }
    if (!text) return '';
    if (rPr) {
        const styles = [];
        const colorEl = _vdxFirst(rPr, 'w:color');
        const szEl    = _vdxFirst(rPr, 'w:sz');
        const uEl     = _vdxFirst(rPr, 'w:u');
        const vaEl    = _vdxFirst(rPr, 'w:vertAlign');
        if (colorEl) { const cv = colorEl.getAttribute('w:val'); if (cv && cv !== 'auto') styles.push('color:#' + cv); }
        if (szEl)    { const sv = parseInt(szEl.getAttribute('w:val') || '0', 10); if (sv) styles.push('font-size:' + (sv / 2) + 'pt'); }
        let pre = '', post = '';
        if (_vdxBool(rPr, 'w:b'))      { pre += '<strong>'; post = '</strong>' + post; }
        if (_vdxBool(rPr, 'w:i'))      { pre += '<em>';     post = '</em>'     + post; }
        if (uEl && uEl.getAttribute('w:val') !== 'none') { pre += '<u>'; post = '</u>' + post; }
        if (_vdxBool(rPr, 'w:strike')) { pre += '<s>';      post = '</s>'      + post; }
        if (vaEl) {
            const v = vaEl.getAttribute('w:val');
            if (v === 'superscript') { pre += '<sup>'; post = '</sup>' + post; }
            else if (v === 'subscript') { pre += '<sub>'; post = '</sub>' + post; }
        }
        text = pre + text + post;
        if (styles.length) text = `<span style="${styles.join(';')}">${text}</span>`;
    }
    return text;
}

function _vdxInline(parent, ctx) {
    let out = '';
    for (const node of parent.children) {
        const t = node.tagName;
        if (t === 'w:r') {
            out += _vdxRun(node, ctx);
        } else if (t === 'w:hyperlink') {
            const rid  = node.getAttribute('r:id');
            const href = rid && ctx.rels[rid];
            let inner = '';
            for (const c of node.children) if (c.tagName === 'w:r') inner += _vdxRun(c, ctx);
            out += href ? `<a href="${_vdxEsc(href)}" target="_blank" rel="noopener">${inner}</a>` : inner;
        }
    }
    return out;
}

// ── Block elements ────────────────────────────────────────────────────
function _vdxParagraph(p, ctx) {
    const pPr  = _vdxFirst(p, 'w:pPr');
    let inner  = _vdxInline(p, ctx);

    // Alignment
    let align = '';
    if (pPr) {
        const jc = _vdxFirst(pPr, 'w:jc');
        if (jc) {
            const v = jc.getAttribute('w:val');
            align = v === 'center' ? 'center' : v === 'right' ? 'right' : v === 'both' ? 'justify' : '';
        }
    }

    // List item?
    const numPr = pPr && _vdxFirst(pPr, 'w:numPr');
    if (numPr) {
        const numIdEl = _vdxFirst(numPr, 'w:numId');
        const ilvlEl  = _vdxFirst(numPr, 'w:ilvl');
        const numId   = numIdEl ? numIdEl.getAttribute('w:val') : null;
        const level   = ilvlEl ? parseInt(ilvlEl.getAttribute('w:val') || '0', 10) : 0;
        const fmt     = (ctx.numFmt[numId] && ctx.numFmt[numId][String(level)]) || 'decimal';
        return { kind: 'li', listKind: fmt === 'bullet' ? 'ul' : 'ol', level, html: inner || '<br>' };
    }

    // Heading via paragraph style?
    let tag = 'p';
    if (pPr) {
        const ps = _vdxFirst(pPr, 'w:pStyle');
        if (ps) {
            const v = (ps.getAttribute('w:val') || '').toLowerCase();
            if      (/^(heading1|title)$/.test(v))    tag = 'h1';
            else if (/^(heading2|subtitle)$/.test(v)) tag = 'h2';
            else if (/^heading3$/.test(v))            tag = 'h3';
            else if (/^heading[4-9]$/.test(v))        tag = 'h4';
        }
    }
    if (!inner) inner = '<br>';
    const style = align ? ` style="text-align:${align}"` : '';
    return { kind: 'block', html: `<${tag}${style}>${inner}</${tag}>` };
}

function _vdxTable(tbl, ctx) {
    let html = '<div style="overflow-x:auto;margin:0.8em 0"><table class="docs-table" style="margin:0"><tbody>';
    for (const row of tbl.children) {
        if (row.tagName !== 'w:tr') continue;
        html += '<tr>';
        for (const cell of row.children) {
            if (cell.tagName !== 'w:tc') continue;
            let cellHtml = '';
            for (const ch of cell.children) {
                if (ch.tagName === 'w:p') {
                    const blk = _vdxParagraph(ch, ctx);
                    cellHtml += blk.kind === 'li' ? `<div>${blk.html}</div>` : blk.html;
                }
            }
            html += `<td>${cellHtml || '<br>'}</td>`;
        }
        html += '</tr>';
    }
    return html + '</tbody></table></div>';
}

// Serialize blocks, grouping consecutive list items into <ul>/<ol>.
// Nested levels are shown via left margin (robust, avoids broken nesting).
function _vdxSerialize(blocks) {
    let html = '', curList = null;
    const close = () => { if (curList) { html += '</' + curList + '>'; curList = null; } };
    for (const b of blocks) {
        if (b.kind === 'li') {
            if (curList && curList !== b.listKind) close();
            if (!curList) { html += '<' + b.listKind + '>'; curList = b.listKind; }
            const indent = b.level > 0 ? ` style="margin-left:${b.level * 1.5}em"` : '';
            html += `<li${indent}>${b.html || '<br>'}</li>`;
        } else {
            close();
            html += b.html;
        }
    }
    close();
    return html;
}

// ── Public: docx Buffer → editor HTML ─────────────────────────────────
function vdxDocxToHtml(buffer) {
    const entries = vdxUnzip(buffer);
    const docBuf  = entries.get('word/document.xml');
    if (!docBuf) throw new Error('Not a valid .docx (missing document.xml)');

    const ctx = { entries, rels: _vdxRels(entries), numFmt: _vdxBuildNumFmt(entries) };
    const doc  = new DOMParser().parseFromString(docBuf.toString('utf8'), 'application/xml');
    const body = doc.getElementsByTagName('w:body')[0];
    if (!body) throw new Error('Document body not found');

    const blocks = [];
    for (const el of body.children) {
        if      (el.tagName === 'w:p')   blocks.push(_vdxParagraph(el, ctx));
        else if (el.tagName === 'w:tbl') blocks.push({ kind: 'block', html: _vdxTable(el, ctx) });
    }
    return _vdxSerialize(blocks) || '<p><br></p>';
}

// ── Public: import .docx files into the Vault as editable docs ─────────
function vaultImportDocxFiles(filePaths, targetFolderId) {
    if (targetFolderId === undefined) targetFolderId = vaultActiveFolderId;
    let imported = 0, lastId = null;
    const errors = [];
    filePaths.forEach(src => {
        try {
            const html = vdxDocxToHtml(fs.readFileSync(src)) || '<p><br></p>';
            const id   = 'vf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            const storedName = id + '.vulsor';
            fs.writeFileSync(path.join(VAULT_DIR, storedName), html);
            const name = path.basename(src).replace(/\.docx$/i, '') || 'Imported Document';
            vaultData.files.unshift({
                id, originalName: name, storedName,
                folderId: targetFolderId,
                notes: '', pageNotes: {}, addedAt: Date.now(),
                size: Buffer.byteLength(html, 'utf8'), isDoc: true,
            });
            imported++; lastId = id;
        } catch (e) {
            console.error('docx import failed:', src, e);
            errors.push(path.basename(src) + ' — ' + e.message);
        }
    });
    if (imported) {
        saveVaultData();
        renderVaultFolders();
        renderVaultGrid();
        if (lastId) openVaultFile(lastId);
    }
    if (errors.length) alert('Could not import:\n' + errors.join('\n'));
    return imported;
}
