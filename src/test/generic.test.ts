/* eslint-disable sonarjs/no-duplicate-string */

import debug from 'debug';
import { assert } from 'chai';
import TelegramBot from 'node-telegram-bot-api';
import type { InlineKeyboardMarkup, KeyboardButton, ReplyKeyboardMarkup } from 'typegram';
import { getServerAndClient, assertEventuallyTrue, delay } from './utils';
import {
  TelegramBotEx,
  attachMessageHandler,
  DeleterBot,
  CallbackQBot,
  Logger,
} from './testBots';
import type { StoredBotUpdate } from '../telegramServer';

const debugTest = debug('TelegramServer:test');

function isReplyKeyboard(markup: object | undefined): markup is ReplyKeyboardMarkup {
  return markup !== undefined && 'keyboard' in markup;
}
function isInlineKeyboard(markup: object | undefined): markup is InlineKeyboardMarkup {
  return markup !== undefined && 'inline_keyboard' in markup;
}
function isCommonButton(btn: unknown): btn is KeyboardButton.CommonButton {
  return typeof btn === 'object' && btn !== null && 'text' in btn;
}
function isBotUpdate(upd: object | undefined): upd is StoredBotUpdate {
  return upd !== undefined && 'message' in upd;
}

describe('Telegram Server', () => {
  const token = 'sampleToken';

  it('should receive user`s messages', async () => {
    const { server, client } = await getServerAndClient(token);
    const message = client.makeMessage('/start');
    const res = await client.sendMessage(message);
    await server.stop();
    assert.equal(true, res.ok);
  });

  it('should provide user messages to bot', async () => {
    const { server, client } = await getServerAndClient(token);
    const message = client.makeMessage('/start');
    const res = await client.sendMessage(message);
    assert.equal(true, res.ok);
    const botOptions = { polling: true, baseApiUrl: server.config.apiURL };
    const telegramBot = new TelegramBotEx(token, botOptions);
    const res2 = await telegramBot.waitForReceiveUpdate();
    debugTest('Stopping polling');
    await telegramBot.stopPolling();
    debugTest('Polling stopped');
    await server.stop();
    assert.equal('/start', res2.text);
  });

  it('should receive bot`s messages', async () => {
    const { server, client } = await getServerAndClient(token);
    const message = client.makeMessage('/start');
    const botWaiter = server.waitBotMessage();
    const res = await client.sendMessage(message);
    assert.equal(true, res.ok);
    const botOptions = { polling: true, baseApiUrl: server.config.apiURL };
    const telegramBot = new TelegramBotEx(token, botOptions);
    attachMessageHandler(telegramBot);
    const res2 = await telegramBot.waitForReceiveUpdate();
    assert.equal('/start', res2.text);
    debugTest('Stopping polling');
    await telegramBot.stopPolling();
    debugTest('Polling stopped');
    await botWaiter; // wait until bot reply appears in storage
    Logger.botMessages(server.storage);
    assert.equal(
      1,
      server.storage.botMessages.length,
      'Message queue should contain one message!',
    );
    await server.stop();
  });

  it('should provide bot`s messages to client', async () => {
    const { server, client } = await getServerAndClient(token);
    const message = client.makeMessage('/start');
    const botWaiter = server.waitBotMessage();
    const res = await client.sendMessage(message);
    assert.equal(true, res.ok);
    const botOptions = { polling: true, baseApiUrl: server.config.apiURL };
    const telegramBot = new TelegramBotEx(token, botOptions);
    attachMessageHandler(telegramBot);
    const res2 = await telegramBot.waitForReceiveUpdate();
    assert.equal('/start', res2.text);
    debugTest('Stopping polling');
    await telegramBot.stopPolling();
    debugTest('Polling stopped');
    await botWaiter;
    const updates = await client.getUpdates();
    Logger.serverUpdate(updates.result);
    assert.equal(
      1,
      updates.result.length,
      'Updates queue should contain one message!',
    );
    await server.stop();
  });

  it('should message in response to /sendMessage', (done) => {
    getServerAndClient(token).then(({ server, client }) => {
      const botOptions = { polling: true, baseApiUrl: server.config.apiURL };
      const bot = new TelegramBot(token, botOptions);
      bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        if (!chatId) return;
        const reply = await bot.sendMessage(chatId, 'ololo #azaza', {
          reply_to_message_id: msg.message_id,
          reply_markup: {
            inline_keyboard: [[{text: 'foo', callback_data: 'bar'}]],
          },
        });
        const update = server.getUpdatesHistory(token).find((upd) => reply.message_id === upd.messageId);
        if (!isBotUpdate(update)) {
          assert.fail('Cannot find bot update with messageId porvided in response');
        }
        assert.equal(update.message.text, reply.text);
        if (!isInlineKeyboard(update.message.reply_markup)) {
          assert.fail('Wrong keyboard type in stored update');
        }
        assert.deepEqual(reply.reply_markup, update.message.reply_markup!);

        await server.stop();
        await bot.stopPolling();
        done();
      });

      return client.sendMessage(client.makeMessage('/start'));
    }).catch((err) => assert.fail(err));
  });

  it('waits user message', async () => {
    const { server, client } = await getServerAndClient(token);
    client.sendCommand(client.makeCommand('/start'));
    await server.waitUserMessage();
    const history = await client.getUpdatesHistory();
    assert.equal(history.length, 1);
    await server.stop();
  });

  it('should fully implement user-bot interaction', async () => {
    const { server, client } = await getServerAndClient(token);
    let message = client.makeMessage('/start');
    const res = await client.sendMessage(message);
    assert.equal(true, res.ok);
    const botOptions = { polling: true, baseApiUrl: server.config.apiURL };
    const telegramBot = new TelegramBotEx(token, botOptions);
    attachMessageHandler(telegramBot);
    const updates = await client.getUpdates();
    Logger.serverUpdate(updates.result);
    assert.equal(
      1,
      updates.result.length,
      'Updates queue should contain one message!',
    );
    const markup = updates.result[0].message.reply_markup!;
    if (!isReplyKeyboard(markup) || !isCommonButton(markup.keyboard[0][0])) {
      throw new Error('No keyboard in update');
    }
    message = client.makeMessage(markup.keyboard[0][0].text);
    await client.sendMessage(message);
    const updates2 = await client.getUpdates();
    Logger.serverUpdate(updates2.result);
    debugTest('Stopping polling');
    await telegramBot.stopPolling();
    debugTest('Polling stopped');
    await server.stop();
    assert.equal(
      1,
      updates2.result.length,
      'Updates queue should contain one message!',
    );
    assert.equal(
      'Hello, Masha!',
      updates2.result[0].message.text,
      'Wrong greeting message!',
    );
  });

  it('should get updates only for respective client', async () => {
    const { server, client } = await getServerAndClient(token);
    const botOptions = {polling: true, baseApiUrl: server.config.apiURL};
    const telegramBot = new TelegramBotEx(token, botOptions);
    attachMessageHandler(telegramBot);
    const client2 = server.getClient(token, {chatId: 2, firstName: 'Second User'});
    await client.sendMessage(client.makeMessage('/start'));
    await client2.sendMessage(client2.makeMessage('/start'));
    const updates = await client.getUpdates();
    const updates2 = await client2.getUpdates();
    assert.equal(updates.result.length, 1);
    assert.equal(updates2.result.length, 1);
    await telegramBot.stopPolling();
    await server.stop();
  });

  it('should get updates history', async () => {
    const { server, client } = await getServerAndClient(token);
    let message = client.makeMessage('/start');
    const res = await client.sendMessage(message);
    assert.equal(true, res.ok);
    const botOptions = { polling: true, baseApiUrl: server.config.apiURL };
    const telegramBot = new TelegramBotEx(token, botOptions);
    attachMessageHandler(telegramBot);
    const updates = await client.getUpdates();
    Logger.serverUpdate(updates.result);
    assert.equal(
      1,
      updates.result.length,
      'Updates queue should contain one message!',
    );
    const markup = updates.result[0].message.reply_markup!;
    if (!isReplyKeyboard(markup) || !isCommonButton(markup.keyboard[0][0])) {
      throw new Error('No keyboard in update');
    }
    message = client.makeMessage(markup.keyboard[0][0].text);
    await client.sendMessage(message);
    const updates2 = await client.getUpdates();
    Logger.serverUpdate(updates2.result);
    assert.equal(
      1,
      updates2.result.length,
      'Updates queue should contain one message!',
    );
    assert.equal(
      'Hello, Masha!',
      updates2.result[0].message.text,
      'Wrong greeting message!',
    );

    const history = await client.getUpdatesHistory();
    debugTest('Stopping polling');
    await telegramBot.stopPolling();
    debugTest('Polling stopped');
    await server.stop();
    assert.equal(history.length, 4);
    history.forEach((item, index) => {
      assert.ok(item.time);
      assert.ok(item.botToken);
      assert.ok('message' in item && item.message);
      assert.ok(item.updateId);
      assert.ok(item.messageId);
      if (index > 0) {
        assert.isAbove(item.time, history[index - 1].time);
      }
    });
  });

  it('should allow messages deletion', async () => {
    const { server, client } = await getServerAndClient(token);
    const botOptions = { polling: true, baseApiUrl: server.config.apiURL };
    const telegramBot = new DeleterBot(token, botOptions);
    let message = client.makeMessage('delete'); // Should be deleted
    const res = await client.sendMessage(message);
    assert.ok(res.ok);
    message = client.makeMessage('keep safe'); // Shouldn't be deleted
    const res2 = await client.sendMessage(message);
    assert.ok(res2.ok);
    await assertEventuallyTrue(
      500,
      'User messages count should become 1',
      () => server.storage.userMessages.length === 1,
    );
    debugTest('Stopping polling');
    await telegramBot.stopPolling();
    await server.stop();
  });

  it('should receive user`s callbacks', async () => {
    const { server, client } = await getServerAndClient(token);
    const cb = client.makeCallbackQuery('somedata');
    const res = await client.sendCallback(cb);
    await server.stop();
    assert.equal(true, res.ok);
  });

  it('should provide user`s callbacks to bot', async () => {
    const { server, client } = await getServerAndClient(token);
    const cb = client.makeCallbackQuery('somedata');
    const res = await client.sendCallback(cb);
    assert.equal(true, res.ok);
    const botOptions = { polling: true, baseApiUrl: server.config.apiURL };
    const telegramBot = new CallbackQBot(token, botOptions);
    const res2 = await telegramBot.waitForReceiveUpdate();
    debugTest('Stopping polling');
    await telegramBot.stopPolling();
    debugTest('Polling stopped');
    await server.stop();
    assert.equal('somedata', res2.data);
  });

  it('should handle message editing', async () => {
    const { server, client } = await getServerAndClient(token);
    const bot = new TelegramBot(token, {baseApiUrl: server.config.apiURL, polling: true});
    bot.onText(/\/start/, (msg) => {
      const chatId = msg.from!.id;
      bot.sendMessage(chatId, 'Greetings');
    });
    bot.on('callback_query', (query) => {
      if (query.data === 'edit') {
        bot.editMessageText(
          'Edited',
          {chat_id: query.message!.chat.id, message_id: query.message!.message_id},
        );
      }
    });
    await client.sendCommand(client.makeCommand('/start'));
    const startUpdates = await client.getUpdates();
    const botReply = startUpdates.result[0];
    assert.exists(botReply);
    assert.equal(botReply.message.text, 'Greetings');

    const cb = client.makeCallbackQuery('edit', {message: {message_id: botReply.messageId}});
    await client.sendCallback(cb);
    await server.waitBotEdits();
    const allUpdates = await client.getUpdatesHistory();
    const targetUpdte = allUpdates.find((update) => update.messageId === botReply.messageId);
    assert.equal(targetUpdte && 'message' in targetUpdte && targetUpdte.message.text, 'Edited');
    await bot.stopPolling();
    await server.stop();
  });

  it('should handle reply markup editing', async () => {
    const { server, client } = await getServerAndClient(token);
    const bot = new TelegramBot(token, {baseApiUrl: server.config.apiURL, polling: true});
    bot.onText(/\/start/, (msg) => {
      const chatId = msg.from!.id;
      bot.sendMessage(chatId, 'Greetings', {
        reply_markup: {
          inline_keyboard: [
            [{
              text: 'Button',
              callback_data: 'button',
            }],
          ],
        },
      });
    });
    bot.on('callback_query', (query) => {
      if (query.data === 'edit_markup') {
        bot.editMessageReplyMarkup(
          {
            inline_keyboard: [
              [{
                text: 'EditedButton',
                callback_data: 'edited_button',
              }],
            ],
          },
          {chat_id: query.message!.chat.id, message_id: query.message!.message_id},
        );
      }
    });
    await client.sendCommand(client.makeCommand('/start'));
    const startUpdates = await client.getUpdates();
    const botReply = startUpdates.result[0];
    assert.exists(botReply);
    const replyMarkup = botReply.message.reply_markup;
    if (!isInlineKeyboard(replyMarkup)) {
      assert.fail('Wrong keyboard type in request');
    }
    assert.equal(replyMarkup.inline_keyboard[0][0].text, 'Button');

    const cb = client.makeCallbackQuery('edit_markup', {message: {message_id: botReply.messageId}});
    await client.sendCallback(cb);
    await server.waitBotEdits();
    const allUpdates = await client.getUpdatesHistory();
    const targetUpdate = allUpdates.find((update) => update.messageId === botReply.messageId);
    assert.isTrue(!!targetUpdate && 'message' in targetUpdate);
    const replyMarkupEdited = (targetUpdate as StoredBotUpdate).message.reply_markup;
    if (!isInlineKeyboard(replyMarkupEdited)) {
      assert.fail('Wrong keyboard type in stored update');
    }
    assert.equal(replyMarkupEdited.inline_keyboard[0][0].text, 'EditedButton');
    await bot.stopPolling();
    await server.stop();
  });

  it('should remove messages on storeTimeout', async () => {
    const { server, client } = await getServerAndClient(token, {
      storeTimeout: 1,
    });
    const message = client.makeMessage('/start');
    await client.sendMessage(message);
    assert.equal(server.storage.userMessages.length, 1);
    debugTest('equal 1 ok');
    await delay(2100);
    debugTest('waited for delay');
    debugTest('server.storage.userMessages', server.storage.userMessages);
    assert.equal(server.storage.userMessages.length, 0);
    await server.stop();
  });
});
