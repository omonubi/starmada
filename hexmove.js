(() => {
	'use strict';

	const SCRIPT_NAME = 'hexmove';
	const COMMAND = '!hexmove';

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

	const parseCommand = (content) => {
		const parts = (content || '').trim().split(/\s+/);
		const command = parts.shift() || '';
		return {
			command,
			tokenId: (parts.shift() || '').trim(),
			args: parts
		};
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
				'<b>hexmove mini-SDK</b><br>',
				'<b>Current target:</b> ' + tokenId + ' (' + name + ')<br><br>',
				'<b>Available right now</b><br>',
				'1) <code>!hexmove &lt;token_id&gt;</code><br>',
				'   Validates the token id and opens this help panel.<br><br>',
				'2) <code>!hexmove &lt;token_id&gt; forward &lt;hexes&gt;</code><br>',
				'   Moves token straight ahead by hexes based on token rotation.<br><br>',
				'<b>Planned command shape</b><br>',
				'<code>!hexmove &lt;token_id&gt; &lt;action&gt; [options]</code><br>',
				'Actions and options will be added in upcoming versions.<br><br>',
				'<b>Tips</b><br>',
				'- Use the sheet Bind Token button before committing movement.<br>',
				'- Movement uses token rotation directly (from ref01-style trig math).<br>',
				'- If the token id is invalid, hexmove returns an error.<br>',
				'</div>'
			].join('')
		);
	};

	const handleHexMove = (msg, tokenId, args) => {
		if (!tokenId) {
			send(msg, 'Usage: !hexmove <token_id>');
			return;
		}

		const token = getObj('graphic', tokenId);
		if (!token) {
			send(msg, `Token not found for id: ${tokenId}`);
			return;
		}

		if (!args || !args.length) {
			sendHelp(msg, tokenId, token.get('name'));
			return;
		}

		const action = (args[0] || '').toLowerCase();
		if (action === 'forward' || action === 'f') {
			const distance = parseInt(args[1], 10);
			if (!Number.isFinite(distance) || distance <= 0) {
				send(msg, 'Usage: !hexmove <token_id> forward <hexes> (hexes must be a positive integer)');
				return;
			}

			const direction = moveTokenForward(token, distance);
			send(msg, `Moved ${token.get('name') || 'token'} forward ${distance} hexes (facing ${direction}\u00b0).`);
			return;
		}

		// TODO: Implement action handlers for args[0] and additional options.
		send(msg, `Unknown hexmove action: ${args[0]}. Use !hexmove <token_id> for help.`);
	};

	on('chat:message', (msg) => {
		if (msg.type !== 'api') return;

		const { command, tokenId, args } = parseCommand(msg.content);
		if (command !== COMMAND) return;

		handleHexMove(msg, tokenId, args);
	});

	on('ready', () => {
		log(`${SCRIPT_NAME}: ready`);
	});
})();
