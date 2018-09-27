'use strict';


const  TelegramBot = require('node-telegram-bot-api');
const  Debug = require('debug');
const  Promise = require('bluebird');
const  TelegramServer = require('../src/telegramServer');

const debug = Debug('TelegramServer:test');
const debugServerUpdate = Debug('TelegramServer:test:serverUpdate');
const debugBotMessage = Debug('TelegramServer:test:botMessage');

class Logger {
  static serverUpdate(...args) {
    debugServerUpdate(JSON.stringify(args));
  }

  static botMessages(...args) {
    debugBotMessage(JSON.stringify(args));
  }
}

class TestBot {
  constructor(bot) {
    bot.onText(/\/ping/, (msg, match) => {
      const chatId = msg.from.id;
      const opts = {
        reply_to_message_id: msg.message_id,
        reply_markup: JSON.stringify({
          keyboard: [[{text: 'ok 1'}]],
        }),
      };
      bot.sendMessage(chatId, 'pong', opts);
    });

    bot.onText(/\/start/, (msg, match) => {
      const chatId = msg.from.id;
      const opts = {
        reply_to_message_id: msg.message_id,
        reply_markup: JSON.stringify({
          keyboard: [[{text: 'Masha'}, {text: 'Sasha'}]],
        }),
      };
      bot.sendMessage(chatId, 'What is your name?', opts);
    });

    bot.onText(/Masha/, (msg, match) => {
      const chatId = msg.from.id;
      const opts = {
        reply_to_message_id: msg.message_id,
        reply_markup: JSON.stringify({
          keyboard: [[{text: 'Hello!'}]],
        }),
      };
      bot.sendMessage(chatId, 'Hello, Masha!', opts);
    });

    bot.onText(/Sasha/, (msg, match) => {
      const chatId = msg.from.id;
      const opts = {
        reply_to_message_id: msg.message_id,
        reply_markup: JSON.stringify({
          keyboard: [[{text: 'Hello!'}]],
        }),
      };
      bot.sendMessage(chatId, 'Hello, Sasha!', opts);
    });
  }
}


TelegramBot.prototype.waitForReceiveUpdate = function waitForReceiveUpdate() {
  const self = this;
  return new Promise((resolve) => {
    self.on('message', (msg) => {
      Logger.serverUpdate(msg);
      resolve(msg);
    });
  });
};

describe('Telegram Server', () => {
  const serverConfig = {port: 9001};
  const token = 'sampleToken';
  let server;
  let client;
  beforeEach(() => {
    server = new TelegramServer(serverConfig);
    return server.start().then(() => {
      client = server.getClient(token);
    });
  });

  afterEach(function () {
    this.slow(2000);
    this.timeout(10000);
    console.log('\n\n');
    return server.stop();
  });

  it('should receive user`s messages', function sendClientMessages() {
    this.slow(200);
    this.timeout(1000);
    const message = client.makeMessage('/start');
    return client.sendMessage(message);
  });

  it('should provide user messages to bot', function testGetUserMessages() {
    this.slow(200);
    this.timeout(1000);
    const message = client.makeMessage('/start');
    let telegramBot;
    return client.sendMessage(message)
      .then(() => {
        const botOptions = {polling: true, baseApiUrl: server.ApiURL};
        telegramBot = new TelegramBot(token, botOptions);
        return telegramBot.waitForReceiveUpdate();
      }).then(() => {
        debug('Stopping polling');
        return telegramBot.stopPolling();
      })
      .then(() => {
        debug('Polling stopped');
      });
  });

  it('should receive bot`s messages', function testBotReceiveMessages() {
    this.slow(200);
    this.timeout(10000);
    const message = client.makeMessage('/start');
    let telegramBot;
    let testBot;
    const botWaiter = server.waitBotMessage();
    return client.sendMessage(message)
      .then(() => {
        const botOptions = {polling: true, baseApiUrl: server.ApiURL};
        telegramBot = new TelegramBot(token, botOptions);
        testBot = new TestBot(telegramBot);
        return telegramBot.waitForReceiveUpdate();
      }).then(() => {
        debug('Stopping polling');
        return telegramBot.stopPolling();
      })
      .then(() => {
        debug('Polling stopped');
        return botWaiter;
      })// wait until bot reply appears in storage
      .then(() => {
        Logger.botMessages(server.storage);
        if (server.storage.botMessages.length !== 1) {
          throw new Error('Message queue should contain one message!');
        }
        return true;
      });
  });


  it('should provide bot`s messages to client', function testClientGetUpdates() {
    this.slow(200);
    this.timeout(1000);
    const message = client.makeMessage('/start');
    let telegramBot;
    let testBot;
    const botWaiter = server.waitBotMessage();
    return client.sendMessage(message)
      .then(() => {
        const botOptions = {polling: true, baseApiUrl: server.ApiURL};
        telegramBot = new TelegramBot(token, botOptions);
        testBot = new TestBot(telegramBot);
        return telegramBot.waitForReceiveUpdate();
      }).then(() => {
        debug('Stopping polling');
        return telegramBot.stopPolling();
      })
      .then(() => {
        debug('Polling stopped');
        return botWaiter;
      })// wait until bot reply appears in storage
      .then(() => client.getUpdates())
      .then((updates) => {
        Logger.serverUpdate(updates.result);
        if (updates.result.length !== 1) {
          throw new Error('updates queue should contain one message!');
        }
        return true;
      });
  });


  it('should fully implement user-bot interaction', function testFull() {
    this.slow(400);
    this.timeout(1000);
    let message = client.makeMessage('/start');
    let telegramBot;
    let testBot;
    return client.sendMessage(message)
      .then(() => {
        const botOptions = {polling: true, baseApiUrl: server.ApiURL};
        telegramBot = new TelegramBot(token, botOptions);
        testBot = new TestBot(telegramBot);
        return client.getUpdates();
      })
      .then((updates) => {
        Logger.serverUpdate(updates.result);
        if (updates.result.length !== 1) {
          throw new Error('updates queue should contain one message!');
        }
        const keyboard = JSON.parse(updates.result[0].message.reply_markup).keyboard;
        message = client.makeMessage(keyboard[0][0].text);
        client.sendMessage(message);
        return client.getUpdates();
      })
      .then((updates) => {
        Logger.serverUpdate(updates.result);
        if (updates.result.length !== 1) {
          throw new Error('updates queue should contain one message!');
        }
        if (updates.result[0].message.text !== 'Hello, Masha!') {
          throw new Error('Wrong greeting message!');
        }
        debug('Stopping polling');
        return telegramBot.stopPolling();
      })
      .then(() => {
        debug('Polling stopped');
        return true;
      });
  });
});
