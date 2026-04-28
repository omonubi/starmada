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
    on('chat:message', (msg) => {
        if (msg.type !== 'api') return;
        const content = (msg.content || '').trim();
        if (!content.startsWith('!cprange')) return;

        const parts = content.split(/\s+/);
        if (parts.length < 6) {
            log(`${SCRIPT_NAME}: !cprange — expected 5 args, got ${parts.length - 1}`);
            return;
        }

        const [, charId, rowId, hexNum, srcTokenId, tgtTokenId] = parts;

        const srcToken = getObj('graphic', srcTokenId);
        const tgtToken = getObj('graphic', tgtTokenId);

        if (!srcToken || !tgtToken) {
            log(`${SCRIPT_NAME}: !cprange — could not resolve token(s): src=${srcTokenId} tgt=${tgtTokenId}`);
            setCharAttr(charId, `repeating_weapons_${rowId}_weapon_target_state_${hexNum}`, '');
            return;
        }

        if (srcToken.get('pageid') !== tgtToken.get('pageid')) {
            log(`${SCRIPT_NAME}: !cprange — tokens are on different pages`);
            setCharAttr(charId, `repeating_weapons_${rowId}_weapon_target_state_${hexNum}`, '');
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
        const label     = `${tgtName} (${range}h)`;

        const prefix = `repeating_weapons_${rowId}_`;
        setCharAttr(charId, `${prefix}weapon_target_token_id_${hexNum}`, tgtTokenId);
        setCharAttr(charId, `${prefix}weapon_target_range_${hexNum}`,    String(range));
        setCharAttr(charId, `${prefix}weapon_target_label_${hexNum}`,    label);
        setCharAttr(charId, `${prefix}weapon_target_state_${hexNum}`,    '1');
    });

    on('ready', () => {
        log(`${SCRIPT_NAME}: ready`);
    });

})();

