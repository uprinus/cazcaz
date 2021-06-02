const TG = require('telegram-bot-api');
const MTProto = require('@mtproto/core');

const { Qiwi } = require('node-qiwi-promise-api');

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const config = require('./config.json');
const cards = require('./cards.json');

const fs = require('fs');
const deferred = require('deferred');

const qiwi = new Qiwi(config.payment.qiwi.qiwiApiKey)

const api = new TG({ token: config.telegram.token })
const { banker: { api_id, api_hash } } = config;

const antiFlood = require('./storage/floodProtection.js')

const mtproto = new MTProto({
	api_id,
	api_hash,
	
	storageOptions: {
		path: `${process.mainModule.path}/storage/auth.json`
	}
})

const TicTacToe = require('./tic-tac-toe')

const mp = new TG.GetUpdateMessageProvider()

const sleep = (waitTimeInMs) => new Promise(resolve => setTimeout(resolve, waitTimeInMs));

const SLOTS_RESULTS = [
	0, 3, 2, 2, 2,
	0, 2, 0, 0, 0,
	0, 2, 0, 0, 0,
	0, 2, 2, 0, 0,
	0, 2, 3, 2, 2,
	0, 0, 2, 0, 0,
	0, 0, 2, 2, 0,
	0, 0, 0, 2, 0,
	0, 3, 2, 2, 2,
	0, 0, 0, 2, 2,
	0, 0, 0, 0, 2,
	0, 0, 0, 0, 2,
	0, 2, 2, 2, 3,
]

/*
	/ Схема (User)
*/

const User = mongoose.model('Accounts', new Schema({
	uid: { type: Number, required: true },
	name: { type: String, required: true },
	
	balance: { type: Number, default: 0 },
	promocodes: [{ type: String }],
	
	refId: { type: Number, required: true, default: 0 },
	referrals: { type: Number, required: true, default: 0 },
	
	games: {
		slots: {
			lastRate: { type: Number, default: 5 },
			autogame: { type: Boolean, default: false },
			rate: { type: Number, default: 5 },
		},
		lastGame: { type: String, default: 'dont' },
	},
	
	won: { type: Number, default: 0 },
	singleWines: { type: Number, default: 0 },
	
	lost: { type: Number, default: 0 },
	totalGames: { type: Number, default: 0 },
	
	isTwist: { type: Boolean, required: true, default: false },
	isAdmin: { type: Boolean, required: true, default: false },
	
	isMessages: { type: Boolean, required: true, default: true },
	isBan: { type: Boolean, required: true, default: false },
}));

/*
	/ Схема (Game)
*/

const Game = mongoose.model('Games', new Schema({
	uid: { type: Number, required: true }, // айди игры
	bet: { type: Number, required: true }, // сумма ставки
	
	emoji: { type: String, required: true },
	mode: { type: String, required: true }, // режим
	
	maxmembers: { type: Number, required: true }, // макс колво игроков
	members: { type: Array, required: true }, // участники в массиве с объектом
	
	ended: { type: Boolean, required: true, default: false }, // закончилась?
	createdAt: { type: Number, required: true } // время создания
}));

/*
	/ Схема (Promo)
*/

const Promo = mongoose.model('Promo', new Schema({
	name: { type: String, required: true },
	amount: { type: Number, required: true },
	
	count: { type: Number, required: true },
	status: { type: Boolean, required: true, default: false },
}));

/*
	/ Схема (Withdrawals)
*/

const Withdrawals = mongoose.model('Withdrawals', new Schema({
	sent: { type: Boolean, required: true, default: false },
	userId: { type: Number, required: true },
	
	method: { type: String, required: true },
	phone: { type: Number, required: true },
	
	amount: { type: Number, required: true },
	time: { type: Number, required: true },
}));

/*
	/ Схема (Payment)
*/

const Payment = mongoose.model('Payment', new Schema({
	id: { type: Number, required: true },
	uid: { type: Number, required: true },
	
	system: { type: String, required: true }
}));

async function getUser(context) {
	let user = await User.findOne({ uid: context.message.chat.id })
	let refId = context.message.text || undefined;
	refId = !isNaN(refId.split('/start =')[1]) ? refId.split('/start =')[1] : 0
	
	if (!user) {
		
		user = new User({
			uid: context.message.chat.id,
			name: context.message.chat.first_name,
			refId
		})
		
		if (refId) {
			try {
				const refUser = await User.findOne({ uid: refId })
				refUser.referrals++
				
				await refUser.save()
				await api.sendMessage({
					chat_id: refId,
					text: `${context.message.from.username !== undefined ? `@${context.message.from.username}` : `${context.message.from.first_name}`} перешел по вашей реф. ссылке.\nТеперь вы получаете ${config.percent.ref}% с его пополнения`,
				})
			} catch (_) { }
		}
		
		await user.save()
	}
	
	return user
}


const infoGames = [
	{
		name: "🎲 Дайс",
		tag: "dice",
		emoji: "🎲",
		text: "подкидывает кубик",
		userText: "подкидываете кубик",
		maxnumber: 6
	},
	{
		name: "🎯 Дартс",
		tag: "darts",
		emoji: "🎯",
		text: "бросает дротик",
		userText: "бросаете дротик",
		maxnumber: 6
	},
	{
		name: "🎳 Боулинг",
		tag: "bowling",
		emoji: "🎳",
		text: "бросает шар в кегли",
		userText: "бросаете шар в кегли",
		maxnumber: 6
	},
	{
		name: "🏀 Баскетбол",
		tag: "basketball",
		emoji: "🏀",
		text: "бросает мяч в кольцо",
		userText: "бросаете мяч в кольцо",
		maxnumber: 5
	},
	{
		name: "⚽️ Футбол",
		tag: "football",
		emoji: "⚽️",
		text: "бутсает мяч в сторону ворот",
		userText: "бутсаете мяч в сторону ворот",
		maxnumber: 5
	},// Крестики-нолики
	{
		name: "🃏 Блэкджек",
		tag: "blackjack",
		emoji: "🃏",
		text: "берёте карту",
		userText: "берёте карту",
		maxnumber: 21
	},
	{
		name: "❌Крестики-нолики⭕️",
		tag: "tic-tac-toe",
		emoji: "ГГ",
		maxnumber: 21
	}
]

/*
	/ Клавиатура (если часто используется)
*/

function buttons(buttons) {
	const keyboard = []
	
	buttons.forEach((item, i) => {
		keyboard.push([item])
	});
	
	return JSON.stringify({
		resize_keyboard: true,
		keyboard
	})
}

function PrivateKeyboard(user) {
	const arrayKeyboard = [
		['🟢 Онлайн игры', '🔴 Одиночные игры'],
		['📝 Мои игры', '🏆 Рейтинг'],
		['👤 Профиль', 'ℹ️ Информация']
	]
	
	if (user.isAdmin) {
		arrayKeyboard.push(['Панель'])
	}
	
	const main = JSON.stringify({
		resize_keyboard: true,
		keyboard: arrayKeyboard
	})
	
	return main;
}

function availableGames(allGames, mode) {
	const GameKeyboard = []
	
	allGames.forEach((item, i) => {
		GameKeyboard.push([{ text: `${item.emoji} Игра №${item.uid} | ${item.bet} RUB | ${item.maxmembers} Р`, callback_data: `room_${item.mode}_${item.uid}` }])
	});
	
	if (mode) GameKeyboard.push([{ text: '❇️ Создать игру', callback_data: `game_create_${mode.tag}` }, { text: `♻️ Обновить`, callback_data: `troom_${mode.tag}` }])
	
	return JSON.stringify({
		inline_keyboard: GameKeyboard
	})
}

function MethodKeyboard(command) {
  const arr = [
		[{ text: '🥝 Киви', callback_data: `${command}_qiwi` }],
		[{ text: '🔙 Назад', callback_data: `profile` }]
	]
	
	if(command == 'replenish') {
		arr[0].push({ text: '🏦 Банкир', callback_data: `${command}_banker` })
	}
	
	return JSON.stringify({
		inline_keyboard: arr
	});
}''

function RedirectionKeyboard(url) {
	return JSON.stringify({
		inline_keyboard: [
			[{ text: '👉 Перейти к оплате 👈', url }],
			[{ text: '🔙 Назад', callback_data: `replenish` }]
		]
	})
}

const ProfileKeyboard = JSON.stringify({
	inline_keyboard: [
		[{ text: 'Пополнить', callback_data: 'replenish' }, { text: 'Вывод', callback_data: 'withdrawal' }],
		[{ text: 'Активировать промокод', callback_data: 'usepromo' }],
	]
})

const OnlineGames = JSON.stringify({
	resize_keyboard: true,
	keyboard: [
		['❌Крестики-нолики⭕️', '🃏 Блэкджек'],
		['🎮 Мини-игры', '🎮 Все игры'],
		['❌ Отменить', '❇️ Создать игру']
	]
})

const SingleGames = JSON.stringify({
	resize_keyboard: true,
	keyboard: [
		['🎰 Слоты', '🃏 Блэкджeк'],
		['🎲 Дaйс'],
		['❌ Отменить']
	]
})

const MiniGameKeyboard = JSON.stringify({
	resize_keyboard: true,
	keyboard: [
		['🎲 Дайс', '🎯 Дартс'],
		['🎳 Боулинг', '🏀 Баскетбол'],
		['⚽️ Футбол', '❌ Отменить']
	]
})

const InformationKeyboard = JSON.stringify({
	inline_keyboard: [
		[{ text: 'НАШ ЧАТ', url: config.telegram.chat }, { text: 'По всем вопросам', url: config.telegram.username }],
		[{ text: 'Отзывы', url: config.telegram.reviews }]
	]
})

const SelectTypeGame = JSON.stringify({
	inline_keyboard: [
		[{ text: '🎲 Дайс', callback_data: 'game_create_dice' }, { text: '🎯 Дартс', callback_data: 'game_create_darts' }, { text: '🎳 Боулинг', callback_data: 'game_create_bowling' }],
		[{ text: '🏀 Баскетбол', callback_data: 'game_create_basketball' }, { text: '⚽️ Футбол', callback_data: 'game_create_football' }, { text: '🃏 Блэкджек', callback_data: 'game_create_blackjack' }],
		[{ text: '❌Крестики-нолики⭕️', callback_data: 'game_create_tic-tac-toe' }]
	]
})
// tic-tac-toe Крестики-нолики
const CardTakeKeyboard = JSON.stringify({
	inline_keyboard: [
		[{ text: 'Взять еще', callback_data: 'yet' }, { text: 'Завершить', callback_data: 'complete' }]
	]
})

const AdminKeyboard = JSON.stringify({
	resize_keyboard: true,
	keyboard: [
		['Выдать валюту', 'Выдать админку', 'Выдать подкрутку'],
		['Выдать бан', 'Выдать разбан', 'Рассылка'],
		['Регулировка комиссии', 'Регулировка реф.%', 'Создать промокод'],
		['Инфа', 'Меню']
	]
})

// - - - - - utils - - - - - //

const utils = {
	random: (min, max) => {
		return Math.round(min - 0.5 + Math.random() * (max - min + 1));
	},
	split: (number) => {
		return number.toLocaleString('en-US').replace(/,/g, ' ')
	},
}

/*
	/ Функции
*/

async function twist(res, infoGame, results) {
	let ended = false
	let data
	
	if (res.twist) {
		let test = Math.max(results)
		
		while (!ended) {
			data = await api.sendDice({
				chat_id: res.uid,
				emoji: infoGame.emoji
			});
			
			if (isNaN(test)) {
				if (data.dice.value == infoGame.maxnumber) ended = true;
			}
			
			else if (test <= infoGame.maxnumber) {
				if (data.dice.value >= test) ended = true;
			}
		}
	}
	
	else {
		data = await api.sendDice({
			chat_id: res.uid,
			emoji: infoGame.emoji
		});
	}
	
	return data;
}

function declOfNum(n, titles) {
	return titles[n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2]
}

function formatSum(number) {
	const amountOfThousands = (number.match(/к|k/gi) || { length: 0 }).length
	
	number = Number(parseFloat(number.replace(/\s/g, '').replace(/к|k/gi, '')).toFixed(3))
	number *= Math.pow(1000, amountOfThousands)
	
	return number
}

async function botCards(shuffledCards) {
	let end = false;
	let value = 0;
	let idcard = 0;
	let text = '';

	while (!end) {
		if(value < 17) {
			let rank = shuffledCards[idcard].rank == "A" && value > 10 ? 1 : shuffledCards[idcard].value
			value += +rank
			text += `\nКарта: ${shuffledCards[idcard].rank} ${shuffledCards[idcard].emoji}`
			idcard++
		}

		else {
			end = true;
		}
	}

	return [idcard, value, text]
}

async function takeCards(shuffledCards, idсards, id) {
	const results = [];

	let text = '';
	let value = 0;
	let ended = false;

	let idcard = idсards;

	while(!ended) {
		let test = await question(`${text == '' ? 'У вас нет карт.' :`${value} Очков\n${text}` }`, id, CardTakeKeyboard)

		if(test.data == 'yet') {
		await api.deleteMessage({
				chat_id: test.message.chat.id,
				message_id: test.message.message_id
			})
			let rank = shuffledCards[idcard].rank == "A" && value > 10 ? 1 : shuffledCards[idcard].value
			value += +rank
			text += `${rank} (${shuffledCards[idcard].suit} ${shuffledCards[idcard].emoji})\n`
			idcard++

			if(value > 21) {
				api.sendMessage({
					chat_id: test.message.chat.id,
					text: `${value} кол-во ваших очков\n${text}\nУ вас перебор.`,
				})
				ended = true;
			}
		}

		else if(test.data == 'complete') {
			await api.sendMessage({
				chat_id: test.message.chat.id,
				text: `${text == '' ? 'Вы сдались..' :`${value} кол-во ваших очков\n${text}` }`,
			})
			ended = true;
		}
	}

	return [idcard, value]
}

async function rollDices(players, infoGame) {
	const results = [];
	let idcard = 0;
	let shuffledCards
	let data
	let result
	
	if (infoGame.tag == 'blackjack') {
		shuffledCards = cards.sort(() => Math.random() - 0.5)
	}
	
	for (const i in players) {
		const res = players[i]
		
		await api.sendMessage({
			chat_id: res.uid,
			text: `Вы ${infoGame.userText}...`,
		})
		
		for (const fi in players) {
			if (i == fi) continue;
			
			const ress = players[fi]
			
			await api.sendMessage({
				chat_id: ress.uid,
				text: `❕ Противник (${res.login}) ${infoGame.text}...`,
			})
		}
		
		if (infoGame.tag !== 'blackjack') {
			data = await twist(res, infoGame, result)
			
			result = data.dice.value;
		}
		
		else {
			data = await takeCards(shuffledCards, idcard, res.uid)
			
			idcard = data[0]
			result = data[1]
		}
		
		for (const fi in players) {
			if (i == fi) continue;
			
			const ress = players[fi]
			if (infoGame.tag !== 'blackjack') {
				await api.forwardMessage({
					chat_id: ress.uid,
					from_chat_id: data.chat.id,
					message_id: data.message_id,
					}).catch((err) => {
					console.log('forward', err, ress, data)
				})
			}
			
			else {
				await api.sendMessage({
					chat_id: ress.uid,
					text: `❕ Противник закончил брать карты.`,
				})
			}
		}
		
		results.push({
			uid: res.uid,
			login: res.login,
			result,
			index: res.index
		});
	}
	
	return results
}


function formatUsers(users) {
	const formated = []
	
	for (const user of users) {
		formated.push(`${user.login} (${user.results.join(', ')}) ${user.win ? 'Победа' : 'Проигрыш'}`)
	}
	
	return formated.join('\n')
}

function SlotsCoefficient(result) {
	const fructs = SLOTS_RESULTS[result]
	let coefficient;
	
	if (result == 64) {
		coefficient = 3;
	}
	
	else if (fructs == 2) {
		coefficient = 1.5;
	}
	
	else {
		coefficient = 2;
	}
	
	return coefficient
}

const spinSlots = async (user, rate) => {
	
	if(rate > user.balance) {
		return
	}
	
	const result = await api.sendDice({
		chat_id: user.uid,
		emoji: '🎰'
	});
	
	const fructs = SLOTS_RESULTS[result.dice.value]
	
	if (fructs != 0) {
		const coefficient = SlotsCoefficient(result.dice.value)
		const win_amount = Number(rate * coefficient)
		
		await api.sendMessage({
			chat_id: user.uid,
			text: [
				'🥳 Вы одержали победу!\n',
				`🤑 Выигрыш составляет +${win_amount}`,
				`✖️ Ставка умножена на ${coefficient}\n`,
				`💰 Текущий баланс: ${Number(+user.balance + +win_amount - rate).toFixed(2)} RUB`
			].join('\n')
		})
		
		user.singleWines += +win_amount - rate
		user.balance += +win_amount - rate
	}
	
	else {
		await api.sendMessage({
			chat_id: user.uid,
			text: [
				'😔 Вы проиграли!\n',
				`💰 Текущий баланс: ${Number(user.balance - rate).toFixed(2)} RUB`
			].join('\n')
		})
		
		user.balance -= rate
	}
	
	await user.save()
}

/*
	/ selectionWinner
*/
function getRandomInt(max) {
	return Math.floor(Math.random() * max);
  }
const selectionWinner = async (game) => {
	const winningBet = (game.bet * game.maxmembers * ((100 - config.percent.game) / 100)).toFixed(2);
	const infoGame = infoGames.find(x => x.emoji == game.emoji)
	const mode = game.mode;
	const allLogins = []
	let inGame = []
	
	game.members.forEach((data, i) => {
		inGame.push({
			...data,
			index: i
		})
		
		allLogins.push({
			...data,
			index: i,
			results: [],
			win: false
		})
	})
	
	let round = 0
	while (inGame.length > 1) {
		round++
		
		if (round > 1) for (const user of inGame) {
			await api.sendMessage({
				chat_id: user.uid,
				text: `Начинаем ${round}-й раунд...`,
			})
		}
		
		const results = await rollDices(inGame, infoGame)
		const allResults = []
		
		results.forEach(({ login, result, index }) => {
			allResults.push(result)
			allLogins[index].results.push(result)
		})
		
		let maxResult = Math.max(...allResults)
		maxResult = maxResult > 21 ? Math.min(...allResults) : `${Math.max(...allResults) == 0 ? -1 : Math.max(...allResults)}`
		const winners = []
		
		results.forEach((user) => {
			if (user.result != maxResult || mode == 'blackjack' && maxResult > 21) {
				allLogins[user.index].win = false
				return;
			}
			
			allLogins[user.index].win = true
			winners.push(user)
		})
		
		results.forEach((user) => {
			if (user.result != maxResult || mode == 'blackjack' && maxResult > 21) {
				api.sendMessage({
					chat_id: user.uid,
					text: [
						`${infoGame.name} #${game.uid}`,
						`💰Банк: ${utils.split(winningBet)} RUB`,
						'',
						'Игроки:',
						formatUsers(allLogins),
						'',
						'🔴🔴🔴 Вы проиграли!'
					].join('\n')
				})
				
				User.collection.updateOne({ uid: user.uid }, { $inc: { lost: +game.bet, totalGames: +1 } });
				return;
			}
		})
		
		inGame = winners
	}
	
	api.sendMessage({
		chat_id: inGame[0].uid,
		text: [
			`${infoGame.name} #${game.uid}`,
			`💰Банк: ${utils.split(winningBet)} RUB`,
			'',
			'Игроки:',
			formatUsers(allLogins),
			'',
			'🟢🟢🟢 Вы выиграли!'
		].join('\n')
		}).catch((err) => {
		console.log('send:', err)
	})
	
	User.collection.updateOne({ uid: inGame[0].uid }, { $inc: { won: +winningBet - game.bet, woncompetition: +winningBet - game.bet, balance: +winningBet, totalGames: +1 } });
}

/*
	/ Команды
*/

const cmds = [
	{
		tag: ['help', 'start', '/start', 'меню', '❌ Отменить'],
		button: ['help', 'start', 'cancel'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, { user }) {
			
			api.sendMessage({
				chat_id: context.message.chat.id,
				text: 'Главное меню',
				reply_markup: PrivateKeyboard(user)
			})
		}
	},
	
	{
		tag: ['👤 Профиль', 'профиль'],
		button: ['profile'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, { user, command }) {
			const message = [
				'🧾 Профиль\n',
				`❕ Ваш id - ${context.message.chat.id}`,
				`❕ Ваш логин - ${context.message.chat.username !== undefined ? `@${context.message.chat.username}` : `Скрыт`}`,
				`💰 Ваш баланс - ${user.balance} рублей\n`,
				`🥺 Ваша реф. ссылка: https://t.me/${config.telegram.urlbot}?start==${user.uid}`,
				`👤 Вы пригласили ${user.referrals} ${declOfNum(user.referrals, ['пользователя', 'пользователей', 'пользователей'])}.`
			]
			
			if (command.type == 'button') {
				await api.editMessageText({
					chat_id: context.message.chat.id,
					message_id: context.message.message_id,
					text: message.join('\n'),
					reply_markup: ProfileKeyboard
				})
			}
			
			else {
				await api.sendMessage({
					chat_id: context.message.chat.id,
					text: message.join('\n'),
					reply_markup: ProfileKeyboard
				})
			}
		}
	},
	
	{
		tag: ['ℹ️ Информация', 'информация'],
		button: ['information'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, {}) {
			api.sendMessage({
				chat_id: context.message.chat.id,
				text: '👋 Добро пожаловать!',
				reply_markup: InformationKeyboard
			})
		}
	},
	
	{
		tag: ['🟢 Онлайн игры'],
		button: ['information'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, {}) {
			api.sendMessage({
				chat_id: context.message.chat.id,
				text: '🟢 | Онлайн-игры:',
				reply_markup: OnlineGames
			})
		}
	},
	
	{
		tag: ['🔴 Одиночные игры'],
		button: ['information'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, {}) {
			api.sendMessage({
				chat_id: context.message.chat.id,
				text: '🔴 | Одиночные игры:',
				reply_markup: SingleGames
			})
		}
	},
	
	{
		tag: ['❇️ Создать игру', 'создать игру'],
		button: ['game'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, { user, command }) {
			const cmd = command.text.split('_')[1] || undefined
			if (cmd == undefined || cmd == '❇️ Создать игру') {
				api.sendMessage({
					chat_id: context.message.chat.id,
					text: `Создайте игру:`,
					reply_markup: SelectTypeGame
				})
			}
			
			else if (cmd == 'create') {
				const type = command.text.split('_')[2] || undefined
				let maxmember = 2;
				
				if (type == undefined) {
					api.sendMessage({
						chat_id: context.message.chat.id,
						text: 'Выбирите тип игры:',
						reply_markup: SelectTypeGame
					})
				}
				
				else if (
					type == 'dice' 		||
					type == 'darts' 	||
					type == 'bowling' 	||
					type == 'basketball'||
					type == 'football' 	||
					type == 'blackjack' ||
					type == 'tic-tac-toe'
					) {
					
					if (type !== 'blackjack' && type !== 'tic-tac-toe') {
						maxmember = await question('Введите кол-во игроков от 2 до 30', context.message.chat.id, buttons(['❌ Отменить']))
						maxmember = maxmember.message.text || undefined
						
						if (isNaN(maxmember)) {
							return api.sendMessage({
								chat_id: context.message.chat.id,
								text: '⚠️ Что-то пошло не по плану',
								reply_markup: PrivateKeyboard(user)
							})
						}
						
						else if (maxmember < 2 || maxmember > 30) {
							return api.sendMessage({
								chat_id: context.message.chat.id,
								text: '⚠️ Что-то пошло не по плану',
								reply_markup: PrivateKeyboard(user)
							})
						}
					}
					
					let bet = await question(
						[
							`Минимальная ставка: ${config.min_bet}`,
							`💰 Твой баланс: ${utils.split(user.balance)}`
						].join('\n'), context.message.chat.id)
						if (bet == '❌ Отменить') return
						
						bet = formatSum(bet.message.text)
						
						if (bet < config.min_bet || bet > user.balance) {
							return api.sendMessage({
								chat_id: context.message.chat.id,
								text: '⚠️ Неверная ставка',
								reply_markup: PrivateKeyboard(user)
							})
						}
						
						const lastGames = await Game.find({ mode: type }, { uid: 1 }).sort({ uid: -1 }).limit(1).lean();
						
						let id = 0
						if (lastGames.length > 0) id = lastGames[0].uid + 1
						
						Game.create({
							uid: id,
							bet: bet,
							mode: type,
							emoji: infoGames.find(x => x.tag == type).emoji,
							maxmembers: maxmember,
							createdAt: Date.now(),
							members: [{
								uid: context.message.chat.id,
								login: `${context.message.chat.username !== undefined ? `@${context.message.chat.username}` : `${context.message.chat.first_name}`}`, // @${context.message.chat.username}
								twist: user.isTwist
							}]
						})
						user.balance -= bet;
						
						await api.sendMessage({
							chat_id: context.message.chat.id,
							text: `✅ Ваша ставка принята!`,
							reply_markup: PrivateKeyboard(user)
						})
						
						await user.save()
				}
			}
		}
	},
	
	{
		tag: ['🎮 мини-игры'],
		button: ['minigame'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, {}) {
			await api.sendPhoto({
				chat_id: context.message.chat.id,
				photo: config.pictures.minigames,
				caption: 'Доступные Мини-Игры:',
				reply_markup: MiniGameKeyboard
			})
		}
	},
	// tic-tac-toe
	{
		tag: ['🎲 Дайс', '🎯 Дартс', '🎳 Боулинг', '🏀 Баскетбол', '⚽️ Футбол', '🃏 Блэкджек', '❌Крестики-нолики⭕️'],
		button: ['troom'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, { command }) {
			const mode = command.text.split('_')[1] ? infoGames.find(x => x.tag == command.text.split('_')[1]) : infoGames.find(x => x.name == context.message.text);
			const allGames = await Game.find({ ended: false, mode: mode.tag, emoji: mode.emoji }).sort({ uid: -1 }).lean() // toArray();
			
			if (command.text.split('_')[1]) {
				api.editMessageReplyMarkup({
					chat_id: context.message.chat.id,
					message_id: context.message.message_id,
					reply_markup: availableGames(allGames, mode)
					}).catch(e => {
					console.log('Edit', e)
				})
			}
			
			else {
				if (mode.tag == 'blackjack') {
					await api.sendPhoto({
						chat_id: context.message.chat.id,
						photo: config.pictures.blackjack,
						caption: `${allGames.length > 0 ? '♻️ Доступные игры:' : 'Больше игр нет.\nСоздайте свою!'}`,
						reply_markup: availableGames(allGames, mode) // allGames.length > 0 ? availableGames(allGames, mode) : SelectTypeGame
					})
				}
				
				else {
					await api.sendMessage({
						chat_id: context.message.chat.id,
						text: `${allGames.length > 0 ? '♻️ Доступные игры:' : 'Больше игр нет.\nСоздайте свою!'}`,
						reply_markup: availableGames(allGames, mode)
					})
				}
			}
		}
	},
	
	{
		tag: ['🎮 Все игры'],
		button: ['allgames'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, {}) {
			const allGames = await Game.collection.find({ ended: false }).sort({ uid: -1 }).toArray();
			await api.sendMessage({
				chat_id: context.message.chat.id,
				text: `${allGames.length > 0 ? '♻️ Доступные все игры:' : 'Больше игр нет.\nСоздайте свою!'}`,
				reply_markup: availableGames(allGames)
			})
		}
	},
	
	{
		tag: ['null'],
		button: ['room'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, { user, command }) {
			const cmd = command.text.split('_')[1] || undefined;
			const gameUid = command.text.split('_')[2] || undefined;
			const infoPlay = command.text.split('_')[3] || undefined;
			
			if (cmd == undefined || gameUid == undefined) {
				return;
			}
			
			else if (
				cmd == 'dice'      ||
				cmd == 'darts'     ||
				cmd == 'bowling'   ||
				cmd == 'basketball'||
				cmd == 'football'  ||
				cmd == 'blackjack' ||
				cmd == 'tic-tac-toe'
				) {
				const gameInfo = await Game.collection.findOne({ ended: false, mode: cmd, uid: Number(gameUid) });
				const infoGame = infoGames.find(x => x.tag == cmd)
				
				if (gameInfo.bet > user.balance) {
					return api.editMessageText({
						chat_id: context.message.chat.id,
						message_id: context.message.message_id,
						text: `Для игры у тебя недостаточно ${gameInfo.bet - user.balance} RUB`
					})
				}
				
				if (!gameInfo) {
					return api.editMessageText({
						chat_id: context.message.chat.id,
						message_id: context.message.message_id,
						text: `Вы уже поставили на даную игру или игра была закончена.`
					})
				}
				
				else if (gameInfo.maxmembers > gameInfo.members.length) {
					if (!infoPlay) {
						let text = `${infoGame.name} #${gameInfo.uid}\n💰Ставка: ${gameInfo.bet} RUB\n`
						
						gameInfo.members.forEach((item, i) => {
							text += `\n👤 ${i + 1}P: ${item.login}`
						});
						
						await api.sendMessage({
							chat_id: context.message.chat.id,
							text,
							reply_markup: JSON.stringify({
								inline_keyboard: [
									[{ text: `${infoGame.name}`, callback_data: `room_${gameInfo.mode}_${gameInfo.uid}_true` }]
								]
							})
						})
					}
					
					else if (infoPlay) {
						const foundRate = gameInfo.members.findIndex((x) => x.uid == +context.message.chat.id);
						if (foundRate == -1) {
							gameInfo.members.push({
								uid: context.message.chat.id,
								login: `${context.message.chat.username !== undefined ? `@${context.message.chat.username}` : `${context.message.chat.first_name}`}`,
								twist: user.isTwist
							})
							user.balance -= gameInfo.bet;
							
							await Game.collection.updateOne({ ended: false, mode: cmd, uid: Number(gameUid) }, { $set: { members: gameInfo.members, ended: gameInfo.members.length == gameInfo.maxmembers ? true : false } })
							await user.save()
							
							api.editMessageText({
								chat_id: context.message.chat.id,
								message_id: context.message.message_id,
								text: `Успешна ставка ${gameInfo.bet}.\nОстаток на твоем баланса: ${user.balance}`
							})
							if (gameInfo.members.length == gameInfo.maxmembers) {
								if(gameInfo.mode == 'tic-tac-toe') {
									const win_amount = (gameInfo.bet * gameInfo.maxmembers * ((100 - config.percent.game) / 100)).toFixed(2);
									const reset_amount = (gameInfo.bet * gameInfo.maxmembers * ((100 - config.percent.reset) / 100));
									const userIdX = {
										id: gameInfo.members[0].uid
									}
									const userIdO = {
										id: gameInfo.members[1].uid,
									}

									const game = new TicTacToe(userIdX.id, userIdO.id)
									
									let _isWinMessageSent = false

									const handleWin = async() => {
										if(_isWinMessageSent) return
										_isWinMessageSent = true

										for(let i= 0; i < 2; i++) {
											api.sendMessage({
												chat_id: i ? userIdX.id : userIdO.id,
												text: game.winner === 0 ? 'Ничья!' : `Победитель - ${game.winner === 1 ? 'X' : 'O'}`
											})
										}
										if(game.winner !== 0) {
											const test = await User.updateOne({ uid: game.winner === 1 ? userIdX.id : userIdO.id }, { $inc: { balance: +win_amount, won: +win_amount } })
											console.log(test)
										} else {
											await User.updateOne({ uid: userIdX.id }, { $inc: { balance: +gameInfo.bet } })
											await User.updateOne({ uid: userIdO.id }, { $inc: { balance: +gameInfo.bet } })
										}
									}

									const startGameForPeer = async(obj) => {
										const peerId = obj.id;
										let _resp = {}
										
										while(game.winner === null) {
											let answer
											if(isNaN(obj.messageId)) {
												answer = await question(
													`${_resp.error || 'Выберите поле'}\nВы - ${peerId === userIdX.id ? 'X' : 'O'}`,
													peerId,
													game.createKeyboard(),
												)
												obj.messageId = answer.message.message_id;
											}
											else {
												answer = await question(
													`${_resp.error || 'Выберите поле'}\nВы - ${peerId === userIdX.id ? 'X' : 'O'} (${utils.random(1, 500)})`,
													peerId,
													game.createKeyboard(),
													'edit'
												)
											}
											_resp = game.callbackQueryHandler(answer)
											if(_resp.error) continue
											if(_resp.winner === null)
												api.sendMessage({
													chat_id: peerId === userIdX.id ? userIdO.id : userIdX.id,
													text: `Ваш противних сходил`,
													reply_markup: game.createKeyboard()
												})

										}
										handleWin()
									}

									startGameForPeer(userIdX)
									startGameForPeer(userIdO)
								}
								else {
									await selectionWinner(gameInfo)
								}
							}
						}

						else {
							return api.editMessageText({
								chat_id: context.message.chat.id,
								message_id: context.message.message_id,
								text: `Вы уже поставили на даную игру или игра была закончена.`
							})
						}
					}
				}
			}
		}
	},
	{		
	  tag: ['🃏 Блэкджeк'],
		button: ['🃏 Блэкджeк'],

		type: 'TYPE_PRIVATE',

		async execute(context, { user }) {
			let { message: { text: rate } } = await question(`Введите сумму ставки`, context.message.chat.id, buttons(['❌ Отменить']))
			if(rate == '❌ Отменить') return
			rate = formatSum(rate)

			if(rate < config.min_bet || rate > user.balance) {
				return api.sendMessage({
					chat_id: context.message.chat.id,
					text: '⚠️ Неверная ставка',
					reply_markup: SingleGames
				})
			}

			let end = false;
			const shuffledCards = cards.sort(() => Math.random() - 0.5)

			const botInfo = await botCards(shuffledCards)
			const botResult = botInfo[1]

			const userInfo = await takeCards(shuffledCards, botInfo[0], context.message.chat.id)
			const userResult = userInfo[1]

			rands = getRandomInt(3)
			if(rands == 0) {
				if(userResult < 18) {
					botResults = 18
				} else if(userResult <= 21)  {
					botResults = userResult - 1 - getRandomInt(2)
				} else if(userResult > 21) {
					botResults = 21
				}
			}

			else {
				if(userResult < 18) {
					botResults = 18
				}
				if(userResult == 21) {
					botResults = 21
				}
				else if(userResult < 21) {
					botResults = userResult+1
				}
			}

			const winningBet = (rate * ((100 - config.percent.game) / 100)).toFixed(2);
			await api.sendMessage({
				chat_id: context.message.chat.id,
				text: `\nОчки дилера: ${botResults}`,
				reply_markup: SingleGames
			})
			user = await getUser(context)

			if(userResult > botResults && userResult <= 21 || botResults > 21 && userResult <= 21) {
				await api.sendMessage({
					chat_id: context.message.chat.id,
					text: [
						`🎉 Поздравляем с победой`,
						`Вы успешно выиграли: ${rate} ₽\n`,
						`Ваш результат: ${userResult} очков`,
						`Результат дилера: ${botResults} очков\n`,
						`💰 Текущий баланс: ${Number(+user.balance + +winningBet).toFixed(2)} RUB`
					].join('\n'),
					reply_markup: SingleGames
				})

				user.balance += +winningBet
				user.singleWines += +winningBet
			}

			else if(botResults == userResult) {
				await api.sendMessage({
					chat_id: context.message.chat.id,
					text: [
						`🤷‍♂️ Ничья`,
						`💰 Текущий баланс: ${Number(user.balance).toFixed(2)} RUB`
					].join('\n'),
					reply_markup: SingleGames
				})
			}
			else {
				await api.sendMessage({
					chat_id: context.message.chat.id,
					text: [
						`😥 К сожалению вы проиграли: ${rate} ₽\n` ,
						`Ваш результат: ${userResult}`,
						`Результат дилера: ${botResults}\n`,
						`💰 Текущий баланс: ${Number(user.balance - rate).toFixed(2)} RUB`
					].join('\n'),
					reply_markup: SingleGames
				})
				user.balance -= rate;
			}

			await user.save()
		}
	},

	{
		tag: ['🎰 Слоты'],
		button: ['slots'],

		type: 'TYPE_PRIVATE',

		async execute(context, { user, command }) {
				let { message: { text: rate } } = await question(`Введите сумму ставки`, context.message.chat.id, buttons(['❌ Отменить']))
				user = await getUser(context)
				if (rate == '❌ Отменить') return;
				rate = formatSum(rate)

				if (rate < config.min_bet || rate > user.balance) {
					return api.sendMessage({
						chat_id: context.message.chat.id,
						text: `Минимальная ставка: ${utils.split(config.min_bet)} ₽\nМаксимальная ставка: ${utils.split(user.balance)} ₽`,
						reply_markup: SingleGames
					})
				}

				else if (isNaN(rate)) {
					return api.sendMessage({
						chat_id: context.message.chat.id,
						text: 'Неверное число!',
						reply_markup: SingleGames
					})
				}

				user.games.lastGame = 'slots';
				user.games.slots.lastRate = rate;

				await spinSlots(user, rate)
		}
	},
	
	{
		tag: ['повторить'],
		button: ['повторить'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, { user, command }) {
			let lastGame = user.games.slots;
			
			
			if (command.text == 'Повторить') {
				if (lastGame.lastRate > user.balance) {
					return api.sendMessage({
						chat_id: context.message.chat.id,
						text: `На твоем баланса недостаточно рублей для игры!`,
						reply_markup: SingleGames
					})
				}
			}
			
			await spinSlots(user, lastGame.lastRate)
		}
	},
	
	{
		tag: ['📝 мои игры'],
		button: ['mygames'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, { user }) {
			api.sendMessage({
				chat_id: context.message.chat.id,
				message_id: context.message.message_id,
				text: [
					`🎮 Твои игры: ${user.totalGames} 🎮\n`,
					`📈 Выигрыш: ${user.won} RUB 📈`,
					`📉 Проигрыш: ${user.lost} RUB 📉`,
					`💵Профит: ${user.won - user.lost} RUB 💵\n`,
					'⚡️ Данные приведены за все время ⚡️'
				].join('\n')
			})
		}
	},
	
	{
		tag: ['🏆 рейтинг'],
		button: ['rating'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, { user, command }) {
			const winUsers = await User.find({}, { uid: 1, name: 1, won: 1 }).sort({ won: -1 }).lean() //.toArray()
			const userNum = winUsers.findIndex(x => x.uid === context.message.chat.id);
			
			let text = `🏆 ТОП 3 игроков:\n`
			for (let i = 0; i < (winUsers.length < 3 ? winUsers.length : 3); i++) {
				text += `\n🎮 ${i + 1} место - ${winUsers[i].name} выиграл - ${utils.split(winUsers[i].won)} RUB`;
			}
			text += `\n\n📈 Ваше место в рейтинге: ${userNum + 1} из ${winUsers.length} (${utils.split(user.won)} RUB) 📈`
			
			const options = {
				chat_id: context.message.chat.id,
				message_id: context.message.message_id,
				text,
				reply_markup: JSON.stringify({
					inline_keyboard: [
						[{ text: '🏆 Рейтинг одиночных игр', callback_data: '🏆 рейтинг одиночных игр' }]
					]
				})
			}
			
			if (command.type == 'tag') api.sendMessage(options)
			else if (command.type == 'button') api.editMessageText(options)
		}
	},
	
	{
		tag: ['🏆 рейтинг одиночных игр'],
		button: ['🏆 рейтинг одиночных игр'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, { user }) {
			const winUsers = await User.find({}, { uid: 1, name: 1, singleWines: 1 }).sort({ singleWines: -1 }).lean()
			const userNum = winUsers.findIndex(x => x.uid === user.uid);
			console.log(userNum)
			
			let text = `🏆 ТОП 3 игроков:\n`
			for (let i = 0; i < (winUsers.length < 3 ? winUsers.length : 3); i++) {
				text += `\n🎮 ${i + 1} место - ${winUsers[i].name} выиграл - ${utils.split(winUsers[i].singleWines)} RUB`;
			}
			text += `\n\n📈 Ваше место в рейтинге: ${userNum + 1} из ${winUsers.length} (${utils.split(user.singleWines)} RUB) 📈`
			
			api.editMessageText({
				chat_id: context.message.chat.id,
				message_id: context.message.message_id,
				text,
				reply_markup: JSON.stringify({
					inline_keyboard: [
						[{ text: '🔙 Назад', callback_data: 'rating' }]
					]
				})
			})
		}
	},
	
	{
		tag: ['пополнить'],
		button: ['replenish'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, { user, command }) {
			const cmd = command.text.split('_')[1] || undefined;
			
			if (cmd == 'qiwi') {
				const { authInfo: { personId: phone } } = await qiwi.getAccountInfo()
				const url = `https://qiwi.com/payment/form/99?currency=643&extra[%27account%27]=${phone}&amountInteger=1&amountFraction=00&extra[%27comment%27]=${context.message.chat.id}&blocked[0]=comment&blocked[1]`
				
				api.editMessageText({
					chat_id: context.message.chat.id,
					message_id: context.message.message_id,
					text: [
						'Пополнение QIWI',
						'➖➖➖➖➖➖➖➖',
						`👉 Номер: +${phone}`,
						`👉 Коментарий: ${context.message.chat.id}`,
						'➖➖➖➖➖➖➖➖',
						'',
						'⚠️Платежи без комментария, или с ошибкой зачислены не будут!'
					].join('\n'),
					reply_markup: RedirectionKeyboard(url)
				})
			}
			
			else if (cmd == 'banker') {
				const { message: { text: receipt } } = await question(`Отправьте чек в чат`, context.message.chat.id)
				
				user = await getUser(context);
				
				const amount = await checkBankerPayment(receipt).catch(err => {
					return false
				})
				
				if (amount !== false) {
					user.balance += +amount;
					api.sendMessage({
						chat_id: context.message.chat.id,
						text: `Вы успешно пополнили свой баланс ${utils.split(amount)} RUB`,
						reply_markup: PrivateKeyboard(user)
					})
					
					await user.save()
				}
			}
			
			else {
				api.editMessageText({
					chat_id: context.message.chat.id,
					message_id: context.message.message_id,
					text: 'Выбери метод пополнения',
					reply_markup: MethodKeyboard('replenish')
				})
			}
		}
	},
	
	{
		tag: ['вывод'],
		button: ['withdrawal'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, { user, command }) {
			const cmd = command.text.split('_')[1] || undefined;
			
			if (cmd == undefined) {
				return api.editMessageText({
					chat_id: context.message.chat.id,
					message_id: context.message.message_id,
					text: 'Выбери метод вывода',
					reply_markup: MethodKeyboard('withdrawal')
				})
			}
			
			if (cmd !== 'qiwi') return;
			
			let amount = await question(`Введите сумму на вывод от 100 до ${user.balance} RUB`, context.message.chat.id, buttons(['❌ Отменить']))
			amount = formatSum(amount.message.text) || undefined
			
			if (isNaN(amount)) return;
			
			else if (amount < 100) {
				return api.sendMessage({
					chat_id: context.message.chat.id,
					text: 'Минимальная сумма вывода 100 RUB',
					reply_markup: PrivateKeyboard(user)
				})
			}
			
			else if (amount > user.balance) {
				return api.sendMessage({
					chat_id: context.message.chat.id,
					text: 'Сумма вывода не может быть большей вашего баланса!',
					reply_markup: PrivateKeyboard(user)
				})
			}
			
			let phone = await question('Введите номер своего кошелька', context.message.chat.id, buttons(['❌ Отменить']))
			
			context = phone;
			user = await getUser(context);
			phone = formatSum(phone.message.text) || undefined
			
			if (isNaN(phone)) {
				return api.sendMessage({
					chat_id: context.message.chat.id,
					text: 'Не верно указан номер кошелька',
					reply_markup: PrivateKeyboard(user)
				})
			}
			
			user.balance -= amount;
			await user.save()
			
			if (cmd == 'qiwi') {
				Withdrawals.create({
					userId: context.message.chat.id,
					method: 'qiwi',
					phone,
					amount,
					time: Date.now()
				})
				
				api.sendMessage({
					chat_id: context.message.chat.id,
					text: 'Заявка на вывод создана!',
					reply_markup: PrivateKeyboard(user)
				})
				
				api.sendMessage({
					chat_id: config.telegram.adminId,
					text: `${amount} RUB || ${phone} Номер || ${context.message.chat.id} UID || QIWI.`,
					reply_markup: JSON.stringify({
						inline_keyboard: [
							[{ text: `${amount} RUB || ${phone} Номер`, callback_data: `makepayment_${requestWithdrawals.userId}_${requestWithdrawals.phone}_${requestWithdrawals.time}` }]
						]
					})
				})
			}
		}
	},
	
	{
		tag: ['активировать промокод'],
		button: ['usepromo'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, { user }) {
			const { message: { text: response } } = await question(`Введите промокод:`, context.message.chat.id, buttons(['❌ Отменить']))
			
			if (response == '❌ Отменить' || response == undefined) {
				return api.sendMessage({
					chat_id: context.message.chat.id,
					text: 'Вы успешно были перенаправлены в меню',
					reply_markup: PrivateKeyboard(user)
				})
			}
			
			const checkPromo = await Promo.findOne({ name: response });
			
			if (!checkPromo) {
				return api.sendMessage({
					chat_id: context.message.chat.id,
					text: 'Промокод не найден',
					reply_markup: PrivateKeyboard(user)
				})
			}
			
			else if (checkPromo.count == 0 || !checkPromo.status) {
				return api.sendMessage({
					chat_id: context.message.chat.id,
					text: 'У данного промокода закончились активации!',
					reply_markup: PrivateKeyboard(user)
				})
			}
			
			else if (user.promocodes.includes(response)) {
				return api.sendMessage({
					chat_id: context.message.chat.id,
					text: 'Вы уже использовали данный промокод.',
					reply_markup: PrivateKeyboard(user)
				})
			}
			user = await getUser(context);
			user.balance += +checkPromo.amount;
			user.promocodes.push(response)
			
			checkPromo.count -= 1;
			checkPromo.status = checkPromo.count <= 1 ? false : true
			
			await Promise.all([
				user.save(),
				checkPromo.save(),
				api.sendMessage({
					chat_id: context.message.chat.id,
					text: `Вы успешно использовали промкод на ${checkPromo.amount} RUB`,
					reply_markup: PrivateKeyboard(user)
				})
			])
		}
	},
	
	{
		tag: ['панель'],
		button: ['admincmd'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, { user }) {
			if (!user.isAdmin) return
			api.sendMessage({
				chat_id: context.message.chat.id,
				text: `Панель:`,
				reply_markup: AdminKeyboard
			})
		}
	},
	
	{
		tag: ['null'],
		button: ['makepayment'],
		
		type: 'TYPE_PRIVATE',
		async execute(context, { user, command }) {
			if (!user.isAdmin) return
			const Withdrawal = await Withdrawals.findOne({
				sent: false,
				userId: command.text.split('_')[1],
				phone: command.text.split('_')[2],
				time: Number(command.text.split('_')[3]),
			})
			
			if (!Withdrawal) {
				return api.sendMessage({
					chat_id: context.message.chat.id,
					text: `Заявка не было найдено!`,
				})
			}
			
			try {
				await Promise.all([
					qiwi.toWallet({
						amount: Withdrawal.amount,
						comment: `Вывод из бота`,
						account: `+${Withdrawal.phone}`,
					}),
					api.sendMessage({
						chat_id: Withdrawal.userId,
						text: `${Withdrawal.amount} RUB | Успешно отправлены вам на кошелек (${Withdrawal.phone})`,
					}),
					api.sendMessage({
						chat_id: context.message.chat.id,
						text: `${Withdrawal.amount} RUB | ${Withdrawal.phone} Номер | Успешно выплачена!`,
					})
				])
				
				Withdrawal.sent = true;
			}
			
			catch (e) {
				await api.sendMessage({
					chat_id: context.message.chat.id,
					text: `Произошла ошибка в переводе!`,
				})
			}
			
			finally {
				await Withdrawal.save()
			}
		}
	},
	
	{
		tag: ['инфа'],
		button: ['admincmd'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, { user }) {
			if (!user.isAdmin) return;
			const qiwiBalance = (await qiwi.getBalance()).accounts[0].balance.amount
			
			await api.sendMessage({
				chat_id: context.message.chat.id,
				text: [
					'Информация о боте:\n',
					`Реферальный процент ${config.percent.ref}`,
					`Игровой процент: ${config.percent.game}\n`,
					`Минимальная ставка: ${config.min_bet}`,
					`Баланс киви: ${qiwiBalance}`
				].join('\n'),
			})
		}
	},
	
	{
		tag: ['рассылка'],
		button: ['admincmd'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, { user }) {
			if (!user.isAdmin) return;
			const { message: { text: text } } = await question(`Введи текст для рассылки`, context.message.chat.id, buttons(['❌ Отменить']))
			
			if (text == '❌ Отменить') {
				return api.sendMessage({
					chat_id: context.message.chat.id,
					text: `Омена`,
					reply_markup: AdminKeyboard
				})
			}
			
			process.nextTick(async () => {
				const startedAt = Date.now()
				const users = await User.collection.find().sort({ uid: -1 }).toArray();
				
				await api.sendMessage({
					chat_id: context.message.chat.id,
					text: `📝 Рассылка будет произведена по ${users.length} пользователям.`,
					reply_markup: AdminKeyboard
				})
				
				let sentToUsers = 0
				for (const i in users) {
					const res = users[i]
					try {
						await api.sendMessage({
							chat_id: res.uid,
							text
						})
						sentToUsers++
						await sleep(150)
						} catch (error) {
						console.log(error)
					}
				}
				
				const tookTime = Math.round((Date.now() - startedAt) / 1000)
				const reportTextBuilder = [
					'📝 Отчёт о рассылке:',
					'➖➖➖➖➖➖➖➖➖',
					`⌛ Прошло времени: ${tookTime} ${declOfNum(tookTime, ['секунда', 'секунды', 'секунд'])}.`,
					`🔗 Всего доставлено: ${sentToUsers} ${declOfNum(sentToUsers, ['сообщение', 'сообщения', 'сообщений'])}.`,
					'➖➖➖➖➖➖➖➖➖',
				]
				
				await api.sendMessage({
					chat_id: context.message.chat.id,
					text: reportTextBuilder.join('\n')
				})
			})
		}
	},
	
	{
		tag: ['выдать'],
		button: ['admincmd'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, { user }) {
			if (!user.isAdmin) return
			
			const cmd = context.message.text.split(' ')[1] || undefined
			let text = ''
			
			if (cmd == undefined) return;
			
			const { message: { text: userId } } = await question(`Введи айди юзера`, context.message.chat.id)
			
			if (isNaN(userId)) return
			const editUser = await User.findOne({ uid: userId })
			
			if (!editUser) {
				return api.sendMessage({
					chat_id: context.message.chat.id,
					text: `Юзер не найден в боте!`,
					reply_markup: AdminKeyboard
				})
			}
			
			if (cmd == 'валюту') {
				let { message: { text: value } } = await question(`Сколько хочешь выдать?`, context.message.chat.id)
				value = formatSum(value)
				
				if (isNaN(value)) {
					return api.sendMessage({
						chat_id: context.message.chat.id,
						text: `Не правильная сумма!`,
						reply_markup: AdminKeyboard
					})
				}
				
				editUser.balance += +value;
				text += `Вы успешно выдали игроку (${editUser.name}) ${cmd} (${value} РУБ)`
			}
			
			else if (cmd == 'админку') {
				editUser.isAdmin = true;
				text += `Вы успешно выдали игроку (${editUser.name}) ${cmd}`
			}
			
			else if (cmd == 'подкрутку') {
				const isHappy = !editUser.isTwist
				editUser.isTwist = isHappy
				text += `Значение игрока на подкрутке ${isHappy} (${editUser.name}) ${cmd}`
			}
			
			else if (cmd == 'бан') {
				if (editUser.isAdmin) return api.sendMessage({
					chat_id: context.message.chat.id,
					text: `Администратору нельзя выдать бан`,
					reply_markup: AdminKeyboard
				})
				editUser.isBan = true;
				text += `Вы успешно выдали (${editUser.name}) бан`
			}
			
			else if (cmd == 'разбан') {
				editUser.isBan = false;
				text += `Вы успешно разбанили игрока (${editUser.name})`
			}
			
			else {
				return api.sendMessage({
					chat_id: context.message.chat.id,
					text: `Не распознал твой выбор`,
					reply_markup: AdminKeyboard
				})
			}
			
			await Promise.all([
				editUser.save(),
				api.sendMessage({
					chat_id: context.message.chat.id,
					text: text,
					reply_markup: AdminKeyboard
				})
			])
		}
	},
	
	{
		tag: ['регулировка'],
		button: ['admincmd'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, { user }) {
			if (!user.isAdmin) return;
			
			const cmd = context.message.text.split(' ')[1] || undefined
			let text = ''
			
			if (cmd == undefined || !cmd == 'комиссии' || !cmd == 'реф.%') return;
			
			const { message: { text: percent } } = await question('Какой процент хочешь установить?', context.message.chat.id)
			
			if (isNaN(percent)) return
			
			if (cmd == 'комиссии') {
				text += `Вы успешно установили ${percent} % комиссии с каждой игры`
				config.percent.game = Number(percent);
			}
			
			else if (cmd == 'реф.%') {
				text += `Вы успешно установили ${percent} % реферала`
				config.percent.ref = Number(percent);
			}
			
			fs.writeFileSync('./config.json', JSON.stringify(config, null, 2))
			await api.sendMessage({
				chat_id: context.message.chat.id,
				text: text,
				reply_markup: AdminKeyboard
			})
		}
	},
	
	{
		tag: ['создать промокод'],
		button: ['admincmd'],
		
		type: 'TYPE_PRIVATE',
		
		async execute(context, { user }) {
			if (!user.isAdmin) return
			
			const { message: { text: namePromo } } = await question('Название промокода который хочешь создать', context.message.chat.id, buttons(['❌ Отменить']))
			
			if (namePromo == '❌ Отменить' || namePromo == undefined) {
				return api.sendMessage({
					chat_id: context.message.chat.id,
					text: 'Вы успешно были перенаправлены в меню'
				})
			}
			
			let { message: { text: discountPromo } } = await question('Сумма', context.message.chat.id)
			discountPromo = formatSum(discountPromo)
			
			if (isNaN(discountPromo)) return;
			
			let { message: { text: countPromo } } = await question('Количество использований', context.message.chat.id)
			countPromo = formatSum(countPromo)
			
			if (isNaN(countPromo)) return;
			
			Promo.create({
				name: namePromo,
				amount: discountPromo,
				count: countPromo,
				status: true
			})
			
			await Promise.all([
				savePromo.save(),
				api.sendMessage({
					chat_id: context.message.chat.id,
					text: `Вы успешно создали промокод:\n\nСумма: ${discountPromo} RUB\nКоличество использований: ${countPromo}`,
					reply_markup: AdminKeyboard
				})
			]);
		}
	},
]

/*
	/ on_message => event message_new
*/

const defferred = [];
const on_message = async (context, next) => {
	const startTime = Date.now(); // Записываем время - во сколько пришло сообщение
	
	context = context.message ? context : context.callback_query
	const floodControl = await antiFlood.plugin(context.message.chat.id, startTime)
	if (floodControl) {
		return api.sendMessage({
			chat_id: context.message.chat.id,
			text: 'Перестань спамить! (мут 7 секунд)',
		})
	}
	
	defferred.forEach(async (data) => {
		if (data.user_id == context.message.chat.id) {
			data.def.resolve(context);
			return defferred.splice(defferred.indexOf(data), 1);
		}
	});
	
	question = async (text, id, keyboard, params = undefined) => {
		if(params == 'edit') {
			await api.editMessageText({
				chat_id: id,
				message_id: context.message.message_id,
				text: text,
				reply_markup: keyboard
			})
		}
		else {
			api.sendMessage({
				chat_id: id,
				text: text,
				reply_markup: keyboard
			})
		}

		let def = deferred();
		defferred.push({ user_id: id, def });
		
		return await def.promise((data) => { return data.message ? data : data.callback_query; });
	}
	
	const user = await getUser(context) // получение юзера
	if (user.isBan) return;
	
	let command = null;
	
	for (const com of cmds) {
		const isChat = context.message.chat.type == 'private' ? 'TYPE_PRIVATE' : 'TYPE_CONVERSATION'; // получаем тип чат
		
		if (com.type != 'TYPE_ALL' && com.type != isChat) {
			continue;
		}
		
		const typeCommand = context.data ? 'button' : 'tag'; // параметр button или tag для поиска команды
		const textCommand = context.data ? context.data : context.message.text // получаем текст команда (Инлайн кнопки/Обычерй
		
		if (
			(typeof com[typeCommand] == "object" && !Array.isArray(com[typeCommand]) && com[typeCommand].test(textCommand))
			|| (new RegExp(`^\\s*(${com[typeCommand].join('|')})`, "i")).test(textCommand)
			) {
			command = { cmd: com, type: typeCommand, text: textCommand, params: textCommand.split(typeCommand === 'button' ? '_' : ' ').splice(1) };
			break;
		}
		
	}
	
	// Выполнение CMD
	try {
		if (command == null) {
			return;
		}
		
		await command.cmd.execute(context, { command, user });
	}
	
	catch (e) {
		console.log(`Произошла ошибка!`, e);
	}
	
	finally {
		// user.save();
		
		const endTime = Date.now(); // Время - когда закончилась выполняться команда
		console.log(`Команда была выполнена за ${endTime - startTime} ms.`);
	}
}

/* Всё что касается оплаты через banker и mtproto
*/

const checkAuth = async () => {
	return new Promise((resolve, reject) => {
		mtproto.call(
			'users.getFullUser',
			{ id: { _: 'inputUserSelf' } }
			).then(resolve, err => {
				if (err.error_message === 'AUTH_KEY_UNREGISTERED') {
					reject('Необходима авторизация')
				} else reject(err)
			})
	})
}

const resolveUsername = async () => {
	const resolved = await mtproto.call('contacts.resolveUsername', {
		username: config.banker.username
	})
	return resolved.users[0]
}

const messageHandler = (message, isDurovPidor) => {
	const sucessRegEx = /^Вы получили \d+\.\d+ BTC \((\d+\.\d+) RUB\) от \/u.+!$/
	if (isDurovPidor ?
		(message.user_id === global.banker.id) :
		(message.peer_id._ === 'peerUser' &&
		message.peer_id.user_id === global.banker.id)
		) {
		if (message.message === 'Упс, кажется, данный чек успел обналичить кто-то другой 😟') {
			const { resolve } = global.banker.awaitResponse.splice(0, 1)[0]
			resolve(false)
			} else if (message.message.match(sucessRegEx)) {
			const { resolve, reject } = global.banker.awaitResponse.splice(0, 1)[0]
			const amount = Number(message.message.match(sucessRegEx)[1])
			if (isNaN(amount)) {
				console.error('Ошибка при пополнении через банкер')
				reject('При проверке платежа произошла ошибка. Свяжитесь с администрацией\nКод ошибки: 0')
			} else resolve(amount)
		}
	}
}

const checkBankerPayment = link => {
	const linkRegEx = /^https:\/\/telegram\.me\/BTC_CHANGE_BOT\?start=(c_[0-9a-f]+)$/
	return new Promise(async (resolve, reject) => {
		if (!link.match(linkRegEx)) {
			reject('Неверный чек')
			return
		}
		const result = await mtproto.call('messages.startBot', {
			start_param: link.match(linkRegEx)[1],
			random_id: utils.random(0, 9e9),
			peer: {
				_: 'inputPeerUser',
				user_id: global.banker.id,
				access_hash: global.banker.access_hash
			},
			bot: { // я не знаю нахуя 2 раза писать одно и то же
				_: 'inputUser', // просто взял и спиздил с доков
				user_id: global.banker.id,
				access_hash: global.banker.access_hash
			}
			}).catch(err => {
			console.error(err)
			reject('При проверке платежа произошла ошибка. Свяжитесь с администрацией\nКод ошибки: 1')
			return false
		})
		if (result !== false)
		global.banker.awaitResponse.push({ resolve, reject }) // по идее всё должно работать))))))
	})
}

const handleMtproto = async () => {
	await checkAuth()
	global.banker = await resolveUsername()
	global.banker.awaitResponse = []
	
	mtproto.updates.on('updateShortMessage', update => {
		messageHandler(update, true) // дуров пидор пофакту
	})
	
	mtproto.updates.on('updates', updates => {
		updates.updates.forEach(update => {
			if (update._ === 'updateNewMessage') {
				messageHandler(update.message, false)
			}
		})
	})
}

/*
	/ Запуск бота
*/

const start = async () => {
	try {
		const { urlDB, dbName } = config.db;
		await Promise.all([
			api.setMessageProvider(mp),
			api.start(),
			api.on('update', on_message),
			mongoose.connect(urlDB, {
				dbName,
				useNewUrlParser: true,
				useUnifiedTopology: true
			}),
			handleMtproto()
		])
	}
	
	catch (e) {
		console.log(`Произошла ошибка при запуске - `, e);
		process.exit(1);
	}
	
	finally {
		console.log(`Успешно запущен!`);
	}
}

start();


setInterval(async() => {
	const responseQiwi = (await qiwi.getOperationHistory({
		rows: 25,
		operation: 'IN',
		sources: ['QW_RUB']
	})).data // история платежей qiwi
	
	responseQiwi.map(async (operation) => {
		let check = await Payment.findOne({ id: Number(operation.txnId), system: 'qiwi' }); // Проверяем транзакцию в базе данных
		if (check || !operation.comment) return; // если есть транзакция или же нет комментария в платеже пропускаем платеж
		
		if (!isNaN(operation.comment)) {
			const id = Number(operation.comment); // получаем айди юзера
			let user = await User.findOne({ uid: id }); // ищем юзера в бд
			
			if (!user) return; // если юзера нет пропускаем платеж
			
			const amount = Number(operation.sum.amount).toFixed(2); // форматируем сумму платежа
			
			if (user.refId) { // Если юзер является рефералом
				try {
					const refUser = await User.findOne({ uid: user.refId }) // ищем реферала в бд
					refUser.balance += amount / 100 * config.percent.ref; // Считаем и добавляем ему к балансу % от суммы пополнения
					await refUser.save(); // Сохраняем
				} catch (_) { }
			}
			
			api.sendMessage({
				chat_id: id,
				text: `Вы успешно пополнили свой баланс на сумму ${amount} RUB`
			})
			
			Payment.create({
				id: Number(operation.txnId),
				uid: id,
				system: 'qiwi'
			})
			
			user.balance += +amount;
			user.save()
		}
	})
}, 60000)																
