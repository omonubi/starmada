(() => {
	'use strict';

	const SCRIPT_NAME = 'hexmove';
	const COMMAND = '!hexmove';
	const SUPPORTED_GRID_TYPES = ['hex', 'hexr'];
	const TRAIL_LAYER = 'objects';
	const TRAIL_STROKE = '#ffff00';
	const TRAIL_STROKE_WIDTH = 4;
	const TRAIL_LABEL_COLOR = '#ffff00';
	const TRAIL_LABEL_FONT_SIZE = 16;
	const ORIENTATION_MARKER_SIZE = 8;

	const sanitizeWho = (who) => (who || '').replace(/\s*\(GM\)\s*$/i, '').trim();

	const getWhisperTarget = (msg) => {
		if (msg && msg.playerid) {
			const player = getObj('player', msg.playerid);
			if (player) {
				const displayName = (player.get('_displayname') || '').trim();
				if (displayName) return displayName;
			}
		}

		const cleanWho = sanitizeWho(msg && msg.who);
		return cleanWho || 'gm';
	};

	const send = (msg, message) => {
		const target = getWhisperTarget(msg);
		sendChat(SCRIPT_NAME, `/w "${target}" ${message}`);
	};

	const getTrailState = () => {
		state[SCRIPT_NAME] = state[SCRIPT_NAME] || {};
		if (!state[SCRIPT_NAME].trailState) {
			state[SCRIPT_NAME].trailState = {
				activePathId: null,
				activeTokenId: null,
				activeLabelId: null,
				activeMarkerIds: []
			};
		}
		return state[SCRIPT_NAME].trailState;
	};

	const clearActiveTrail = () => {
		const trailState = getTrailState();
		if (!trailState.activePathId) return;

		const priorPath = getObj('path', trailState.activePathId);
		if (priorPath) {
			priorPath.remove();
		}

		const priorLabel = getObj('text', trailState.activeLabelId);
		if (priorLabel) {
			priorLabel.remove();
		}

		const markerIds = trailState.activeMarkerIds || [];
		for (let i = 0; i < markerIds.length; i++) {
			const marker = getObj('path', markerIds[i]);
			if (marker) {
				marker.remove();
			}
		}

		trailState.activePathId = null;
		trailState.activeTokenId = null;
		trailState.activeLabelId = null;
		trailState.activeMarkerIds = [];
	};

	const createTrailForToken = (token, points) => {
		if (!token || !points || points.length < 2) {
			return null;
		}

		const pageId = token.get('_pageid');
		if (!pageId) {
			return null;
		}

		const xs = points.map(p => Number(p.left) || 0);
		const ys = points.map(p => Number(p.top) || 0);
		const padding = 1;
		const minX = Math.min.apply(null, xs) - padding;
		const maxX = Math.max.apply(null, xs) + padding;
		const minY = Math.min.apply(null, ys) - padding;
		const maxY = Math.max.apply(null, ys) + padding;

		const width = Math.max(1, Math.round(maxX - minX));
		const height = Math.max(1, Math.round(maxY - minY));
		const left = Math.round(minX + width / 2);
		const top = Math.round(minY + height / 2);

		const pathData = points.map((point, index) => [
			index === 0 ? 'M' : 'L',
			Math.round((Number(point.left) || 0) - minX),
			Math.round((Number(point.top) || 0) - minY)
		]);

		return createObj('path', {
			pageid: pageId,
			layer: TRAIL_LAYER,
			stroke: TRAIL_STROKE,
			stroke_width: TRAIL_STROKE_WIDTH,
			fill: 'transparent',
			width,
			height,
			top,
			left,
			path: JSON.stringify(pathData)
		});
	};

	const createTrailLabelForToken = (token, points) => {
		if (!token || !points || !points.length) {
			return null;
		}

		const pageId = token.get('_pageid');
		if (!pageId) {
			return null;
		}

		const startPoint = points[0];
		const tokenName = (token.get('name') || '').trim() || 'Unnamed Token';

		return createObj('text', {
			pageid: pageId,
			layer: TRAIL_LAYER,
			left: Math.round((Number(startPoint.left) || 0) + 10),
			top: Math.round((Number(startPoint.top) || 0) - 18),
			text: tokenName,
			color: TRAIL_LABEL_COLOR,
			font_size: TRAIL_LABEL_FONT_SIZE
		});
	};

	const normalizeRotation = (rotation) => {
		let value = Number(rotation) || 0;
		value %= 360;
		if (value < 0) value += 360;
		return value;
	};

	const pushOrientationMarkerPoint = (markerPoints, token) => {
		if (!markerPoints || !token) return;

		const point = {
			left: Number(token.get('left')) || 0,
			top: Number(token.get('top')) || 0,
			rotation: normalizeRotation(token.get('rotation'))
		};

		const previous = markerPoints.length ? markerPoints[markerPoints.length - 1] : null;
		if (
			previous &&
			previous.left === point.left &&
			previous.top === point.top &&
			previous.rotation === point.rotation
		) {
			return;
		}

		markerPoints.push(point);
	};

	const createOrientationMarker = (token, markerPoint) => {
		if (!token || !markerPoint) return null;
		const pageId = token.get('_pageid');
		if (!pageId) return null;

		const size = ORIENTATION_MARKER_SIZE;
		const width = size * 2;
		const height = size * 2;
		const trianglePath = [
			['M', size, 0],
			['L', 0, height],
			['L', width, height],
			['L', size, 0]
		];

		return createObj('path', {
			pageid: pageId,
			layer: TRAIL_LAYER,
			stroke: TRAIL_STROKE,
			stroke_width: 2,
			fill: TRAIL_STROKE,
			width,
			height,
			left: markerPoint.left,
			top: markerPoint.top,
			rotation: markerPoint.rotation,
			path: JSON.stringify(trianglePath)
		});
	};

	const createOrientationMarkersForToken = (token, markerPoints) => {
		const markers = [];
		if (!token || !markerPoints || !markerPoints.length) return markers;

		for (let i = 0; i < markerPoints.length; i++) {
			const marker = createOrientationMarker(token, markerPoints[i]);
			if (marker) markers.push(marker);
		}

		return markers;
	};

	const parseCommand = (content) => {
		const parts = (content || '').trim().split(/\s+/);
		const command = parts.shift() || '';
		return {
			command,
			tokenId: (parts.shift() || '').trim(),
			args: parts
		};
	};

	const parseActionSequence = (args) => {
		const actions = [];
		const patterns = [];

		for (let i = 0; i < args.length; i++) {
			const arg = (args[i] || '').trim();
			let charIndex = 0;

			while (charIndex < arg.length) {
				const char = arg[charIndex].toLowerCase();

				if (char === '(') {
					// Skip the entire "(x)" parameter
					while (charIndex < arg.length && arg[charIndex] !== ')') {
						charIndex += 1;
					}
					if (charIndex < arg.length) charIndex += 1; // skip the closing ')'
					continue;
				}

				if (/\d/.test(char)) {
					let digitStr = '';
					while (charIndex < arg.length && /\d/.test(arg[charIndex])) {
						digitStr += arg[charIndex];
						charIndex += 1;
					}
					patterns.push(digitStr);
					continue;
				}

				if (char === 'p' || char === 's') {
					patterns.push(char);
					charIndex += 1;
					continue;
				}

				// Skip any other unknown characters
				charIndex += 1;
			}
		}

		let index = 0;
		while (index < patterns.length) {
			const rawArg = (patterns[index] || '').toLowerCase();

			if (/^\d+$/.test(rawArg)) {
				actions.push({
					action: 'forward',
					rawAction: rawArg,
					args: [rawArg]
				});
				index += 1;
				continue;
			}

			if (rawArg === 'p') {
				actions.push({
					action: 'rotate-left',
					rawAction: 'P',
					args: []
				});
				index += 1;
				continue;
			}

			if (rawArg === 's') {
				actions.push({
					action: 'rotate-right',
					rawAction: 'S',
					args: []
				});
				index += 1;
				continue;
			}

			if (rawArg === 'forward' || rawArg === 'f') {
				actions.push({
					action: 'forward',
					rawAction: patterns[index],
					args: [patterns[index + 1]]
				});
				index += 2;
				continue;
			}

			actions.push({
				action: 'unknown',
				rawAction: patterns[index],
				args: []
			});
			index += 1;
		}

		return actions;
	};

	const rotateTokenByDegrees = (token, deltaDegrees) => {
		const currentRotation = Number(token.get('rotation')) || 0;
		let nextRotation = (currentRotation + deltaDegrees) % 360;
		if (nextRotation < 0) nextRotation += 360;
		token.set({ rotation: nextRotation });
		return nextRotation;
	};

	const validateTokenPageGrid = (msg, token) => {
		const pageId = token.get('_pageid');
		const page = pageId ? getObj('page', pageId) : null;
		if (!page) {
			send(msg, 'Unable to determine the token page. hexmove requires Hex(V) or Hex(H).');
			return false;
		}

		const gridType = (page.get('grid_type') || '').toLowerCase();
		if (SUPPORTED_GRID_TYPES.includes(gridType)) {
			return true;
		}

		send(
			msg,
			`Map grid type "${gridType || 'none'}" is not supported. hexmove requires Hex(V) or Hex(H).`
		);
		return false;
	};

	const getValidHexFacings = (gridType) => {
		const type = (gridType || '').toLowerCase();
		if (type === 'hexr') {
			return [0, 60, 120, 180, 240, 300];
		}
		if (type === 'hex') {
			return [30, 90, 150, 210, 270, 330];
		}
		return [0, 60, 120, 180, 240, 300];
	};

	const cubeRound = (q, r) => {
		let x = q;
		let z = r;
		let y = -x - z;

		let rx = Math.round(x);
		let ry = Math.round(y);
		let rz = Math.round(z);

		const xDiff = Math.abs(rx - x);
		const yDiff = Math.abs(ry - y);
		const zDiff = Math.abs(rz - z);

		if (xDiff > yDiff && xDiff > zDiff) {
			rx = -ry - rz;
		} else if (yDiff > zDiff) {
			ry = -rx - rz;
		} else {
			rz = -rx - ry;
		}

		return { q: rx, r: rz };
	};

	const getHexCenterOrigin = (gridType, stepDistance) => {
		const side = stepDistance / Math.sqrt(3);
		const apothem = stepDistance / 2;
		const type = (gridType || '').toLowerCase();

		if (type === 'hex') {
			// Hex(V): top vertex and left side are map-edge aligned.
			return { x: apothem, y: side };
		}

		// Hex(H): top side and left vertex are map-edge aligned.
		return { x: side, y: apothem };
	};

	const getNearestHexCenter = (left, top, gridType, stepDistance) => {
		const side = stepDistance / Math.sqrt(3);
		const type = (gridType || '').toLowerCase();
		const origin = getHexCenterOrigin(type, stepDistance);
		const px = (Number(left) || 0) - origin.x;
		const py = (Number(top) || 0) - origin.y;

		let q;
		let r;

		if (type === 'hex') {
			// Pointy-top orientation (Hex(V)).
			q = ((Math.sqrt(3) / 3) * px - (1 / 3) * py) / side;
			r = ((2 / 3) * py) / side;
		} else {
			// Flat-top orientation (Hex(H)).
			q = ((2 / 3) * px) / side;
			r = ((-1 / 3) * px + (Math.sqrt(3) / 3) * py) / side;
		}

		const rounded = cubeRound(q, r);
		let snappedX;
		let snappedY;

		if (type === 'hex') {
			snappedX = side * Math.sqrt(3) * (rounded.q + rounded.r / 2);
			snappedY = side * 1.5 * rounded.r;
		} else {
			snappedX = side * 1.5 * rounded.q;
			snappedY = side * Math.sqrt(3) * (rounded.r + rounded.q / 2);
		}

		return {
			left: Math.round(snappedX + origin.x),
			top: Math.round(snappedY + origin.y)
		};
	};

	const snapTokenToClosestHexCenter = (token, gridType) => {
		const page = getObj('page', token.get('_pageid'));
		const increment = page ? Number(page.get('snapping_increment')) || 1 : 1;
		const stepDistance = 70 * increment;
		const snapped = getNearestHexCenter(token.get('left'), token.get('top'), gridType, stepDistance);
		token.set({ left: snapped.left, top: snapped.top });
		return snapped;
	};

	const snapTokenToNearestValidFacing = (token, gridType) => {
		const currentRotation = (Number(token.get('rotation')) || 0) % 360;
		const validFacings = getValidHexFacings(gridType);

		let nearestFacing = validFacings[0];
		let minDelta = 360;

		validFacings.forEach(facing => {
			let delta = (facing - currentRotation) % 360;
			if (delta < 0) delta += 360;
			if (delta < minDelta) {
				minDelta = delta;
				nearestFacing = facing;
			}
		});

		if (Math.abs(minDelta) > 0.01) {
			token.set({ rotation: nearestFacing });
		}

		return nearestFacing;
	};

	const prepareTokenForMovement = (token, gridType) => {
		snapTokenToClosestHexCenter(token, gridType);
		snapTokenToNearestValidFacing(token, gridType);
	};

	const moveTokenForward = (token, hexes) => {
		const page = getObj('page', token.get('_pageid'));
		const increment = page ? Number(page.get('snapping_increment')) || 1 : 1;
		const distancePx = 70 * increment * hexes;
		const rotation = Number(token.get('rotation')) || 0;
		const radians = rotation * Math.PI / 180;
		const topDelta = -Math.cos(radians) * distancePx;
		const leftDelta = Math.sin(radians) * distancePx;

		token.set({
			left: Math.round((Number(token.get('left')) || 0) + leftDelta),
			top: Math.round((Number(token.get('top')) || 0) + topDelta)
		});

		return rotation;
	};

	const sendHelp = (msg, tokenId, tokenName) => {
		const name = tokenName || 'unnamed token';
		send(
			msg,
			[
				'<div style="border:1px solid #666;padding:8px;background:#f8f8f8;color:#222;">',
				'<b>hexmove</b> token movement on hex grids<br>',
				'<b>Current target:</b> ' + tokenId + ' (' + name + ')<br><br>',
				'<b>Usage</b><br>',
				'<code>!hexmove &lt;token_id&gt; &lt;command_string&gt;</code><br><br>',
				'<b>Command String Parameters</b><br>',
				'- <code>N</code> : Move forward N hexes in current facing (example: <code>3</code>).<br>',
				'- <code>P</code> : Rotate port (counter-clockwise) 60&deg;.<br>',
				'- <code>S</code> : Rotate starboard (clockwise) 60&deg;.<br>',
				'- <code>(x)</code> suffix: Ignored by parser (example: <code>2P3(1)</code>).<br><br>',
				'<b>Examples</b><br>',
				'- <code>2P3S1</code> = forward 2, port, forward 3, starboard, forward 1<br>',
				'- <code>P</code> = rotate port only<br>',
				'- <code>3</code> = forward 3 hexes<br><br>',
				'<b>Notes</b><br>',
				'- Token snaps to nearest hex center and valid facing before each forward move.<br>',
				'- Requires Hex(V) or Hex(H) grid.<br>',
				'</div>'
			].join('')
		);
	};

	const executeAction = (msg, token, gridType, actionEntry, trailPoints, markerPoints) => {
		if (actionEntry.action === 'forward') {
			const distance = parseInt(actionEntry.args[0], 10);
			if (!Number.isFinite(distance) || distance <= 0) {
				return {
					ok: false,
					error: `Invalid forward distance: ${actionEntry.args[0]}. Use a positive integer.`
				};
			}

			prepareTokenForMovement(token, gridType);
			if (trailPoints && !trailPoints.length) {
				trailPoints.push({
					left: Number(token.get('left')) || 0,
					top: Number(token.get('top')) || 0
				});
				pushOrientationMarkerPoint(markerPoints, token);
			}
			moveTokenForward(token, distance);
			if (trailPoints) {
				trailPoints.push({
					left: Number(token.get('left')) || 0,
					top: Number(token.get('top')) || 0
				});
			}
			return { ok: true };
		}

		if (actionEntry.action === 'rotate-left') {
			rotateTokenByDegrees(token, -60);
			pushOrientationMarkerPoint(markerPoints, token);
			return { ok: true };
		}

		if (actionEntry.action === 'rotate-right') {
			rotateTokenByDegrees(token, 60);
			pushOrientationMarkerPoint(markerPoints, token);
			return { ok: true };
		}

		return {
			ok: false,
			error: `Unknown hexmove action: ${actionEntry.rawAction}. Use !hexmove <token_id> for help.`
		};
	};

	const handleHexMove = (msg, tokenId, args) => {
		if (!tokenId) {
			sendHelp(msg, 'none', 'no token specified');
			return;
		}

		const token = getObj('graphic', tokenId);
		if (!token) {
			send(msg, `Token not found for id: ${tokenId}`);
			return;
		}

		if (!validateTokenPageGrid(msg, token)) {
			return;
		}

		if (!args || !args.length) {
			sendHelp(msg, tokenId, token.get('name'));
			return;
		}

		const page = getObj('page', token.get('_pageid'));
		const gridType = page ? (page.get('grid_type') || '').toLowerCase() : 'hexh';
		const actionSequence = parseActionSequence(args);
		const trailPoints = [];
		const markerPoints = [];

		if (!actionSequence.length) {
			send(
				msg,
				'No valid actions were found in the command string. Use digits for forward movement and P/S for turns, such as 2P3S1.'
			);
			sendHelp(msg, tokenId, token.get('name'));
			return;
		}

		log(
			`${SCRIPT_NAME}: token=${tokenId}, rawArgs=${JSON.stringify(args)}, actions=${JSON.stringify(actionSequence.map(a => `${a.action}:${a.rawAction}`))}`
		);

		for (let i = 0; i < actionSequence.length; i++) {
			const result = executeAction(msg, token, gridType, actionSequence[i], trailPoints, markerPoints);
			if (!result.ok) {
				if (result.error) send(msg, result.error);
				return;
			}
		}

		if (trailPoints.length) {
			pushOrientationMarkerPoint(markerPoints, token);
		}

		clearActiveTrail();
		const newTrail = createTrailForToken(token, trailPoints);
		if (newTrail) {
			const newLabel = createTrailLabelForToken(token, trailPoints);
			const newMarkers = createOrientationMarkersForToken(token, markerPoints);
			toFront(newTrail);
			if (newLabel) {
				toFront(newLabel);
			}
			for (let i = 0; i < newMarkers.length; i++) {
				toFront(newMarkers[i]);
			}
			toFront(token);
			const trailState = getTrailState();
			trailState.activePathId = newTrail.id;
			trailState.activeTokenId = tokenId;
			trailState.activeLabelId = newLabel ? newLabel.id : null;
			trailState.activeMarkerIds = newMarkers.map(marker => marker.id);
		}
	};

	on('chat:message', (msg) => {
		if (msg.type !== 'api') return;

		const { command, tokenId, args } = parseCommand(msg.content);
		if (command !== COMMAND) return;

		handleHexMove(msg, tokenId, args);
	});

	on('change:graphic', (obj, prev) => {
		const trailState = getTrailState();
		if (!trailState.activePathId || !trailState.activeTokenId) return;
		if (obj.id !== trailState.activeTokenId) return;

		const prevLeft = Number(prev && prev.left);
		const prevTop = Number(prev && prev.top);
		const currLeft = Number(obj.get('left'));
		const currTop = Number(obj.get('top'));
		if (prevLeft === currLeft && prevTop === currTop) return;

		clearActiveTrail();
	});

	on('ready', () => {
		log(`${SCRIPT_NAME}: ready`);
	});
})();
