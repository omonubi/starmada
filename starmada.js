(() => {
	'use strict';

	const SCRIPT_NAME = 'starmada';
	const TOKEN_BINDING_ATTR = 'bound_token_id';

	const clearCharacterTokenBinding = (characterId, deletedTokenId) => {
		const bindingAttr = findObjs({
			_type: 'attribute',
			characterid: characterId,
			name: TOKEN_BINDING_ATTR
		})[0];

		if (!bindingAttr) return;

		const currentBinding = (bindingAttr.get('current') || '').trim();
		if (!currentBinding) return;
		if (deletedTokenId && currentBinding !== deletedTokenId) return;

		bindingAttr.set('current', '');
	};

	on('destroy:graphic', (token) => {
		if (!token) return;

		const characterId = (token.get('represents') || '').trim();
		if (!characterId) return;

		const character = getObj('character', characterId);
		if (!character) return;

		const deletedTokenId = token.id || token.get('_id');
		clearCharacterTokenBinding(characterId, deletedTokenId);
	});

	on('ready', () => {
		log(`${SCRIPT_NAME}: ready`);
	});
})();
