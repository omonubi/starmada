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
				'<b>Planned command shape</b><br>',
				'<code>!hexmove &lt;token_id&gt; &lt;action&gt; [options]</code><br>',
				'Actions and options will be added in upcoming versions.<br><br>',
				'<b>Tips</b><br>',
				'- Use the sheet Bind Token button before committing movement.<br>',
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
