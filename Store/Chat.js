'use strict';

const EventEmitter = require('events').EventEmitter;
const inherits     = require('util').inherits;
const debug        = require('debug')('shiba:store:chat');
const debugv       = require('debug')('verbose:store:chat');
const _            = require('lodash');
const Config       = require('../Config');
const Pg           = require('../Pg');

function ChatStore(store) {
  debug('Initializing chat store');
  EventEmitter.call(this);

  // This array holds all the chat messages sorted from
  // old to new.
  this.store = store || [];
}

inherits(ChatStore, EventEmitter);

function eqMsg(a, b) {
  /* eslint no-multi-spaces: 0 */
  let res =
    a.message   === b.message &&
    a.moderator === b.moderator &&
    a.type      === b.type &&
    a.username  === b.username &&
    new Date(a.date).getTime() ===
    new Date(b.date).getTime();
  return res;
}

ChatStore.prototype.mergeMessages = function*(msgs) {
  // Rofl, They are sometimes not sorted. DB race?
  /*
  // Make sure messages are sorted increasingly by time.
  var t = new Date(0);
  _.forEach(msgs, function(msg) {
    console.assert(msg.hasOwnProperty('date'));
    var d = new Date(msg.date);
    console.assert(t <= d);
    t = d;
  });
  */

  let na = msgs, oa = this.store;
  let m  = [];
  let ni = 0, oi = 0;

  for (;;) {
    if (!(oi < oa.length)) {
      // No more old messages just import the new ones.
      let newMsgs = na.splice(ni);
      if (newMsgs.length > 0)
        debug(
          'Importing new messages: %s',
          JSON.stringify(newMsgs, null, ' ')
        );

      this.store = m;
      for (let newMsg of newMsgs)
        yield* this.addMessage(newMsg);
      return;
    }

    if (!(ni < na.length)) {
      // All new messages added, but some old messages are left for
      // merging. Under normal circumstances this should be impossible, but
      // recently mute messages are not retained by the server and in the future
      // message might be deleted.
      let oldMsgs = oa.splice(oi);
      console.warn('[ERROR] Stray old messages:', oldMsgs, na, oa);
      this.store = m.concat(oldMsgs);
      return;
    }

    // Extract old and new messages and message times.
    let om = oa[oi], ot = new Date(om.date);
    let nm = na[ni], nt = new Date(nm.date);

    if (ot < nt) {
      debugv('Merge old message: %s', JSON.stringify(om));
      m.push(om);
      oi++;
      continue;
    } else if (nt < ot) {
      debugv('Merge new message: %s', JSON.stringify(nm));
      try {
        yield* Pg.putMsg(nm);
      } catch(err) {
        console.error('Failed to log msg:', nm, '\nError:', err);
      }
      m.push(nm);
      ni++;
      continue;
    } else if (eqMsg(om, nm)) {
      debugv('Merge common message: %s', JSON.stringify(nm));
      m.push(nm);
      oi++;
      ni++;
      continue;
    } else {
      // Can't figure out correct ordering without more complex code.
      // console.error('[ERROR] Merging messages:', na, oa);
      m.push(om);
      oi++;
      continue;
    }
  }
};

ChatStore.prototype.addMessage = function*(msg) {
  debug('Adding message: ' + JSON.stringify(msg));

  try {
    yield* Pg.putMsg(msg);
  } catch(err) {
    console.error('Failed to log msg:', msg, '\nError:', err);
  }

  if (this.store.length > Config.CHAT_HISTORY)
    this.store.shift();

  this.store.push(msg);
  this.emit('msg', msg);
};

ChatStore.prototype.getChatMessages = function(username, after) {
  let messages = [];
  for (let msg of this.store) {
    let then = new Date(msg.date);

    if (after <= then &&
        msg.type === 'say' &&
        msg.username === username)
      messages.push(msg);
  }
  return messages;
};

ChatStore.prototype.get = function() {
  return this.store;
};

function* make() {
  debug('Create chat store');
  let msgs = yield* Pg.getLastMessages();
  debug('Got %d old messages', msgs.length);
  _.forEach(msgs, msg => {
    debugv('Old message: %s', JSON.stringify(msg));
  });
  return new ChatStore(msgs);
}

module.exports = exports = make;
