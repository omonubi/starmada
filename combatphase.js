(() => {
    'use strict';

    const SCRIPT_NAME = 'combatphase';
    const TARGET_LINE_WIDTH  = 2;
    const TARGET_PATH_OFFSET = 4;
    const GRADIENT_SEGMENTS  = 12;
    const GRADIENT_START     = [255, 224,   0]; // #ffe000 — yellow (source end)
    const GRADIENT_MID       = [232, 160,   0]; // #e8a000 — orange (midpoint)
    const GRADIENT_END       = [204,   0,   0]; // #cc0000 — red   (target end)

    const gradientColor = (t) => {
        const [c1, c2, lt] = t < 0.5
            ? [GRADIENT_START, GRADIENT_MID, t * 2]
            : [GRADIENT_MID,   GRADIENT_END, (t - 0.5) * 2];
        const r = Math.round(c1[0] + (c2[0] - c1[0]) * lt);
        const g = Math.round(c1[1] + (c2[1] - c1[1]) * lt);
        const b = Math.round(c1[2] + (c2[2] - c1[2]) * lt);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    };

    // ---------------------------------------------------------------------------
    // Utility: get or create a character attribute and set its current value
    // ---------------------------------------------------------------------------
    const setCharAttr = (charId, attrName, value) => {
        const existing = findObjs({ _type: 'attribute', characterid: charId, name: attrName })[0];
        if (existing) {
            existing.set('current', String(value));
        } else {
            createObj('attribute', { characterid: charId, name: attrName, current: String(value) });
        }
    };

    const getCharAttr = (charId, attrName) => {
        const existing = findObjs({ _type: 'attribute', characterid: charId, name: attrName })[0];
        return (existing && existing.get('current')) || '';
    };

    const parseLongRangeMax = (longRangeBand) => {
        const text = String(longRangeBand || '').trim();
        const bandMatch = text.match(/^(\d+)\s*-\s*(\d+)$/);
        if (bandMatch) return parseInt(bandMatch[2], 10);
        const singleMatch = text.match(/^(\d+)$/);
        if (singleMatch) return parseInt(singleMatch[1], 10);
        return null;
    };

    // clearTargeting reads the previous target before clearing so updateTargetDisplay
    // (defined later) can decrement the shared line/label for that token.
    const clearTargeting = (charId, prefix, hexNum) => {
        const prevTgtTokenId = String(getCharAttr(charId, `${prefix}weapon_target_token_id_${hexNum}`) || '').trim();
        setCharAttr(charId, `${prefix}weapon_target_state_${hexNum}`, '');
        setCharAttr(charId, `${prefix}weapon_target_token_id_${hexNum}`, '');
        setCharAttr(charId, `${prefix}weapon_target_range_${hexNum}`, '');
        setCharAttr(charId, `${prefix}weapon_target_label_${hexNum}`, '');
        if (prevTgtTokenId) {
            updateTargetDisplay(charId, prevTgtTokenId, null);
        }
    };

    // Draws a gradient line as GRADIENT_SEGMENTS short coloured segments.
    // Returns a comma-separated string of path IDs for later cleanup.
    const drawTargetLine = (pageId, srcLeft, srcTop, tgtLeft, tgtTop) => {
        const x1 = Number(srcLeft);
        const y1 = Number(srcTop);
        const x2 = Number(tgtLeft);
        const y2 = Number(tgtTop);
        if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
            return '';
        }

        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const offX = (-dy / len) * TARGET_PATH_OFFSET;
        const offY = (dx / len) * TARGET_PATH_OFFSET;

        const ids = [];
        const N = GRADIENT_SEGMENTS;
        for (let i = 0; i < N; i++) {
            const t0 = i / N;
            const t1 = (i + 1) / N;
            const sx1 = x1 + dx * t0 + offX;
            const sy1 = y1 + dy * t0 + offY;
            const sx2 = x1 + dx * t1 + offX;
            const sy2 = y1 + dy * t1 + offY;

            const minX = Math.min(sx1, sx2);
            const minY = Math.min(sy1, sy2);
            const w = Math.max(Math.abs(sx2 - sx1), 1);
            const h = Math.max(Math.abs(sy2 - sy1), 1);
            const color = gradientColor((i + 0.5) / N);
            const pathData = JSON.stringify([
                ['M', sx1 - minX, sy1 - minY],
                ['L', sx2 - minX, sy2 - minY]
            ]);

            const pathObj = createObj('path', {
                pageid: pageId,
                layer: 'map',
                left: minX + w / 2,
                top: minY + h / 2,
                width: w,
                height: h,
                stroke: color,
                stroke_width: TARGET_LINE_WIDTH,
                fill: 'transparent',
                path: pathData
            });

            if (pathObj) {
                pathObj.set('stroke_width', TARGET_LINE_WIDTH);
                toBack(pathObj);
                ids.push(pathObj.id);
            }
        }

        return ids.join(',');
    };

    // ---------------------------------------------------------------------------
    // Shared targeting display — one gradient line + one count label per unique
    // (character, target token) pair, shared across all weapon slots.
    //
    // Character-level attributes (not in any repeating row):
    //   cp_tgt_line_<tgtTokenId>  — comma-separated path IDs for line segments
    //   cp_tgt_label_<tgtTokenId> — text object ID for the "(N)" count label
    // ---------------------------------------------------------------------------
    const countWeaponsTargetingToken = (charId, tgtTokenId) => {
        return findObjs({ _type: 'attribute', characterid: charId })
            .filter(a => {
                const m = a.get('name').match(/^repeating_weapons_(.+?)_weapon_target_token_id_(\d+)$/);
                if (!m) return false;
                if (a.get('current') !== tgtTokenId) return false;
                const stateAttr = `repeating_weapons_${m[1]}_weapon_target_state_${m[2]}`;
                return String(getCharAttr(charId, stateAttr) || '') === '1';
            }).length;
    };

    const removeSharedDisplay = (charId, tgtTokenId) => {
        const lineAttr  = `cp_tgt_line_${tgtTokenId}`;
        const labelAttr = `cp_tgt_label_${tgtTokenId}`;
        String(getCharAttr(charId, lineAttr) || '').trim().split(',').forEach(id => {
            const p = id.trim();
            if (p) { const obj = getObj('path', p); if (obj) obj.remove(); }
        });
        setCharAttr(charId, lineAttr, '');
        const labelId = String(getCharAttr(charId, labelAttr) || '').trim();
        if (labelId) { const obj = getObj('text', labelId); if (obj) obj.remove(); }
        setCharAttr(charId, labelAttr, '');
    };

    const updateTargetDisplay = (charId, tgtTokenId, posData) => {
        if (!tgtTokenId) return;
        const count = countWeaponsTargetingToken(charId, tgtTokenId);
        if (count === 0) {
            removeSharedDisplay(charId, tgtTokenId);
            return;
        }
        const lineAttr  = `cp_tgt_line_${tgtTokenId}`;
        const labelAttr = `cp_tgt_label_${tgtTokenId}`;

        // Draw the gradient line the first time a token is targeted.
        if (!String(getCharAttr(charId, lineAttr) || '').trim() && posData) {
            const ids = drawTargetLine(posData.pageId, posData.srcLeft, posData.srcTop, posData.tgtLeft, posData.tgtTop);
            setCharAttr(charId, lineAttr, ids);
        }

        // Update the count label, creating it if it does not yet exist.
        const labelText = `(${count})`;
        const labelId   = String(getCharAttr(charId, labelAttr) || '').trim();
        const textObj   = labelId ? getObj('text', labelId) : null;
        if (textObj) {
            if (posData) {
                const midX = (posData.srcLeft + posData.tgtLeft) / 2;
                const midY = (posData.srcTop  + posData.tgtTop)  / 2;
                const dx   = posData.tgtLeft - posData.srcLeft;
                const dy   = posData.tgtTop  - posData.srcTop;
                const len  = Math.sqrt(dx * dx + dy * dy) || 1;
                const offX = (-dy / len) * TARGET_PATH_OFFSET;
                const offY = (dx / len) * TARGET_PATH_OFFSET;
                textObj.set({
                    text: labelText,
                    left: midX + offX + (-dy / len) * 22,
                    top:  midY + offY + ( dx / len) * 22
                });
            } else {
                textObj.set('text', labelText);
            }
        } else if (posData) {
            const midX = (posData.srcLeft + posData.tgtLeft) / 2;
            const midY = (posData.srcTop  + posData.tgtTop)  / 2;
            const dx   = posData.tgtLeft - posData.srcLeft;
            const dy   = posData.tgtTop  - posData.srcTop;
            const len  = Math.sqrt(dx * dx + dy * dy) || 1;
            const offX = (-dy / len) * TARGET_PATH_OFFSET;
            const offY = (dx / len) * TARGET_PATH_OFFSET;
            // Place label on the RIGHT side of source->target direction.
            const newText = createObj('text', {
                pageid:      posData.pageId,
                layer:       'map',
                left:        midX + offX + (-dy / len) * 22,
                top:         midY + offY + ( dx / len) * 22,
                width:       60,
                height:      30,
                text:        labelText,
                font_size:   18,
                color:       '#ffe000',
                font_family: 'Arial'
            });
            if (newText) setCharAttr(charId, labelAttr, newText.id);
        }
    };

    const syncTargetDisplayForSlot = (charId, rowId, hexNum, explicitTokenId) => {
        const prefix = `repeating_weapons_${rowId}_`;
        const tokenId = String(
            explicitTokenId || getCharAttr(charId, `${prefix}weapon_target_token_id_${hexNum}`) || ''
        ).trim();
        if (!tokenId) return;
        updateTargetDisplay(charId, tokenId, null);
    };

    const clearAllTargetDisplaysForCharacter = (charId) => {
        const attrs = findObjs({ _type: 'attribute', characterid: charId }) || [];
        attrs.forEach(attr => {
            const name = attr.get('name') || '';
            const lineMatch = name.match(/^cp_tgt_line_(.+)$/);
            if (lineMatch) {
                String(attr.get('current') || '').trim().split(',').forEach(id => {
                    const p = id.trim();
                    if (p) {
                        const obj = getObj('path', p);
                        if (obj) obj.remove();
                    }
                });
                attr.set('current', '');
                return;
            }

            if (/^cp_tgt_label_.+$/.test(name)) {
                const id = String(attr.get('current') || '').trim();
                if (id) {
                    const obj = getObj('text', id);
                    if (obj) obj.remove();
                }
                attr.set('current', '');
                return;
            }

            // Also clear sheet targeting state/data so affected weapons are reset.
            if (/^repeating_weapons_.+_weapon_target_state_\d+$/.test(name) ||
                /^repeating_weapons_.+_weapon_target_token_id_\d+$/.test(name) ||
                /^repeating_weapons_.+_weapon_target_range_\d+$/.test(name) ||
                /^repeating_weapons_.+_weapon_target_label_\d+$/.test(name)) {
                attr.set('current', '');
            }
        });
    };

    const clearAllTargetDisplays = (charIdOrAll) => {
        const mode = String(charIdOrAll || '').trim().toLowerCase();
        if (mode === 'all') {
            const chars = findObjs({ _type: 'character' }) || [];
            chars.forEach(c => clearAllTargetDisplaysForCharacter(c.id));
            return chars.length;
        }
        if (!charIdOrAll) return 0;
        clearAllTargetDisplaysForCharacter(charIdOrAll);
        return 1;
    };

    const templateSafe = (value) => String(value || '').replace(/[{}]/g, '');

    const sendTargetingRoll = (shipName, weaponLabel, hexNum, tgtName, range, arcText) => {
        const fields = [
            '{{subtitle=Targeting}}',
            '{{color=blue}}',
            `{{Weapon=${templateSafe(weaponLabel)} #${templateSafe(hexNum)}}}`,
            `{{Target=${templateSafe(tgtName)}}}`,
            `{{Range=${templateSafe(range)}h}}`
        ];

        if (arcText) {
            fields.push(`{{Arc=${templateSafe(arcText)}}}`);
        }

        sendChat(
            SCRIPT_NAME,
            `&{template:custom} {{title=${templateSafe(shipName || 'Ship')}}} ${fields.join(' ')}`
        );
    };

    const sendTargetingErrorRoll = (shipName, weaponLabel, hexNum, message) => {
        const fields = [
            '{{subtitle=Targeting}}',
            '{{color=gray}}',
            `{{Weapon=${templateSafe(weaponLabel)} #${templateSafe(hexNum)}}}`,
            `{{Error=${templateSafe(message)}}}`
        ];

        sendChat(
            SCRIPT_NAME,
            `&{template:custom} {{title=${templateSafe(shipName || 'Ship')}}} ${fields.join(' ')}`
        );
    };

    // ---------------------------------------------------------------------------
    // Hex-grid range calculation using cube coordinates.
    //
    // Both flat-top ('hex') and pointy-top ('hexv') Roll20 grid types are
    // supported.  hexPx is the center-to-center pixel distance between adjacent
    // hexes (= 70 × page.snapping_increment).
    //
    // The cube-coordinate rounding approach gives exact hex distances, avoiding
    // the Euclidean-rounding errors that appear at ranges ≥ 4 on diagonal paths.
    // ---------------------------------------------------------------------------
    const hexRange = (srcLeft, srcTop, tgtLeft, tgtTop, hexPx, gridType) => {
        const dx = tgtLeft - srcLeft;
        const dy = tgtTop - srcTop;
        if (!dx && !dy) return 0;

        // Circumradius s: for any regular hex, center-to-center = s * sqrt(3)
        const s = hexPx / Math.sqrt(3);

        let q, r;
        // Roll20 page grid_type values:
        //   hex  = Hex(V) = pointy-top
        //   hexr = Hex(H) = flat-top
        // Keep legacy "hexv" support as an alias for pointy-top.
        const isPointy = gridType === 'hex' || gridType === 'hexv';
        if (isPointy) {
            // Pointy-top (vertical) hex grid
            q = (Math.sqrt(3) / 3 * dx - 1 / 3 * dy) / s;
            r = (2 / 3 * dy) / s;
        } else {
            // Flat-top (horizontal) hex grid — Roll20 grid_type 'hexr'
            q = (2 / 3 * dx) / s;
            r = (-1 / 3 * dx + Math.sqrt(3) / 3 * dy) / s;
        }

        // Round fractional cube coordinates to the nearest hex
        const sc = -q - r;
        let rq = Math.round(q), rr = Math.round(r), rs = Math.round(sc);
        const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - sc);
        if (dq > dr && dq > ds) rq = -rr - rs;
        else if (dr > ds) rr = -rq - rs;
        else rs = -rq - rr;

        return Math.max(Math.abs(rq), Math.abs(rr), Math.abs(rs));
    };

    // ---------------------------------------------------------------------------
    // Component firing-arc calculation.
    //
    // All angles are in the ship's LOCAL reference frame: 0° = directly ahead
    // (the ship's facing direction), increasing clockwise.
    //
    // A-F group — bounded by hex-row lines; boundaries every 60° from 0°:
    //   A: [300°, 360°)   B: [  0°,  60°)
    //   C: [240°, 300°)   D: [ 60°, 120°)
    //   E: [180°, 240°)   F: [120°, 180°)
    //
    // G-L group — bounded by hex-spine lines; boundaries every 60° from 30°:
    //   G: [330°,  30°)   H: [270°, 330°)
    //   I: [ 30°,  90°)   J: [210°, 270°)
    //   K: [ 90°, 150°)   L: [150°, 210°)
    //
    // Verification: relative bearing 0° (directly ahead) → {A, B, G} ✓
    // A target on an arc boundary occupies both adjacent arcs.
    // ---------------------------------------------------------------------------
    const ARC_EPS = 0.5; // degrees — tolerance for arc-boundary proximity

    const getTargetArcs = (relativeBearing) => {
        const b = ((relativeBearing % 360) + 360) % 360;
        const arcs = new Set();

        // A-F group: sector boundaries at multiples of 60° starting at 0°.
        // Sector index 0 (0°–60°) = B, 1 = D, 2 = F, 3 = E, 4 = C, 5 = A.
        const afSectors = ['B', 'D', 'F', 'E', 'C', 'A'];
        const afIdx  = Math.floor(b / 60) % 6;
        arcs.add(afSectors[afIdx]);
        const bMod60 = b % 60;
        if (bMod60 < ARC_EPS)            arcs.add(afSectors[(afIdx + 5) % 6]);
        else if (bMod60 > 60 - ARC_EPS)  arcs.add(afSectors[(afIdx + 1) % 6]);

        // G-L group: boundaries at 30° + multiples of 60°.
        // Shift bearing by -30° so the same modular logic applies.
        // Sector index 0 (shifted 0°–60° = original 30°–90°) = I, 1 = K, 2 = L,
        //   3 = J, 4 = H, 5 = G.
        const glSectors = ['I', 'K', 'L', 'J', 'H', 'G'];
        const shifted = ((b - 30) % 360 + 360) % 360;
        const glIdx  = Math.floor(shifted / 60) % 6;
        arcs.add(glSectors[glIdx]);
        const sMod60 = shifted % 60;
        if (sMod60 < ARC_EPS)            arcs.add(glSectors[(glIdx + 5) % 6]);
        else if (sMod60 > 60 - ARC_EPS)  arcs.add(glSectors[(glIdx + 1) % 6]);

        return arcs; // Set of uppercase letters, e.g. Set {'A','B','G'}
    };

    // ---------------------------------------------------------------------------
    // Help output — whispered to the caller (or GM) when !cphelp is used, or
    // when a command is called with missing arguments.  Keep this block updated
    // as new commands are added.
    // ---------------------------------------------------------------------------
    const showHelp = (msg) => {
        const isGM = msg.playerid && playerIsGM(msg.playerid);
        const target = isGM ? '/w gm ' : `/w "${msg.who}" `;
        const lines = [
            `<b>${SCRIPT_NAME} — command reference</b>`,
            '<hr>',
            '<b>!cprange</b> &lt;charId&gt; &lt;rowId&gt; &lt;hexNum&gt; &lt;srcTokenId&gt; &lt;tgtTokenId&gt;',
            '&nbsp;&nbsp;Called automatically by the sheet when a targeting button is clicked.',
            '&nbsp;&nbsp;Validates the target against the weapon\'s long-range band and firing arc,',
            '&nbsp;&nbsp;then writes the result back to the sheet.',
            '&nbsp;&nbsp;Range band: read from <i>weapon_range_3</i> (e.g. "7-9").',
            '&nbsp;&nbsp;Firing arc: read from <i>weapon_arc_N</i> (e.g. "AB", "JKL") — skipped if blank.',
            '&nbsp;&nbsp;On success, a targeting line is drawn on the map layer under tokens.',
            '&nbsp;&nbsp;On failure a chat message is posted and the targeting slot is cleared.',
            '<hr>',
            '<b>!cpclearpaths</b> &lt;charId|all&gt;',
            '&nbsp;&nbsp;Clears all drawn targeting lines/labels and resets weapon target states/data.',
            '<hr>',
            '<b>!cphelp</b>',
            '&nbsp;&nbsp;Show this help text.',
        ];
        sendChat(SCRIPT_NAME, `${target}<div style="font-size:0.9em;line-height:1.6">${lines.join('<br>')}</div>`, null, { noarchive: true });
    };

    on('chat:message', (msg) => {
        if (msg.type !== 'api') return;
        const content = (msg.content || '').trim();
        const parts = content.split(/\s+/);
        const command = parts[0] || '';

        if (command === '!cphelp') {
            showHelp(msg);
            return;
        }

        if (command === '!cptargetsync') {
            if (parts.length < 4) {
                log(`${SCRIPT_NAME}: !cptargetsync — expected at least 3 args, got ${parts.length - 1}`);
                return;
            }
            const [, charId, rowId, hexNum, explicitTokenId] = parts;
            syncTargetDisplayForSlot(charId, rowId, hexNum, explicitTokenId || '');
            return;
        }

        if (command === '!cpclearpaths') {
            if (parts.length < 2) {
                showHelp(msg);
                return;
            }
            const [, target] = parts;
            const clearedCount = clearAllTargetDisplays(target);
            sendChat(SCRIPT_NAME, `/w gm cleared targeting paths and reset target states for ${clearedCount} character(s).`, null, { noarchive: true });
            return;
        }

        if (command !== '!cprange') return;

        if (parts.length < 6) {
            log(`${SCRIPT_NAME}: !cprange — expected 5 args, got ${parts.length - 1}`);
            showHelp(msg);
            return;
        }

        const [, charId, rowId, hexNum, srcTokenId, tgtTokenId] = parts;
        const prefix = `repeating_weapons_${rowId}_`;

        const srcToken = getObj('graphic', srcTokenId);
        const tgtToken = getObj('graphic', tgtTokenId);

        if (!srcToken || !tgtToken) {
            log(`${SCRIPT_NAME}: !cprange — could not resolve token(s): src=${srcTokenId} tgt=${tgtTokenId}`);
            clearTargeting(charId, prefix, hexNum);
            return;
        }

        if (srcToken.get('pageid') !== tgtToken.get('pageid')) {
            log(`${SCRIPT_NAME}: !cprange — tokens are on different pages`);
            clearTargeting(charId, prefix, hexNum);
            return;
        }

        const page      = getObj('page', srcToken.get('pageid'));
        const snapInc   = parseFloat((page && page.get('snapping_increment')) || 1);
        const hexPx     = 70 * snapInc;
        const gridType  = (page && page.get('grid_type')) || 'hex';

        const srcLeft   = parseFloat(srcToken.get('left'));
        const srcTop    = parseFloat(srcToken.get('top'));
        const tgtLeft   = parseFloat(tgtToken.get('left'));
        const tgtTop    = parseFloat(tgtToken.get('top'));

        const range     = hexRange(srcLeft, srcTop, tgtLeft, tgtTop, hexPx, gridType);
        const tgtName   = tgtToken.get('name') || 'Unknown';

        const weaponAbbr = (getCharAttr(charId, `${prefix}weapon_abbr`) || 'weapon').trim();
        const weaponVariant = String(getCharAttr(charId, `${prefix}weapon_variant`) || '').trim();
        const weaponLabel = weaponVariant ? `${weaponAbbr}-${weaponVariant}` : weaponAbbr;
        const longRangeBand = String(getCharAttr(charId, `${prefix}weapon_range_3`) || '').trim();
        const maxLongRange = parseLongRangeMax(longRangeBand);

        const charObj = getObj('character', charId);
        const shipName = (srcToken.get('name') || (charObj && charObj.get('name')) || 'Ship').trim();

        if (!Number.isInteger(maxLongRange)) {
            clearTargeting(charId, prefix, hexNum);
            sendTargetingErrorRoll(shipName, weaponLabel, hexNum, 'Targeting failed. Long-range band is missing or invalid.');
            return;
        }

        if (range > maxLongRange) {
            clearTargeting(charId, prefix, hexNum);
            sendTargetingErrorRoll(
                shipName,
                weaponLabel,
                hexNum,
                `Targeting failed. ${tgtName} is at ${range}h, beyond long range ${longRangeBand}.`
            );
            return;
        }

        // --- Firing arc check ---
        // weapon_arc_N holds the user-entered arc designation, e.g. "AB" or "JKL".
        // If no arc is defined for this hex slot, the check is skipped.
        const arcText = getCharAttr(charId, `${prefix}weapon_arc_${hexNum}`)
            .toUpperCase().replace(/[^A-L]/g, '');
        if (arcText.length > 0) {
            const weaponArcSet  = new Set(arcText.split(''));
            const shipHeading   = parseFloat(srcToken.get('rotation') || 0);
            const dx            = tgtLeft - srcLeft;
            const dy            = tgtTop  - srcTop;
            const absBearing    = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
            const relBearing    = (absBearing - shipHeading + 360) % 360;
            const targetArcs    = getTargetArcs(relBearing);
            const inArc         = [...targetArcs].some(arc => weaponArcSet.has(arc));
            if (!inArc) {
                clearTargeting(charId, prefix, hexNum);
                const weaponArcStr = [...weaponArcSet].sort().join('');
                const targetArcStr = [...targetArcs].sort().join('');
                sendTargetingErrorRoll(
                    shipName,
                    weaponLabel,
                    hexNum,
                    `Targeting failed. ${tgtName} is in arc(s) [${targetArcStr}], outside weapon arc [${weaponArcStr}].`
                );
                return;
            }
        }

        // Capture any token this slot was already targeting before overwriting it.
        const prevSlotTarget = String(getCharAttr(charId, `${prefix}weapon_target_token_id_${hexNum}`) || '').trim();

        const label = `${tgtName} (${range}h)`;
        setCharAttr(charId, `${prefix}weapon_target_token_id_${hexNum}`, tgtTokenId);
        setCharAttr(charId, `${prefix}weapon_target_range_${hexNum}`, String(range));
        setCharAttr(charId, `${prefix}weapon_target_label_${hexNum}`, label);
        setCharAttr(charId, `${prefix}weapon_target_state_${hexNum}`, '1');

        // If this slot was pointing at a different token, decrement that token's display.
        if (prevSlotTarget && prevSlotTarget !== tgtTokenId) {
            updateTargetDisplay(charId, prevSlotTarget, null);
        }
        const posData = { pageId: srcToken.get('pageid'), srcLeft, srcTop, tgtLeft, tgtTop };
        updateTargetDisplay(charId, tgtTokenId, posData);

        sendTargetingRoll(shipName, weaponLabel, hexNum, tgtName, range, arcText);
    });

    on('ready', () => {
        log(`${SCRIPT_NAME}: ready`);
    });

})();

