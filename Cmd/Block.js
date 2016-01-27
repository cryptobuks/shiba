'use strict';

const co          = require('co');
const debug       = require('debug')('shiba:cmd:block');
const debugnotify = require('debug')('shiba:blocknotify');
const Pg          = require('../Pg');
const Blockchain  = require('../Util/Blockchain');
const Lib         = require('../Lib');

function CmdBlock(block, blockNotify) {
  this.block       = block;
  // Map 'channelName': ['user1', 'user2', ...]
  this.blockNotify = blockNotify;
  this.client      = null;

  this.blockchain  = new Blockchain();
  this.blockchain.on('block', this.onBlock.bind(this));
}

CmdBlock.prototype.setClient = function(client) {
  this.client = client;
};

CmdBlock.prototype.onBlock = function(block) {
  let newBlock = {
    height: block.height,
    hash: block.hash,
    confirmation: new Date(block.time * 1000),
    notification: new Date()
  };

  let self = this;
  co(function*() {
    yield* Pg.putBlock(newBlock);

    // Check if block is indeed new and only signal in this case.
    if (newBlock.height > self.block.height) {
      self.block = newBlock;

      if (self.client && self.blockNotify.size > 0) {
        for (let channelName of self.blockNotify.keys()) {
          let userList = self.blockNotify.get(channelName);
          let users = userList.map(s => '@' + s).join(', ') + ': ';
          let line = users + 'Block #' + newBlock.height + ' mined.';
          self.client.doSay(line, channelName);
        }

        self.blockNotify.clear();
        yield* Pg.clearBlockNotifications();
      }
    }
  }).catch(err => console.error('[ERROR] onBlock:', err));
};

/* eslint no-unused-vars: 0 */
CmdBlock.prototype.handle = function*(client, msg, input) {
  debug('Handling cmd block for user: %s', msg.username);

  let time  = this.block.notification;
  let diff  = Date.now() - time;

  let line = 'Seen block #' + this.block.height;
  if (diff < 1000) {
    line += ' just now.';
  } else {
    line += ' ';
    line += Lib.formatTimeDiff(diff);
    line += ' ago.';
  }

  let channel = this.blockNotify.get(msg.channelName);
  if (!channel) {
    debugnotify(
      "Creating notification for channel '%s' with user '%s'",
      msg.channelName, msg.username
    );
    this.blockNotify.set(msg.channelName, [msg.username]);
    yield* Pg.putBlockNotification(msg.username, msg.channelName);
  } else if (channel.indexOf(msg.username) < 0) {
    debugnotify(
      "Adding user '%s' to the channel '%s'",
      msg.username, msg.channelName
    );
    channel.push(msg.username);
    yield* Pg.putBlockNotification(msg.username, msg.channelName);
  } else {
    debugnotify(
      "Already notifying user '%s' on channel '%s'",
      msg.username, msg.channelName
    );
    line += ' ' + msg.username + ': Have patience!';
  }

  this.client.doSay(line, msg.channelName);
};

function* mkCmdBlock() {
  // Last received block information.
  let block = yield* Pg.getLatestBlock();

  // Awkward name for an array that holds names of users which
  // will be notified when a new block has been mined.
  let blockNotifyUsers = yield* Pg.getBlockNotifications();

  return new CmdBlock(block, blockNotifyUsers);
}

module.exports = exports = mkCmdBlock;
