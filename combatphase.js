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
    // !cprange — called by the sheet worker when a targeting button is first
    // clicked on a weapon hex.
    //
    // Format:  !cprange <charId> <rowId> <hexNum> <srcTokenId> <tgtTokenId>
    //
    // The script:
    //   1. Resolves both tokens and verifies they are on the same page.
    //   2. Calculates the hex-grid range between the two token centers.
    //   3. Writes weapon_target_token_id_N, weapon_target_range_N,
    //      weapon_target_label_N, and weapon_target_state_N back to the
    //      character sheet so the targeting button updates immediately.
    // ---------------------------------------------------------------------------
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
            '&nbsp;&nbsp;Calculates hex-grid range between two tokens, validates against the',
            `&nbsp;&nbsp;weapon's long-range band, and writes the result back to the sheet.`,
            '&nbsp;&nbsp;On failure a chat message is posted and the slot is cleared.',
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

        const weaponLabel = (getCharAttr(charId, `${prefix}weapon_abbr`) || 'weapon').trim();
        const longRangeBand = String(getCharAttr(charId, `${prefix}weapon_range_3`) || '').trim();
        const maxLongRange = parseLongRangeMax(longRangeBand);

        if (!Number.isInteger(maxLongRange)) {
            clearTargeting(charId, prefix, hexNum);
            sendChat(
                SCRIPT_NAME,
                `${weaponLabel} #${hexNum}: targeting failed. Long-range band is missing or invalid.`
            );
            return;
        }

        if (range > maxLongRange) {
            clearTargeting(charId, prefix, hexNum);
            sendChat(
                SCRIPT_NAME,
                `${weaponLabel} #${hexNum}: targeting failed. ${tgtName} is at ${range}h, beyond long range ${longRangeBand}.`
            );
            return;
        }

        const label = `${tgtName} (${range}h)`;
        setCharAttr(charId, `${prefix}weapon_target_token_id_${hexNum}`, tgtTokenId);
        setCharAttr(charId, `${prefix}weapon_target_range_${hexNum}`, String(range));
        setCharAttr(charId, `${prefix}weapon_target_label_${hexNum}`, label);
        setCharAttr(charId, `${prefix}weapon_target_state_${hexNum}`, '1');
    });

    on('ready', () => {
        log(`${SCRIPT_NAME}: ready`);
    });

})();

