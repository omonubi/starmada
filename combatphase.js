(() => {
    'use strict';

    const SCRIPT_NAME = 'combatphase';

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

    const clearTargeting = (charId, prefix, hexNum) => {
        setCharAttr(charId, `${prefix}weapon_target_state_${hexNum}`, '');
        setCharAttr(charId, `${prefix}weapon_target_token_id_${hexNum}`, '');
        setCharAttr(charId, `${prefix}weapon_target_range_${hexNum}`, '');
        setCharAttr(charId, `${prefix}weapon_target_label_${hexNum}`, '');
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
            '&nbsp;&nbsp;On failure a chat message is posted and the targeting slot is cleared.',
            '<hr>',
            '<b>!cphelp</b>',
            '&nbsp;&nbsp;Show this help text.',
        ];
        sendChat(SCRIPT_NAME, `${target}<div style="font-size:0.9em;line-height:1.6">${lines.join('<br>')}</div>`, null, { noarchive: true });
    };

    on('chat:message', (msg) => {
        if (msg.type !== 'api') return;
        const content = (msg.content || '').trim();

        if (content === '!cphelp' || content.startsWith('!cphelp ')) {
            showHelp(msg);
            return;
        }

        if (!content.startsWith('!cprange')) return;

        const parts = content.split(/\s+/);
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

        const label = `${tgtName} (${range}h)`;
        setCharAttr(charId, `${prefix}weapon_target_token_id_${hexNum}`, tgtTokenId);
        setCharAttr(charId, `${prefix}weapon_target_range_${hexNum}`, String(range));
        setCharAttr(charId, `${prefix}weapon_target_label_${hexNum}`, label);
        setCharAttr(charId, `${prefix}weapon_target_state_${hexNum}`, '1');

        sendTargetingRoll(shipName, weaponLabel, hexNum, tgtName, range, arcText);
    });

    on('ready', () => {
        log(`${SCRIPT_NAME}: ready`);
    });

})();

